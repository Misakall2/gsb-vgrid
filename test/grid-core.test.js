'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../grid-core.js');

const ROW_H = Core.ROW_H;

/* ---------- visibleRange ---------- */

test('visibleRange: empty table renders nothing', () => {
  const r = Core.visibleRange({ scrollTop: 0, viewportHeight: 500, rowCount: 0 });
  assert.deepEqual(r, { start: 0, end: 0, offset: 0, totalHeight: 0 });
});

test('visibleRange: single row fills exactly one row of canvas', () => {
  const r = Core.visibleRange({ scrollTop: 0, viewportHeight: 500, rowCount: 1, overscan: 0 });
  assert.equal(r.start, 0);
  assert.equal(r.end, 1);
  assert.equal(r.totalHeight, ROW_H);
});

test('visibleRange: mid-scroll window is row-aligned', () => {
  const r = Core.visibleRange({
    scrollTop: 100 * ROW_H, viewportHeight: 10 * ROW_H, rowCount: 10000, overscan: 0,
  });
  assert.equal(r.start, 100);
  assert.equal(r.end, 110);
  assert.equal(r.offset, 100 * ROW_H);
});

test('visibleRange: offset always equals start * rowHeight (no drift)', () => {
  for (const st of [0, 1, 17, 319, 320, 321, 123456, 319999]) {
    const r = Core.visibleRange({ scrollTop: st, viewportHeight: 640, rowCount: 10000, overscan: 0 });
    assert.equal(r.offset, r.start * ROW_H, `scrollTop=${st}`);
    assert.equal(r.start, Math.floor(Math.min(st, r.totalHeight - 640) / ROW_H));
  }
});

test('visibleRange: fast flick to the very bottom clamps to last rows', () => {
  const r = Core.visibleRange({
    scrollTop: 1e9, viewportHeight: 10 * ROW_H, rowCount: 10000, overscan: 0,
  });
  assert.equal(r.end, 10000);
  assert.equal(r.start, 9990);
});

test('visibleRange: overscan extends but never leaves data bounds', () => {
  const top = Core.visibleRange({ scrollTop: 0, viewportHeight: 320, rowCount: 10000, overscan: 4 });
  assert.equal(top.start, 0);
  const bottom = Core.visibleRange({ scrollTop: 1e9, viewportHeight: 320, rowCount: 10000, overscan: 4 });
  assert.equal(bottom.end, 10000);
});

/* ---------- selection model ---------- */

test('selection: move clamps at grid edges', () => {
  const bounds = { rowCount: 100, colCount: 10 };
  let sel = Core.createSelection(0, 0);
  sel = Core.moveFocus(sel, -1, -1, bounds, false);
  assert.deepEqual(sel.focus, { r: 0, c: 0 });
  sel = Core.moveFocus(sel, 1000, 1000, bounds, false);
  assert.deepEqual(sel.focus, { r: 99, c: 9 });
});

test('selection: shift-extend keeps anchor, normalizes backwards ranges', () => {
  const bounds = { rowCount: 100, colCount: 10 };
  let sel = Core.createSelection(5, 5);
  sel = Core.moveFocus(sel, -3, -4, bounds, true);
  assert.deepEqual(sel.anchor, { r: 5, c: 5 });
  assert.deepEqual(sel.focus, { r: 2, c: 1 });
  assert.deepEqual(Core.normalizeSelection(sel), { r1: 2, c1: 1, r2: 5, c2: 5 });
});

test('selection: isSelected covers the whole rectangle inclusively', () => {
  const sel = { anchor: { r: 2, c: 1 }, focus: { r: 4, c: 3 } };
  assert.ok(Core.isSelected(sel, 2, 1));
  assert.ok(Core.isSelected(sel, 4, 3));
  assert.ok(Core.isSelected(sel, 3, 2));
  assert.ok(!Core.isSelected(sel, 1, 2));
  assert.ok(!Core.isSelected(sel, 3, 4));
});

test('selection: survives DOM recycling because it is pure data', () => {
  // Rows far outside any rendered window stay selected; when the row is
  // rebuilt after scrolling back, isSelected still returns true.
  const bounds = { rowCount: 10000, colCount: 10 };
  let sel = Core.createSelection(3, 2);
  sel = Core.moveFocus(sel, 9990, 5, bounds, true);
  assert.ok(Core.isSelected(sel, 9993, 7));
  assert.ok(Core.isSelected(sel, 3, 2));
});

test('selection: moves are no-ops on an empty table', () => {
  const bounds = { rowCount: 0, colCount: 10 };
  const sel = Core.createSelection(0, 0);
  assert.equal(Core.moveFocus(sel, 1, 1, bounds, false), sel);
  assert.equal(Core.tabNext(sel, bounds, false), sel);
});

test('tab: walks right, wraps to next row, clamps at the last cell', () => {
  const bounds = { rowCount: 2, colCount: 3 };
  let sel = Core.createSelection(0, 2);
  sel = Core.tabNext(sel, bounds, false);
  assert.deepEqual(sel.focus, { r: 1, c: 0 });
  sel = Core.tabNext(sel, bounds, true);
  assert.deepEqual(sel.focus, { r: 0, c: 2 });
  sel = Core.createSelection(1, 2);
  sel = Core.tabNext(sel, bounds, false);
  assert.deepEqual(sel.focus, { r: 1, c: 2 });
});

/* ---------- TSV copy ---------- */

test('toTSV: rectangular selection becomes tab/newline text', () => {
  const data = [['a', 'b', 'c'], ['d', 'e', 'f'], ['g', 'h', 'i']];
  const sel = { anchor: { r: 0, c: 0 }, focus: { r: 1, c: 1 } };
  assert.equal(Core.toTSV(data, sel), 'a\tb\nd\te');
});

test('toTSV: reversed selection copies the same rectangle', () => {
  const data = [['a', 'b'], ['c', 'd']];
  const sel = { anchor: { r: 1, c: 1 }, focus: { r: 0, c: 0 } };
  assert.equal(Core.toTSV(data, sel), 'a\tb\nc\td');
});

test('toTSV: long cell values are copied in full', () => {
  const long = '很长的备注'.repeat(50);
  const data = [[long, 'x']];
  const sel = Core.createSelection(0, 0);
  assert.equal(Core.toTSV(data, sel), long);
});

/* ---------- editor key state machine ---------- */

test('editor: during IME composition no key commits or moves', () => {
  for (const key of ['Enter', 'Tab', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a']) {
    assert.equal(Core.editorKeyAction(key, true), 'none', key);
  }
});

test('editor: plain keys commit/cancel/move when not composing', () => {
  assert.equal(Core.editorKeyAction('Enter', false), 'commit');
  assert.equal(Core.editorKeyAction('Escape', false), 'cancel');
  assert.equal(Core.editorKeyAction('Tab', false), 'commit-tab');
  assert.equal(Core.editorKeyAction('ArrowDown', false), 'commit-down');
  assert.equal(Core.editorKeyAction('x', false), 'none');
});

/* ---------- data generation ---------- */

test('data: deterministic, correct size, includes long-note rows', () => {
  const a = Core.generateData(10000);
  const b = Core.generateData(10000);
  assert.equal(a.length, 10000);
  assert.deepEqual(a[1234], b[1234]);
  assert.ok(a[0][9].length > 50, 'row 0 carries the long note');
  assert.equal(a[0].length, 10);
});

test('data: zero and one row datasets are valid', () => {
  assert.deepEqual(Core.generateData(0), []);
  assert.equal(Core.generateData(1).length, 1);
});
