/* selection-layer.js - selection as a data layer.
 *
 * Dependency direction:
 *   selection-layer -> GridCore (pure selection math)
 *   selection-layer is notified BY viewport (rowsRecycled/rowsMounted);
 *   it never asks the viewport or the DOM for rows. When virtual scrolling
 *   destroys row nodes the selection state is untouched, because it is
 *   keyed by original data row ids, not screen rows or DOM nodes.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../grid-core.js'));
  }
  if (root) root.VGridSelection = factory(root.GridCore);
})(typeof self !== 'undefined' ? self : globalThis, function (Core) {
  'use strict';

  function createSelectionLayer(opts) {
    const colCount = opts.colCount;
    const getVisibleRowIds = opts.getVisibleRowIds;
    const onChange = opts.onChange || function () {};
    let sel = opts.initialSelection || Core.emptySelection();

    function get() { return sel; }

    function set(next, notify) {
      sel = next;
      if (notify !== false) onChange(sel);
    }

    function select(rowId, c) {
      set(Core.createDataSelection(rowId, c));
    }

    /* Viewport subscription hook: the visible id set changed (filter /
 * group / collapse). Out-of-view data ids must stop being highlighted. */
    function reconcile(visibleRowIds) {
      if (!sel || !sel.rowIds) return;
      set(Core.clampDataSelection(sel, visibleRowIds || getVisibleRowIds(), colCount()));
    }

    function move(dr, dc, extend) {
      set(Core.moveDataSelection(sel, dr, dc, getVisibleRowIds(), colCount(), !!extend));
    }

    function tab(backwards) {
      set(Core.tabNextData(sel, getVisibleRowIds(), colCount(), !!backwards));
    }

    function collapseToFocus() {
      set(Core.createDataSelection(sel.focus.r, sel.focus.c));
    }

    /* ---- viewport recycling notifications ------------------------------ *
 * The viewport calls these while it owns the nodes. Selection never goes
 * looking for rows itself; the relevant row elements (or null, when rows
 * are removed) are delivered here. */

    /* A batch of rows was destroyed. Selection state survives; there is
 * nothing to erase because it never lived on the nodes. */
    function rowsRecycled(/* rowIds */) {}

    /* New/updated mounted rows are handed over for highlight painting.
 * rowNodes is a Map<rowId, rowEl>; each rowEl contains .cell children. */
    function paintRows(rowNodes) {
      rowNodes.forEach(function (rowEl, rowId) {
        const cells = rowEl.children;
        for (let c = 0; c < cells.length; c++) {
          const cell = cells[c];
          cell.classList.toggle('selected', Core.isSelected(sel, rowId, c));
          cell.classList.toggle('active',
            sel.focus.r === rowId && sel.focus.c === c);
        }
      });
    }

    return {
      get: get,
      set: set,
      select: select,
      reconcile: reconcile,
      move: move,
      tab: tab,
      collapseToFocus: collapseToFocus,
      rowsRecycled: rowsRecycled,
      rowsMounted: paintRows,
      paintRows: paintRows,
    };
  }

  return { createSelectionLayer: createSelectionLayer };
});
