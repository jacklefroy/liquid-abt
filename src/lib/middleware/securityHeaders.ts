// LIQUID ABT - Security Headers Middleware
// Implementation of threat model security header requirements

import { NextRequest, NextResponse } from 'next/server';

export interface SecurityHeadersConfig {
  enableHSTS?: boolean;
  enableCSP?: boolean;
  enableXFrameOptions?: boolean;
  enableXContentTypeOptions?: boolean;
  enableXXSSProtection?: boolean;
  enableReferrerPolicy?: boolean;
  hstsMaxAge?: number;
  reportURI?: string;
}

/**
 * Security headers middleware implementing threat model requirements
 */
export function createSecurityHeadersMiddleware(config: SecurityHeadersConfig = {}) {
  const defaultConfig: Required<SecurityHeadersConfig> = {
    enableHSTS: true,
    enableCSP: true,
    enableXFrameOptions: true,
    enableXContentTypeOptions: true,
    enableXXSSProtection: true,
    enableReferrerPolicy: true,
    hstsMaxAge: 31536000, // 1 year
    reportURI: '/api/security/csp-report',
    ...config
  };

  return function securityHeaders(request: NextRequest, response: NextResponse): NextResponse {
    // Threat Model Requirement: X-Frame-Options DENY
    if (defaultConfig.enableXFrameOptions) {
      response.headers.set('X-Frame-Options', 'DENY');
    }

    // Threat Model Requirement: X-Content-Type-Options nosniff
    if (defaultConfig.enableXContentTypeOptions) {
      response.headers.set('X-Content-Type-Options', 'nosniff');
    }

    // Threat Model Requirement: Strict-Transport-Security
    if (defaultConfig.enableHSTS) {
      response.headers.set(
        'Strict-Transport-Security',
        `max-age=${defaultConfig.hstsMaxAge}; includeSubDomains; preload`
      );
    }

    // Threat Model Requirement: Content-Security-Policy
    if (defaultConfig.enableCSP) {
      const csp = [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://js.stripe.com https://checkout.stripe.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https:",
        "connect-src 'self' https://api.stripe.com https://checkout.stripe.com wss://checkout.stripe.com",
        "frame-src https://js.stripe.com https://hooks.stripe.com https://checkout.stripe.com",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        `report-uri ${defaultConfig.reportURI}`
      ].join('; ');
      
      response.headers.set('Content-Security-Policy', csp);
    }

    // Threat Model Requirement: X-XSS-Protection
    if (defaultConfig.enableXXSSProtection) {
      response.headers.set('X-XSS-Protection', '1; mode=block');
    }

    // Threat Model Requirement: Referrer-Policy
    if (defaultConfig.enableReferrerPolicy) {
      response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    }

    // Additional security headers for financial platform
    response.headers.set('X-Permitted-Cross-Domain-Policies', 'none');
    response.headers.set('X-Download-Options', 'noopen');
    response.headers.set('X-DNS-Prefetch-Control', 'off');
    
    // Cache control for sensitive endpoints
    if (request.nextUrl.pathname.startsWith('/api/') || 
        request.nextUrl.pathname.startsWith('/dashboard/')) {
      response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      response.headers.set('Pragma', 'no-cache');
      response.headers.set('Expires', '0');
    }

    return response;
  };
}

/**
 * CSP Report handler for security monitoring
 */
export async function handleCSPReport(request: NextRequest): Promise<NextResponse> {
  try {
    const report = await request.json();
    
    // Log CSP violations for security monitoring
    console.warn('CSP Violation Report:', {
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('user-agent'),
      violatedDirective: report['csp-report']?.['violated-directive'],
      blockedURI: report['csp-report']?.['blocked-uri'],
      documentURI: report['csp-report']?.['document-uri'],
      sourceFile: report['csp-report']?.['source-file'],
      lineNumber: report['csp-report']?.['line-number']
    });

    // TODO: Integrate with security monitoring system
    // await securityMonitor.reportCSPViolation(report);

    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    console.error('CSP Report processing error:', error);
    return new NextResponse('Bad Request', { status: 400 });
  }
}

/**
 * Express middleware adapter for Next.js API routes
 */
export function applySecurityHeaders(
  req: any,
  res: any,
  next: () => void,
  config?: SecurityHeadersConfig
) {
  const middleware = createSecurityHeadersMiddleware(config);
  
  // Convert Express-style response to NextResponse for header setting
  const mockRequest = {
    nextUrl: { pathname: req.url },
    headers: new Map(Object.entries(req.headers))
  } as NextRequest;

  const mockResponse = {
    headers: new Map()
  } as NextResponse;

  // Apply security headers
  const result = middleware(mockRequest, mockResponse);
  
  // Copy headers to Express response
  result.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  next();
}