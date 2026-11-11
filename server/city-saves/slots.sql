-- Run once in the same database/schema as the legacy save tables.
-- Slot 1 continues using the existing tables, including all snapshots and receipts.
BEGIN;
SET LOCAL lock_timeout = '3s';

DO $migration$
DECLARE
  slot integer;
  suffix text;
  target text;
  constraint_row record;
  trigger_row record;
  relation_suffixes constant text[] := ARRAY['heads', 'snapshots', 'requests', 'archives', 'archive_sources'];
BEGIN
  FOREACH suffix IN ARRAY relation_suffixes LOOP
    IF to_regclass(format('%I.%I', current_schema(), 'city_server_' || suffix)) IS NULL THEN
      RAISE EXCEPTION 'Missing legacy save table % in %', suffix, current_schema();
    END IF;
  END LOOP;

  FOR slot IN 2..3 LOOP
    FOREACH suffix IN ARRAY relation_suffixes LOOP
      target := format('city_slot_%s_%s', slot, suffix);
      EXECUTE format('CREATE TABLE %I (LIKE %I INCLUDING ALL)', target, 'city_server_' || suffix);
    END LOOP;

    -- Preserve legacy foreign keys and immutable-save triggers, which LIKE omits.
    FOREACH suffix IN ARRAY relation_suffixes LOOP
      target := format('city_slot_%s_%s', slot, suffix);
      FOR constraint_row IN
        SELECT conname, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = to_regclass(format('%I.%I', current_schema(), 'city_server_' || suffix))
          AND contype = 'f'
      LOOP
        EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s', target, constraint_row.conname,
          regexp_replace(constraint_row.definition, 'city_server_(heads|snapshots|requests|archives|archive_sources)\y',
            format('city_slot_%s_', slot) || '\1', 'g'));
      END LOOP;
      FOR trigger_row IN
        SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger
        WHERE tgrelid = to_regclass(format('%I.%I', current_schema(), 'city_server_' || suffix))
          AND NOT tgisinternal
      LOOP
        EXECUTE regexp_replace(trigger_row.definition,
          '( ON (?:[A-Za-z_][A-Za-z0-9_]*\.)?)city_server_(heads|snapshots|requests|archives|archive_sources)\y',
          '\1' || format('city_slot_%s_', slot) || '\2');
      END LOOP;
    END LOOP;
  END LOOP;
END
$migration$;

COMMIT;
