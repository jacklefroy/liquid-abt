#!/bin/bash

# LIQUID ABT - Production Database Restore Script
# This script restores database backups from S3 with data integrity validation

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
RESTORE_DIR="${RESTORE_DIR:-/tmp/liquid-abt-restore}"
S3_BUCKET="${S3_BUCKET:-liquid-abt-backups}"
NOTIFICATION_WEBHOOK="${NOTIFICATION_WEBHOOK:-}"

# Database configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-liquid_abt}"
DB_USER="${DB_USER:-liquid_abt_user}"
PGPASSWORD="${DB_PASSWORD}"

# Restore configuration
BACKUP_DATE=""
BACKUP_NAME=""
DRY_RUN="${DRY_RUN:-false}"
FORCE_RESTORE="${FORCE_RESTORE:-false}"

# Logging setup
LOG_FILE="${LOG_FILE:-/var/log/liquid-abt-restore.log}"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] $1${NC}" | tee -a "$LOG_FILE"
}

warn() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING: $1${NC}" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR: $1${NC}" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')] INFO: $1${NC}" | tee -a "$LOG_FILE"
}

# Function to show usage
show_usage() {
    cat << EOF
LIQUID ABT Database Restore Script

Usage: $0 [OPTIONS]

Options:
    -d, --date DATE         Restore backup from specific date (YYYY-MM-DD)
    -n, --name NAME         Restore specific backup by name
    -l, --list             List available backups
    --dry-run              Show what would be restored without making changes
    --force                Force restore without confirmation (USE WITH CAUTION)
    -h, --help             Show this help message

Examples:
    $0 --list                                    # List all available backups
    $0 --date 2024-01-15                        # Restore latest backup from Jan 15, 2024
    $0 --name liquid_abt_backup_20240115_143022 # Restore specific backup
    $0 --date 2024-01-15 --dry-run              # Preview restore operation

Environment Variables:
    DB_HOST                Database host (default: localhost)
    DB_PORT                Database port (default: 5432)
    DB_NAME                Database name (default: liquid_abt)
    DB_USER                Database user (default: liquid_abt_user)
    DB_PASSWORD            Database password (required)
    S3_BUCKET              S3 bucket name (default: liquid-abt-backups)
    RESTORE_DIR            Local restore directory (default: /tmp/liquid-abt-restore)
    DRY_RUN                Set to 'true' for dry run (default: false)
    FORCE_RESTORE          Set to 'true' to skip confirmation (default: false)

EOF
}

# Function to send notifications
send_notification() {
    local status=$1
    local message=$2
    local details=${3:-""}
    
    if [[ -n "$NOTIFICATION_WEBHOOK" ]]; then
        curl -X POST "$NOTIFICATION_WEBHOOK" \
            -H "Content-Type: application/json" \
            -d "{
                \"status\": \"$status\",
                \"message\": \"$message\",
                \"details\": \"$details\",
                \"timestamp\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
                \"service\": \"liquid-abt-restore\"
            }" \
            --max-time 10 --silent || warn "Failed to send notification"
    fi
}

# Function to check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if required commands exist
    for cmd in pg_restore aws jq; do
        if ! command -v "$cmd" &> /dev/null; then
            error "$cmd is not installed or not in PATH"
            return 1
        fi
    done
    
    # Check PostgreSQL connection
    if ! PGPASSWORD="$PGPASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "SELECT 1;" &> /dev/null; then
        error "Cannot connect to PostgreSQL server"
        return 1
    fi
    
    # Check AWS credentials
    if ! aws sts get-caller-identity &> /dev/null; then
        error "AWS credentials not configured or invalid"
        return 1
    fi
    
    # Check S3 bucket access
    if ! aws s3 ls "s3://$S3_BUCKET" &> /dev/null; then
        error "Cannot access S3 bucket: $S3_BUCKET"
        return 1
    fi
    
    # Create restore directory
    mkdir -p "$RESTORE_DIR"
    
    log "Prerequisites check passed"
    return 0
}

# Function to list available backups
list_backups() {
    log "Listing available backups from S3..."
    
    aws s3api list-objects-v2 \
        --bucket "$S3_BUCKET" \
        --prefix "backups/" \
        --query 'Contents[?contains(Key, `manifest.json`)].[Key,LastModified,Size]' \
        --output table || error "Failed to list backups from S3"
}

# Function to find backup by date
find_backup_by_date() {
    local target_date="$1"
    local year=$(echo "$target_date" | cut -d'-' -f1)
    local month=$(echo "$target_date" | cut -d'-' -f2)
    local day=$(echo "$target_date" | cut -d'-' -f3)
    
    log "Finding backups for date: $target_date"
    
    local backup_keys
    backup_keys=$(aws s3api list-objects-v2 \
        --bucket "$S3_BUCKET" \
        --prefix "backups/$year/$month/$day/" \
        --query 'Contents[?contains(Key, `manifest.json`)].Key' \
        --output text 2>/dev/null || echo "")
    
    if [[ -z "$backup_keys" || "$backup_keys" == "None" ]]; then
        error "No backups found for date: $target_date"
        return 1
    fi
    
    # Get the latest backup from that date
    local latest_backup=$(echo "$backup_keys" | tr '\t' '\n' | sort -r | head -n1)
    log "Found backup: $latest_backup"
    echo "$latest_backup"
}

# Function to download backup files
download_backup_files() {
    local manifest_key="$1"
    local manifest_file="$RESTORE_DIR/$(basename "$manifest_key")"
    
    log "Downloading backup manifest: $manifest_key"
    
    if ! aws s3 cp "s3://$S3_BUCKET/$manifest_key" "$manifest_file"; then
        error "Failed to download manifest file"
        return 1
    fi
    
    # Parse manifest to get list of backup files
    local backup_dir=$(dirname "$manifest_key")
    local downloaded_files=("$manifest_file")
    
    log "Parsing manifest and downloading backup files..."
    
    while IFS= read -r filename; do
        local s3_key="$backup_dir/$filename"
        local local_file="$RESTORE_DIR/$filename"
        
        log "Downloading: $filename"
        if aws s3 cp "s3://$S3_BUCKET/$s3_key" "$local_file"; then
            downloaded_files+=("$local_file")
        else
            error "Failed to download: $filename"
            return 1
        fi
        
    done < <(jq -r '.files[].filename' "$manifest_file" | grep -v manifest.json)
    
    printf '%s\n' "${downloaded_files[@]}"
    return 0
}

# Function to verify backup integrity
verify_backup_integrity() {
    local manifest_file="$1"
    
    log "Verifying backup integrity..."
    
    while IFS= read -r line; do
        local filename=$(echo "$line" | jq -r '.filename')
        local expected_checksum=$(echo "$line" | jq -r '.sha256')
        local file_path="$RESTORE_DIR/$filename"
        
        if [[ ! -f "$file_path" ]]; then
            error "Backup file missing: $filename"
            return 1
        fi
        
        local actual_checksum=$(sha256sum "$file_path" 2>/dev/null | cut -d' ' -f1 || shasum -a 256 "$file_path" | cut -d' ' -f1)
        
        if [[ "$expected_checksum" != "$actual_checksum" ]]; then
            error "Checksum mismatch for $filename"
            error "Expected: $expected_checksum"
            error "Actual: $actual_checksum"
            return 1
        fi
        
        log "Integrity verified: $filename"
        
    done < <(jq -c '.files[]' "$manifest_file" | grep -v manifest.json)
    
    log "All backup files passed integrity verification"
    return 0
}

# Function to create database backup before restore
create_pre_restore_backup() {
    log "Creating pre-restore backup as safety measure..."
    
    local safety_backup="$RESTORE_DIR/pre_restore_backup_${TIMESTAMP}.sql"
    
    PGPASSWORD="$PGPASSWORD" pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --format=custom \
        --compress=9 \
        --file="$safety_backup" 2>&1 | tee -a "$LOG_FILE"
    
    if [[ ${PIPESTATUS[0]} -eq 0 ]]; then
        log "Safety backup created: $safety_backup"
        echo "$safety_backup"
        return 0
    else
        error "Failed to create safety backup"
        return 1
    fi
}

# Function to restore database from backup files
restore_database() {
    local manifest_file="$1"
    local backup_files=()
    
    log "Starting database restore process..."
    
    # Get list of backup files from manifest
    while IFS= read -r filename; do
        [[ "$filename" != *"manifest.json"* ]] && backup_files+=("$RESTORE_DIR/$filename")
    done < <(jq -r '.files[].filename' "$manifest_file")
    
    # Identify master and tenant backups
    local master_backup=""
    local tenant_backups=()
    
    for file in "${backup_files[@]}"; do
        if [[ "$(basename "$file")" == *"_master.sql" ]]; then
            master_backup="$file"
        elif [[ "$(basename "$file")" == *"_tenant_"*.sql ]]; then
            tenant_backups+=("$file")
        fi
    done
    
    if [[ -z "$master_backup" ]]; then
        error "Master backup file not found"
        return 1
    fi
    
    log "Found master backup: $(basename "$master_backup")"
    log "Found ${#tenant_backups[@]} tenant backups"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        info "DRY RUN: Would restore the following:"
        info "  Master schema: $(basename "$master_backup")"
        for tenant_file in "${tenant_backups[@]}"; do
            info "  Tenant schema: $(basename "$tenant_file")"
        done
        return 0
    fi
    
    # Drop existing database and recreate
    log "Dropping existing database: $DB_NAME"
    PGPASSWORD="$PGPASSWORD" dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME" --if-exists
    
    log "Creating fresh database: $DB_NAME"
    PGPASSWORD="$PGPASSWORD" createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"
    
    # Restore master schema
    log "Restoring master schema..."
    PGPASSWORD="$PGPASSWORD" pg_restore \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --verbose \
        --clean \
        --if-exists \
        "$master_backup" 2>&1 | tee -a "$LOG_FILE"
    
    if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
        error "Master schema restore failed"
        return 1
    fi
    
    log "Master schema restore completed"
    
    # Restore tenant schemas
    for tenant_file in "${tenant_backups[@]}"; do
        local schema_name=$(basename "$tenant_file" .sql | sed 's/.*_\(tenant_[^_]*\).*/\1/')
        log "Restoring tenant schema: $schema_name"
        
        PGPASSWORD="$PGPASSWORD" pg_restore \
            -h "$DB_HOST" \
            -p "$DB_PORT" \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            --verbose \
            --clean \
            --if-exists \
            "$tenant_file" 2>&1 | tee -a "$LOG_FILE"
        
        if [[ ${PIPESTATUS[0]} -ne 0 ]]; then
            error "Tenant schema restore failed: $schema_name"
            return 1
        fi
        
        log "Tenant schema restore completed: $schema_name"
    done
    
    log "Database restore completed successfully"
    return 0
}

# Function to validate restored data
validate_restored_data() {
    log "Validating restored database..."
    
    # Check if database exists and is accessible
    if ! PGPASSWORD="$PGPASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" &>/dev/null; then
        error "Cannot connect to restored database"
        return 1
    fi
    
    # Check master schema tables
    local master_tables
    master_tables=$(PGPASSWORD="$PGPASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';" | tr -d ' ')
    
    if [[ "$master_tables" -eq 0 ]]; then
        error "No tables found in master schema"
        return 1
    fi
    
    log "Master schema validation: $master_tables tables found"
    
    # Check tenant schemas
    local tenant_schemas
    tenant_schemas=$(PGPASSWORD="$PGPASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%';" | tr -d ' ')
    
    log "Tenant schema validation: $tenant_schemas tenant schemas found"
    
    # Basic data integrity checks
    local tenant_count
    tenant_count=$(PGPASSWORD="$PGPASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT count(*) FROM tenants;" | tr -d ' ' 2>/dev/null || echo "0")
    
    log "Data validation: $tenant_count tenants in master schema"
    
    log "Database validation completed successfully"
    return 0
}

# Main restore function
main() {
    local start_time=$(date +%s)
    
    log "Starting LIQUID ABT database restore process"
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -d|--date)
                BACKUP_DATE="$2"
                shift 2
                ;;
            -n|--name)
                BACKUP_NAME="$2"
                shift 2
                ;;
            -l|--list)
                check_prerequisites && list_backups
                exit 0
                ;;
            --dry-run)
                DRY_RUN="true"
                shift
                ;;
            --force)
                FORCE_RESTORE="true"
                shift
                ;;
            -h|--help)
                show_usage
                exit 0
                ;;
            *)
                error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Validate arguments
    if [[ -z "$BACKUP_DATE" && -z "$BACKUP_NAME" ]]; then
        error "Either --date or --name must be specified"
        show_usage
        exit 1
    fi
    
    # Check prerequisites
    if ! check_prerequisites; then
        error "Prerequisites check failed"
        send_notification "error" "Restore failed: Prerequisites check failed"
        exit 1
    fi
    
    # Find backup to restore
    local manifest_key=""
    if [[ -n "$BACKUP_DATE" ]]; then
        manifest_key=$(find_backup_by_date "$BACKUP_DATE")
    else
        # Find by name (assuming it's in the standard S3 structure)
        local backup_pattern="backups/*/*/*/*${BACKUP_NAME}*_manifest.json"
        manifest_key=$(aws s3api list-objects-v2 \
            --bucket "$S3_BUCKET" \
            --prefix "backups/" \
            --query "Contents[?contains(Key, '$BACKUP_NAME') && contains(Key, 'manifest.json')].Key" \
            --output text | head -n1)
    fi
    
    if [[ -z "$manifest_key" || "$manifest_key" == "None" ]]; then
        error "Backup not found"
        exit 1
    fi
    
    log "Selected backup: $manifest_key"
    
    # Confirmation prompt (unless forced)
    if [[ "$FORCE_RESTORE" != "true" && "$DRY_RUN" != "true" ]]; then
        echo
        warn "WARNING: This will COMPLETELY REPLACE the current database!"
        warn "Database: $DB_NAME on $DB_HOST:$DB_PORT"
        warn "Backup: $manifest_key"
        echo
        read -p "Are you absolutely sure? Type 'RESTORE' to confirm: " confirmation
        if [[ "$confirmation" != "RESTORE" ]]; then
            log "Restore cancelled by user"
            exit 0
        fi
    fi
    
    # Download backup files
    local backup_files
    if ! mapfile -t backup_files < <(download_backup_files "$manifest_key"); then
        error "Failed to download backup files"
        send_notification "error" "Restore failed: Download failed"
        exit 1
    fi
    
    local manifest_file="${backup_files[0]}"
    
    # Verify backup integrity
    if ! verify_backup_integrity "$manifest_file"; then
        error "Backup integrity verification failed"
        send_notification "error" "Restore failed: Integrity check failed"
        exit 1
    fi
    
    # Create safety backup (unless dry run)
    local safety_backup=""
    if [[ "$DRY_RUN" != "true" ]]; then
        if ! safety_backup=$(create_pre_restore_backup); then
            warn "Could not create safety backup - proceeding anyway"
        fi
    fi
    
    # Perform restore
    if ! restore_database "$manifest_file"; then
        error "Database restore failed"
        send_notification "error" "Restore failed: Database restore failed"
        exit 1
    fi
    
    # Validate restored data (unless dry run)
    if [[ "$DRY_RUN" != "true" ]]; then
        if ! validate_restored_data; then
            error "Restored data validation failed"
            send_notification "error" "Restore failed: Data validation failed"
            exit 1
        fi
    fi
    
    # Calculate duration
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log "DRY RUN completed successfully!"
        log "Duration: ${duration}s"
        log "No actual restore was performed"
    else
        log "Restore completed successfully!"
        log "Duration: ${duration}s"
        log "Backup source: $manifest_key"
        [[ -n "$safety_backup" ]] && log "Safety backup: $safety_backup"
        
        # Send success notification
        local success_details=$(cat << EOF
Duration: ${duration}s
Source: $manifest_key
Database: $DB_NAME
Host: $DB_HOST:$DB_PORT
Safety backup: ${safety_backup:-"Not created"}
EOF
)
        
        send_notification "success" "Database restore completed successfully" "$success_details"
    fi
    
    # Cleanup downloaded files
    rm -rf "$RESTORE_DIR"
    
    exit 0
}

# Handle script termination
cleanup_on_exit() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        error "Restore process terminated with exit code $exit_code"
        send_notification "error" "Restore process terminated unexpectedly" "Exit code: $exit_code"
        
        # Clean up downloaded files
        rm -rf "$RESTORE_DIR" 2>/dev/null || true
    fi
}

trap cleanup_on_exit EXIT

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi