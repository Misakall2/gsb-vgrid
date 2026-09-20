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

test('variable rows: empty and one-row tables use valid zero-based offsets', () => {
  const empty = Core.variableVisibleRange({ heights: [], scrollTop: 999, viewportHeight: 500 });
  assert.deepEqual(empty, {
    start: 0, end: 0, offset: 0, totalHeight: 0, maxScroll: 0, tops: [0], heights: [],
  });
  const one = Core.variableVisibleRange({
    heights: [32], scrollTop: 999, viewportHeight: 500, overscan: 0,
  });
  assert.equal(one.start, 0);
  assert.equal(one.end, 1);
  assert.equal(one.offset, 0);
  assert.equal(one.totalHeight, 32);
  assert.equal(one.maxScroll, 0);
});

test('variable rows: stale scroll offsets are clamped to the shortened range', () => {
  const range = Core.variableVisibleRange({
    heights: [32], scrollTop: 32000, viewportHeight: 500, overscan: 0,
  });
  assert.equal(range.start, 0);
  assert.equal(range.end, 1);
});

test('variable rows: mixed row heights use cumulative data tops', () => {
  const widths = [80, 120];
  const rows = [
    ['short', 'short'],
    ['short', '这是一段足够在120像素列里换成第二行的中文长文本内容'],
    ['short', 'short'],
  ];
  const heights = Core.rowHeightsForView(rows, [0, 1, 2], widths);
  assert.deepEqual(heights, [32, 64, 32]);
  const range = Core.variableVisibleRange({
    heights, scrollTop: 32, viewportHeight: 64, overscan: 0,
  });
  assert.deepEqual(range.tops, [0, 32, 96, 128]);
  assert.equal(range.start, 1);
  assert.equal(range.end, 2);
  assert.equal(range.offset, 32);
  assert.equal(range.totalHeight, 128);
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

test('toTSV: data selection includes the frozen first and last columns without a blank tab', () => {
  const data = [['frozen-a', 'b', 'last-a'], ['frozen-b', 'd', 'last-b']];
  const sel = {
    anchor: { r: 0, c: 2 },
    focus: { r: 1, c: 0 },
    rowIds: [0, 1],
  };
  const tsv = Core.toTSV(data, sel);
  assert.equal(tsv, 'frozen-a\tb\tlast-a\nfrozen-b\td\tlast-b');
  assert.ok(!tsv.includes('\t\n'));
  assert.ok(!tsv.endsWith('\t'));
});

test('toTSV: quotes tabs and newlines so selected dimensions stay intact', () => {
  const data = [['a\tb', 'line\n2', 'say "x"']];
  const sel = {
    anchor: { r: 0, c: 0 },
    focus: { r: 0, c: 2 },
    rowIds: [0],
  };
  assert.equal(Core.toTSV(data, sel), '"a\tb"\t"line\n2"\t"say ""x"""');
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

test('editor: IME composition only repositions on scroll/recycle and defers cell clicks', () => {
  assert.equal(Core.compositionEventPolicy('scroll', true), 'reposition');
  assert.equal(Core.compositionEventPolicy('recycle', true), 'reposition');
  assert.equal(Core.compositionEventPolicy('click', true), 'defer-commit');
  assert.equal(Core.compositionEventPolicy('ArrowDown', true), 'none');
  assert.equal(Core.compositionEventPolicy('click', false), 'normal');
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

/* ---------- filtering ---------- */

test('filter: keywords use original data row ids and can reduce to zero rows', () => {
  const data = [
    ['SO-1', '上海'],
    ['SO-2', '北京'],
    ['SO-3', '上海'],
  ];
  assert.deepEqual(Core.filterRows(data, [{ column: 1, keyword: '上海' }]), [0, 2]);
  assert.deepEqual(Core.filterRows(data, [{ column: 1, keyword: '不存在' }]), []);
  assert.deepEqual(Core.filterRows(data, [{ column: 1, keyword: '  ' }]), [0, 1, 2]);
});

test('filter: case-insensitive keyword matching is trim-safe', () => {
  const data = [['Abc'], ['abc'], ['xyz']];
  assert.deepEqual(Core.filterRows(data, [{ column: 0, keyword: ' aB ' }]), [0, 1]);
});

test('filter input: IME composition does not apply every provisional key', () => {
  assert.equal(Core.filterInputValue('old', 'pinyin', true), 'old');
  assert.equal(Core.filterInputValue('old', '北京', false), '北京');
});

/* ---------- grouping ---------- */

test('group: groups retain filtered data ids in original row order', () => {
  const data = [['a'], ['b'], ['a'], ['b']];
  const groups = Core.groupRows(data, [0, 1, 2, 3], 0);
  assert.deepEqual(groups, [
    { key: 'a', rowIds: [0, 2], count: 2 },
    { key: 'b', rowIds: [1, 3], count: 2 },
  ]);
});

test('group: zero filtered rows and one group are valid', () => {
  assert.deepEqual(Core.groupRows([], [], 0), []);
  assert.equal(Core.groupRows([['x']], [0], -1), null);
  assert.deepEqual(Core.groupRows([['x']], [0], 0), [
    { key: 'x', rowIds: [0], count: 1 },
  ]);
});

test('group layout: collapsed group hides rows but keeps one header', () => {
  const groups = [
    { key: 'a', rowIds: [0, 1], count: 2 },
    { key: 'b', rowIds: [2], count: 1 },
  ];
  const laid = Core.layoutGroups(groups, new Set(['a']));
  assert.equal(laid[0].height, ROW_H);
  assert.equal(laid[0].collapsed, true);
  assert.equal(laid[1].top, ROW_H);
  assert.equal(laid[1].height, ROW_H + ROW_H);
});

test('group layout: later groups start after the previous header and rows', () => {
  const groups = [
    { key: 'a', rowIds: [0, 1], count: 2 },
    { key: 'b', rowIds: [2], count: 1 },
  ];
  const laid = Core.layoutGroups(groups);
  assert.equal(laid[0].top, 0);
  assert.equal(laid[0].rowTop(1), ROW_H + ROW_H);
  assert.equal(laid[1].top, ROW_H + 2 * ROW_H);
  assert.equal(laid[1].rowTop(0), laid[1].top + ROW_H);
});

test('grouped virtualization: swaps sticky group at a boundary and keeps DOM sparse', () => {
  const groups = [
    { key: 'a', rowIds: Array.from({ length: 100 }, (_, i) => i), count: 100 },
    { key: 'b', rowIds: Array.from({ length: 100 }, (_, i) => i + 100), count: 100 },
  ];
  const before = Core.visibleGroupedRows({
    groups, scrollTop: 99 * ROW_H, viewportHeight: 10 * ROW_H, overscan: 0,
  });
  assert.equal(before.currentGroup.key, 'a');
  assert.ok(before.items.length < 25);
  const atBoundary = Core.visibleGroupedRows({
    groups, scrollTop: 101 * ROW_H, viewportHeight: 10 * ROW_H, overscan: 0,
  });
  assert.equal(atBoundary.currentGroup.key, 'b');
  assert.equal(atBoundary.totalHeight, 2 * (ROW_H + 100 * ROW_H));
});

/* ---------- data-coordinate selection ---------- */

test('selection: filtered movement uses data ids, not screen row numbers', () => {
  const ids = [2, 7, 9];
  let sel = Core.createDataSelection(2, 0);
  sel = Core.moveDataSelection(sel, 1, 0, ids, 2, false);
  assert.deepEqual(sel.focus, { r: 7, c: 0 });
  sel = Core.moveDataSelection(sel, 0, 1, ids, 2, true);
  sel = Core.moveDataSelection(sel, 1, 1, ids, 2, true);
  assert.deepEqual(sel.focus, { r: 9, c: 1 });
  assert.deepEqual(sel.rowIds, [7, 9]);
  assert.ok(Core.isSelected(sel, 7, 0));
  assert.ok(!Core.isSelected(sel, 8, 0));
});

test('selection: TSV follows the filtered/group view row order', () => {
  const data = [
    ['a0'], ['a1'], ['a2'], ['a3'],
  ];
  const sel = {
    anchor: { r: 3, c: 0 },
    focus: { r: 1, c: 0 },
    rowIds: [3, 1],
  };
  assert.equal(Core.toTSV(data, sel), 'a3\na1');
});

test('selection: collapsed groups preserve the original editing coordinate', () => {
  const sel = Core.createDataSelection(123, 4);
  const collapsed = Core.moveDataSelection(sel, 0, 0, [], 10, false);
  assert.equal(collapsed, sel);
  assert.deepEqual(sel.focus, { r: 123, c: 4 });
});

/* ---------- column widths ---------- */

test('column resize: width changes stay independent and respect minimum', () => {
  const widths = [100, 80];
  const wider = Core.resizeColumn(widths, 0, 25, 40);
  assert.deepEqual(wider, [125, 80]);
  assert.deepEqual(widths, [100, 80]);
  assert.deepEqual(Core.resizeColumn(widths, 1, -1000, 40), [100, 40]);
});

test('column metrics: frozen and scrolling panes share the same coordinates', () => {
  const metrics = Core.columnMetrics([120, 80, 200]);
  assert.deepEqual(metrics.lefts, [0, 120, 200, 400]);
  assert.equal(metrics.totalWidth, 400);
});
