-- Candidate migration; apply only through a separately approved rollout.
CREATE TABLE city_save_instances (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),
  revision bigint NOT NULL CHECK (revision > 0),
  deleted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX city_save_active_slot ON city_save_instances(account_id, slot) WHERE NOT deleted;
CREATE TABLE city_save_snapshots (
  instance_id uuid NOT NULL REFERENCES city_save_instances(id),
  revision bigint NOT NULL CHECK (revision > 0),
  raw text NOT NULL CHECK (octet_length(raw) BETWEEN 1 AND 48000000),
  metadata jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instance_id, revision)
);
CREATE TABLE city_save_requests (
  account_id uuid NOT NULL REFERENCES accounts(id),
  request_id uuid NOT NULL,
  payload_hash text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (account_id, request_id)
);

-- Previous snapshots cannot be modified or deleted by application queries.
CREATE FUNCTION city_save_snapshot_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'city save snapshots are append-only';
END;
$$;
CREATE TRIGGER city_save_snapshot_no_change BEFORE UPDATE OR DELETE ON city_save_snapshots
FOR EACH ROW EXECUTE FUNCTION city_save_snapshot_append_only();
