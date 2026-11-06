/** Only installed, local Thai voices are allowed. Never silently fall back to network TTS. */
export const localThaiVoice = (voices: readonly SpeechSynthesisVoice[]) => voices.find(v => v.localService && /^th(?:-|$)/i.test(v.lang));
export const guideSpeechTopic = (key: string) => key.startsWith('advice:') ? key.split(':').slice(0, 2).join(':') : key.split(':')[0];
export class GuideSpeech {
  private watcher: ReturnType<typeof setInterval> | null = null;
  private utterance: SpeechSynthesisUtterance | null = null;
  private volume: () => number;
  private report: (text: string) => void;
  constructor(volume: () => number, report: (text: string) => void) {
    this.volume = volume; this.report = report;
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); });
  }
  stop() { if (this.watcher !== null) clearInterval(this.watcher); this.watcher = null; if (this.utterance && 'speechSynthesis' in window) { this.utterance.onend = this.utterance.onerror = null; window.speechSynthesis.cancel(); this.report('หยุดเสียงแล้ว'); } this.utterance = null; }
  sync() { if (this.volume() <= 0) this.stop(); }
  speak(text: string) {
    this.stop();
    if (this.volume() <= 0) { this.report('ปิดเสียงอยู่ เปิดเสียงในเมนูบรรยากาศก่อนฟัง'); return; }
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) { this.report('เครื่องนี้ไม่รองรับเสียงพูด อ่านคำแนะนำด้านบนได้'); return; }
    const voice = localThaiVoice(window.speechSynthesis.getVoices());
    if (!voice) { this.report('ยังไม่มีเสียงภาษาไทยในเครื่อง อ่านข้อความได้ หรือติดตั้งเสียงไทยในการตั้งค่าเครื่องแล้วกดฟังอีกครั้ง'); return; }
    const utterance = new SpeechSynthesisUtterance(text); this.utterance = utterance;
    utterance.lang = 'th-TH'; utterance.voice = voice; utterance.volume = Math.min(1, Math.max(0, this.volume())); utterance.rate = .95;
    utterance.onend = () => { this.stop(); this.report('กดฟังซ้ำได้'); };
    utterance.onerror = () => { this.stop(); this.report('เล่นเสียงไม่ได้ อ่านคำแนะนำด้านบนได้'); };
    try { window.speechSynthesis.speak(utterance); const started = Date.now(); this.watcher = setInterval(() => { this.sync(); if (Date.now() - started > 60000) { this.stop(); this.report('กดฟังซ้ำได้ หรืออ่านคำแนะนำด้านบน'); } }, 200); this.report('กำลังอ่านคำแนะนำ กดหยุดเสียงได้'); } catch { this.stop(); this.report('เล่นเสียงไม่ได้ อ่านคำแนะนำด้านบนได้'); }
  }
}
