// W201 downloads2 (design/app-ui/SPEC.md §361, his row 6: "If I zoom into a region I don't have map data, you should offer to
// download with a pop up"). No map here: zoomed in (NOMAP_Z and up) with the view's centre past the chart's box and every stored
// map pack's, a bubble under the top row offers the pack whose box holds it: its name, its size and Download, a tap on any
// connection (on mobile data or Data Saver its words say so, as the course's offer does: app/course.js PACK). Then its progress
// with Pause, and once stored it goes, as the pack draws. In no pack's box, or past the state line (the packs are cut from the
// state's extract, so a box's corner over New Hampshire is empty: chart/style/massachusetts-v1.geojson), it says the map ends
// here. Once per area (a pack, or the map's end) per session (sessionStorage); a tap on the map closes it, as does a move back
// onto the chart or out past NOMAP_Z. It shows parked with nothing over the chart, in #dlnote's place, clear of the controls;
// the chart's heads-up steps aside while it shows (app/downloads.css), so one card at a time fits at 320 px and 150 % text.
import { careful, mb } from "./downloads.js";
import { pick, onLingo } from "./lingo-mode.js";
import { say } from "./tip.js";
import { swipeAway, ALL } from "./swipe.js"; // W210 popups3
import { backOnTouch } from "./dom.js"; // W210 popups3

/** The zoom from which a view past the chart asks: about 20 km across a phone, where streets are what you came for. */
export const NOMAP_Z = 11;
/** The words, [SCUL, Plain]; pack names are packs.json's, the same in both modes. */
export const NOMAP_WORDS = {
  offer: (name, size, guard) => [`Uncharted space. It's on the ${name} chart pack, ${size}${guard}.`, `No map here. It's on the ${name} map pack, ${size}${guard}.`],
  guard: (c) => (!careful(c) ? "" : c.saveData ? ", and Data Saver is on" : ", and you're on mobile data"),
  getting: (name, pct) => [`Downloading the ${name} chart pack, ${pct} %.`, `Downloading the ${name} map pack, ${pct} %.`],
  end: ["The chart ends here.", "The map ends here."],
  download: "Download", pause: "Pause",
};
const inBox = ([w, s, e, n], [x, y]) => x >= w && x <= e && y >= s && y <= n;
const inRing = (ring, [x, y]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
/** Whether the point is inside the (Multi)Polygon `g`, holes left out. */
export const inShape = (g, p) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates).some(([outer, ...holes]) => inRing(outer, p) && !holes.some((h) => inRing(h, p)));
/** The area the view lacks a map for: null (zoomed out, or `center` on the chart's box `base`, or a stored pack's inside the state),
 *  else { id } of the first pack (`packs`: [{ id, bounds, state }]) whose box holds it inside the state `mass` (the packs' extract's
 *  outline, chart/style/massachusetts-v1.geojson's geometry; null, not known yet: by the boxes alone), or { id: "" } in none. */
export function noMapAt(center, zoom, base, packs, mass = null) {
  if (!base || zoom < NOMAP_Z || inBox(base, center)) return null;
  const mine = !mass || inShape(mass, center) ? packs.filter((p) => inBox(p.bounds, center)) : []; // a box's corner past the state line has nothing in it
  if (mine.some((p) => p.state === "stored")) return null;
  return { id: mine[0]?.id ?? "" };
}
/** The bubble's words and buttons ([words, action][]) for a pack's list() item `d`, or past every pack (`d` null). */
export function bubble(d, conn) {
  if (!d) return { text: pick(...NOMAP_WORDS.end), buttons: [] };
  if (d.state === "downloading") return { text: pick(...NOMAP_WORDS.getting(d.name, Math.floor((100 * d.got) / d.bytes))), buttons: [[NOMAP_WORDS.pause, "pause"]] };
  if (d.state === "failed" && d.why) return { text: d.why, buttons: [[NOMAP_WORDS.download, "download"]] };
  return { text: pick(...NOMAP_WORDS.offer(d.name, mb(d.bytes - d.got), d.asks ? NOMAP_WORDS.guard(conn) : "")), buttons: [[NOMAP_WORDS.download, "download"]] };
}

const SEEN = "starchart:nomap"; // sessionStorage: the areas offered this session, by pack id ("" past every pack)
const seen = () => { try { return JSON.parse(globalThis.sessionStorage?.getItem(SEEN) || "[]"); } catch { return []; } };
const see = (id) => { try { globalThis.sessionStorage?.setItem(SEEN, JSON.stringify([...seen(), id])); } catch { /* storage off: no record */ } };

/** Wire the bubble `node` (#nomap) to `map`, the store `packs` (app/packs.js) and the manifest's `boxes` ([{ id, bounds }]);
 *  `base` resolves to the chart's [W, S, E, N], `state()` to the state's outline (a GeoJSON Feature). */
export function mountNoMap({ map, packs, boxes, base, state, node, conn = globalThis.navigator?.connection }) {
  let area = null, box = null, massP = null, said = ""; // said: the area and state last read out; massP: the state's outline, read at the first view past the chart's box (`state()`, precached)
  const free = () => document.documentElement.dataset.screen === "parked" && !document.body.dataset.open; // parked, nothing over the chart (app/screen.js)
  const text = document.createElement("span"), acts = document.createElement("span");
  text.className = "nt"; acts.className = "acts";
  node.replaceChildren(text, acts);
  let back = null; // W210 popups3 (SPEC §391): Android's back while it shows
  const close = () => { area = null; node.hidden = true; back?.destroy(); back = null; }; // W210 popups3: back
  swipeAway(node, { dirs: ALL, close }); // W210 popups3: any way, as a peek (W201 gestures)
  addEventListener("keydown", (e) => { if (e.key === "Escape" && !node.hidden) { e.preventDefault(); close(); } }, true); // W210 popups3: first, so the Escape that closes a search over it (it steps aside) isn't its too
  function show() {
    if (area === null) return close();
    const d = area.id ? packs.list().find((p) => p.id === area.id) : null;
    if (d?.state === "stored" && !d.update) return close(); // stored: the pack draws
    const s = bubble(d, conn), now = `${area.id} ${d?.state}`, was = node.hidden ? "" : said; // read out once a state (an offer, its download, its failure, the map's end), not at each percent
    text.textContent = s.text;
    acts.replaceChildren(...s.buttons.map(([t, act]) => Object.assign(document.createElement("button"), { className: "dlnow", textContent: t, onclick: () => packs[act](area.id) })));
    node.hidden = !free();
    said = now;
    if (!node.hidden && now !== was) say(text.textContent);
    if (node.hidden) { back?.destroy(); back = null; } else back ??= backOnTouch(() => { back = null; close(); }); // W210 popups3: stepped aside (a ride, a sheet), Back isn't its
  }
  async function check() {
    box ??= await base;
    const view = () => [[map.getCenter().lng, map.getCenter().lat], map.getZoom(), box, packs.list().map((p) => ({ ...p, bounds: boxes.find((b) => b.id === p.id)?.bounds ?? [0, 0, 0, 0] }))];
    if (!noMapAt(view()[0], view()[1], box, [])) return close(); // zoomed out, or on the chart: no outline needed
    const mass = await (massP ??= state().then((f) => f.geometry, () => { massP = null; return null; })); // unread: by the boxes alone, and asked again next time
    const at = noMapAt(...view(), mass); // the view now, after the wait
    if (!at) return close();
    if (area?.id === at.id) return show();
    if (!free()) return; // the area is offered once it can be seen
    if (seen().includes(at.id)) return close();
    see(at.id);
    area = at;
    show();
  }
  const look = () => check().catch((err) => console.warn("nomap:", err.message));
  map.on("moveend", look);
  map.on("click", close); // a map tap closes it
  addEventListener("starchart:screen", look); // the view again: a move made under a sheet or the search may be in another area by now
  packs.on((d) => { if (area?.id === d.id) show(); });
  onLingo(show);
  packs.ready.then(look);
  return { check: look, close, get area() { return area; } };
}
