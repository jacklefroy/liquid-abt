#!/bin/bash

# LIQUID ABT - Production Database Backup Script
# This script creates comprehensive backups of the multi-tenant PostgreSQL database
# and uploads them to S3 with proper retention policies

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../../" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/tmp/liquid-abt-backups}"
S3_BUCKET="${S3_BUCKET:-liquid-abt-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
NOTIFICATION_WEBHOOK="${NOTIFICATION_WEBHOOK:-}"

# Database configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-liquid_abt}"
DB_USER="${DB_USER:-liquid_abt_user}"
PGPASSWORD="${DB_PASSWORD}"

# Logging setup
LOG_FILE="${LOG_FILE:-/var/log/liquid-abt-backup.log}"
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')
BACKUP_NAME="liquid_abt_backup_${TIMESTAMP}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
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
                \"service\": \"liquid-abt-backup\"
            }" \
            --max-time 10 --silent || warn "Failed to send notification"
    fi
}

# Function to check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if required commands exist
    for cmd in pg_dump aws gzip; do
        if ! command -v "$cmd" &> /dev/null; then
            error "$cmd is not installed or not in PATH"
            return 1
        fi
    done
    
    # Check PostgreSQL connection
    if ! PGPASSWORD="$PGPASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" &> /dev/null; then
        error "Cannot connect to PostgreSQL database"
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
    
    # Create backup directory
    mkdir -p "$BACKUP_DIR"
    
    log "Prerequisites check passed"
    return 0
}

# Function to get list of tenant schemas
get_tenant_schemas() {
    log "Retrieving tenant schemas..."
    
    PGPASSWORD="$PGPASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
        "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'tenant_%';" \
        | tr -d ' ' | grep -v '^$' || echo ""
}

# Function to backup master schema
backup_master_schema() {
    log "Backing up master schema..."
    
    local backup_file="${BACKUP_DIR}/${BACKUP_NAME}_master.sql"
    
    PGPASSWORD="$PGPASSWORD" pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --schema=public \
        --format=custom \
        --compress=9 \
        --verbose \
        --file="$backup_file" 2>&1 | tee -a "$LOG_FILE"
    
    if [[ ${PIPESTATUS[0]} -eq 0 ]]; then
        local file_size=$(du -h "$backup_file" | cut -f1)
        log "Master schema backup completed: $backup_file ($file_size)"
        echo "$backup_file"
        return 0
    else
        error "Master schema backup failed"
        return 1
    fi
}

# Function to backup tenant schemas
backup_tenant_schemas() {
    local tenant_schemas="$1"
    local backup_files=()
    
    if [[ -z "$tenant_schemas" ]]; then
        warn "No tenant schemas found"
        return 0
    fi
    
    log "Backing up tenant schemas..."
    
    while IFS= read -r schema; do
        [[ -z "$schema" ]] && continue
        
        log "Backing up schema: $schema"
        local backup_file="${BACKUP_DIR}/${BACKUP_NAME}_${schema}.sql"
        
        PGPASSWORD="$PGPASSWORD" pg_dump \
            -h "$DB_HOST" \
            -p "$DB_PORT" \
            -U "$DB_USER" \
            -d "$DB_NAME" \
            --schema="$schema" \
            --format=custom \
            --compress=9 \
            --verbose \
            --file="$backup_file" 2>&1 | tee -a "$LOG_FILE"
        
        if [[ ${PIPESTATUS[0]} -eq 0 ]]; then
            local file_size=$(du -h "$backup_file" | cut -f1)
            log "Schema $schema backup completed: $backup_file ($file_size)"
            backup_files+=("$backup_file")
        else
            error "Schema $schema backup failed"
            return 1
        fi
        
    done <<< "$tenant_schemas"
    
    printf '%s\n' "${backup_files[@]}"
    return 0
}

# Function to create backup manifest
create_backup_manifest() {
    local backup_files=("$@")
    local manifest_file="${BACKUP_DIR}/${BACKUP_NAME}_manifest.json"
    
    log "Creating backup manifest..."
    
    cat > "$manifest_file" << EOF
{
    "backup_name": "$BACKUP_NAME",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "database": {
        "host": "$DB_HOST",
        "port": $DB_PORT,
        "name": "$DB_NAME"
    },
    "files": [
EOF
    
    local first=true
    for file in "${backup_files[@]}"; do
        [[ "$first" = true ]] && first=false || echo "," >> "$manifest_file"
        local filename=$(basename "$file")
        local filesize=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "0")
        local checksum=$(sha256sum "$file" | cut -d' ' -f1 2>/dev/null || shasum -a 256 "$file" | cut -d' ' -f1)
        
        cat >> "$manifest_file" << EOF
        {
            "filename": "$filename",
            "path": "$file",
            "size_bytes": $filesize,
            "sha256": "$checksum"
        }
EOF
    done
    
    cat >> "$manifest_file" << EOF
    ],
    "total_files": ${#backup_files[@]},
    "total_size_bytes": $(du -sb "$BACKUP_DIR/${BACKUP_NAME}"* | awk '{sum+=$1} END {print sum}')
}
EOF
    
    log "Backup manifest created: $manifest_file"
    echo "$manifest_file"
}

# Function to upload backups to S3
upload_to_s3() {
    local backup_files=("$@")
    local uploaded_files=()
    
    log "Uploading backups to S3 bucket: $S3_BUCKET"
    
    for file in "${backup_files[@]}"; do
        local filename=$(basename "$file")
        local s3_key="backups/$(date +%Y)/$(date +%m)/$(date +%d)/$filename"
        
        log "Uploading: $filename -> s3://$S3_BUCKET/$s3_key"
        
        if aws s3 cp "$file" "s3://$S3_BUCKET/$s3_key" \
            --metadata "backup-timestamp=$TIMESTAMP,database=$DB_NAME,host=$DB_HOST" \
            --storage-class STANDARD_IA; then
            uploaded_files+=("s3://$S3_BUCKET/$s3_key")
            log "Upload completed: $filename"
        else
            error "Upload failed: $filename"
            return 1
        fi
    done
    
    printf '%s\n' "${uploaded_files[@]}"
    return 0
}

# Function to cleanup old backups
cleanup_old_backups() {
    log "Cleaning up backups older than $RETENTION_DAYS days..."
    
    # Local cleanup
    find "$BACKUP_DIR" -name "liquid_abt_backup_*" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null || true
    
    # S3 cleanup (use lifecycle policy is recommended, but manual cleanup as backup)
    local cutoff_date=$(date -d "$RETENTION_DAYS days ago" +%Y-%m-%d 2>/dev/null || date -v-${RETENTION_DAYS}d +%Y-%m-%d)
    
    aws s3api list-objects-v2 \
        --bucket "$S3_BUCKET" \
        --prefix "backups/" \
        --query "Contents[?LastModified<='$cutoff_date'].Key" \
        --output text 2>/dev/null | \
    while read -r key; do
        [[ -n "$key" && "$key" != "None" ]] && aws s3 rm "s3://$S3_BUCKET/$key" || true
    done
    
    log "Cleanup completed"
}

# Function to verify backup integrity
verify_backup_integrity() {
    local backup_files=("$@")
    
    log "Verifying backup integrity..."
    
    for file in "${backup_files[@]}"; do
        local filename=$(basename "$file")
        
        # Test if the backup file can be read by pg_restore
        if [[ "$filename" == *"manifest.json" ]]; then
            # JSON manifest - check if it's valid JSON
            if jq empty "$file" 2>/dev/null; then
                log "Manifest file is valid JSON: $filename"
            else
                error "Invalid JSON manifest: $filename"
                return 1
            fi
        else
            # PostgreSQL backup - check if pg_restore can list contents
            if pg_restore --list "$file" &>/dev/null; then
                log "Backup file integrity verified: $filename"
            else
                error "Backup file integrity check failed: $filename"
                return 1
            fi
        fi
    done
    
    log "All backup files passed integrity verification"
    return 0
}

# Main backup function
main() {
    local start_time=$(date +%s)
    
    log "Starting LIQUID ABT database backup process"
    log "Backup name: $BACKUP_NAME"
    
    # Check prerequisites
    if ! check_prerequisites; then
        error "Prerequisites check failed"
        send_notification "error" "Backup failed: Prerequisites check failed"
        exit 1
    fi
    
    # Get tenant schemas
    local tenant_schemas
    tenant_schemas=$(get_tenant_schemas)
    local tenant_count=$(echo "$tenant_schemas" | wc -l | tr -d ' ')
    log "Found $tenant_count tenant schemas"
    
    # Backup master schema
    local master_backup
    if ! master_backup=$(backup_master_schema); then
        error "Master schema backup failed"
        send_notification "error" "Backup failed: Master schema backup failed"
        exit 1
    fi
    
    # Backup tenant schemas
    local tenant_backups=()
    if [[ -n "$tenant_schemas" ]]; then
        mapfile -t tenant_backups < <(backup_tenant_schemas "$tenant_schemas")
        if [[ ${#tenant_backups[@]} -eq 0 ]]; then
            error "Tenant schema backups failed"
            send_notification "error" "Backup failed: Tenant schema backups failed"
            exit 1
        fi
    fi
    
    # Combine all backup files
    local all_backup_files=("$master_backup" "${tenant_backups[@]}")
    
    # Create manifest
    local manifest_file
    if ! manifest_file=$(create_backup_manifest "${all_backup_files[@]}"); then
        error "Manifest creation failed"
        send_notification "error" "Backup failed: Manifest creation failed"
        exit 1
    fi
    all_backup_files+=("$manifest_file")
    
    # Verify backup integrity
    if ! verify_backup_integrity "${all_backup_files[@]}"; then
        error "Backup integrity verification failed"
        send_notification "error" "Backup failed: Integrity verification failed"
        exit 1
    fi
    
    # Upload to S3
    local s3_files
    if ! mapfile -t s3_files < <(upload_to_s3 "${all_backup_files[@]}"); then
        error "S3 upload failed"
        send_notification "error" "Backup failed: S3 upload failed"
        exit 1
    fi
    
    # Cleanup old backups
    cleanup_old_backups
    
    # Calculate duration and file sizes
    local end_time=$(date +%s)
    local duration=$((end_time - start_time))
    local total_size=$(du -sh "$BACKUP_DIR/${BACKUP_NAME}"* | awk '{sum+=$1} END {print $1}')
    
    log "Backup completed successfully!"
    log "Duration: ${duration}s"
    log "Total files: ${#all_backup_files[@]}"
    log "Total size: $total_size"
    log "S3 locations:"
    printf '  %s\n' "${s3_files[@]}" | tee -a "$LOG_FILE"
    
    # Send success notification
    local success_details=$(cat << EOF
Duration: ${duration}s
Files: ${#all_backup_files[@]}
Size: $total_size
Tenant schemas: $tenant_count
S3 bucket: $S3_BUCKET
EOF
)
    
    send_notification "success" "Database backup completed successfully" "$success_details"
    
    # Clean up local files (keep manifest for reference)
    for file in "${all_backup_files[@]}"; do
        [[ "$file" != *"manifest.json" ]] && rm -f "$file"
    done
    
    log "Local backup files cleaned up (manifest retained)"
    exit 0
}

# Handle script termination
cleanup_on_exit() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        error "Backup process terminated with exit code $exit_code"
        send_notification "error" "Backup process terminated unexpectedly" "Exit code: $exit_code"
        
        # Clean up partial backup files
        rm -f "${BACKUP_DIR}/${BACKUP_NAME}"* 2>/dev/null || true
    fi
}

trap cleanup_on_exit EXIT

# Run main function if script is executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi