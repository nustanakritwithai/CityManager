/**
 * The game keeps no data in the browser. Preferences and feature switches that used to live in
 * localStorage now last for the current page visit only; the city and identity live on the server.
 */
const values = new Map<string, string>();
export const sessionMemory: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => { values.set(key, String(value)); },
  removeItem: key => { values.delete(key); },
};
