import pg from 'pg';
import fs from 'node:fs/promises';
const { Pool } = pg;
const schema = process.env.DATABASE_SCHEMA || 'public';
if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error('invalid DATABASE_SCHEMA');
const quotedSchema = '"' + schema.replaceAll('"','""') + '"';
// Never fall back to the seeded public schema: a missing table must fail closed.
// pg_catalog remains implicitly visible for built-in types/functions.
export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, options: `-c search_path=${quotedSchema}` });
export async function migrate() {
  const sql = await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const v2 = `CREATE TABLE IF NOT EXISTS inventory_movements (
    id bigserial PRIMARY KEY, listing_id uuid REFERENCES listings(id), operation_id uuid,
    from_account_id uuid REFERENCES accounts(id), to_account_id uuid REFERENCES accounts(id),
    item_code text NOT NULL CHECK (item_code IN ('wood','stone','iron')), quantity bigint NOT NULL CHECK (quantity > 0),
    kind text NOT NULL CHECK (kind IN ('reserve','release','consume')), created_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((kind='reserve' AND from_account_id IS NOT NULL AND to_account_id IS NULL) OR (kind='release' AND from_account_id IS NULL AND to_account_id IS NOT NULL) OR (kind='consume' AND from_account_id IS NULL AND to_account_id IS NOT NULL))
  )`;
  const v3 = `CREATE OR REPLACE FUNCTION cm_record_purchase_inventory_move() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO inventory_movements(listing_id,operation_id,from_account_id,to_account_id,item_code,quantity,kind)
      SELECT NEW.listing_id,NEW.operation_id,NULL,NEW.buyer_id,item_code,NEW.quantity,'consume' FROM listings WHERE id=NEW.listing_id;
      RETURN NEW;
    END; $$;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cm_purchase_inventory_move') THEN
        CREATE TRIGGER cm_purchase_inventory_move AFTER INSERT ON purchases FOR EACH ROW EXECUTE FUNCTION cm_record_purchase_inventory_move();
      END IF;
    END $$`;
  const v4 = `CREATE TABLE IF NOT EXISTS sandbox_fixture_grants (
    account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    fixture_version text NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT now()
  )`;
  const v5 = `
    ALTER TABLE wallets ADD COLUMN IF NOT EXISTS seq bigint NOT NULL DEFAULT 0 CHECK (seq >= 0);
    ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_item_code_check;
    ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_item_code_check CHECK (item_code IN ('wood','stone','iron','crop:rice','crop:vegetables','crop:sugarcane','product:milled-rice','product:canned-food','product:sugar'));
    ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_kind_check;
    ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_kind_check CHECK (kind IN ('reserve','release','consume','deposit'));
    ALTER TABLE inventories DROP CONSTRAINT IF EXISTS inventories_item_code_check;
    ALTER TABLE inventories ADD CONSTRAINT inventories_item_code_check CHECK (item_code IN ('wood','stone','iron','crop:rice','crop:vegetables','crop:sugarcane','product:milled-rice','product:canned-food','product:sugar'));
    ALTER TABLE listings DROP CONSTRAINT IF EXISTS listings_item_code_check;
    ALTER TABLE listings ADD CONSTRAINT listings_item_code_check CHECK (item_code IN ('wood','stone','iron','crop:rice','crop:vegetables','crop:sugarcane','product:milled-rice','product:canned-food','product:sugar'));
    ALTER TABLE delivery_receipts DROP CONSTRAINT IF EXISTS delivery_receipts_item_code_check;
    ALTER TABLE delivery_receipts ADD CONSTRAINT delivery_receipts_item_code_check CHECK (item_code IN ('wood','stone','iron','crop:rice','crop:vegetables','crop:sugarcane','product:milled-rice','product:canned-food','product:sugar'));
    CREATE TABLE IF NOT EXISTS deposit_operations (
      op_id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      item_code text NOT NULL, quantity bigint NOT NULL CHECK (quantity > 0),
      payload_hash text NOT NULL, state text NOT NULL CHECK (state IN ('done','cancelled')),
      seq bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS receipt_claim_history (
      id bigserial PRIMARY KEY, receipt_id uuid NOT NULL REFERENCES delivery_receipts(operation_id) ON DELETE CASCADE,
      claim_id uuid, action text NOT NULL CHECK (action IN ('claim','ack','timeout','release')),
      details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS deposit_cancellations (
      op_id uuid PRIMARY KEY, account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE delivery_receipts ADD COLUMN IF NOT EXISTS claim_id uuid;
    ALTER TABLE delivery_receipts ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
    ALTER TABLE delivery_receipts ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;
    CREATE INDEX IF NOT EXISTS deposit_operations_account_idx ON deposit_operations(account_id, created_at);
    CREATE INDEX IF NOT EXISTS receipt_claims_idx ON delivery_receipts(buyer_id, acknowledged_at, claim_expires_at);
    CREATE OR REPLACE FUNCTION cm_increment_wallet_seq() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE wallets SET seq=seq+1 WHERE account_id=NEW.account_id; RETURN NEW; END; $$;
    DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cm_ledger_wallet_seq') THEN CREATE TRIGGER cm_ledger_wallet_seq AFTER INSERT ON ledger_entries FOR EACH ROW EXECUTE FUNCTION cm_increment_wallet_seq(); END IF; END $$;
  `;
  const v6 = `
    ALTER TABLE inventory_movements DROP CONSTRAINT IF EXISTS inventory_movements_check;
    ALTER TABLE inventory_movements ADD CONSTRAINT inventory_movements_check CHECK (
      (kind='reserve' AND from_account_id IS NOT NULL AND to_account_id IS NULL) OR
      (kind='release' AND from_account_id IS NULL AND to_account_id IS NOT NULL) OR
      (kind='consume' AND from_account_id IS NULL AND to_account_id IS NOT NULL) OR
      (kind='deposit' AND from_account_id IS NULL AND to_account_id IS NOT NULL)
    );
  `;
  const v7 = `ALTER TABLE listings ADD COLUMN IF NOT EXISTS cancel_response jsonb;`;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [874219]);
    const applied = await client.query('SELECT version FROM schema_migrations');
    const versions = new Set(applied.rows.map(r=>r.version));
    if (!versions.has(1)) {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version,name) VALUES(1,'initial_market_sandbox')");
    }
    if (!versions.has(2)) { await client.query(v2); await client.query("INSERT INTO schema_migrations(version,name) VALUES(2,'inventory_movement_ledger')"); }
    if (!versions.has(3)) { await client.query(v3); await client.query("INSERT INTO schema_migrations(version,name) VALUES(3,'purchase_inventory_consume_trigger')"); }
    if (!versions.has(4)) { await client.query(v4); await client.query("INSERT INTO schema_migrations(version,name) VALUES(4,'idempotent_fixture_grants')"); }
    if (!versions.has(5)) { await client.query(v5); await client.query("INSERT INTO schema_migrations(version,name) VALUES(5,'game_market_handoff_deposits_claims_wallet_seq')"); }
    if (!versions.has(6)) { await client.query(v6); await client.query("INSERT INTO schema_migrations(version,name) VALUES(6,'deposit_movement_constraint')"); }
    if (!versions.has(7)) { await client.query(v7); await client.query("INSERT INTO schema_migrations(version,name) VALUES(7,'stable_listing_cancel_response')"); }
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
export async function tx(fn, attempts=3) {
  for (let attempt=1; attempt<=attempts; attempt++) {
    const client = await pool.connect();
    let released=false;
    try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
    catch (e) { try { await client.query('ROLLBACK'); } catch {} const retry=['40001','40P01'].includes(e.code) && attempt<attempts; if(retry){client.release();released=true;continue;} throw e; }
    finally { if(!released) client.release(); }
  }
}
