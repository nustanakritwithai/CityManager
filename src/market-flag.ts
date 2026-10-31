/**
 * Single switch for the online market. OFF: no market writes or network, saving never waits on the
 * market, no market buttons/panel/entry gate. Existing market data inside saves is kept untouched
 * (it is carried through unchanged). Re-enable by setting this to true.
 */
export const MARKET_ENABLED = false;
export const marketBaseUrl = (configured: string | undefined): string => MARKET_ENABLED ? (configured ?? '') : '';
