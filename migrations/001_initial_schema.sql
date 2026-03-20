CREATE TABLE IF NOT EXISTS tokens (
    mint             TEXT PRIMARY KEY,
    name             TEXT,
    symbol           TEXT,
    description      TEXT,
    twitter          TEXT,
    website          TEXT,
    creator_username TEXT,
    provider         TEXT,
    launchpad        TEXT,
    pair_address     TEXT,
    status           TEXT NOT NULL DEFAULT 'active',
    first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at   TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS token_scores_static (
    mint              TEXT PRIMARY KEY REFERENCES tokens(mint) ON DELETE CASCADE,
    safety_score      SMALLINT,
    creator_score     SMALLINT,
    quality_score     SMALLINT,
    safety_detail     JSONB,
    creator_detail    JSONB,
    quality_detail    JSONB,
    last_refreshed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS token_scores_dynamic (
    mint              TEXT PRIMARY KEY REFERENCES tokens(mint) ON DELETE CASCADE,
    momentum_score    SMALLINT,
    buzz_score        SMALLINT,
    volume_24h        NUMERIC,
    market_cap        NUMERIC,
    price_usd         NUMERIC,
    price_change_24h  NUMERIC,
    buy_sell_ratio    NUMERIC,
    unique_buyers     INT,
    twitter_mentions  INT,
    composite_score   NUMERIC,
    last_refreshed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS token_ai_analysis (
    mint         TEXT PRIMARY KEY REFERENCES tokens(mint) ON DELETE CASCADE,
    summary      TEXT,
    strengths    TEXT[],
    red_flags    TEXT[],
    verdict      TEXT,
    generated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS users (
    telegram_id BIGINT PRIMARY KEY,
    tier        TEXT NOT NULL DEFAULT 'free',
    paid_until  TIMESTAMPTZ,
    subscribed  BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_sessions (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_id BIGINT REFERENCES users(telegram_id) ON DELETE CASCADE,
    sol_address TEXT UNIQUE NOT NULL,
    amount_sol  NUMERIC NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    paid        BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS alert_history (
    mint       TEXT PRIMARY KEY REFERENCES tokens(mint) ON DELETE CASCADE,
    alerted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_status ON tokens(status);
CREATE INDEX IF NOT EXISTS idx_tokens_last_active ON tokens(last_active_at);
CREATE INDEX IF NOT EXISTS idx_dynamic_composite ON token_scores_dynamic(composite_score DESC);
CREATE INDEX IF NOT EXISTS idx_payment_sessions_address ON payment_sessions(sol_address);
