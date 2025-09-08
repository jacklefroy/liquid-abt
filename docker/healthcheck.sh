#!/bin/sh
# LIQUID ABT - Health Check Script

set -e

# Check if the application is responding
if curl -f -s http://localhost:3000/api/health > /dev/null; then
  echo "✅ Application is healthy"
  exit 0
else
  echo "❌ Application health check failed"
  exit 1
fi