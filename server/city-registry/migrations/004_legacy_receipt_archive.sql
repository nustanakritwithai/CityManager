-- Legacy receipts retain their original owner/request scope and are not replayed
-- through new city-scoped receipt routing.
CREATE TABLE city_registry.legacy_receipt_archive (
 owner_id uuid NOT NULL, request_id uuid NOT NULL, payload_hash text NOT NULL,
 response jsonb NOT NULL, PRIMARY KEY(owner_id,request_id)
);
