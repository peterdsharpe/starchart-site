// W227 tapshows2 (design/app-ui/SPEC.md §476): where a tapped thing's card goes, as one rule. Plain values in, its place out, and no DOM,
// so each rung has a test of its own (app/tests/card-place.test.mjs). app/hints.js show() measures the card and what is around it, asks
// placeCard() and applies the answer; its relayout asks placeAgain(). peekSpot finds a spot for both (and course.js's stop pop-up).

/** Where a box of w × h goes near a tap at (x, y): above it, else below, else to either side, else farther above or
 *  below (past the ship, in flight), clear of `rects`, in view. W219 placecard: above or below, slid sideways clear of a control
 *  before it goes beside or farther (a card at 320 px beside the round buttons' column), the tap still over the box. W226 tapshows:
 *  `over`, else anywhere clear in view, nearest its point (over it where it can be: it covers only the thing it names). */
export function peekSpot(x, y, w, h, rects, view, gap = 26, pad = 8, over = false, cover = null) { // W226 tapshows: over; rel-0.1.118: cover, the route's own buttons on the map it may go over, as little of them as it can
  const clampX = (l) => Math.max(view.left + pad, Math.min(view.right - pad - w, l)), cx = clampX(x - w / 2);
  const slid = [...new Set([...rects, ...(cover || [])].flatMap((r) => [r.left - pad - w, r.right + pad]).map(clampX))].filter((l) => l !== cx && x >= l + 16 && x <= l + w - 16); // W219 placecard: the tap still over it, clear of its corners, so its tail stands straight
  const tries = [[cx, y - gap - h], [cx, y + gap], ...slid.flatMap((l) => [[l, y - gap - h], [l, y + gap]]), [x + gap, y - h / 2], [x - gap - w, y - h / 2]]; // W219 placecard: slid
  for (let d = 40; d <= 200; d += 40) tries.push([cx, y + gap + d], [cx, y - gap - h - d]);
  if (over) { // W226 tapshows: anywhere clear, nearest its point (over it where it can be), then nearest centred on it
    const ls = [...new Set([cx, ...rects.flatMap((r) => [r.left - pad - w, r.right + pad]).map(clampX)])], ts = [...new Set([y - h / 2, view.top + pad, view.bottom - pad - h, ...rects.flatMap((r) => [r.bottom + pad, r.top - pad - h])])]; // W226 tapshows
    const off = ([l, t]) => Math.max(0, l - x, x - l - w) + Math.max(0, t - y, y - t - h) + Math.abs(t + h / 2 - y) / 1e4; // W226 tapshows
    tries.push(...ls.flatMap((l) => ts.map((t) => [l, t])).sort((a, b) => off(a) - off(b))); // W226 tapshows
  } // W226 tapshows
  let best = null, most = Infinity; // rel-0.1.118: with `cover`, the spot over the least of them
  for (const [l, t] of tries) {
    if (t < view.top + pad || t + h > view.bottom - pad || l < view.left + pad || l + w > view.right - pad) continue;
    if (rects.some((r) => l < r.right + pad && l + w > r.left - pad && t < r.bottom + pad && t + h > r.top - pad)) continue;
    if (!cover) return { left: l, top: t };
    const a = cover.reduce((n, r) => n + Math.max(0, Math.min(l + w, r.right) - Math.max(l, r.left)) * Math.max(0, Math.min(t + h, r.bottom) - Math.max(t, r.top)), 0); // rel-0.1.118
    if (a < most) { most = a; best = { left: l, top: t }; if (!a) break; } // rel-0.1.118
  }
  return best;
}

/** Whether (x, y) is in box `b` (a DOMRect's left, top, right and bottom). */
export const inBox = (b, x, y) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
const meets = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
/** The px² of the boxes `rs` under a card of w × h at `s`. */
const covered = (s, w, h, rs) => rs.reduce((n, r) => n + Math.max(0, Math.min(s.left + w, r.right) - Math.max(s.left, r.left)) * Math.max(0, Math.min(s.top + h, r.bottom) - Math.max(s.top, r.top)), 0);
/** 0.1.116's heights for a cut: from `h` down by 8 px while over `least`, then `least`. */
const steps = (h, least) => { const out = []; for (let k = h; k > least; k -= 8) out.push(k); return [...out, least]; };

/**
 * Where a tapped thing's card goes (SPEC §476's order; the numbers are its rungs):
 *   c.x, c.y    the point it names, in the page's px; c.gap, how far beside it a card sits
 *   c.size      { w, h, least, row, strip }: its width and whole height; with rows (a station's, a stop's) its least (its name, its × and
 *               its tiles, its list empty), the least height that keeps its first row whole (`row`), and that shows its first strip
 *               and 24 px of its first row (`strip`); a card without rows has least = h and row = strip = 0
 *   c.narrow    the same at a place card's width, for a card wider than that (null: none, or it spills past its box)
 *   c.boxes     what to keep clear of, in the page's order (peekSpot's sideways tries follow it), each with its `kind`: "chrome" (the
 *               app's controls), "button" (the route's own buttons on the map: its time bubbles, its lit stops, its stops), "pin" (a pin or
 *               a bubble's frame on the map, which takes no tap) or "ship" (a ride's keep-out of the ship, last)
 *   c.aside     the same boxes with the route's sheet stepped aside, where it can step aside (a portrait preview, the sheet in place)
 *   c.view      the screen less its safe areas; c.dock, a parked station's or stop's card with the bars to dock between
 * Its answer: { rung, left, top, h, aside, narrowed, least, over }, or null (no card): the spot and the card's height there; whether the
 * sheet steps aside; whether it is narrowed; whether it is at its least (its list and key take no room); whether it lies over its
 * own point with none of the route's buttons under it (its body lets a press through to the map). Or { rung: 1, dock: true }.
 */
export function placeCard(c) {
  if (c.dock) return { rung: 1, dock: true };
  for (const z of [c.size, c.narrow]) {
    const p = z && ladder(c, z);
    if (p) return { ...p, narrowed: z === c.narrow };
  }
  return null; // 11: no place
}

const of = (X, ...kinds) => X.filter((r) => kinds.includes(r.kind));

function ladder(c, z) {
  const rows = z.row > 0, B = c.boxes, A = c.aside, pinsOk = (X) => of(X, "chrome", "button", "ship");
  const hs = rows ? steps(z.h, z.least) : [z.h], tall = hs.filter((k) => k === z.h || k >= z.row), low = hs.filter((k) => !tall.includes(k) || k < z.row); // tall: whole, or a row whole; low: below a row whole, a whole card capped short of its first row too (rel-0.1.119, the re-review: 0.1.116's cut started from it)
  const rowed = tall.filter((k) => k >= z.row); // a row whole: not a whole card capped short of its first row (comets.css), which moves no sheet
  const at = (rung, s, k, X, { aside = false, h = k } = {}) => {
    const box = { left: s.left, top: s.top, right: s.left + z.w, bottom: s.top + h };
    return { rung, left: s.left, top: s.top, h, aside, least: rows && h === z.least, over: inBox(box, c.x, c.y) && !of(X, "button").some((b) => meets(box, b)) };
  };
  /** The first height of `ks` with a spot clear of `rs`; with `cover`, the spot over the least of those (then the tallest, then the nearest). */
  const first = (rung, ks, X, rs, { over = false, cover = null, aside = false } = {}) => {
    let best = null, most = Infinity;
    for (const k of ks) {
      const s = peekSpot(c.x, c.y, z.w, k, rs, c.view, c.gap, 8, over, cover);
      if (!s) continue;
      if (!cover) return at(rung, s, k, X, { aside });
      const a = covered(s, z.w, k, cover);
      if (a < most) { most = a; best = at(rung, s, k, X, { aside }); if (!a) break; }
    }
    return best;
  };
  const pins = (X) => X.some((r) => r.kind === "pin"), buttons = (X) => X.some((r) => r.kind === "button");
  /** 6 and 7: 0.1.116's cut below a row whole, every height clear first, then every height over the pins; under `strip`, its least at the
   *  spot 0.1.116 found for that height. */
  const cut116 = (X, aside) => {
    for (const rs of pins(X) ? [X, pinsOk(X)] : [X]) for (const k of low) {
      const s = peekSpot(c.x, c.y, z.w, k, rs, c.view, c.gap);
      if (s) return k >= z.strip && k > z.least ? at(aside ? 9 : 6, s, k, X, { aside }) : at(aside ? 9 : 7, s, k, X, { aside, h: z.least });
    }
    return null;
  };
  /** 8: its least, or itself, over its own point: clear of everything, else over as little of the pins and the ship's keep-out as it can. */
  const point = (X, aside, r = aside ? 9 : 8) => first(r, [z.least], X, X, { over: true, aside }) || (X.some((b) => b.kind === "pin" || b.kind === "ship") ? first(r, [z.least], X, of(X, "chrome", "button"), { over: true, cover: of(X, "pin", "ship"), aside }) : null);
  /** 5, and 9's last: over the route's own buttons, covering as little of the route's marks on the map (and the ship's keep-out) as it can. */
  const marks = (r, ks, X, aside, over = false) => (buttons(X) ? first(r, ks, X, of(X, "chrome", ...(over ? [] : ["ship"])), { over, cover: of(X, "button", "pin", ...(over ? ["ship"] : [])), aside }) : null);
  return first(2, [z.h], B, B) // 2: whole, clear
    || (rows ? first(3, tall.slice(1), B, B) : null) // 3: cut to a row whole, clear
    || (pins(B) ? first(4, tall, B, pinsOk(B)) : null) // 4: 2 and 3 over the pins
    || (rows && A ? first(5, rowed, A, A, { aside: true }) || marks(5, rowed, A, true) : null) // 5: the sheet aside for a row whole, clear, else over as little of the route's marks as it can
    || (rows ? cut116(B, false) : null) // 6 and 7
    || point(B, false) // 8
    || (A ? (rows ? cut116(A, true) : first(9, [z.h], A, A, { aside: true }) || (pins(A) ? first(9, [z.h], A, pinsOk(A), { aside: true }) : null)) || point(A, true) : null) // 9: the sheet aside, 6, 7, 8 (2, 4, 8 for a card without rows) in its room
    || marks(9, [z.least], A || B, !!A, true); // 9: then over the route's own buttons, as little as it can
}

/** relayout's: a card whose content changed (a reply), measured anew at its own width (c.size's w and h), now at `now` ({ left, top, h },
 *  h the height it was placed at): beside its point whole and clear (2); else, a card with no list that grew onto a control or off the
 *  screen, over its point (8); else where it is ("kept"), a card with a list that grew there capped at the height it was placed at.
 *  A card at its least (c.least: its list and key take no room, so a reply doesn't change its size) stays where it was put (rung 7's
 *  spot is 0.1.116's, taller than the card). */
export function placeAgain(c, now) {
  const { x, y, gap, view, boxes: B } = c, { w, h } = c.size, rs = B.filter((r) => r.kind !== "ship");
  const kept = { left: Math.max(view.left + 8, Math.min(view.right - 8 - w, now.left)), top: now.top };
  const onto = kept.top < view.top + 8 || kept.top + h > view.bottom - 8 || rs.some((r) => kept.left < r.right + 8 && kept.left + w > r.left - 8 && kept.top < r.bottom + 8 && kept.top + h > r.top - 8); // grown onto a control, or off the screen
  let s = c.least && !onto ? null : peekSpot(x, y, w, h, B, view, gap), rung = 2;
  if (!s && onto && !c.list) { s = peekSpot(x, y, w, h, rs, view, gap, 8, true); rung = 8; }
  if (!s) { s = kept; rung = "kept"; }
  const cap = rung === "kept" && c.list && onto && h > now.h, hh = cap ? now.h : h, box = { left: s.left, top: s.top, right: s.left + w, bottom: s.top + hh };
  return { rung, left: s.left, top: s.top, h: hh, cap, over: inBox(box, x, y) && !of(B, "button").some((b) => meets(box, b)) };
}
