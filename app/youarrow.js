// W21 flight: in Free, with the ship off the screen, a small --you chevron at the screen's edge points to it, so the
// pilot knows which way it went (the W21 UX audit's F9: at speed the ship left the screen within 4 s of a drag).
// W26 peek: beside it, upright, the light years from the arrow to the ship. arclight, 2026-10-17: "the distance in
// light years right next to that arrow, in small font." 2026-10-20: from the arrow, not the chart's centre ("when it first
// appears, I should be just offscreen and it should show near-zero distance").

import { metres } from "./geo.js";
import { LY } from "./course-logic.js";
import { lingo } from "./lingo-mode.js"; // W60 a

/** W26 peek: the arrow's distance, "7.2 LY": one decimal under 10 LY, else whole. W60 a: "7.2 mi" in Plain. */
export const arrowLY = (m, mode = lingo()) => { // under 0.1 LY (zoomed right in) in feet to the nearest 50, as the scale reads, not "0.0 LY"
  const v = m / LY;
  if (v < 0.095) return `${Math.max(50, Math.round((m * 3.28084) / 50) * 50)} ft`;
  return `${v < 9.95 ? v.toFixed(1) : Math.round(v)} ${mode === "meatspace" ? "mi" : "LY"}`; // W60 a: mi
};

/** The arrow's distance in metres: from the chart's point under the chevron (`e`, edgePoint's) to the ship (2026-10-20). */
export const arrowMetres = (map, e, lngLat) => metres(map.unproject([e.x, e.y]).toArray(), lngLat);

/**
 * Where the chevron goes for the ship at screen point [x, y] on a w × h screen: on the line from the middle of the box
 * inset by `inset` ({ top, right, bottom, left }, px) to the ship, where it meets the box's edge. Null while the ship is
 * on the screen. `deg` turns the chevron, which points up at 0, toward the ship.
 */
export function edgePoint([x, y], w, h, inset) {
  if (x >= 0 && x <= w && y >= 0 && y <= h) return null;
  const L = inset.left, R = w - inset.right, T = inset.top, B = h - inset.bottom, cx = (L + R) / 2, cy = (T + B) / 2;
  const dx = x - cx, dy = y - cy;
  const k = Math.min(dx ? ((dx > 0 ? R : L) - cx) / dx : Infinity, dy ? ((dy > 0 ? B : T) - cy) / dy : Infinity);
  return { x: cx + dx * k, y: cy + dy * k, deg: (Math.atan2(dx, -dy) * 180) / Math.PI };
}

/** The chevron, a 28 px --you arrowhead; update(on, lngLat) shows it while `on` and the ship is off the screen. W26 peek: with
 *  its distance, 30 px in from it toward the middle of the screen, so it stays upright and on the screen. */
export function mountYouArrow(map, inset = { top: 84, right: 28, bottom: 96, left: 28 }) {
  const node = Object.assign(document.createElement("div"), { id: "youarrow", hidden: true });
  node.setAttribute("aria-hidden", "true");
  node.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28"><path d="M12 2.5 20.5 20 12 15.6 3.5 20Z"/></svg><span class="ly"></span>';
  document.body.append(node);
  const svg = node.firstChild, ly = node.lastChild; // W26 peek
  return {
    node,
    update(on, lngLat) {
      const p = on ? map.project(lngLat) : null; // the chart fills the page: innerWidth and innerHeight read no layout
      const e = p && edgePoint([p.x, p.y], innerWidth, innerHeight, inset);
      if (node.hidden !== !e) node.hidden = !e;
      if (!e) return;
      node.style.transform = `translate(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px) translate(-50%, -50%)`;
      svg.style.transform = `rotate(${e.deg.toFixed(1)}deg)`; // W26 peek: the chevron turns; its distance stays upright
      const a = (e.deg * Math.PI) / 180, text = arrowLY(arrowMetres(map, e, lngLat)); // from the arrow (2026-10-20)
      ly.style.transform = `translate(${(-30 * Math.sin(a)).toFixed(1)}px, ${(30 * Math.cos(a)).toFixed(1)}px) translate(-50%, -50%)`;
      if (ly.textContent !== text) ly.textContent = text;
    },
  };
}
