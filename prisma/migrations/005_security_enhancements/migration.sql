-- LIQUID ABT Security Enhancements Database Migration
-- Creates tables for: address whitelist, circuit breaker events, token audit, transaction alerts, 2FA settings

-- Bitcoin Address Whitelist Table
CREATE TABLE IF NOT EXISTS whitelist_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  address VARCHAR(100) NOT NULL,
  label VARCHAR(255),
  address_type VARCHAR(20) NOT NULL CHECK (address_type IN ('legacy', 'segwit', 'bech32')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMP WITH TIME ZONE,
  requested_by VARCHAR(255) NOT NULL,
  verification_code VARCHAR(32),
  verification_expiry TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_active_address_per_tenant UNIQUE (tenant_id, address) DEFERRABLE INITIALLY DEFERRED
);

-- Circuit Breaker Events Table
CREATE TABLE IF NOT EXISTS circuit_breaker_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('PRICE_SPIKE', 'PRICE_DROP', 'FLASH_CRASH', 'HIGH_VOLATILITY', 'SOURCE_FAILURE')),
  exchange VARCHAR(50) NOT NULL,
  price_change DECIMAL(10,2),
  price_before DECIMAL(15,2),
  price_after DECIMAL(15,2),
  time_window_minutes INTEGER,
  sources_checked INTEGER,
  sources_failed INTEGER,
  action_taken VARCHAR(100),
  metadata JSONB,
  triggered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE,
  
  INDEX idx_circuit_breaker_events_triggered_at (triggered_at),
  INDEX idx_circuit_breaker_events_event_type (event_type),
  INDEX idx_circuit_breaker_events_exchange (exchange)
);

-- JWT Token Audit Log
CREATE TABLE IF NOT EXISTS token_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  token_id VARCHAR(255) NOT NULL,
  action VARCHAR(20) NOT NULL CHECK (action IN ('issued', 'rotated', 'revoked', 'bulk_revoked')),
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  INDEX idx_token_audit_user_id (user_id),
  INDEX idx_token_audit_created_at (created_at),
  INDEX idx_token_audit_action (action)
);

-- Login Attempts Tracking (for account lockout)
CREATE TABLE IF NOT EXISTS login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier VARCHAR(255) NOT NULL, -- email or IP
  ip_address INET,
  user_agent TEXT,
  attempt_time TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  success BOOLEAN NOT NULL DEFAULT false,
  failure_reason VARCHAR(100),
  metadata JSONB,
  
  INDEX idx_login_attempts_identifier (identifier),
  INDEX idx_login_attempts_ip (ip_address),
  INDEX idx_login_attempts_time (attempt_time),
  INDEX idx_login_attempts_success (success)
);

-- Refresh Tokens (for JWT refresh token system)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  token_family_id UUID,
  generation INTEGER NOT NULL DEFAULT 1,
  device_fingerprint VARCHAR(255),
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  revoked_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  INDEX idx_refresh_tokens_user (user_id),
  INDEX idx_refresh_tokens_tenant (tenant_id),
  INDEX idx_refresh_tokens_hash (token_hash),
  INDEX idx_refresh_tokens_family (token_family_id),
  INDEX idx_refresh_tokens_expires (expires_at)
);

-- User 2FA Secrets (enhanced from existing table)
CREATE TABLE IF NOT EXISTS user_2fa_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  secret TEXT NOT NULL, -- Encrypted TOTP secret
  backup_codes TEXT[], -- Array of backup codes
  sms_phone VARCHAR(20), -- Phone number for SMS 2FA
  sms_verified BOOLEAN DEFAULT false,
  enabled BOOLEAN NOT NULL DEFAULT false,
  method VARCHAR(10) DEFAULT 'totp' CHECK (method IN ('totp', 'sms', 'email')),
  recovery_codes_generated_at TIMESTAMP WITH TIME ZONE,
  last_totp_used TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  CONSTRAINT unique_user_2fa UNIQUE (tenant_id, user_id)
);

-- Transaction Alerts Table
CREATE TABLE IF NOT EXISTS transaction_alerts (
  id VARCHAR(255) PRIMARY KEY,
  tenant_id UUID NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  transaction_id VARCHAR(255) NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'AUD',
  alert_type VARCHAR(30) NOT NULL CHECK (alert_type IN ('large_transaction', 'velocity_anomaly', 'unusual_pattern', 'suspicious_activity')),
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  description TEXT NOT NULL,
  metadata JSONB,
  status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved', 'false_positive')),
  acknowledged_by VARCHAR(255),
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  INDEX idx_transaction_alerts_tenant_user (tenant_id, user_id),
  INDEX idx_transaction_alerts_created_at (created_at),
  INDEX idx_transaction_alerts_severity (severity),
  INDEX idx_transaction_alerts_status (status),
  INDEX idx_transaction_alerts_alert_type (alert_type)
);

-- Two-Factor Authentication Settings Table
CREATE TABLE IF NOT EXISTS user_two_factor_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id VARCHAR(255) NOT NULL UNIQUE,
  secret VARCHAR(255), -- Encrypted TOTP secret
  backup_codes TEXT, -- JSON array of backup codes
  is_enabled BOOLEAN NOT NULL DEFAULT false,
  last_used_backup_code VARCHAR(32),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  enabled_at TIMESTAMP WITH TIME ZONE,
  
  CONSTRAINT unique_user_2fa UNIQUE (tenant_id, user_id)
);

-- Update existing bitcoin_purchases table to include exchange fees if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bitcoin_purchases' AND column_name = 'exchange_fees'
  ) THEN
    ALTER TABLE bitcoin_purchases ADD COLUMN exchange_fees DECIMAL(10,4) DEFAULT 0.0;
  END IF;
END $$;

-- Update existing bitcoin_purchases table to include exchange provider if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'bitcoin_purchases' AND column_name = 'exchange_provider'
  ) THEN
    ALTER TABLE bitcoin_purchases ADD COLUMN exchange_provider VARCHAR(50) DEFAULT 'zerocap';
  END IF;
END $$;

-- Update existing transactions table to include security metadata if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'transactions' AND column_name = 'security_metadata'
  ) THEN
    ALTER TABLE transactions ADD COLUMN security_metadata JSONB;
  END IF;
END $$;

-- Update existing tenants table to include subscription tier if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'tenants' AND column_name = 'subscription_tier'
  ) THEN
    ALTER TABLE tenants ADD COLUMN subscription_tier VARCHAR(20) DEFAULT 'starter' 
    CHECK (subscription_tier IN ('starter', 'growth', 'pro', 'enterprise'));
  END IF;
END $$;

-- Update existing users table for enhanced security if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'password_hash_algorithm'
  ) THEN
    ALTER TABLE users ADD COLUMN password_hash_algorithm VARCHAR(20) DEFAULT 'argon2id';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'account_locked_until'
  ) THEN
    ALTER TABLE users ADD COLUMN account_locked_until TIMESTAMP WITH TIME ZONE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'users' AND column_name = 'failed_login_attempts'
  ) THEN
    ALTER TABLE users ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_whitelist_addresses_tenant_active ON whitelist_addresses (tenant_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_whitelist_addresses_status ON whitelist_addresses (status);
CREATE INDEX IF NOT EXISTS idx_user_2fa_secrets_tenant_user ON user_2fa_secrets (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_2fa_secrets_enabled ON user_2fa_secrets (enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_login_attempts_identifier_time ON login_attempts (identifier, attempt_time);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_active ON refresh_tokens (user_id, expires_at) WHERE revoked_at IS NULL;

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers for updated_at columns
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'update_whitelist_addresses_updated_at'
  ) THEN
    CREATE TRIGGER update_whitelist_addresses_updated_at 
      BEFORE UPDATE ON whitelist_addresses 
      FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'update_user_two_factor_settings_updated_at'
  ) THEN
    CREATE TRIGGER update_user_two_factor_settings_updated_at 
      BEFORE UPDATE ON user_two_factor_settings 
      FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- Add comments for documentation
COMMENT ON TABLE whitelist_addresses IS 'Bitcoin addresses approved for automatic withdrawals with 48-hour security delay';
COMMENT ON TABLE circuit_breaker_events IS 'Price manipulation and exchange failure events for security monitoring';
COMMENT ON TABLE token_audit_log IS 'JWT token lifecycle events for security auditing';
COMMENT ON TABLE transaction_alerts IS 'Large transaction and suspicious activity alerts for AUSTRAC compliance';
COMMENT ON TABLE user_2fa_secrets IS 'Enhanced two-factor authentication settings with TOTP and SMS support';
COMMENT ON TABLE login_attempts IS 'Login attempt tracking for account lockout and security monitoring';
COMMENT ON TABLE refresh_tokens IS 'JWT refresh token management with family tracking for security';

-- Security Metrics Tables for Real-time Monitoring Dashboard

-- Security Metrics Table (for aggregated security data)
CREATE TABLE IF NOT EXISTS security_metrics (
  id VARCHAR(255) PRIMARY KEY,
  tenant_id UUID,
  metric_type VARCHAR(50) NOT NULL CHECK (metric_type IN (
    'failed_login_attempts', 'rate_limit_violations', 'suspicious_transactions',
    'price_manipulation_alerts', 'csrf_token_violations', 'jwt_token_anomalies',
    'tenant_isolation_breaches', 'api_abuse_attempts', 'unauthorized_access_attempts',
    'exchange_health_degradation', 'compliance_threshold_breaches', 'bitcoin_address_violations'
  )),
  value DECIMAL(15,2) NOT NULL,
  metadata JSONB,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved')),
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  INDEX idx_security_metrics_type (metric_type),
  INDEX idx_security_metrics_tenant (tenant_id),
  INDEX idx_security_metrics_timestamp (timestamp),
  INDEX idx_security_metrics_severity (severity),
  INDEX idx_security_metrics_status (status)
);

-- Security Alerts Table (for dashboard alerts and notifications)
CREATE TABLE IF NOT EXISTS security_alerts (
  id VARCHAR(255) PRIMARY KEY,
  tenant_id UUID,
  alert_type VARCHAR(50) NOT NULL,
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  recommendations JSONB, -- Array of recommendation strings
  affected_resources JSONB, -- Array of affected resource strings
  status VARCHAR(20) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'investigating', 'resolved', 'false_positive')),
  assigned_to VARCHAR(255),
  resolution_notes TEXT,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  INDEX idx_security_alerts_tenant (tenant_id),
  INDEX idx_security_alerts_severity (severity),
  INDEX idx_security_alerts_status (status),
  INDEX idx_security_alerts_type (alert_type),
  INDEX idx_security_alerts_timestamp (timestamp)
);

-- Security Dashboard Cache Table (for performance optimization)
CREATE TABLE IF NOT EXISTS security_dashboard_cache (
  cache_key VARCHAR(255) PRIMARY KEY,
  tenant_id UUID,
  data JSONB NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  INDEX idx_security_dashboard_tenant (tenant_id),
  INDEX idx_security_dashboard_expires (expires_at)
);

-- Add trigger for security_alerts updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'update_security_alerts_updated_at'
  ) THEN
    CREATE TRIGGER update_security_alerts_updated_at 
      BEFORE UPDATE ON security_alerts 
      FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- AUSTRAC Compliance Reporting Tables

-- AUSTRAC Reports Table (stores generated compliance reports)
CREATE TABLE IF NOT EXISTS austrac_reports (
  id VARCHAR(255) PRIMARY KEY,
  report_type VARCHAR(10) NOT NULL CHECK (report_type IN ('TTR', 'SMR', 'IFTI', 'CAR', 'CIR')),
  report_period_start TIMESTAMP WITH TIME ZONE NOT NULL,
  report_period_end TIMESTAMP WITH TIME ZONE NOT NULL,
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'validated', 'submitted', 'accepted', 'rejected', 'failed')),
  record_count INTEGER NOT NULL DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  file_path VARCHAR(500) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  INDEX idx_austrac_reports_type (report_type),
  INDEX idx_austrac_reports_period (report_period_start, report_period_end),
  INDEX idx_austrac_reports_status (status),
  INDEX idx_austrac_reports_generated (generated_at)
);

-- AUSTRAC Transaction Records (detailed transaction data for reporting)
CREATE TABLE IF NOT EXISTS austrac_transaction_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id VARCHAR(255) NOT NULL,
  tenant_id UUID NOT NULL,
  transaction_id VARCHAR(255) NOT NULL,
  transaction_date TIMESTAMP WITH TIME ZONE NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'AUD',
  customer_data JSONB NOT NULL, -- Customer identification and details
  transaction_data JSONB NOT NULL, -- Transaction method, type, etc.
  risk_assessment JSONB, -- Risk factors and assessment
  reporting_reason VARCHAR(50) NOT NULL CHECK (reporting_reason IN ('threshold', 'suspicious', 'multiple_transactions', 'structured')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  FOREIGN KEY (report_id) REFERENCES austrac_reports(id) ON DELETE CASCADE,
  INDEX idx_austrac_tx_records_report (report_id),
  INDEX idx_austrac_tx_records_tenant (tenant_id),
  INDEX idx_austrac_tx_records_transaction (transaction_id),
  INDEX idx_austrac_tx_records_date (transaction_date),
  INDEX idx_austrac_tx_records_amount (amount)
);

-- AUSTRAC Reporting Schedule (automated reporting configuration)
CREATE TABLE IF NOT EXISTS austrac_reporting_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  report_type VARCHAR(10) NOT NULL,
  frequency VARCHAR(20) NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'quarterly')),
  last_generated TIMESTAMP WITH TIME ZONE,
  next_scheduled TIMESTAMP WITH TIME ZONE NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  configuration JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  INDEX idx_austrac_schedule_tenant (tenant_id),
  INDEX idx_austrac_schedule_type (report_type),
  INDEX idx_austrac_schedule_next (next_scheduled),
  INDEX idx_austrac_schedule_enabled (enabled)
);

-- AUSTRAC Compliance Events (audit trail for compliance activities)
CREATE TABLE IF NOT EXISTS austrac_compliance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID,
  event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('report_generated', 'report_submitted', 'threshold_breach', 'suspicious_activity', 'customer_identified', 'risk_assessed')),
  event_data JSONB NOT NULL,
  user_id VARCHAR(255),
  automated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  INDEX idx_austrac_events_tenant (tenant_id),
  INDEX idx_austrac_events_type (event_type),
  INDEX idx_austrac_events_date (created_at),
  INDEX idx_austrac_events_user (user_id)
);

-- Add triggers for AUSTRAC tables
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'update_austrac_reports_updated_at'
  ) THEN
    CREATE TRIGGER update_austrac_reports_updated_at 
      BEFORE UPDATE ON austrac_reports 
      FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'update_austrac_schedule_updated_at'
  ) THEN
    CREATE TRIGGER update_austrac_schedule_updated_at 
      BEFORE UPDATE ON austrac_reporting_schedule 
      FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- Add comments for security metrics documentation
COMMENT ON TABLE security_metrics IS 'Real-time security metrics for dashboard monitoring and alerting';
COMMENT ON TABLE security_alerts IS 'Security alerts generated from metrics and monitoring systems';
COMMENT ON TABLE security_dashboard_cache IS 'Performance cache for security dashboard statistics';

-- Audit Trail Export Tables

-- Audit Events Table (comprehensive activity logging)
CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  tenant_id UUID,
  user_id VARCHAR(255),
  event_type VARCHAR(100) NOT NULL,
  event_category VARCHAR(50) NOT NULL CHECK (event_category IN ('authentication', 'authorization', 'data_access', 'data_modification', 'financial_transaction', 'security_event', 'compliance_event', 'system_event', 'user_management', 'configuration_change')),
  resource VARCHAR(255) NOT NULL,
  action VARCHAR(100) NOT NULL,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('success', 'failure', 'error')),
  details JSONB NOT NULL DEFAULT '{}',
  ip_address INET,
  user_agent TEXT,
  session_id VARCHAR(255),
  risk_level VARCHAR(20) DEFAULT 'low' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  compliance_relevant BOOLEAN NOT NULL DEFAULT false,
  retention_category VARCHAR(20) NOT NULL DEFAULT 'short_term' CHECK (retention_category IN ('short_term', 'medium_term', 'long_term', 'permanent')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  INDEX idx_audit_events_timestamp (timestamp),
  INDEX idx_audit_events_tenant (tenant_id),
  INDEX idx_audit_events_user (user_id),
  INDEX idx_audit_events_type (event_type),
  INDEX idx_audit_events_category (event_category),
  INDEX idx_audit_events_outcome (outcome),
  INDEX idx_audit_events_compliance (compliance_relevant),
  INDEX idx_audit_events_retention (retention_category),
  INDEX idx_audit_events_tenant_time (tenant_id, timestamp)
);

-- Audit Export Requests Table (export job tracking)
CREATE TABLE IF NOT EXISTS audit_exports (
  id VARCHAR(255) PRIMARY KEY,
  export_type VARCHAR(50) NOT NULL CHECK (export_type IN ('full_system_audit', 'security_events', 'transaction_history', 'user_activities', 'compliance_activities', 'api_access_logs', 'database_changes', 'payment_processor_logs', 'bitcoin_operations', 'kyc_verification_logs')),
  tenant_id UUID,
  date_range_start TIMESTAMP WITH TIME ZONE NOT NULL,
  date_range_end TIMESTAMP WITH TIME ZONE NOT NULL,
  filters JSONB NOT NULL DEFAULT '{}',
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'processing', 'completed', 'failed', 'expired')),
  format VARCHAR(10) NOT NULL CHECK (format IN ('json', 'csv', 'pdf', 'xml')),
  file_path VARCHAR(500),
  record_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  INDEX idx_audit_exports_tenant (tenant_id),
  INDEX idx_audit_exports_status (status),
  INDEX idx_audit_exports_type (export_type),
  INDEX idx_audit_exports_generated (generated_at),
  INDEX idx_audit_exports_requested_by ((metadata->>'requestedBy'))
);

-- Add trigger for audit_exports updated_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.triggers 
    WHERE trigger_name = 'update_audit_exports_updated_at'
  ) THEN
    CREATE TRIGGER update_audit_exports_updated_at 
      BEFORE UPDATE ON audit_exports 
      FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
  END IF;
END $$;

-- Add comments for AUSTRAC compliance tables
COMMENT ON TABLE austrac_reports IS 'Generated AUSTRAC compliance reports (TTR, SMR, IFTI, etc.)';
COMMENT ON TABLE austrac_transaction_records IS 'Detailed transaction records for AUSTRAC reporting requirements';
COMMENT ON TABLE austrac_reporting_schedule IS 'Automated AUSTRAC reporting schedules and configuration';
COMMENT ON TABLE austrac_compliance_events IS 'Audit trail for AUSTRAC compliance activities and events';

-- Add comments for audit trail tables
COMMENT ON TABLE audit_events IS 'Comprehensive audit trail for all system activities and events';
COMMENT ON TABLE audit_exports IS 'Audit trail export requests and job tracking for compliance reporting';

-- Security: Ensure row-level security is enabled for tenant isolation
-- These would be implemented based on your existing tenant security model
-- ALTER TABLE whitelist_addresses ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE circuit_breaker_events ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE token_audit_log ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE transaction_alerts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE user_two_factor_settings ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE security_metrics ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE security_alerts ENABLE ROW LEVEL SECURITY;