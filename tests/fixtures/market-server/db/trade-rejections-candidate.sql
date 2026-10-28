-- Review-only additive migration. Never auto-run on startup.
CREATE TABLE trade_rejections (
  account_id uuid NOT NULL REFERENCES accounts(id),
  operation_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('buy','listing','cancel')),
  payload_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, operation_key)
);
CREATE TABLE trade_cancel_results (
  account_id uuid NOT NULL REFERENCES accounts(id),
  operation_key text NOT NULL,
  payload_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, operation_key)
);
-- This marker is installed atomically with the protocol tables before any
-- guarded writer starts; zero outcome rows must not permit a legacy restart.
CREATE TABLE market_runtime_guard (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  trade_rejections_protocol integer NOT NULL CHECK (trade_rejections_protocol > 0)
);
INSERT INTO market_runtime_guard(singleton, trade_rejections_protocol) VALUES (true, 1);
