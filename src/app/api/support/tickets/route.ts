import { NextRequest, NextResponse } from 'next/server';
import { getMasterPrisma, getTenantPrisma } from '@/lib/database/connection';
import { authenticateToken } from '@/lib/middleware/authSecurity';
import { createRateLimit } from '@/lib/middleware/rateLimiter';

interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  type: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
  updatedAt: string;
  lastUpdate: string;
  response?: string;
  userId: string;
  tenantId: string;
}

// In-memory storage for demo purposes
// In production, this would be stored in database
const supportTickets = new Map<string, SupportTicket[]>();

export async function GET(request: NextRequest) {
  try {
    // Apply rate limiting
    const rateLimitHandler = createRateLimit({
      windowMs: 60000, // 1 minute
      maxRequests: 30,
      message: 'Too many support requests'
    });
    
    const rateLimitResult = await rateLimitHandler(request);
    
    if (rateLimitResult.limited) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          retryAfter: rateLimitResult.retryAfter
        },
        { status: 429 }
      );
    }

    // Authenticate and get tenant context
    const authResult = await authenticateToken(request);
    if (!authResult.authenticated || !authResult.tenantId || !authResult.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const tenantId = authResult.tenantId;
    const userId = authResult.user.id;

    // Get user's tickets
    const userTickets = supportTickets.get(userId) || [];

    // Sort by creation date (newest first)
    const sortedTickets = userTickets
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10); // Return last 10 tickets

    return NextResponse.json({
      success: true,
      tickets: sortedTickets,
      count: userTickets.length
    });

  } catch (error) {
    console.error('Support tickets GET error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch support tickets',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting - stricter for ticket creation
    const rateLimitHandler = createRateLimit({
      windowMs: 300000, // 5 minutes
      maxRequests: 3, // Maximum 3 tickets per 5 minutes
      message: 'Too many support ticket submissions'
    });
    
    const rateLimitResult = await rateLimitHandler(request);
    
    if (rateLimitResult.limited) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          message: 'You can only submit 3 support tickets per 5 minutes',
          retryAfter: rateLimitResult.retryAfter
        },
        { status: 429 }
      );
    }

    // Authenticate and get tenant context
    const authResult = await authenticateToken(request);
    if (!authResult.authenticated || !authResult.tenantId || !authResult.user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const tenantId = authResult.tenantId;
    const userId = authResult.user.id;

    // Parse request body
    const body = await request.json();
    const { subject, description, type = 'general_inquiry', priority = 'medium' } = body;

    // Validate required fields
    if (!subject?.trim() || !description?.trim()) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Subject and description are required' 
        },
        { status: 400 }
      );
    }

    // Create new ticket
    const ticketId = `ticket_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const now = new Date().toISOString();
    
    const newTicket: SupportTicket = {
      id: ticketId,
      subject: subject.trim(),
      description: description.trim(),
      type,
      status: 'open',
      priority: priority as 'low' | 'medium' | 'high' | 'urgent',
      createdAt: now,
      updatedAt: now,
      lastUpdate: 'Ticket submitted',
      userId,
      tenantId
    };

    // Add automatic response for transaction issues
    if (type === 'transaction_issue') {
      newTicket.priority = 'high';
      newTicket.response = 'Thank you for reporting this transaction issue. Our team is investigating and will respond within 2 hours. For urgent matters, please use our emergency contact.';
      newTicket.lastUpdate = 'Auto-response sent - Investigation started';
    }

    // Store ticket (in production, this would be in database)
    const userTickets = supportTickets.get(userId) || [];
    userTickets.push(newTicket);
    supportTickets.set(userId, userTickets);

    // Send notification (in production, this would trigger email/Slack notifications)
    console.log(`[Support Ticket Created] ${ticketId} - ${subject} (Priority: ${priority})`);
    console.log(`User: ${authResult.user.email} | Tenant: ${tenantId}`);
    console.log(`Description: ${description}`);

    // Simulate different response scenarios based on ticket type
    let estimatedResponse = '24-48 hours';
    if (type === 'transaction_issue') {
      estimatedResponse = '2 hours';
    } else if (type === 'bitcoin_purchase' || type === 'stripe_integration') {
      estimatedResponse = '4-8 hours';
    }

    return NextResponse.json({
      success: true,
      ticket: {
        id: ticketId,
        subject: newTicket.subject,
        status: newTicket.status,
        priority: newTicket.priority,
        createdAt: newTicket.createdAt,
        estimatedResponse
      },
      message: `Support ticket created successfully. Expected response time: ${estimatedResponse}`
    });

  } catch (error) {
    console.error('Support tickets POST error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to create support ticket',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}