-- Standalone prototype only. Apply after 001 in a separately provisioned DB.
CREATE TABLE city_registry.legacy_markers (
 owner_id uuid PRIMARY KEY,
 city_id uuid,
 FOREIGN KEY (owner_id, city_id) REFERENCES city_registry.instances(owner_id, city_id)
);
CREATE FUNCTION city_registry.guard_marker() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'legacy marker is immutable'; END $$;
CREATE TRIGGER legacy_marker_no_change BEFORE UPDATE OR DELETE ON city_registry.legacy_markers
 FOR EACH ROW EXECUTE FUNCTION city_registry.guard_marker();
