// LIQUID ABT - Authentication Middleware for API Routes

import { NextRequest, NextResponse } from 'next/server';
import { authService, JWTPayload, TokenValidationResult } from './jwt';
import { getMasterPrisma } from '@/lib/database/connection';
import { UserRole } from '@/types/database';

export interface AuthenticatedRequest extends NextRequest {
  user: JWTPayload;
  tenant: {
    id: string;
    subdomain: string;
    companyName: string;
    subscriptionTier: string;
    schemaName: string;
  };
}

export interface AuthMiddlewareOptions {
  requiredRole?: UserRole;
  requireActiveTenant?: boolean;
  bypassAuth?: boolean;
}

/**
 * Authentication middleware for API routes
 */
export async function withAuth(
  handler: (req: AuthenticatedRequest) => Promise<NextResponse>,
  options: AuthMiddlewareOptions = {}
): Promise<(req: NextRequest) => Promise<NextResponse>> {
  return async (req: NextRequest): Promise<NextResponse> => {
    try {
      // Bypass authentication for certain routes
      if (options.bypassAuth) {
        return handler(req as AuthenticatedRequest);
      }

      // Extract token from Authorization header
      const authHeader = req.headers.get('authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return NextResponse.json(
          { error: 'Missing or invalid authorization header' },
          { status: 401 }
        );
      }

      const token = authHeader.substring(7);
      
      // Verify JWT token
      const tokenResult: TokenValidationResult = authService.verifyToken(token);
      if (!tokenResult.valid || !tokenResult.payload) {
        return NextResponse.json(
          { error: tokenResult.error || 'Invalid token' },
          { status: 401 }
        );
      }

      const userPayload = tokenResult.payload;

      // Extract tenant info from hostname or token
      const hostname = req.nextUrl.hostname;
      const subdomainFromHost = authService.extractTenantFromSubdomain(hostname);
      
      // Verify tenant context matches
      if (subdomainFromHost && subdomainFromHost !== userPayload.subdomain) {
        return NextResponse.json(
          { error: 'Tenant context mismatch' },
          { status: 403 }
        );
      }

      // Fetch tenant and user information from database
      const prisma = getMasterPrisma();
      
      const [user, tenant] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userPayload.userId },
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
            tenantId: true
          }
        }),
        prisma.tenant.findUnique({
          where: { id: userPayload.tenantId },
          select: {
            id: true,
            companyName: true,
            subdomain: true,
            subscriptionTier: true,
            isActive: true,
            schemaName: true
          }
        })
      ]);

      // Verify user exists and is active
      if (!user || !user.isActive) {
        return NextResponse.json(
          { error: 'User not found or inactive' },
          { status: 401 }
        );
      }

      // Verify tenant exists and is active
      if (!tenant || (options.requireActiveTenant && !tenant.isActive)) {
        return NextResponse.json(
          { error: 'Tenant not found or inactive' },
          { status: 403 }
        );
      }

      // Check role permissions
      if (options.requiredRole && !hasPermission(user.role as UserRole, options.requiredRole)) {
        return NextResponse.json(
          { error: 'Insufficient permissions' },
          { status: 403 }
        );
      }

      // Create authenticated request object
      const authenticatedReq = req as AuthenticatedRequest;
      authenticatedReq.user = userPayload;
      authenticatedReq.tenant = tenant;

      // Call the actual handler
      return handler(authenticatedReq);

    } catch (error) {
      console.error('Authentication middleware error:', error);
      return NextResponse.json(
        { error: 'Internal authentication error' },
        { status: 500 }
      );
    }
  };
}

/**
 * Helper function to check role hierarchy
 */
function hasPermission(userRole: UserRole, requiredRole: UserRole): boolean {
  const roleHierarchy = {
    [UserRole.VIEWER]: 1,
    [UserRole.USER]: 2,
    [UserRole.ADMIN]: 3,
    [UserRole.OWNER]: 4
  };

  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

/**
 * Extract user from request (for use in handlers)
 */
export function getUser(req: AuthenticatedRequest): JWTPayload {
  return req.user;
}

/**
 * Extract tenant from request (for use in handlers)
 */
export function getTenant(req: AuthenticatedRequest) {
  return req.tenant;
}

/**
 * Middleware for tenant subdomain validation (for client-side routing)
 */
export async function validateTenantMiddleware(req: NextRequest): Promise<NextResponse | null> {
  const hostname = req.nextUrl.hostname;
  const subdomain = authService.extractTenantFromSubdomain(hostname);
  
  if (!subdomain) {
    return null; // Not a tenant subdomain, continue normally
  }

  try {
    const prisma = getMasterPrisma();
    const tenant = await prisma.tenant.findUnique({
      where: { subdomain },
      select: { id: true, isActive: true }
    });

    if (!tenant || !tenant.isActive) {
      // Redirect to main domain with error
      const url = new URL('/', `https://${process.env.MASTER_DOMAIN}`);
      url.searchParams.set('error', 'tenant_not_found');
      return NextResponse.redirect(url);
    }

    return null; // Tenant is valid, continue
  } catch (error) {
    console.error('Tenant validation error:', error);
    const url = new URL('/', `https://${process.env.MASTER_DOMAIN}`);
    url.searchParams.set('error', 'tenant_validation_failed');
    return NextResponse.redirect(url);
  }
}