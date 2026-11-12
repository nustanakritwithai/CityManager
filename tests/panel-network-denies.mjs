// Explicitly deny provider endpoints at the fixture origin, including nested app paths.
export const panelProviderDenials = origin => [
  origin + '/api/city-advisor/*', origin + '/*/api/city-advisor/*',
  origin + '/chat/completions*', origin + '/*/chat/completions*',
];

// Audit attempts as well as blocking them, including requests at the fixture origin.
export const isPanelProviderRequest = url => {
  try { return /\/(?:api\/city-advisor\/|chat\/completions)/.test(new URL(url).pathname); }
  catch { return false; }
};
