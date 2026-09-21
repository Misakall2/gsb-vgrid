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
  const GROUP_H = 32;
  const MIN_COL_WIDTH = 48;

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  /* Which rows to render for a given scroll position.
   * offset is the exact pixel top of the first rendered row, so rows never
   * drift by a fraction even after a huge fast scroll. */
  function visibleRange(opts) {
    const scrollTop = opts.scrollTop;
    const viewportHeight = opts.viewportHeight;
    const rowHeight = opts.rowHeight || ROW_H;
    const rowCount = opts.rowCount || 0;
    const overscan = opts.overscan == null ? 4 : opts.overscan;
    if (rowCount <= 0) return { start: 0, end: 0, offset: 0, totalHeight: 0 };
    const totalHeight = rowCount * rowHeight;
    const maxScroll = Math.max(0, totalHeight - viewportHeight);
    const st = clamp(scrollTop, 0, maxScroll);
    const first = Math.floor(st / rowHeight);
    const last = Math.ceil((st + viewportHeight) / rowHeight);
    const start = clamp(first - overscan, 0, rowCount);
    const end = clamp(last + overscan, 0, rowCount);
    return { start: start, end: end, offset: start * rowHeight, totalHeight: totalHeight };
  }

  function rowHeightAt(rowHeights, rowId, fallback) {
    const defaultHeight = fallback || ROW_H;
    const h = rowHeights && Object.prototype.hasOwnProperty.call(rowHeights, rowId)
      ? rowHeights[rowId]
      : defaultHeight;
    return Math.max(defaultHeight, Math.round(Number(h) || defaultHeight));
  }

  /* Variable-height rows use measured original data ids after filtering. */
  function variableRowLayout(opts) {
    const rowIds = opts.rowIds || [];
    const fallback = opts.rowHeight || ROW_H;
    const headerHeight = opts.headerHeight == null ? HEADER_H : opts.headerHeight;
    const viewportHeight = opts.viewportHeight || 0;
    const overscan = opts.overscan == null ? 4 : opts.overscan;
    const tops = new Array(rowIds.length);
    let rowsHeight = 0;
    for (let i = 0; i < rowIds.length; i++) {
      tops[i] = rowsHeight;
      rowsHeight += rowHeightAt(opts.rowHeights, rowIds[i], fallback);
    }
    const totalHeight = headerHeight + rowsHeight;
    const maxScroll = Math.max(0, totalHeight - viewportHeight);
    const st = clamp(opts.scrollTop || 0, 0, maxScroll);
    let start = 0;
    while (start < rowIds.length &&
      tops[start] + rowHeightAt(opts.rowHeights, rowIds[start], fallback) <= st) {
      start++;
    }
    let end = start;
    const bottom = st + Math.max(0, viewportHeight - headerHeight);
    while (end < rowIds.length && tops[end] < bottom) end++;
    start = clamp(start - overscan, 0, rowIds.length);
    end = clamp(end + overscan, 0, rowIds.length);
    return {
      start: start,
      end: end,
      tops: tops,
      rowsHeight: rowsHeight,
      totalHeight: totalHeight,
      maxScroll: maxScroll,
      scrollTop: st,
    };
  }

  function columnMetrics(widths) {
    const lefts = [0];
    for (let i = 0; i < widths.length; i++) lefts.push(lefts[i] + widths[i]);
    return { lefts: lefts, totalWidth: lefts[widths.length] || 0 };
  }

  function resizeColumn(widths, index, deltaX, minWidth) {
    const next = widths.slice();
    const min = minWidth == null ? MIN_COL_WIDTH : minWidth;
    if (index < 0 || index >= next.length) return next;
    next[index] = Math.max(min, next[index] + deltaX);
    return next;
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

  function isSelectedLegacy(sel, r, c) {
    const n = normalizeSelection(sel);
    return r >= n.r1 && r <= n.r2 && c >= n.c1 && c <= n.c2;
  }

  function createDataSelection(rowId, c) {
    const focus = { r: rowId || 0, c: c || 0 };
    return {
      anchor: { r: rowId || 0, c: c || 0 },
      focus: focus,
      rowIds: [rowId || 0],
    };
  }

  function isColumnSelected(sel, c) {
    const n = normalizeSelection(sel);
    return c >= n.c1 && c <= n.c2;
  }

  function isDataRowSelected(sel, rowId) {
    return sel && sel.rowIds && sel.rowIds.indexOf(rowId) !== -1;
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

  /* Tab walks left-to-right, top-to-bottom and clamps at the last cell. */
  function tabNext(sel, bounds, backwards) {
    const rowCount = bounds.rowCount, colCount = bounds.colCount;
    if (rowCount <= 0 || colCount <= 0) return sel;
    let idx = sel.focus.r * colCount + sel.focus.c + (backwards ? -1 : 1);
    idx = clamp(idx, 0, rowCount * colCount - 1);
    const focus = { r: Math.floor(idx / colCount), c: idx % colCount };
    return { anchor: { r: focus.r, c: focus.c }, focus: focus };
  }

  function toTSV(data, sel) {
    const n = normalizeSelection(sel);
    const rowIds = selectionRowIds(sel);
    const lines = [];
    for (const r of rowIds) {
      const cells = [];
      for (let c = n.c1; c <= n.c2; c++) {
        const v = data[r] ? data[r][c] : null;
        cells.push(encodeTSVCell(v == null ? '' : String(v)));
      }
      lines.push(cells.join('\t'));
    }
    return lines.join('\n');
  }

  function encodeTSVCell(value) {
    const s = String(value == null ? '' : value);
    if (s.indexOf('\t') === -1 && s.indexOf('\n') === -1 &&
      s.indexOf('\r') === -1 && s.indexOf('"') === -1) {
      return s;
    }
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function emptySelection() {
    return { anchor: { r: 0, c: 0 }, focus: { r: 0, c: 0 }, rowIds: [] };
  }

  function clampDataSelection(selection, visibleIds, columnCount) {
    if (!visibleIds.length || columnCount <= 0) return emptySelection();
    const visibleSet = new Set(visibleIds);
    const rowIds = (selection.rowIds || []).filter(function (id) {
      return visibleSet.has(id);
    });
    const anchorRow = visibleSet.has(selection.anchor.r)
      ? selection.anchor.r
      : (selection.anchor.r < selection.focus.r ? rowIds[0] : rowIds[rowIds.length - 1]);
    const focusRow = visibleSet.has(selection.focus.r)
      ? selection.focus.r
      : (selection.focus.r < selection.anchor.r ? rowIds[0] : rowIds[rowIds.length - 1]);
    return {
      anchor: { r: anchorRow, c: clamp(selection.anchor.c, 0, columnCount - 1) },
      focus: { r: focusRow, c: clamp(selection.focus.c, 0, columnCount - 1) },
      rowIds: rowIds,
    };
  }

  function selectionRowIds(sel) {
    if (sel && sel.rowIds) return sel.rowIds.slice();
    const n = normalizeSelection(sel);
    const rows = [];
    for (let r = n.r1; r <= n.r2; r++) rows.push(r);
    return rows;
  }

  function isSelected(sel, r, c) {
    if (sel && sel.rowIds) return sel.rowIds.indexOf(r) !== -1 && isColumnSelected(sel, c);
    return isSelectedLegacy(sel, r, c);
  }

  function visibleFocus(sel, visibleRowIds, columnCount) {
    if (!visibleRowIds.length || columnCount <= 0) return null;
    const idx = sel ? visibleRowIds.indexOf(sel.focus.r) : -1;
    if (idx !== -1) return { rowId: sel.focus.r, c: clamp(sel.focus.c, 0, columnCount - 1) };
    return { rowId: visibleRowIds[0], c: sel ? clamp(sel.focus.c, 0, columnCount - 1) : 0 };
  }

  function moveDataSelection(sel, dr, dc, visibleRowIds, columnCount, extend) {
    if (!visibleRowIds.length || columnCount <= 0) return sel;
    let idx = visibleRowIds.indexOf(sel.focus.r);
    if (idx === -1) idx = dr < 0 ? visibleRowIds.length - 1 : 0;
    let c = clamp(sel.focus.c + dc, 0, columnCount - 1);
    let next = idx + dr;
    if (next < 0) {
      next = idx;
    } else if (next >= visibleRowIds.length) {
      next = idx;
    }
    const focus = { r: visibleRowIds[next], c: c };
    if (!extend) return { anchor: focus, focus: focus, rowIds: [focus.r] };
    const anchorIdx = visibleRowIds.indexOf(sel.anchor.r);
    if (anchorIdx === -1) return { anchor: focus, focus: focus, rowIds: [focus.r] };
    const start = Math.min(anchorIdx, next);
    const end = Math.max(anchorIdx, next);
    return {
      anchor: { r: sel.anchor.r, c: sel.anchor.c },
      focus: focus,
      rowIds: visibleRowIds.slice(start, end + 1),
    };
  }

  function tabNextData(sel, visibleRowIds, columnCount, backwards) {
    if (!visibleRowIds.length || columnCount <= 0) return sel;
    let rowIdx = visibleRowIds.indexOf(sel.focus.r);
    if (rowIdx === -1) rowIdx = backwards ? visibleRowIds.length - 1 : 0;
    let linear = rowIdx * columnCount + sel.focus.c + (backwards ? -1 : 1);
    linear = clamp(linear, 0, visibleRowIds.length * columnCount - 1);
    const focus = {
      r: visibleRowIds[Math.floor(linear / columnCount)],
      c: linear % columnCount,
    };
    return { anchor: focus, focus: focus, rowIds: [focus.r] };
  }

  function filterRows(data, filters) {
    const active = (filters || []).filter(function (f) {
      return f && f.column != null && String(f.keyword == null ? '' : f.keyword).trim();
    }).map(function (f) {
      return { column: f.column, keyword: String(f.keyword).trim().toLowerCase() };
    });
    const ids = [];
    for (let r = 0; r < data.length; r++) {
      let ok = true;
      for (const f of active) {
        const v = data[r][f.column];
        if (v == null || String(v).toLowerCase().indexOf(f.keyword) === -1) {
          ok = false;
          break;
        }
      }
      if (ok) ids.push(r);
    }
    return ids;
  }

  function groupRows(data, rowIds, column) {
    if (column == null || column < 0) return null;
    const map = new Map();
    for (const rowId of rowIds) {
      const key = data[rowId][column] == null ? '' : String(data[rowId][column]);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(rowId);
    }
    return Array.from(map.keys()).sort(function (a, b) {
      return a.localeCompare(b, 'zh-Hans-CN');
    }).map(function (key) {
      const rows = map.get(key);
      return { key: key, rowIds: rows, count: rows.length };
    });
  }

  function layoutGroups(groups, collapsed, rowHeights) {
    let top = 0;
    return groups.map(function (group, index) {
      const groupTop = top;
      const isCollapsed = !!(collapsed && collapsed.has && collapsed.has(group.key));
      let rowsHeight = 0;
      if (!isCollapsed) {
        for (const rowId of group.rowIds) {
          rowsHeight += rowHeightAt(rowHeights, rowId, ROW_H);
        }
      }
      const height = GROUP_H + rowsHeight;
      const laid = Object.assign({}, group, {
        index: index,
        top: groupTop,
        height: height,
        bottom: groupTop + height,
        collapsed: isCollapsed,
        rowTop: function (rowIndex) {
          let rowTop = groupTop + GROUP_H;
          for (let i = 0; i < rowIndex; i++) {
            rowTop += rowHeightAt(rowHeights, group.rowIds[i], ROW_H);
          }
          return rowTop;
        },
        rowHeightAt: function (rowIndex) {
          return rowHeightAt(rowHeights, group.rowIds[rowIndex], ROW_H);
        },
      });
      top = groupTop + height;
      return laid;
    });
  }

  function visibleGroupedRows(opts) {
    const groups = layoutGroups(opts.groups || [], opts.collapsed, opts.rowHeights);
    if (!groups.length) {
      return { items: [], groups: groups, currentGroup: null, totalHeight: 0, maxScroll: 0 };
    }
    const totalHeight = groups[groups.length - 1].bottom;
    const headerHeight = opts.headerHeight == null ? HEADER_H : opts.headerHeight;
    const maxScroll = Math.max(0, totalHeight + headerHeight - opts.viewportHeight);
    const st = clamp(opts.scrollTop || 0, 0, maxScroll);
    const viewH = Math.max(ROW_H, opts.viewportHeight - headerHeight - GROUP_H);
    const overscan = opts.overscan == null ? 4 : opts.overscan;
    const padPx = overscan * ROW_H;
    const topEdge = st - padPx;
    const bottomEdge = st + viewH + padPx;
    const items = [];
    let current = groups[0];
    for (const group of groups) {
      if (group.bottom < topEdge || group.top > bottomEdge) {
        if (group.top <= st) current = group;
        continue;
      }
      if (group.top <= st) current = group;
      if (group.top >= st) {
        items.push({ type: 'group', group: group.index, key: group.key, top: group.top,
          height: GROUP_H, count: group.count, collapsed: group.collapsed });
      }
      if (!group.collapsed) {
        let start = 0;
        while (start < group.count &&
          group.rowTop(start) + group.rowHeightAt(start) <= st) {
          start++;
        }
        let end = start;
        while (end < group.count && group.rowTop(end) < st + viewH) end++;
        start = clamp(start - overscan, 0, group.count);
        end = clamp(end + overscan, 0, group.count);
        for (let i = start; i < end; i++) {
          items.push({ type: 'row', group: group.index, rowIndex: i,
            rowId: group.rowIds[i], top: group.rowTop(i) });
        }
      }
    }
    items.sort(function (a, b) { return a.top - b.top || (a.type === 'group' ? -1 : 1); });
    return { items: items, groups: groups, currentGroup: current, totalHeight: totalHeight, maxScroll: maxScroll };
  }

  function filterInputValue(current, input, composing) {
    return composing ? current : String(input == null ? '' : input).trim();
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
    variableRowLayout: variableRowLayout,
    rowHeightAt: rowHeightAt,
    columnMetrics: columnMetrics,
    resizeColumn: resizeColumn,
    createSelection: createSelection,
    createDataSelection: createDataSelection,
    normalizeSelection: normalizeSelection,
    isSelected: isSelected,
    isDataRowSelected: isDataRowSelected,
    moveFocus: moveFocus,
    moveDataSelection: moveDataSelection,
    tabNext: tabNext,
    tabNextData: tabNextData,
    visibleFocus: visibleFocus,
    toTSV: toTSV,
    encodeTSVCell: encodeTSVCell,
    emptySelection: emptySelection,
    clampDataSelection: clampDataSelection,
    filterRows: filterRows,
    groupRows: groupRows,
    layoutGroups: layoutGroups,
    visibleGroupedRows: visibleGroupedRows,
    filterInputValue: filterInputValue,
    editorKeyAction: editorKeyAction,
    generateData: generateData,
  };
});
