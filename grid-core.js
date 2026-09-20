/* grid-core.js - pure logic for the virtual grid. No DOM access.
 * Loaded by the browser as window.GridCore and by Node tests via require(). */
(function (root, factory) {
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  if (root) root.GridCore = core;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const ROW_H = 32;
  const HEADER_H = 36;
  const GROUP_H = 36;
  const MIN_COL_WIDTH = 40;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /* Which rows to render for a given scroll position.
   * offset is the exact pixel top of the first rendered row, so rows never
   * drift by a fraction even after a huge fast scroll. */
  function visibleRange(opts) {
    const topOffset = opts.topOffset || 0;
    const scrollTop = opts.scrollTop;
    const viewportHeight = opts.viewportHeight;
    const rowHeight = opts.rowHeight || ROW_H;
    const rowCount = opts.rowCount || 0;
    const overscan = opts.overscan == null ? 4 : opts.overscan;
    if (rowCount <= 0) return { start: 0, end: 0, offset: topOffset, totalHeight: 0 };
    const totalHeight = rowCount * rowHeight;
    const maxScroll = Math.max(0, totalHeight - viewportHeight);
    const st = clamp(scrollTop, 0, maxScroll);
    const first = Math.floor(st / rowHeight);
    const last = Math.ceil((st + viewportHeight) / rowHeight);
    const start = clamp(first - overscan, 0, rowCount);
    const end = clamp(last + overscan, 0, rowCount);
    return { start: start, end: end, offset: topOffset + start * rowHeight, totalHeight: totalHeight };
  }

  function filterRows(data, filters) {
    const active = (filters || []).filter(function (f) {
      return f && f.columnIndex >= 0 && f.keyword != null && String(f.keyword) !== '';
    });
    if (!active.length) return data.map(function (_, r) { return r; });
    return data.reduce(function (ids, row, r) {
      const matches = active.every(function (f) {
        const cell = row[f.columnIndex];
        return String(cell == null ? '' : cell).toLowerCase().indexOf(String(f.keyword).toLowerCase()) !== -1;
      });
      if (matches) ids.push(r);
      return ids;
    }, []);
  }

  function groupRows(rowIds, data, columnIndex, collapsed) {
    const groups = [];
    const byKey = new Map();
    const groupIndexByRowId = new Map();
    if (columnIndex == null || columnIndex < 0) {
      return { groups: groups, visibleRowIds: rowIds.slice(), groupIndexByRowId: groupIndexByRowId };
    }
    rowIds.forEach(function (rowId) {
      const rawKey = data[rowId] ? data[rowId][columnIndex] : '';
      const key = rawKey == null || rawKey === '' ? '(空)' : String(rawKey);
      let group = byKey.get(key);
      if (!group) {
        group = { key: key, rowIds: [], count: 0 };
        byKey.set(key, group);
        groups.push(group);
      }
      const groupIndex = groups.indexOf(group);
      group.rowIds.push(rowId);
      group.count += 1;
      groupIndexByRowId.set(rowId, groupIndex);
    });

    const collapsedSet = collapsed instanceof Set ? collapsed : new Set();
    const visibleRowIds = [];
    groups.forEach(function (group) {
      if (collapsedSet.has(group.key)) return;
      group.rowIds.forEach(function (rowId) {
        visibleRowIds.push(rowId);
      });
    });
    return { groups: groups, visibleRowIds: visibleRowIds, groupIndexByRowId: groupIndexByRowId };
  }

  function currentGroupIndex(opts) {
    const rowIds = opts.rowIds || [];
    const groupIndexByRowId = opts.groupIndexByRowId;
    if (!rowIds.length || !groupIndexByRowId || !groupIndexByRowId.size) return -1;
    const topOffset = opts.topOffset || 0;
    const rowHeight = opts.rowHeight || ROW_H;
    const idx = clamp(Math.floor((opts.scrollTop - topOffset) / rowHeight), 0, rowIds.length - 1);
    return groupIndexByRowId.get(rowIds[idx]) || 0;
  }

  /* Selection lives purely as data ({anchor, focus}) so it survives DOM
   * recycling: re-rendered rows just re-ask isSelected(). */
  function createSelection(r, c) {
    const p = { r: r || 0, c: c || 0 };
    return { anchor: { r: p.r, c: p.c }, focus: { r: p.r, c: p.c } };
  }

  function normalizeSelection(sel) {
    return {
      r1: Math.min(sel.anchor.r, sel.focus.r),
      c1: Math.min(sel.anchor.c, sel.focus.c),
      r2: Math.max(sel.anchor.r, sel.focus.r),
      c2: Math.max(sel.anchor.c, sel.focus.c),
    };
  }

  function isSelected(sel, r, c) {
    const n = normalizeSelection(sel);
    return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
  }

  function moveFocus(sel, dr, dc, bounds, extend) {
    const rowCount = bounds.rowCount, colCount = bounds.colCount;
    if (rowCount <= 0 || colCount <= 0) return sel;
    const focus = {
      r: clamp(sel.focus.r + dr, 0, rowCount - 1),
      c: clamp(sel.focus.c + dc, 0, colCount - 1),
    };
    if (extend) return { anchor: { r: sel.anchor.r, c: sel.anchor.c }, focus: focus };
    return { anchor: { r: focus.r, c: focus.c }, focus: focus };
  }

  function visiblePosition(sel, visibleRowIds) {
    let rowIndex = visibleRowIds.indexOf(sel.focus.r);
    if (rowIndex === -1) {
      rowIndex = 0;
      for (let i = 0; i < visibleRowIds.length; i++) {
        if (visibleRowIds[i] <= sel.focus.r) rowIndex = i;
        else break;
      }
    }
    return rowIndex;
  }

  function moveVisibleFocus(sel, dr, dc, visibleRowIds, colCount, extend) {
    if (!visibleRowIds.length || colCount <= 0) return sel;
    let rowIndex = visiblePosition(sel, visibleRowIds);
    let col = sel.focus.c;
    if (dc !== 0) {
      col += dc;
      if (col < 0 && rowIndex > 0) {
        rowIndex -= 1;
        col = colCount - 1;
      } else if (col >= colCount && rowIndex < visibleRowIds.length - 1) {
        rowIndex += 1;
        col = 0;
      }
    }
    rowIndex = clamp(rowIndex + dr, 0, visibleRowIds.length - 1);
    col = clamp(col, 0, colCount - 1);
    const focus = { r: visibleRowIds[rowIndex], c: col };
    if (extend) return { anchor: { r: sel.anchor.r, c: sel.anchor.c }, focus: focus };
    return { anchor: { r: focus.r, c: focus.c }, focus: focus };
  }

  function tabNextVisible(sel, visibleRowIds, colCount, backwards) {
    if (!visibleRowIds.length || colCount <= 0) return sel;
    const rowIndex = visiblePosition(sel, visibleRowIds);
    const flat = clamp(rowIndex * colCount + sel.focus.c + (backwards ? -1 : 1), 0, visibleRowIds.length * colCount - 1);
    const focus = { r: visibleRowIds[Math.floor(flat / colCount)], c: flat % colCount };
    return { anchor: { r: focus.r, c: focus.c }, focus: focus };
  }

  /* Tab walks left-to-right, top-to-bottom and clamps at the last cell. */
  function tabNext(sel, bounds, backwards) {
    const rowCount = bounds.rowCount, colCount = bounds.colCount;
    if (rowCount <= 0 || colCount <= 0) return sel;
    let idx = sel.focus.r * colCount + sel.focus.c + (backwards ? -1 : 1);
    idx = clamp(idx, 0, rowCount * colCount - 1);
    const focus = { r: Math.floor(idx / colCount), c: idx % colCount };
    return { anchor: { r: focus.r, c: focus.c }, focus: focus };
  }

  function toTSV(data, sel, visibleRowIds) {
    const n = normalizeSelection(sel);
    const selectedRows = visibleRowIds
      ? visibleRowIds.filter(function (r) { return r >= n.r1 && r <= n.r2; })
      : null;
    const lines = [];
    const rowCount = selectedRows ? selectedRows.length : n.r2 - n.r1 + 1;
    for (let i = 0; i < rowCount; i++) {
      const r = selectedRows ? selectedRows[i] : n.r1 + i;
      const cells = [];
      for (let c = n.c1; c <= n.c2; c++) {
        const v = data[r] ? data[r][c] : null;
        cells.push(v == null ? '' : String(v));
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }

  function resizeColumn(columns, columnIndex, width, minWidth) {
    const min = minWidth == null ? MIN_COL_WIDTH : minWidth;
    return columns.map(function (col, i) {
      if (i !== columnIndex) return { title: col.title, width: col.width };
      return { title: col.title, width: Math.max(min, Math.round(width)) };
    });
  }

  function columnLayout(columns) {
    let x = 0;
    const lefts = columns.map(function (col) {
      const left = x;
      x += col.width;
      return left;
    });
    return { lefts: lefts, totalWidth: x };
  }

  /* Key handling while the cell editor is open. Between compositionstart and
   * compositionend the IME owns the keyboard: arrows/Enter/Tab must not
   * commit or move, so every key maps to 'none'. */
  function editorKeyAction(key, composing) {
    if (composing) return 'none';
    switch (key) {
      case 'Enter': return 'commit';
      case 'Escape': return 'cancel';
      case 'Tab': return 'commit-tab';
      case 'ArrowUp': return 'commit-up';
      case 'ArrowDown': return 'commit-down';
      case 'ArrowLeft': return 'commit-left';
      case 'ArrowRight': return 'commit-right';
      default: return 'none';
    }
  }

  /* Deterministic fake deal data so tests and screenshots are stable. */
  function lcg(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1103515245 + 12345) >>> 0;
      return s / 4294967296;
    };
  }

  const CITIES = ['上海', '北京', '深圳', '杭州', '成都', '广州', '南京', '武汉'];
  const PRODUCTS = ['机械键盘', '4K 显示器', '人体工学椅', '扩展坞', '降噪耳机', '升降桌', '电容麦克风', '会议摄像头'];
  const STATUSES = ['已成交', '待付款', '已发货', '已完成', '已退款'];
  const SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '赵', '黄'];
  const GIVEN = ['伟', '芳', '娜', '敏', '静', '磊', '洋', '艳'];
  const LONG_NOTE = '客户要求分三批发货，第一批走顺丰空运，第二批等月底促销价确认后再发，' +
    '发票抬头需要开公司名称并寄到财务办公室，售后问题直接联系采购经理，重复确认交期不要错过窗口期。';

  function pad(n, w) {
    let s = String(n);
    while (s.length < w) s = '0' + s;
    return s;
  }

  function generateData(rowCount, seed) {
    const rnd = lcg(seed == null ? 42 : seed);
    const pick = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };
    const data = [];
    for (let i = 0; i < rowCount; i++) {
      const qty = 1 + Math.floor(rnd() * 50);
      const price = Math.round((9.9 + rnd() * 2000) * 100) / 100;
      const month = 1 + Math.floor(rnd() * 12);
      const day = 1 + Math.floor(rnd() * 28);
      const note = (i % 97 === 0) ? LONG_NOTE : (rnd() < 0.3 ? '老客户回购' : '');
      data.push([
        'SO-' + pad(i + 1, 6),
        pick(SURNAMES) + pick(GIVEN),
        pick(CITIES),
        pick(PRODUCTS),
        String(qty),
        price.toFixed(2),
        (qty * price).toFixed(2),
        pick(STATUSES),
        '2026-' + pad(month, 2) + '-' + pad(day, 2),
        note,
      ]);
    }
    return data;
  }

  return {
    ROW_H: ROW_H,
    HEADER_H: HEADER_H,
    GROUP_H: GROUP_H,
    MIN_COL_WIDTH: MIN_COL_WIDTH,
    clamp: clamp,
    visibleRange: visibleRange,
    filterRows: filterRows,
    groupRows: groupRows,
    currentGroupIndex: currentGroupIndex,
    createSelection: createSelection,
    normalizeSelection: normalizeSelection,
    isSelected: isSelected,
    moveFocus: moveFocus,
    moveVisibleFocus: moveVisibleFocus,
    tabNext: tabNext,
    tabNextVisible: tabNextVisible,
    toTSV: toTSV,
    resizeColumn: resizeColumn,
    columnLayout: columnLayout,
    editorKeyAction: editorKeyAction,
    generateData: generateData,
  };
});
