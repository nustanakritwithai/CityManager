import assert from 'node:assert/strict';

/** Mock speech output only. This does not assert installed Thai voice quality or physical-device audio. */
export const guideSpeechProbeScript = `(() => {
  const probe = window.__guideSpeech = { calls: [], cancels: 0, remoteOnly: false };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
    getVoices: () => [{ lang: 'th-TH', localService: !probe.remoteOnly }],
    speak: utterance => probe.calls.push({ text: utterance.text, local: utterance.voice.localService, volume: utterance.volume }),
    cancel: () => { probe.cancels++; }
  } });
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
})();`;

export async function checkGuideSpeechUI({ evaluate, press, until, key, send }) {
  const snapshot = await evaluate('window.cityManager.snapshot()');
  assert.equal(await evaluate('window.__guideSpeech.calls.length'), 0, 'No automatic speech');
  // Audio smoke enters here with the atmosphere menu open.
  await press('#open-city-advice'); await until('!document.querySelector("#guide-card").hidden');
  assert.equal(await evaluate('document.querySelector("#atmosphere-menu").hidden'), true, 'Reopen closes overlay');
  await press('#guide-listen'); assert.equal(await evaluate('window.__guideSpeech.calls.length'), 1);
  assert.equal(await evaluate('window.__guideSpeech.calls[0].local'), true);
  await press('#guide-listen'); assert.equal(await evaluate('window.__guideSpeech.calls.length'), 2);
  assert.equal(await evaluate('window.__guideSpeech.cancels'), 1, 'Repeated tap replaces rather than queues');
  await press('#guide-stop-voice'); assert.equal(await evaluate('window.__guideSpeech.cancels'), 2);
  await press('#guide-listen'); await key('u');
  await until('window.__guideSpeech.cancels === 3');
  await press('#guide-listen'); assert.equal(await evaluate('window.__guideSpeech.calls.length'), 3, 'Mute prevents voice start');
  await key('u');
  await press('#guide-dismiss'); assert.equal(await evaluate('document.querySelector("#guide-card").hidden'), true);
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await press('#atmosphere-toggle'); await press('#open-city-advice');
  await until('!document.querySelector("#guide-card").hidden');
  const rect = await evaluate('(()=>{const r=document.querySelector("#guide-card").getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()');
  assert.ok(rect.left >= 0 && rect.right <= rect.width + 1 && rect.top >= 0 && rect.bottom <= rect.height, 'Advice stays inside mobile-emulated viewport');
  await evaluate('window.__guideSpeech.remoteOnly = true');
  await press('#guide-listen'); assert.equal(await evaluate('window.__guideSpeech.calls.length'), 3, 'Never use a remote-only Thai voice');
  assert.match(await evaluate('document.querySelector("#guide-card [role=status]").textContent'), /ยังไม่มีเสียงภาษาไทย/);
  await press('#guide-dismiss');
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate('window.cityManager.snapshot()'), snapshot, 'Advice never changes the paused city');
}
