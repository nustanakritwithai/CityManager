import test from 'node:test';
import assert from 'node:assert/strict';
import { createCity, serialize, step, MAX_CITY_BUILDINGS, access } from '../src/sim.ts';
import { growthAdvice } from '../src/growth-advice.ts';
import { localThaiVoice, GuideSpeech, guideSpeechTopic } from '../src/guide-speech.ts';

test('empty city uses existing road tutorial on request, without changing city', () => {
  const city = createCity(61025, { starter: false }), before = serialize(city);
  assert.equal(growthAdvice(city), null);
  assert.equal(growthAdvice(city, true)?.id, 'road');
  assert.equal(serialize(city), before);
});
test('real developed city advice remains read-only and deterministic', () => {
  const city = createCity(61025); for (let i = 0; i < 90; i++) step(city);
  const before = serialize(city), result = growthAdvice(city, true);
  assert.ok(result); assert.equal(result.id, 'growth.vacancies-remain'); assert.equal(result.tool, null); assert.deepEqual(growthAdvice(city, true), result); assert.equal(serialize(city), before);
});
test('building cap never advises adding more zones', () => {
  const city = createCity(61025); city.buildings = Array.from({ length: MAX_CITY_BUILDINGS }, (_, id) => ({ id, cell: id, zone: 'R' as const, level: 1, age: 30 }));
  assert.equal(growthAdvice(city)?.id, 'building-cap'); assert.equal(growthAdvice(city)?.tool, null);
});
test('disconnected plant asks for roads before more plants', () => {
  const city = createCity(61025); city.plants.push({ id: city.nextId++, cell: 0, kind: 'power', tick: 0 });
  assert.equal(growthAdvice(city)?.id, 'plant-road'); assert.equal(growthAdvice(city)?.tool, 'road');
});
test('speech never selects remote or non-Thai voices', () => {
  const voice = (lang: string, localService: boolean) => ({ lang, localService }) as SpeechSynthesisVoice;
  assert.equal(localThaiVoice([voice('th-TH', false), voice('en-US', true)]), undefined);
  const thai = voice('th-TH', true); assert.equal(localThaiVoice([voice('th', false), thai]), thai);
});
test('speech uses explicit calls only, cancels repeat and mute, gracefully falls back', () => {
  let count = 0, cancelled = 0, volume = .5, status = '', visibility = () => {}, utterance: { onerror?: () => void } | null = null, voices: SpeechSynthesisVoice[] = [];
  const oldWindow = globalThis.window, oldDocument = globalThis.document, oldUtterance = globalThis.SpeechSynthesisUtterance;
  class Utterance { text: string; constructor(text: string) { this.text = text; } }
  Object.assign(globalThis, { document: { hidden: false, addEventListener(_name: string, listener: () => void) { visibility = listener; } }, SpeechSynthesisUtterance: Utterance, window: { SpeechSynthesisUtterance: Utterance, speechSynthesis: { getVoices: () => voices, cancel: () => cancelled++, speak: (u: { onerror?: () => void }) => { utterance = u; count++; } } } });
  try {
    const speech = new GuideSpeech(() => volume, text => status = text); assert.equal(count, 0);
    speech.speak('ทดสอบ'); assert.match(status, /ยังไม่มีเสียง/); assert.equal(count, 0);
    voices = [{ lang: 'th-TH', localService: true } as SpeechSynthesisVoice];
    speech.speak('ทดสอบ'); assert.equal(count, 1); speech.speak('อีกครั้ง'); assert.equal(count, 2); assert.equal(cancelled, 1);
    volume = 0; speech.sync(); assert.equal(cancelled, 2); speech.speak('ปิด'); assert.equal(count, 2); speech.stop();
    volume = .5; speech.speak('ซ่อนหน้า'); Object.defineProperty(document, 'hidden', { value: true }); visibility(); assert.equal(cancelled, 3);
    speech.speak('ผิดพลาด'); (utterance as { onerror?: () => void } | null)?.onerror?.(); assert.match(status, /เล่นเสียงไม่ได้/);
    Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true }); delete (window as Partial<Window>).speechSynthesis;
    speech.speak('ไม่รองรับ'); assert.match(status, /ไม่รองรับ/);
  } finally { Object.assign(globalThis, { window: oldWindow, document: oldDocument, SpeechSynthesisUtterance: oldUtterance }); }
});

test('actual utility shortages select the matching plant and respect affordability', () => {
  const city = createCity(61025);
  const cells = city.cells.flatMap((cell, i) => !cell.road && access(city, i) ? [i] : []);
  city.buildings = cells.slice(0, 16).map((cell, id) => ({ cell, id, zone: 'I' as const, level: 1, age: 30 }));
  const before = serialize(city);
  assert.equal(growthAdvice(city)?.id, 'power'); assert.equal(growthAdvice(city)?.tool, 'power');
  assert.equal(serialize(city), before);
  city.accounts.treasury = 500_000; city.parks.push({ id: 999, cell: 0, tick: 0, level: 1, staffing: { allocations: [], workDays: { '1': 1 } } });
  assert.equal(growthAdvice(city)?.tool, null, 'reserved wages are unavailable for construction');
  city.accounts.treasury = 0; assert.equal(growthAdvice(city)?.tool, null);
  city.buildings = cells.slice(0, 24).map((cell, id) => ({ cell, id, zone: 'F' as const, level: 1, age: 30 }));
  assert.equal(growthAdvice(city)?.id, 'water');
});

test('numeric refreshes keep speech topic stable; changed advice interrupts', () => {
  assert.equal(guideSpeechTopic('advice:power:สำรอง 1'), guideSpeechTopic('advice:power:สำรอง 0'));
  assert.notEqual(guideSpeechTopic('advice:power:0'), guideSpeechTopic('advice:water:0'));
  assert.equal(guideSpeechTopic('2:1/4'), guideSpeechTopic('2:2/4'));
});
