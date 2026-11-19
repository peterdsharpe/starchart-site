// W196 comets3 (design/app-ui/SPEC.md §346), her row 20 (2026-10-31 08:14): "If I am on a route where I have to catch a bus, can I see
// the real time location of the upcoming bus? And a bubble next to it telling me in how many minutes the bus will arrive?"
//
// - While a course's bus leg is ahead (on the way to its stop, or at it with the boarding card), the phone asks the MBTA for that
//   stop's predictions on the leg's route and direction, with each bus's place (comets-logic.js busUrl: the stop, the route and the
//   direction, never a position), at most every 15 s, while the app is in sight and online, under the comets' Limiter.
// - The bus that leg boards (busOf) shows where the MBTA says, with a bubble of its minutes to the stop, the prediction's own. With
//   no place for its bus in the reply, no prediction, a failed or old reply, or offline: nothing drawn, and nothing claimed.
// - It stops when the leg is boarded or passed (at the stop, the bus it chose has left), the course ends, or the page is hidden.
// W228 transit2 (SPEC §481), her row 10 of 2026-11-13: "When I plan a route that uses a bus: show that bus where it is now, with its arrow ...
// only if the bus is due at my stop within 30 minutes ... Draw it only when the MBTA gives the bus's position." In a route's preview too, while
// a row with a bus is lit (its first bus, planBus; none on Data Saver); drawn only when due at her stop within SOON_MS (worthDrawing), and none
// asked for while its plan leaves past that (soon). The bus is her round sign, upright, and her arrow turns round it to the MBTA's bearing on
// the screen (turnOf), by night on the circle's edge, by day cut back by a white gap (design/glyphs/live/); with no bearing, no arrow.
import { busUrl, busOf } from "./comets-logic.js";
import { nextLeg } from "./walk-card.js";
import { MASSPORT } from "../chart/routing/transit.js"; // W192 sltimes: Massport's shuttles, of which the MBTA has no word

export const BUS_MS = 15000; // the wait between two asks
const OLD_MS = 3 * BUS_MS; // a bus drawn from a reply older than this goes: its place would be a guess
export const SOON_MS = 30 * 60000; // W228 transit2: a bus due at her stop within this is worth drawing; further, not
const EARLY_MS = 120000; // W228 transit2: busOf takes no bus more than this before the plan's time (comets-logic.js)
const DISC = 26, ARROW = (DISC * 148) / 64; // W228 transit2: the disc's px, and her arrow's box round it (148 units round the sign's 64)

/** W228 transit2: the bus a plan in a route's preview boards: its first bus leg, never a Massport shuttle's (SPEC §341); else null. */
export const planBus = (p) => { const t = p?.legs?.find((l) => l.type === "train" && l.mode === "bus"); return t && !t.route?.startsWith(MASSPORT) ? t : null; };
/** W228 transit2: may leg `l`'s bus be due at her stop within SOON_MS at `now` (ms)? busOf takes none more than EARLY_MS before the plan's time. */
export const soon = (l, now) => l.dep - EARLY_MS - now <= SOON_MS;
/** W228 transit2: is busOf's bus `b` worth drawing at `now`: a place from the MBTA, and due at her stop within SOON_MS. */
export const worthDrawing = (b, now) => !!b?.lonlat && Number.isFinite(b.due) && b.due - now <= SOON_MS;
/** W228 transit2: a point `m` metres from `ll` ([lon, lat]) along a bearing `deg` (from north, clockwise). */
export const along = ([lon, lat], deg, m) => { const r = (deg * Math.PI) / 180, k = m / 111320; return [lon + (k * Math.sin(r)) / Math.cos((lat * Math.PI) / 180), lat + k * Math.cos(r)]; };
/** W228 transit2: the arrow's turn on the screen, degrees clockwise from up, from the bus's point `a` and a point ahead of it on its bearing `b`,
 *  both as the map projects them ({ x, y }, y down): so the map's own bearing and tilt are in it. */
export const turnOf = (a, b) => ((Math.atan2(b.x - a.x, a.y - b.y) * 180) / Math.PI + 360) % 360;

/** The bus leg ahead in a course's legs (course.js nav.leg), or null: a bike and T course's first ride while leg 1 rides to it (n 1) or
 *  at its boarding card (n 0), after a change the second's (k 1, W212 bikeride); a walker's next ride while she walks to it (n 1), or
 *  the one whose boarding card shows (n 0). Never a Massport shuttle: the MBTA is never asked about them (SPEC §341). */
export function busAhead(leg) {
  if (!leg) return null;
  const t = leg.walk ? leg.plan?.legs?.[leg.n === 0 ? leg.i : leg.n === 1 ? nextLeg(leg.plan, leg.i) : -1] : leg.n === 0 || leg.n === 1 ? leg.legs?.trains?.[leg.n === 0 ? leg.k || 0 : 0] : null; // W212 bikeride: k
  return t?.type === "train" && t.mode === "bus" && !t.route?.startsWith(MASSPORT) ? t : null;
}

/**
 * Mount it. `leg()` is course.js's nav.leg; `limiter` the comets' (app/comets.js); `glyph` the bus's picture's URL; `words(t)` the
 * marker's words for a screen reader. tick() from the frame loop: it asks when one is due, and draws or hides the bus. Clocks: `ms()`
 * paces the asks (performance.now), `now()` dates the minutes (Date.now). Returns { tick, stats }.
 */
export function mountBusLive({ map, maplibregl, leg, limiter, glyph = () => "", words = (t) => t, key = "", fetchFn = (u, o) => fetch(u, o),
  ms = () => performance.now(), now = () => Date.now(), visible = () => document.visibilityState === "visible", online = () => navigator.onLine !== false,
  preview = () => null, arrow = () => "", saveData = () => navigator.connection?.saveData === true }) { // W228 transit2: preview(), the plan a route's preview shows; arrow(), the arrow's URL by theme
  const stats = { requests: 0, urls: [], shown: null }; // for tests: shown, { lonlat, eta, turn } while drawn (W228 transit2: turn, the arrow's degrees, or null)
  let marker = null, bubble = null, pic = null, head = null, at = -Infinity, got = -Infinity, asking = false, cur = "", trip = null, done = "";
  let seen = null, seenI, seenN, seenP = null, bus = null, inPreview = false; // the course's leg last read, and its bus leg: busAhead and the key only when they change, no string a frame (BRIEF §8); W228 transit2: seenP, the preview's plan
  let shownBus = null, turnB = NaN, turnP = NaN, turnZ = NaN; // W228 transit2: the bus drawn, and the camera its arrow was turned for
  let last = null; // W228 transit2: the bus last drawn for `cur`, drawn again when its leg comes back while its reply is fresh (Go on a bike and T trip)
  const hide = () => { marker?.remove(); marker = null; shownBus = null; stats.shown = null; };
  function turn() { // W228 transit2: the arrow round the upright bus, to the MBTA's bearing as the screen shows it; none without one
    const b = shownBus, c = map.getBearing(), p = map.getPitch(), z = map.getZoom();
    if (!b || (c === turnB && p === turnP && z === turnZ)) return;
    turnB = c; turnP = p; turnZ = z;
    const deg = b.bearing == null ? null : turnOf(map.project(b.lonlat), map.project(along(b.lonlat, b.bearing, 20)));
    head.hidden = deg == null;
    if (deg != null) head.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    if (stats.shown) stats.shown.turn = deg;
  }
  function show(b) {
    if (!marker) {
      const el = document.createElement("div");
      el.className = "cbus";
      pic = Object.assign(document.createElement("img"), { alt: "", width: DISC, height: DISC });
      head = Object.assign(document.createElement("img"), { alt: "", width: ARROW, height: ARROW }); // W228 transit2: her arrow, under the bus (inline: app/comets.css is another lane's)
      Object.assign(head.style, { position: "absolute", zIndex: "-1", left: `${(DISC - ARROW) / 2}px`, top: `${(DISC - ARROW) / 2}px`, width: `${ARROW}px`, height: `${ARROW}px`, maxWidth: "none" });
      bubble = Object.assign(document.createElement("span"), { className: "cmin on" });
      el.append(pic, bubble, head); // W228 transit2: head, after the bus (.cbus img) and under it
      marker = new maplibregl.Marker({ element: el }).setLngLat(b.lonlat).addTo(map);
    }
    const src = glyph(), hs = arrow(); // W228 transit2: hs
    if (pic.getAttribute("src") !== src) pic.src = src;
    if (head.getAttribute("src") !== hs) head.src = hs; // W228 transit2
    bubble.textContent = b.eta;
    marker.getElement().setAttribute("aria-label", words(b.eta));
    marker.setLngLat(b.lonlat);
    stats.shown = { lonlat: b.lonlat.slice(), eta: b.eta, turn: null };
    shownBus = last = b; turnB = NaN; turn(); // W228 transit2: last
  }
  async function ask(l, k) {
    asking = true; at = ms(); stats.requests++;
    const url = busUrl(l, key);
    stats.urls.push(url);
    let json = null;
    try {
      const r = await fetchFn(url, { cache: "no-cache", credentials: "omit", referrerPolicy: "no-referrer" });
      limiter.answer(r.status, Date.now());
      json = r.ok ? await r.json() : null;
    } catch { json = null; }
    asking = false;
    if (k !== cur || !bus) return; // another leg, or none, meanwhile (W228 transit2: the preview's too)
    const b = json && busOf(json, l, now(), !inPreview && leg()?.n === 0 ? trip : null); // W228 transit2: none chosen at the stop in a preview
    if (b?.gone) { done = k; hide(); return; } // boarded or passed: no more asks for this leg
    if (b) trip = b.trip; // placed or not, so at the stop the next bus can't pass for hers once it leaves
    if (!worthDrawing(b, now())) { last = null; hide(); return; } // W228 transit2: no place, or not due within 30 minutes: nothing drawn
    got = ms();
    show(b);
  }
  function tick() {
    const g = leg(), p = preview(); // W228 transit2: a route's preview first, its plan the subject (UX rule 35)
    if (p !== seenP || g !== seen || g?.i !== seenI || g?.n !== seenN) { // a new leg, or a walker's next one (course.js sets leg.i in place)
      seen = g; seenI = g?.i; seenN = g?.n; seenP = p; inPreview = !!p; bus = p ? planBus(p) : busAhead(g); // W228 transit2: p
      const k = bus ? `${bus.route}|${bus.dir}|${bus.from}|${bus.dep}` : ""; // W228 transit2: a preview's the ride's too, so Go keeps the bus drawn and asks nothing new
      if (k && k !== cur) { cur = k; trip = null; at = got = -Infinity; last = null; hide(); } // W228 transit2: no bus leg between (Go on a bike and T trip, while the ride to its stop is found) resets nothing: the same leg after it asks nothing new
    }
    const l = bus, k = cur;
    if (!l || k === done || !visible() || !online() || (inPreview && saveData())) { hide(); return; } // W228 transit2: a preview asks nothing on Data Saver
    if (marker && ms() - got > OLD_MS) hide(); // no fresh reply: no claim
    if (!marker && last && ms() - got <= OLD_MS) show(last); // W228 transit2: its leg back, its bus drawn again from the same reply
    if (marker) turn(); // W228 transit2: the arrow follows the map's turn and tilt (numbers compared a frame; projected only when they change)
    if (asking || ms() - at < BUS_MS || !soon(l, now()) || !limiter.take(Date.now())) return; // W228 transit2: none while its plan leaves past 30 minutes
    ask(l, k);
  }
  globalThis.addEventListener?.("starchart:theme", () => { if (marker && head.getAttribute("src") !== arrow()) head.src = arrow(); }); // W228 transit2: her arrow by day or night at once
  return { tick, stats };
}
