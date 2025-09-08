#!/bin/sh
# LIQUID ABT - Docker Entrypoint Script

set -e

# Wait for database to be ready
echo "Waiting for database connection..."
until npx prisma db push --accept-data-loss 2>/dev/null; do
  echo "Database not ready yet. Waiting 2 seconds..."
  sleep 2
done

echo "Database is ready. Running migrations..."

# Run Prisma migrations
npx prisma migrate deploy || echo "Migration failed, continuing..."

# Generate Prisma client (in case it's missing)
npx prisma generate

echo "Starting LIQUID ABT application..."

# Start the application
exec node server.js