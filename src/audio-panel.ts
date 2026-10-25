/** Sound settings inside the atmosphere menu: mute, five volumes, the playing track and credits. */
import { TRACKS, type AudioEngine } from './audio-engine.ts';
import type { AudioSettings } from './audio-settings.ts';

const SLIDERS: readonly [keyof Omit<AudioSettings, 'muted'>, string][] = [
  ['master', 'เสียงรวม'], ['ui', 'ปุ่มและเครื่องมือ'], ['events', 'เหตุการณ์ในเมือง'], ['ambience', 'บรรยากาศ'], ['music', 'เพลง'],
];

export function installAudioPanel(engine: AudioEngine, host: HTMLElement): { sync(): void } {
  const section = document.createElement('section'); section.className = 'audio-settings'; section.setAttribute('aria-label', 'ตั้งค่าเสียง');
  const heading = document.createElement('h3'); heading.textContent = 'เสียง';
  const mute = document.createElement('label'), muteInput = document.createElement('input');
  mute.className = 'atmosphere-check'; muteInput.type = 'checkbox'; muteInput.id = 'audio-mute';
  muteInput.addEventListener('change', () => { engine.change({ muted: muteInput.checked }); sync(); });
  mute.append(muteInput, document.createTextNode('ปิดเสียงทั้งหมด (U)'));
  const sliders = SLIDERS.map(([key, text]) => {
    const label = document.createElement('label'), name = document.createElement('span'), input = document.createElement('input');
    label.className = 'audio-slider'; name.textContent = text;
    input.type = 'range'; input.min = '0'; input.max = '100'; input.step = '5'; input.dataset.audio = key; input.setAttribute('aria-label', `ระดับ${text}`);
    input.addEventListener('input', () => engine.change({ [key]: Number(input.value) / 100 }));
    label.append(name, input); return { key, input };
  });
  const track = document.createElement('p'); track.className = 'audio-track';
  const next = document.createElement('button'); next.type = 'button'; next.id = 'audio-next'; next.textContent = 'เพลงถัดไป';
  next.addEventListener('click', () => { engine.nextTrack(); sync(); });
  const credit = document.createElement('p'); credit.className = 'atmosphere-note';
  credit.textContent = `เสียงประกอบ Kenney · เพลง ${TRACKS.map(t => `${t.title} (${t.artist})`).join(', ')} · ทั้งหมด CC0 · เสียงเริ่มหลังแตะหน้าจอครั้งแรก`;
  section.append(heading, mute, ...sliders.map(s => s.input.parentElement!), track, next, credit);
  host.append(section);
  const sync = () => {
    muteInput.checked = engine.settings.muted;
    for (const { key, input } of sliders) { input.value = String(Math.round(engine.settings[key] * 100)); input.disabled = engine.settings.muted; }
    track.textContent = `เพลง: ${engine.nowPlaying.title} · ${engine.nowPlaying.artist}`;
  };
  sync();
  return { sync };
}
