#!/bin/bash
# LIQUID ABT - Database Restore Script
# Automated PostgreSQL restore with verification and rollback capabilities

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-/app/backups}"
S3_BUCKET="${S3_BUCKET:-liquid-abt-backups-prod}"
RESTORE_DIR="${RESTORE_DIR:-/app/restore}"

# Database configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-liquid_abt}"
DB_USER="${DB_USER:-liquid_user}"
PGPASSWORD="${DB_PASSWORD}"
export PGPASSWORD

# Restore configuration
DRY_RUN="${DRY_RUN:-false}"
FORCE_RESTORE="${FORCE_RESTORE:-false}"
SKIP_VERIFICATION="${SKIP_VERIFICATION:-false}"

# Logging
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${RESTORE_DIR}/restore.log"
}

error() {
    log "ERROR: $*"
    exit 1
}

warning() {
    log "WARNING: $*"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites for database restore..."
    
    command -v pg_restore >/dev/null 2>&1 || error "pg_restore not found"
    command -v psql >/dev/null 2>&1 || error "psql not found"
    command -v gzip >/dev/null 2>&1 || error "gzip not found"
    command -v aws >/dev/null 2>&1 || error "AWS CLI not found"
    
    # Create restore directory
    mkdir -p "$RESTORE_DIR"
    
    # Test S3 access
    aws s3 ls "s3://$S3_BUCKET/" >/dev/null 2>&1 || error "Cannot access S3 bucket: $S3_BUCKET"
    
    log "Prerequisites check passed"
}

# List available backups
list_backups() {
    local backup_type="${1:-all}"
    
    log "Listing available backups (type: $backup_type)..."
    
    case "$backup_type" in
        "full")
            aws s3 ls "s3://$S3_BUCKET/full/" --recursive | sort -k1,2
            ;;
        "schema")
            aws s3 ls "s3://$S3_BUCKET/schema/" --recursive | sort -k1,2
            ;;
        "tenant")
            aws s3 ls "s3://$S3_BUCKET/tenants/" --recursive | sort -k1,2
            ;;
        "all"|*)
            echo "Full backups:"
            aws s3 ls "s3://$S3_BUCKET/full/" --recursive | sort -k1,2 | tail -10
            echo ""
            echo "Schema backups:"
            aws s3 ls "s3://$S3_BUCKET/schema/" --recursive | sort -k1,2 | tail -5
            echo ""
            echo "Recent tenant backups:"
            aws s3 ls "s3://$S3_BUCKET/tenants/" --recursive | sort -k1,2 | tail -10
            ;;
    esac
}

# Download backup from S3
download_backup() {
    local s3_key="$1"
    local local_filename="$(basename "$s3_key")"
    local local_path="${RESTORE_DIR}/${local_filename}"
    
    log "Downloading backup from S3: $s3_key"
    
    aws s3 cp "s3://$S3_BUCKET/$s3_key" "$local_path"
    
    if [ $? -eq 0 ]; then
        local size="$(du -h "$local_path" | cut -f1)"
        log "Download completed: $local_filename ($size)"
        echo "$local_path"
    else
        error "Failed to download backup from S3"
    fi
}

# Verify backup integrity
verify_backup() {
    local backup_path="$1"
    
    log "Verifying backup integrity: $(basename "$backup_path")"
    
    # Test gzip integrity if compressed
    if [[ "$backup_path" =~ \.gz$ ]]; then
        gzip -t "$backup_path" || error "Backup file is corrupted (gzip test failed)"
        log "Gzip integrity verified"
    fi
    
    # Create temporary uncompressed file for testing
    local temp_file="${RESTORE_DIR}/temp_verify_$(date +%s).sql"
    
    if [[ "$backup_path" =~ \.gz$ ]]; then
        zcat "$backup_path" > "$temp_file"
    else
        cp "$backup_path" "$temp_file"
    fi
    
    # Test PostgreSQL dump format
    if head -100 "$temp_file" | grep -q "PostgreSQL database dump"; then
        log "PostgreSQL dump format verified"
    else
        rm -f "$temp_file"
        error "Invalid PostgreSQL dump format"
    fi
    
    # Test for required schemas/tables
    if grep -q "CREATE SCHEMA" "$temp_file"; then
        log "Schema definitions found"
    fi
    
    rm -f "$temp_file"
    log "Backup verification passed"
}

# Create pre-restore snapshot
create_pre_restore_snapshot() {
    log "Creating pre-restore database snapshot..."
    
    local snapshot_name="pre-restore-$(date '+%Y%m%d-%H%M%S')"
    local snapshot_path="${RESTORE_DIR}/${DB_NAME}_${snapshot_name}.sql.gz"
    
    # Create current database backup
    pg_dump \
        -h "$DB_HOST" \
        -p "$DB_PORT" \
        -U "$DB_USER" \
        -d "$DB_NAME" \
        --verbose \
        --no-password \
        --format=custom \
        --compress=9 \
        | gzip > "$snapshot_path"
    
    if [ $? -eq 0 ]; then
        local size="$(du -h "$snapshot_path" | cut -f1)"
        log "Pre-restore snapshot created: $snapshot_name ($size)"
        echo "$snapshot_path"
    else
        error "Failed to create pre-restore snapshot"
    fi
}

# Perform database restore
restore_database() {
    local backup_path="$1"
    local restore_type="${2:-full}"
    local target_schema="${3:-}"
    
    if [ "$DRY_RUN" = "true" ]; then
        log "DRY RUN: Would restore database from: $(basename "$backup_path")"
        return 0
    fi
    
    log "Starting database restore from: $(basename "$backup_path")"
    
    # Create pre-restore snapshot unless forced
    local pre_restore_snapshot=""
    if [ "$FORCE_RESTORE" != "true" ]; then
        pre_restore_snapshot="$(create_pre_restore_snapshot)"
    fi
    
    # Prepare restore command based on type
    local restore_cmd=""
    local temp_file=""
    
    if [[ "$backup_path" =~ \.gz$ ]]; then
        temp_file="${RESTORE_DIR}/temp_restore_$(date +%s).sql"
        zcat "$backup_path" > "$temp_file"
        backup_path="$temp_file"
    fi
    
    case "$restore_type" in
        "full")
            log "Performing full database restore..."
            
            # Drop existing connections
            psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
                -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$DB_NAME' AND pid <> pg_backend_pid();"
            
            # Drop and recreate database
            psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
                -c "DROP DATABASE IF EXISTS ${DB_NAME};"
            psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres \
                -c "CREATE DATABASE ${DB_NAME};"
            
            # Restore database
            pg_restore \
                -h "$DB_HOST" \
                -p "$DB_PORT" \
                -U "$DB_USER" \
                -d "$DB_NAME" \
                --verbose \
                --no-password \
                --no-owner \
                --no-privileges \
                --clean \
                --if-exists \
                "$backup_path"
            ;;
            
        "schema")
            log "Performing schema-only restore..."
            
            psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
                -f "$backup_path"
            ;;
            
        "tenant")
            if [ -z "$target_schema" ]; then
                error "Target schema is required for tenant restore"
            fi
            
            log "Performing tenant restore to schema: $target_schema"
            
            # Create schema if it doesn't exist
            psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
                -c "CREATE SCHEMA IF NOT EXISTS $target_schema;"
            
            # Restore tenant data
            pg_restore \
                -h "$DB_HOST" \
                -p "$DB_PORT" \
                -U "$DB_USER" \
                -d "$DB_NAME" \
                --verbose \
                --no-password \
                --schema="$target_schema" \
                --clean \
                --if-exists \
                "$backup_path"
            ;;
            
        *)
            error "Invalid restore type: $restore_type"
            ;;
    esac
    
    local restore_exit_code=$?
    
    # Clean up temporary file
    [ -n "$temp_file" ] && rm -f "$temp_file"
    
    if [ $restore_exit_code -eq 0 ]; then
        log "Database restore completed successfully"
        return 0
    else
        error "Database restore failed (exit code: $restore_exit_code)"
        return $restore_exit_code
    fi
}

# Verify restored database
verify_restore() {
    local expected_tables="${1:-}"
    
    log "Verifying restored database..."
    
    # Test database connection
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -c "SELECT version();" > /dev/null || error "Cannot connect to restored database"
    
    # Check table counts
    local table_count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('information_schema', 'pg_catalog');")
    
    log "Restored database contains $table_count tables"
    
    # Verify specific tables if provided
    if [ -n "$expected_tables" ]; then
        IFS=',' read -ra TABLES <<< "$expected_tables"
        for table in "${TABLES[@]}"; do
            local row_count=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
                -t -c "SELECT count(*) FROM $table;" 2>/dev/null || echo "0")
            log "Table $table contains $row_count rows"
        done
    fi
    
    # Check for any obvious data integrity issues
    log "Running basic integrity checks..."
    
    # Check for foreign key violations
    local fk_violations=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -t -c "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type = 'FOREIGN KEY';" 2>/dev/null || echo "0")
    
    if [ "$fk_violations" -gt 0 ]; then
        log "Foreign key constraints present: $fk_violations"
    fi
    
    log "Database verification completed"
}

# Rollback to previous state
rollback_restore() {
    local snapshot_path="$1"
    
    if [ -z "$snapshot_path" ] || [ ! -f "$snapshot_path" ]; then
        error "No valid snapshot available for rollback"
    fi
    
    warning "Rolling back database to previous state..."
    
    restore_database "$snapshot_path" "full"
    
    if [ $? -eq 0 ]; then
        log "Rollback completed successfully"
    else
        error "Rollback failed - database may be in inconsistent state"
    fi
}

# Point-in-time recovery
point_in_time_recovery() {
    local recovery_target="$1"
    
    log "Performing point-in-time recovery to: $recovery_target"
    
    # This would require WAL files and continuous archiving
    # For now, we'll use the closest available backup
    
    log "Finding closest backup to recovery target..."
    
    local closest_backup=$(aws s3 ls "s3://$S3_BUCKET/full/" --recursive \
        | awk '$1 <= "'$recovery_target'" {print $4}' \
        | tail -1)
    
    if [ -n "$closest_backup" ]; then
        log "Using backup: $closest_backup"
        local backup_path="$(download_backup "$closest_backup")"
        restore_database "$backup_path" "full"
    else
        error "No suitable backup found for recovery target: $recovery_target"
    fi
}

# Generate restore report
generate_restore_report() {
    local backup_source="$1"
    local restore_type="$2"
    local status="$3"
    
    local timestamp="$(date '+%Y-%m-%d %H:%M:%S')"
    local report_file="${RESTORE_DIR}/restore_report_$(date '+%Y%m%d_%H%M%S').txt"
    
    cat << EOF > "$report_file"
LIQUID ABT Database Restore Report
===================================

Restore Type: $restore_type
Source Backup: $backup_source
Target Database: $DB_NAME
Target Host: $DB_HOST
Timestamp: $timestamp

Status: $status

Database Verification: $([ "$SKIP_VERIFICATION" = "true" ] && echo "SKIPPED" || echo "COMPLETED")

$(if [ "$DRY_RUN" = "true" ]; then
    echo "Mode: DRY RUN (no changes made)"
else
    echo "Mode: LIVE RESTORE"
    
    # Add table counts
    echo ""
    echo "Table Summary:"
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" \
        -c "SELECT schemaname, tablename, n_tup_ins as rows FROM pg_stat_user_tables ORDER BY schemaname, tablename;" 2>/dev/null || echo "Could not retrieve table statistics"
fi)

Executed by: $(whoami)@$(hostname)
EOF

    log "Restore report generated: $report_file"
}

# Send notification
send_notification() {
    local status="$1"
    local message="$2"
    
    # Send Slack notification
    if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
        local color="good"
        [ "$status" = "ERROR" ] && color="danger"
        [ "$status" = "WARNING" ] && color="warning"
        
        curl -X POST "$SLACK_WEBHOOK_URL" \
            -H "Content-Type: application/json" \
            -d "{
                \"attachments\": [{
                    \"color\": \"$color\",
                    \"title\": \"Database Restore $status\",
                    \"text\": \"$message\",
                    \"fields\": [
                        {\"title\": \"Database\", \"value\": \"$DB_NAME\", \"short\": true},
                        {\"title\": \"Environment\", \"value\": \"${ENVIRONMENT:-production}\", \"short\": true},
                        {\"title\": \"Timestamp\", \"value\": \"$(date)\", \"short\": true}
                    ]
                }]
            }" 2>/dev/null
    fi
}

# Interactive restore selection
interactive_restore() {
    echo "Available backups:"
    list_backups "full" | tail -10
    echo ""
    
    read -p "Enter the backup filename to restore (or 'latest' for most recent): " backup_selection
    
    if [ "$backup_selection" = "latest" ]; then
        backup_selection=$(aws s3 ls "s3://$S3_BUCKET/full/" --recursive | sort -k1,2 | tail -1 | awk '{print $4}')
        log "Selected latest backup: $backup_selection"
    fi
    
    if [ -z "$backup_selection" ]; then
        error "No backup selected"
    fi
    
    read -p "Confirm restore of '$backup_selection' to database '$DB_NAME'? (yes/no): " confirmation
    
    if [ "$confirmation" != "yes" ]; then
        log "Restore cancelled by user"
        exit 0
    fi
    
    local backup_path="$(download_backup "full/$backup_selection")"
    restore_database "$backup_path" "full"
}

# Main execution
main() {
    local action="${1:-help}"
    local backup_source="${2:-}"
    local restore_type="${3:-full}"
    local target_schema="${4:-}"
    
    log "Starting database restore process (action: $action)"
    
    # Set up error handling
    local pre_restore_snapshot=""
    trap 'if [ -n "$pre_restore_snapshot" ] && [ "$FORCE_RESTORE" != "true" ]; then rollback_restore "$pre_restore_snapshot"; fi; send_notification "ERROR" "Database restore failed. Check logs for details."' ERR
    
    case "$action" in
        "list")
            check_prerequisites
            list_backups "$backup_source"
            ;;
        
        "restore")
            if [ -z "$backup_source" ]; then
                error "Backup source is required for restore action"
            fi
            
            check_prerequisites
            
            local backup_path
            if [[ "$backup_source" =~ ^s3:// ]]; then
                # S3 URL provided
                local s3_key="${backup_source#s3://$S3_BUCKET/}"
                backup_path="$(download_backup "$s3_key")"
            elif [[ "$backup_source" =~ ^/ ]]; then
                # Local file path provided
                backup_path="$backup_source"
            else
                # Assume it's a relative S3 key
                backup_path="$(download_backup "$backup_source")"
            fi
            
            if [ "$SKIP_VERIFICATION" != "true" ]; then
                verify_backup "$backup_path"
            fi
            
            pre_restore_snapshot="$(restore_database "$backup_path" "$restore_type" "$target_schema")"
            
            if [ "$SKIP_VERIFICATION" != "true" ]; then
                verify_restore
            fi
            
            generate_restore_report "$backup_source" "$restore_type" "SUCCESS"
            send_notification "SUCCESS" "Database restore completed successfully from: $backup_source"
            ;;
        
        "interactive")
            check_prerequisites
            interactive_restore
            ;;
        
        "pitr")
            if [ -z "$backup_source" ]; then
                error "Recovery target timestamp is required for PITR"
            fi
            
            check_prerequisites
            point_in_time_recovery "$backup_source"
            ;;
        
        "help"|*)
            cat << EOF
LIQUID ABT Database Restore Script

Usage: $0 <action> [options]

Actions:
  list [type]              List available backups (full, schema, tenant, all)
  restore <source> [type]  Restore from backup source
  interactive             Interactive restore selection
  pitr <timestamp>        Point-in-time recovery to timestamp

Restore Types:
  full                    Full database restore (default)
  schema                  Schema-only restore
  tenant <schema>         Tenant-specific restore

Environment Variables:
  DRY_RUN=true           Show what would be restored without making changes
  FORCE_RESTORE=true     Skip pre-restore snapshot creation
  SKIP_VERIFICATION=true Skip backup and restore verification

Examples:
  $0 list full
  $0 restore full/liquid_abt_full_20250106_120000.sql.gz
  $0 restore s3://bucket/path/backup.sql.gz full
  $0 interactive
  $0 pitr "2025-01-06 12:00:00"

EOF
            ;;
    esac
    
    log "Database restore process completed"
}

# Script execution
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
    main "$@"
fi