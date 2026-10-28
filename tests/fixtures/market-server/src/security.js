import crypto from 'node:crypto';
export const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const token = () => crypto.randomBytes(32).toString('base64url');
export const uuid = () => crypto.randomUUID();
export const payloadHash = (body) => hash(JSON.stringify(body));
export function fail(code, message) { const e = new Error(message); e.status = code; return e; }
