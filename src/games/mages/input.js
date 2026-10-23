// Mage Siege board input: turns pointer gestures on the canvas into board events. A short press is a tap (a long one
// asks for details), a one-finger drag either carries a mage (when the handler accepts the start tile) or pans the
// zoomed view, two fingers pinch-zoom and pan, and the mouse wheel zooms. Everything goes through the scene's loc() and
// tileAt(), so it works the same when an upright phone turns the game sideways.

const DRAG_PX = 9;      // movement that turns a press into a drag
const LONG_MS = 450;    // a press held this long without moving is a long tap

/**
 * createInput(view, handlers) → { cancel(), dispose() }
 * handlers: tap(tile, { long }), dragStart(tile) → true when it starts carrying something (otherwise the drag pans),
 * dragMove(tile), dragEnd(fromTile, toTile). Tiles are board indices, or -1 off the board.
 */
export function createInput(view, handlers) {
  const el = view.renderer.domElement;
  const pts = new Map(); // pointerId → { x, y } in game-frame pixels
  let press = null;      // the single-finger gesture: { id, x0, y0, t0, tile, mode: 'press' | 'carry' | 'pan', x, y }
  let pinch = null;      // { d, cx, cy }

  const at = e => view.loc(e);
  const centre = () => { let x = 0, y = 0; for (const p of pts.values()) { x += p.x; y += p.y; } return { x: x / pts.size, y: y / pts.size }; };
  const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };

  /** Ends a carry without a drop (a second finger, a cancelled pointer). */
  function abort() {
    if (press && press.mode === 'carry') handlers.dragEnd(press.tile, -1);
    press = null;
  }

  function down(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    el.setPointerCapture?.(e.pointerId);
    const p = at(e);
    pts.set(e.pointerId, p);
    if (pts.size === 1) {
      press = { id: e.pointerId, x0: p.x, y0: p.y, t0: performance.now(), tile: view.tileAt(e.clientX, e.clientY), mode: 'press', x: p.x, y: p.y };
    } else if (pts.size === 2) {
      abort();
      const c = centre();
      pinch = { d: spread(), cx: c.x, cy: c.y };
    }
  }

  function move(e) {
    if (!pts.has(e.pointerId)) return;
    const p = at(e);
    pts.set(e.pointerId, p);
    if (pinch && pts.size >= 2) {
      const c = centre(), d = spread();
      if (pinch.d > 0 && d > 0) view.zoomAt(d / pinch.d, c.x, c.y);
      view.panBy(c.x - pinch.cx, c.y - pinch.cy);
      pinch = { d, cx: c.x, cy: c.y };
      return;
    }
    if (!press || press.id !== e.pointerId) return;
    if (press.mode === 'press' && Math.hypot(p.x - press.x0, p.y - press.y0) > DRAG_PX) {
      press.mode = press.tile >= 0 && handlers.dragStart(press.tile) ? 'carry' : 'pan';
    }
    if (press.mode === 'carry') handlers.dragMove(view.tileAt(e.clientX, e.clientY));
    else if (press.mode === 'pan') view.panBy(p.x - press.x, p.y - press.y);
    press.x = p.x; press.y = p.y;
  }

  function up(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pinch) {
      if (pts.size < 2) pinch = null;
      if (pts.size === 1) {
        // The finger left on the glass carries on panning, never tapping
        const [[id, p]] = [...pts.entries()];
        press = { id, x0: p.x, y0: p.y, t0: 0, tile: -1, mode: 'pan', x: p.x, y: p.y };
      }
      return;
    }
    if (!press || press.id !== e.pointerId) return;
    const g = press;
    press = null;
    if (e.type === 'pointercancel') { if (g.mode === 'carry') handlers.dragEnd(g.tile, -1); return; }
    if (g.mode === 'carry') handlers.dragEnd(g.tile, view.tileAt(e.clientX, e.clientY));
    else if (g.mode === 'press') handlers.tap(g.tile, { long: performance.now() - g.t0 >= LONG_MS });
  }

  function wheel(e) {
    e.preventDefault();
    const p = at(e);
    view.zoomAt(Math.exp(-Math.max(-120, Math.min(120, e.deltaY)) * 0.0022), p.x, p.y);
  }

  const on = [['pointerdown', down], ['pointermove', move], ['pointerup', up], ['pointercancel', up], ['wheel', wheel, { passive: false }],
    ['contextmenu', e => e.preventDefault()]];
  for (const [type, fn, opts] of on) el.addEventListener(type, fn, opts);

  return {
    /** Drops any gesture in progress (a carried mage goes back). */
    cancel() { abort(); pinch = null; pts.clear(); },
    dispose() { for (const [type, fn] of on) el.removeEventListener(type, fn); },
  };
}
