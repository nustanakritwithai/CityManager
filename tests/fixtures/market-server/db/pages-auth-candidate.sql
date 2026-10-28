-- Candidate only: do not apply automatically at startup.
CREATE TABLE pages_recovery_codes (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  code_hash text UNIQUE NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE pages_recovery_rotations (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_id uuid NOT NULL,
  code_hash text NOT NULL,
  previous_code_hash text,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  PRIMARY KEY (account_id,request_id)
);
CREATE TABLE pages_auth_codes (
  code_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_hash text NOT NULL REFERENCES sessions(token_hash),
  challenge text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
CREATE TABLE pages_access_tokens (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_hash text NOT NULL REFERENCES sessions(token_hash),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE pages_auth_rate_limits (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0)
);
CREATE INDEX pages_auth_codes_expiry_idx ON pages_auth_codes(expires_at);
CREATE INDEX pages_access_tokens_expiry_idx ON pages_access_tokens(expires_at);
CREATE INDEX pages_auth_rate_limits_window_idx ON pages_auth_rate_limits(window_start);
CREATE INDEX pages_recovery_rotations_expiry_idx ON pages_recovery_rotations(expires_at);
