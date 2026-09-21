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

/* ---------- regression: virtual-row incidents ---------- */

test('regression: shift selection at a vertical edge does not lose the last column', () => {
  const ids = [3, 8, 11];
  let sel = Core.createDataSelection(11, 3);
  sel = Core.moveDataSelection(sel, -1, 0, ids, 4, true);
  sel = Core.moveDataSelection(sel, -1, 0, ids, 4, true);
  sel = Core.moveDataSelection(sel, -1, 0, ids, 4, true);
  assert.deepEqual(sel.focus, { r: 3, c: 3 });
  assert.deepEqual(sel.rowIds, [3, 8, 11]);
  assert.ok(Core.isSelected(sel, 3, 3));
  assert.ok(Core.isSelected(sel, 11, 3));

  sel = Core.createDataSelection(3, 1);
  sel = Core.moveDataSelection(sel, -1, 0, ids, 4, true);
  assert.deepEqual(sel.focus, { r: 3, c: 1 });
  assert.deepEqual(sel.rowIds, [3]);
  assert.ok(!Core.isSelected(sel, 3, 0));
});

test('regression: TSV dimensions exactly match the selected data rectangle', () => {
  const data = [
    ['a', 'b', 'c'],
    ['d', 'e', 'f'],
    ['g', 'h', 'i'],
  ];
  const sel = {
    anchor: { r: 0, c: 0 },
    focus: { r: 2, c: 2 },
    rowIds: [0, 1, 2],
  };
  const tsv = Core.toTSV(data, sel);
  assert.equal(tsv, 'a\tb\tc\nd\te\tf\ng\th\ti');
  const rows = tsv.split('\n');
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row.split('\t').length), [3, 3, 3]);

  const filteredSel = {
    anchor: { r: 2, c: 0 },
    focus: { r: 2, c: 2 },
    rowIds: [2],
  };
  assert.deepEqual(Core.toTSV(data, filteredSel).split('\t'), ['g', 'h', 'i']);
});

test('regression: tabs, newlines and quotes in cells do not change TSV dimensions', () => {
  const data = [['a\tb', 'line1\nline2', 'say "x"']];
  const tsv = Core.toTSV(data, {
    anchor: { r: 0, c: 0 },
    focus: { r: 0, c: 2 },
    rowIds: [0],
  });
  assert.equal(tsv, '"a\tb"\t"line1\nline2"\t"say ""x"""');
  assert.ok(!tsv.endsWith('\t'));
  const logicalRow = tsv
    .replace('"line1\nline2"', '"line1 line2"')
    .replace('"a\tb"', 'a b');
  assert.equal(logicalRow.split('\t').length, 3);
});

test('regression: variable row layout keys heights by filtered data ids', () => {
  const layout = Core.variableRowLayout({
    rowIds: [10, 20, 30],
    rowHeights: { 10: 48, 30: 64 },
    scrollTop: 10,
    viewportHeight: 100,
    overscan: 0,
  });
  assert.deepEqual(layout.tops, [0, 48, 80]);
  assert.equal(layout.rowsHeight, 48 + ROW_H + 64);
  assert.equal(layout.totalHeight, Core.HEADER_H + layout.rowsHeight);
  assert.equal(layout.start, 0);
  assert.equal(layout.end, 2);
});

test('regression: grouped rows use measured heights for sticky rows and headers', () => {
  const groups = [{ key: 'x', rowIds: [1, 2], count: 2 }];
  const laid = Core.layoutGroups(groups, null, { 1: 48, 2: 64 });
  assert.equal(laid[0].rowTop(1), Core.GROUP_H + 48);
  assert.equal(laid[0].height, Core.GROUP_H + 48 + 64);
});

test('regression: stale scroll offset is reported so empty/single/reset views reposition first row', () => {
  const empty = Core.variableRowLayout({
    rowIds: [], scrollTop: 9999, viewportHeight: 500, overscan: 0,
  });
  assert.equal(empty.totalHeight, Core.HEADER_H);
  assert.equal(empty.maxScroll, 0);
  assert.equal(empty.scrollTop, 0);

  const one = Core.variableRowLayout({
    rowIds: [7], rowHeights: { 7: 48 }, scrollTop: 9999, viewportHeight: 500, overscan: 0,
  });
  assert.equal(one.scrollTop, 0);
  assert.equal(one.totalHeight, Core.HEADER_H + 48);

  const grouped = Core.visibleGroupedRows({
    groups: [{ key: 'x', rowIds: [0], count: 1 }],
    scrollTop: 9999,
    viewportHeight: 500,
    overscan: 0,
  });
  assert.equal(grouped.maxScroll, 0);
});

test('regression: selection reconciliation never leaves destroyed or out-of-view row ids highlighted', () => {
  const sel = {
    anchor: { r: 1, c: 1 },
    focus: { r: 4, c: 3 },
    rowIds: [1, 2, 3, 4],
  };
  const next = Core.clampDataSelection(sel, [2, 4], 5);
  assert.deepEqual(next.anchor, { r: 2, c: 1 });
  assert.deepEqual(next.focus, { r: 4, c: 3 });
  assert.deepEqual(next.rowIds, [2, 4]);

  assert.deepEqual(Core.clampDataSelection(sel, [], 5), {
    anchor: { r: 0, c: 0 },
    focus: { r: 0, c: 0 },
    rowIds: [],
  });
});

test('regression: an empty selection is safe before the first data row exists', () => {
  const sel = Core.emptySelection();
  assert.deepEqual(sel.rowIds, []);
  assert.equal(Core.toTSV([], sel), '');
});

/* ---------- refactor boundaries: viewport / composition / selection / freeze ---------- */

test('refactor: composition scroll and DOM recycling retain the same data coordinate', () => {
  let composition = Core.createCompositionState(42, 3, '北');
  composition.phase = 'composing';

  composition = Core.compositionScroll(composition);
  assert.equal(composition.phase, 'composing');
  assert.deepEqual({ r: composition.rowId, c: composition.column }, { r: 42, c: 3 });
  assert.equal(composition.value, '北');
  assert.equal(composition.viewportGeneration, 1);

  composition = Core.compositionRowsWillRecycle(composition, [40, 42, 44]);
  assert.equal(composition.phase, 'composing');
  assert.equal(composition.rowId, 42);
  assert.equal(composition.column, 3);
  assert.equal(composition.value, '北');
  assert.equal(composition.coordinateWasRendered, true);
  assert.equal(Core.editorKeyAction('ArrowDown', composition.phase === 'composing'), 'none');
});

test('refactor: shift selection survives crossing virtual-window recycling boundaries', () => {
  const ids = Array.from({ length: 10000 }, (_, i) => i);
  const selection = Core.createDataSelectionController(10);
  selection.reset(0, 0);

  selection.move(0, 9, ids, true);
  selection.move(250, 0, ids, true);
  assert.deepEqual(selection.state.focus, { r: 250, c: 9 });
  assert.equal(selection.state.rowIds.length, 251);

  const recycled = selection.rowsWillRecycle(Array.from({ length: 30 }, (_, i) => i));
  assert.deepEqual(recycled.preservedRowIds.length, 30);
  assert.equal(selection.state.rowIds.length, 251);
  assert.ok(selection.isSelected(0, 0));
  assert.ok(selection.isSelected(250, 9));
  assert.ok(!selection.isSelected(251, 0));

  const nextWindow = ids.slice(220, 260);
  const moved = selection.move(0, 0, nextWindow, false);
  assert.deepEqual(moved.focus, { r: 250, c: 9 });
  assert.deepEqual(moved.rowIds, [250]);
});

test('refactor: frozen header geometry and scrolled editor geometry share coordinates', () => {
  const widths = [100, 80, 120];
  const metrics = Core.columnMetrics(widths);
  assert.deepEqual(metrics.lefts, [0, 100, 180, 300]);

  const frozen = Core.horizontalCellBounds({
    column: 0,
    cellLeft: metrics.lefts[0],
    cellWidth: widths[0],
    frozenWidth: widths[0],
    scrollLeft: 260,
  });
  assert.deepEqual(frozen, { left: 0, width: 100, coveredByFrozenColumn: true });

  const underFrozenColumn = Core.horizontalCellBounds({
    column: 1,
    cellLeft: metrics.lefts[1],
    cellWidth: widths[1],
    frozenWidth: widths[0],
    scrollLeft: 50,
  });
  assert.deepEqual(underFrozenColumn, { left: 100, width: 30, coveredByFrozenColumn: false });

  const normal = Core.horizontalCellBounds({
    column: 2,
    cellLeft: metrics.lefts[2],
    cellWidth: widths[2],
    frozenWidth: widths[0],
    scrollLeft: 40,
  });
  assert.deepEqual(normal, { left: 140, width: 120, coveredByFrozenColumn: false });
});

test('refactor: empty table renders no rows and keeps a safe empty selection', () => {
  const range = Core.visibleRange({
    scrollTop: 9999,
    viewportHeight: 500,
    rowCount: 0,
  });
  assert.deepEqual(range, { start: 0, end: 0, offset: 0, totalHeight: 0 });

  const selection = Core.createDataSelectionController(10);
  selection.reset(0, 0);
  const reconciled = selection.reconcile([]);
  assert.deepEqual(reconciled, {
    anchor: { r: 0, c: 0 },
    focus: { r: 0, c: 0 },
    rowIds: [],
  });
  assert.equal(selection.toTSV([]), '');
  assert.equal(selection.move(1, 1, [], true), reconciled);
});
