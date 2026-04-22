-- Migration: 0001_initial
-- Description: Core schema for Phase 1 security scanning pipeline

-- Core findings table (Phase 1 scope only)
CREATE TABLE IF NOT EXISTS findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo TEXT NOT NULL,
    pr_number INTEGER NOT NULL,
    commit_sha TEXT NOT NULL,
    file TEXT NOT NULL,
    line INTEGER,
    tool TEXT NOT NULL, -- semgrep, regex-fallback
    rule_id TEXT,
    severity TEXT CHECK(severity IN ('critical', 'high', 'medium', 'low', 'info')),
    message TEXT,

    -- Standard tracking
    status TEXT CHECK(status IN ('open', 'dismissed', 'fixed')) DEFAULT 'open',
    dismissed_by TEXT,
    dismissed_reason TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for findings table
CREATE INDEX IF NOT EXISTS idx_findings_repo ON findings(repo);
CREATE INDEX IF NOT EXISTS idx_findings_pr_number ON findings(pr_number);
CREATE INDEX IF NOT EXISTS idx_findings_commit_sha ON findings(commit_sha);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);
CREATE INDEX IF NOT EXISTS idx_findings_created_at ON findings(created_at);
CREATE INDEX IF NOT EXISTS idx_findings_tool ON findings(tool);
CREATE INDEX IF NOT EXISTS idx_findings_severity ON findings(severity);

-- Webhook delivery log (for debugging and replay)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id TEXT UNIQUE,           -- GitHub delivery GUID
    event TEXT NOT NULL,               -- pull_request, push, etc.
    action TEXT,                       -- opened, synchronize, closed
    repo TEXT NOT NULL,
    pr_number INTEGER,
    payload_hash TEXT,                 -- SHA-256 of payload for dedup
    status TEXT CHECK(status IN ('received', 'processing', 'completed', 'failed')) DEFAULT 'received',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_delivery_id ON webhook_deliveries(delivery_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_repo ON webhook_deliveries(repo);
