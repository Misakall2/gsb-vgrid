/* grid-view.js - internal DOM collaborators for the classic file:// build. */
/* global GridCore */
(function (root) {
  'use strict';

  const Core = root.GridCore;
  const ROW_H = Core.ROW_H;
  const HEADER_H = Core.HEADER_H;

  function createViewportPlanner() {
    let mode = 'ungrouped';
    let rowIds = [];
    let groups = null;
    let collapsed = null;
    let rowHeights = {};
    let lastPlan = null;

    function rowItems(layout, ids, heights) {
      const items = [];
      for (let i = layout.start; i < layout.end; i++) {
        const rowId = ids[i];
        items.push({
          type: 'row',
          rowId: rowId,
          top: layout.tops[i],
          height: Core.rowHeightAt(heights, rowId, ROW_H),
        });
      }
      return items;
    }

    return {
      configureUngrouped: function (nextIds, heights) {
        mode = 'ungrouped';
        rowIds = nextIds || [];
        rowHeights = heights || {};
        groups = null;
        collapsed = null;
      },
      configureGrouped: function (nextGroups, nextCollapsed, heights) {
        mode = 'grouped';
        groups = nextGroups || [];
        collapsed = nextCollapsed || new Set();
        rowHeights = heights || {};
        rowIds = [];
      },
      calculate: function (scrollTop, viewportHeight) {
        if (mode === 'grouped') {
          const grouped = Core.visibleGroupedRows({
            groups: groups,
            collapsed: collapsed,
            rowHeights: rowHeights,
            scrollTop: scrollTop,
            viewportHeight: viewportHeight,
          });
          const items = grouped.items.map(function (item) {
            if (item.type === 'group') return item;
            const group = grouped.groups[item.group];
            return {
              type: 'row',
              rowId: item.rowId,
              top: item.top,
              height: group.rowHeightAt(item.rowIndex),
            };
          });
          lastPlan = {
            mode: mode,
            items: items,
            totalHeight: HEADER_H + grouped.totalHeight,
            currentGroup: grouped.currentGroup,
            groupedView: grouped,
          };
          return lastPlan;
        }

        const layout = Core.variableRowLayout({
          rowIds: rowIds,
          rowHeights: rowHeights,
          scrollTop: scrollTop,
          viewportHeight: viewportHeight,
        });
        lastPlan = {
          mode: mode,
          items: rowItems(layout, rowIds, rowHeights),
          totalHeight: layout.totalHeight,
          currentGroup: null,
          groupedView: null,
          rowLayout: layout,
        };
        return lastPlan;
      },
      rowTopForId: function (rowId) {
        if (!lastPlan) return 0;
        if (lastPlan.mode === 'grouped') {
          for (const group of lastPlan.groupedView.groups) {
            const index = group.rowIds.indexOf(rowId);
            if (index !== -1) return group.rowTop(index);
          }
          return 0;
        }
        const index = rowIds.indexOf(rowId);
        return index === -1 || !lastPlan.rowLayout ? 0 : lastPlan.rowLayout.tops[index];
      },
      rowHeightForId: function (rowId) {
        if (lastPlan && lastPlan.mode === 'grouped') {
          for (const group of lastPlan.groupedView.groups) {
            const index = group.rowIds.indexOf(rowId);
            if (index !== -1) return group.rowHeightAt(index);
          }
        }
        return Core.rowHeightAt(rowHeights, rowId, ROW_H);
      },
      findRowInGroups: function (rowId) {
        if (!lastPlan || lastPlan.mode !== 'grouped') return null;
        for (const group of lastPlan.groupedView.groups) {
          const rowIndex = group.rowIds.indexOf(rowId);
          if (rowIndex !== -1) return { group: group, rowIndex: rowIndex };
        }
        return null;
      },
      get groupedView() {
        return lastPlan && lastPlan.groupedView;
      },
    };
  }

  function createFrozenLayout(opts) {
    const getWidths = opts.getWidths;
    const getMetrics = opts.getMetrics;
    const getScrollLeft = opts.getScrollLeft || function () { return 0; };

    return {
      totalWidth: function () { return getMetrics().totalWidth; },
      applyCellWidth: function (cell, c) {
        const width = getWidths()[c];
        cell.style.width = width + 'px';
        cell.style.minWidth = width + 'px';
        cell.style.maxWidth = width + 'px';
      },
      editorBounds: function (c) {
        const widths = getWidths();
        let cellLeft = 0;
        for (let i = 0; i < c; i++) cellLeft += widths[i];
        return Core.horizontalCellBounds({
          column: c,
          cellLeft: cellLeft,
          cellWidth: widths[c],
          frozenWidth: widths[0],
          scrollLeft: getScrollLeft(),
        });
      },
    };
  }

  function createHeaderView(opts) {
    const headerEl = opts.headerEl;
    const columns = opts.columns;
    const frozenLayout = opts.frozenLayout;

    return {
      build: function () {
        headerEl.replaceChildren();
        headerEl.style.width = frozenLayout.totalWidth() + 'px';
        columns.forEach(function (col, i) {
          const cell = document.createElement('div');
          cell.className = 'cell' + (i === 0 ? ' sticky' : '');
          frozenLayout.applyCellWidth(cell, i);
          cell.textContent = col.title;
          const handle = document.createElement('span');
          handle.className = 'resize-handle';
          handle.title = '拖动调整列宽';
          handle.dataset.c = String(i);
          cell.appendChild(handle);
          headerEl.appendChild(cell);
        });
      },
      layout: function () {
        headerEl.style.width = frozenLayout.totalWidth() + 'px';
        for (let c = 0; c < headerEl.children.length; c++) {
          frozenLayout.applyCellWidth(headerEl.children[c], c);
        }
      },
    };
  }

  function createBodyRenderer(opts) {
    const canvas = opts.canvas;
    const columns = opts.columns;
    const data = opts.data;
    const rowHeights = opts.rowHeights;
    const selection = opts.selection;
    const frozenLayout = opts.frozenLayout;
    const beforeRowsRecycle = opts.beforeRowsRecycle;
    const beforeGroupsRecycle = opts.beforeGroupsRecycle;
    const rowEls = new Map();
    const groupEls = new Map();

    function buildCell(rowId, c) {
      const cell = document.createElement('div');
      cell.className = 'cell' + (c === 0 ? ' sticky' : '');
      cell.textContent = data[rowId][c];
      cell.dataset.r = rowId;
      cell.dataset.c = c;
      frozenLayout.applyCellWidth(cell, c);
      if (selection.isSelected(rowId, c)) cell.classList.add('selected');
      if (selection.isActive(rowId, c)) cell.classList.add('active');
      return cell;
    }

    function buildRow(item) {
      const rowId = item.rowId;
      const rowEl = document.createElement('div');
      const isUnmeasured = !Object.prototype.hasOwnProperty.call(rowHeights, rowId);
      rowEl.className = 'row';
      rowEl.style.top = (HEADER_H + item.top) + 'px';
      rowEl.style.width = frozenLayout.totalWidth() + 'px';
      rowEl.style.height = item.height + 'px';
      rowEl.dataset.rowHeight = String(item.height);
      if (isUnmeasured) rowEl.dataset.measuring = '1';
      for (let c = 0; c < columns.length; c++) rowEl.appendChild(buildCell(rowId, c));
      return rowEl;
    }

    function clearRows() {
      if (rowEls.size && beforeRowsRecycle) beforeRowsRecycle(Array.from(rowEls.keys()));
      if (groupEls.size && beforeGroupsRecycle) beforeGroupsRecycle(Array.from(groupEls.keys()));
      rowEls.forEach(function (el) { el.remove(); });
      groupEls.forEach(function (el) { el.remove(); });
      rowEls.clear();
      groupEls.clear();
    }

    return {
      render: function (plan, groupControls) {
        clearRows();
        for (const item of plan.items) {
          if (item.type === 'group') {
            const el = groupControls.buildHeader(item, plan.groupedView, frozenLayout.totalWidth());
            canvas.appendChild(el);
            groupEls.set(item.key, el);
          } else {
            const rowEl = buildRow(item);
            canvas.appendChild(rowEl);
            rowEls.set(item.rowId, rowEl);
          }
        }
      },
      layout: function () {
        rowEls.forEach(function (rowEl) {
          rowEl.style.width = frozenLayout.totalWidth() + 'px';
          for (let c = 0; c < rowEl.children.length; c++) {
            frozenLayout.applyCellWidth(rowEl.children[c], c);
          }
        });
        groupEls.forEach(function (el) {
          el.style.width = 'max(' + frozenLayout.totalWidth() + 'px, 100%)';
        });
      },
      measureRows: function () {
        let changed = false;
        rowEls.forEach(function (rowEl, rowId) {
          const measuring = rowEl.dataset.measuring === '1';
          rowEl.removeAttribute('data-measuring');
          rowEl.style.height = '';
          rowEl.style.minHeight = ROW_H + 'px';
          const measuredHeight = rowEl.offsetHeight;
          rowEl.style.minHeight = '';
          rowEl.style.height = measuredHeight + 'px';
          if (measuredHeight && measuredHeight !== rowHeights[rowId]) {
            rowHeights[rowId] = measuredHeight;
            changed = true;
          }
        });
        return changed;
      },
      forEachRowElement: function (fn) { rowEls.forEach(fn); },
      get rowElementCount() { return rowEls.size; },
    };
  }

  function createCellEditor(opts) {
    const grid = opts.grid;
    const data = opts.data;
    const planner = opts.planner;
    const frozenLayout = opts.frozenLayout;
    const onCommitAction = opts.onCommitAction;
    const state = Core.createCompositionState(0, 0, '');
    let input = null;
    let open = false;

    function updatePosition() {
      if (!open || !input) return;
      const c = state.column;
      const top = planner.rowTopForId(state.rowId);
      const height = planner.rowHeightForId(state.rowId);
      const bounds = frozenLayout.editorBounds(c);
      input.style.top = (HEADER_H + top - grid.scrollTop) + 'px';
      input.style.left = bounds.left + 'px';
      input.style.width = bounds.width + 'px';
      input.style.height = height + 'px';
    }

    function close(commit) {
      if (!open) return;
      if (commit) data[state.rowId][state.column] = input.value;
      const snapshot = {
        rowId: state.rowId,
        column: state.column,
        value: input.value,
        action: commit ? 'commit' : 'cancel',
      };
      open = false;
      state.phase = 'idle';
      input.remove();
      input = null;
      return snapshot;
    }

    function bindEvents() {
      input.addEventListener('compositionstart', function () {
        state.phase = 'composing';
        input.dataset.composing = '1';
      });
      input.addEventListener('compositionend', function () {
        state.phase = 'idle';
        input.dataset.composing = '0';
        updatePosition();
      });
      input.addEventListener('keydown', function (e) {
        e.stopPropagation();
        const action = Core.editorKeyAction(e.key, state.phase === 'composing' || e.isComposing);
        if (action === 'none') return;
        e.preventDefault();
        if (action === 'cancel') {
          close(false);
          onCommitAction('cancel', e.shiftKey);
          return;
        }
        close(true);
        onCommitAction(action, e.shiftKey, snapshotPlaceholder());
      });
      input.addEventListener('blur', function () {
        if (!open) return;
        close(true);
        onCommitAction('blur', false);
      });
    }

    function snapshotPlaceholder() {
      return { rowId: state.rowId, column: state.column };
    }

    return {
      open: function (rowId, column) {
        if (open) return;
        state.rowId = rowId;
        state.column = column;
        state.value = String(data[rowId][column] == null ? '' : data[rowId][column]);
        state.phase = 'idle';
        open = true;
        input = document.createElement('input');
        input.className = 'editor';
        input.value = state.value;
        bindEvents();
        grid.appendChild(input);
        updatePosition();
        input.focus();
        input.select();
      },
      commit: function () { return close(true); },
      cancel: function () { return close(false); },
      updatePosition: updatePosition,
      get isOpen() { return open; },
      get isComposing() { return state.phase === 'composing'; },
      get rowId() { return state.rowId; },
      get column() { return state.column; },
      shouldCaptureMousedown: function (target) {
        return state.phase === 'composing' && target !== input;
      },
      refocus: function () {
        if (input && state.phase === 'composing') input.focus();
      },
      rowsWillRecycle: function (rowIds) {
        return Core.compositionRowsWillRecycle(state, rowIds);
      },
      handleViewportScroll: function () {
        Core.compositionScroll(state);
        updatePosition();
      },
    };
  }

  root.GridView = {
    ROW_H: ROW_H,
    HEADER_H: HEADER_H,
    createViewportPlanner: createViewportPlanner,
    createFrozenLayout: createFrozenLayout,
    createHeaderView: createHeaderView,
    createBodyRenderer: createBodyRenderer,
    createCellEditor: createCellEditor,
  };
})(typeof self !== 'undefined' ? self : globalThis);
