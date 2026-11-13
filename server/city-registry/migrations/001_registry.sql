-- Isolated additive schema. Do not run against a deployed database without a
-- reviewed adapter, backup, legacy inventory and an explicitly approved plan.
CREATE SCHEMA city_registry;
CREATE TABLE city_registry.instances (
  city_id uuid PRIMARY KEY,
  owner_id uuid NOT NULL,
  slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 3),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, city_id)
);
CREATE UNIQUE INDEX registry_live_slot ON city_registry.instances(owner_id, slot) WHERE retired_at IS NULL;
CREATE TABLE city_registry.owner_locks (owner_id uuid PRIMARY KEY);
CREATE TABLE city_registry.create_receipts (
  owner_id uuid NOT NULL, request_id uuid NOT NULL, payload_hash text NOT NULL,
  city_id uuid NOT NULL, PRIMARY KEY(owner_id, request_id),
  FOREIGN KEY(owner_id, city_id) REFERENCES city_registry.instances(owner_id, city_id)
);
-- Projection is deliberately separated from private save payloads. It is not
-- public until a reviewed player identity and publication policy exist.
CREATE TABLE city_registry.positions (
  city_id uuid PRIMARY KEY REFERENCES city_registry.instances(city_id),
  world_x integer NOT NULL, world_y integer NOT NULL,
  UNIQUE(world_x, world_y)
);
CREATE TABLE city_registry.summaries (
  city_id uuid PRIMARY KEY REFERENCES city_registry.instances(city_id),
  revision bigint NOT NULL CHECK(revision > 0), raw_hash text NOT NULL CHECK(raw_hash ~ '^[0-9a-f]{64}$'),
  name text NOT NULL CHECK(length(name) <= 120), population bigint NOT NULL CHECK(population >= 0),
  tick bigint NOT NULL CHECK(tick >= 0)
);
-- owner_id, city_id and slot are lifecycle identity; never update them.
CREATE FUNCTION city_registry.guard_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.city_id, NEW.owner_id, NEW.slot) IS DISTINCT FROM (OLD.city_id, OLD.owner_id, OLD.slot)
 THEN RAISE EXCEPTION 'immutable city identity'; END IF;
 IF OLD.retired_at IS NOT NULL AND NEW.retired_at IS DISTINCT FROM OLD.retired_at
 THEN RAISE EXCEPTION 'retirement is irreversible'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER city_identity BEFORE UPDATE ON city_registry.instances FOR EACH ROW EXECUTE FUNCTION city_registry.guard_identity();
CREATE FUNCTION city_registry.guard_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'city instances must not be deleted';
END $$;
CREATE TRIGGER city_no_delete BEFORE DELETE ON city_registry.instances FOR EACH ROW EXECUTE FUNCTION city_registry.guard_delete();
