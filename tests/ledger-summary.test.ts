import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIGEST_GROUPS, groupLabel, ledgerDigest } from '../src/ledger-summary.ts';

const row = (tick: number, from: string, to: string, value: number, label: string) => ({ tick, from, to, value, label });

test('entry numbers fold into one kind per label', () => {
  assert.equal(groupLabel('ซื้อขายพืชผล · รายการ #2286'), 'ซื้อขายพืชผล');
  assert.equal(groupLabel('ส่งออกพืชผลส่วนเกิน'), 'ส่งออกพืชผลส่วนเกิน');
  assert.equal(groupLabel('รายการอื่น: Crop export #2288'), 'Crop export');
  assert.equal(groupLabel('#12'), '#12');
});

test('digest sums in and out for one wallet over the last 30 days only', () => {
  const rows = [
    row(314, 'nature', 'firm:6', 96, 'เก็บเกี่ยวพืชผล'), row(313, 'nature', 'firm:6', 96, 'เก็บเกี่ยวพืชผล'),
    row(314, 'firm:6', 'outside', 72, 'ส่งออกพืชผลส่วนเกิน'), row(314, 'firm:6', 'firm:8', 24, 'ซื้อขายพืชผล'),
    row(280, 'nature', 'firm:6', 999, 'เก็บเกี่ยวพืชผล'), // older than 30 days
    row(314, 'firm:8', 'outside', 500, 'ส่งออกพืชผลส่วนเกิน'), // another wallet
    row(314, 'firm:6', 'firm:6', 7, 'ย้ายภายใน'),
  ];
  const d = ledgerDigest(rows, 'firm:6', 314);
  assert.deepEqual([d.fromTick, d.toTick, d.totalIn, d.totalOut, d.entries], [285, 314, 192, 96, 4]);
  assert.deepEqual(d.groups.map(g => [g.direction, g.label, g.total, g.entries]), [
    ['in', 'เก็บเกี่ยวพืชผล', 192, 2], ['out', 'ส่งออกพืชผลส่วนเกิน', 72, 1], ['out', 'ซื้อขายพืชผล', 24, 1]]);
});

test('small kinds fold into one other row per direction, totals unchanged', () => {
  const rows = Array.from({ length: 7 }, (_, i) => row(10, 'w', 'x', 100 - i, `ค่า ${i} #${i}`));
  const d = ledgerDigest(rows, 'w', 10);
  assert.equal(d.groups.length, DIGEST_GROUPS + 1);
  assert.deepEqual(d.groups.at(-1), { key: 'out:other', label: 'อื่น ๆ', direction: 'out', total: 96 + 95 + 94, entries: 3 });
  assert.equal(d.groups.reduce((n, g) => n + g.total, 0), d.totalOut);
});
