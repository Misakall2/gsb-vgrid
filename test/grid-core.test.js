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

test('visibleRange: grouped rows can reserve a frozen group header', () => {
  const r = Core.visibleRange({
    scrollTop: 7 * ROW_H,
    viewportHeight: 10 * ROW_H,
    rowCount: 100,
    topOffset: Core.GROUP_H,
    overscan: 0,
  });
  assert.equal(r.start, 7);
  assert.equal(r.offset, Core.GROUP_H + 7 * ROW_H);
});

/* ---------- filtering and grouping ---------- */

test('filterRows: returns data-layer row ids and supports zero results', () => {
  const rows = [
    ['SO-1', '上海'],
    ['SO-2', '北京'],
    ['SO-3', '上海'],
  ];
  assert.deepEqual(Core.filterRows(rows, [{ columnIndex: 1, keyword: '上海' }]), [0, 2]);
  assert.deepEqual(Core.filterRows(rows, [{ columnIndex: 1, keyword: '不存在' }]), []);
  assert.deepEqual(Core.filterRows(rows, [{ columnIndex: 1, keyword: '' }]), [0, 1, 2]);
});

test('filterRows: keyword match is case insensitive', () => {
  const rows = [['ABC'], ['abc'], ['xyz']];
  assert.deepEqual(Core.filterRows(rows, [{ columnIndex: 0, keyword: 'aB' }]), [0, 1]);
});

test('groupRows: preserves first-seen order, counts rows, and maps every row id', () => {
  const data = [['a', 1], ['b', 2], ['a', 3], ['b', 4], ['c', 5]];
  const result = Core.groupRows([0, 1, 2, 3, 4], data, 0);
  assert.deepEqual(result.groups.map((g) => g.key), ['a', 'b', 'c']);
  assert.deepEqual(result.groups.map((g) => g.count), [2, 2, 1]);
  assert.deepEqual(result.visibleRowIds, [0, 2, 1, 3, 4]);
  assert.equal(result.groupIndexByRowId.get(0), 0);
  assert.equal(result.groupIndexByRowId.get(1), 1);
  assert.equal(result.groupIndexByRowId.get(4), 2);
});

test('groupRows: collapsed group hides only its filtered rows', () => {
  const data = [['a', 1], ['b', 2], ['a', 3], ['c', 4]];
  const collapsed = new Set(['a']);
  const result = Core.groupRows([0, 1, 2, 3], data, 0, collapsed);
  assert.deepEqual(result.visibleRowIds, [1, 3]);
  assert.equal(result.groupIndexByRowId.get(2), 0);
});

test('groupRows: a single remaining group still maps every filtered row', () => {
  const data = [['上海', 'x'], ['北京', 'y'], ['上海', 'z']];
  const ids = Core.filterRows(data, [{ columnIndex: 0, keyword: '上海' }]);
  const result = Core.groupRows(ids, data, 0);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.visibleRowIds, [0, 2]);
});

test('currentGroupIndex: switches the frozen header when crossing group boundaries', () => {
  const data = [['a'], ['a'], ['b'], ['b'], ['b']];
  const grouped = Core.groupRows([0, 1, 2, 3, 4], data, 0);
  const opts = {
    rowIds: grouped.visibleRowIds,
    groupIndexByRowId: grouped.groupIndexByRowId,
    topOffset: Core.GROUP_H,
  };
  assert.equal(Core.currentGroupIndex(Object.assign({ scrollTop: Core.GROUP_H }, opts)), 0);
  assert.equal(Core.currentGroupIndex(Object.assign({ scrollTop: Core.GROUP_H + ROW_H }, opts)), 0);
  assert.equal(Core.currentGroupIndex(Object.assign({ scrollTop: Core.GROUP_H + 2 * ROW_H }, opts)), 1);
  assert.equal(Core.currentGroupIndex(Object.assign({ scrollTop: 1e9 }, opts)), 1);
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

test('selection: visible navigation uses data row ids after filtering', () => {
  let sel = Core.createSelection(0, 0);
  sel = Core.moveVisibleFocus(sel, 1, 0, [0, 2, 9], 3, false);
  assert.deepEqual(sel.focus, { r: 2, c: 0 });
  sel = Core.moveVisibleFocus(sel, 1, 0, [0, 2, 9], 3, false);
  assert.deepEqual(sel.focus, { r: 9, c: 0 });
});

test('selection: nearest filtered row keeps movement anchored to the data layer', () => {
  const sel = Core.createSelection(5, 1);
  const moved = Core.moveVisibleFocus(sel, 1, 0, [0, 2, 4], 3, false);
  assert.deepEqual(moved.focus, { r: 4, c: 1 });
});

test('selection: no visible rows is a no-op after filtering to zero', () => {
  const sel = Core.createSelection(3, 2);
  assert.equal(Core.moveVisibleFocus(sel, 1, 0, [], 3, false), sel);
  assert.equal(Core.tabNextVisible(sel, [], 3, false), sel);
});

test('tab: visible mode traverses filtered data rows and wraps columns', () => {
  let sel = Core.createSelection(2, 2);
  sel = Core.tabNextVisible(sel, [2, 7], 3, false);
  assert.deepEqual(sel.focus, { r: 7, c: 0 });
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

test('toTSV: filtered view only copies visible selected data rows', () => {
  const data = [['a0'], ['hidden'], ['a2'], ['hidden2'], ['a4']];
  const sel = { anchor: { r: 0, c: 0 }, focus: { r: 4, c: 0 } };
  assert.equal(Core.toTSV(data, sel, [0, 2, 4]), 'a0\na2\na4');
});

/* ---------- column widths ---------- */

test('columns: resize clamps to the minimum and does not mutate input', () => {
  const cols = [{ title: 'A', width: 100 }, { title: 'B', width: 80 }];
  const resized = Core.resizeColumn(cols, 1, 20, 40);
  assert.equal(resized[1].width, 40);
  assert.equal(cols[1].width, 80);
  assert.deepEqual(resized[0], { title: 'A', width: 100 });
});

test('columns: layout exposes left offsets and total width for frozen alignment', () => {
  const cols = [{ title: 'A', width: 100 }, { title: 'B', width: 75 }, { title: 'C', width: 50 }];
  assert.deepEqual(Core.columnLayout(cols), { lefts: [0, 100, 175], totalWidth: 225 });
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
