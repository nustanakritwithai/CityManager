-- Isolated candidate only. Requires team 1 migrations 001-004; never run live.
CREATE TABLE city_registry.save_intents (
 owner_id uuid NOT NULL, request_id uuid NOT NULL, city_id uuid NOT NULL,
 session_hash text NOT NULL CHECK(session_hash ~ '^[0-9a-f]{64}$'),
 expected_revision bigint NOT NULL CHECK(expected_revision > 0),
 body_cipher bytea, body_nonce bytea, body_tag bytea, key_id text,
 body_hash text NOT NULL CHECK(body_hash ~ '^[0-9a-f]{64}$'),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
 raw_hash text NOT NULL CHECK(raw_hash ~ '^[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN ('pending','applied','manual','completed')),
 manual_code text, ack_revision bigint, ack_hash text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(owner_id,request_id),
 FOREIGN KEY(owner_id,city_id) REFERENCES city_registry.instances(owner_id,city_id),
 CHECK ((state='completed' AND body_cipher IS NULL AND body_nonce IS NULL AND body_tag IS NULL AND key_id IS NULL) OR
        (state<>'completed' AND body_cipher IS NOT NULL AND body_nonce IS NOT NULL AND body_tag IS NOT NULL AND key_id IS NOT NULL AND octet_length(body_nonce)=12 AND octet_length(body_tag)=16 AND key_id ~ '^[A-Za-z0-9_-]{1,64}$')),
 CHECK ((state='manual' AND manual_code IS NOT NULL) OR (state<>'manual' AND manual_code IS NULL)),
 CHECK ((state IN ('applied','completed') AND ack_revision IS NOT NULL AND ack_hash IS NOT NULL) OR
        (state='pending' AND ack_revision IS NULL AND ack_hash IS NULL) OR
        (state='manual' AND ((ack_revision IS NULL AND ack_hash IS NULL) OR (ack_revision IS NOT NULL AND ack_hash IS NOT NULL)))),
 CHECK (ack_revision IS NULL OR (ack_revision=expected_revision+1 AND ack_hash ~ '^[0-9a-f]{64}$')),
 CHECK (body_cipher IS NULL OR octet_length(body_cipher) <= 50348032)
);
CREATE UNIQUE INDEX save_intent_one_unresolved_owner ON city_registry.save_intents(owner_id) WHERE state <> 'completed';
