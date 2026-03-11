CREATE TABLE IF NOT EXISTS journal_users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_data (
    user_id BIGINT PRIMARY KEY REFERENCES journal_users(id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    trades JSONB NOT NULL DEFAULT '[]'::jsonb,
    reflections JSONB NOT NULL DEFAULT '[]'::jsonb,
    replay_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS journal_login_events (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NULL REFERENCES journal_users(id) ON DELETE SET NULL,
    username VARCHAR(32) NOT NULL,
    event_type VARCHAR(24) NOT NULL,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    ip_address INET NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_journal_login_events_created_at ON journal_login_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_journal_login_events_username ON journal_login_events (username);
