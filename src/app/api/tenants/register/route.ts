// LIQUID ABT - Tenant Registration API

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getMasterPrisma, tenantSchemaManager } from '@/lib/database/connection';
import { passwordManager } from '@/lib/auth/argon2Password';
import { integratedAuthSecurity } from '@/lib/middleware/authSecurity';
import { createRateLimit } from '@/lib/middleware/rateLimiter';
import { SubscriptionTier, UserRole, SUBSCRIPTION_LIMITS } from '@/types/database';

// Validation schema for tenant registration
const registerTenantSchema = z.object({
  // Company Information
  companyName: z.string().min(2, 'Company name must be at least 2 characters'),
  subdomain: z.string()
    .min(3, 'Subdomain must be at least 3 characters')
    .max(20, 'Subdomain must be less than 20 characters')
    .regex(/^[a-z0-9-]+$/, 'Subdomain can only contain lowercase letters, numbers, and hyphens')
    .refine(val => !val.startsWith('-') && !val.endsWith('-'), 'Subdomain cannot start or end with a hyphen'),
  
  // Owner Account
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  
  // Business Details
  contactEmail: z.string().email('Invalid contact email'),
  businessAddress: z.string().optional(),
  abn: z.string().optional(),
  
  // Initial subscription tier
  subscriptionTier: z.nativeEnum(SubscriptionTier).default(SubscriptionTier.FREE)
});

// Rate limiting for registration attempts
const registrationRateLimit = createRateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // 3 registration attempts per hour per IP
  keyGenerator: (req: any) => {
    const ip = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
    return `register:${ip}`;
  }
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Apply rate limiting
    const rateLimitResult = await registrationRateLimit({
      body,
      headers: Object.fromEntries(request.headers.entries())
    } as any);
    
    if (rateLimitResult.limited) {
      return NextResponse.json(
        { 
          error: 'Too many registration attempts. Please try again later.',
          retryAfter: rateLimitResult.retryAfter
        },
        { status: 429 }
      );
    }
    
    // Validate input data
    const validationResult = registerTenantSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Validation failed', 
          details: validationResult.error.errors 
        },
        { status: 400 }
      );
    }

    const data = validationResult.data;
    const prisma = getMasterPrisma();

    // Check if subdomain is already taken
    const existingTenant = await prisma.tenant.findUnique({
      where: { subdomain: data.subdomain }
    });

    if (existingTenant) {
      return NextResponse.json(
        { error: 'Subdomain is already taken' },
        { status: 409 }
      );
    }

    // Check if email is already registered
    const existingUser = await prisma.user.findUnique({
      where: { email: data.email }
    });

    if (existingUser) {
      return NextResponse.json(
        { error: 'Email address is already registered' },
        { status: 409 }
      );
    }

    // Generate tenant ID and schema name
    const tenantId = uuidv4();
    const schemaName = `tenant_${tenantId.replace(/-/g, '_')}`;

    // Hash password using Argon2id
    const passwordHash = await passwordManager.hashPassword(data.password);

    // Get subscription limits
    const limits = SUBSCRIPTION_LIMITS[data.subscriptionTier];

    // Start database transaction and extract result
    const result = await prisma.$transaction(async (tx) => {
      // Create tenant record
      const tenant = await tx.tenant.create({
        data: {
          id: tenantId,
          companyName: data.companyName,
          subdomain: data.subdomain,
          subscriptionTier: data.subscriptionTier,
          schemaName: schemaName,
          contactEmail: data.contactEmail,
          businessAddress: data.businessAddress,
          abn: data.abn,
          monthlyVolumeLimit: limits.monthlyVolumeLimit,
          dailyVolumeLimit: limits.dailyVolumeLimit,
          maxTransactionLimit: limits.maxTransactionLimit,
          maxUsers: limits.maxUsers,
          maxIntegrations: limits.maxIntegrations
        }
      });

      // Create owner user account
      const user = await tx.user.create({
        data: {
          tenantId: tenantId,
          email: data.email,
          passwordHash: passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          role: UserRole.OWNER,
        }
      });

      // Create tenant-specific database schema
      await tenantSchemaManager.createTenantSchema(tenantId);

      // Use integrated auth system to generate token pair for immediate login
      const ipAddress = request.headers.get('x-forwarded-for') || 
                       request.headers.get('x-real-ip') || 
                       'unknown';
      const userAgent = request.headers.get('user-agent') || 'unknown';
      const deviceFingerprint = body.deviceFingerprint;
      
      const authResult = await integratedAuthSecurity.authenticateUser(
        { 
          email: user.email, 
          password: data.password,
          deviceFingerprint
        },
        ipAddress,
        userAgent
      );

      return { tenant, user, authResult };
    });

    if (!result.authResult.success) {
      return NextResponse.json(
        { error: 'Registration successful but login failed. Please try logging in manually.' },
        { status: 201 }
      );
    }

    // Return success response with tokens
    return NextResponse.json(
      {
        message: 'Tenant registered successfully',
        tenant: {
          id: tenantId,
          companyName: data.companyName,
          subdomain: data.subdomain,
          subscriptionTier: data.subscriptionTier
        },
        redirectUrl: `https://${data.subdomain}.${process.env.MASTER_DOMAIN}/dashboard`,
        accessToken: result.authResult.accessToken,
        refreshToken: result.authResult.refreshToken
      },
      { status: 201 }
    );

  } catch (error) {
    console.error('Tenant registration error:', error);
    
    // If there's an error, try to clean up any partial creation
    if (error instanceof Error && error.message.includes('tenantId')) {
      try {
        // Extract tenant ID from error context if available
        // This is a simplified cleanup - in production you'd want more robust error handling
      } catch (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
    }

    return NextResponse.json(
      { error: 'Failed to register tenant. Please try again.' },
      { status: 500 }
    );
  }
}


// GET endpoint to check subdomain availability
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const subdomain = searchParams.get('subdomain');

    if (!subdomain) {
      return NextResponse.json(
        { error: 'Subdomain parameter is required' },
        { status: 400 }
      );
    }

    // Validate subdomain format
    const subdomainRegex = /^[a-z0-9-]+$/;
    if (!subdomainRegex.test(subdomain) || subdomain.startsWith('-') || subdomain.endsWith('-')) {
      return NextResponse.json(
        { 
          available: false, 
          reason: 'Invalid subdomain format' 
        }
      );
    }

    const prisma = getMasterPrisma();
    const existingTenant = await prisma.tenant.findUnique({
      where: { subdomain }
    });

    return NextResponse.json({
      available: !existingTenant,
      subdomain: subdomain
    });

  } catch (error) {
    console.error('Subdomain check error:', error);
    return NextResponse.json(
      { error: 'Failed to check subdomain availability' },
      { status: 500 }
    );
  }
}