/* composition.js - IME composition state machine.
 *
 * Dependency direction: depends on NOTHING (no DOM, no scroll, no grid state).
 * Owns one fact only: "is an IME composition session open right now".
 * It deliberately does not share any flag with scroll offsets or with the
 * virtual window; scroll and composition are orthogonal states.
 *
 * Loaded as window.VGridComposition in the browser (plain <script>, works on
 * file://) and via require() in Node tests.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module === 'object' && module.exports) module.exports = mod;
  if (root) root.VGridComposition = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  /* Pure state machine. Transitions:
 *   start: idle -> composing
 *   end:   composing -> idle
 * Repeated starts/ends are harmless (some IMEs fire duplicate events). */
  function createCompositionSession() {
    let composing = false;
    return {
      isComposing: function () { return composing; },
      start: function () { composing = true; return composing; },
      end: function () { composing = false; return composing; },
    };
  }

  /* Binds a session to a real input element:
 *   compositionstart -> start, compositionend -> end
 * Mirrors the state into el.dataset.composing exactly like the old code,
 * and notifies an onEnd hook (used by callers that must reposition/refilter
 * only after the IME hands control back). Nothing here reads scroll state. */
  function bindComposition(el, session, onEnd) {
    el.addEventListener('compositionstart', function () {
      session.start();
      el.dataset.composing = '1';
    });
    el.addEventListener('compositionend', function () {
      session.end();
      el.dataset.composing = '0';
      if (onEnd) onEnd();
    });
    return session;
  }

  return {
    createCompositionSession: createCompositionSession,
    bindComposition: bindComposition,
  };
});
