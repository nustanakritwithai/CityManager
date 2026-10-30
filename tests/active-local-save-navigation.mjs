// Readiness only: never wrap fixture writes, clicks, or the navigation command in retry.
export const documentIdentityScript = 'window.__saveHarnessDocument = crypto.randomUUID();';
export function cdpCommandError(error, method, stage) {
  const result = new Error(`CDP ${method} [${stage}]: ${error.message ?? String(error)}`);
  result.code = error.code;
  result.protocolMessage = error.message;
  result.method = method;
  result.stage = stage;
  return result;
}
export function isNavigationContextLoss(error) {
  return error?.code === -32000 && /^(Inspected target navigated or closed|Execution context was destroyed\.?|Cannot find context with specified id)$/.test((error.protocolMessage ?? error.message));
}
export async function waitForNewDocument({evaluate, previous, url, ready = 'true', timeout = 60000, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const start = now();
  // Short-circuit on identity and URL before consulting application readiness.
  const expression = `typeof window.__saveHarnessDocument==='string'&&window.__saveHarnessDocument!==${JSON.stringify(previous)}&&location.href===${JSON.stringify(url)}&&document.readyState==='complete'&&(${ready})`;
  while (now() - start < timeout) {
    try { if (await evaluate(expression)) return; }
    catch (error) { if (!isNavigationContextLoss(error)) throw error; }
    await sleep(100);
  }
  throw new Error(`new-document readiness timeout: ${url}`);
}
export async function navigateDocument({send, evaluate, url, reload = false, ready, timeout, now, sleep}) {
  const previous = await evaluate('window.__saveHarnessDocument');
  // Navigation itself is single-shot, including any uncertain CDP failure.
  const result = await send(reload ? 'Page.reload' : 'Page.navigate', reload ? {} : {url});
  if (result?.errorText) throw new Error(`navigation failed: ${result.errorText}`);
  await waitForNewDocument({evaluate, previous, url, ready, timeout, now, sleep});
}
