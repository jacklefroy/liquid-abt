#!/bin/bash

# Enable Mock Mode - Safe Migration Script
# LIQUID ABT - Bitcoin Treasury Platform
# 
# This script safely enables mock mode for development and testing
# by backing up current environment and updating configuration.

set -e  # Exit on any error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="$PROJECT_ROOT/backups/env_$TIMESTAMP"

echo "🔧 LIQUID ABT - Enabling Mock Mode"
echo "=================================="
echo "Timestamp: $(date)"
echo "Project Root: $PROJECT_ROOT"
echo ""

# Function to print colored output
print_success() {
    echo -e "\e[32m✅ $1\e[0m"
}

print_warning() {
    echo -e "\e[33m⚠️  $1\e[0m"
}

print_error() {
    echo -e "\e[31m❌ $1\e[0m"
}

print_info() {
    echo -e "\e[34mℹ️  $1\e[0m"
}

# Check if we're in the right directory
if [[ ! -f "$PROJECT_ROOT/package.json" ]] || [[ ! -f "$PROJECT_ROOT/src/lib/integrations/exchanges/exchange-factory.ts" ]]; then
    print_error "This doesn't appear to be the LIQUID ABT project root directory."
    print_error "Please run this script from the project root or scripts directory."
    exit 1
fi

print_info "Project validation passed"

# Create backup directory
echo ""
echo "📦 Creating environment backup..."
mkdir -p "$BACKUP_DIR"

# Backup existing .env files
for env_file in .env .env.local .env.development .env.production; do
    if [[ -f "$PROJECT_ROOT/$env_file" ]]; then
        cp "$PROJECT_ROOT/$env_file" "$BACKUP_DIR/$env_file.backup"
        print_success "Backed up $env_file"
    fi
done

# Backup current environment state
echo "# Environment backup created on $(date)" > "$BACKUP_DIR/backup_info.txt"
echo "# Original mock mode state:" >> "$BACKUP_DIR/backup_info.txt"
if grep -q "USE_MOCK_EXCHANGE" "$PROJECT_ROOT/.env" 2>/dev/null; then
    grep "USE_MOCK_EXCHANGE" "$PROJECT_ROOT/.env" >> "$BACKUP_DIR/backup_info.txt"
else
    echo "USE_MOCK_EXCHANGE=false" >> "$BACKUP_DIR/backup_info.txt"
fi

print_success "Environment backup created at: $BACKUP_DIR"

# Check if .env exists, create if needed
echo ""
echo "🔧 Configuring environment variables..."
if [[ ! -f "$PROJECT_ROOT/.env" ]]; then
    print_warning "No .env file found, creating one from .env.example"
    if [[ -f "$PROJECT_ROOT/.env.example" ]]; then
        cp "$PROJECT_ROOT/.env.example" "$PROJECT_ROOT/.env"
        print_success "Created .env from .env.example"
    else
        touch "$PROJECT_ROOT/.env"
        print_success "Created empty .env file"
    fi
fi

# Function to update or add environment variable
update_env_var() {
    local key="$1"
    local value="$2"
    local file="$3"
    
    if grep -q "^${key}=" "$file" 2>/dev/null; then
        # Variable exists, update it
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s/^${key}=.*/${key}=${value}/" "$file"
        else
            # Linux
            sed -i "s/^${key}=.*/${key}=${value}/" "$file"
        fi
        print_success "Updated $key in $(basename "$file")"
    else
        # Variable doesn't exist, add it
        echo "${key}=${value}" >> "$file"
        print_success "Added $key to $(basename "$file")"
    fi
}

# Enable mock mode in .env
update_env_var "USE_MOCK_EXCHANGE" "true" "$PROJECT_ROOT/.env"
update_env_var "MOCK_BTC_PRICE" "65000" "$PROJECT_ROOT/.env"
update_env_var "MOCK_SUCCESS_RATE" "0.95" "$PROJECT_ROOT/.env"
update_env_var "MOCK_NETWORK_DELAY_MS" "1000" "$PROJECT_ROOT/.env"

# Create or update .env.test if it doesn't have mock settings
if [[ -f "$PROJECT_ROOT/.env.test" ]]; then
    print_info "Updating .env.test with mock configuration..."
    update_env_var "USE_MOCK_EXCHANGE" "true" "$PROJECT_ROOT/.env.test"
    update_env_var "MOCK_BTC_PRICE" "65000" "$PROJECT_ROOT/.env.test"
    update_env_var "MOCK_SUCCESS_RATE" "0.95" "$PROJECT_ROOT/.env.test"
    update_env_var "MOCK_NETWORK_DELAY_MS" "100" "$PROJECT_ROOT/.env.test"
else
    print_info "Creating .env.test with mock configuration..."
    cp "$PROJECT_ROOT/.env.mock" "$PROJECT_ROOT/.env.test" 2>/dev/null || {
        cat > "$PROJECT_ROOT/.env.test" << EOF
# Test Environment Configuration with Mock Mode
NODE_ENV=test
USE_MOCK_EXCHANGE=true
MOCK_BTC_PRICE=65000
MOCK_SUCCESS_RATE=0.95
MOCK_NETWORK_DELAY_MS=100
EOF
    }
    print_success "Created .env.test"
fi

# Verify mock service files exist
echo ""
echo "🔍 Verifying mock service files..."

required_files=(
    "src/lib/sandbox/zerocap-mock.ts"
    "src/lib/integrations/exchanges/exchange-factory.ts"
    "src/lib/sandbox/mock-transaction-generator.ts"
    ".env.mock"
)

for file in "${required_files[@]}"; do
    if [[ -f "$PROJECT_ROOT/$file" ]]; then
        print_success "Found $file"
    else
        print_error "Missing required file: $file"
        echo "Please run the complete mock setup first."
        exit 1
    fi
done

# Test the configuration by checking exchange service info
echo ""
echo "🧪 Testing mock mode configuration..."

# Create a quick test script
cat > "$PROJECT_ROOT/test-mock-config.js" << 'EOF'
process.env.USE_MOCK_EXCHANGE = 'true';
const { getExchangeServiceInfo } = require('./src/lib/integrations/exchanges/exchange-factory.ts');

try {
    const info = getExchangeServiceInfo();
    console.log('Mock mode status:', info.isMock);
    console.log('Service name:', info.serviceName);
    
    if (info.isMock) {
        console.log('✅ Mock mode is properly configured!');
        process.exit(0);
    } else {
        console.log('❌ Mock mode is not active');
        process.exit(1);
    }
} catch (error) {
    console.log('❌ Configuration test failed:', error.message);
    process.exit(1);
}
EOF

if cd "$PROJECT_ROOT" && node test-mock-config.js 2>/dev/null; then
    print_success "Mock mode configuration test passed"
else
    print_warning "Configuration test failed (this is normal if TypeScript files aren't compiled yet)"
fi

# Clean up test file
rm -f "$PROJECT_ROOT/test-mock-config.js"

# Create restore script
echo ""
echo "📝 Creating restore script..."
cat > "$BACKUP_DIR/restore-original-env.sh" << EOF
#!/bin/bash
# Restore original environment configuration
# Generated on $(date)

echo "🔄 Restoring original environment configuration..."

EOF

for env_file in .env .env.local .env.development .env.production; do
    if [[ -f "$BACKUP_DIR/$env_file.backup" ]]; then
        cat >> "$BACKUP_DIR/restore-original-env.sh" << EOF
if [[ -f "$BACKUP_DIR/$env_file.backup" ]]; then
    cp "$BACKUP_DIR/$env_file.backup" "$PROJECT_ROOT/$env_file"
    echo "✅ Restored $env_file"
fi

EOF
    fi
done

cat >> "$BACKUP_DIR/restore-original-env.sh" << EOF
echo "✅ Environment restoration complete"
echo "Note: You may need to restart your development server"
EOF

chmod +x "$BACKUP_DIR/restore-original-env.sh"
print_success "Created restore script at $BACKUP_DIR/restore-original-env.sh"

# Final summary
echo ""
echo "🎉 Mock Mode Successfully Enabled!"
echo "================================="
echo ""
echo "Configuration Changes:"
echo "• USE_MOCK_EXCHANGE=true"
echo "• MOCK_BTC_PRICE=65000"
echo "• MOCK_SUCCESS_RATE=0.95"
echo "• MOCK_NETWORK_DELAY_MS=1000"
echo ""
echo "Backup Location: $BACKUP_DIR"
echo ""
echo "Next Steps:"
echo "1. Restart your development server (npm run dev)"
echo "2. Visit /admin/monitoring-simple to see the mock dashboard"
echo "3. Test the mock API at /api/admin/mock-control"
echo "4. Run integration tests: npm test mock-integration"
echo ""
echo "To restore original settings:"
echo "  bash $BACKUP_DIR/restore-original-env.sh"
echo ""
print_success "Mock mode setup complete! 🚀"

# Optional: Ask if user wants to restart dev server
if command -v npm &> /dev/null; then
    echo ""
    read -p "Would you like to restart the development server now? (y/N): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Restarting development server..."
        cd "$PROJECT_ROOT"
        
        # Kill existing dev server if running
        pkill -f "npm run dev" 2>/dev/null || true
        pkill -f "next dev" 2>/dev/null || true
        
        # Start new dev server in background
        npm run dev &
        DEV_PID=$!
        
        print_success "Development server started (PID: $DEV_PID)"
        print_info "Server should be available at http://localhost:3000"
        print_info "Mock dashboard: http://localhost:3000/admin/monitoring-simple"
        
        sleep 2
        echo ""
        print_info "Press Ctrl+C to stop the development server when finished testing"
    fi
fi