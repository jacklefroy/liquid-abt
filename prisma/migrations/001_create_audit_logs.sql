-- LIQUID ABT - Audit Trail Database Schema
-- Immutable audit logging table with integrity hashing

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(255) PRIMARY KEY,
    tenant_id VARCHAR(255),                    -- Which tenant (null for system-wide)
    user_id VARCHAR(255),                      -- Who performed the action  
    session_id VARCHAR(255),                   -- Session identifier
    event_type VARCHAR(50) NOT NULL,           -- Type of event (create, read, update, delete, etc.)
    resource_type VARCHAR(100) NOT NULL,       -- What was acted upon (table/entity name)
    resource_id VARCHAR(255),                  -- Specific record ID
    action TEXT NOT NULL,                      -- Detailed action description
    old_values JSONB,                         -- Previous values (for updates)
    new_values JSONB,                         -- New values (for creates/updates)
    metadata JSONB,                           -- Additional context
    ip_address INET,                          -- Source IP address
    user_agent TEXT,                          -- User agent string
    severity VARCHAR(20) NOT NULL DEFAULT 'info', -- Event severity (info, warning, error, critical)
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- When it happened
    hash VARCHAR(64) NOT NULL,                -- SHA-256 integrity hash
    previous_hash VARCHAR(64),                -- Hash of previous audit record (blockchain-like)
    correlation_id VARCHAR(255),              -- Request correlation ID
    compliance_relevant BOOLEAN NOT NULL DEFAULT FALSE -- Flag for compliance-related events
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_event_type ON audit_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type ON audit_logs(resource_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_id ON audit_logs(resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_severity ON audit_logs(severity);
CREATE INDEX IF NOT EXISTS idx_audit_logs_compliance ON audit_logs(compliance_relevant) WHERE compliance_relevant = true;
CREATE INDEX IF NOT EXISTS idx_audit_logs_correlation_id ON audit_logs(correlation_id);

-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_timestamp ON audit_logs(tenant_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_timestamp ON audit_logs(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_timestamp ON audit_logs(resource_type, resource_id, timestamp DESC);

-- Partial index for recent records (performance optimization)
CREATE INDEX IF NOT EXISTS idx_audit_logs_recent ON audit_logs(timestamp DESC) 
  WHERE timestamp > (NOW() - INTERVAL '30 days');

-- Create function to prevent audit log modifications
CREATE OR REPLACE FUNCTION prevent_audit_log_modifications()
RETURNS TRIGGER AS $$
BEGIN
    -- Prevent all UPDATE and DELETE operations on audit_logs
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'Audit logs are immutable and cannot be updated';
    END IF;
    
    IF TG_OP = 'DELETE' THEN
        -- Only allow deletion for data retention policies (system user)
        IF current_user != 'liquid_system' THEN
            RAISE EXCEPTION 'Audit logs can only be deleted by system retention policies';
        END IF;
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to enforce immutability
CREATE TRIGGER prevent_audit_log_modifications_trigger
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION prevent_audit_log_modifications();

-- Create function to auto-generate hash
CREATE OR REPLACE FUNCTION generate_audit_hash()
RETURNS TRIGGER AS $$
BEGIN
    -- Auto-generate hash if not provided
    IF NEW.hash IS NULL OR NEW.hash = '' THEN
        NEW.hash = encode(
            sha256(
                COALESCE(NEW.id, '') || '|' ||
                COALESCE(NEW.tenant_id, '') || '|' ||
                COALESCE(NEW.user_id, '') || '|' ||
                NEW.event_type || '|' ||
                NEW.resource_type || '|' ||
                COALESCE(NEW.resource_id, '') || '|' ||
                NEW.action || '|' ||
                COALESCE(NEW.old_values::text, '{}') || '|' ||
                COALESCE(NEW.new_values::text, '{}') || '|' ||
                COALESCE(NEW.metadata::text, '{}') || '|' ||
                NEW.timestamp::text || '|' ||
                COALESCE(NEW.previous_hash, '')
            ), 
            'hex'
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for auto-hash generation
CREATE TRIGGER generate_audit_hash_trigger
    BEFORE INSERT ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION generate_audit_hash();

-- Create audit_log_archives table for long-term storage
CREATE TABLE IF NOT EXISTS audit_log_archives (
    id VARCHAR(255) PRIMARY KEY,
    tenant_id VARCHAR(255),
    user_id VARCHAR(255),
    session_id VARCHAR(255),
    event_type VARCHAR(50) NOT NULL,
    resource_type VARCHAR(100) NOT NULL,
    resource_id VARCHAR(255),
    action TEXT NOT NULL,
    old_values JSONB,
    new_values JSONB,
    metadata JSONB,
    ip_address INET,
    user_agent TEXT,
    severity VARCHAR(20) NOT NULL,
    timestamp TIMESTAMPTZ NOT NULL,
    hash VARCHAR(64) NOT NULL,
    previous_hash VARCHAR(64),
    correlation_id VARCHAR(255),
    compliance_relevant BOOLEAN NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archive_reason TEXT
);

-- Create indexes for archive table
CREATE INDEX IF NOT EXISTS idx_audit_archives_tenant_id ON audit_log_archives(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_archives_timestamp ON audit_log_archives(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_archives_archived_at ON audit_log_archives(archived_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_archives_compliance ON audit_log_archives(compliance_relevant) WHERE compliance_relevant = true;

-- Create view for compliance-relevant audit records
CREATE OR REPLACE VIEW compliance_audit_logs AS
SELECT 
    id,
    tenant_id,
    user_id,
    event_type,
    resource_type,
    resource_id,
    action,
    old_values,
    new_values,
    metadata,
    timestamp,
    hash,
    correlation_id
FROM audit_logs
WHERE compliance_relevant = true
UNION ALL
SELECT 
    id,
    tenant_id,
    user_id,
    event_type,
    resource_type,
    resource_id,
    action,
    old_values,
    new_values,
    metadata,
    timestamp,
    hash,
    correlation_id
FROM audit_log_archives
WHERE compliance_relevant = true
ORDER BY timestamp DESC;

-- Create function for audit log retention policy
CREATE OR REPLACE FUNCTION apply_audit_retention_policy()
RETURNS TABLE(records_archived BIGINT, records_deleted BIGINT) AS $$
DECLARE
    archive_cutoff TIMESTAMPTZ;
    delete_cutoff TIMESTAMPTZ;
    archived_count BIGINT;
    deleted_count BIGINT;
BEGIN
    -- Archive records older than 2 years
    archive_cutoff := NOW() - INTERVAL '2 years';
    
    -- Delete non-compliance records older than 5 years
    delete_cutoff := NOW() - INTERVAL '5 years';
    
    -- Archive old records
    INSERT INTO audit_log_archives (
        id, tenant_id, user_id, session_id, event_type, resource_type,
        resource_id, action, old_values, new_values, metadata, ip_address,
        user_agent, severity, timestamp, hash, previous_hash, correlation_id,
        compliance_relevant, archive_reason
    )
    SELECT 
        id, tenant_id, user_id, session_id, event_type, resource_type,
        resource_id, action, old_values, new_values, metadata, ip_address,
        user_agent, severity, timestamp, hash, previous_hash, correlation_id,
        compliance_relevant, 'Automatic retention policy'
    FROM audit_logs
    WHERE timestamp < archive_cutoff
      AND compliance_relevant = true;
    
    GET DIAGNOSTICS archived_count = ROW_COUNT;
    
    -- Delete old archived records (keep compliance records for 7 years minimum)
    DELETE FROM audit_log_archives
    WHERE timestamp < (NOW() - INTERVAL '7 years')
      AND compliance_relevant = false;
    
    -- Delete old non-compliance records from main table
    DELETE FROM audit_logs
    WHERE timestamp < delete_cutoff
      AND compliance_relevant = false;
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN QUERY SELECT archived_count, deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to verify audit log integrity
CREATE OR REPLACE FUNCTION verify_audit_integrity(record_id VARCHAR(255))
RETURNS TABLE(
    valid BOOLEAN,
    hash_match BOOLEAN,
    chain_valid BOOLEAN,
    details TEXT
) AS $$
DECLARE
    audit_record RECORD;
    calculated_hash VARCHAR(64);
    previous_record_hash VARCHAR(64);
BEGIN
    -- Get the audit record
    SELECT * INTO audit_record FROM audit_logs WHERE id = record_id;
    
    IF NOT FOUND THEN
        RETURN QUERY SELECT false, false, false, 'Audit record not found';
        RETURN;
    END IF;
    
    -- Calculate expected hash
    calculated_hash := encode(
        sha256(
            COALESCE(audit_record.id, '') || '|' ||
            COALESCE(audit_record.tenant_id, '') || '|' ||
            COALESCE(audit_record.user_id, '') || '|' ||
            audit_record.event_type || '|' ||
            audit_record.resource_type || '|' ||
            COALESCE(audit_record.resource_id, '') || '|' ||
            audit_record.action || '|' ||
            COALESCE(audit_record.old_values::text, '{}') || '|' ||
            COALESCE(audit_record.new_values::text, '{}') || '|' ||
            COALESCE(audit_record.metadata::text, '{}') || '|' ||
            audit_record.timestamp::text || '|' ||
            COALESCE(audit_record.previous_hash, '')
        ), 
        'hex'
    );
    
    -- Check hash match
    IF calculated_hash != audit_record.hash THEN
        RETURN QUERY SELECT false, false, false, 'Hash mismatch - record may have been tampered with';
        RETURN;
    END IF;
    
    -- Check chain integrity if previous hash exists
    IF audit_record.previous_hash IS NOT NULL THEN
        SELECT hash INTO previous_record_hash 
        FROM audit_logs 
        WHERE timestamp < audit_record.timestamp
        ORDER BY timestamp DESC 
        LIMIT 1;
        
        IF previous_record_hash != audit_record.previous_hash THEN
            RETURN QUERY SELECT false, true, false, 'Chain integrity broken - previous hash mismatch';
            RETURN;
        END IF;
    END IF;
    
    RETURN QUERY SELECT true, true, true, 'Audit record integrity verified';
END;
$$ LANGUAGE plpgsql;

-- Grant appropriate permissions
GRANT SELECT ON audit_logs TO liquid_readonly;
GRANT SELECT ON audit_log_archives TO liquid_readonly;
GRANT SELECT ON compliance_audit_logs TO liquid_readonly;
GRANT INSERT ON audit_logs TO liquid_app;
GRANT EXECUTE ON FUNCTION apply_audit_retention_policy() TO liquid_system;
GRANT EXECUTE ON FUNCTION verify_audit_integrity(VARCHAR) TO liquid_readonly;

-- Create notification for audit log tampering attempts
CREATE OR REPLACE FUNCTION audit_tampering_notification()
RETURNS TRIGGER AS $$
BEGIN
    -- Log tampering attempt
    INSERT INTO audit_logs (
        id,
        event_type,
        resource_type,
        action,
        severity,
        metadata,
        user_id,
        ip_address,
        compliance_relevant
    ) VALUES (
        'audit_tamper_' || extract(epoch from now())::bigint || '_' || substr(md5(random()::text), 1, 8),
        'security_violation',
        'audit_logs',
        'Attempted modification of immutable audit log',
        'critical',
        jsonb_build_object(
            'attempted_operation', TG_OP,
            'target_record_id', COALESCE(OLD.id, NEW.id),
            'blocked_at', NOW()
        ),
        current_user,
        inet_client_addr(),
        true
    );
    
    -- Raise exception to block the operation
    IF TG_OP = 'UPDATE' THEN
        RAISE EXCEPTION 'SECURITY VIOLATION: Attempt to modify immutable audit log detected and blocked';
    ELSIF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'SECURITY VIOLATION: Unauthorized attempt to delete audit log detected and blocked';
    END IF;
    
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Apply the security trigger
DROP TRIGGER IF EXISTS audit_tampering_notification_trigger ON audit_logs;
CREATE TRIGGER audit_tampering_notification_trigger
    BEFORE UPDATE OR DELETE ON audit_logs
    FOR EACH ROW
    EXECUTE FUNCTION audit_tampering_notification();

COMMENT ON TABLE audit_logs IS 'Immutable audit trail for all system actions and data access';
COMMENT ON COLUMN audit_logs.hash IS 'SHA-256 hash for record integrity verification';
COMMENT ON COLUMN audit_logs.previous_hash IS 'Hash of previous record for blockchain-like integrity chain';
COMMENT ON COLUMN audit_logs.compliance_relevant IS 'Flag indicating records required for regulatory compliance (7+ year retention)';
COMMENT ON FUNCTION prevent_audit_log_modifications() IS 'Prevents modification of audit logs to ensure immutability';
COMMENT ON FUNCTION verify_audit_integrity(VARCHAR) IS 'Verifies hash and chain integrity of audit records';