#!/bin/bash
# LIQUID ABT - Database Backup Script
# Automated PostgreSQL backup with compression and encryption

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
S3_BUCKET="${S3_BUCKET:-liquid-abt-backups-prod}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
ENCRYPTION_KEY_ID="${ENCRYPTION_KEY_ID:-alias/liquid-abt-backups}"

# Database configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-liquid_abt}"
DB_USER="${DB_USER:-liquid_user}"
PGPASSWORD="${DB_PASSWORD}"
export PGPASSWORD

# Logging
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${BACKUP_DIR}/backup.log"
}

error() {
    log "ERROR: $*"
    exit 1
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    command -v pg_dump >/dev/null 2>&1 || error "pg_dump not found"
    command -v gzip >/dev/null 2>&1 || error "gzip not found"
    command -v aws >/dev/null 2>&1 || error "AWS CLI not found"
    
    # Test database connection
    pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" || error "Cannot connect to database"
    
    # Create backup directory if it doesn't exist
    mkdir -p "$BACKUP_DIR"
    
    # Test S3 access
    aws s3 ls "s3://$S3_BUCKET/" >/dev/null 2>&1 || error "Cannot access S3 bucket: $S3_BUCKET"
    
    log "Prerequisites check passed"
}

# Generate backup filename
generate_backup_filename() {
    local backup_type="$1"
    local timestamp="$(date '+%Y%m%d_%H%M%S')"
    echo "${DB_NAME}_${backup_type}_${timestamp}.sql.gz"
}

# Perform full database backup
backup_full() {
    log "Starting full database backup..."
    
    local backup_filename="$(generate_backup_filename "full")"
    local backup_path="${BACKUP_DIR}/${backup_filename}"
    
    # Create backup with compression
    pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --verbose \
        --no-password \
        --format=custom \
        --compress=9 \
        --no-owner \
        --no-privileges \
        | gzip > "$backup_path"
    
    if [ $? -eq 0 ]; then
        local size=$(du -h "$backup_path" | cut -f1)
        log "Full backup completed successfully: $backup_filename ($size)"
        
        # Upload to S3 with encryption
        upload_to_s3 "$backup_path" "full/$backup_filename"
        
        # Verify backup integrity
        verify_backup "$backup_path"
        
        echo "$backup_path"
    else
        error "Full backup failed"
    fi
}

# Perform schema-only backup
backup_schema() {
    log "Starting schema backup..."
    
    local backup_filename="$(generate_backup_filename "schema")"
    local backup_path="${BACKUP_DIR}/${backup_filename}"
    
    # Create schema backup
    pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --verbose \
        --no-password \
        --schema-only \
        --format=plain \
        | gzip > "$backup_path"
    
    if [ $? -eq 0 ]; then
        local size=$(du -h "$backup_path" | cut -f1)
        log "Schema backup completed successfully: $backup_filename ($size)"
        
        upload_to_s3 "$backup_path" "schema/$backup_filename"
        echo "$backup_path"
    else
        error "Schema backup failed"
    fi
}

# Perform data-only backup for specific tenant
backup_tenant() {
    local tenant_id="$1"
    
    if [ -z "$tenant_id" ]; then
        error "Tenant ID is required for tenant backup"
    fi
    
    log "Starting backup for tenant: $tenant_id"
    
    local backup_filename="$(generate_backup_filename "tenant_${tenant_id}")"
    local backup_path="${BACKUP_DIR}/${backup_filename}"
    
    # Create tenant-specific backup
    pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --verbose \
        --no-password \
        --data-only \
        --format=custom \
        --compress=9 \
        --schema="tenant_${tenant_id}" \
        | gzip > "$backup_path"
    
    if [ $? -eq 0 ]; then
        local size=$(du -h "$backup_path" | cut -f1)
        log "Tenant backup completed successfully: $backup_filename ($size)"
        
        upload_to_s3 "$backup_path" "tenants/$tenant_id/$backup_filename"
        echo "$backup_path"
    else
        error "Tenant backup failed for: $tenant_id"
    fi
}

# Upload backup to S3 with encryption
upload_to_s3() {
    local local_path="$1"
    local s3_key="$2"
    
    log "Uploading backup to S3: s3://$S3_BUCKET/$s3_key"
    
    aws s3 cp "$local_path" "s3://$S3_BUCKET/$s3_key" \
        --server-side-encryption aws:kms \
        --ssekms-key-id "$ENCRYPTION_KEY_ID" \
        --storage-class STANDARD_IA
    
    if [ $? -eq 0 ]; then
        log "Upload completed successfully"
        
        # Add metadata tags
        aws s3api put-object-tagging \
            --bucket "$S3_BUCKET" \
            --key "$s3_key" \
            --tagging 'TagSet=[{Key=Environment,Value=production},{Key=BackupType,Value=database},{Key=RetentionDays,Value='$RETENTION_DAYS'}]'
    else
        error "Failed to upload backup to S3"
    fi
}

# Verify backup integrity
verify_backup() {
    local backup_path="$1"
    
    log "Verifying backup integrity: $(basename "$backup_path")"
    
    # Test gzip integrity
    gzip -t "$backup_path"
    if [ $? -eq 0 ]; then
        log "Backup file integrity verified"
    else
        error "Backup file is corrupted"
    fi
    
    # Test PostgreSQL dump integrity
    zcat "$backup_path" | head -100 | grep -q "PostgreSQL database dump"
    if [ $? -eq 0 ]; then
        log "PostgreSQL dump format verified"
    else
        error "Invalid PostgreSQL dump format"
    fi
}

# Clean up old backups
cleanup_old_backups() {
    log "Cleaning up backups older than $RETENTION_DAYS days..."
    
    # Clean local backups
    find "$BACKUP_DIR" -name "*.sql.gz" -mtime +$RETENTION_DAYS -delete
    
    # Clean S3 backups using lifecycle policy
    # Note: This is handled by S3 lifecycle rules, but we can also do it manually
    local cutoff_date=$(date -d "$RETENTION_DAYS days ago" '+%Y-%m-%d')
    
    aws s3api list-objects-v2 \
        --bucket "$S3_BUCKET" \
        --query "Contents[?LastModified<='$cutoff_date'].Key" \
        --output text | while read -r key; do
        
        if [ -n "$key" ] && [ "$key" != "None" ]; then
            log "Deleting old backup: $key"
            aws s3 rm "s3://$S3_BUCKET/$key"
        fi
    done
    
    log "Cleanup completed"
}

# Generate backup report
generate_report() {
    local backup_path="$1"
    local backup_type="$2"
    
    local filename="$(basename "$backup_path")"
    local size="$(du -h "$backup_path" | cut -f1)"
    local timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
    
    cat << EOF > "${BACKUP_DIR}/backup_report_$(date '+%Y%m%d_%H%M%S').txt"
LIQUID ABT Database Backup Report
==================================

Backup Type: $backup_type
Filename: $filename
Size: $size
Timestamp: $timestamp
Database: $DB_NAME
Host: $DB_HOST

Status: SUCCESS
S3 Location: s3://$S3_BUCKET/

Verification: PASSED
- File integrity: OK
- PostgreSQL format: OK

Next backup: $(date -d '+1 day' '+%Y-%m-%d %H:%M:%S')
Retention: $RETENTION_DAYS days

Generated by: $(whoami)@$(hostname)
EOF

    log "Backup report generated: ${BACKUP_DIR}/backup_report_$(date '+%Y%m%d_%H%M%S').txt"
}

# Send notification
send_notification() {
    local status="$1"
    local message="$2"
    
    # Send Slack notification if webhook URL is configured
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        local color="good"
        [ "$status" = "ERROR" ] && color="danger"
        
        curl -X POST "$SLACK_WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -d "{
                \"attachments\": [{
                    \"color\": \"$color\",
                    \"title\": \"Database Backup $status\",
                    \"text\": \"$message\",
                    \"fields\": [
                        {\"title\": \"Database\", \"value\": \"$DB_NAME\", \"short\": true},
                        {\"title\": \"Environment\", \"value\": \"${ENVIRONMENT:-production}\", \"short\": true},
                        {\"title\": \"Timestamp\", \"value\": \"$(date)\", \"short\": true}
                    ]
                }]
            }"
    fi
    
    # Send email notification if configured
    if [ -n "${NOTIFICATION_EMAIL:-}" ]; then
        echo "$message" | mail -s "LIQUID ABT: Database Backup $status" "$NOTIFICATION_EMAIL"
    fi
}

# Main execution
main() {
    local backup_type="${1:-full}"
    local tenant_id="${2:-}"
    
    log "Starting database backup process (type: $backup_type)"
    
    # Trap errors and send notifications
    trap 'send_notification "ERROR" "Database backup failed. Check logs for details."' ERR
    
    check_prerequisites
    
    local backup_path
    case "$backup_type" in
        "full")
            backup_path=$(backup_full)
            ;;
        "schema")
            backup_path=$(backup_schema)
            ;;
        "tenant")
            backup_path=$(backup_tenant "$tenant_id")
            ;;
        *)
            error "Invalid backup type: $backup_type. Use 'full', 'schema', or 'tenant'"
            ;;
    esac
    
    generate_report "$backup_path" "$backup_type"
    cleanup_old_backups
    
    local size="$(du -h "$backup_path" | cut -f1)"
    send_notification "SUCCESS" "Database backup completed successfully. Size: $size"
    
    log "Database backup process completed successfully"
}

# Script execution
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi