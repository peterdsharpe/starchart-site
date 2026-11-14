// W196 comets3 (design/app-ui/SPEC.md §346), her row 20 (2026-10-31 08:14): "If I am on a route where I have to catch a bus, can I see
// the real time location of the upcoming bus? And a bubble next to it telling me in how many minutes the bus will arrive?"
//
// - While a course's bus leg is ahead (on the way to its stop, or at it with the boarding card), the phone asks the MBTA for that
//   stop's predictions on the leg's route and direction, with each bus's place (comets-logic.js busUrl: the stop, the route and the
//   direction, never a position), at most every 15 s, while the app is in sight and online, under the comets' Limiter.
// - The bus that leg boards (busOf) shows where the MBTA says, with a bubble of its minutes to the stop, the prediction's own. With
//   no place for its bus in the reply, no prediction, a failed or old reply, or offline: nothing drawn, and nothing claimed.
// - It stops when the leg is boarded or passed (at the stop, the bus it chose has left), the course ends, or the page is hidden.
import { busUrl, busOf } from "./comets-logic.js";
import { nextLeg } from "./walk-card.js";
import { MASSPORT } from "../chart/routing/transit.js"; // W192 sltimes: Massport's shuttles, of which the MBTA has no word

export const BUS_MS = 15000; // the wait between two asks
const OLD_MS = 3 * BUS_MS; // a bus drawn from a reply older than this goes: its place would be a guess

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
  ms = () => performance.now(), now = () => Date.now(), visible = () => document.visibilityState === "visible", online = () => navigator.onLine !== false }) {
  const stats = { requests: 0, urls: [], shown: null }; // for tests: shown, { lonlat, eta } while drawn
  let marker = null, bubble = null, pic = null, at = -Infinity, got = -Infinity, asking = false, cur = "", trip = null, done = "";
  let seen = null, seenI, seenN, bus = null; // the course's leg last read, and its bus leg: busAhead and the key only when they change, no string a frame (BRIEF §8)
  const hide = () => { marker?.remove(); marker = null; stats.shown = null; };
  function show(b) {
    if (!marker) {
      const el = document.createElement("div");
      el.className = "cbus";
      pic = Object.assign(document.createElement("img"), { alt: "", width: 26, height: 26 });
      bubble = Object.assign(document.createElement("span"), { className: "cmin on" });
      el.append(pic, bubble);
      marker = new maplibregl.Marker({ element: el }).setLngLat(b.lonlat).addTo(map);
    }
    const src = glyph();
    if (pic.getAttribute("src") !== src) pic.src = src;
    bubble.textContent = b.eta;
    marker.getElement().setAttribute("aria-label", words(b.eta));
    marker.setLngLat(b.lonlat);
    stats.shown = { lonlat: b.lonlat.slice(), eta: b.eta };
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
    const g = busAhead(leg());
    if (k !== cur || !g) return; // another leg, or none, meanwhile
    const b = json && busOf(json, l, now(), leg()?.n === 0 ? trip : null);
    if (b?.gone) { done = k; hide(); return; } // boarded or passed: no more asks for this leg
    if (b) trip = b.trip; // placed or not, so at the stop the next bus can't pass for hers once it leaves
    if (!b?.lonlat) { hide(); return; }
    got = ms();
    show(b);
  }
  function tick() {
    const g = leg();
    if (g !== seen || g?.i !== seenI || g?.n !== seenN) { // a new leg, or a walker's next one (course.js sets leg.i in place)
      seen = g; seenI = g?.i; seenN = g?.n; bus = busAhead(g);
      const k = bus ? `${bus.route}|${bus.dir}|${bus.from}|${bus.dep}` : "";
      if (k !== cur) { cur = k; trip = null; at = got = -Infinity; hide(); }
    }
    const l = bus, k = cur;
    if (!l || k === done || !visible() || !online()) { hide(); return; }
    if (marker && ms() - got > OLD_MS) hide(); // no fresh reply: no claim
    if (asking || ms() - at < BUS_MS || !limiter.take(Date.now())) return;
    ask(l, k);
  }
  return { tick, stats };
}
