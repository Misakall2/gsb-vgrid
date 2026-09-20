(() => {
  'use strict';

  const ROW_HEIGHT = 32;
  const HEADER_HEIGHT = 40;
  const FROZEN_COLUMN_WIDTH = 176;

  function clamp(value, min, max) {
    if (max < min) return min;
    return Math.max(min, Math.min(max, value));
  }

  function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
  }

  function normalizeRows(rows, columnCount) {
    if (!Array.isArray(rows)) return [];
    const width = Number.isInteger(columnCount) && columnCount > 0 ? columnCount : 0;
    return rows.map((row) => {
      let values;
      if (Array.isArray(row)) {
        values = row;
      } else if (isPlainObject(row)) {
        values = row.cells && Array.isArray(row.cells)
          ? row.cells
          : Object.entries(row)
              .filter(([key]) => key !== 'id')
              .map(([, value]) => value);
      } else {
        values = [row];
      }
      const normalized = values.map((cell) => String(cell ?? ''));
      if (width) normalized.length = width;
      return normalized.fill('', normalized.length, width);
    });
  }

  function createModel(rows, options = {}) {
    const requestedColumns = options.columnCount;
    const normalized = normalizeRows(rows, requestedColumns);
    const measuredColumns = normalized.reduce((max, row) => Math.max(max, row.length), 0);
    const columns = Array.isArray(options.columns) && options.columns.length
      ? options.columns
      : defaultColumnNames(Math.max(1, requestedColumns || measuredColumns || 8));
    const widths = columns.map((column, index) => {
      if (index === 0) return FROZEN_COLUMN_WIDTH;
      const requested = Number(column.width);
      return Number.isFinite(requested) && requested >= 72 ? requested : 150;
    });
    normalized.forEach((row) => {
      row.length = columns.length;
      row.fill('', row.length, columns.length);
    });
    return {
      rows: normalized,
      rowCount: normalized.length,
      columnCount: columns.length,
      columns,
      widths,
    };
  }

  function defaultColumnNames(count) {
    const names = ['订单号', '客户', '商品', '类目', '城市', '销售员', '金额', '状态', '下单时间', '备注'];
    return Array.from({ length: count }, (_, index) => ({
      key: `col_${index}`,
      title: names[index] || `列 ${index + 1}`,
      width: index === 0 ? FROZEN_COLUMN_WIDTH : 150,
    }));
  }

  function setCellValue(model, rowIndex, columnIndex, value) {
    if (
      rowIndex < 0 || rowIndex >= model.rowCount ||
      columnIndex < 0 || columnIndex >= model.columnCount
    ) {
      return model;
    }
    const rows = model.rows.map((row) => row.slice());
    rows[rowIndex][columnIndex] = String(value ?? '');
    return { ...model, rows };
  }

  function getCellValue(model, rowIndex, columnIndex) {
    return model.rows[rowIndex]?.[columnIndex] ?? '';
  }

  function getVisibleRange(scrollPosition, viewportSize, totalSize, overscan = 3, itemSize = ROW_HEIGHT) {
    if (totalSize <= 0 || viewportSize <= 0) {
      return { start: 0, end: -1, offset: 0, visibleStart: 0, visibleEnd: -1 };
    }
    const lastIndex = Math.ceil(totalSize / itemSize) - 1;
    const maxScroll = Math.max(0, totalSize - viewportSize);
    const top = clamp(scrollPosition, 0, maxScroll);
    const visibleStart = Math.floor(top / itemSize);
    const visibleEnd = Math.min(
      lastIndex,
      Math.ceil((top + viewportSize) / itemSize) - 1
    );
    return {
      start: Math.max(0, visibleStart - overscan),
      end: Math.min(lastIndex, visibleEnd + overscan),
      offset: 0,
      visibleStart,
      visibleEnd,
    };
  }

  function getColumnOffsets(widths) {
    const offsets = [0];
    widths.forEach((width, index) => {
      offsets[index + 1] = offsets[index] + width;
    });
    return offsets;
  }

  function getColumnTotalSize(widths) {
    return widths.reduce((sum, width) => sum + width, 0);
  }

  function getColumnRange(scrollPosition, viewportSize, widths, overscan = 2) {
    const total = getColumnTotalSize(widths);
    if (!widths.length || viewportSize <= 0) {
      return { start: 0, end: -1, offsets: getColumnOffsets(widths), total };
    }
    const left = clamp(scrollPosition, 0, Math.max(0, total - viewportSize));
    const right = left + viewportSize;
    const offsets = getColumnOffsets(widths);
    let start = 0;
    while (start < widths.length - 1 && offsets[start + 1] <= left) start += 1;
    let end = start;
    while (end < widths.length && offsets[end] < right) end += 1;
    return {
      start: Math.max(0, start - overscan),
      end: Math.min(widths.length - 1, end - 1 + overscan),
      offsets,
      total,
    };
  }

  function sameCell(a, b) {
    return Boolean(a && b && a.row === b.row && a.col === b.col);
  }

  function normalizeSelection(anchor, active) {
    if (!anchor || !active) return null;
    return {
      anchor: { ...anchor },
      active: { ...active },
      top: Math.min(anchor.row, active.row),
      bottom: Math.max(anchor.row, active.row),
      left: Math.min(anchor.col, active.col),
      right: Math.max(anchor.col, active.col),
    };
  }

  function isCellSelected(selection, row, col) {
    if (!selection) return false;
    return row >= selection.top && row <= selection.bottom &&
      col >= selection.left && col <= selection.right;
  }

  function isActiveCell(selection, row, col) {
    return Boolean(selection && sameCell(selection.active, { row, col }));
  }

  function moveClamped(cell, key, rowCount, columnCount) {
    if (rowCount <= 0 || columnCount <= 0) return null;
    const current = cell || { row: 0, col: 0 };
    const next = { row: current.row, col: current.col };
    if (key === 'ArrowUp') next.row -= 1;
    if (key === 'ArrowDown') next.row += 1;
    if (key === 'ArrowLeft') next.col -= 1;
    if (key === 'ArrowRight') next.col += 1;
    if (key === 'Home') next.col = 0;
    if (key === 'End') next.col = columnCount - 1;
    if (key === 'PageUp') next.row -= 10;
    if (key === 'PageDown') next.row += 10;
    return {
      row: clamp(next.row, 0, rowCount - 1),
      col: clamp(next.col, 0, columnCount - 1),
    };
  }

  function extendSelection(selection, key, rowCount, columnCount) {
    const anchor = selection?.anchor || selection?.active || { row: 0, col: 0 };
    const active = moveClamped(selection?.active, key, rowCount, columnCount);
    return active ? normalizeSelection(anchor, active) : null;
  }

  function moveTab(cell, rowCount, columnCount, shiftKey = false) {
    if (rowCount <= 0 || columnCount <= 0) return null;
    const start = cell || { row: 0, col: shiftKey ? 0 : -1 };
    let { row, col } = start;
    col += shiftKey ? -1 : 1;
    if (col >= columnCount && row < rowCount - 1) {
      row += 1;
      col = 0;
    }
    if (col < 0 && row > 0) {
      row -= 1;
      col = columnCount - 1;
    }
    return {
      row: clamp(row, 0, rowCount - 1),
      col: clamp(col, 0, columnCount - 1),
    };
  }

  function quoteTsvCell(value) {
    const text = String(value ?? '');
    if (/[\t\n\r"]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function selectionToTSV(model, selection) {
    if (!selection || model.rowCount === 0) return '';
    const lines = [];
    for (let row = selection.top; row <= selection.bottom; row += 1) {
      const line = [];
      for (let col = selection.left; col <= selection.right; col += 1) {
        line.push(quoteTsvCell(getCellValue(model, row, col)));
      }
      lines.push(line.join('\t'));
    }
    return lines.join('\n');
  }

  function startEdit(cell, initialText) {
    if (!cell) return null;
    return {
      cell: { ...cell },
      draft: initialText === undefined ? null : String(initialText),
      isComposing: false,
      compositionDraft: null,
      discard: false,
    };
  }

  function beginComposition(edit) {
    if (!edit) return edit;
    return { ...edit, isComposing: true, compositionDraft: edit.draft ?? '' };
  }

  function updateComposition(edit, draft) {
    if (!edit || !edit.isComposing) return edit;
    return { ...edit, draft: String(draft ?? '') };
  }

  function endComposition(edit, draft) {
    if (!edit) return edit;
    return {
      ...edit,
      draft: draft === undefined ? edit.draft : String(draft),
      isComposing: false,
      compositionDraft: null,
    };
  }

  function shouldIgnoreEditorKey(event, edit) {
    return Boolean(edit?.isComposing || event.isComposing || event.keyCode === 229);
  }

  function commitEdit(model, edit) {
    if (!edit || edit.discard || edit.draft === null) return { model, value: null };
    return {
      model: setCellValue(model, edit.cell.row, edit.cell.col, edit.draft),
      value: edit.draft,
    };
  }

  function scrollIndexIntoView(index, scrollStart, viewportSize, totalSize, itemSize) {
    const start = index * itemSize;
    const end = start + itemSize;
    if (start < scrollStart) return start;
    if (end > scrollStart + viewportSize) return Math.max(0, end - viewportSize);
    return clamp(scrollStart, 0, Math.max(0, totalSize - viewportSize));
  }

  function scrollColumnIntoView(index, scrollLeft, viewportSize, widths) {
    const offsets = getColumnOffsets(widths);
    const start = offsets[index];
    const end = offsets[index + 1];
    if (start < scrollLeft) return start;
    if (end > scrollLeft + viewportSize) return Math.max(0, end - viewportSize);
    return clamp(scrollLeft, 0, Math.max(0, getColumnTotalSize(widths) - viewportSize));
  }

  const api = {
    ROW_HEIGHT,
    HEADER_HEIGHT,
    FROZEN_COLUMN_WIDTH,
    clamp,
    createModel,
    setCellValue,
    getCellValue,
    getVisibleRange,
    getColumnRange,
    getColumnOffsets,
    getColumnTotalSize,
    sameCell,
    normalizeSelection,
    isCellSelected,
    isActiveCell,
    moveClamped,
    extendSelection,
    moveTab,
    quoteTsvCell,
    selectionToTSV,
    startEdit,
    beginComposition,
    updateComposition,
    endComposition,
    shouldIgnoreEditorKey,
    commitEdit,
    scrollIndexIntoView,
    scrollColumnIntoView,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.VGridCore = api;
  }
})();
