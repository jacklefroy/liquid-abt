// LIQUID ABT - Jest Global Setup

const { PrismaClient } = require('@prisma/client')

module.exports = async () => {
  console.log('🧪 Setting up test environment...')
  
  // Ensure test database exists and is accessible
  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: 'postgresql://jacklefroy@localhost:5432/liquid_abt_test'
      }
    }
  })
  
  try {
    // Test database connection
    await prisma.$connect()
    console.log('✅ Test database connection successful')
    
    // Run any necessary setup
    await prisma.$disconnect()
    
  } catch (error) {
    console.error('❌ Test database setup failed:', error)
    process.exit(1)
  }
  
  console.log('✅ Test environment setup complete')
}