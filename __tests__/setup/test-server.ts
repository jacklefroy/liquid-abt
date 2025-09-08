// Test Server Setup for Integration Tests

import { NextApiRequest, NextApiResponse } from 'next'
import { createServer, Server } from 'http'
import { parse } from 'url'
import next from 'next'
import { TestDatabaseUtils } from '../utils/database'

// Mock external dependencies at the HTTP level
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    webhooks: {
      constructEvent: jest.fn().mockReturnValue({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_123',
            amount: 100000, // $1000 AUD
            currency: 'aud',
            status: 'succeeded',
            metadata: { tenant_id: 'test-tenant-123' }
          }
        }
      })
    },
    paymentIntents: {
      retrieve: jest.fn().mockResolvedValue({
        id: 'pi_test_123',
        amount: 100000,
        currency: 'aud',
        status: 'succeeded'
      })
    }
  }))
})

jest.mock('@/lib/integrations/exchanges/interface', () => ({
  ExchangeProviderFactory: {
    create: jest.fn().mockReturnValue({
      type: 'kraken',
      getCurrentPrice: jest.fn().mockResolvedValue({
        symbol: 'BTC',
        price: 95000,
        currency: 'AUD'
      }),
      createMarketOrder: jest.fn().mockResolvedValue({
        orderId: 'test_order_123',
        status: 'filled',
        side: 'buy',
        symbol: 'BTC',
        amount: 0.001,
        filledAmount: 0.001,
        averagePrice: 95000,
        totalValue: 95,
        fees: [{ amount: 0.5, currency: 'AUD', type: 'trading' }],
        timestamp: new Date()
      }),
      withdrawBitcoin: jest.fn().mockResolvedValue({
        withdrawalId: 'test_withdrawal_123',
        status: 'pending',
        currency: 'BTC',
        amount: 0.001,
        address: 'bc1qtest',
        fees: [{ amount: 0.0001, currency: 'BTC', type: 'withdrawal' }],
        timestamp: new Date()
      })
    })
  }
}))

export class TestServer {
  private app: any
  private server: Server | null = null
  private port: number

  constructor(port = 0) {
    this.port = port
    // Use development mode for testing
    this.app = next({ dev: true, quiet: true })
  }

  async start(): Promise<{ server: Server; port: number; url: string }> {
    await this.app.prepare()
    
    const handle = this.app.getRequestHandler()
    
    this.server = createServer(async (req, res) => {
      try {
        const parsedUrl = parse(req.url!, true)
        await handle(req, res, parsedUrl)
      } catch (err) {
        console.error('Error occurred handling', req.url, err)
        res.statusCode = 500
        res.end('internal server error')
      }
    })

    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, (err?: Error) => {
        if (err) {
          reject(err)
          return
        }
        
        const address = this.server!.address()
        const actualPort = typeof address === 'object' && address ? address.port : this.port
        
        resolve({
          server: this.server!,
          port: actualPort,
          url: `http://localhost:${actualPort}`
        })
      })
    })
  }

  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          resolve()
        })
      })
    }
  }

  async cleanup(): Promise<void> {
    await TestDatabaseUtils.cleanup()
    await this.stop()
  }
}

export default TestServer