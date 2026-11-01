-- Isolated candidate schema; not a migration of the installed legacy tables.
CREATE TABLE city_registry.save_heads (
 owner_id uuid NOT NULL, city_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 raw text NOT NULL, raw_hash text NOT NULL CHECK(raw_hash ~ '^[0-9a-f]{64}$'), metadata jsonb NOT NULL,
 PRIMARY KEY(owner_id,city_id), FOREIGN KEY(owner_id,city_id) REFERENCES city_registry.instances(owner_id,city_id)
);
CREATE TABLE city_registry.save_history (
 owner_id uuid NOT NULL, city_id uuid NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 raw text NOT NULL, raw_hash text NOT NULL CHECK(raw_hash ~ '^[0-9a-f]{64}$'), metadata jsonb NOT NULL,
 PRIMARY KEY(owner_id,city_id,revision), FOREIGN KEY(owner_id,city_id) REFERENCES city_registry.instances(owner_id,city_id)
);
CREATE TABLE city_registry.save_receipts (
 owner_id uuid NOT NULL, city_id uuid NOT NULL, request_id uuid NOT NULL,
 payload_hash text NOT NULL, response jsonb NOT NULL, PRIMARY KEY(owner_id,city_id,request_id),
 FOREIGN KEY(owner_id,city_id) REFERENCES city_registry.instances(owner_id,city_id)
);
CREATE TABLE city_registry.atomic_create_receipts (
 owner_id uuid NOT NULL, request_id uuid NOT NULL, city_id uuid NOT NULL,
 payload_hash text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(owner_id,request_id),
 FOREIGN KEY(owner_id,city_id) REFERENCES city_registry.instances(owner_id,city_id)
);
