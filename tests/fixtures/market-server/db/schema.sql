CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('guest','admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  csrf_hash text NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS wallets (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  balance bigint NOT NULL CHECK (balance >= 0)
);
CREATE TABLE IF NOT EXISTS inventories (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_code text NOT NULL CHECK (item_code IN ('wood','stone','iron')),
  quantity bigint NOT NULL CHECK (quantity >= 0),
  PRIMARY KEY(account_id,item_code)
);
CREATE TABLE IF NOT EXISTS listings (
  id uuid PRIMARY KEY,
  seller_id uuid NOT NULL REFERENCES accounts(id),
  item_code text NOT NULL,
  unit_price bigint NOT NULL CHECK (unit_price > 0),
  quantity bigint NOT NULL CHECK (quantity >= 0),
  status text NOT NULL CHECK (status IN ('open','cancelled','sold_out','expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS inventory_movements (
  id bigserial PRIMARY KEY,
  listing_id uuid REFERENCES listings(id),
  operation_id uuid,
  from_account_id uuid REFERENCES accounts(id),
  to_account_id uuid REFERENCES accounts(id),
  item_code text NOT NULL CHECK (item_code IN ('wood','stone','iron')),
  quantity bigint NOT NULL CHECK (quantity > 0),
  kind text NOT NULL CHECK (kind IN ('reserve','release','consume')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='reserve' AND from_account_id IS NOT NULL AND to_account_id IS NULL) OR (kind='release' AND from_account_id IS NULL AND to_account_id IS NOT NULL) OR (kind='consume' AND from_account_id IS NULL AND to_account_id IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  operation_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  kind text NOT NULL CHECK (kind IN ('credit','debit','escrow_in','escrow_out')),
  amount bigint NOT NULL CHECK (amount > 0),
  listing_id uuid REFERENCES listings(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(operation_id, account_id, kind)
);
CREATE TABLE IF NOT EXISTS purchases (
  operation_id uuid PRIMARY KEY,
  listing_id uuid NOT NULL REFERENCES listings(id),
  buyer_id uuid NOT NULL REFERENCES accounts(id),
  seller_id uuid NOT NULL REFERENCES accounts(id),
  quantity bigint NOT NULL CHECK (quantity > 0),
  unit_price bigint NOT NULL CHECK (unit_price > 0),
  total bigint NOT NULL CHECK (total > 0 AND total = quantity * unit_price),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS delivery_receipts (
  operation_id uuid PRIMARY KEY REFERENCES purchases(operation_id),
  buyer_id uuid NOT NULL REFERENCES accounts(id),
  item_code text NOT NULL,
  quantity bigint NOT NULL CHECK (quantity > 0),
  delivered_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  account_id uuid NOT NULL REFERENCES accounts(id),
  key text NOT NULL,
  payload_hash text NOT NULL,
  operation_id uuid NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(account_id, key)
);
CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  actor_id uuid,
  action text NOT NULL,
  target_id uuid,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sandbox_fixture_grants (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  fixture_version text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS listings_open_idx ON listings(status, item_code, created_at);
CREATE INDEX IF NOT EXISTS sessions_account_idx ON sessions(account_id, expires_at);
