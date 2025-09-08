// LIQUID ABT - Global Next.js Middleware

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';

// Temporarily disable rate limiting to fix Redis issues
// import { 
//   apiRateLimit, 
//   webhookRateLimit, 
//   authRateLimit, 
//   registrationRateLimit 
// } from '@/lib/middleware/rateLimiter';
// import { validateWebhookSecurity } from '@/lib/middleware/webhookIdempotency';

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  
  // Skip middleware for static assets and internal Next.js routes
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/static') ||
    pathname.includes('/api/_') // Internal API routes
  ) {
    return NextResponse.next();
  }
  
  // Temporarily disable rate limiting
  // Apply appropriate rate limiting based on path
  let rateLimitResult: NextResponse | null = null;
  
  // TODO: Re-enable rate limiting after fixing Redis issues
  // if (pathname.includes('/webhook')) {
  //   // Webhook endpoints get special treatment
  //   rateLimitResult = await webhookRateLimit(req);
  //   
  //   // Additional webhook security validation
  //   if (!rateLimitResult) {
  //     const security = validateWebhookSecurity(req);
  //     if (!security.valid) {
  //       console.warn(`Webhook security issues: ${security.issues.join(', ')}`);
  //       // Log but don't block - some webhooks have different formats
  //     }
  //   }
  // } else if (pathname.includes('/auth') || pathname.includes('/login') || pathname.includes('/signin')) {
  //   // Authentication endpoints
  //   rateLimitResult = await authRateLimit(req);
  // } else if (pathname.includes('/register') || pathname.includes('/signup')) {
  //   // Registration endpoints
  //   rateLimitResult = await registrationRateLimit(req);
  // } else if (pathname.startsWith('/api/')) {
  //   // General API endpoints
  //   rateLimitResult = await apiRateLimit(req);
  // }
  // 
  // // If rate limit was hit, return the error response
  // if (rateLimitResult && rateLimitResult.status === 429) {
  //   return rateLimitResult;
  // }
  
  // Add security headers to all responses
  const response = rateLimitResult || NextResponse.next();
  
  // Comprehensive security headers
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  
  // HSTS (HTTP Strict Transport Security) - only in production
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  
  // Content Security Policy (CSP)
  const cspHeader = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://checkout.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https://api.stripe.com https://api.kraken.com https://checkout.stripe.com wss:",
    "frame-src https://js.stripe.com https://checkout.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests"
  ].join('; ');
  response.headers.set('Content-Security-Policy', cspHeader);
  
  // CORS headers with whitelist for API routes
  if (pathname.startsWith('/api/')) {
    const allowedOrigins = [
      'https://liquidtreasury.business',
      'https://www.liquidtreasury.business', 
      'https://app.liquidtreasury.business',
      'https://staging.liquidtreasury.business',
      process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    ];
    
    const origin = req.headers.get('origin');
    if (origin && allowedOrigins.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    }
    
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Allow-Methods', 'GET,DELETE,PATCH,POST,PUT,OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 
      'Accept, Accept-Version, Authorization, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, X-CSRF-Token, X-Requested-With'
    );
    response.headers.set('Access-Control-Max-Age', '86400'); // 24 hours
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
      return new NextResponse(null, { status: 200, headers: response.headers });
    }
  }
  
  // CSRF protection for state-changing operations
  if (pathname.startsWith('/api/') && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    // Skip CSRF for webhooks (they have their own security)
    if (!pathname.includes('/webhook')) {
      const csrfResult = validateCSRF(req);
      if (!csrfResult.valid) {
        return new NextResponse(
          JSON.stringify({ error: 'CSRF token validation failed' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
  }

  // Generate CSRF token for GET requests to API routes that need it
  if (req.method === 'GET' && pathname.startsWith('/api/') && pathname.includes('/csrf-token')) {
    const token = generateCSRFToken(req);
    return NextResponse.json({ csrfToken: token });
  }
  
  // Log API requests for monitoring
  if (pathname.startsWith('/api/') && process.env.NODE_ENV !== 'test') {
    const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
    const userAgent = req.headers.get('user-agent') || 'unknown';
    console.log(`API ${req.method} ${pathname} from ${ip} - ${userAgent.substring(0, 50)}`);
  }
  
  return response;
}

// CSRF Protection Helpers
function generateCSRFToken(req: NextRequest): string {
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const timestamp = Math.floor(Date.now() / 1000 / 60); // 1-minute precision
  const secret = process.env.JWT_SECRET || 'fallback-secret';
  
  const data = `${ip}:${userAgent}:${timestamp}:${secret}`;
  return createHash('sha256').update(data).digest('hex').substring(0, 32);
}

function validateCSRF(req: NextRequest): { valid: boolean; reason?: string } {
  // Skip CSRF validation in development for easier testing
  if (process.env.NODE_ENV === 'development') {
    return { valid: true };
  }

  const tokenFromHeader = req.headers.get('X-CSRF-Token');
  const tokenFromBody = req.headers.get('Content-Type')?.includes('application/json') 
    ? null // Would need to parse JSON body
    : null;
    
  const providedToken = tokenFromHeader || tokenFromBody;
  
  if (!providedToken) {
    return { valid: false, reason: 'No CSRF token provided' };
  }

  // Generate expected token
  const expectedToken = generateCSRFToken(req);
  
  // Also check token from 1 minute ago (for clock skew)
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const userAgent = req.headers.get('user-agent') || 'unknown';
  const prevTimestamp = Math.floor(Date.now() / 1000 / 60) - 1;
  const secret = process.env.JWT_SECRET || 'fallback-secret';
  const prevData = `${ip}:${userAgent}:${prevTimestamp}:${secret}`;
  const prevToken = createHash('sha256').update(prevData).digest('hex').substring(0, 32);
  
  if (providedToken === expectedToken || providedToken === prevToken) {
    return { valid: true };
  }
  
  return { valid: false, reason: 'Invalid CSRF token' };
}

// Configure which paths the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};