# LIQUID ABT - Production Docker Configuration
# Multi-stage build for optimized production deployment

# Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install dependencies for building (including native modules)
RUN apk add --no-cache \
    g++ \
    make \
    python3 \
    libc6-compat

# Copy package files
COPY package.json package-lock.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for building)
RUN npm ci --frozen-lockfile

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application
RUN npm run build

# Production stage
FROM node:18-alpine AS runner

# Set working directory
WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Install production dependencies only
RUN apk add --no-cache \
    dumb-init \
    curl \
    ca-certificates

# Copy package files
COPY package.json package-lock.json ./

# Install only production dependencies
RUN npm ci --frozen-lockfile --production && \
    npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy startup scripts
COPY docker/entrypoint.sh ./entrypoint.sh
COPY docker/healthcheck.sh ./healthcheck.sh
RUN chmod +x ./entrypoint.sh ./healthcheck.sh

# Create necessary directories
RUN mkdir -p logs && \
    chown -R nextjs:nodejs logs

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD ./healthcheck.sh

# Set environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]
CMD ["./entrypoint.sh"]