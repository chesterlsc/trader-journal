CREATE TABLE IF NOT EXISTS journal_users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    email VARCHAR(190) NULL UNIQUE,
    auth_provider VARCHAR(24) NOT NULL DEFAULT 'email',
    oauth_subject TEXT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS password_reset_requests (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(190) NOT NULL,
    user_id BIGINT NULL REFERENCES journal_users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NULL,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NULL,
    used_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_password_reset_requests_token_hash ON password_reset_requests (token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_requests_email_requested ON password_reset_requests (email, requested_at DESC);

CREATE TABLE IF NOT EXISTS journal_notes (
    user_id BIGINT PRIMARY KEY REFERENCES journal_users(id) ON DELETE CASCADE,
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    reflections JSONB NOT NULL DEFAULT '[]'::jsonb,
    replay_notes JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trades (
    user_id BIGINT PRIMARY KEY REFERENCES journal_users(id) ON DELETE CASCADE,
    payload JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trade_screenshots (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES journal_users(id) ON DELETE CASCADE,
    trade_id VARCHAR(64) NOT NULL,
    screenshot_name TEXT NOT NULL DEFAULT '',
    screenshot_data TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trade_screenshots_user_trade ON trade_screenshots (user_id, trade_id);

CREATE TABLE IF NOT EXISTS symbol_prices (
    symbol TEXT PRIMARY KEY,
    price NUMERIC NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_symbol_prices_updated_at ON symbol_prices (updated_at DESC);

CREATE TABLE IF NOT EXISTS login_info (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NULL REFERENCES journal_users(id) ON DELETE SET NULL,
    username VARCHAR(32) NOT NULL,
    event_type VARCHAR(24) NOT NULL,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    ip_address INET NULL,
    user_agent TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_info_created_at ON login_info (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_info_username ON login_info (username);
