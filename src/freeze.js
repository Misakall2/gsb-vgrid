/* freeze.js - frozen header / frozen first column alignment + column widths.
 *
 * Dependency direction:
 *   freeze -> GridCore (columnMetrics/resizeColumn pure math)
 * It is queried BY the row builder (cell widths), BY the editor (clipping
 * against the frozen column) and BY app (ensureVisible horizontal math).
 * Horizontal scroll state is read from the scrollport element, never stored
 * here; alignment is therefore always a pure function of one coordinate
 * system shared by header, body cells and the editor.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('../grid-core.js'));
  }
  if (root) root.VGridFreeze = factory(root.GridCore);
})(typeof self !== 'undefined' ? self : globalThis, function (Core) {
  'use strict';

  function createFreezeLayer(opts) {
    const columns = opts.columns;
    const headerEl = opts.headerEl;
    const onResize = opts.onResize || function () {};
    let widths = columns.map(function (col) { return col.width; });
    let metrics = Core.columnMetrics(widths);

    function getWidths() { return widths; }
    function getMetrics() { return metrics; }
    function colLeft(c) { return metrics.lefts[c]; }
    function frozenWidth() { return widths[0]; }

    function applyCellLayout(cell, c) {
      cell.style.width = widths[c] + 'px';
      cell.style.minWidth = widths[c] + 'px';
      cell.style.maxWidth = widths[c] + 'px';
    }

    function buildHeader() {
      headerEl.replaceChildren();
      headerEl.style.width = metrics.totalWidth + 'px';
      columns.forEach(function (col, i) {
        const cell = document.createElement('div');
        cell.className = 'cell' + (i === 0 ? ' sticky' : '');
        applyCellLayout(cell, i);
        cell.textContent = col.title;
        const handle = document.createElement('span');
        handle.className = 'resize-handle';
        handle.title = '拖动调整列宽';
        handle.dataset.c = String(i);
        cell.appendChild(handle);
        headerEl.appendChild(cell);
      });
    }

    /* Relayout the already-mounted header cells against the current widths. */
    function relayoutHeaderCells() {
      headerEl.style.width = metrics.totalWidth + 'px';
      for (let c = 0; c < headerEl.children.length; c++) {
        applyCellLayout(headerEl.children[c], c);
      }
    }

    function totalWidth() { return metrics.totalWidth; }

    /* Editor box in scrollport-relative coordinates. The frozen first column
 * owns the strip [0, frozenWidth]; an open editor on a scrolling column is
 * clipped so it never slides under the frozen pane. Pure geometry: the same
 * coordinates used for header/body alignment. */
    function editorBox(c, grid, topInCanvas, height) {
      let left = colLeft(c);
      let width = widths[c];
      if (c === 0) {
        left = 0;
      } else if (left < grid.scrollLeft + widths[0]) {
        const overlap = grid.scrollLeft + widths[0] - left;
        left += overlap;
        width = Math.max(0, width - overlap);
      }
      return {
        top: topInCanvas - grid.scrollTop,
        left: left - grid.scrollLeft,
        width: width,
        height: height,
      };
    }

    /* Horizontal scroll-into-view for a column, mirroring the keyboard
 * navigation behaviour; keeps the frozen column out of the target math. */
    function ensureColumnVisible(c, grid) {
      if (c <= 0) return;
      const left = colLeft(c);
      const right = left + widths[c];
      const viewL = grid.scrollLeft + widths[0];
      const viewR = grid.scrollLeft + grid.clientWidth;
      if (left < viewL) grid.scrollLeft = left - widths[0];
      else if (right > viewR) grid.scrollLeft = right - grid.clientWidth;
    }

    function bindColumnResize(grid) {
      headerEl.addEventListener('pointerdown', function (e) {
        const handle = e.target.closest('.resize-handle');
        if (!handle) return;
        e.preventDefault();
        const c = Number(handle.dataset.c);
        const startX = e.clientX;
        const startWidth = widths[c];
        document.body.classList.add('resizing-columns');

        function onMove(ev) {
          widths = Core.resizeColumn(widths, c, ev.clientX - startX, Core.MIN_COL_WIDTH);
          if (widths[c] === startWidth) return;
          metrics = Core.columnMetrics(widths);
          onResize(c);
        }
        function onUp() {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.body.classList.remove('resizing-columns');
        }
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
    }

    /* A width changed externally (none today, but keeps metrics honest). */
    function refresh() { metrics = Core.columnMetrics(widths); }

    return {
      getWidths: getWidths,
      getMetrics: getMetrics,
      colLeft: colLeft,
      frozenWidth: frozenWidth,
      totalWidth: totalWidth,
      applyCellLayout: applyCellLayout,
      buildHeader: buildHeader,
      relayoutHeaderCells: relayoutHeaderCells,
      editorBox: editorBox,
      ensureColumnVisible: ensureColumnVisible,
      bindColumnResize: bindColumnResize,
      refresh: refresh,
    };
  }

  return { createFreezeLayer: createFreezeLayer };
});
