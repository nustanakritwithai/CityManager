/** Pages popup authentication. Tokens and PKCE material remain in module memory only. */
export const PAGES_ORIGIN = 'https://nustanakritwithai.github.io';
export const MARKET_ORIGIN = 'https://citymanager.157-85-96-139.sslip.io';
export const PAGES_MARKET_BASE = `${MARKET_ORIGIN}/citymanager-api`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
type Prepared = { state: string; verifier: string; challenge: string };

export class PagesSession {
  private prepared: Prepared | null = null;
  private preparing: Promise<void> | null = null;
  private connecting = false;
  private accessToken: string | null = null;
  private expiresAt = 0;
  private account: string | null = null;
  private validated = false;

  async prepare() {
    if (this.prepared) return;
    if (this.preparing) return this.preparing;
    this.preparing = (async () => { const verifier = b64url(crypto.getRandomValues(new Uint8Array(32))), state = b64url(crypto.getRandomValues(new Uint8Array(32))); const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)); this.prepared = { verifier, state, challenge: b64url(new Uint8Array(digest)) }; })();
    try { await this.preparing; } finally { this.preparing = null; }
  }
  get guestId() { return this.bearer() ? this.account : null; }
  get verifiedGuest() { return this.validated ? this.guestId : null; }
  bearer() { if (!this.accessToken || Date.now() >= this.expiresAt) { this.clear(); return null; } return this.accessToken; }
  activate(guestId: string) { if (!this.bearer() || this.account !== guestId) throw new Error('market guest identity mismatch'); this.validated = true; }
  clear() { this.accessToken = null; this.expiresAt = 0; this.account = null; this.validated = false; }

  /** Call directly from a user gesture after prepare(); window.open occurs synchronously. */
  connect(expectedGuest: string | null): Promise<string> {
    if (window.location.origin !== PAGES_ORIGIN) throw new Error('pages-origin-not-allowed');
    if (expectedGuest !== null && !UUID.test(expectedGuest)) throw new Error('invalid-expected-guest');
    if (this.connecting) throw new Error('pages-login-busy');
    const prepared = this.prepared; if (!prepared) throw new Error('pages-login-not-ready'); this.prepared = null;
    const login = new URL('/citymanager-api/v1/pages/login', MARKET_ORIGIN); login.searchParams.set('challenge', prepared.challenge); login.searchParams.set('state', prepared.state);
    const popup = window.open(login.href, 'citymanager-market-login', 'popup=yes,width=480,height=720'); if (!popup) throw new Error('pages-popup-blocked'); this.connecting = true;
    return new Promise<string>((resolve, reject) => {
      let settled = false; const finish = () => { if (settled) return false; settled = true; clearTimeout(timeout); clearInterval(poll); window.removeEventListener('message', listener); return true; };
      const listener = (event: MessageEvent) => {
        const data = event.data as { type?: unknown; state?: unknown; code?: unknown } | null;
        if (event.origin !== MARKET_ORIGIN || event.source !== popup || !data || data.type !== 'citymanager-auth-code' || data.state !== prepared.state || typeof data.code !== 'string' || !TOKEN.test(data.code) || !finish()) return;
        try { popup.close(); } catch { /* already closed */ }
        void (async () => {
          try {
            const response = await fetch(`${PAGES_MARKET_BASE}/v1/pages/exchange`, { method: 'POST', credentials: 'omit', signal: AbortSignal.timeout(15_000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: data.code, verifier: prepared.verifier }) });
            if (!response.ok) throw new Error('pages-exchange-failed'); const body: unknown = await response.json();
            if (!body || typeof body !== 'object') throw new Error('pages-exchange-invalid'); const value = body as Record<string, unknown>;
            if (value.token_type !== 'Bearer' || typeof value.access_token !== 'string' || !TOKEN.test(value.access_token) || typeof value.guest_id !== 'string' || !UUID.test(value.guest_id) || !Number.isSafeInteger(value.expires_in) || Number(value.expires_in) < 1 || Number(value.expires_in) > 900) throw new Error('pages-exchange-invalid');
            if (expectedGuest && value.guest_id !== expectedGuest) throw new Error('market-guest-identity-mismatch');
            this.accessToken = value.access_token; this.expiresAt = Date.now() + Number(value.expires_in) * 1000; this.account = value.guest_id; this.validated = false; resolve(value.guest_id);
          } catch (error) { this.clear(); reject(error); } finally { this.connecting = false; }
        })();
      };
      const timeout = setTimeout(() => { if (finish()) { this.connecting = false; reject(new Error('pages-login-timeout')); } }, 65_000);
      const poll = setInterval(() => { if (popup.closed && finish()) { this.connecting = false; reject(new Error('pages-popup-closed')); } }, 500);
      window.addEventListener('message', listener);
    });
  }
}

export const pagesSession = new PagesSession();
