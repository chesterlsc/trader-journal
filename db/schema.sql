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
