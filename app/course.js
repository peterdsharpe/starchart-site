// Set a course (SPEC §16): the search field and its results, a long-press pin, a peek's › (app/hints.js), the
// preview of the three route styles (a drag on the chosen one reshapes it through vias), and the course in flight
// with its turn card, re-plotting and arrival.
//
// The engine is the router's and the search's (chart/routing/worker.js, through app/route-worker.js, and
// chart/search/search-worker.js),
// each in its own worker, started the first time the pilot searches or drops a pin, never at launch. Their
// files are data/manifest.json's `graph` and `search` entries: read from this phone's storage once stored
// (app/offline.js), from the network until then. The decisions are app/course-logic.js's.
//
// main.js calls mountCourse() once, and moments() at each step of the flight: while a course is set, the
// event engine flies the planned course instead of the live one (the live engine still counts the light years).

import { Course, EventEngine, metres } from "../chart/prototype/events.js"; // W53 turns: Course, for a preview's lit turn and strip
import { arrowFile, promptLine, promptText, turnWords, cardMove, distanceWords, callLine } from "../chart/prototype/course.js"; // W31 navvoice: promptText, cardMove, distanceWords; W60 b: callLine
import { lingo as lingoMode, pick as pickWords, plain as isPlain, onLingo } from "./lingo-mode.js"; // W60 b: the Words setting, SCUL or Plain
import { toCourse, roadLabels, roadName, WALK_SAY_M } from "../chart/routing/instructions.js"; // W32 routing: WALK_SAY_M; W60 b: roadName
import { labelFor } from "../chart/lingo/lingo.js";
import { mountHints, peekSpot } from "./hints.js"; // W23 touch; W54 course: peekSpot, for a stop's peek
import { canStore, prune, store, storedTiles } from "./offline.js";
import { ABOUT_M, angleBetween, barePin } from "./course-logic.js"; // W56 reroute: a turn just missed, ridden back to
import { ownName } from "./course-logic.js"; // W73 plan: a shared place's own name
import { kindResults } from "./course-logic.js"; // W104 oss2: a kind search's places, to light on the chart
import { routeMessage } from "./course-logic.js"; // W105 night: the worker's route message, its night
import { padSide, CourseFlight, OffSpell, ReplotGate, STYLE_CARDS, carFree, clockAt, distLabel, etaLine, leftLine, nameParts, mainName, sideLine, routeMinutes, LY, FT, placeName, // W60 b: placeName
  calloutAt, nearlySame, nearestOn, viaIndex, viasAhead, REACHED_M, compassWord, styleOf, iconPlace, foldStyles, bareRuns, bareShare, bareBar, firstPick, lineInk, runsAt, firstArrive, leaveAt } from "./course-logic.js"; // W102 leaveby: firstArrive, leaveAt // W86 ride: lineInk, runsAt // W59 routes: bareRuns, bareShare, bareBar, firstPick; // W21 routes; W21 entry: iconPlace, foldStyles; W21 flight: OffSpell
import { courseInk } from "./ink.js"; // the course's ink follows the theme
import { note } from "./trail-log.js"; // W48 feedback
import { holdMark, LINE_MS } from "./press.js"; // W26 hold: the ring, then the pop and the buzz; W84 roadtap: LINE_MS, the course line's hold
import { haptic, pulse } from "./haptics.js"; // W76 look: Undo's pulse (ART Motion rule 8), and the off-course heads-up's buzz
import { bearing } from "./geo.js"; // W25 course: the way to the landing pad, off course // W25 course: a hold on the chart buzzes, as a long press on a control does
import { mountFromTo, SEARCH_OFF } from "./fromto.js"; import { YOU, LAST_FIX, startFrom, lonlatOf, quickPicks, launchPlan, sameEnd } from "./fromto-logic.js"; // W23 fromto; W40 flight: sameEnd
import { tip, untip, say, place as placeBy, layoutRect, insets } from "./tip.js"; // W102 leaveby: placeBy, layoutRect, insets // W25 course: a control that can't act yet says why; W73 plan: untip; W73 a11y: say
import { pace, get as setting } from "./settings.js"; // W59 pace: the pilot's pace scales every minute shown, never the route chosen; W62 cometcard: setting
import { KEY as COMET_KEY, WORDS as COMET, cometCard, bikeCards, foldTo, trainLines, planPoints, cometLegs, stationPlace, nearLeave, boardText } from "./comet-card.js"; // W62 cometcard
import { KEY as WALK_KEY, WORDS as WALKW, walkCard, walkLegs, nextLeg, stopPlace } from "./walk-card.js"; // W73 walk; W79 walkgo: nextLeg, stopPlace
import { tipOnce } from "./tips.js"; // W49 cards: what transport-free counts, the first time
import { glideMs } from "../chart/prototype/follow.js"; // W29 polish: the camera's moves glide
import { mountTurns } from "./turns.js"; import { turnRows, cardWords } from "./turns-logic.js"; // W53 turns; W56 reroute: cardWords
import { warnings, withWarnings, warnDue } from "./turns-logic.js"; // W54 flight: steps and steep parts
import { drawLanes, laneLabel } from "./lanes.js"; // W53 lanes
import { near as anchoragesNear, loaded as anchoragesIn, words as anchorageWords, need as anchoragesNeed } from "./anchorages.js"; // W56 parking: the anchorages' file, dedicated racks first; W60 c: their words; W102 trim: need, the file once a pad is known
import { courseLink, parseCourse, graphDiffers, qrLine, qrRows, qrPath, MAX_POINTS } from "./share-logic.js"; // W54 course: share a course; W73 plan: MAX_POINTS
import { pinLink, parsePin } from "./share-logic.js"; // W67 places: one pin to share
import { parseLink } from "../chart/search/links.js"; // W67 places: map links and coordinates in Where to?
import { star as starIn, unstar as unstarIn, isStarred, starFirst, withStarred, pickGroups, WORDS as FAV } from "./starred-logic.js"; // W67 places; W88 favorites: pickGroups, FAV
import { starred, save as saveStarred, mountStarredRow } from "./starred.js"; // W67 places; W88 favorites: mountStarredRow
import { STOP_KINDS, kindWord, boxAround, stopsAlong, stopCounts, stopRow, rainPts, rainLine } from "./stops-logic.js"; // W54 course: stops and radiation along the course
import { parseRoute, WORDS as RF, ROUTE_SVG, inside } from "./routefile.js"; import { matchLine, strays as straysOf } from "./course-logic.js"; // W67 routefile: a route file as a course (SPEC §94)
import { gpx, gpxName } from "./logbook.js"; // W67 routefile: a course saved as GPX, by the Log's writer
import { dur, durNodes } from "./duration.js"; // W68 fixes: "1h 20m"
import { WORDS as AVOID, AVOID_SVG, addAvoid, removeAvoid, sameAvoid, forRouter, bentOf, marked, nearestPoint } from "./avoid-logic.js"; import { avoids, save as saveAvoids, mountAvoidRow, avoidedLine } from "./avoid.js"; // W73 avoid (SPEC §118); W80 avoidmap: avoidedLine
import { DELIGHT, chime, backOnCourse } from "./delight.js"; // W73 delight
import { burnTarget } from "./mission.js"; // W73 mission
import { hoursWords } from "./hours-logic.js"; // W77 hours: "Closed", "Closes 6 PM", else nothing
import { graphPick } from "./packmap.js"; // W82 packmap
import { isDay } from "./weather-logic.js"; // W105 night: a plan that starts after dark prefers lit paths
import { careful, mb } from "./downloads.js"; // W82 packui: the offer's mobile-data words, its size

const SPOT_PICK = { lingo_name: "Your last spot", name: "", place: "", kind: "waypoint" }; // W26 peek
const FORT = { lingo_name: "Fort Antwerp", name: "Artisans Asylum", place: "Allston, Boston", kind: "fort", lonlat: [-71.13946, 42.3596] };
const GLYPH_FILES = new Set(["aed", "anchorage", "asteroids", "black_hole", "buoy_field", "comet_station", "constellation", "derby_arena", "fort",
  "fuel_depot", "gantry", "grenade_depot", "hamburger_helper", "ice_cream", "klingon_dock", "lore", "luna", "meat_repair", "refueling_station",
  "sandworm_nest", "shore_leave", "space_dock", "space_station", "st_outpost", "steering_dampener", "tardis", "temple_of_knowledge",
  "coolant", "plasma", "stop"]); // W67 water; W91 stopsigns: stop
const GLYPH_OF = { system: "shield_system", quadrant: "shield_system", wormhole: "shield_wormhole", hyper_wormhole: "shield_wormhole",
  hyperspace_byway: "shield_byway", asteroid_belt: "nebula", heavy_nebula: "nebula" };
const glyphFor = (kind) => GLYPH_OF[kind] || (kind === "black_hole" && lingoMode() === "meatspace" ? "rotary" : GLYPH_FILES.has(kind) ? kind : "waypoint"); // W65 plainlook: Plain's rotary
const RECENT = "starchart.places", HOME = "starchart.home", STYLE = "starchart.style"; // STYLE: the route style the pilot picked last (arclight, 2026-10-16)
/** W83 progressive (SPEC §161): after the chosen style, the order the preview plans the rest, the quickest to plan first: over
 *  compare.mjs's fifty trips on the v5 graph, Quickest took 2.0 s a round, Wormholes 2.4 and Fewest hills 2.8. */
const PLAN_ORDER = ["quickest", "wormhole", "flat"]; // W83 progressive
/** W83 progressive: once the page has painted (rAF, then a task), or 100 ms on, as a hidden page paints none. */
const painted = () => new Promise((ok) => { requestAnimationFrame(() => setTimeout(ok)); setTimeout(ok, 100); }); // W83 progressive
const CARD_H = "126px"; // W53 turns: the card is 116 px, its foot a 44 px target (was 104 and 114)
const ROADS = new Set(["starpath", "wormhole", "hyper_wormhole", "hyperspace_byway", "transport_lane"]); // W28 launch: the kinds that are streets and paths (course-logic.js ROAD_KINDS)
// W25 course (find B5): what to do, not a JavaScript error
const REPLOT_WAIT_MS = 8000; // W31 navvoice: a re-plot's route that takes longer is tried again
const NO_ROUTER = ["No course: the route network isn't on this phone yet.", "No route: the route network isn't on this phone yet."]; // W60 b: [SCUL, Plain]
// W49 cards: what carFree() counts (course-logic.js; chart/routing/graph/build_graph.py's wormhole and shielded ways)
const PORT_TIP = "Port is left, starboard is right."; // W56 reroute: the first time a turn says one
const FREE_TIP = ["Transport-free: the share of this route kept apart from transports (cars and trucks), on wormholes or behind a curb, posts or parked cars. Paint alone doesn't count, and crossings still meet traffic.", // arclight 2026-10-23: back to car-free, a higher number a better ride
  "Car-free: the share of this route kept apart from cars and trucks, on bike paths or behind a curb, posts or parked cars. Paint alone doesn't count, and crossings still meet traffic."]; // W60 b: [SCUL, Plain]
// W59 routes: the words this lane added, one table, for W60's plain versions
const WORDS = { turnsList: ["Turn list", "Turn list"], /* W86 preview: the list button's name (W73 a11y: was the TURNS chip's end) */ bare: (pct) => pickWords(`${pct}% with transports, no bike lane`, `${pct}% with cars, no bike lane`), // W59 routes: a card's share without bike support, in its name; W60 b: Plain's
  offChart: ["Off the chart: courses cover Greater Boston.", "Off the map: routes cover Greater Boston."], // W68 fixes: a From, To or stop past the routing graph's bounds
  bike: ["Ship", "Bike"], bikeTip: ["Ship: by bike, the whole way", "Bike: the whole way"], modes: ["Ship or space walk", "Bike or walk"], // W86 preview: the From/To bar's switch
  carFreeM: [" transport-free", " car-free"], // W86 preview: the fourth metric; arclight 2026-10-23: "61 % car-free" again, as the cards say, a higher number a better ride
  arriveBy: ["Arrive by", "Arrive by"], leave: ["Leave ", "Leave "], earlier: ["5 min earlier", "5 min earlier"], later: ["5 min later", "5 min later"], clear: ["Clear", "Clear"], // W102 leaveby: the picker, and the ride time's cell after it
  leaveTip: ["Tap the ride time to plan when to launch.", "Tap the ride time to plan when to leave."] }; // W102 leaveby: the ride time's first-time tip
const LIST_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M9.5 6.5h10M9.5 12h10M9.5 17.5h10"/><circle cx="5" cy="6.5" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="5" cy="17.5" r="1.4"/></svg>`; // W86 preview: the turn list, no count
// W82 packui (SPEC §156): the map pack's offer, for a From, To or stop off the chart but in a pack's box, [SCUL, Plain]; pack and place names as they are
const PACK = { offer: (where, name, size, guard) => [`${where} is on the ${name} chart pack, ${size}${guard}. Download it?`, `${where} is on the ${name} map pack, ${size}${guard}. Download it?`], // W82 packui
  guard: (c) => (!careful(c) ? "" : c.saveData ? ", and Data Saver is on" : ", and you're on mobile data"), // W82 packui: list().asks, as the chart's heads-up says it (app/downloads.js)
  getting: (name, pct) => [`Downloading the ${name} chart pack, ${pct} %.`, `Downloading the ${name} map pack, ${pct} %.`], // W82 packui
  download: "Download", notNow: "Not now", pause: "Pause", stop: ["A stop", "A stop"], spot: ["This spot", "This spot"] }; // W82 packui; W82: spot, a dropped pin
const HINT = ["Places, starpaths, addresses. Hold the chart to set a course.", "Places, streets, addresses. Hold the chart to get directions."]; // W60 b: [SCUL, Plain]; W21 entry: before any typing; W25 course: a hold sets a course
const READYING = "Getting the search ready…"; // W47 firstload
const KEEP = ["Keep course", "Keep route"]; // W74 course (SPEC §128, D7): the heads-up's foot, [SCUL, Plain]
// W54 course: a shared course's words
const OTHER_GRAPH = "Plotted on your route network, a different version from the sender's."; // W54 course
const PLOTTING = "Plotting…"; // W73 plan: a route file's bubble while it is matched, the words the cards and Launch say
const TOO_MANY = [`That course has more than ${MAX_POINTS - 2} stops, too many to open.`, `That route has more than ${MAX_POINTS - 2} stops, too many to open.`]; // W73 plan: [SCUL, Plain]
// W67 places (SPEC §97): the words this lane added, [SCUL, Plain]
const PLACES = { star: ["Star", "Add to favorites"], starred: ["Starred", "In favorites"], unstarred: ["Unstarred", "Removed from favorites"], share: ["Share this place", "Share this place"], // W67 places; W88 favorites: Plain's Favorites
  copied: ["Link copied.", "Link copied."], noShare: ["This browser can't share or copy the link.", "This browser can't share or copy the link."], // W67 places
  short: ["Short links open only through Google. Paste the place's name.", "Short links open only through Google. Paste the place's name."], // W67 places: maps.app.goo.gl with no name beside it
  none: ["No place in this link.", "No place in this link."], pin: ["Waypoint", "Pin"] }; // W67 places
const STAR_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.6l-5.3 2.9 1.1-5.9-4.4-4.1 6-.8z"/></svg>`; // W67 places
const SHARE_SVG = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M8 11H6a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-2"/></svg>`; // W54 course

export function mountCourse({ map, maplibregl, lingo, world, data, at, flight, pills, pose, engine: freeEngine, launch, here, earthMs = (ms) => ms,
  origin = () => "your ship", canLaunch = () => true, lastFix = () => null, flow = null, framing = () => {}, noPosition = () => {}, gpsLost = () => false, weather = null,
  planned = () => {}, reached = () => {}, transit = () => null, gap = () => {}, walk = () => null, afoot = () => {}, packs = null }) { // W82 packmap and packui: packs, app/packs.js's store // W79 walkgo: afoot(), a walk launched: main.js keeps it out of the Log // W73 walk: walk, app/walk.js's // W62 cometcard: transit, app/transit.js's; gap(on), the Log's gap between a comet course's legs // W59 pace: planned(time_s), a course launched from its preview; reached(), its touchdown // W54 course: weather, for radiation on the course // W21 entry; W22 pretty: flow; W25 course: framing(on), as a sheet frames the chart and gives it back; noPosition(), the no-location sheet
  const entry = (kind) => data.files.find((f) => f.kind === kind);
  const graphEntry = entry("graph"), searchEntry = entry("search");
  const chEntry = entry("ch"); // W85 chpot: the graph's CH-potentials file, which makes long plans many times quicker (the same routes)
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const elDur = (tag, cls, text) => { const n = el(tag, cls); n.append(...durNodes(text)); return n; }; // W68 fixes: el(), a duration's h and m small
  const icon = (name) => el("i", `i i-${name}`);
  const glyphImg = (g, size) => Object.assign(el("img"), { alt: "", width: size, height: size, src: at(`design/glyphs/${g}.svg`) });
  /** A SCUL name with the lingo's generic word small and dim: "<i class=gen>Starpath</i> Maxwells Green". */
  const named = (tag, cls, kind, name, pre = "") => {
    const n = el(tag, cls, pre);
    for (const [i, p] of nameParts(lingo, kind, name).entries()) n.append(i ? " " : "", p.generic ? el("i", "gen", p.text) : p.text);
    return n;
  };
  const fire = (detail) => dispatchEvent(new CustomEvent("starchart:event", { detail }));
  const ui = { sheet: null, results: null, pin: null, snack: null, snackTimer: 0, view: null, mins: [], vias: [], handles: [], drag: null, grab: null, tapAt: 0 };
  /** W21 entry: Android's back gesture closes the search and the sheets, as it closes Settings (CloseWatcher, where there is one). */
  const back = {};
  const watchBack = (key, close) => {
    back[key]?.destroy();
    back[key] = null;
    if (close && window.CloseWatcher) { try { const w = back[key] = new CloseWatcher(); w.onclose = () => { if (back[key] === w) back[key] = null; close(); }; } catch { /* one per user gesture */ } }
  };

  // ---- the data, in workers -------------------------------------------------------------------------
  /** A data file: the stored copy when it is the manifest's, else the network's, else an older stored one. */
  async function dataFile(e) {
    const st = canStore() ? await storedTiles(e) : null;
    if (st && st.current) return st.file;
    try {
      const r = await fetch(at(e.path));
      if (!r.ok) throw new Error(`${e.path}: HTTP ${r.status}`);
      return await r.blob();
    } catch (err) { if (st) return st.file; throw err; }
  }
  let routerP = null, searchP = null, seq = 0, searchIn = false; // W47 firstload: searchIn, the index loaded
  let graphBounds = null; // W67 routefile: the routing graph's [W, S, E, N], once it is loaded; W83 progressive: no graphIn, as no card says Plotting
  /** W68 fixes: a point within ON_CHART_M of the graph's bounds: its ways run on past them a little (the graph keeps a way
   *  with any node inside), and a place by the edge snaps onto one; past that, the router could only snap far off. */
  const ON_CHART_M = 1000, onChart = (p, b = graphBounds, more = storedPacks.map((x) => x.bounds)) => { const dy = ON_CHART_M / 111320, dx = dy / Math.cos((p[1] * Math.PI) / 180); return [b, ...more].some((c) => inside(c && [c[0] - dx, c[1] - dy, c[2] + dx, c[3] + dy], p)); }; // W68 fixes; W82 packmap: or a stored pack's own box, so off the chart is off the base and every stored pack
  // W82 packmap (SPEC §155): the stored packs' graphs ([{ id, bounds, file }]), kept as they are stored and removed; a trip off
  // the base merges those it touches with the base's in the worker (graphsFor), and a trip on the base alone loads none
  // W83 algo (SPEC §163): once merged, a graph stays for the session: a trip it covers (on the base alone, or on fewer packs) plans on it
  let storedPacks = [], packGraphs = "", packMerge = Promise.resolve(), baseCh = null; // W82 packmap; W85 chpot: baseCh, the base's CH-potentials file once fetched, for the base again after a merge
  const packsKnown = () => (packsP = (async () => { storedPacks = (await Promise.all((packs ? data.packs || [] : []).map(async (p) => ({ id: p.id, bounds: p.bounds, file: await packs.file(p.id, "graph"), ch: await packs.file(p.id, "ch") })))).filter((p) => p.file); })().catch(() => {})); // W82 packmap; W85 chpot: ch, base ⊕ the pack's
  let packsP = packs ? packs.ready.then(packsKnown) : Promise.resolve(); // W82 packmap
  addEventListener("starchart:packs", (e) => { if (e.detail.state !== "downloading") packsKnown(); }); // W82 packmap
  /** W82 packmap: the router plans on the base's graph merged with the stored packs' the trip through `pts` touches. */
  function graphsFor(w, pts) { // W82 packmap
    const run = packMerge.then(async () => { // W82 packmap: one merge at a time, in order
      await packsP;
      const ids = graphPick(pts, (p) => onChart(p, graphBounds, []), storedPacks), blobs = ids.map((i) => storedPacks.find((p) => p.id === i).file); // W82 packmap
      const key = blobs.map((f) => `${f.name}:${f.size}`).join(), id = ++seq; // W82 packmap: a new release's graph merges again
      const held = packGraphs ? packGraphs.split(",") : [], stored = storedPacks.map((p) => `${p.file.name}:${p.file.size}`); // W83 algo
      if (key === packGraphs || (held.every((k) => stored.includes(k)) && blobs.every((f) => held.includes(`${f.name}:${f.size}`)))) return; // W82 packmap; W83 algo: or the merged graph in has them all (a trip on the base alone too) and none since removed: it stays
      await new Promise((ok, no) => { // W82 packmap: the worker unzips them one by one and answers ready
        const on = ({ data: m }) => { if (m.type !== "ready" && !(m.type === "error" && m.id === id)) return; w.removeEventListener("message", on); m.type === "ready" ? ok() : no(new Error(m.message)); }; // W82 packmap
        w.addEventListener("message", on); w.postMessage({ type: "graphs", id, blobs, ch: ids.length === 1 ? storedPacks.find((p) => p.id === ids[0]).ch : ids.length ? null : baseCh }); // W82 packmap; W85 chpot: ch, for base ⊕ one pack, or the base's again
      });
      packGraphs = key; nav.graphs = ids; // W82 packmap: for tests
    });
    packMerge = run.catch(() => {}); // W82 packmap
    return run;
  } // W82 packmap
  const chartIn = () => document.body.classList.contains("loaded") ? Promise.resolve() : new Promise((r) => addEventListener("starchart:ready", r, { once: true })); // W47 firstload
  const waiting = new Map();
  let routerKind = "not loaded"; // W88 feedbackinfo: wasm or js, once the router is ready (nav.router, for the feedback)
  const answer = ({ data: m }) => { const w = waiting.get(m.id); if (!w) return; waiting.delete(m.id); m.type === "error" ? w.no(new Error(m.message)) : w.ok(m); };
  function routerReady() {
    if (!graphEntry) return Promise.reject(new Error("no routing graph in this build"));
    return (routerP ??= (async () => {
      const w = new Worker(at("app/route-worker.js") + ({ wasm: "?router=wasm", js: "?router=js" }[new URLSearchParams(location.search).get("router")] ?? ""), { type: "module" }); // it unzips the graph, off the page; W83 rustroute: ?router=wasm, the search in WebAssembly (or ?router=js, router.js)
      const blob = await dataFile(graphEntry);
      await new Promise((ok, no) => {
        w.onmessage = ({ data: m }) => (m.type === "ready" ? ok((graphBounds = m.bounds || null), (routerKind = m.router || "js") /* W88 feedbackinfo */) : no(new Error(m.message))); // W83 progressive: no graphIn // W67 routefile: graphBounds, the chart's region
        w.onerror = (e) => no(new Error(e.message || "router failed"));
        w.postMessage({ type: "load", blob });
      });
      if (chEntry) dataFile(chEntry).then((ch) => w.postMessage({ type: "ch", blob: (baseCh = ch) }), (err) => console.warn("the CH-potentials file:", err.message)); // W85 chpot: after ready, so a plan never waits for it
      w.onmessage = answer;
      return w;
    })().catch((err) => { routerP = null; throw err; }));
  }
  /** A route through the vias; a `lane`'s request that a newer one in it replaced gives undefined (W21 routes). */
  async function route(from, to, style, via = [], lane = null, heading = null, about = false, night = null) { // W31 navvoice: heading, a re-plot's; W56 reroute: about; W105 night: night, the clock's unless given (a route file's: false)
    const w = await routerReady(); await graphsFor(w, [from, ...(via || []), to]); const id = ++seq, list = avoidList(); // W73 avoid: the avoided streets, with every route; W82 packmap: graphsFor
    const m = await new Promise((ok, no) => { waiting.set(id, { ok, no }); w.postMessage(routeMessage({ id, from, via, to, style: styleOf(style), lane, heading, about, avoid: list.length ? forRouter(list) : null, night })); }); // W56 reroute: about; W73 avoid: avoid; W105 night: routeMessage, night after sunset or before sunrise where it starts
    if (m.route?.avoids) { m.route.bent = bentOf(list, m.route.avoids); const k = marked(avoids(), m.route.avoids, list); if (k) saveAvoids(k); } // W73 avoid: the streets it went round, and those not found on this graph
    return m.stale ? undefined : m.route;
  }
  // ---- W73 avoid (SPEC §118): the streets the pilot avoids, and a shared course's, for that course only ----
  let sharedAvoid = []; // W73 avoid: a shared link's streets, for its course
  const avoidList = () => { const own = avoids(); return [...own, ...sharedAvoid.filter((a) => !own.some((b) => sameAvoid(a, b)))]; }; // W73 avoid
  /** W73 avoid: a street's name in the Words mode's words: "Starpath Mass Ave", "Massachusetts Avenue". */
  const avoidName = (a) => (a.name ? (pickWords(...roadLabels(lingo, { name: a.name, kind: a.kind })) || a.name).replace(/^the /, "") : pickWords(AVOID.street)); // W73 avoid
  mountAvoidRow({ label: avoidName }); // W73 avoid: Settings' row; W80 avoidmap: always there
  mountStarredRow({ label: placeName, glyph: (kind) => glyphImg(glyphFor(kind), 28) }); // W88 favorites: Settings' list, under it (SPEC §176)
  /** W73 avoid: avoid `a`, with Undo; the open preview, or the course in flight, plans again round it. */
  function avoidStreet(a) { // W73 avoid
    const before = avoids(), after = addAvoid(before, a, Date.now()), added = after !== before; // W73 avoid: added, not a street already avoided; W80 avoidmap: since now
    if (added) saveAvoids(after); // W73 avoid
    nav.avoided = a; // W73 avoid: for tests
    if (added) replanAvoid(); // W73 avoid
    snack(AVOID.avoiding(avoidName(a)), "", "Undo", 5000, () => { if (!added) return; saveAvoids(removeAvoid(avoids(), a).list); replanAvoid(); }); // W73 avoid: Undo never lets back a street avoided before
    if (ui.snack) delete ui.snack.dataset.preview; // W73 avoid: as a star's, its Undo outlives the preview's re-plot
  } // W73 avoid
  function stopAvoiding(a) { // W80 avoidmap: the peek's "Stop avoiding", with Undo; the open preview plans again
    const { list, undo } = removeAvoid(avoids(), a); saveAvoids(list); replanAvoid(); // W80 avoidmap
    snack(AVOID.stopped(avoidName(a)), "", "Undo", 5000, () => { saveAvoids(undo(avoids())); replanAvoid(); }); // W80 avoidmap
    if (ui.snack) delete ui.snack.dataset.preview; // W80 avoidmap: as Avoid's
  } // W80 avoidmap
  function replanAvoid() { // W73 avoid
    if (ui.replan && ui.sheet?.classList.contains("cpreview")) return ui.replan(); // W73 avoid
    const f = lastFix(); // W73 avoid
    if (flight.flying && nav.cf && f && replotting) avoidAgain = true; // W73 avoid: a re-plot under way asked without it: once it ends, again
    else if (flight.flying && nav.cf && f) replot(f, Number.isFinite(f.t) ? f.t : performance.now()); // W73 avoid
  } // W73 avoid
  let avoidAgain = false; // W73 avoid
  /** W73 avoid: the street at a point, from the chart's roads: `f`, a road the pilot tapped, else the nearest to the point. */
  function streetAt(lonlat, f = null) { // W73 avoid
    const near = f ? [] : world.roadsNear(lonlat, 25), road = f || near.slice(0, 3).find((r) => r.properties.name) || near[0]; // W73 avoid: a named one of the nearest three, so a sidewalk under the course isn't the street
    if (!road) return null; // W73 avoid
    const p = road.properties || {}; // W73 avoid
    return { name: p.street || p.name || "", kind: p.line || p.kind || "starpath", lonlat: nearestPoint(road.geometry, lonlat) || lonlat }; // W73 avoid: a bridge's street, not its own name
  } // W73 avoid
  /** W73 avoid: a live peek's Avoid, on a road's. */
  function avoidButton(a) { // W73 avoid
    const on = avoids().find((x) => sameAvoid(x, a)), b = el("button", "avoid"); b.innerHTML = AVOID_SVG; b.setAttribute("aria-label", pickWords(on ? AVOID.stop : AVOID.avoidThis)); b.title = b.getAttribute("aria-label"); // W73 avoid; W80 avoidmap: on, a street avoided: "Stop avoiding"
    if (on) b.setAttribute("aria-pressed", "true"); // W80 avoidmap: lit, as a starred place's star
    b.onclick = (e) => { e.stopPropagation(); hints.hidePeek(); if (on) stopAvoiding(on); else avoidStreet(a); }; // W73 avoid; W80 avoidmap: stopAvoiding
    return b; // W73 avoid
  } // W73 avoid
  const avoidActs = (f, lonlat) => { const a = f?.sourceLayer === "roads" && f.layer?.type === "line" && streetAt(lonlat, f); return a ? [avoidButton(a)] : []; }; // W73 avoid
  function searchReady() {
    if (!searchEntry) return Promise.reject(new Error("no search index in this build"));
    return (searchP ??= (async () => {
      const w = new Worker(at("chart/search/search-worker.js"), { type: "module" });
      w.onmessage = answer;
      const file = await dataFile(searchEntry), id = ++seq;
      await new Promise((ok, no) => { waiting.set(id, { ok, no }); w.postMessage({ id, type: "load", file, pack: lingo, gazetteer: at("chart/search/gazetteer.json") }); }); // W82 packui: the gazetteer
      searchIn = true; // W47 firstload
      packs?.ready.then(() => packIndexes(w)); // W82 packui
      return w;
    })().catch((err) => { searchP = null; throw err; }));
  }
  /** W82 packui: the stored packs' search indexes, to the search worker, again whenever a pack is stored or removed. */
  async function packIndexes(w) { // W82 packui
    const list = []; // W82 packui
    for (const p of packs.list()) if (p.state === "stored") { const file = await packs.file(p.id, "search"); if (file) list.push({ id: p.id, key: data.packs.find((x) => x.id === p.id).files.find((f) => f.kind === "search").sha256, file }); } // W82 packui
    const id = ++seq; // W82 packui
    await new Promise((ok, no) => { waiting.set(id, { ok, no }); w.postMessage({ id, type: "packs", packs: list }); }).catch((err) => console.warn("pack search:", err.message)); // W82 packui
  } // W82 packui
  addEventListener("starchart:packs", ({ detail: d }) => { if (searchIn && (d.state === "stored" || d.state === "none")) searchP?.then(packIndexes); }); // W82 packui
  async function search(q, near) {
    const w = await searchReady(), id = ++seq;
    const m = await new Promise((ok, no) => { waiting.set(id, { ok, no }); w.postMessage({ id, type: "search", q, near, opts: { limit: 8 } }); });
    const me = origin() ? here() : null; // W26 peek (friction 4): ranked from the chart in view, the LY are still from you
    const res = isPlain() ? m.results.map((r) => (r.kind === "fort" ? { ...r, name: FORT.name } : r)) : m.results; // W60 b: in Plain the Fort is Artisans Asylum, as on the chart
    return me ? res.map((r) => ({ ...r, distance_m: metres(me, r.lonlat) })) : res; // W60 b: res
  }
  /** W54 course: the index's places of `kinds` in a box, for the stops along a course. */
  async function placesIn(kinds, bbox) { // W54 course
    const w = await searchReady(), id = ++seq; // W54 course
    return (await new Promise((ok, no) => { waiting.set(id, { ok, no }); w.postMessage({ id, type: "inbox", kinds, bbox }); })).results; // W54 course
  } // W54 course
  // Stored with the tiles: once the chart is on the phone, the graph and the index follow, one at a time. W26: at every
  // offline-ready, so Settings' Download now (which stores the chart, then says offline-ready) retries one that failed;
  // what is stored and current is skipped, and never two runs at once.
  let storing = false;
  addEventListener("starchart:offline-ready", async () => {
    if (storing) return;
    storing = true;
    try {
      for (const e of [graphEntry, chEntry, searchEntry]) { // W85 chpot: chEntry
        if (!e) continue;
        try {
          const st = await storedTiles(e);
          if (!st || !st.current) { prune([e.sha256, st?.state.sha256].filter(Boolean), e.kind); await store(at(e.path), e); }
          else prune([e.sha256], e.kind);
        } catch (err) { console.warn(`storing the ${e.kind}:`, err.message); }
      }
    } finally { storing = false; }
  });

  // ---- the course on the chart ----------------------------------------------------------------------
  let PROG = courseInk(); // the theme's ink, again at each theme switch (app/ink.js)
  const line = (coords) => ({ type: "FeatureCollection", features: coords ? [{ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } }] : [] });
  // The preview's other styles, dim under the chosen one; a tap on one (within its wide, unseen hit line) picks it.
  const alts = (list) => ({ type: "FeatureCollection", features: (list || []).map((a) => ({ type: "Feature", properties: { style: a.style }, geometry: { type: "LineString", coordinates: a.geometry } })) });
  map.addSource("course-alt", { type: "geojson", data: alts(null) });
  const under = map.getLayer("course-glow") ? "course-glow" : undefined;
  // W49 cards: the preview's lines, the chosen one and the others, one width (arclight, 2026-10-19: the chosen one read
  // thinner); the chosen one has its casing, glow and dots over it, and the others are dimmer, 0.4, to tell them apart
  const LINE_W = ["interpolate", ["linear"], ["zoom"], 12, 2.8, 16, 4.2, 19, 6];
  map.addLayer({ id: "course-alt", type: "line", source: "course-alt", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": PROG.ahead, "line-opacity": 0.4, "line-width": LINE_W } }, under);
  map.addLayer({ id: "course-alt-hit", type: "line", source: "course-alt", paint: { "line-color": PROG.ahead, "line-opacity": 0.01, "line-width": 28 } }, under);
  // W25 course: with From elsewhere, the way from the ship to it, dim and dashed: Launch leads there first
  map.addSource("course-lead", { type: "geojson", data: line(null) });
  map.addLayer({ id: "course-lead", type: "line", source: "course-lead", layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": PROG.ahead, "line-opacity": 0.6, "line-dasharray": [0.1, 1.8], "line-width": ["interpolate", ["linear"], ["zoom"], 12, 3, 16, 6, 19, 8] } }, under);
  // W31 navview: in flight the course is road-width over its casing, to read at a glance on any street (SPEC §43); the
  // preview keeps the style's thin line. The next turn is marked on it, as Google Maps marks it: a white arrow over a
  // dark casing, from 25 m before the turn to 15 m after it.
  const roadW = (a, b) => ["interpolate", ["exponential", 1.5], ["zoom"], 12, a, 17, b, 20, b * 3]; // the shape of the style's road widths
  const WIDE = { "course-glow": roadW(8, 28), "course-casing": roadW(4.5, 15), course: roadW(2.5, 11) };
  const THIN = Object.fromEntries(Object.keys(WIDE).map((id) => [id, map.getLayer(id) ? map.getPaintProperty(id, "line-width") : null]));
  Object.assign(THIN, { course: LINE_W, "course-casing": ["interpolate", ["linear"], ["zoom"], 12, 4.8, 16, 6.2, 19, 8] }); // W49 cards: a px of casing each side
  for (const id of ["course", "course-casing"]) if (map.getLayer(id)) map.setPaintProperty(id, "line-width", THIN[id]);
  const PLAIN = new Set(["straight", "arrive", "depart"]); // not turns: no arrow
  const turnInk = () => (document.documentElement.dataset.theme === "light" ? "#1b1638" : "#07060d"); // --starlight by day, --void by night
  const chevrons = map.getLayer("course-chevrons") ? "course-chevrons" : undefined;
  map.addSource("course-turn", { type: "geojson", data: line(null) });
  const isLine = ["==", ["geometry-type"], "LineString"], round = { "line-cap": "round", "line-join": "round" };
  map.addLayer({ id: "course-turn-casing", type: "line", source: "course-turn", filter: isLine, layout: round, paint: { "line-color": turnInk(), "line-width": roadW(3.5, 10) } }, chevrons);
  map.addLayer({ id: "course-turn", type: "line", source: "course-turn", filter: isLine, layout: round, paint: { "line-color": "#ffffff", "line-width": roadW(1.5, 5) } }, chevrons);
  const headImage = () => { // the arrow's head, pointing north: white, edged in the casing's ink
    const n = 64, c = Object.assign(document.createElement("canvas"), { width: n, height: n }), g = c.getContext("2d", { willReadFrequently: true }); // W74 start: read back on the CPU, not behind the GPU's queue
    g.beginPath(); g.moveTo(n / 2, 6); g.lineTo(n - 6, n - 10); g.lineTo(n / 2, n - 22); g.lineTo(6, n - 10); g.closePath();
    g.lineJoin = "round"; g.lineWidth = 7; g.strokeStyle = turnInk(); g.stroke(); g.fillStyle = "#ffffff"; g.fill();
    return g.getImageData(0, 0, n, n);
  };
  map.addImage("course-turn-head", headImage(), { pixelRatio: 2 });
  map.addLayer({ id: "course-turn-head", type: "symbol", source: "course-turn", filter: ["==", ["geometry-type"], "Point"],
    layout: { "icon-image": "course-turn-head", "icon-rotate": ["get", "b"], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map",
      "icon-allow-overlap": true, "icon-ignore-placement": true, "icon-size": roadW(0.35, 1.1) } }, chevrons);
  let wideNow = false, turnAt = null;
  /** Wide in flight with a course, thin in a preview and parked. */
  function lineLook() {
    const wide = flight.flying && !!nav.cf && !ui.sheet?.classList.contains("cpreview");
    if (wide === wideNow) return;
    wideNow = wide;
    for (const id in WIDE) if (THIN[id] && map.getLayer(id)) map.setPaintProperty(id, "line-width", wide ? WIDE[id] : THIN[id]);
    if (map.getLayer("course-walk")) ["symbol-spacing", "icon-size"].forEach((k, i) => map.setLayoutProperty("course-walk", k, FEET[wide ? "wide" : "thin"][i])); // W86 ride: the footprints too
    markTurn(lastS);
  }
  /** The arrow on the next turn, sent again only when the next turn changes; nav.turnIn, the metres to it (the follow camera's zoom). */
  function markTurn(s) {
    const ins = wideNow && !nav.cf?.last?.off ? nav.cf.feature.properties.instructions.find((i) => i.along_m > s + 5 && !PLAIN.has(i.turn)) : null;
    nav.turnIn = ins ? ins.along_m - s : null;
    if (ui.lit) return; // W53 turns: a turn the list lit holds the arrow
    const at = ins?.along_m ?? null;
    if (at === turnAt) return;
    turnAt = at;
    map.getSource("course-turn")?.setData(turnArrow(nav.cf?.course, at)); // W53 turns: turnArrow
  }
  /** The arrow along a Course `c` from 25 m before the turn at `at` metres to 15 m after (W53 turns: for the list's lit turn too). */
  function turnArrow(c, at) { // W53 turns
    const pts = at === null || !c ? null : c.slice(Math.max(0, at - 25), Math.min(c.length, at + 15)); // W53 turns
    const end = pts?.at(-1), from = pts?.findLast((p) => p[0] !== end[0] || p[1] !== end[1]); // W53 turns
    return !from ? line(null) : { type: "FeatureCollection", features: [ // W53 turns
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } }, // W53 turns
      { type: "Feature", properties: { b: bearing(from, end) }, geometry: { type: "Point", coordinates: end } }] }; // W53 turns
  } // W53 turns
  // W53 turns: the turn list and the course strip (app/turns.js); a lit turn's arrow holds until the list lets it go
  const turns = mountTurns({ map, maplibregl, at, sheetTop: () => (!ui.sheet ? Infinity : sideSheet(ui.sheet) ? 0 : ui.sheet.offsetTop), // W53 turns; W86 preview: sideSheet
    arrow: (m, c) => { ui.lit = m !== undefined; if (ui.lit) map.getSource("course-turn")?.setData(turnArrow(c, m)); else { turnAt = undefined; markTurn(lastS); } } }); // W53 turns
  /** W53 turns: a route's rows for the list: its turns in the card's words, then the landing pad on its side. */
  const rowsOf = (r, place, side) => { const list = toCourse(lingo, r).properties.instructions; // W53 turns
    const rows = turnRows(list, { name: (i) => (i.road ? roadName(lingo, i.road, lingoMode()) : null), pulsar: pulsarAt, stop: (i) => stopAt(i, r), side, // W53 turns; W56 parking: rows; W60 b: roadName, in the mode; W86 stops: stop
      pad: `${list.at(-1)?.walk_m >= WALK_SAY_M ? "Walk across" : pickWords("Landing pad", "Destination")}: ${mainName(lingo, place.kind, placeName(place))}` }); // W53 turns; W60 b
    if (rows.at(-1)?.pad) rows.at(-1).text += padAnchors(place); // W56 parking: "Landing pad: Western, to starboard · 7 anchorages"
    return rows; }; // W56 parking
  // W32 routing: the walk between a place and the course, where the course stops across the street from it: dotted
  const walks = (w, more = [], flown = []) => ({ type: "FeatureCollection", features: [w?.start, w?.end, ...more].filter(Boolean).map((c) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c } }))
    .concat(flown.map((c) => ({ type: "Feature", properties: { o: 0.32 }, geometry: { type: "LineString", coordinates: c } }))) }); // W86 ride: more, the stretches the course walks; flown, those behind the ship, dim as the line is
  map.addSource("course-walk", { type: "geojson", data: walks(null) });
  // W86 ride (SPEC §168): her note, "If there is a section where you think I should walk my bike, please display little orange
  // footprints during the ride instead of displaying the continuous orange line": every walk, the stretches the course walks
  // (the route's `walks`: steps, a way the bike is walked on, the wrong way up a one-way; the line has a gap there), the walks
  // to and from it, and a comet plan's walking legs, as pairs of the course's orange footprints edged in the casing's ink,
  // pointing the way, in the preview and in flight, at every zoom the course shows; no motion, so Calm is the same
  const feetImage = () => { // W86 ride: a left and a right foot, heading east (the line's way), each a sole and a heel
    const n = 48, c = Object.assign(document.createElement("canvas"), { width: n, height: n }), g = c.getContext("2d", { willReadFrequently: true }); // W86 ride
    const blob = (x, y, rx, ry) => { g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, 2 * Math.PI); g.stroke(); g.fill(); }; // W86 ride
    g.lineWidth = 3; g.strokeStyle = turnInk(); g.fillStyle = PROG.ahead; // W86 ride
    for (const [x, y] of [[29, 14], [15, 34]]) { blob(x + 5, y, 7.5, 5); blob(x - 8, y, 4, 3.8); } // W86 ride: left ahead, right behind; each a sole, and its heel apart
    return g.getImageData(0, 0, n, n); // W86 ride
  }; // W86 ride
  map.addImage("course-feet", feetImage(), { pixelRatio: 2 }); // W86 ride
  // W88 ridemodes (SPEC §174): her note, "when zooming out a lot those footprints become very far apart on the map … the walking
  // sections should just become a line of dots that still display close to each other": below FEET_Z a walk is a line of close
  // dots, in the same orange edged in the same ink, about the casing's width; from FEET_Z (the tiles' whole zoom) the footprints
  const FEET_Z = 16; // W88 ridemodes: a pair 20 px across, 22 px (40 m) apart there; below it the pairs blur, 70 m and more apart
  const dotImage = () => { // W88 ridemodes: a disc, the feet's ink and edge, 8 px at icon-size 1
    const n = 16, c = Object.assign(document.createElement("canvas"), { width: n, height: n }), g = c.getContext("2d", { willReadFrequently: true }); // W88 ridemodes
    g.lineWidth = 2.5; g.strokeStyle = turnInk(); g.fillStyle = PROG.ahead; g.beginPath(); g.arc(n / 2, n / 2, n / 2 - 1.5, 0, 2 * Math.PI); g.fill(); g.stroke(); // W88 ridemodes
    return g.getImageData(0, 0, n, n); // W88 ridemodes
  }; // W88 ridemodes
  map.addImage("course-dot", dotImage(), { pixelRatio: 2 }); // W88 ridemodes
  const FEET = { thin: [["interpolate", ["linear"], ["zoom"], 12, 8, FEET_Z - 0.01, 8, FEET_Z, 22, 19, 30], ["interpolate", ["linear"], ["zoom"], 12, 0.6, 16, 0.85, 19, 1.2]], // W86 ride: [spacing, size] in a preview; W88 ridemodes: the dots 8 px apart
    wide: [["interpolate", ["linear"], ["zoom"], 12, 11, FEET_Z - 0.01, 11, FEET_Z, 32, 19, 50], ["interpolate", ["linear"], ["zoom"], 12, 0.9, 16, 1.3, 19, 2]] }; // and in flight, as the line widens; W88 ridemodes: the dots 11 px apart
  map.addLayer({ id: "course-walk", type: "symbol", source: "course-walk", layout: { "symbol-placement": "line", "symbol-spacing": FEET.thin[0], // W86 ride: footprints, was a dotted line
    "icon-image": ["step", ["zoom"], "course-dot", FEET_Z, "course-feet"], "icon-size": FEET.thin[1], "icon-rotation-alignment": "map", "icon-pitch-alignment": "map", "icon-keep-upright": false, // W86 ride; W88 ridemodes: icon-image, dots below FEET_Z
    "icon-allow-overlap": true, "icon-ignore-placement": true }, paint: { "icon-opacity": ["coalesce", ["get", "o"], 1] } }, chevrons); // W86 ride: over the course, under its chevrons
  // W59 routes: the stretches with no bike support (course-logic.js bareRuns), on the chosen line and the others: `--caution`
  // over the orange, so a glance reads "mostly orange, but this stretch and that one", with a dotted core in the ground's
  // colour, the cue that isn't colour (lime and orange meet in deuteranopia). Not red: the Red Line's comet tracks are red
  // (W57), and a dashed track beside a red stretch would read as one. In flight, only the stretches ahead of the ship.
  const tokenInk = (v, or) => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || or; // W59 routes
  const cautionInk = () => tokenInk("--caution", "#afce00"), coreInk = () => tokenInk("--void", "#07060d"); // W59 routes
  const BARE_DASH = [1.2, 1.6]; // W59 routes: the core's dots, in its widths
  const CORE_W = ["interpolate", ["linear"], ["zoom"], 12, 1.1, 16, 1.7, 19, 2.4]; // W59 routes: about 0.4 of the line
  const bareLines = (list) => ({ type: "FeatureCollection", features: list.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c } })) }); // W59 routes
  /** W59 routes: a route's bare stretches as lines, from `from_m` on, on its geometry (`course`, a Course, or one made). */
  const bareOn = (r, course = null, from_m = 0) => { // W59 routes
    const runs = bareRuns(r); if (!runs.length) return []; // W59 routes
    const c = course || new Course({ properties: {}, geometry: { type: "LineString", coordinates: r.geometry } }), k = r.distance_m > 0 ? c.length / r.distance_m : 1; // W59 routes: the router's metres to the line's
    return runs.map(([a, b]) => [Math.max(a * k, from_m), b * k]).filter(([a, b]) => b - a > 1).map(([a, b]) => c.slice(a, b)); // W59 routes
  }; // W59 routes
  for (const [id, o, w, before] of [["course-alt-bare", 0.5, LINE_W, "course-alt-hit"], ["course-bare", 1, THIN.course, "course-turn-casing"]]) { // W59 routes: the others' as faint as they are; the chosen one's over the course, under the turn's arrow and the chevrons
    map.addSource(id, { type: "geojson", data: bareLines([]) }); // W59 routes
    map.addLayer({ id, type: "line", source: id, layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": cautionInk(), "line-opacity": o, "line-width": w } }, before); // W59 routes
    map.addLayer({ id: `${id}-core`, type: "line", source: id, layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": coreInk(), "line-opacity": o, "line-width": CORE_W, "line-dasharray": BARE_DASH } }, before); // W59 routes
  } // W59 routes
  // W67 routefile: where a route file's course leaves the file by more than 50 m (course-logic.js strays), chalk dashes over the
  // course, at its width (--chalk: your own marks), so it reads apart from W59's lime with dark dots; the preview's line says how many
  const chalkInk = () => tokenInk("--chalk", "#f4efe2"); // W67 routefile
  map.addSource("course-stray", { type: "geojson", data: bareLines([]) }); // W67 routefile
  map.addLayer({ id: "course-stray", type: "line", source: "course-stray", layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": chalkInk(), "line-width": LINE_W, "line-dasharray": [1.3, 1.1] } }, "course-turn-casing"); // W67 routefile: the course's width, chalk and orange by turns
  /** W67 routefile: route r's strays from the file's line, drawn; their count (0: none, or no file). */
  const strayMemo = new WeakMap(); // W73 plan: a route's strays from its file, worked out once, not at every choose()
  const straysFor = (r, file) => { let s = strayMemo.get(r); if (s?.file !== file) { strayMemo.set(r, s = { file, runs: straysOf(r.geometry, file), away: straysOf(file, r.geometry) }); nav.strayWork = (nav.strayWork || 0) + 1; } return s; }; // W73 plan: nav.strayWork, for tests
  const drawStrays = (r, file) => { const s = r && file ? straysFor(r, file) : null, runs = s?.runs || [], away = s?.away || []; // W67 routefile: the course's stretches off the file, and the file's own off the course (the way it went); W73 plan: straysFor
    const on = (line, list) => { if (!list.length) return []; const c = new Course({ properties: {}, geometry: { type: "LineString", coordinates: line } }); return list.map(([a, b]) => c.slice(a, b)); }; // W67 routefile
    map.getSource("course-stray")?.setData(bareLines([...on(r?.geometry, runs), ...on(file, away)])); nav.strays = runs; return Math.max(runs.length, away.length); }; // W67 routefile: nav.strays, for tests
  // W62 cometcard: a comet course's train legs, along their stations in the line's colour, dashed (the cue that isn't colour)
  // over a casing in the ground's colour, so it never reads as the solid track under it (W57); both stations ringed
  map.addSource("course-comet", { type: "geojson", data: trainLines(null) }); // W62 cometcard
  map.addLayer({ id: "course-comet-casing", type: "line", source: "course-comet", filter: isLine, layout: round, paint: { "line-color": coreInk(), "line-opacity": 0.85, "line-width": roadW(6, 14) } }, "course-turn-casing"); // W62 cometcard
  map.addLayer({ id: "course-comet", type: "line", source: "course-comet", filter: isLine, layout: { "line-cap": "butt", "line-join": "round" }, paint: { "line-color": ["get", "color"], "line-width": roadW(3, 8), "line-dasharray": [2, 1.4] } }, "course-turn-casing"); // W62 cometcard
  map.addLayer({ id: "course-comet-ring", type: "circle", source: "course-comet", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 6, 16, 9], "circle-color": coreInk(), "circle-stroke-color": ["get", "color"], "circle-stroke-width": 3.5 } }, "course-turn-casing"); // W62 cometcard
  WIDE["course-bare"] = WIDE.course; THIN["course-bare"] = THIN.course; WIDE["course-bare-core"] = roadW(1, 4.4); THIN["course-bare-core"] = CORE_W; // W59 routes: as wide as the course, in flight too
  let bareRoute = null, bareFrom = -1; // W59 routes: the chosen line's route, and where its stretches were last cut from
  let shownP = -1, lastS = 0, feetRuns = [], feet = null, feetAt = -1; // W86 ride: feetRuns; feet, the footprints to cut at the ship in flight
  addEventListener("starchart:theme", () => {
    for (const id of ["course-bare", "course-alt-bare"]) { map.setPaintProperty(id, "line-color", cautionInk()); map.setPaintProperty(`${id}-core`, "line-color", coreInk()); } // W59 routes
    map.setPaintProperty("course-stray", "line-color", chalkInk()); // W67 routefile
    PROG = courseInk();
    map.setPaintProperty("course-comet-casing", "line-color", coreInk()); map.setPaintProperty("course-comet-ring", "circle-color", coreInk()); // W62 cometcard
    map.setPaintProperty("course-turn-casing", "line-color", turnInk()); map.updateImage("course-turn-head", headImage()); // W31 navview
    if (flow?.drawing) flow.endDraw(true); // a draw-on gives back the gradient it saved, in the old theme's ink, as it ends
    for (const id of ["course-alt", "course-alt-hit", "course-lead"]) if (map.getLayer(id)) map.setPaintProperty(id, "line-color", PROG.ahead);
    map.updateImage("course-feet", feetImage()); map.updateImage("course-dot", dotImage()); // W86 ride; W88 ridemodes: the dots
    shownP = -1;
    progress(lastS);
  });
  function drawCourse(coords, alt = null, draw = false, walk = null, route = null) { // W59 routes: route, for its bare stretches
    const walked = coords && route?.walks?.length && route.distance_m > 0 && route.style !== "foot" ? route.walks : []; // W86 ride: the stretches it walks (a walk's course is all walked: its line)
    feetRuns = walked.map(([a, b]) => [a / route.distance_m, b / route.distance_m]); // W86 ride: where the line has a gap, in line-progress
    const c = walked.length ? new Course({ properties: {}, geometry: { type: "LineString", coordinates: coords } }) : null; // W86 ride
    feet = coords ? { walk, c, runs: feetRuns.map(([a, b]) => [a * c?.length, b * c?.length]) } : null; feetAt = -1; // W86 ride
    map.getSource("course-walk")?.setData(walks(coords && walk, feetRuns.map(([a, b]) => c.slice(a * c.length, b * c.length)))); // W32 routing: the walks to and from the course; W86 ride: and the stretches it walks, as footprints
    map.getSource("course-comet")?.setData(trainLines(null)); nav.comet = null; // W62 cometcard: drawComet() draws it again
    bareRoute = coords && route; bareFrom = -1; // W59 routes
    map.getSource("course-alt-bare")?.setData(bareLines((alt || []).flatMap((a) => (a.route ? bareOn(a.route) : [])))); // W59 routes
    nav.drawn = coords ? 1 + (alt?.length || 0) : 0;
    nav.lines = coords ? [{ style: null, geometry: coords, holes: feetRuns }, ...(alt || [])] : []; // for tests: the chosen route first; W86 ride: holes, where it walks (course-flow.js)
    map.getSource("course")?.setData(line(coords));
    map.getSource("course-alt")?.setData(alts(alt));
    shownP = -1;
    turnAt = undefined; lineLook(); // W31 navview: a new line, and its next turn
    progress(0);
    flow?.set(nav.lines, ui.sheet?.classList.contains("cpreview"), draw); // W22 pretty: the moving dots (app/course-flow.js); W23 polish: after progress, and `draw` for a plotted route
  }
  /** W62 cometcard: a comet plan chosen in the preview: its rides as the course, its trains dashed in their lines' colours
   *  with their stations ringed (trainLines), and `alt`, the bike routes, dim. */
  function drawComet(p, alt) { // W62 cometcard
    const L = cometLegs(p), rides = [L.ride0, L.ride1].map((r) => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: r.geometry } })); // W62 cometcard
    drawCourse(L.ride0.geometry, alt); // W62 cometcard: the rest of the preview's line, as for a bike route
    map.getSource("course")?.setData({ type: "FeatureCollection", features: rides }); // W62 cometcard: both rides
    map.getSource("course-comet")?.setData(trainLines(p)); // W62 cometcard
    nav.comet = { rides: rides.length, trains: L.trains.map((l) => ({ route: l.route, color: `#${l.color}`, stations: l.path?.length ?? 0 })) }; // W62 cometcard: for tests
  }
  /** The flown part dims behind the ship: a gradient along the line, sent again only when it has moved 10 m. */
  function progress(s) {
    lastS = s;
    const L = nav.cf?.length || 1, p = Math.max(0.0001, Math.min(0.9998, s / L));
    markTurn(s); // W31 navview
    const from = wideNow ? Infinity : 0; // W59 routes; W86 ride: in flight none, so the line she follows stays orange (orange is the course only); the preview and its cards keep them
    if (from !== bareFrom) { bareFrom = from; map.getSource("course-bare")?.setData(bareLines(bareRoute ? bareOn(bareRoute, wideNow ? nav.cf?.course : null, from) : [])); } // W59 routes
    const at = wideNow && feet ? Math.floor(s / 10) * 10 : -1; // W86 ride: in flight, the footprints behind the ship dim, cut every 10 m
    if (at !== feetAt && feet && (at >= 0 || feetAt >= 0)) { feetAt = at; const { walk, c, runs } = feet, cut = Math.max(0, at); // W86 ride
      const { ahead, flown } = runsAt(runs, cut); // W86 ride
      map.getSource("course-walk")?.setData(walks(cut > 0 ? { end: walk?.end } : walk, ahead.map(([a, b]) => c.slice(a, b)), [...(cut > 0 ? [walk?.start] : []), ...flown.map(([a, b]) => c.slice(a, b))].filter(Boolean))); } // W86 ride
    if (shownP >= 0 && Math.abs(p - shownP) * L < 10) return;
    shownP = p;
    for (const id of ["course", "course-glow"]) if (map.getLayer(id)) {
      map.setPaintProperty(id, "line-gradient", lineInk([[0, PROG.flown], [p, PROG.ahead]], feetRuns)); // W86 ride: lineInk, with a gap where it walks
    }
    if (map.getLayer("course-casing")) map.setPaintProperty("course-casing", "line-gradient", feetRuns.length ? lineInk([[0, map.getPaintProperty("course-casing", "line-color")]], feetRuns) : undefined); // W86 ride: its casing too, plain with no walk
  }

  // ---- the search field and its results ------------------------------------------------------------
  const field = document.querySelector("#gobar > .csearch") ?? el("div", "csearch"); // W47 firstload: index.html's, there from the first frame
  const input = field.querySelector("input") ?? Object.assign(el("input"), { type: "search", placeholder: "Where to?", enterKeyHint: "search", autocomplete: "off" }); // W28 launch: Where to?
  input.setAttribute("aria-label", "Search");
  input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-expanded", "false"); // W73 a11y: the ARIA 1.2 combobox, its rows a listbox
  const clearBtn = field.querySelector(".x") ?? el("button", "x"); // W47 firstload
  clearBtn.setAttribute("aria-label", "Close the search");
  if (!field.isConnected) { // W47 firstload: else index.html's
    clearBtn.append(icon("close"));
    field.append(icon("search"), input, clearBtn);
    (document.getElementById("gobar") ?? document.body).prepend(field); // W28 launch: the bar's left part, beside Launch; open, it is the full-screen search's field
  } // W47 firstload
  const near = () => here() || map.getCenter().toArray();
  /** W26 peek (friction 4): where the search ranks from: the chart's centre while the ship is off the screen (the pilot looked
   *  somewhere else), or with no position; else the ship. */
  const rankFrom = () => {
    const c = map.getCenter().toArray(), b = map.getContainer(), p = origin() && map.project(here());
    return p && p.x >= 0 && p.y >= 0 && p.x <= b.clientWidth && p.y <= b.clientHeight ? here() : c;
  };
  const recent = () => { try { return JSON.parse(localStorage.getItem(RECENT)) || []; } catch { return []; } };
  const remember = (r) => {
    const keep = [r, ...recent().filter((x) => !sameEnd(x, r))].slice(0, 5); // W40 flight (E7): by name and place, as two Davis Streets differ
    try { localStorage.setItem(RECENT, JSON.stringify(keep)); } catch { /* full */ }
  };
  function openResults() {
    if (ui.results) return;
    unlightFound(); // W104 oss2
    document.body.classList.add("has-csearch");
    ui.results = el("div", "cresults idle"); // W21 entry: idle, before two letters: the chart stays in view under the picks
    ui.results.setAttribute("role", "dialog");
    ui.results.setAttribute("aria-label", "Search results");
    const picks = el("div", "picks");
    fillPicks(picks); // W88 favorites
    const list = el("ul"); list.id = "csearch-list"; list.setAttribute("role", "listbox"); list.setAttribute("aria-label", "Search results"); // W73 a11y
    ui.results.append(picks, list, el("p", "note", pickWords(HINT))); // W60 b: pickWords; W73 a11y: list
    document.body.append(ui.results);
    input.setAttribute("aria-controls", list.id); input.setAttribute("aria-expanded", "true"); // W73 a11y
    watchBack("search", closeResults); // W21 entry
    if (lastQ && performance.now() - lastQ.t < KEEP_Q_MS) { input.value = lastQ.q; input.select(); showResults(); } // W26 peek (friction 5): the last words, selected
    searchReady().catch((err) => { ui.results?.querySelector(".note") && (ui.results.querySelector(".note").textContent = SEARCH_OFF); }); // W25 course (find B5)
    chartIn().then(routerReady).catch(() => {}); // the router loads while the pilot types; W47 firstload: its 10 MB once the chart's first view is in
  }
  /** The quick picks: the Fort and home, then the starred places and the recent ones, each group under its heading
   *  with a star on each row (W88 favorites, SPEC §176), then "Open a route file". */
  function fillPicks(picks) { // W88 favorites: was openResults' loop
    const home = (() => { try { return JSON.parse(localStorage.getItem(HOME)); } catch { return null; } })(); // W88 favorites: moved
    const g = pickGroups([isPlain() ? null : FORT, home], starred(), recent().filter((x) => (isPlain() || x.lingo_name !== FORT.lingo_name) && x.kind !== "space_station")); // W60 b: no Fort pick in Plain, but as a recent; W67 places: the starred places after the Fort and home; W88 favorites: in groups
    const pick = (r) => { // W88 favorites
      const b = el("button", r.starred ? "starred" : ""); // W67 places
      b.append(glyphImg(glyphFor(r.kind), 28), named("span", "", r.kind, placeName(r))); // W60 b: placeName
      b.onclick = () => choose(r); // W88 favorites: moved
      return b; // W88 favorites
    }; // W88 favorites
    const row = (r) => { const d = el("div", "prow"); d.append(pick(r), rowStar(r)); return d; }; // W88 favorites: a place's pick, and its star beside it
    const head = (words, act) => { const h = el("div", "phead"); h.append(el("span", "", pickWords(words))); if (act) h.append(act); return h; }; // W88 favorites
    const clear = el("button", "pclear", FAV.clear); clear.onclick = () => clearRecent(picks); // W88 favorites
    picks.replaceChildren(...g.top.map(pick), // W88 favorites
      ...(g.mine.length ? [head(FAV.mine), ...g.mine.map(row)] : []), // W88 favorites
      ...(g.recent.length ? [head(FAV.recent, clear), ...g.recent.map(row)] : []), // W88 favorites
      fileButton()); // W67 routefile: the last pick, "Open a route file"
  }
  const toPlace = (r) => ({ lingo_name: r.lingo_name, name: r.kind === "address" ? r.address || r.name : r.name || r.address, place: r.place || "", kind: r.kind, lonlat: r.lonlat }); // W60 b: a chain's own name, not its street, for Plain; W88 favorites: here, as a star made at an early open needs it
  /** W88 favorites: a result's or a pick's star, as the peek's (a tap stars; on a starred one, unstars with Undo). */
  const rowStar = (r) => { const b = starButton(toPlace(r)); b.classList.add("rstar"); return b; }; // W88 favorites
  /** W88 favorites: Clear by Recent: the recent places forgotten, with Undo. */
  function clearRecent(picks) { // W88 favorites
    const was = localStorage.getItem(RECENT); // W88 favorites
    try { localStorage.removeItem(RECENT); } catch { /* storage off */ } // W88 favorites
    fillPicks(picks); // W88 favorites
    snack(pickWords(FAV.cleared), "", "Undo", 5000, () => { try { if (was) localStorage.setItem(RECENT, was); } catch { /* full */ } if (picks.isConnected) fillPicks(picks); }); // W88 favorites
  } // W88 favorites
  // ---- W67 routefile (SPEC §94): a route file (GPX, KML, GeoJSON) as a course, through the phone's file picker -----------
  const filePick = Object.assign(el("input"), { type: "file", hidden: true }); // W67 routefile: no `accept`: Android's picker greys out a .gpx it has no type for
  filePick.className = "rfile-in"; document.body.append(filePick); // W67 routefile
  let fileFrom = null; // W67 routefile: the button the pick came from, for its bubble
  function fileButton() { // W67 routefile
    const b = el("button", "rfile"); b.insertAdjacentHTML("beforeend", ROUTE_SVG); b.append(el("span", "", pickWords(RF.open))); // W67 routefile
    b.onclick = () => { fileFrom = b; filePick.click(); }; // W67 routefile
    return b; // W67 routefile
  } // W67 routefile
  filePick.onchange = () => { const f = filePick.files?.[0]; filePick.value = ""; if (f) openFile(f); }; // W67 routefile
  /** W67 routefile: the bubble for a file that can't be a course: by the button it came from, else by the search field. */
  const fileSays = (text, ms = 4000) => tip([fileFrom, field].find((n) => n?.isConnected && n.offsetWidth), text, { ms }); // W67 routefile; W73 plan: ms
  async function openFile(file) { // W67 routefile
    if (file.size > 20e6) return fileSays(pickWords(RF.notRoute)); // W67 routefile: a 20 MB file is no route (a photo, a video); W73 plan: said before it is read
    let text = ""; try { text = await file.text(); } catch { /* unreadable */ } // W67 routefile
    const r = parseRoute(text); // W67 routefile; W73 plan: the size, above
    if (!r) return fileSays(pickWords(RF.notRoute)); // W67 routefile
    return openRoute(r.line, { name: r.name || file.name.replace(/\.[^.]*$/, "") }); // W67 routefile
  } // W67 routefile
  /** W67 routefile: a line (a route file's, a flight's trail) matched to the chart with a few vias (course-logic.js matchLine),
   *  then its preview: From its start, To its end, through the vias, in the pilot's style; strays from the line marked. */
  let fileGen = 0; // W73 plan: the last route asked for
  async function openRoute(line, { name = null } = {}) { // W67 routefile
    const g = ++fileGen, flying = flight.flying, sheet = ui.sheet; fileSays(PLOTTING, 60000); // W73 plan: says it's working at once (the graph, then 2 or 3 plots: seconds on a phone)
    try { await routerReady(); await packsP; } catch { return fileSays(pickWords(NO_ROUTER)); } // W67 routefile; W82 packmap: packsP
    const onAny = (p) => [graphBounds, ...storedPacks.map((x) => x.bounds)].some((b) => inside(b, p)); // W82 packmap: the base's region or a stored pack's
    if (!onAny(line[0]) || !onAny(line.at(-1))) return fileSays(pickWords(RF.offChart)); // W67 routefile: its ends off the chart's region; W82 packmap: onAny
    const unsay = () => { if (g === fileGen) untip(PLOTTING); }; // W73 plan: a newer route's bubble stays while it works
    if (g !== fileGen || flight.flying !== flying || ui.sheet !== sheet) return unsay(); // W73 plan: a newer route, a Launch or a sheet meanwhile
    closeResults(false); // W67 routefile
    const stale = () => g !== fileGen || flight.flying !== flying || ui.sheet !== sheet || !!ui.results; // W73 plan: what the pilot opened meanwhile wins, as plot()'s gen
    world.ready(line[0], 120); world.ready(line.at(-1), 120); // W73 plan: asks for the ends' roads while it matches, else idle() below has nothing to wait for and they are "Waypoint"
    nav.matching = true; // W67 routefile: for tests
    const style = styleOf(localStorage.getItem(STYLE)), t = performance.now(); // W67 routefile: the vias fit the style they were found with
    const m = await matchLine(line, async (a, b, via) => (await route(a, b, style, via, null, null, false, false).catch(() => null)) || null).catch(() => null); // W67 routefile; W105 night: the day's costs, so the file is matched the same whatever the clock
    nav.matching = false; nav.matched = m && { via: m.via.length, strays: m.strays.length, ms: Math.round(performance.now() - t) }; // W67 routefile: for tests
    if (stale()) return unsay(); // W73 plan
    if (!m?.route) return fileSays(pickWords("No course there: no starpath reaches it.", "No route there: no street reaches it.")); // W67 routefile: the words of a pin no course reaches
    await Promise.race([world.idle(), new Promise((r) => setTimeout(r, 2000))]); // W67 routefile: the roads, to name the ends (as openLink)
    unsay(); if (stale()) return; // W73 plan
    const end = (ll) => (metres(ll, FORT.lonlat) <= 40 ? { ...FORT, lonlat: ll } : placeAt(ll)); // W67 routefile
    ui.file = { line, name, style }; // W67 routefile: a switch of Words opens it again with its marks
    note("course", `route file, ${line.length} points, ${m.via.length} vias`); // W67 routefile: never the place
    return preview(end(m.to), m.via, end(m.from), { style, file: ui.file }); // W67 routefile
  } // W67 routefile
  /** W67 routefile: "Save as GPX" in the share menu: the course, its turns as <wpt>s, shared as a file where the phone can,
   *  else downloaded. Nothing is uploaded. */
  async function saveGpx(btn, c) { // W67 routefile
    const toName = mainName(lingo, c.to.kind, placeName(c.to)), f = { name: pickWords(`Course to ${toName}`, `Route to ${toName}`), start: Date.now() }; // W67 routefile
    const ins = toCourse(lingo, c.route).properties.instructions.filter((i) => i.at && i.turn !== "depart" && i.turn !== "straight"); // W67 routefile
    const xml = gpx(f, c.route.geometry.map(([lon, lat]) => ({ lon, lat })), { wpt: ins.map((i) => ({ lonlat: i.at, name: isPlain() ? i.plain || i.text : i.text })) }); // W67 routefile: no times, a plan
    const name = gpxName(f), blob = new Blob([xml], { type: "application/gpx+xml" }), file = typeof File === "function" ? new File([blob], name, { type: blob.type }) : null; // W67 routefile
    nav.savedGpx = { name, xml }; // W67 routefile: for tests
    if (file && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: f.name }); return; } catch (e) { if (e?.name === "AbortError") return; } } // W67 routefile
    const url = URL.createObjectURL(blob), a = Object.assign(el("a"), { href: url, download: name }); // W67 routefile
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000); // W67 routefile
    tip(btn, pickWords(RF.saved)); // W67 routefile
  } // W67 routefile
  /** W26 peek (friction 5): a search closed without a pick (a tap on the chart, Escape, Back) keeps its words for 5 min;
   *  a pick or the × forgets them. */
  function closeResults(keep = true) {
    if (ui.results) lastQ = keep && input.value.trim().length >= 2 ? { q: input.value, t: performance.now() } : null;
    ui.results?.remove();
    ui.results = null;
    input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-controls"); input.removeAttribute("aria-activedescendant"); // W73 a11y
    watchBack("search"); // W21 entry
    input.value = "";
    input.blur();
    enterSoon = false; // W40 flight
    document.body.classList.remove("has-csearch");
  }
  let typed = 0, lastQ = null, shown = 0, enterSoon = false; // W40 flight (E4): shown, the words the rows are for; enterSoon, an Enter waits for them
  const KEEP_Q_MS = 5 * 60_000;
  async function showResults() {
    const q = input.value.trim(), n = ++typed;
    enterSoon = false; // W40 flight: new words
    if (!ui.results) return;
    const list = ui.results.querySelector("ul"), note = ui.results.querySelector(".note");
    foundRow(null); // W104 oss2: new words
    options(list); // W73 a11y: new words, no row chosen
    ui.results.classList.toggle("idle", q.length < 2); // W21 entry
    if (q.length < 2) { list.replaceChildren(); note.textContent = pickWords(HINT); shown = n; return; } // W40 flight: shown; W60 b: pickWords
    let res;
    const link = parseLink(q, (p) => onChart(p)); // W67 places: a map link or coordinates is a pin; a short link, the name shared with it; W73 plan: longitude first, when only that is on the chart
    if (link?.lonlat) { list.replaceChildren(pinRow(link)); options(list); /* W73 a11y */ note.textContent = ""; shown = n; if (enterSoon) { enterSoon = false; list.querySelector("button")?.click(); } return; } // W67 places
    if (link && !link.name) { list.replaceChildren(); note.textContent = ""; tip(input, pickWords(link.from === "short" ? PLACES.short : PLACES.none), { ms: 6000 }); shown = n; return; } // W67 places: why there is nothing to find
    const words = link?.name ?? q; // W67 places
    if (!searchIn) note.textContent = READYING; // W47 firstload: on a first open the index is still coming
    try { res = await search(words, rankFrom()); if (link && !res.length && words.includes(",")) res = await search(words.split(",")[0], rankFrom()); } catch { note.textContent = SEARCH_OFF; if (n === typed) shown = n; return; } // W25 course; W26 peek: rankFrom; W40 flight: shown; W67 places: a shared address, then its first part
    const me = origin() ? here() : null; // W67 places: the starred rows' LY from you, as the search's have
    res = starFirst(res, starred(), words).map((r) => (me && r.distance_m == null ? { ...r, distance_m: metres(me, r.lonlat) } : r)); // W67 places: the starred places these words find, first
    if (n !== typed || !ui.results) return; // a later letter has its own answer
    note.textContent = res.length ? "" : `Not on the chart. It covers Greater Boston. ${pickWords(HINT).split(". ")[1]}`; // W21 entry; W60 b: HINT's second sentence, in the mode's words
    list.replaceChildren(...res.map((r) => { const li = resultRow(r, () => choose(r)), s = rowStar(r); Object.assign(s, { tabIndex: -1 }); s.setAttribute("aria-hidden", "true"); li.append(s); return li; })); // W88 favorites: each with its star; W102 a11y: a tap's only, as a listbox's option holds no control (the place's peek has its star)
    foundRow(kindResults(res)); // W104 oss2
    options(list); // W73 a11y
    shown = n; // W40 flight
    if (enterSoon) { enterSoon = false; list.querySelector("button")?.click(); } // W40 flight: an Enter typed before these words' rows came
  }
  /** A search result's row; W23 fromto: the From/To editor's rows too. */
  function resultRow(r, onPick) {
    const li = el("li"), b = el("button"), txt = el("div"), sub = el("small");
    // W28 launch (audit 15): a street leads with its own name, "Davis Avenue", over "Starpath · Brookline", not "Starpath Davis"
    // over "Davis Avenue · Brookline"; a place keeps its SCUL name ("Davis Constellation")
    const plain = r.address || r.name, word = ROADS.has(r.kind) && plain && !isPlain() ? nameParts(lingo, r.kind, r.lingo_name).find((p) => p.generic)?.text : null; // W60 b: in Plain, the plain name's own parts
    sub.append(el("span", "", word ? [word, r.place].filter(Boolean).join(" · ") : sideLine(lingo, r)), el("em", "", r.distance_m != null ? distLabel(r.distance_m) : ""));
    const oh = hoursWords(r.oh, Date.now(), pickWords); // W77 hours: only when closed or closing within the hour
    if (oh) sub.insertBefore(el("i", "oh", oh), sub.lastChild); // W77 hours: before the LY, never cut
    txt.append(word ? el("b", "", plain) : named("b", "", r.kind, placeName(r)), sub); // W60 b: placeName; in Plain, nameParts gives no word, and sideLine says what it is
    b.append(glyphImg(glyphFor(r.kind), 36), txt);
    if (r.starred) b.classList.add("starred"); // W67 places
    b.onclick = onPick;
    li.append(b);
    return li;
  }
  // W104 oss2 (OSS review #28, SPEC §210): a kind search's places ("cafe", "coolant", a chain) lit on the chart, each glyph on
  // a --course ring as §69's stops, all in view. A tap on one opens its peek; any other tap on the chart puts them out.
  /** W104 oss2: "Show on the chart" over the rows, for `rs` (kindResults), or none. Outside the listbox, so Enter still picks the first row. */
  function foundRow(rs) { // W104 oss2
    ui.results?.querySelector(".cfound-go")?.remove(); // W104 oss2
    if (!rs || !ui.results) return; // W104 oss2
    const b = el("button", "cfound-go"); // W104 oss2
    b.append(icon("fold-chart"), document.createTextNode(pickWords("Show on the chart", "Show on the map"))); // W104 oss2
    b.onclick = () => { closeResults(); lightFound(rs); }; // W104 oss2: the words kept, as a search closed without a pick
    ui.results.querySelector("ul").before(b); // W104 oss2
  } // W104 oss2
  function lightFound(rs) { // W104 oss2
    unlightFound(); // W104 oss2
    ui.found = rs.map((r) => { const m = el("div", "cstop cfound"); m.append(glyphImg(glyphFor(r.kind), 22)); return { r, m: new maplibregl.Marker({ element: m }).setLngLat(r.lonlat).addTo(map) }; }); // W104 oss2
    // the camera moves only when one is out of view, as the preview frames its routes (§21), and never zooms in; it lets go of the ship while they're lit, and goes back when they go out, unless the pilot moved the chart
    const c = map.getContainer(), pad = { top: 100, bottom: 170, left: 40, right: 80 }; // W104 oss2: clear of the search bar, the bar and the controls
    if (rs.every((r) => { const q = map.project(r.lonlat); return q.x >= pad.left && q.x <= c.clientWidth - pad.right && q.y >= pad.top && q.y <= c.clientHeight - pad.bottom; })) return; // W104 oss2
    if (flight.flying) return; // W104 oss2 fix pass 2: in flight the camera stays with the ship, as showPin's
    ui.foundView = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() }; framing(true); ui.foundMoved = false; // W104 oss2 fix pass 2: foundMoved after framing, whose mode change isn't the pilot's; W104 oss2: free while they're lit, and put back when they go out, as a preview's close (BRIEF §7.8)
    const b = rs.reduce((bb, r) => bb.extend(r.lonlat), new maplibregl.LngLatBounds(rs[0].lonlat, rs[0].lonlat)); // W104 oss2
    map.fitBounds(b, { padding: pad, maxZoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), duration: glideMs(0), essential: true }); // W104 oss2
  } // W104 oss2
  /** W104 oss2: `framed`, a preview puts them out, and frames the chart itself. */
  function unlightFound(framed = false) { // W104 oss2
    for (const { m } of ui.found || []) m.remove(); ui.found = null; // W104 oss2
    if (!ui.foundView) return; // W104 oss2: they never glided
    const moved = ui.foundMoved || flight.flying; // W104 oss2 fix pass 2: read before framing, whose mode change sets it; in flight, never back (a tap never moves it)
    framing(false, moved); // W104 oss2: the camera's mode back, unless the pilot moved the chart meanwhile
    if (!moved && !framed) map.easeTo({ ...ui.foundView, duration: glideMs(turn(ui.foundView)), essential: true }); // W104 oss2
    ui.foundView = null; // W104 oss2
  } // W104 oss2
  /** W73 a11y: the rows as the listbox's options, none active: the arrows move through them, the field keeps the focus. */
  function options(list) { // W73 a11y
    input.removeAttribute("aria-activedescendant"); // W73 a11y
    list.querySelectorAll(":scope > li").forEach((li, i) => { li.setAttribute("role", "presentation"); const b = li.querySelector("button"); Object.assign(b, { id: `csearch-opt-${i}`, tabIndex: -1 }); b.setAttribute("role", "option"); b.setAttribute("aria-selected", "false"); }); // W73 a11y
  } // W73 a11y
  function arrowTo(step) { // W73 a11y: ArrowDown and ArrowUp; up from the first row is the field again
    const opts = [...(ui.results?.querySelectorAll("ul [role=option]") ?? [])]; // W73 a11y
    if (!opts.length) return; // W73 a11y
    const at = opts.findIndex((o) => o.getAttribute("aria-selected") === "true"), to = at < 0 && step < 0 ? opts.length - 1 : at + step; // W73 a11y
    opts.forEach((o, i) => o.setAttribute("aria-selected", String(i === to))); // W73 a11y
    if (opts[to]) { input.setAttribute("aria-activedescendant", opts[to].id); opts[to].scrollIntoView({ block: "nearest" }); } else input.removeAttribute("aria-activedescendant"); // W73 a11y
  } // W73 a11y
  input.addEventListener("focus", openResults);
  addEventListener("keydown", (e) => { // W77 desktop (SPEC §143): "/" goes to Where to?, when no field has the focus
    const a = document.activeElement; // W77 desktop
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || a?.matches("input, textarea, select, [contenteditable]") || !input.checkVisibility({ visibilityProperty: true })) return; // W77 desktop
    input.focus(); if (document.activeElement === input) e.preventDefault(); // W77 desktop: under a modal the field is inert, and the key is left alone
  }); // W77 desktop
  input.addEventListener("input", showResults);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeResults();
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); arrowTo(e.key === "ArrowDown" ? 1 : -1); } // W73 a11y
    const active = e.key === "Enter" && document.getElementById(input.getAttribute("aria-activedescendant")); // W73 a11y
    if (active) { e.preventDefault(); active.click(); return; } // W73 a11y: Enter picks the row the arrows chose
    if (e.key === "Enter") { if (shown === typed) ui.results?.querySelector("ul button")?.click(); else enterSoon = true; } // W25 course: the keyboard's Search key picks the first row; W40 flight (E4): for these words
  });
  clearBtn.onclick = () => closeResults(false);
  if (document.activeElement === input) { openResults(); showResults(); } // W47 firstload: tapped before the chart was in, typed into, maybe
  function choose(r) {
    const q = input.value, was = ui.sheet; // W73 a11y
    closeResults(false);
    const place = toPlace(r);
    remember(place);
    preview(place); // W25 course (call 1): the row said what the place sheet would; with no position, Choose start
    if (ui.sheet && ui.sheet !== was) { ui.sheet.tabIndex = -1; ui.sheet.focus({ preventScroll: true }); ui.back = { sheet: ui.sheet, q }; } // W73 a11y: the focus goes to the preview, named by its course
  }
  let keyAt = -1e9; // W73 a11y: when a key last went down or up: a close within 500 ms of it is the keys' (Escape, or × with Enter or Space), not a tap's or Back's
  for (const t of ["keydown", "keyup"]) addEventListener(t, () => { keyAt = performance.now(); }, true); // W73 a11y
  // W23 fromto: the directions button, and the From/To editor (app/fromto.js)
  const homePlace = () => { try { return JSON.parse(localStorage.getItem(HOME)); } catch { return null; } };
  /** W26 peek (friction 9): with no position, the last parked spot (main.js's starchart:spot), where the chart opened. */
  const lastSpot = () => {
    if (origin()) return null;
    try { const v = JSON.parse(localStorage.getItem("starchart:spot")); return Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? { ...SPOT_PICK, lonlat: v } : null; } catch { return null; }
  };
  const fromto = mountFromTo({ el, icon, named, glyph: (kind, size) => glyphImg(glyphFor(kind), size), search, near: rankFrom, watchBack,
    ready: () => { routerReady().catch(() => {}); return searchReady(); }, onOpen: closeResults,
    rows: (res, pick) => res.map((r) => resultRow(r, () => { const p = toPlace(r); remember(p); pick(p); })),
    picks: { from: () => startFrom(origin()), all: (other) => quickPicks({ origin: origin(), spot: lastSpot(), home: homePlace(), fort: isPlain() ? null : FORT, recent: withStarred([], starred(), recent()), other }) /* W60 b; W67 places: the starred places first */ }, // W25 course: never the other end; W26 peek: the last spot
    plan: ({ from, to }) => preview(to, ui.vias.slice(), from), // W25 course: the stops stay (course B6)
    home: (place) => homeButton(place, null) }); // W25 course: Set as home, at the To field's end (a hold skips the place sheet)

  // ---- the pin: a long press, parked or in flight ----------------------------------------------------
  const box = map.getCanvasContainer();
  let press = null, dropClick = false;
  const endPress = () => { if (press) { clearTimeout(press.timer); press.mark.end(); } press = null; }; // W26 hold
  /** W25 course: a page over the chart (a flight's page in the Log) takes no holds, and a tap there only names what is there. */
  const pageOver = () => document.body.matches(".log-flight, .log-page");
  box.addEventListener("pointerdown", (e) => {
    dropClick = false; // W25 course: a new press: the hold before it has had its release
    if (press) return endPress(); // a second finger: a pinch, not a pin
    if (e.button > 0 || pageOver()) return;
    const r = box.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const ms = courseLine([x, y], e.pointerType === "touch" ? 20 : 12) ? LINE_MS : 500; // W84 roadtap: a hold on the course's line takes 425 ms, elsewhere 500
    const mark = holdMark({ x: e.clientX, y: e.clientY, ms }); // W26 hold: a ring grows while the finger holds, so the press shows before the pin; W84 roadtap: ms
    const ll0 = flight.flying && nav.cf ? map.unproject([x, y]).toArray() : null; // W73 avoid: where the finger went down, as the chart follows the ship under it
    press = { x: e.clientX, y: e.clientY, mark, timer: setTimeout(() => {
      mark.take(); press = null; dropClick = true; // W26 hold: the pop and the buzz
      if (ui.holdLine?.(e)) return; // W25 course: a hold on the chosen route places a stop there (or where a drag takes it)
      if (ll0 && holdAvoid(ll0, e.pointerType)) return; // W73 avoid: in flight, a hold on the course avoids its street there
      pinAt(map.unproject([x, y]).toArray());
    }, ms) }; // W84 roadtap: ms
  });
  // W25 course: the click that ends a hold does nothing, however long the hold was (it closed the pin's sheet, or opened an icon's)
  box.addEventListener("click", (e) => { if (dropClick) { dropClick = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
  box.addEventListener("pointermove", (e) => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) endPress(); });
  for (const t of ["pointerup", "pointercancel", "pointerleave"]) box.addEventListener(t, endPress);
  box.addEventListener("contextmenu", (e) => e.preventDefault());
  /** W84 roadtap: the course's line within `px` of a point of the chart (px): the preview's chosen line, else in flight the course's; else null. */
  const courseLine = (pt, px) => (ui.onLine ? ui.onLine(pt, px)?.line ?? null : flight.flying && nav.cf && nav.route && !nav.leg && nearestOn(nav.route.geometry, Array.isArray(pt) ? pt : [pt.x, pt.y], (p) => { const q = map.project(p); return [q.x, q.y]; }).d <= px ? nav.route.geometry : null); // W84 roadtap
  /** W73 avoid: in flight, a hold (500 ms; W84 roadtap: 425) on the course's line avoids the street under it, and the course plans again. */
  function holdAvoid(ll, type) { // W73 avoid
    if (!flight.flying || !nav.cf || !nav.route || nav.leg) return false; // W73 avoid
    const px = (p) => { const q = map.project(p); return [q.x, q.y]; }, hit = nearestOn(nav.route.geometry, px(ll), px); // W73 avoid
    if (hit.d > (type === "touch" ? 20 : 12)) return false; // W73 avoid
    const a = streetAt(ll); // W73 avoid
    if (!a) return false; // W73 avoid: the chart's roads not in yet: the hold drops a pin, as before
    avoidStreet(a); // W73 avoid
    return true; // W73 avoid
  } // W73 avoid
  // W77 desktop (SPEC §143): a right-click with a mouse does what the hold does, with no menu. On its release, and only when the
  // pointer moved under 10 px, so a right-drag still tilts and turns the chart (contextmenu comes on the press on macOS and Linux)
  let right = null; // W77 desktop
  box.addEventListener("pointerdown", (e) => { right = e.button === 2 && e.pointerType === "mouse" && !pageOver() ? { x: e.clientX, y: e.clientY } : null; }); // W77 desktop
  box.addEventListener("pointerup", (e) => { // W77 desktop
    const at = right; right = null; // W77 desktop
    if (!at || e.button !== 2 || Math.hypot(e.clientX - at.x, e.clientY - at.y) >= 10) return; // W77 desktop
    const r = box.getBoundingClientRect(); holdMark({ x: e.clientX, y: e.clientY }).take(); // W77 desktop: the hold's pop and buzz
    if (ui.holdLine?.(e)) return; // W77 desktop: as the hold does
    const ll = map.unproject([e.clientX - r.left, e.clientY - r.top]).toArray(); // W77 desktop
    if (holdAvoid(ll, "mouse")) return; // W77 desktop x W73 avoid: in flight, on the course, it avoids the street, as the hold does
    pinAt(ll); // W77 desktop
  }); // W77 desktop
  // W21 routes: a second finger cancels a stop's drag. W25 course: a plain drag on the route pans; a hold places a stop (ui.holdLine)
  const fingers = new Set();
  box.addEventListener("pointerdown", (e) => {
    fingers.add(e.pointerId);
    if (fingers.size > 1) return ui.drag?.cancel();
  });
  for (const t of ["pointerup", "pointercancel"]) addEventListener(t, (e) => fingers.delete(e.pointerId));
  let relabelT = 0; // the callouts again once the chart settles, not at every step of a camera that follows the ship
  map.on("moveend", () => { clearTimeout(relabelT); if (ui.relabel) relabelT = setTimeout(() => { if (!ui.drag) ui.relabel?.(); }, 120); });
  async function pinAt(lonlat) {
    closeResults();
    nav.pinned = lonlat;
    if (!world.ready(lonlat, 120)) { await Promise.race([world.idle(), new Promise((r) => setTimeout(r, 2000))]); if (ui.results) return; } // W40 flight (E5): a search opened meanwhile wins
    const place = placeAt(lonlat); // W54 course: placeAt, a shared course's ends too
    routerReady().catch(() => {});
    // W25 course: a hold goes straight to the course (arclight: "If I hold to drop a pin, why do I have to 'set course' to it?").
    // In the editor it fills the field with focus; in a preview, it is the new To, keeping From and the stops, with Undo.
    if (fromto.isOpen) return fromto.fill(place);
    const was = ui.plan && ui.sheet?.classList.contains("cpreview") ? ui.plan : null;
    preview(place, was ? ui.vias.slice() : [], was ? was.start : undefined);
    if (was) snack("Destination changed", "", "Undo", 5000, () => preview(was.place, was.via, was.start));
  }
  /** W54 course: a point's place, as a dropped pin names it: the nearest named road, and its quadrant and town. */
  function placeAt(lonlat) { // W54 course
    const road = world.roadsNear(lonlat, 120).find((f) => f.properties.name)?.properties; // the nearest named one; W54 course: placeAt's
    const kind = ["wormhole", "hyperspace_byway", "hyper_wormhole", "transport_lane"].includes(road?.kind) ? road.kind : "starpath"; // W54 course
    const [scul, plain] = road?.name ? roadLabels(lingo, { name: road.name, kind }) : [null, null]; // W54 course
    const areas = world.systemsAt(lonlat); // W54 course
    const town = areas.find((a) => a.admin_level === 8)?.name, quad = areas.find((a) => a.admin_level === 10)?.name; // W54 course
    return { lingo_name: scul ? scul.replace(/^the /, "") : "Waypoint", name: plain || "", place: [quad, town].filter(Boolean).join(", "), // W54 course
      kind: "waypoint", lonlat, pinned: true }; // W54 course
  } // W54 course

  // ---- the place sheet -------------------------------------------------------------------------------
  /** W27 card: the map's padding becomes `padding`, and what is on the screen stays where it is. */
  /** W29 polish: how far the camera turns or tilts to `to` ({bearing, pitch}), in degrees, for its glide (BRIEF §7.8). */
  const turn = (to) => Math.max(Math.abs(((to.bearing - map.getBearing() + 540) % 360) - 180), Math.abs(to.pitch - map.getPitch()));
  const keepView = (padding) => {
    const p = map.getPadding(), c = map.project(map.getCenter());
    map.jumpTo({ center: map.unproject([c.x + (padding.left - padding.right - p.left + p.right) / 2, c.y + (padding.top - padding.bottom - p.top + p.bottom) / 2]), padding });
  };
  // W27 card (BRIEF §7.8): whether the pilot has moved the chart since a sheet framed it, or since the preview last framed it
  for (const t of ["movestart", "wheel"]) map.on(t, (e) => { if (ui.view && e.originalEvent) ui.moved = true; if (ui.foundView && e.originalEvent) ui.foundMoved = true; }); // W104 oss2: foundMoved, while a search's places glided out // a wheel's zoom starts with no originalEvent
  /** The sheets frame their place or course; closing one gives back the chart as it was. W27 card: unless the pilot moved
   *  it meanwhile: then it stays where the pilot left it, free, and only the map's padding comes back. */
  function closeSheet(restore = true) {
    if (restore && ui.view) { // W25 course: and the camera's mode, and the map's padding
      if (ui.moved) { keepView(ui.view.padding); framing(false, true); } // W27 card
      else { framing(false); map.easeTo({ ...ui.view, duration: glideMs(turn(ui.view)), essential: true }); } // W29 polish: it glides back, after the no-location sheet's padding, which would stop it
      ui.view = null;
    }
    if (ui.snack?.dataset.preview != null) { clearTimeout(ui.snackTimer); ui.snack.remove(); ui.snack = null; } // W26 peek (friction 2): a preview's Undo goes with it, and never acts in flight
    ui.leaveby?.close(); // W102 leaveby: the picker goes with its preview
    ui.sheet?.remove();
    ui.sheet = null;
    ui.bar?.remove(); ui.barSize?.disconnect(); ui.bar = ui.barSize = null; document.body.classList.remove("has-pvbar"); // W86 preview: the From/To bar goes with its sheet
    if (restore && !flight.flying && !afootTrip) window.starchart?.ship?.setGait?.("ride"); // W79 walker: the preview closed, back on the bike (not on a re-render, sheet()); W79, at the merge: not as a walk's Launch closes it, which would hop on and straight off again
    watchBack("sheet"); // W21 entry
    ui.pin?.remove();
    ui.start?.remove(); // W23 fromto: From's mark
    ui.pin = ui.pick = ui.start = null;
    for (const m of [...ui.mins, ...ui.handles]) m.remove(); // W19 course; W21 routes: the vias' handles
    ui.mins = [];
    ui.handles = [];
    ui.drag?.cancel();
    ui.holdLine = ui.onLine = ui.relabel = ui.replan = null; // W73 avoid: replan
    turns.unlight(); ui.turnsBack = null; watchBack("turns"); // W53 turns
    unlightStops(); closeShare(); // W54 course
    drawStrays(null); ui.file = null; // W67 routefile
    ui.lift?.disconnect(); ui.lift = null; // W21 flight
    map.getSource("course-lead")?.setData(line(null)); // W25 course
    document.body.classList.remove("has-csheet", "csheet-fly");
    unpreview(); // a preview in flight drew over the course; W68 fixes: unpreview
  }
  /** The chart without a preview's routes: the course in flight, or none. */
  function unpreview() { if (nav.cf) { drawCourse(nav.route.geometry, null, false, nav.route.walk, nav.route); progress(nav.cf.s); } else drawCourse(null); } // W59 routes: nav.route; W68 fixes: its own, for a preview with no course
  function sheet(cls) {
    closeSheet(false);
    // W25 course: while a sheet frames the chart, the camera doesn't follow the ship (main.js), and a fit sets the map's padding
    if (!ui.view) {
      ui.view = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch(), padding: map.getPadding() };
      ui.moved = false; framing(true);
      const p = map.getPadding(); // W27 card: the no-location sheet stepped aside: the chart stays still as its padding goes
      if (["top", "bottom", "left", "right"].some((k) => p[k] !== ui.view.padding[k])) { map.jumpTo({ center: ui.view.center, padding: ui.view.padding }); keepView(p); }
    }
    const s = el("section", `csheet ${cls}`), x = el("button", "x");
    s.setAttribute("role", "dialog");
    x.setAttribute("aria-label", "Close");
    x.append(icon("close"));
    x.onclick = () => dismiss();
    s.append(el("div", "handle"), x);
    document.body.append(s);
    document.body.classList.add("has-csheet");
    if (flight.flying) { // W21 flight: the readout and Land stay in view, above the sheet, or beside it in landscape
      const html = document.documentElement, side = () => sideSheet(s); // W86 preview
      ui.lift = new ResizeObserver(() => {
        html.style.setProperty("--csheet-h", side() ? "0px" : `${innerHeight - s.offsetTop + 8}px`);
        html.style.setProperty("--csheet-w", side() ? `${s.offsetLeft + s.offsetWidth + 8}px` : "0px");
      });
      ui.lift.observe(s);
      document.body.classList.add("csheet-fly");
    }
    ui.sheet = s;
    watchBack("sheet", () => { if (ui.sheet === s) dismiss(); }); // W21 entry
    return s;
  }
  /** ×, Back or Escape: the sheet closes. */
  function dismiss() {
    if (ui.turnsBack?.()) return; // W53 turns: the turn list goes back to the cards first
    const q = performance.now() - keyAt < 500 && ui.back?.sheet === ui.sheet ? ui.back.q : null; // W73 a11y
    closeSheet();
    if (q != null) setTimeout(() => { input.focus(); input.value = q; showResults(); }); // W73 a11y: closed from the keys, the preview gives the focus back to the search, with its words; after this Escape's close request
  }
  addEventListener("keydown", (e) => { if (e.key === "Escape" && ui.share) { e.preventDefault(); return closeShare(); } if (e.key === "Escape" && ui.sheet) { if (ui.turnsBack) e.preventDefault(); dismiss(); } }); // W53 turns: the list's Escape is its own, not a close request for the sheet too; W54 course: the share menu's Escape first
  /** The pin: the waypoint glyph's pin in a see-through circle, its box cut at the pin's tip, so that the tip,
   *  the marker's anchor, stays on the place at every zoom and pitch (arclight, 2026-10-15). */
  const pinMarker = (lonlat, cls = "") => {
    const p = el("div", `cpin ${cls}`);
    p.innerHTML = `<svg viewBox="0 0 64 51" width="44" height="35.06" aria-hidden="true"><circle class="disc" cx="32" cy="32" r="25"/>`
      + `<path class="arc" d="M10.6 22.4A25 25 0 0 1 22.4 10.6"/><path class="tip" d="M32 51C24 41 18.5 34.5 18.5 27A13.5 13.5 0 0 1 45.5 27C45.5 34.5 40 41 32 51Z"/>`
      + `<path class="star" d="M32 19.6Q33.63 25.37 39.4 27Q33.63 28.63 32 34.4Q30.37 28.63 24.6 27Q30.37 25.37 32 19.6Z"/></svg>`;
    return new maplibregl.Marker({ element: p, anchor: "bottom" }).setLngLat(lonlat).addTo(map);
  };
  function dropPin(lonlat) {
    dropLone(); // W67 places: a pin dropped alone gives way to the preview's
    ui.pin?.remove();
    ui.pin = pinMarker(lonlat);
  }
  /** W21 entry: Set as home is a small button beside the ×, not a row. W25 course: it is in the preview's To part too, and
   *  always answers: "Space Station set" or "moved", with Undo, and once it is home, "Already your Space Station". */
  function homeButton(place, s) {
    const b = el("button", "home"), isHome = () => { const h = homePlace(); return place.kind === "space_station" || (!!h && h.lonlat?.[0] === place.lonlat?.[0] && h.lonlat?.[1] === place.lonlat?.[1]); };
    const show = () => { b.setAttribute("aria-label", isHome() ? pickWords("Your Space Station", "Your home") : "Set as home"); /* W60 b */ b.title = b.getAttribute("aria-label"); b.classList.toggle("on", isHome()); };
    b.append(glyphImg("space_station", 26));
    show();
    b.onclick = () => { // the quick picks then offer it as the Space Station
      if (isHome()) return tip(b, pickWords("Already your Space Station", "Already your home")); // W60 b
      const home = { lingo_name: "Space Station", name: place.kind === "waypoint" ? place.name : place.lingo_name, place: place.place, kind: "space_station", lonlat: place.lonlat };
      const was = localStorage.getItem(HOME);
      try { localStorage.setItem(HOME, JSON.stringify(home)); } catch { /* full */ }
      show();
      snack(was ? pickWords("Space Station moved", "Home moved") : pickWords("Space Station set", "Home set"), "", "Undo", 5000, () => { // W60 b
        try { if (was) localStorage.setItem(HOME, was); else localStorage.removeItem(HOME); } catch { /* full */ }
        if (ui.sheet === s || !s) show();
      });
      delete ui.snack.dataset.preview; // W40 flight (E3): home isn't the preview's, so its Undo outlives the preview's re-plot
    };
    return b;
  }
  /** W25 course: a sheet frames its place or course again when the chart resizes (a rotation), once a frame, until the pilot moves the chart. */
  function reframe(s, fit) {
    let moved = false, raf = 0;
    const onMove = (e) => { if (e.originalEvent) moved = true; };
    const onResize = () => {
      if (ui.sheet !== s) { map.off("resize", onResize); map.off("movestart", onMove); return; }
      if (!moved) raf ||= requestAnimationFrame(() => { raf = 0; if (ui.sheet === s && !moved) fit(); });
    };
    map.on("movestart", onMove);
    map.on("resize", onResize);
  }

  // A tap on a dim route picks its style. W26 peek: a tap on anything else with a name or kind, an icon or a road, shows
  // its peek where the tap was, and the camera stays put; a tap on the peek goes straight to the course (goTo).
  map.on("click", (e) => {
    if (performance.now() - ui.tapAt < 500) return; // a tap on a stop
    if (ui.results) return closeResults(); // W25 course: with the search open, a tap on the chart closes it first (find B6)
    if (!pageOver() && tapPlace(e.point)) return; // W67 places: the dropped pin, or a starred mark: its own peek
    if (ui.found) unlightFound(); // W104 oss2: a tap elsewhere puts a search's lit places out, and does what it hits
    const line = courseLine(e.point, 16); // W84 roadtap: the course's line under the tap, in the preview or in flight
    if (line) return void hints.peek(e, !flight.flying && !pageOver(), { line }); // W25 course: a tap on the chosen line keeps it (the dim line under it took it, course B2); W73 avoid: and shows its street's peek, with Avoid; W84 roadtap: the road the course runs on there, at any zoom
    const alt = ui.pick && map.queryRenderedFeatures(e.point, { layers: ["course-alt-hit"] })[0];
    if (alt) return ui.pick(alt.properties.style);
    if (ui.lone) dropLone(); // W67 places: a tap elsewhere lifts a pin dropped alone, as a map app's does
    hints.peek(e, !flight.flying && !pageOver()); // W26 peek: in flight and on a flight's page, information only (W23 touch, W25 course)
  });
  /** W23 touch: the place of a tapped feature: the Fort, a lore icon, a chart icon, or a named path, park or water (at the tap). */
  const placeOf = (f, lonlat) => {
    const p = f.properties, at = f.geometry.type === "Point" ? f.geometry.coordinates.slice() : lonlat;
    if (f.source !== "lore") return f.geometry.type === "Point" ? iconPlace(lingo, p, at) : { ...iconPlace(lingo, p, at), wide: true }; // W33 peeks: a rotary's ring is its street, as its peek says; W73 plan: wide, a path, park or water, at the tap: one star for all of it
    return p.kind === "fort" ? FORT : { lingo_name: labelFor(lingo, p.kind, p), name: p.plain || "", place: "", kind: p.kind, lonlat: at };
  };
  /** W26 peek: a peek's › sets a course to its place, as a hold does: in the editor it fills the field; over a preview it is
   *  the new To, keeping From and the stops, with Undo; else the preview, From you (or Choose start). */
  function goTo(place) {
    closeResults();
    routerReady().catch(() => {});
    if (fromto.isOpen) return fromto.fill(place);
    const was = ui.plan && ui.sheet?.classList.contains("cpreview") ? ui.plan : null;
    preview(place, was ? ui.vias.slice() : [], was ? was.start : undefined);
    if (was) snack("Destination changed", "", "Undo", 5000, () => preview(was.place, was.via, was.start));
  }
  const hints = mountHints({ map, lingo, flight, open: (f, lonlat, place) => goTo(place ?? placeOf(f, lonlat)), ship: here, you: () => (origin() ? here() : null), // W23 touch (app/hints.js); W26 peek: goTo, and the distance from you
    acts: (f, lonlat) => [...placeActs(placeOf(f, lonlat)), ...avoidActs(f, lonlat)], // W67 places: a live peek's star and share; W73 avoid: a road's Avoid
    hours: (f, lonlat, place) => hoursOf(place ?? placeOf(f, lonlat)), // W77 hours
    roads: async (ll, m) => { if (!world.ready(ll, m)) await Promise.race([world.idle(), new Promise((r) => setTimeout(r, 1500))]); return world.ready(ll, m) ? world.roadsNear(ll, m) : []; } }); // W84 roadtap: the chart's z15 roads at a point of the course, named at any zoom
  /** W77 hours: a place's opening_hours from the index on the phone: the entry of its kind and name nearest it, within 60 m. */
  async function hoursOf(place) { // W77 hours
    if (!place?.name || !place.lonlat || place.wide || ["waypoint", "space_station"].includes(place.kind)) return ""; // W77 hours: a dropped pin, home, a path or a park
    const same = (await placesIn([place.kind], boxAround([place.lonlat], 60))).filter((r) => r.name === place.name && r.oh); // W77 hours
    same.sort((a, b) => metres(a.lonlat, place.lonlat) - metres(b.lonlat, place.lonlat)); // W77 hours
    return same.length ? hoursWords(same[0].oh, Date.now(), pickWords) : ""; // W77 hours
  } // W77 hours

  // ---- W67 places (SPEC §97): starred places, and one pin to share ---------------------------------
  /** W67 places: the star: filled once starred; a tap stars, or unstars with Undo. */
  function starButton(place) { // W67 places
    const b = el("button", "star"); b.innerHTML = STAR_SVG; // W67 places
    const show = () => { const on = isStarred(starred(), place); b.setAttribute("aria-pressed", String(on)); b.setAttribute("aria-label", pickWords(on ? PLACES.starred : PLACES.star)); b.title = b.getAttribute("aria-label"); }; // W67 places
    show(); // W67 places
    b.onclick = (e) => { // W67 places
      e.stopPropagation(); // W67 places
      const list = starred(); // W67 places
      if (!isStarred(list, place)) { saveStarred(starIn(list, place)); return show(); } // W67 places
      const { list: left, undo } = unstarIn(list, place); // W67 places
      saveStarred(left); show(); // W67 places
      snack(pickWords(PLACES.unstarred), "", "Undo", 5000, () => { saveStarred(undo(starred())); show(); }); // W67 places
      delete ui.snack.dataset.preview; // W67 places: as home's, its Undo outlives a preview's re-plot
    }; // W67 places
    return b; // W67 places
  } // W67 places
  /** W67 places: share one place as #pin=lat,lon;name: the phone's share sheet, or a copy where there is none. A pin
   *  dropped on the chart sends no name, so the receiver's own words name it. */
  function pinShareButton(place) { // W67 places
    const b = el("button", "pshare"); b.innerHTML = SHARE_SVG; b.setAttribute("aria-label", pickWords(PLACES.share)); b.title = b.getAttribute("aria-label"); // W67 places
    b.onclick = async (e) => { // W67 places
      e.stopPropagation(); // W67 places
      const url = pinLink(location.origin + location.pathname, { lonlat: place.lonlat, name: ownName(lingo, place) }); // W67 places; W73 plan: its own name, never the sender's words
      nav.sharedPin = url; // W67 places: for tests
      if (navigator.share) { try { await navigator.share({ title: placeName(place), url }); } catch { /* cancelled */ } return; } // W67 places
      try { await navigator.clipboard.writeText(url); tip(b, pickWords(PLACES.copied)); } catch { tip(b, pickWords(PLACES.noShare)); } // W67 places
    }; // W67 places
    return b; // W67 places
  } // W67 places
  const placeActs = (place) => (place?.lonlat ? [starButton(place), pinShareButton(place)] : []); // W67 places
  /** W67 places: a pin dropped alone (a link's, a #pin='s, a coordinates row's): its marker and place, until a tap elsewhere. */
  function dropLone(place = null) { // W67 places
    ui.lone?.marker.remove(); ui.lone = null; // W67 places
    if (place) ui.lone = { place, marker: pinMarker(place.lonlat) }; // W67 places
  } // W67 places
  /** W67 places: a tap on the dropped pin (alone, or the preview's To) or on a starred mark shows that place's own peek. */
  function tapPlace(pt) { // W67 places
    const near = (ll) => { const q = map.project(ll); return Math.hypot(q.x - pt.x, q.y - (pt.y + 14)) <= 22; }; // W67 places: the pin's head sits above its tip
    const pin = ui.lone?.place ?? (ui.plan && ui.sheet?.classList.contains("cpreview") ? ui.plan.place : null); // W67 places
    if (pin?.lonlat && !pin.you && near(pin.lonlat)) return showPeek(pin); // W67 places
    const lit = ui.found?.find(({ r }) => { const q = map.project(r.lonlat); return Math.hypot(q.x - pt.x, q.y - pt.y) <= 22; }); // W104 oss2: a lit result, its ring centred on it
    if (lit) return showPeek(toPlace(lit.r)); // W104 oss2
    const f = map.getLayer("starred") && map.queryRenderedFeatures([[pt.x - 14, pt.y - 14], [pt.x + 14, pt.y + 14]], { layers: ["starred"] })[0]; // W67 places
    const p = f && starred()[f.properties.i]; // W67 places
    return p ? showPeek(p) : false; // W67 places
  } // W67 places
  const showPeek = (place) => hints.peekPlace(place, { actions: placeActs(place), stay: !!ui.lone && ui.lone.place === place }); // W67 places
  /** W67 places: a pin at `lonlat`, named `name` (else as a dropped pin is), in view (the camera glides there only when it is
   *  off the screen), with its peek. */
  async function showPin(lonlat, name = "", zoom = null) { // W67 places
    closeResults(false); if (ui.sheet) closeSheet(); // W67 places
    unlightFound(true); // W104 oss2 fix pass 2: puts a search's lit places out, as preview() does, before framing again
    if (!world.ready(lonlat, 120)) await Promise.race([world.idle(), new Promise((r) => setTimeout(r, 2000))]); // W67 places: the roads, to name it
    const at0 = placeAt(lonlat), place = metres(lonlat, FORT.lonlat) <= 40 ? { ...FORT, lonlat } : name ? { ...at0, lingo_name: name, name, pinned: false } : at0; // W67 places; W73 plan: the Fort by its name in either mode, as openLink's ends
    dropLone(place); // W67 places
    nav.pinned = lonlat; // W67 places
    const c = map.getContainer(), q = map.project(lonlat), seen = q.x > 40 && q.x < c.clientWidth - 40 && q.y > 120 && q.y < c.clientHeight - 160 && map.getZoom() >= 13; // W67 places
    if (seen || flight.flying) { showPeek(place); return place; } // W67 places: in flight the camera stays with the ship
    framing(true); framing(false, true); // W67 places: the camera lets go of the ship, as a pan would
    await new Promise((r) => { map.easeTo({ center: lonlat, zoom: Math.max(map.getZoom(), Math.min(17, zoom ?? 16)), duration: glideMs(0) * 2, essential: true }); map.once("moveend", r); }); // W67 places; W73 plan: heard after easeTo, which ends a move it stops (the no-location sheet's padding, opened again by framing) with that move's moveend
    if (ui.lone?.place === place) showPeek(place); // W67 places
    return place; // W67 places
  } // W67 places
  /** W67 places: Where to?'s row for a link or coordinates: the pin glyph, its name and its point. */
  function pinRow(link) { // W67 places
    const [lon, lat] = link.lonlat; // W67 places
    const me = origin() ? here() : null; // W67 places
    return resultRow({ lingo_name: link.name || pickWords(PLACES.pin), name: link.name || "", kind: "waypoint", lonlat: link.lonlat, place: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, distance_m: me ? metres(me, link.lonlat) : null }, () => showPin(link.lonlat, link.name || "", link.zoom)); // W67 places
  } // W67 places

  // ---- W54 course (SPEC §69): around the course: share it, the stops along it, radiation on it ----------
  /** W54 course: the stops along a route, from the search index on the phone, once a route. */
  const stopsOf = new WeakMap(); // W54 course
  const stopsFor = (r) => { if (!stopsOf.has(r)) stopsOf.set(r, placesIn(STOP_KINDS, boxAround(r.geometry)).then((ps) => stopsAlong(r.geometry, ps)).catch(() => [])); return stopsOf.get(r); }; // W54 course
  /** W54 course: the chips, a kind with none left out; a tap lights that kind's places along the course (`on`), again turns them off. */
  function stopChips(row, list, { on, off }) { // W54 course
    const counts = stopCounts(list); // W54 course
    row.replaceChildren(...counts.map(({ kind, n }) => { // W54 course
      const b = el("button", "stop-chip"), word = kindWord(lingo, kind, lingoMode()); // W54 course; W60 b: the mode
      b.dataset.kind = kind; b.setAttribute("aria-pressed", "false"); b.setAttribute("aria-label", pickWords(`${word}: ${n} along the course`, `${word}: ${n} along the route`)); // W54 course; W60 b
      b.append(glyphImg(kind, 22), el("span", "", word), el("b", "", String(n))); // W54 course
      b.onclick = () => { // W54 course
        const lit = b.getAttribute("aria-pressed") !== "true"; // W54 course
        for (const c of row.children) c.setAttribute("aria-pressed", String(c === b && lit)); // W54 course
        if (lit) on(kind, list.filter((st) => st.kind === kind)); else off(); // W54 course
      }; // W54 course
      return b; // W54 course
    })); // W54 course
    row.hidden = !counts.length; // W54 course
    nav.stops = list.map(({ kind, lingo_name, lonlat, at_m, off_m, side }) => ({ kind, lingo_name, lonlat, at_m, off_m, side })); // W54 course: for tests
  } // W54 course
  /** W54 course: a kind's places as rows, "Tardis · 0.6 LY along · +1 min"; a row's › opens its peek. */
  function stopList(sts, r, open, from_m = 0) { // W54 course: open null, in flight: the rows say, and a tap does nothing
    const ol = el("ol", "trows tstoprows"), v = (r.distance_m / Math.max(1, r.time_s)) * pace(); // W54 course: at the route's pace; W59 pace: and the pilot's
    for (const st of sts) { // W54 course
      const li = el("li"), b = el(open ? "button" : "div", "trow stop"); // W54 course
      b.append(glyphImg(st.kind, 32), elDur("span", "w", stopRow(st, v, from_m)), ...(open ? [el("span", "d", "›")] : [])); // W54 course // W68 fixes: its durations' h and m small
      b.dataset.at = Math.round(st.at_m); // W54 course
      if (open) b.onclick = () => open(st, b); // W54 course
      li.append(b); ol.append(li); // W54 course
    } // W54 course
    return ol; // W54 course
  } // W54 course
  /** W54 course: a kind's places lit on the chart, their glyphs on a --course ring; the camera stays where it is. */
  function lightStops(sts) { ui.stopMarks = sts.map((st) => { const m = el("div", "cstop"); m.append(glyphImg(st.kind, 26)); return new maplibregl.Marker({ element: m }).setLngLat(st.lonlat).addTo(map); }); } // W54 course
  function unlightStops() { for (const m of ui.stopMarks || []) m.remove(); ui.stopMarks = []; hideStopPeek(); } // W54 course
  /** W54 course: a stop's peek (SPEC §32's card), near its place, clear of the sheet: its name, what it is, how far off the
   *  course and to which side, and "Add as a stop". It goes on any other tap, or after 8 s. */
  let stopPeekEl = null, stopPeekT = 0; // W54 course
  function hideStopPeek() { clearTimeout(stopPeekT); stopPeekEl?.remove(); stopPeekEl = null; } // W54 course
  function stopPeek(st, add) { // W54 course
    hideStopPeek(); // W54 course
    const n = el("div", "cpeek cstop-peek"), txt = el("div", "t"), go = el("button", "add"); // W54 course
    n.setAttribute("role", "dialog"); n.setAttribute("aria-label", placeName(st)); // W54 course; W60 b: placeName
    const off = pickWords(`${distLabel(st.off_m)} off the course, to ${st.side}`, `${distLabel(st.off_m)} off the route, on the ${st.side === "port" ? "left" : "right"}`); // W60 b
    txt.append(named("b", "", st.kind, placeName(st)), ...[isPlain() && st.address === placeName(st) ? st.place : st.address || st.place, off].filter(Boolean).map((t) => el("small", "", t))); // W54 course; W60 b: off, and no name twice
    go.append(icon("plus"), document.createTextNode("Add as a stop")); // W54 course
    go.onclick = (e) => { e.stopPropagation(); hideStopPeek(); add(); }; // W54 course
    n.append(txt, go); // W54 course
    n.style.visibility = "hidden"; document.body.append(n); // W54 course: to measure it
    const c = map.getContainer().getBoundingClientRect(), p = map.project(st.lonlat), rects = [ui.sheet, document.getElementById("bar")].filter(Boolean).map((m) => m.getBoundingClientRect()); // W54 course
    const spot = peekSpot(c.left + p.x, c.top + p.y, n.offsetWidth, n.offsetHeight, rects, { left: 0, top: 0, right: innerWidth, bottom: innerHeight }) // W54 course
      ?? { left: Math.max(8, (innerWidth - n.offsetWidth) / 2), top: Math.max(8, (ui.sheet?.getBoundingClientRect().top ?? innerHeight) - n.offsetHeight - 12) }; // W54 course: the place out of view: above the sheet
    Object.assign(n.style, { left: `${spot.left}px`, top: `${spot.top}px`, visibility: "" }); // W54 course
    stopPeekEl = n; // W54 course
    stopPeekT = setTimeout(hideStopPeek, 8000); // W54 course
    setTimeout(() => addEventListener("pointerdown", function away(e) { if (stopPeekEl !== n) return removeEventListener("pointerdown", away, true); if (!n.contains(e.target)) { removeEventListener("pointerdown", away, true); hideStopPeek(); } }, true)); // W54 course
  } // W54 course
  /** W54 course: with the Weather layer on and radiation due on the course at the route's pace: "Radiation meets the course
   *  near Union Square, about 25 min in" (weather.along()), else null. */
  async function rainFor(r) { // W54 course
    if (!weather?.on || !r.geometry?.length) return null; // W54 course
    const pts = rainPts(r.geometry, r.distance_m, r.time_s / pace()), i = await weather.along(pts.map(({ lonlat, m }) => ({ lonlat, m }))).catch(() => -1); // W54 course
    if (!(i >= 0)) return null; // W54 course
    const areas = world.systemsAt(pts[i].lonlat), where = areas.find((a) => a.admin_level === 10)?.name || areas.find((a) => a.admin_level === 8)?.name || null; // W54 course
    return rainLine(where, pts[i].m); // W54 course
  } // W54 course
  /** W54 course: the link for a course: From, the stops and To at 5 decimals, the style and the graph's version. The part
   *  after # never reaches the host. */
  const linkFor = ({ from, to, via, style, route: r }) => courseLink(location.origin + location.pathname, { from: lonlatOf(from, near()), via, to: to.lonlat, style, graph: graphEntry?.sha256, avoid: r?.bent || [] }); // W54 course; W73 avoid: the streets it goes round
  /** W54 course: the share button's small menu: the From and To it sends, in view before it goes, then "Share link" (the
   *  phone's share sheet, or a copy where there is none) and "Show as a QR". */
  function shareMenu(btn, c) { // W54 course
    closeShare(); // W54 course
    const m = el("div", "cshare"), head = el("p", "head"), row = el("div", "acts"), send = el("button", "send"), qr = el("button", "qr"); // W54 course
    m.setAttribute("role", "dialog"); m.setAttribute("aria-label", pickWords("Share the course", "Share the route")); // W54 course; W60 b
    const fromName = c.from?.you ? "your position" : mainName(lingo, c.from.kind, placeName(c.from)), toName = mainName(lingo, c.to.kind, placeName(c.to)); // W54 course; W60 b: placeName
    head.append("From ", el("b", "", fromName), " to ", el("b", "", toName), ...(c.via.length ? [`, ${c.via.length} ${c.via.length === 1 ? "stop" : "stops"}`] : [])); // W54 course: the From shows before it goes
    send.append(el("span", "ic", ""), document.createTextNode("Share link")); send.firstChild.innerHTML = SHARE_SVG; // W54 course
    qr.append(icon("qr"), document.createTextNode("Show as a QR")); // W54 course
    const url = linkFor(c), text = pickWords(`Course from ${fromName} to ${toName}`, `Route from ${fromName} to ${toName}`); // W54 course; W60 b
    send.onclick = async () => { // W54 course
      closeShare(); // W54 course
      nav.shared = url; // W54 course: for tests
      if (navigator.share) { try { await navigator.share({ title: pickWords(`Course to ${toName}`, `Route to ${toName}`), text, url }); /* W60 b */ } catch { /* cancelled */ } return; } // W54 course
      try { await navigator.clipboard.writeText(url); tip(btn, "Link copied."); } catch { tip(btn, "This browser can't share or copy the link."); } // W54 course
    }; // W54 course
    qr.onclick = () => { closeShare(); qrView(url, qrLine(toName, c.route.distance_m, routeMinutes(c.route, pace()))); }; // W54 course; W59 pace
    const save = el("button", "gpx"); save.append(icon("gpx"), document.createTextNode(pickWords(RF.save))); save.onclick = () => { closeShare(); saveGpx(btn, c); }; // W67 routefile: Save as GPX
    row.append(send, qr, save); m.append(head, row); // W54 course; W67 routefile: save
    document.body.append(m); // W54 course
    const b = btn.getBoundingClientRect(), w = m.offsetWidth, sr = ui.sheet?.getBoundingClientRect(), side = sr && sr.top < 60; // W54 course: above the button; beside a landscape's side sheet
    Object.assign(m.style, side ? { left: `${Math.min(innerWidth - w - 8, sr.right + 8)}px`, top: `${Math.max(8, b.top)}px` } // W54 course
      : { left: `${Math.max(8, Math.min(innerWidth - w - 8, b.right - w))}px`, top: `${Math.max(8, b.top - m.offsetHeight - 8)}px` }); // W54 course
    ui.share = m; // W54 course
    watchBack("share", closeShare); // W54 course
    setTimeout(() => addEventListener("pointerdown", function away(e) { if (ui.share !== m) return removeEventListener("pointerdown", away, true); if (!m.contains(e.target)) { removeEventListener("pointerdown", away, true); closeShare(); } }, true)); // W54 course
  } // W54 course
  function closeShare() { ui.share?.remove(); ui.share = null; watchBack("share"); } // W54 course
  /** W54 course: the QR, full screen (a task): black on white, "COURSE TO … · N LY · N MIN" and an ×; ×, Back and Escape close it. */
  function qrView(url, words) { // W54 course
    const v = el("div", "cqr"), x = el("button", "x"), box = el("div", "code"), cap = elDur("p", "cap", words), link = el("p", "url", url); // W54 course // W68 fixes: its durations' h and m small
    v.setAttribute("role", "dialog"); v.setAttribute("aria-modal", "true"); v.setAttribute("aria-label", `QR: ${words}`); // W54 course
    x.setAttribute("aria-label", "Close"); x.append(icon("close")); // W54 course
    const { d, n } = qrPath(qrRows(url)); // W54 course
    box.innerHTML = `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="QR code of the ${pickWords("course", "route")}'s link"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`; // W54 course; W60 b
    v.append(x, cap, box, link); // W54 course
    document.body.append(v); // W54 course
    const close = () => { v.remove(); removeEventListener("keydown", esc, true); watchBack("qr"); if (ui.qr === v) ui.qr = null; }; // W54 course
    const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); } }; // W54 course: the QR's Escape, not the sheet's (nor its CloseWatcher's)
    x.onclick = close; addEventListener("keydown", esc, true); watchBack("qr", close); // W54 course
    ui.qr = v; // W54 course
    x.focus(); // W54 course
  } // W54 course

  // ---- the preview: four styles, Launch ------------------------------------------------------------
  // W28 settings: the Spoken turns switch went; Settings' Sound decides (app/calls.js: turns are Directions)
  /** The sheet's edge on the chart: below it, or beside it in landscape, for fitting the routes above it. */
  // W25: the side that faces the sheet keeps the ship clear of it: its half-width (about 40 px), the few px it sits off the
  // route's first point, and a gap. A route that starts at the ship lies on the free area's edge (667 × 375, app-fit).
  const SHIP_CLEAR = 60;
  const PIN_H = 36; // W86 preview: the pin's height over its tip, the anchor (.cpin, course.css), so its head clears the From/To bar too
  /** W86 preview: the sheet is the column at the left (landscape, a wide screen), under the From/To bar there, not across the foot. */
  const sideSheet = (s) => s.offsetTop < 60 + (ui.bar?.offsetHeight || 0); // W86 preview
  const clearOf = (s) => {
    const c = map.getContainer(); // offsets, not the box: the sheet may still be sliding in
    const bar = document.getElementById("bar"), barH = bar && !bar.classList.contains("away") ? bar.offsetHeight : 0; // beside the sheet in landscape
    return sideSheet(s) ? { top: 70, bottom: barH + 30, left: s.offsetLeft + s.offsetWidth + SHIP_CLEAR, right: 70 } : { top: Math.max(70, (ui.bar?.getBoundingClientRect().bottom ?? 0) + 12 + PIN_H), bottom: c.clientHeight - s.offsetTop + SHIP_CLEAR + (flight.flying ? 72 : 0), left: 40, right: 70 }; // W21 flight: and the readout; W86 preview: under the From/To bar
  };
  async function preview(place, via = [], start = startFrom(origin()), link = null) { // W23 fromto: start is the From, YOU or a place, or null; W54 course: link, a shared course's { style, other }
    unlightFound(true); // W104 oss2: puts a search's lit places out
    if (flight.flying) start = gpsLost() ? LAST_FIX : YOU; // W23 fromto: in flight, From is the ship; W25 course: with GPS lost, where it last had a fix
    if (place.you) place = { ...YOU, lonlat: near() }; // W23 fromto: a course back to where you are
    anchoragesNeed(); // W102 trim: a landing pad, so its racks' file (in before the turn list's pad line counts them)
    if (!start) { ui.vias = via.map((v) => v.slice()); return fromto.open({ from: null, to: place, focus: "from" }); } // W25 course: Choose start is the editor, To filled
    const s = sheet("cpreview");
    if (link) sharedAvoid = link.avoid || []; else if (!nav.cf && !(ui.plan?.place?.lonlat && metres(ui.plan.place.lonlat, place.lonlat) < 1)) sharedAvoid = []; // W73 avoid: a link's streets, while its course is open
    ui.plan = { place, via: via.map((v) => v.slice()), start }; // W25 course: for "Destination changed" and its Undo
    s.setAttribute("aria-label", pickWords(`Course to ${place.lingo_name}`, `Route to ${placeName(place)}`)); // W60 b
    dropPin(place.lonlat);
    if (start && !start.you) ui.start = new maplibregl.Marker({ element: el("div", "cstart") }).setLngLat(start.lonlat).addTo(map); // W23 fromto
    const grid = el("div", "cards"), status = el("p", "note"); // W25 course: "Plotting…" is in the chosen card; this line, only for no course
    const toFrom = el("p", "note lead"); // W33 routing2: the way from the ship to From, apart from the cards
    const facts = el("p", "facts"), share = el("button", "share"); // W49 cards: the chosen route's facts, across the sheet
    share.onclick = () => tip(share, pickWords(FREE_TIP), { ms: 8000, sheet: true }); // W60 b: pickWords // W49 cards: the share says what it counts
    // W102 leaveby (SPEC §198): a tap on the ride time picks an arrive-by; the cell then says when to leave, until the preview closes
    const mt = el(flight.flying ? "span" : "button", "m-t"); let arrive = null; // W102 leaveby: in flight she's under way, so no picker
    if (!flight.flying) { mt.title = pickWords(WORDS.arriveBy); mt.setAttribute("aria-haspopup", "dialog"); mt.setAttribute("aria-expanded", "false"); mt.onclick = () => (ui.leaveby ? ui.leaveby.close() : pickArrive()); } // W102 leaveby
    const fillMt = (r) => (mt.classList.toggle("leave", arrive != null), mt.replaceChildren(...(arrive == null ? durNodes(mins(r)) : [el("i", "", pickWords(WORDS.leave)), clockAt(leaveAt(arrive, mins(r)))]))); // W102 leaveby: at her pace, the plan's own minutes
    function pickArrive() { // W102 leaveby: over the chart beside the time, clear of the sheet and the From/To bar, as a sheet's tip
      const r = routes[pick]; if (!r || ui.sheet !== s) return;
      arrive ??= firstArrive(Date.now(), mins(r));
      const n = el("div", "leaveby"), row = el("div", "lb-row"), t = el("b", "lb-t"), less = el("button", "lb-step", "−"), more = el("button", "lb-step", "+"), clear = el("button", "lb-clear", pickWords(WORDS.clear));
      n.setAttribute("role", "dialog"); n.setAttribute("aria-label", pickWords(WORDS.arriveBy));
      less.setAttribute("aria-label", pickWords(WORDS.earlier)); more.setAttribute("aria-label", pickWords(WORDS.later));
      row.append(less, t, more); n.append(el("span", "lb-h", pickWords(WORDS.arriveBy)), row, clear);
      const show = () => { t.textContent = clockAt(new Date(arrive)); if (routes[pick]) fillMt(routes[pick]); };
      less.onclick = () => { arrive -= 300e3; show(); }; more.onclick = () => { arrive += 300e3; show(); };
      clear.onclick = () => { arrive = null; close(); if (routes[pick]) fillMt(routes[pick]); mt.focus(); };
      const away = (e) => { if (!n.contains(e.target) && !mt.contains(e.target)) close(); };
      const esc = (e) => { if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); close(); mt.focus(); } }; // the picker's Escape, not the sheet's
      const put = () => {
        const m = insets(), area = { left: m.left + 8, top: m.top + 8, right: innerWidth - m.right - 8, bottom: innerHeight - m.bottom - 8 };
        const p = placeBy(layoutRect(mt), [n.offsetWidth, n.offsetHeight], area, [s, ui.bar].filter(Boolean).map((x) => x.getBoundingClientRect()));
        n.style.left = `${p.left}px`; n.style.top = `${p.top}px`;
      };
      const again = () => requestAnimationFrame(() => requestAnimationFrame(put)), settle = setTimeout(put, 350); // as a tip: again on a resize, and once the From/To bar has settled
      function close() { clearTimeout(settle); removeEventListener("resize", again); removeEventListener("pointerdown", away, true); removeEventListener("keydown", esc, true); n.remove(); mt.setAttribute("aria-expanded", "false"); if (ui.leaveby?.n === n) ui.leaveby = null; }
      addEventListener("pointerdown", away, true); addEventListener("keydown", esc, true); addEventListener("resize", again);
      ui.leaveby = { n, close };
      document.body.append(n); show(); mt.setAttribute("aria-expanded", "true");
      put(); less.focus(); // focus in the picker, so the keyboard reaches its steps (Escape and Clear give it back to the time)
    }
    grid.setAttribute("role", "radiogroup");
    grid.setAttribute("aria-label", "Route style");
    // Each card fills in as its style is plotted, the default first, so the pilot can launch before the rest come.
    const cards = STYLE_CARDS.map((st) => {
      const b = el("button");
      b.dataset.id = st.id;
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", "false");
      b.disabled = true; b.className = "wait"; // W83 progressive: its shape fills in as it comes
      b.append(el("b", "", st.name.replace("g-w", "g\u2011w")), el("em"), el("span"), el("small"), el("i", "bare")); // W83 progressive: no "…" // "g-wells" whole on its line; W33 routing2: em, a fold's note; W59 routes: the bar
      b.onclick = () => choose(st.id, "pilot", b.getAttribute("aria-checked") !== "true" && (DELIGHT.draw ? "pick" : true)); // W23 polish: another style draws on; W73 delight: in 320 ms
      return b;
    });
    // W62 cometcard: the comet card, the third and never a fourth, only when a plan earns it (askComet)
    const cometBtn = el("button", "comet"); // W62 cometcard
    cometBtn.dataset.id = "comet"; cometBtn.setAttribute("role", "radio"); cometBtn.setAttribute("aria-checked", "false"); // W62 cometcard: in the row only while it has earned its place
    cometBtn.append(el("b", "", pickWords(COMET.card)), el("em"), el("span"), el("small"), el("i", "bare")); // W62 cometcard: the name, its reason, its minutes; the bar, the trains' part
    cometBtn.onclick = () => choose("comet", "pilot"); // W62 cometcard
    grid.append(...cards);
    let comet = null; // W62 cometcard: the plan that earned its card, with its card's words (cometCard)
    let walkPlans = [], walkK = 0, walkP = null; // W73 walk: the walker's plans, the chosen one
    const goRow = el("div", "pv-go"), go = el("button", "launch-c");
    go.append(icon("launch"), document.createTextNode(flight.flying ? pickWords("Fly it", "Go") : pickWords("Launch", "Start"))); // W60 b
    // W25 course: Launch always shows, solid, and starts the planned route (fromto-logic.js launchPlan)
    go.setAttribute("aria-busy", "true"); // W25 course: until the first route is in
    const chip = el("button", "turns-chip"), stripRow = el("div", "pv-strip"), tlist = el("div", "cturns"); // W53 turns: the chosen route's strip, the list; W86 preview: the list's button an icon, no count, and no arrival clock (planned ahead, it isn't when she'll arrive)
    chip.hidden = true; chip.onclick = () => openTurns(); chip.innerHTML = LIST_SVG; chip.setAttribute("aria-label", pickWords(WORDS.turnsList)); chip.title = chip.getAttribute("aria-label"); // W53 turns; W86 preview
    goRow.append(chip, go); // W28 settings: no Spoken turns switch; W53 turns: chip
    const swap = () => preview(start, ui.vias.slice().reverse(), place.you ? YOU : place, link?.style ? { style: link.style } : null); // W23 fromto; W73 plan: a shared course's style stays
    const canWalk = !!walk()?.available && !flight.flying && !link?.file, walking = canWalk && setting(WALK_KEY) === "on"; // W73 walk: on foot and by T, the From/To row's switch
    if (!flight.flying) window.starchart?.ship?.setGait?.(walking ? "walk" : "ride"); // W79 walker: the marker off the bike while the walker's switch is on
    const walkRow = canWalk ? { on: walking, label: pickWords(WALKW.mode), tip: pickWords(WALKW.modeTip), group: pickWords(WORDS.modes), bike: { label: pickWords(WORDS.bike), tip: pickWords(WORDS.bikeTip) }, toggle: () => { try { localStorage.setItem(WALK_KEY, walking ? "off" : "on"); } catch { /* full */ } preview(place, ui.vias, start, link); } } : null; // W73 walk; W86 preview: group, bike, the switch's two halves
    const bar = ui.bar = fromto.fromRow({ from: start, to: place, flying: flight.flying, swap, walk: walkRow }); // W23 fromto: the From → To row; W73 walk: walk; W86 preview: the bar at the top, over the chart
    document.body.append(bar); document.body.classList.add("has-pvbar"); // W86 preview
    ui.barSize = new ResizeObserver(() => document.documentElement.style.setProperty("--pvbar-h", `${bar.offsetHeight}px`)); ui.barSize.observe(bar); // W86 preview: Layers, the compass and the side sheet sit under it
    s.append(facts, grid, stripRow, toFrom, goRow, status, tlist); // W53 turns: stripRow, tlist; W86 preview: the four metrics first, beside ×
    const shareBtn = el("button", "pv-share"); // W54 course: share the course; W86 preview: in the From/To bar, under ⇅
    shareBtn.innerHTML = SHARE_SVG; shareBtn.setAttribute("aria-label", pickWords("Share the course", "Share the route")); shareBtn.title = shareBtn.getAttribute("aria-label"); // W54 course; W60 b
    shareBtn.onclick = (e) => (pick === "comet" ? tip(e.currentTarget, pickWords(COMET.noShare)) : routes[pick] ? shareMenu(e.currentTarget, { from: start, to: place, via: ui.vias, style: pick, route: { ...routes[pick], bent: foldBent() } }) : tip(e.currentTarget, failed || "Plotting…")); // W54 course; W73 avoid: foldBent, the card's streets; the button tapped (the top row's, or the list head's at 320 px); W62 cometcard: a comet course says it can't be shared
    bar.querySelector(".pv-tools").append(shareBtn); // W54 course; W86 preview: under ⇅
    shareBtn.hidden = walking; // W73 walk: a walker's plan isn't a course to share
    s.classList.toggle("walking", walking); // W79 walkgo: the walker's Start, a 56 px target in motion (BRIEF §7.8)
    // W86 preview: W54's .share-low and W73's .swap-low went: the bar's column under ⇅ always has room for share
    if (link?.other) toFrom.after(el("p", "note lead other", OTHER_GRAPH)); // W54 course: a shared course on another graph says so
    const strayNote = link?.file ? el("p", "note stray") : null; if (strayNote) { strayNote.hidden = true; strayNote.dataset.essential = ""; toFrom.after(strayNote); } // W67 routefile: where the course leaves the file, in a file's preview only (not .lead, the way to From's)
    ui.file = link?.file || null; ui.plan.file = !!ui.file; // W67 routefile

    for (const n of s.querySelectorAll(".cards b, .cards em, .cards span, .pv-go .txt, .note.lead, .facts")) n.dataset.essential = ""; // W22 fit; W49 cards: .facts, for the cards' small, out of sight; W86 preview: no .arrive
    let from = lonlatOf(start, near()); const routes = {}; // W21 flight: let, as the ship rides on; W23 fromto: from From
    // W27 card: the router's answers; `routes` gives each style the route its card shows, the quickest of its near-equals
    const raw = {};
    const sameAs = new WeakMap(), nearly = (a, b) => { let m = sameAs.get(a); if (!m) sameAs.set(a, (m = new WeakMap())); if (!m.has(b)) m.set(b, nearlySame(a, b)); return m.get(b); }; // W83 progressive: nearlySame once a pair of lines, in this preview
    let folds = [], coming = new Set(STYLE_CARDS.map((st) => st.id)); // W83 progressive: the styles still being planned
    const shown = new Set(); // W83 progressive: the cards showing a route
    /** W73 avoid: the streets the chosen card's course went round: any style folded into it, by its own course (raw), as the card shows another's near-equal one. */
    const foldBent = () => (folds.find((f) => f.ids.includes(pick))?.ids || [pick]).flatMap((id) => raw[id]?.bent || []).filter((a, i, all) => all.findIndex((b) => sameAvoid(a, b)) === i); // W73 avoid
    const refold = () => { folds = foldStyles(raw); if (comet) folds = foldTo(folds, raw, 2); for (const id in routes) delete routes[id]; for (const f of folds) for (const id of f.ids) routes[id] = raw[f.keep]; }; // W62 cometcard: three cards at most with the comet's
    // The style the pilot picked last leads (arclight, 2026-10-16: "defaults to whatever we used last time"). Once the
    // pilot has moved the chart, the preview leaves the camera where they put it.
    let pick = styleOf(link?.style ?? localStorage.getItem(STYLE)), gen = 0, moved = false; // W54 course: a shared course's style
    let tapped = !!link?.style; // W59 routes: a card the pilot tapped in this preview (or a shared course's style) stays chosen
    // W25 course: Launch is live from the start. Tapped before the route is ready, it says so and launches once it is.
    let busy = true, goSoon = false, failed = null;
    // W25 course: with From elsewhere and the ship known, the way to From, dim. W33 routing2: its minutes on a line of their own
    // and in the arrival time, not in the cards' and callouts' (arclight, 2026-10-17: Porter to Haymarket read 28 min and the
    // way back 44 to 52, the router's 23 and 24 with the ride from his ship to From added, re-planned from each fix)
    const paceK = pace(), mins = (r) => routeMinutes(r, paceK), lead = { r: null }, leadMin = () => (lead.r ? mins(lead.r) : 0); // W59 pace: paceK, the pilot's pace as the preview opens
    let leadAsked = false; // W83 progressive
    const askLead = () => { if (leadAsked) return; leadAsked = true; // W83 progressive: after the chosen card, never before it
    if (start && !start.you && !flight.flying && origin() && !walking) { // W73 walk: a walker's plan starts at From, with no bike way to it
      route(near(), start.lonlat, pick).then((r) => {
        if (ui.sheet !== s || !r || !onChart(start.lonlat)) return; // W68 fixes: no way to a From off the chart
        lead.r = r;
        map.getSource("course-lead")?.setData(line(r.geometry));
        toFrom.textContent = `Plus ${dur(leadMin())} from you to ${mainName(lingo, start.kind, placeName(start))}`; // W33 routing2; W60 b: placeName; W68 fixes: dur
        fillCards(); frame(false); label();
      }).catch(() => {});
    }
    }; // W83 progressive
    const onMove = (e) => { if (ui.sheet !== s) { map.off("movestart", onMove); map.off("wheel", onMove); } else if (e.originalEvent) moved = true; };
    map.on("movestart", onMove); map.on("wheel", onMove); // W27 card: and a wheel's zoom, which starts with no originalEvent
    ui.vias = via.map((v) => v.slice());
    /** Every route above the sheet: the camera moves only when one would be out of view (by more than `slack` px), or
     *  `always`; never once the pilot has moved the chart. W27 card: `slack` 0, the first route: only when one is out of
     *  view above the sheet, or they would be too small to read there (under 15 % of its width and height). */
    function frame(always, slack = 30, glide = true) { // W29 polish: glide, false for a resize, which jumps
      if (moved) return;
      const pts = [...Object.values(routes), ...(lead.r ? [lead.r] : [])].flatMap((r) => r.geometry).concat(comet ? planPoints(comet.plan) : []).concat(walkP ? planPoints(walkP) : []), pad = clearOf(s), c = map.getContainer(); // W25 course: and the way to From; W62 cometcard: every leg; W73 walk: and the walker's
      if (!pts.length) return;
      const xy = pts.map((p) => map.project(p)), w = c.clientWidth - pad.left - pad.right, h = c.clientHeight - pad.top - pad.bottom;
      const span = (k) => Math.max(...xy.map((p) => p[k])) - Math.min(...xy.map((p) => p[k]));
      const small = !slack && Math.max(span("x") / w, span("y") / h) < 0.15;
      if (!always && !small && xy.every((p) => p.x >= pad.left - slack && p.x <= c.clientWidth - pad.right + slack && p.y >= pad.top - slack && p.y <= c.clientHeight - pad.bottom + slack)) return;
      const b = pts.reduce((bb, p) => bb.extend(p), new maplibregl.LngLatBounds(pts[0], pts[0]));
      map.fitBounds(b, { padding: pad, maxZoom: 16.5, duration: glide ? glideMs(turn({ bearing: 0, pitch: 0 })) : 0, essential: true, bearing: 0, pitch: 0, absolutePadding: true }); // W25 course; W29 polish: it glides
      ui.moved = false; // W27 card: the chart is the preview's again; closing gives back the view before it
    }
    /** `by` "pilot": a tap on a card, a callout or a dim route, which is kept for the next preview and leaves the camera
     *  alone (arclight, 2026-10-16: switching routes reset his zoom). "plot": a route as it comes, framed if out of view.
     *  `draw`: the route draws on (W23 polish), for a route the pilot plotted. */
    function choose(id, by, draw = false) {
      pick = id;
      if (by === "pilot") tapped = true; // W59 routes
      if (link?.file) { const n = drawStrays(id === "comet" ? null : routes[id], link.file.line); strayNote.hidden = !n; strayNote.textContent = n ? pickWords(RF.strays)(n) : ""; } // W67 routefile
      if (id === "comet") { if (!comet) return; mark(); drawComet(comet.plan, STYLE_CARDS.filter((st) => routes[st.id]).map((st) => ({ style: st.id, geometry: routes[st.id].geometry, route: routes[st.id] }))); label(); return; } // W62 cometcard: never kept as the style; the camera stays
      if (by === "pilot") try { localStorage.setItem(STYLE, id); } catch { /* full */ }
      if (by === "pilot" && draw) chime("card_pick"); // W73 delight: a card picked, "locked in"; W86 settings: a tap's, only in All (app/calls.js TAPS)
      mark(); // W21 entry
      drawCourse(routes[id].geometry, STYLE_CARDS.filter((st) => st.id !== id && routes[st.id]).map((st) => ({ style: st.id, geometry: routes[st.id].geometry, route: routes[st.id] })), draw, routes[id].walk, routes[id]); // W59 routes: the routes, for their bare stretches
      if (by === "plot") frame(false);
      label();
    }
    function fillCard(i) {
      const st = STYLE_CARDS[i], r = routes[st.id], c = cards[i], small = c.querySelector("small");
      small.replaceChildren();
      c.disabled = !r;
      if (!r) { c.querySelector(".bare").style.removeProperty("--bare"); delete c.dataset.min; const wait = coming.has(st.id); if (wait) c.querySelector("span").textContent = ""; c.classList.toggle("wait", wait); return; } // W25 course: where the eye is; W59 routes: no bar; W83 progressive: no words while it comes, the card's shape fills in (minimal text); a card with no route keeps its "No course"
      c.classList.remove("wait");
      const free = Math.round(carFree(r)), climb = Math.round(r.climb_m / FT); // W32 routing: transport-free (arclight's word, 2026-10-17), what Wormholes rides for
      c.dataset.min = mins(r); // W33 routing2: From to To (W25 course: it had the way to From)
      c.querySelector("span").replaceChildren(...durNodes(mins(r))); // W49 cards: " min" smaller; W68 fixes: and "1h 20m"'s h and m
      c.dataset.ly = `${(r.distance_m / LY).toFixed(1)} ${pickWords("LY", "mi")}${climb ? ` · ▲${climb} ft` : ""}`; c.dataset.free = pickWords(`${free}% transport-free`, `${free}% car-free`); // W49 cards: for .facts; W60 b
      small.append(c.dataset.ly, el("br"), c.dataset.free); // W21 entry: no "▲0 ft"; W32 routing: car-free
      const bare = Math.round(bareShare(r)); if (bare) small.append(el("br"), WORDS.bare(bare)); // W59 routes: in its name, and as its bar
      c.querySelector(".bare").style.setProperty("--bare", bareBar(r)); // W59 routes
    }
    /** W21 entry: every card, then the styles with the same route folded into the first one's card. W27 card: and those with
     *  near-equal routes, its card showing the quickest (refold). W33 routing2: a fold says what its route is ("Best route",
     *  and under it "Quickest, flattest and most transport-free"; "Quickest & flattest"), not the styles' names. */
    function fillCards() {
      for (let j = 0; j < cards.length; j++) fillCard(j);
      const faces = folds.map((f) => f.ids.find((id) => shown.has(id)) ?? f.ids[0]); // W83 progressive: a fold keeps the card already showing it, so no card moves as the rest come
      for (const [i, c] of cards.entries()) {
        const f = folds.find((x) => x.ids.includes(c.dataset.id)), lead = !f || faces.includes(c.dataset.id); // W83 progressive: faces
        const gone = !lead && !!coming.size && !c.hidden; // W83 progressive: while some still come, a card folded away keeps its place, empty
        c.hidden = (!lead && !gone) || (!!link?.file && c.dataset.id !== link.file.style); // W67 routefile: one card; W83 progressive: gone
        c.classList.toggle("gone", gone); // W83 progressive
        if (lead && routes[c.dataset.id]) shown.add(c.dataset.id); else shown.delete(c.dataset.id); // W83 progressive
        c.dataset.folds = f && lead ? f.ids.join(" ") : c.dataset.id;
        c.querySelector("b").textContent = (f && lead ? f.name : STYLE_CARDS[i].name).replace("g-w", "g\u2011w");
        c.querySelector("em").textContent = (f && lead && f.note) || ""; // W33 routing2
      }
      fillComet(); // W62 cometcard
      grid.dataset.n = [...grid.children].filter((c) => !c.hidden).length; // W49 cards: one card spans the sheet; W62 cometcard: grid's, the comet's too
      mark();
    }
    /** W62 cometcard: the comet card: "By comet", its reason in a word ("Quicker"), its minutes door to door, and its bar. */
    function fillComet() { // W62 cometcard
      if (!comet) return cometBtn.remove(); // W62 cometcard
      if (!cometBtn.isConnected) grid.append(cometBtn); // W62 cometcard: the last card
      const c = comet.card = cometCard(comet.plan, { paceK }), [a, b] = c.share; // W62 cometcard: again, as the pace or the words change
      cometBtn.querySelector("b").textContent = c.name; cometBtn.querySelector("em").textContent = c.why; // W62 cometcard
      cometBtn.querySelector("span").replaceChildren(...durNodes(c.min)); cometBtn.dataset.min = c.min; // W62 cometcard; W68 fixes: durNodes
      cometBtn.querySelector("small").textContent = [c.fact, ...c.warn].join(" · "); // W62 cometcard: its accessible name, as the bike cards' facts
      cometBtn.title = c.fact; // W62 cometcard
      const line = `#${comet.plan.legs.find((l) => l.type === "train").color}`; // W62 cometcard: the bar, its trains dashed in their line's colour
      cometBtn.querySelector(".bare").style.setProperty("--bare", `repeating-linear-gradient(90deg, ${line} 0 6px, transparent 6px 10px) ${(100 * a).toFixed(1)}% 0 / ${(100 * (b - a)).toFixed(1)}% 100% no-repeat`); // W62 cometcard
    } // W62 cometcard
    /** W62 cometcard: once the bike cards are in, the comet plan, when Consider comets in routing (W68 settings2) is on and the course has no stops: its
     *  card shows only when the plan earns it (W61's earn rule), and the third bike card folds into its nearest. */
    async function askComet() { // W62 cometcard
      const t = transit(), g = gen; // W62 cometcard
      if (!t?.available || setting(COMET_KEY) !== "on" || (flight.flying && !link?.burn) /* W73 mission: Burn up's, in flight too */ || ui.vias.length || link?.file) return; // W62 cometcard: off, nothing asked; W67 routefile: nor for a file's course
      if (!t.enabled) await t.enable(); // W62 cometcard: a Consider comets (W68 settings2) set in an earlier visit: the timetable from storage
      const r = await t.plan(from, place.lonlat, Date.now(), { bike: bikeCards(raw), paceK, night: !isDay(Date.now(), from) }).catch(() => null); // W62 cometcard: the preview's cards, not planned again; W76 comets: and the pilot's pace (#40); W105 night: its rides timed as route() will give them
      nav.cometPlan = r && { reason: r.reason, earned: r.earned?.earned ?? null, checked: r.checked }; // W62 cometcard: for tests
      if (ui.sheet !== s || g !== gen) return; // W62 cometcard; W73 mission: the unearned case below
      if (!r?.earned) { if (comet) { comet = null; refold(); fillCards(); const id = pick === "comet" ? STYLE_CARDS.find((st) => routes[st.id])?.id : pick; if (id && routes[id]) choose(id, "plot"); label(); } return; } // W73 mission: an in-flight re-plot whose plan no longer earns the card takes it away (its train may have left)
      comet = { plan: r.earned }; // W62 cometcard
      refold(); fillCards(); if (routes[pick]) choose(pick); frame(false); label(); // W62 cometcard: three cards at most (a chosen style folded away draws its card's route); every leg in view
    } // W62 cometcard
    /** W21 entry: the chosen card, and its four metrics (W86 preview: no arrival clock, nor its sunset); every card, its minutes. */
    function mark() {
      let on1 = null; // W86 preview
      for (const c of cards) {
        const on = (c.dataset.folds || c.dataset.id).split(" ").includes(pick), span = c.querySelector("span");
        c.setAttribute("aria-checked", String(on));
        if (!c.dataset.min || !routes[c.dataset.id]) continue;
        span.replaceChildren(...durNodes(+c.dataset.min)); // W49 cards; W68 fixes: durNodes
        if (on) on1 = c;
      }
      cometBtn.setAttribute("aria-checked", String(pick === "comet")); // W62 cometcard
      const r1 = on1 && routes[on1.dataset.id], unit = (t) => el("i", "", t); // W86 preview
      if (r1) share.replaceChildren(`${Math.round(carFree(r1))} %`, unit(pickWords(WORDS.carFreeM))); // W86 preview; arclight 2026-10-23: the car-free share, as the cards
      facts.classList.toggle("metrics", !!r1); // W86 preview
      facts.replaceChildren(...(r1 ? [mt, el("span", "m-d", `${(r1.distance_m / LY).toFixed(1)}`), el("span", "m-c", `▲ ${Math.round(r1.climb_m / FT)}`), share] : pick === "comet" && comet?.card ? [el("span", "", comet.card.fact), ...comet.card.warn.map((w) => el("span", "warn", w))] : [])); // W49 cards; W62 cometcard: the fact to act on, and a warning only when there is one
      if (r1) { fillMt(r1); facts.querySelector(".m-d").append(unit(` ${pickWords("LY", "mi")}`)); facts.querySelector(".m-c").append(unit(" ft")); } // W86 preview: ride time, length, climb, with cars
      const bent = on1 ? foldBent() : []; if (bent.length) facts.append(avoidedLine(bent, avoidName, ui.plan)); // W73 avoid: so a street avoided long ago is never forgotten; W80 avoidmap: "Avoiding Starpath Western", or once, 30 days on, "Still avoiding …?"
      if (pick === "comet") stripRow.replaceChildren(); // W62 cometcard: no strip, no turn list
      showPick(on1 && routes[pick]); // W53 turns
      if (on1) Promise.all(s.getAnimations().map((a) => a.finished)).then(() => { if (ui.sheet === s && share.isConnected) tipOnce("free", share, pickWords(FREE_TIP), { sheet: true }) || (mt.tagName === "BUTTON" && tipOnce("leaveby", mt, pickWords(WORDS.leaveTip), { sheet: true })); }, () => {}); // W60 b: pickWords; W102 leaveby: the ride time's tip, at the next preview after free's
    }
    /** W53 turns: the chosen route's strip under the cards, and its TURNS chip; the same route as before keeps its strip. */
    let picked = null; // W53 turns
    function showPick(r) { // W53 turns
      chip.hidden = !r; // W53 turns
      nav.pickRoute = r || null; // W53 turns: for tests, the route the strip and the list show
      if (!r || r === picked) return; // W53 turns
      picked = r; // W53 turns
      stripRow.replaceChildren(...(r.elev ? [turns.strip(r, { course: courseOf(r) })] : [])); // W53 turns
    } // W53 turns
    const courseOf = (r) => new Course({ properties: {}, geometry: { type: "LineString", coordinates: r.geometry } }); // W53 turns
    /** W53 turns: TURNS swaps the cards for the list, in the same sheet; ×, Back or Escape go back to the cards. A tap on a
     *  row lights its turn on the chart, and the camera stays where it is; it is silent. (W53 turns) */
    function openTurns() { // W53 turns
      const r = routes[pick]; // W53 turns
      if (!r || ui.sheet !== s) return; // W53 turns
      const c = courseOf(r), rows = withWarnings(rowsOf(r, place, padSide(r.geometry, place.lonlat)), warnings(r)); // W53 turns; W54 flight: withWarnings
      const head = el("div", "thead"), title = elDur("h4", "", `To ${mainName(lingo, place.kind, placeName(place))} · ${(r.distance_m / LY).toFixed(1)} ${pickWords("LY", "mi")} · ${dur(mins(r))}`); // W53 turns; W60 b; W68 fixes: dur, its h and m small
      const rain = el("p", "train"), chipRow = el("div", "tstops"); // W54 course: radiation on the course, and the stops along it
      rain.hidden = chipRow.hidden = true; // W54 course
      head.append(title, rain, ...(r.elev ? [turns.strip(r, { course: c })] : []), chipRow); // W53 turns; W54 course: rain, chipRow; W86 preview: no share2, share is in the bar
      rainFor(r).then((t) => { if (t && rain.isConnected) { rain.textContent = t; rain.hidden = false; } }); // W54 course
      stopsFor(r).then((list) => { if (!chipRow.isConnected) return; const h0 = s.offsetHeight; stopChips(chipRow, list, { // W54 course
        on: (kind, sts) => { unlightStops(); lightStops(sts); const l = stopList(sts, r, (st) => stopPeek(st, () => addStop(st, r))); l.style.maxHeight = ol.style.maxHeight; tlist.querySelector(":scope > ol")?.replaceWith(l); }, // W54 course: the places lit, as rows
        off: () => { unlightStops(); tlist.querySelector(":scope > ol")?.replaceWith(ol); } }); // W54 course: the turns again
        const grew = s.offsetHeight - h0; if (grew > 0) ol.style.maxHeight = `${Math.max(96, ol.offsetHeight - grew)}px`; }); // W54 course: the chips take the rows' room, and the sheet keeps its height (the course above it stays in view)
      const ol = turns.list(rows, { dist: (row) => distLabel(row.at_m), course: c, /* W77 desktop: a row's hover lights it */ onTap: (row, b) => { // W53 turns
        const on = b.getAttribute("aria-pressed") !== "true"; // W53 turns
        for (const o of ol.querySelectorAll(".trow")) o.setAttribute("aria-pressed", String(o === b && on)); // W53 turns
        if (on) turns.light(row, c); else turns.unlight(); // W53 turns
      } }); // W53 turns
      tlist.replaceChildren(head, ol); // W53 turns
      if (rows.some((row) => /\b(port|starboard)\b/i.test(row.text))) tipOnce("port", ol, PORT_TIP, { sheet: true }); // W56 reroute: the first time the list says port or starboard
      s.classList.add("turns-on"); // W53 turns
      s.querySelector(":scope > .x").setAttribute("aria-label", "Back to the routes"); // W53 turns
      ui.turnsBack = () => { closeTurns(); return true; }; // W53 turns
      watchBack("turns", () => { if (ui.sheet === s) closeTurns(); }); // W53 turns
    } // W53 turns
    function closeTurns() { // W53 turns
      s.classList.remove("turns-on"); // W53 turns
      s.querySelector(":scope > .x").setAttribute("aria-label", "Close"); // W53 turns
      turns.unlight(); // W53 turns
      unlightStops(); // W54 course
      ui.turnsBack = null; // W53 turns
      watchBack("turns"); // W53 turns
      tlist.replaceChildren(); // W53 turns
    } // W53 turns
    /** W54 course: "Add as a stop": a via at the place, the routes again, and Undo. */
    function addStop(st, r) { // W54 course
      const before = ui.vias.slice(), next = before.slice(); // W54 course
      next.splice(viaIndex(r.via_m, st.at_m), 0, st.lonlat.slice()); // W54 course: in its order along the course
      closeTurns(); // W54 course: back to the cards, which plot again
      reshape(next); // W54 course
      snack("Stop added", "", "Undo", 5000, () => { if (ui.sheet === s) reshape(before); }); // W54 course
    } // W54 course
    /** W21 routes: each route's minutes in a callout beside its line, never on a line, with a pointer to it, where the
     *  routes are farthest apart; one callout for routes that are nearly the same. A tap on one picks it. */
    function label() {
      for (const m of ui.mins) m.remove();
      ui.mins = [];
      if (ui.drag?.moved) return; // the dragged route alone while the finger moves
      const groups = [];
      for (const st of STYLE_CARDS) {
        if (!routes[st.id]) continue;
        const g = groups.find((x) => nearly(routes[x[0]].geometry, routes[st.id].geometry)); // W83 progressive: nearly, memoized
        g ? g.push(st.id) : groups.push([st.id]);
      }
      const thin = new Map(), slim = (l) => { // W83 progressive: a long line with no point within 2 px of the last one kept, for calloutAt; once a label
        if (l.length < 300) return l; if (thin.has(l)) return thin.get(l); // W83 progressive: a short one as it is
        const out = [l[0]]; let [lx, ly] = project(l[0]); // W83 progressive
        for (let i = 1; i < l.length - 1; i++) { const [x, y] = project(l[i]); if ((x - lx) ** 2 + (y - ly) ** 2 >= 4) { out.push(l[i]); lx = x; ly = y; } } // W83 progressive
        out.push(l.at(-1)); thin.set(l, out); return out; }; // W83 progressive
      const taken = [], project = (p) => { const q = map.project(p); return [q.x, q.y]; }, c = map.getContainer(), pad = clearOf(s);
      const view = [pad.left - 34, pad.top - 6, c.clientWidth - pad.right + 64, c.clientHeight - pad.bottom + 34];
      const lines = groups.flat().map((id) => routes[id].geometry);
      groups.sort((a, b) => b.includes(pick) - a.includes(pick)); // the chosen route's callout first, on its best spot
      ui.mins = groups.map((g) => {
        const r = routes[g.includes(pick) ? pick : g[0]], ms = [...new Set(g.map((id) => mins(routes[id])))].sort((a, b) => a - b);
        const text = ms.length > 1 ? (ms.at(-1) < 60 ? `${ms[0]}–${ms.at(-1)} min` : `${dur(ms[0])}–${dur(ms.at(-1))}`) : dur(ms[0]); // W68 fixes: "1h 5m–1h 20m"
        const n = el("button", `cmin${g.includes(pick) ? " on" : ""}`), wrap = el("div", "ccall"), ptr = el("i", "cptr"); // W68 fixes: its durations' h and m small
        n.append(...durNodes(text)); // W68 fixes: its h and m small
        n.setAttribute("aria-label", `${g.map((id) => STYLE_CARDS.find((st) => st.id === id).name).join(", ")}: ${text}`);
        n.onclick = (e) => { e.stopPropagation(); if (!g.includes(pick)) choose(g[0], "pilot", true); }; // W23 polish: draws on
        n.onpointerdown = (e) => e.stopPropagation(); // a press on a callout is not a pin
        n.dataset.styles = g.join(" "); // W23 touch: a hover or a press on it brightens its route (app/hints.js)
        wrap.classList.toggle("on", g.includes(pick));
        wrap.append(ptr, n);
        wrap.style.visibility = "hidden";
        document.body.append(wrap); // to measure it
        const w = n.offsetWidth, h = n.offsetHeight;
        const others = groups.filter((x) => x !== g).map((x) => routes[x[0]].geometry);
        const k = calloutAt(slim(r.geometry), others.map(slim), { project, taken, box: [w, h], view, lines: lines.map(slim) }); // W83 progressive: slim
        const len = Math.hypot(k.dx, k.dy), ux = k.dx / len, uy = k.dy / len, edge = Math.min(Math.abs(ux) > 1e-9 ? w / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-9 ? h / 2 / Math.abs(uy) : Infinity);
        n.style.transform = `translate(${(k.dx - w / 2).toFixed(1)}px, ${(k.dy - h / 2).toFixed(1)}px)`;
        Object.assign(ptr.style, { width: `${Math.max(0, len - edge).toFixed(1)}px`, transform: `rotate(${Math.atan2(k.dy, k.dx).toFixed(3)}rad)` });
        wrap.style.visibility = "";
        return new maplibregl.Marker({ element: wrap }).setLngLat(k.ll).addTo(map);
      });
    }
    ui.relabel = label; // again when the chart moves: the callouts keep clear of the lines at every zoom
    reframe(s, () => { frame(true, 30, false); label(); }); // W25 course: again as the screen turns or resizes; W29 polish: at once
    ui.pick = (id) => { if (ui.sheet === s && routes[id]) choose(id, "pilot", true); }; // W23 polish: draws on
    go.onclick = async () => {
      const how = launchPlan({ from: start, via: ui.vias, flying: flight.flying, canLaunch: canLaunch() }); // W25 course
      if (!how) return noPosition(); // location off: the no-location sheet says why, and offers Try again
      if (pick === "comet" && comet) return launchComet(); // W62 cometcard
      if (walking) return walkP ? launchWalk() : tip(go, failed || pickWords(WALKW.finding)); // W79 walkgo: the walker's chosen card
      if (busy || !routes[pick]) { if (failed) return tip(go, failed); goSoon = true; return tip(go, "Plotting…"); } // W25 course: and it launches once it can
      goSoon = false;
      let r = routes[pick];
      if (ui.view) { ui.view.center = near(); ui.moved = false; } // back to the ship, at the zoom it had; W27 card: however the chart was moved
      const via = ui.vias.slice(), ship = origin() ? near() : null;
      closeSheet();
      if (!flight.flying) { nav.flownS = 0; launch(); }
      // W25 course: From elsewhere: ship → From → the stops → To (with no fix yet, From → To, and the first fix re-plots to From)
      let viaStart = false;
      if (how.lead && ship) { const lr = await route(ship, place.lonlat, pick, how.via, null, null, false, link?.file ? false : null).catch(() => null); if (lr) { r = lr; viaStart = true; } } // W107 fixes: a file's course by day's costs, as its preview
      const old = flight.flying && nav.cf ? { route: nav.route, place: nav.place, style: nav.style, via: nav.via, cf: nav.cf, start: nav.start?.place, viaStart: nav.start?.via, file: nav.file } : null; // W107 fixes: file
      engage({ route: r, place, style: pick, via, start: how.lead ? start : null, viaStart, fresh: true, file: !!link?.file }); // W107 fixes: file, a course from a route file
      planned(r.time_s); // W59 pace: the plan at launch, before pace, for the Log
      note("course", `set, ${pick}${via.length ? `, ${via.length} stops` : ""}${old ? ", over the last one" : ""}`); // W48 feedback: never the place
      if (old) snack(pickWords("Course changed", "Route changed"), "", "Undo", 5000, () => { if (flight.flying) engage(old); }); // W25 course: Fly it over a course; W60 b
      const f = lastFix(); // W21 entry: the card shows the first turn at once, not the whole course until the next fix
      if (f) { onFix(f); tick(); }
    };
    /** W62 cometcard: a comet course flies as two legs: leg 1 rides to the boarding station's entrance (legTwo() the rest). */
    async function launchComet() { // W62 cometcard
      const p = comet.plan, L = cometLegs(p); // W62 cometcard
      if (ui.view) { ui.view.center = near(); ui.moved = false; } // W62 cometcard: back to the ship, as for a bike course
      closeSheet(); // W62 cometcard
      if (!flight.flying) { nav.flownS = 0; launch(); } // W62 cometcard
      const r = await route(from, L.board.lonlat, "quickest").catch(() => null); // W62 cometcard: the ride the plan timed
      if (!r) return; // W62 cometcard: the graph went away; the flight flies on, with no course
      nav.leg = { plan: p, legs: L, place, n: 1 }; // W62 cometcard
      engage({ route: r, place: stationPlace(L.board), style: "quickest", fresh: true }); // W62 cometcard
      planned(r.time_s); // W62 cometcard: W59 pace's plan, the ride alone
      note("course", "set, comet"); // W62 cometcard
      const f = lastFix(); if (f) { onFix(f); tick(); } // W62 cometcard
    } // W62 cometcard
    /** W79 walkgo: a walker's plan flies as its legs: each walk a course on foot (walkOn), each ride the landing card (walkBoard). */
    function launchWalk() { // W79 walkgo
      if (ui.view) { ui.view.center = near(); ui.moved = false; } // W79 walkgo: back to the ship, as for a bike course
      afootTrip = true; // W79, at the merge: before the preview closes, so walker's close hook keeps the person on foot
      closeSheet(); // W79 walkgo
      afoot(); gait("walk"); // W79 walkgo: not a ride for the Log (main.js, before its Launch); the person on foot
      if (!flight.flying) { nav.flownS = 0; launch(); } // W79 walkgo
      nav.leg = { walk: true, plan: walkP, place, i: -1, n: 1, s0: nav.flownS, t0: performance.now() }; // W79 walkgo
      note("course", "set, walk"); // W79 walkgo
      walkOn(nav.leg, from); // W79 walkgo
    } // W79 walkgo
    /** W25 course: the first route is in (or none can come): Launch can act, and does if it was tapped. */
    const ready = (why = null) => { busy = false; failed = why; go.removeAttribute("aria-busy"); if (why) go.setAttribute("aria-disabled", "true"); else go.removeAttribute("aria-disabled"); if (goSoon && !why) go.click(); else if (goSoon) { goSoon = false; tip(go, why); } }; // W73 polish: Launch dims with no course, and its tap still says why
    /** Each style through the vias: `first` (the chosen one, after a reshape) leads; else the pilot's style leads, and
     *  if it has no route, the first style that has one. */
    /** W68 fixes: no course: the line says why, every card without a route says so, and Launch's tip says the same. */
    const noCourse = (why) => { coming.clear(); /* W83 progressive */ for (const id in raw) delete raw[id]; refold(); fillCards(); unpreview(); label(); status.textContent = why; for (const c of cards) if (!routes[c.dataset.id]) { c.querySelector("span").textContent = pickWords("No course", "No route"); c.classList.remove("wait"); } grid.hidden = true; status.classList.add("off"); goRow.before(status); ready(why); }; // W68 fixes; W73 polish: no card has a course, so the one line in the cards' place
    const replot = () => { if (ui.sheet !== s) { removeEventListener("online", replot); removeEventListener("starchart:offline-ready", replot); } else if (failed === pickWords(NO_ROUTER)) { busy = true; go.setAttribute("aria-busy", "true"); plot(pick); } }; // W73 polish: the route network may have come
    addEventListener("online", replot); addEventListener("starchart:offline-ready", replot); // W73 polish
    /** W82 packui (SPEC §156): the first To, From or stop off the chart that lies in a map pack's box, not stored: the offer, a tap
     *  always (with the mobile-data words when list().asks), then its progress; stored, the plan goes on by itself. Else false. */
    let offerOff = () => {}; // W82 packui: the offer's listener, one at a time
    function offer() { // W82 packui
      offerOff(); // W82 packui
      const pts = [[place.lonlat, place], [from, start], ...ui.vias.map((v) => [v, null])], [pt, who] = pts.find(([p]) => !onChart(p)); // W82 packui: the To's pack first, by its name
      const pk = (data.packs || []).find((x) => inside(x.bounds, pt)), it = pk && packs?.list().find((x) => x.id === pk.id); // W82 packui
      if (!it || (it.state === "stored" && !it.update)) return false; // W82 packui: in no pack, or stored: today's words
      const where = !who ? pickWords(PACK.stop) : barePin(who) ? pickWords(PACK.spot) : placeName(who, "meatspace"), btn = (t, f) => { const b = el("button", "dlnow", t); b.onclick = f; return b; }; // W82 packui; W82: a bare dropped pin is "This spot", not "Pin"
      const show = (d) => { // W82 packui
        if (ui.sheet !== s) return off(); // W82 packui: closed meanwhile
        if (d.state === "stored" && !d.update) { off(); busy = true; go.setAttribute("aria-busy", "true"); return plot(pick); } // W82 packui: the plan resumes
        const getting = d.state === "downloading", words = getting ? pickWords(PACK.getting(d.name, Math.floor((100 * d.got) / d.bytes))) // W82 packui
          : d.why || pickWords(PACK.offer(where, d.name, mb(d.bytes - d.got), d.asks ? PACK.guard(navigator.connection) : "")); // W82 packui
        noCourse(words); // W82 packui: no cards, Launch says why
        status.classList.add("pk-offer"); // W82 packui
        status.append(el("span", "pk-acts")); // W82 packui
        status.lastChild.append(...(getting ? [btn(PACK.pause, () => packs.pause(d.id))] : [btn(PACK.download, () => packs.download(d.id)), btn(PACK.notNow, () => { off(); noCourse(pickWords(WORDS.offChart)); })])); // W82 packui
      }; // W82 packui
      const stop = packs.on((d) => d.id === pk.id && show(d)), off = offerOff = () => { stop(); offerOff = () => {}; status.classList.remove("pk-offer"); }; // W82 packui
      show(it); // W82 packui
      return true; // W82 packui
    } // W82 packui
    async function plot(first = null) {
      try { await routerReady(); await packsP; } catch (err) { if (ui.sheet === s) { console.warn("router:", err.message); noCourse(pickWords(NO_ROUTER)); } return; } // W68 fixes: the graph's bounds, first; W82 packmap: and the stored packs'
      if (ui.sheet !== s) return; // W68 fixes: closed meanwhile
      const off = [from, ...ui.vias, place.lonlat].some((p) => !onChart(p)); grid.hidden = off; status.classList.toggle("off", off); (off ? goRow.before(status) : goRow.after(status)); // W68 fixes: off the chart, no cards to wait for, and the line in their place
      if (off && offer()) return; // W82 packui: in a pack's box, the pack's offer
      if (off) return noCourse(pickWords(WORDS.offChart)); // W68 fixes: at once, never Plotting
      const lead = first ?? pick, g = ++gen, ids = PLAN_ORDER.slice().sort((a, b) => (b === lead) - (a === lead)).filter((id) => !link?.file || id === link.file.style); // W67 routefile: a file's course in the style its vias were found with, alone: another style through them leaves the file; W83 progressive: the chosen style, then the quickest to plan
      let led = false; // W68 fixes: a reshape's first style that finds none hands the lead on, as a new preview's does
      coming = new Set(ids); // W83 progressive: the cards still to come keep their places
      status.textContent = ""; fillCards(); // W68 fixes: no old line; the chosen card's Plotting…, now that it is; W83 progressive: after coming
      const ask = (id) => route(from, place.lonlat, id, ui.vias, "preview", null, false, link?.file ? false : null).then((r) => ({ r }), (err) => ({ err })); // W83 progressive: in the preview's lane, so a newer plot's request drops one still waiting; W105 night: a file's course through its vias by day's costs, as matched
      let next = ask(ids[0]); // W83 progressive
      for (const [k, id] of ids.entries()) { // W83 progressive: k
        const i = STYLE_CARDS.findIndex((st) => st.id === id);
        const { r, err } = await next; // W83 progressive
        if (ui.sheet !== s || g !== gen) return; // closed, or reshaped, while plotting; W83 progressive: and a stale answer never draws
        if (err) { console.warn("router:", err.message); noCourse(pickWords(NO_ROUTER)); return; } // W68 fixes: noCourse // W25 course (find B5); W60 b: pickWords; W83 progressive: after the gen check
        if (k + 1 < ids.length) next = ask(ids[k + 1]); // W83 progressive: the worker plans the next style while this one draws
        coming.delete(id); // W83 progressive
        if (!r) {
          if (!led && id === ids.at(-1)) { return noCourse(pickWords("No course there: no starpath reaches it.", "No route there: no street reaches it.")); } // W60 b; W68 fixes: after a reshape too, and no card left at Plotting…
          delete raw[id]; refold(); // W27 card
          fillCards(); // W21 entry
          cards[i].querySelector("span").textContent = pickWords("No course", "No route"); // W60 b
          continue;
        }
        raw[id] = r; refold(); // W27 card: near-equal routes fold into one card
        const lead1 = !led; if (lead1) { led = true; pick = id; } // W68 fixes: led; W83 progressive: lead1
        fillCards(); // W21 entry
        const p0 = pick; if (lead1) { ready(); if (ui.sheet !== s) return; await painted(); if (ui.sheet !== s || g !== gen) return; } // W83 progressive: the chosen card and Launch on screen before its line and callouts are drawn; a Launch tapped meanwhile has gone
        if (pick === p0) { if (id === first) choose(first, "plot"); // W83 progressive: a card tapped meanwhile stays chosen, as it drew
        else if (lead1) { status.textContent = ""; choose(id, null, true); frame(false, 0); } else choose(pick, "plot"); } // the others, dim, as they come; W27 card: the first, framed only if it must be; W23 polish: the new destination's route draws on; W83 progressive
        if (led) askLead(); // W83 progressive: the way to From, once the chosen card is in
      }
      if (!first && !tapped) { const id = firstPick(raw, folds, pick); if (id !== pick) choose(id, "plot"); } // W59 routes: prefer bikeable, once every style is in, unless the pilot has tapped a card
      askComet(); // W62 cometcard: every bike card is in
    }
    // ---- W21 routes: a drag on the chosen route pulls a via out of it; a handle moves, a tap on it removes it ----
    const local = (e) => { const r = map.getContainer().getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    function reshape(via) {
      ui.vias = via;
      comet = null; // W62 cometcard: a course with stops has no comet card
      handles();
      for (const st of STYLE_CARDS) if (st.id !== pick) delete raw[st.id]; // W27 card: raw
      coming = new Set(PLAN_ORDER); // W83 progressive: the cards wait for the new routes
      refold();
      busy = true; go.setAttribute("aria-busy", "true"); // W25 course: Launch waits for the new route, and says so
      fillCards(); // W21 entry
      plot(pick);
    }
    function handles() {
      for (const m of ui.handles) m.remove();
      ui.handles = ui.vias.map((ll, k) => {
        const h = el("div", "cvia");
        h.setAttribute("role", "button");
        h.setAttribute("aria-label", `Stop ${k + 1}: drag to move it, hold to remove it`); // W25 course: a hold removes it
        h.onpointerdown = (e) => {
          e.stopPropagation(); e.preventDefault();
          if (ui.drag || e.button > 0) return;
          drag(e, k, true);
          const mark = holdMark({ x: e.clientX, y: e.clientY, ms: LINE_MS }); // W26 hold: the ring, then the pop; W84 roadtap: LINE_MS
          const d = ui.drag, t = setTimeout(() => { if (ui.drag === d && !d.moved) { mark.take(); d.cancel(); dropClick = true; ui.tapAt = performance.now(); removeVia(k); } }, LINE_MS); // W26 hold: take(), the buzz too; W84 roadtap: LINE_MS
          d.done = () => { clearTimeout(t); mark.end(); }; // W26 hold
        };
        return new maplibregl.Marker({ element: h }).setLngLat(ll).addTo(map);
      });
    }
    const viaMarker = (e) => { const h = el("div", "cvia live"); return new maplibregl.Marker({ element: h }).setLngLat(map.unproject(local(e))).addTo(map); };
    let liveSeq = 0, shownSeq = 0;
    function drag(e, k, replace) {
      map.dragPan.disable();
      const d = ui.drag = { k, replace, moved: false, ll: null, raf: 0, t: 0, marker: replace ? ui.handles[k] : null, done: () => {} };
      const via = () => { const v = ui.vias.slice(); if (d.replace) v[d.k] = d.ll; else v.splice(d.k, 0, d.ll); return v; };
      const send = async () => {
        const seq = ++liveSeq, t = d.t, r = await route(from, place.lonlat, pick, via(), "drag").catch(() => null);
        if (!r || ui.drag !== d || seq < shownSeq) return; // replaced by a newer move, or let go
        shownSeq = seq;
        drawCourse(r.geometry, null, false, r.walk, r); // W59 routes
        const answer = performance.now();
        nav.dragLog.push({ move: t, answer });
        if (nav.dragLog.length > 500) nav.dragLog.shift();
      };
      const move = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        if (!d.moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 8) return;
        if (!d.moved) { d.moved = true; d.done(); label(); drawCourse(routes[pick].geometry, null, false, routes[pick].walk, routes[pick]); d.marker ??= viaMarker(e); } // W59 routes: routes[pick]
        d.ll = map.unproject(local(ev)).toArray();
        d.t = ev.timeStamp;
        d.marker.setLngLat(d.ll);
        d.raf ||= requestAnimationFrame(() => { d.raf = 0; send(); }); // at most a request a frame; the worker plans the newest
      };
      const up = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        for (const t of ["pointermove", "pointerup", "pointercancel"]) removeEventListener(t, t === "pointermove" ? move : up);
        cancelAnimationFrame(d.raf);
        d.done();
        map.dragPan.enable();
        ui.drag = null;
        if (!d.replace) d.marker?.remove();
        if (ev.type === "pointercancel") { if (d.replace) d.marker.setLngLat(ui.vias[k]); if (d.moved && ui.sheet === s) choose(pick); return; }
        if (!d.moved) { if (d.replace) { ui.tapAt = performance.now(); tip(d.marker.getElement(), "Hold to remove the stop"); } return; } // W25 course: a tap on a stop says how
        reshape(via());
      };
      d.cancel = () => up({ pointerId: e.pointerId, type: "pointercancel" });
      addEventListener("pointermove", move);
      addEventListener("pointerup", up);
      addEventListener("pointercancel", up);
    }
    function removeVia(k) {
      const before = ui.vias.slice();
      reshape(before.filter((_, j) => j !== k));
      snack("Stop removed", "", "Undo", 5000, () => { if (ui.sheet === s) reshape(before); });
    }
    /** W25 course: where a point (the chart's px) is on the chosen route's line, within `px`; else null. */
    ui.onLine = (pt, px = 12) => {
      const r = routes[pick];
      if (!r) return null;
      const hit = nearestOn(r.geometry, Array.isArray(pt) ? pt : [pt.x, pt.y], (p) => { const q = map.project(p); return [q.x, q.y]; });
      return hit.d <= px ? { ...hit, line: r.geometry } : null; // W84 roadtap: line, for the peek
    };
    /** W25 course: a hold (500 ms; W84 roadtap: 425, LINE_MS; a ring and a buzz) on the chosen route's line places a stop where the finger lifts, so a
     *  plain drag on it still pans the chart. */
    ui.replan = () => reshape(ui.vias.slice()); // W73 avoid: a street avoided or let back in: every style again
    ui.holdLine = (e) => {
      const r = routes[pick], hit = !ui.drag && !busy && ui.onLine(local(e), e.pointerType === "touch" ? 20 : 12);
      if (!hit) return false;
      drag(e, viaIndex(r.via_m, hit.s), false);
      const d = ui.drag;
      d.moved = true; d.ll = map.unproject(local(e)).toArray();
      label(); drawCourse(r.geometry, null, false, r.walk, r); d.marker = viaMarker(e); // W59 routes: r
      return true;
    };
    if (ui.vias.length && !walking) handles(); // W73 walk: a walker's plan has no stops
    if (flight.flying) { // W21 flight: the ship rides on while the preview is open: every 50 m, the routes from where it is now
      const off = pose.on("fix", () => {
        if (ui.sheet !== s || !flight.flying) return off();
        if (ui.drag || metres(from, near()) < 50) return;
        from = near();
        plot(pick);
      });
    }
    if (walking) return walkPlot(); // W73 walk: the walker's cards, not the ship's
    await plot();
    // W73 walk: on foot and by T: her two or three cards (chart/routing/walktransit.js) in place of the bike cards, each its lines,
    // W73 walk: its reason in a word, its minutes door to door and its legs as a bar; chosen, its walks dotted and its rides dashed
    // W73 walk: in their lines' colours, the fact to act on, and the arrival; then each first boarding's live departure. W79 walkgo: and Start (launchWalk).
    async function walkPlot() { // W73 walk
      for (const c of cards) c.hidden = true; // W73 walk: no bike cards planned
      status.textContent = pickWords(WALKW.finding); goRow.after(status); // W73 walk; W79 walkgo: Start shows, busy until her cards are in
      grid.setAttribute("aria-label", pickWords(WALKW.cards)); // W73 walk
      const r = await walk().plan(from, place.lonlat, Date.now()).catch(() => ({ plans: [], reason: "failed" })); // W73 walk: the worker failed (held and offline come back as reasons)
      if (ui.sheet !== s) return; // W73 walk
      nav.walkPlan = { reason: r.reason, plans: r.plans.length, stats: r.stats || null }; // W73 walk: for tests
      if (!r.plans.length) { status.textContent = pickWords(WALKW[r.reason] || WALKW.none); return ready(status.textContent); } // W73 walk; W79 walkgo: ready, Start says why
      status.textContent = ""; walkPlans = r.plans; // W73 walk
      ready(); // W79 walkgo: Start, on the chosen card
      fillWalk(); chooseWalk(0); frame(false); // W73 walk
      r.plans.forEach((p, k) => walk().live(p).then((q) => { if (ui.sheet !== s || q === p || walkPlans[k] !== p) return; walkPlans[k] = q; fillWalk(); if (walkK === k) chooseWalk(k); }, () => {})); // W73 walk: the card keeps its place
    } // W73 walk
    function fillWalk() { // W73 walk
      for (const b of grid.querySelectorAll(".walkc")) if (+b.dataset.id.slice(5) >= walkPlans.length) b.remove(); // W73 walk
      walkPlans.forEach((p, k) => { // W73 walk: each card updated in place, so a focused one keeps its focus
        const c = walkCard(p), b = grid.querySelector(`.walkc[data-id="walk-${k}"]`) || grid.appendChild(el("button", "walkc")); // W73 walk
        b.dataset.id = `walk-${k}`; b.dataset.min = c.min; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(k === walkK)); // W73 walk
        b.replaceChildren(el("b", "", c.name), el("em", "", c.why || c.walk), el("span"), el("small", "", c.label), el("i", "bare")); // W73 walk: a card with no reason of its own says its walk
        b.querySelector("span").replaceChildren(...durNodes(c.min)); b.querySelector(".bare").style.setProperty("--bare", c.bar); b.title = c.fact; // W73 walk
        b.onclick = () => chooseWalk(k); // W73 walk
      }); // W73 walk
      grid.dataset.n = walkPlans.length; // W73 walk
    } // W73 walk
    function chooseWalk(k) { // W73 walk: the camera stays
      walkK = k; walkP = walkPlans[k]; const c = walkCard(walkP); // W73 walk
      for (const b of grid.querySelectorAll(".walkc")) b.setAttribute("aria-checked", String(b.dataset.id === `walk-${k}`)); // W73 walk
      facts.replaceChildren(el("span", "", c.fact), el("span", "", c.walk)); // W73 walk
      drawCourse(null); map.getSource("course-walk")?.setData(walkLegs(walkP)); map.getSource("course-comet")?.setData(trainLines(walkP)); // W73 walk: walks dotted, rides dashed
      nav.walkDrawn = { walks: walkLegs(walkP).features.length, rides: walkP.legs.filter((l) => l.type === "train").map((l) => ({ route: l.route, color: `#${l.color}`, stops: l.path.length })) }; // W73 walk: for tests
    } // W73 walk
  }

  // ---- in flight -------------------------------------------------------------------------------------
  const gate = new ReplotGate();
  let spell = new OffSpell(); // W21 flight: one spell off the course across its re-plots
  let courseEngine = null, startS = 0, startT = 0, replotting = false;
  let travel = null, prevFix = null, replotFailed = false; // W31 navvoice: the way the ship is going, for a re-plot; the last re-plot failed
  let headsUp = null; // W73 delight: the course whose off-course heads-up shows
  let warns = [], warnSaid = new Set(), warnAt = []; // W54 flight: the course's steps and steep parts, those said, and where (kept across re-plots)
  const card = el("div", "cturn");
  card.setAttribute("role", "group"); // not a live region: it changes four times a second
  card.setAttribute("aria-label", pickWords("Course", "Route")); // W60 b
  card.hidden = true;
  const arrow = Object.assign(el("img", "arrow"), { alt: "" }), dist = el("b", "dist"), road = el("span", "road"), tc = el("div", "tc");
  const cancelBtn = el("button", "x"), foot = el("div", "foot"), toEl = el("span", "to"), etaEl = el("span", "eta");
  cancelBtn.setAttribute("aria-label", pickWords("Cancel course", "Cancel route")); // W60 b
  cancelBtn.append(icon("close"));
  tc.append(dist, road);
  dist.dataset.essential = road.dataset.essential = ""; // W22 fit
  foot.append(toEl, etaEl);
  card.append(arrow, tc, cancelBtn, foot);
  document.body.append(card);
  cancelBtn.onclick = () => cancel();
  card.onclick = (e) => { if (!e.target.closest("button")) repeatTurn(); }; // W31 navvoice (#12): a tap says the turn again
  card.addEventListener("click", (e) => { if (nav.leg?.n !== 0 || e.target.closest("button")) return; e.stopPropagation(); legTwo(); }, true); // W62 cometcard: between a comet course's legs, a tap anywhere on the card (its foot too) sets out on leg 2
  card.addEventListener("click", (e) => { if (card.classList.contains("off") && e.target.closest(".foot")) { e.stopPropagation(); if (card.classList.contains("keep")) keepCourse(); else repeatTurn(); } }, true); // W74 course: in the heads-up's grace, the foot is Keep course; off course, no turns to unfold, the card's tap
  foot.addEventListener("keydown", (e) => { if (card.classList.contains("off") && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); e.stopImmediatePropagation(); if (card.classList.contains("keep")) keepCourse(); } }); // W74 course
  // W31 navview: "Then" and the turn after the card's, in a slim row under it, while that turn is within the voice's chain
  // distance (TurnPrompter's max(60 m, 10 s at the speed)). The card's room, --card-h, grows while it shows.
  // W53 lanes (SPEC §68): a turn across 2 or more motor lanes takes the same slot from the prepare call's distance to the
  // turn: its lanes (lanes.js), "2 TO CROSS" and the bike box; a close Then follows at the row's end, and below 360 px waits.
  const thenRow = el("div", "cthen"), thenArrow = Object.assign(el("img"), { alt: "" }), THEN_H = "170px"; // W53 turns: was 158
  const laneBox = el("span", "lanes"), crossEl = el("span", "cross"), boxEl = el("span", "box"), thenSep = el("span", "sep"); // W53 lanes
  thenRow.append(laneBox, crossEl, boxEl, thenSep, el("span", "tw", "Then"), thenArrow); // W53 lanes: the lanes first
  thenRow.hidden = true;
  document.body.append(thenRow);
  let thenShown = null, lanesShown = null; // W53 lanes: lanesShown
  /** W53 lanes: a row too wide for the screen says "BOX", then lets the Then wait until after the turn. */
  const fitLanes = () => { thenRow.classList.remove("tight", "wait"); for (const c of ["tight", "wait"]) { if (!lanesShown || thenRow.scrollWidth <= thenRow.clientWidth) break; thenRow.classList.add(c); } }; // W53 lanes
  function showThen(next, ln = null) { // W53 lanes: ln
    if (next === thenShown && ln === lanesShown) return; // W53 lanes
    thenShown = next;
    lanesShown = ln; // W53 lanes
    thenRow.hidden = !next && !ln; // W53 lanes
    thenRow.classList.toggle("lanes", !!ln); thenRow.classList.toggle("then", !!next); // W53 lanes
    if (ln) { drawLanes(laneBox, ln); crossEl.textContent = `${ln.cross} to cross`; boxEl.replaceChildren(...(ln.box ? [el("span", "long", "Bike "), "box"] : [])); } // W53 lanes
    else { laneBox.replaceChildren(); crossEl.textContent = ""; boxEl.replaceChildren(); } // W53 lanes
    boxEl.hidden = !ln?.box; // W53 lanes
    if (next) thenArrow.src = at(`design/glyphs/maneuver/${arrowFile(next)}.svg`); // W53 lanes: the label below
    thenRow.setAttribute("aria-label", [ln && laneLabel(ln, lingoMode()), next && `Then ${turnWords(next, lingoMode())}`].filter(Boolean).join(" ")); // W53 lanes; W60 b: the mode; W73 flight: the lanes' too
    if (!card.hidden) document.documentElement.style.setProperty("--card-h", cardH()); // W53 turns: cardH(); W53 lanes: it counts the lanes
    fitLanes(); // W53 lanes
  }
  /** W53 turns: the card's room: with its Then row, or unfolded into the turns ahead, down to the list's foot. */
  const cardH = () => (card.classList.contains("keep") ? "128px" /* W74 course: a 56 px foot */ : card.classList.contains("tall") ? "146px" : fly?.open ? `${116 + fly.h + 10}px` : thenShown || lanesShown || !anchorBtn.hidden ? THEN_H : CARD_H); // W53 turns; W53 lanes: lanesShown; W54 flight: the anchorages; W62 cometcard: the landing card's third line
  // W54 flight (SPEC §70; gmaps #13): the anchorages (bike parking) within ANCHOR_M of the landing pad, from the chart's tiles,
  // in the Then slot from the arrival (200 m) and at the top beside "Course complete" for its 10 s. A tap lights them on the
  // chart (a --phosphor ring each), and again unlights them; the camera stays where it is.
  // W56 parking (SPEC §73): within APPROACH_M of the pad they light by themselves, once a pad, with one pulse (Calm: none);
  // RINGS at most, dedicated racks first (app/anchorages.js near()). The preview's landing pad line counts them.
  const ANCHOR_M = 150, APPROACH_M = 500, RINGS = 8, anchorBtn = el("button", "canchors"), anchorRings = []; // W54 flight; W56 parking: 150 m (was 100), APPROACH_M, RINGS
  Object.assign(anchorBtn, { type: "button", hidden: true }); anchorBtn.setAttribute("aria-pressed", "false"); document.body.append(anchorBtn); // W54 flight
  let anchors = [], anchorsKey = "", anchorsAfter = 0, approached = ""; // W54 flight: the anchorages near the pad, its key, and when after touchdown they go; W56 parking: the pad they lit for
  const anchorsNear = (ll) => (anchoragesIn() ? anchoragesNear(ll, ANCHOR_M) : world.features("pois", ["anchorage"], ll, ANCHOR_M).map((f) => ({ ll: f.geometry.coordinates, d: metres(ll, f.geometry.coordinates), rank: 0 })).sort((a, b) => a.d - b.d)); // W54 flight; W56 parking: the file first
  function padAnchors(place) { const n = anchorsNear(place.lonlat).length; return n ? anchorageWords("pad", n) : ""; } // W56 parking: the preview's landing pad line; W60 c
  const anchorWords = (n) => anchorageWords("near", n, Math.round(ANCHOR_M / FT / 10) * 10); // W60 c; W54 flight; the app's units: ft for short spans (the parent, at the merge)
  const inView = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add("pulse"); inView.unobserve(e.target); } }); // W56 parking: each pulses once it is in view
  function unlightAnchors() { for (const m of anchorRings.splice(0)) { inView.unobserve(m.getElement()); m.remove(); } anchorBtn.setAttribute("aria-pressed", "false"); } // W54 flight; W56 parking: inView
  function lightAnchors(pulse = false) { // W56 parking: dedicated racks first, RINGS at most; `pulse`, once, on the approach
    for (const a of anchors.slice(0, RINGS)) { const ring = el("div", `canchor-ring${a.rank ? " other" : ""}`); if (pulse) inView.observe(ring); anchorRings.push(new maplibregl.Marker({ element: ring }).setLngLat(a.ll).addTo(map)); } // W56 parking
    anchorBtn.setAttribute("aria-pressed", "true");
  }
  anchorBtn.onclick = () => (anchorRings.length ? unlightAnchors() : lightAnchors()); // W54 flight: lit or not; never a camera move
  /** W56 parking: in flight, within APPROACH_M of `place`, its anchorages light by themselves, once a pad; never a camera move. */
  function approach(place) {
    const key = place.lonlat.join();
    if (approached === key) return;
    approached = key;
    if (key !== anchorsKey || !anchors.length) { anchors = anchorsNear(place.lonlat); anchorsKey = key; anchorBtn.replaceChildren(glyphImg("anchorage", 24), el("span", "t", anchorWords(anchors.length))); }
    if (anchors.length && !anchorRings.length) lightAnchors(true);
  }
  /** W54 flight: `place` the landing pad to show them for (null hides them); `after`, at the top, the card gone. */
  function showAnchors(place, after = false) {
    const key = place ? place.lonlat.join() : "";
    if (place && (key !== anchorsKey || !anchors.length)) { anchors = anchorsNear(place.lonlat); anchorsKey = key; anchorBtn.replaceChildren(glyphImg("anchorage", 24), el("span", "t", anchorWords(anchors.length))); }
    const on = !!place && anchors.length > 0;
    if (!on) { anchorsKey = ""; unlightAnchors(); }
    anchorBtn.classList.toggle("after", on && after);
    if (anchorBtn.hidden === on) { anchorBtn.hidden = !on; if (!card.hidden) document.documentElement.style.setProperty("--card-h", cardH()); }
  }
  // W53 turns: the foot unfolds the card into the turns still ahead (app/turns.js unfold)
  const fly = turns.unfold({ card, foot, dist: distLabel, // W53 turns
    state: () => (nav.cf && !nav.cf.last?.off ? { rows: flyRows(), s: nav.cf.s, route: nav.route, course: nav.cf.course } : null), // W53 turns
    room: () => { const p = here() && map.project(here()), top = card.offsetTop + card.offsetHeight; return Math.min(innerHeight * 0.45, p ? map.getContainer().getBoundingClientRect().top + p.y - 56 - top : Infinity); }, // W53 turns: the ship stays in view
    changed: () => { if (!card.hidden) { const h = cardH(); if (document.documentElement.style.getPropertyValue("--card-h") !== h) document.documentElement.style.setProperty("--card-h", h); } }, // W53 turns
    watch: (close) => watchBack("turns-fly", close), // W53 turns
    chips: (st) => { // W54 course: in flight, the stops ahead of the ship; a chip lights them and lists them, from the ship
      const row = el("div", "tstops"), r = st.route; row.hidden = true; unlightStops(); // W54 course
      stopsFor(r).then((list) => { if (row.isConnected) stopChips(row, list.filter((x) => x.at_m > st.s), { // W54 course
        on: (kind, sts) => { unlightStops(); lightStops(sts); const ol = fly.panel.querySelector(".trows"); flyTurns ??= ol; ol?.replaceWith(stopList(sts, r, null, nav.cf?.s ?? st.s)); }, // W54 course
        off: () => { unlightStops(); if (flyTurns) fly.panel.querySelector(".trows")?.replaceWith(flyTurns); flyTurns = null; } }); }); // W54 course
      flyTurns = null; // W54 course
      return row; // W54 course
    }, // W54 course
    closed: () => { unlightStops(); flyTurns = null; } }); // W53 turns; W54 course: closed
  let flyTurns = null; // W54 course: the turns' rows while a chip lists its stops in flight
  let flyKey = null, flyList = []; // W53 turns: the course's rows, made again for a new course
  const flyRows = () => { if (flyKey !== nav.cf) { flyKey = nav.cf; flyList = withWarnings(rowsOf(nav.route, nav.place, nav.cf.prompter.list.at(-1)?.side ?? null), warnings(nav.route)); } return flyList; }; // W53 turns; W54 flight: withWarnings
  function thenTick() {
    const r = nav.cf?.last, list = nav.cf?.feature.properties.instructions || [];
    const k = r && !r.off && r.phase !== "arrive" && !card.hidden ? list.findIndex((i) => i.along_m > r.s + 5 && i.turn !== "arrive") : -1;
    const ins = list[k], next = list[k + 1], v = Math.max(1, lastFix()?.speed_mps || 0);
    const ln = ins?.lanes && ins.along_m - r.s <= Math.max(120, 20 * v) ? ins.lanes : null; // W53 lanes: TurnPrompter's prepare distance
    showThen(ins && next && !PLAIN.has(next.turn) && next.along_m - ins.along_m < Math.max(60, 10 * v) ? next : null, ln); // not "then continue"; W53 lanes: ln
  }
  const showCard = (on) => {
    card.hidden = !on;
    if (!on) showThen(null); // W31 navview
    document.documentElement.style.setProperty("--card-h", on ? cardH() : "0px"); // W31 navview: THEN_H; W53 turns: cardH()
    if (!on) fly.close(); // W53 turns
    document.body.classList.toggle("coursed", on);
  };
  let arrowFileShown = "";
  const setArrow = (f) => { if (f !== arrowFileShown) { arrowFileShown = f; arrow.src = at(`design/glyphs/maneuver/${f}.svg`); } };
  /** W22 fit: a road name too long for the card's line takes two lines, smaller, before it is cut. */
  const fitRoad = () => { road.classList.remove("two"); if (road.scrollWidth > road.clientWidth) road.classList.add("two"); };
  /** W40 flight: a To line too long for the foot ("To the start: The Pear" at 320 px) gets the ETA's room, only as far as it
   *  must: first its word "arrive" ("2.5 LY · 19 min · 12:10"), then its LY ("19 min · 12:10"); a longer name is still cut. */
  let etaFull = "";
  const shorter = (t, k) => { if (k > 0) t = t.replace(" · arrive ", " · "); return k > 1 ? t.replace(/^[\d.]+ (LY|mi) · /, "").replace(/^New (course|route) in /, "") : t; }; // W60 b: mi; W74 course: the countdown beside Keep course, "8 s"
  const fitFoot = () => { for (let k = 0; k < 3; k++) { const t = shorter(etaFull, k); if (etaEl.textContent !== t) etaEl.replaceChildren(...durNodes(t)); /* W68 fixes: its h and m small */ if (toEl.scrollWidth <= toEl.clientWidth) break; } };
  new ResizeObserver(() => { fitRoad(); fitFoot(); fitLanes(); }).observe(card); // W40 flight: fitFoot; W53 lanes: fitLanes
  const put = (n, t) => { if (n === etaEl) { if (etaFull !== t) { etaFull = t; fitFoot(); } return; } if (n.textContent !== t) { n.textContent = t; if (n === road) fitRoad(); } }; // W40 flight: the ETA through fitFoot

  /** W60 b: the card's foot, "To Davis" or "To the start: The Pear", in the Words mode's names. */
  const toLine = () => { if (nav.place) toEl.textContent = nav.start ? `To the start: ${mainName(lingo, nav.start.place.kind, placeName(nav.start.place))}` : `To ${mainName(lingo, nav.place.kind, placeName(nav.place))}`; }; // W60 b
  /** W60 b: the touchdown's banner: "Touchdown: Davis Constellation"; Plain, "Arrived: Davis Square". */
  const arrivedText = (place) => pickWords(`Touchdown: ${place.lingo_name}`, `Arrived: ${placeName(place)}`); // W60 b
  /** A course for this flight: on the chart, the turn card, and the event engine on it. */
  /** W25 course: `start`, a From the course leads to first; `viaStart`, the route goes through it (its first via), else
   *  it begins there. `via`: the stops. */
  function engage({ route: r, place, style, via = [], cf = null, fresh = false, start = null, viaStart = false, file = false }) { // W107 fixes: file, a course from a route file
    if (style === "foot") r = { ...r, stops: [] }; // W86 stops: a stop sign is a rider's, never called on a walk: not its line, its turn's call, nor its row
    kept = { route: r, place, style, via, start, viaStart, file }; // W28 resume; W107 fixes: file
    anchoragesNeed(); // W102 trim: the pad's racks, for the approach and the arrival
    const feature = toCourse(lingo, r, { id: "set-course", title: `Course to ${place.lingo_name}` });
    if (style === "foot") feature.properties.lanes = []; // W93 busstop: a walk's course rides no bike lane, so no bus stop is called
    const pad = feature.properties.instructions.find((i) => i.turn === "arrive");
    if (pad) pad.side = padSide(r.geometry, place.lonlat); // W31 navvoice: "Landing pad ahead, to port."
    const at_m = start && viaStart ? r.via_m?.[0] ?? 0 : 0;
    nav.start = start ? { place: start, at_m, via: viaStart } : null; // W25 course: course.to-start until it is reached
    nav.viaM = (viaStart ? r.via_m?.slice(1) : r.via_m) || [];
    nav.cf = cf || new CourseFlight(feature, { gate, after_m: at_m, pace: style === "foot" ? 1 : pace(), foot: style === "foot" }); // W59 pace; W79 walkgo: a walk, the walker's numbers (course-logic.js FOOT) at the plan's pace
    nav.place = place;
    nav.style = style;
    nav.route = r;
    nav.via = via; // W21 routes
    nav.file = file; // W107 fixes: a re-plot keeps a route file's course on day's costs
    const old = courseEngine || freeEngine();
    courseEngine = new EventEngine(nav.cf.course, lingo, world, (e) => fire(e.kind === "touchdown" ? { ...e, text: arrivedText(place) }
      : (e.kind === "pulsar_ahead" && e.voice && turnNear(e.data.lonlat)) || (e.kind === "stop_ahead" && e.voice && stopTurn(e.data.lonlat)) || (e.kind === "bus_stop_ahead" && e.voice && turnNear(e.data.lonlat)) ? { ...e, voice: "", data: { ...e.data, folded: true } } : e), { mode: lingoMode }); // W86 stops: stopTurn; W93 busstop: a bus stop at a turn, its pill only // W31 navvoice: the turn's call says it; W60 b: arrivedText, and the mode, read at every line
    courseEngine.resume(nav.cf.s); // where we are, without saying it again
    courseEngine.lastLY = Infinity; // the light years are the flight's, not the course's: the live engine counts them
    courseEngine.announced.set("touchdown", 0); // touchdown is said below, at 30 m from the pad itself
    warns = warnings(r).map((w) => ({ ...w, ll: nav.cf.course.pointAt(w.at_m) })); // W54 flight
    warnSaid = new Set(warns.filter((w) => warnAt.some((p) => metres(p, w.ll) <= 30))); // W54 flight: a re-plot says none twice
    if (old) courseEngine.carry(old, nav.cf.s); // W21 flight: where we are and what was said, so a re-plot calls nothing twice
    if (fresh) { startS = nav.flownS; startT = performance.now(); spell = new OffSpell(); approached = ""; } // a re-plot or an Undo keeps the course's start; W56 parking: approached
    drawCourse(r.geometry, null, false, r.walk, r); // W59 routes: r
    progress(nav.cf.s);
    ui.dest?.remove();
    ui.dest = pinMarker(place.lonlat, "dest"); // the landing pad, as the preview showed it
    toLine(); // W25 course; W60 b: toLine
    fitFoot(); // W40 flight
    card.classList.remove("off");
    showCard(flight.flying);
    tick();
  }
  function clear() {
    if (nav.leg?.n === 0) gap(false); // W62 cometcard: the Log counts again
    nav.leg = null; card.classList.remove("board", "tall"); // W62 cometcard
    nav.cf = null;
    warns = []; warnAt = []; // W54 flight
    kept = null; // W28 resume
    spell = new OffSpell(); // W21 flight
    courseEngine = null;
    showCard(false);
    showAnchors(null); // W54 flight
    drawCourse(null);
    ui.dest?.remove();
    ui.dest = null;
  }
  function cancel() {
    if (nav.leg?.walk) gait("ride"); // W79 walkgo: a walk cancelled, back on the bike (Undo, off again)
    if (nav.leg?.n === 0) { const leg = nav.leg; clear(); snack(pickWords("Course cancelled", "Route cancelled"), "", "Undo", 5000, () => { if (flight.flying && !nav.cf) { between(leg); if (leg.walk) gait("walk"); /* W79 walkgo */ } }); return; } // W62 cometcard: between the legs
    const keep = { route: nav.route, place: nav.place, style: nav.style, via: nav.via, cf: nav.cf, start: nav.start?.place, viaStart: nav.start?.via }, leg = nav.leg; // W25 course: start; W62 cometcard: leg
    clear();
    snack(pickWords("Course cancelled", "Route cancelled"), "", "Undo", 5000, () => { if (flight.flying) { engage(keep); nav.leg = leg; if (leg?.walk) gait("walk"); /* W79 walkgo */ } }); // W60 b; W62 cometcard: a comet course's leg stays one
    note("course", "cancelled"); // W48 feedback
  }
  /** W25 course: `close`, an × and a tap away on the chart close it too (Course complete, flight B2). */
  function snack(title, em, action, ms, onAction, close = false) {
    clearTimeout(ui.snackTimer);
    ui.snack?.remove();
    const s = el("div", "csnack"), t = el("div", "t", title), b = el("button"); // W73 a11y: no role="status": say() reads it
    if (ui.sheet?.classList.contains("cpreview")) s.dataset.preview = ""; // W26 peek: made over the preview, it closes with it
    t.append(elDur("em", "", em)); // W68 fixes: a duration's h and m small
    b.append(icon(action === "Undo" ? "undo" : "land"), document.createTextNode(action));
    const gone = () => { s.remove(); if (ui.snack === s) ui.snack = null; box.removeEventListener("pointerdown", gone); }; // W40 flight (F3): every way out drops the tap away
    b.onclick = () => { gone(); if (action === "Undo") pulse(); onAction(); }; // W40 flight: gone; W76 look: an Undo pulses, as Land's and the Log's
    s.append(t, b);
    if (close) {
      const x = el("button", "x");
      x.setAttribute("aria-label", "Close");
      x.append(icon("close"));
      x.onclick = gone;
      s.append(x);
      box.addEventListener("pointerdown", gone);
    }
    if (ms) { const timer = el("div", "timer"); timer.style.animationDuration = ms + "ms"; s.append(timer); ui.snackTimer = setTimeout(gone, ms); } // W40 flight: gone
    const sr = ui.sheet?.getBoundingClientRect(); // W21 routes: clear of the preview, above it or beside it
    if (sr) Object.assign(s.style, sr.top > 60 ? { bottom: `${innerHeight - sr.top + 10}px`, zIndex: 6 } : { left: `${sr.right + 10}px`, zIndex: 6 });
    document.body.append(s);
    say(t.textContent); // W73 a11y
    ui.snack = s;
  }
  function pill(cls, glyph, text) {
    const b = el("div", `bpill ${cls}`);
    b.append(glyphImg(glyph, 30), el("span", "t", text));
    b.querySelector("img").className = "glyph";
    pills.push(b);
  }
  /** W31 navvoice (the nav audit's #3): a pulsar within 40 m of a turn is said in the turn's call ("At the pulsar, turn to
   *  port."), and its own "Pulsar ahead." is not said, so it never cuts the call short. Pulsars elsewhere are said first, as ever. */
  const PULSAR_M = 40;
  const pulsarAt = (ins) => !!ins.at && ins.turn !== "arrive" && world.features("pois", ["pulsar"], ins.at, PULSAR_M).length > 0;
  const turnNear = (ll) => !!nav.cf && !!ll && nav.cf.feature.properties.instructions.some((i) => i.turn !== "arrive" && i.at
    && i.along_m > nav.cf.s - 10 && i.along_m < nav.cf.s + 400 && metres(i.at, ll) <= PULSAR_M);
  /** W86 stops: a stop sign on the course (the router's `stops`, by the approach each faces) in the PULSAR_M before a turn is
   *  said in its call, "At the stop sign, turn to port.", as a pulsar is, and its own "Stop sign ahead." is not. */
  const stopBefore = (m, ins) => ins.turn !== "arrive" && m <= ins.along_m + 5 && m >= ins.along_m - PULSAR_M; // W86 stops
  const stopAt = (ins, r = nav.route) => (r?.stops || []).some(([m]) => stopBefore(m, ins)); // W86 stops
  const stopTurn = (ll) => { const st = ll && nav.cf && nav.route?.stops?.find(([, lon, lat]) => lon === ll[0] && lat === ll[1]); // W86 stops
    return !!st && nav.cf.feature.properties.instructions.some((i) => i.along_m > nav.cf.s - 10 && i.along_m < nav.cf.s + 400 && stopBefore(st[0], i)); }; // W86 stops
  const moveOnto = (ins, mode = lingoMode()) => cardWords(ins, ins.road ? roadName(lingo, ins.road, mode) : null, mode); // W56 reroute: a turn on the card, "Port onto Starpath Beech" (W31 navvoice); W60 b: in the mode, "Left onto Beech Street"
  const sayTurn = (voice, data = {}, text = voice.replace(/\.$/, "")) => { fire({ kind: "course_turn", text, voice, data }); }; // W28 settings: Sound decides; W31 navvoice: the banner's own words

  function onFix(f) {
    if (nav.leg?.n === 0) { if (flight.flying && nearLeave(nav.leg.legs, f.lonlat)) legTwo(); return; } // W62 cometcard: between the legs, no re-plot; leg 2 near the leaving station
    if (!nav.cf || !flight.flying) return;
    const t = Number.isFinite(f.t) ? f.t : performance.now(), cf = nav.cf, wasOff = cf.last?.off, wasBack = cf.last?.back; // W73 flight: wasBack
    // W31 navvoice: the way the ship is going: the fix's own course, else the way from the last fix 3 m or more back
    if (Number.isFinite(f.course_deg) && f.speed_mps >= 1) travel = f.course_deg;
    else if (prevFix && metres(prevFix, f.lonlat) >= 3) travel = bearing(prevFix, f.lonlat);
    if (!prevFix || metres(prevFix, f.lonlat) >= 3) prevFix = f.lonlat;
    const r = cf.fix({ lonlat: f.lonlat, heading: f.course_deg ?? null, speed_mps: f.speed_mps || 0, accuracy_m: f.accuracy_m ?? null }, t); // W31 navvoice: accuracy_m
    const sp = spell.update(cf, r); // W21 flight
    if (!r.off) replotFailed = false; // W31 navvoice
    for (const q of sp.quiet ? [] : r.prompts) {
      const p = { ...q, pulsar: pulsarAt(q.ins), stop: stopAt(q.ins) }; // W31 navvoice: a pulsar at the turn is said in its call; W86 stops: a stop sign too
      const m = lingoMode(); // W60 b: the Words mode's words and clips
      sayTurn(promptLine(p, r.s, m), { turn: p.ins.turn, exit: p.ins.exit, road: p.ins.road, at_m: p.ins.along_m, stage: p.stage, // W60 b: m
        then: p.then?.turn ?? null, along_m: Math.round(r.s) }, promptText(p, r.s, m)); // W60 b: m
    }
    const w = r.off || sp.quiet ? null : warnDue(warns, r.s, f.speed_mps, warnSaid); // W54 flight: steps and steep parts ahead
    if (w) { warnSaid.add(w); warnAt.push(w.ll); sayWarn(w, r.s); } // W54 flight
    if (r.back && !wasBack) { pill("course", "maneuver/come_about", "Turn around"); sayTurn(callLine("turn_around", lingoMode()), { stage: "now", turn: "turn_around", along_m: Math.round(r.s) }); } // W73 flight: riding the course backwards, once a ride back (W72 ride F3)
    if (wasOff && !r.off && headsUp === cf && !replotting) { headsUp = null; nav.backs = (nav.backs || 0) + 1; backOnCourse(map); } // W73 delight: back on course with no re-plot
    if (r.off && !wasOff && !f.estimated) { tick(); if (sp.say) { nav.offs++; headsUp = cf; /* W73 delight */ haptic("off"); /* W76 look: once a spell, with Buzz the turns on (app/haptics.js) */ pill("off", "maneuver/off_course", pickWords("Off course", "Off route")); sayTurn(callLine("off_course", lingoMode()), { stage: "now", turn: "off_course" }); } } /* W60 b: callLine */ // shown at once, while the re-plot runs; said once a spell (W21 flight); W56 reroute: a heads-up, with its pill
    if (nav.start && ((r.d <= REACHED_M && r.s >= nav.start.at_m - REACHED_M) || metres(f.lonlat, nav.start.place.lonlat) <= REACHED_M)) { // W25 course: at From, or on the course past it
      nav.start = null;
      toLine(); // W60 b
      fitFoot(); // W40 flight
      pill("course", "waypoint", pickWords("Course start", "Route start")); // W60 b
    }
    if (r.phase === "touchdown") return touchdown();
    if (nav.leg?.n === 1 && ((r.left <= REACHED_M && r.d <= REACHED_M) || nearLeave(nav.leg.legs, f.lonlat))) { if (nearLeave(nav.leg.legs, f.lonlat)) nav.leg.skip = true; return touchdown(); } // W62 cometcard: leg 1 lands at its course's end, the entrance a short walk on; a fix that comes back at the leaving station, for one never seen at the entrance
    if (r.replot && !replotting && !f.estimated) replot(f, t); // W31 navvoice: never from W31 navview's estimate in a GPS gap
    progress(r.s); // the card follows at its own four times a second
  }
  /** W54 flight (SPEC §70): steps ahead, "Steps ahead."; W67 graph3 (SPEC §95): "Space junk ahead.", "Comet tracks ahead."; a climb of 6 % or more, "Negi g-well ahead.", unless the course's
   *  engine said one in the last 400 m (and then it waits 400 m, so the two never say one hill twice). */
  function sayWarn(w, s) { // W54 flight
    const data = { ahead_m: Math.max(0, Math.round(w.at_m - s)), along_m: Math.round(s), warn: w.warn, length_m: Math.round(w.to_m - w.at_m) }; // W54 flight
    if (w.warn === "steps") return fire({ kind: "steps_ahead", text: "Steps ahead", voice: callLine("steps_ahead", lingoMode()), data }); // W54 flight; W60 b: callLine
    if (w.warn === "junk") return fire({ kind: "space_junk", text: pickWords("Space junk ahead", "Barrier ahead"), voice: callLine("space_junk", lingoMode()), data }); // W67 graph3
    if (w.warn === "tracks") return fire({ kind: "tracks_ahead", text: pickWords("Comet tracks ahead", "Tracks ahead"), voice: callLine("tracks_ahead", lingoMode()), data }); // W67 graph3
    if (courseEngine && courseEngine.nextGwellCheck > s) return; // W54 flight
    if (courseEngine) courseEngine.nextGwellCheck = s + 400; // W54 flight
    fire({ kind: "negi_g_well", text: pickWords(`Negi g-well ahead · ${w.grade} %`, `Steep climb ahead · ${w.grade} %`), voice: callLine("negi_g_well", lingoMode()), data: { ...data, grade_pct: w.grade, chevron: "▲" } }); // W54 flight; W60 b
  }
  /** W31 navvoice: from the ship, setting out the way it is going (the router's `heading`); "New course." once a spell. A
   *  route that fails or takes over `REPLOT_WAIT_MS` is tried again 3 s on (ReplotGate.retry), and the card says so. */
  async function replot(f, t) {
    replotting = true;
    const from = f.lonlat;
    const { place, style, cf } = nav, via = viasAhead(nav.via, nav.viaM, cf.s), start = nav.start?.place; // W21 routes: the vias still ahead
    const heading = travel, t0 = performance.now();
    const miss = cf.missed(from), about = heading != null && !!miss && miss.back_m <= ABOUT_M; // W56 reroute: a turn just missed may be ridden back to
    tick(); // W56 reroute: Re-plotting…, now the grace is over
    let timer;
    try {
      const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error("no answer")), REPLOT_WAIT_MS); });
      const r = await Promise.race([style === "foot" ? walk().route(from, place.lonlat) : route(from, place.lonlat, style, start ? [start.lonlat, ...via] : via, null, heading, about, nav.file ? false : null), late]); // W107 fixes: a file's course by day's costs after dark, so it keeps to the file between its vias; W25 course: off on the way to From, to From; W56 reroute: about; W79 walkgo: off a walk, walked again to the plan's stop
      if (nav.cf !== cf) return;
      if (!r) throw new Error("no route");
      replotFailed = false;
      engage({ route: r, place, style, via, start, viaStart: !!start, file: nav.file }); // W107 fixes: file
      nav.replots++;
      chime("reroute"); // W73 delight: a re-plot lands
      note("course", "re-plot"); // W48 feedback
      const g = r.geometry; // the way it sets out, over its first 10 m
      let k = 1;
      while (k < g.length - 1 && metres(g[0], g[k]) < 10) k++;
      const sets = g.length > 1 ? bearing(g[0], g[k]) : null;
      nav.lastReplot = { heading, sets, ms: Math.round(performance.now() - t0), about: !!r.about, asked: about }; // for tests; W56 reroute: about, asked
      if (r.about) { pill("course", "maneuver/come_about", "Turn around"); sayTurn(callLine("turn_around", lingoMode()), { stage: "now", turn: "turn_around" }); spell.pill(); } // W60 b: callLine // W56 reroute: back to the turn just missed, said plainly
      else if (spell.pill()) { pill("course", "waypoint", pickWords("New course", "New route")); sayTurn(callLine("new_course", lingoMode()), { stage: "now", turn: "new_course" }); } // W60 b // W21 flight: one a spell; W31 navvoice: said, in the pill's words; W56 reroute: else
      replotting = false;
      onFix(f); // W31 navvoice (#6): the card shows the new course's next turn at once, and a near one is said
    } catch (err) {
      console.warn("re-plot:", err.message);
      if (nav.cf === cf) { replotFailed = true; gate.retry(t); tick(); }
    } finally { clearTimeout(timer); replotting = false; if (avoidAgain) { avoidAgain = false; setTimeout(replanAvoid, 0); } } // W73 avoid: avoidAgain
  }
  /** W31 navvoice (the nav audit's #12): the turn ahead, said again: the distance now, then the move; off course, "Off course.". */
  function repeatTurn() {
    const cf = nav.cf, r = cf?.last;
    if (!cf || !r || !flight.flying) return;
    if (r.off) return sayTurn(callLine("off_course", lingoMode()), { stage: "now", turn: "off_course", again: true }); // W60 b
    const ins = cf.prompter.list.find((i) => i.along_m > r.s + 5);
    if (!ins) return;
    const near = ins.turn === "arrive" ? ins.walk && ins.along_m - r.s <= 45 : distanceWords(ins.along_m - r.s) === "Now"; // W42 leftovers: far out, the distance too
    const p = { ins, stage: near ? "now" : "prepare", then: null, pulsar: pulsarAt(ins), stop: stopAt(ins) }; // W86 stops: stop
    sayTurn(promptLine(p, r.s, lingoMode()), { turn: ins.turn, exit: ins.exit, road: ins.road, at_m: ins.along_m, stage: "now", then: null, along_m: Math.round(r.s), again: true }, // W60 b
      promptText(p, r.s, lingoMode())); // W60 b
  }
  function touchdown() {
    if (nav.leg?.n === 1) { reached(); const leg = nav.leg; clear(); between(leg, leg.skip); if (leg.skip) legTwo(); return; } // W62 cometcard: leg 1 lands at the station (skip: already off the train)
    const trip = nav.leg?.walk ? nav.leg : null; // W79 walkgo: a walk's whole trip, in miles in both modes
    const place = nav.place, ly = (nav.flownS - (trip?.s0 ?? startS)) / LY, min = Math.max(1, Math.round(earthMs(performance.now() - (trip?.t0 ?? startT)) / 60000)); // W79 walkgo: trip
    reached(); // W59 pace: the course flown, for the Log's planned against flown
    clear();
    if (!trip) { showAnchors(place, true); anchorsAfter = performance.now() + 10000; } // W54 flight: beside "Course complete", for its 10 s; W79 walkgo: none for a walk
    fire({ kind: "touchdown", text: arrivedText(place), voice: callLine("touchdown", lingoMode()), data: { name: place.lingo_name } }); // W60 b
    snack(trip ? pickWords(WALKW.done) : pickWords("Course complete", "Arrived"), `${ly.toFixed(1)} ${trip ? "mi" : pickWords("LY", "mi")} · ${dur(min)}`, /* W79 walkgo: trip */ pickWords("Land", "End"), 10000, /* W60 b */ () => document.getElementById("land")?.click(), true); // W25 course: 10 s, an × and a tap away (flight B2) // W68 fixes: dur
  }

  /** W62 cometcard: between a comet course's legs: the train leg and the ride after it on the chart, and the landing card,
   *  "Board the Red Line comet at Alewife toward Braintree. 15 stops.", with the train's time where the distance goes. A
   *  banner carries the words (no new spoken line until arclight's veto). The Log has a gap (`gap`); the re-plot holds. */
  function between(leg, quiet = false) { // W62 cometcard: quiet, a switch of Words
    if (leg.walk) return walkBoard(leg, quiet); // W79 walkgo
    nav.leg = { ...leg, n: 0 }; // W62 cometcard
    gap(true); // W62 cometcard
    drawCourse(leg.legs.ride1.geometry); // W62 cometcard: the ride ahead
    map.getSource("course-comet")?.setData(trainLines(leg.plan)); // W62 cometcard
    const t = leg.legs.trains[0], text = boardText(leg.plan); // W62 cometcard
    arrow.src = at("design/glyphs/comet_station.svg"); arrowFileShown = ""; // W62 cometcard
    put(dist, clockAt(new Date(t.dep))); put(road, text); // W62 cometcard
    toEl.textContent = pickWords(COMET.leave(leg.legs.leave.name)); put(etaEl, pickWords(COMET.tapOn)); nav.board = text; // W62 cometcard: nav.board, for tests
    card.classList.remove("off"); card.classList.add("board"); // W62 cometcard
    showCard(flight.flying); fitBoard(); // W62 cometcard
    if (!quiet) fire({ kind: "course_turn", text, voice: "", data: { stage: "now", turn: "board", route: t.route } }); // W62 cometcard: the banner, silent
  } // W62 cometcard
  /** W62 cometcard: the landing card takes a third line, and grows for it, only where two can't hold its words (320 px). */
  function fitBoard() { // W62 cometcard
    if (!card.classList.contains("board")) return; // W62 cometcard
    card.classList.remove("tall"); fitRoad(); // W62 cometcard
    if (road.scrollHeight > road.clientHeight + 1) card.classList.add("tall"); // W62 cometcard
    if (!card.hidden) document.documentElement.style.setProperty("--card-h", cardH()); // W62 cometcard
  } // W62 cometcard
  addEventListener("resize", fitBoard); // W62 cometcard: as the phone turns
  /** W62 cometcard: leg 2, from the leaving station's entrance to the landing pad, as an ordinary course. */
  async function legTwo() { // W62 cometcard
    const leg = nav.leg; // W62 cometcard
    if (leg?.walk && leg.n === 0) return walkLeave(leg); // W79 walkgo: near the stop, or a tap: off, and on to the next leg
    if (!leg || leg.n !== 0) return; // W62 cometcard
    leg.n = 2; // W62 cometcard: once
    const r = await route(leg.legs.leave.lonlat, leg.place.lonlat, "quickest").catch(() => null); // W62 cometcard
    if (nav.leg !== leg) return; // W62 cometcard: cancelled, or landed, meanwhile
    if (!r) { leg.n = 0; return tip(card, "No route yet · trying again"); } // W62 cometcard: the next fix or tap tries again
    gap(false); card.classList.remove("board", "tall"); // W62 cometcard
    engage({ route: r, place: leg.place, style: "quickest", fresh: true }); // W62 cometcard
    planned(r.time_s); // W62 cometcard: W59 pace: the ride alone, apart from the train
    const f = lastFix(); if (f) { onFix(f); tick(); } // W62 cometcard
  } // W62 cometcard
  // W79 walkgo (SPEC §148): a walker's plan in flight. `nav.leg` as a comet course's (W62), with `walk`, the plan and `i`, its
  // leg: n 1 walks to a stop, n 0 rides (the landing card), n 2 walks to the door; a change by a second ride is a second card.
  const gait = (g) => globalThis.starchart?.ship?.setGait?.(g); // W79 walkgo: W79 walker's person on foot, where it is in
  let afootTrip = false; // W79 walkgo: a walk launched, until Land
  /** W79 walkgo: the leg after `leg.i`: a ride, its landing card; a walk, a course on foot from `from` (else the leg's start) to
   *  the next ride's stop or the door. */
  async function walkOn(leg, from = null) { // W79 walkgo
    const p = leg.plan, k = nextLeg(p, leg.i), l = p.legs[k]; // W79 walkgo
    if (!l) return; // W79 walkgo
    leg.i = k; // W79 walkgo
    if (l.type === "train") return between(leg); // W79 walkgo: a change in the station, the next ride's card
    const to = stopPlace(p, k) || leg.place, t = p.legs[nextLeg(p, k)]; // W79 walkgo
    leg.n = t ? 1 : 2; leg.legs = { leave: t ? { lonlat: t.path.at(-1), name: t.to_name } : { lonlat: to.lonlat, name: "" } }; // W79 walkgo: nearLeave's stop, for a walker seen first off the ride
    const r = await walk().route(from || l.geometry[0], to.lonlat).catch(() => null); // W79 walkgo
    if (nav.leg !== leg) return; // W79 walkgo: cancelled, or landed, meanwhile
    if (!r) return tip(card, "No route yet"); // W79 walkgo: the graph went away; the walk goes on with no course
    engage({ route: r, place: to, style: "foot", fresh: true }); // W79 walkgo
    const f = lastFix(); if (f) { onFix(f); tick(); } // W79 walkgo
  } // W79 walkgo
  /** W79 walkgo: on the ride: its line and the rest of the plan on the chart, and the landing card, "Board the Red Line comet at
   *  Central toward Alewife. 3 stops." (a change: "Change to …"), its departure where the distance goes; a banner, silent. */
  function walkBoard(leg, quiet) { // W79 walkgo
    const p = leg.plan, i = p.legs[leg.i].type === "train" ? leg.i : nextLeg(p, leg.i), t = p.legs[i]; // W79 walkgo
    const change = p.legs.slice(0, i).filter((l) => l.type !== "wait").at(-1)?.type === "train", text = pickWords(WALKW.board(t, change)); // W79 walkgo
    nav.leg = { ...leg, i, n: 0, legs: { leave: { lonlat: t.path.at(-1), name: t.to_name } } }; // W79 walkgo
    drawCourse(null); const rest = { legs: p.legs.slice(i) }; map.getSource("course-walk")?.setData(walkLegs(rest)); map.getSource("course-comet")?.setData(trainLines(rest)); // W79 walkgo: the ride and what's after it
    arrow.src = at(`design/glyphs/${t.mode === "bus" ? "sandworm_nest" : "comet_station"}.svg`); arrowFileShown = ""; // W79 walkgo
    put(dist, clockAt(new Date(t.dep))); put(road, text); // W79 walkgo
    toEl.textContent = pickWords(WALKW.leave(t)); put(etaEl, pickWords(WALKW.tapOn)); nav.board = text; // W79 walkgo
    card.classList.remove("off"); card.classList.add("board"); // W79 walkgo
    showCard(flight.flying); fitBoard(); // W79 walkgo
    if (!quiet) fire({ kind: "course_turn", text, voice: "", data: { stage: "now", turn: "board", route: t.route } }); // W79 walkgo: no new spoken line until his veto
  } // W79 walkgo
  /** W79 walkgo: off the ride near its stop (or a tap on the card): "Leave the comet here", silent, and on to the next leg. */
  function walkLeave(leg) { // W79 walkgo
    const t = leg.plan.legs[leg.i]; // W79 walkgo
    leg.n = 3; card.classList.remove("board", "tall"); // W79 walkgo: once
    fire({ kind: "course_turn", text: pickWords(WALKW.leaveNow(t)), voice: "", data: { stage: "now", turn: "leave", route: t.route } }); // W79 walkgo
    walkOn(leg); // W79 walkgo
  } // W79 walkgo
  /** The card, four times a second at most. Arriving doesn't land the flight. */
  function tick() {
    const foot = nav.style === "foot", mi = (m) => distLabel(m, foot ? "meatspace" : undefined), etaMi = (m, v) => (nav.leg ? etaLine(m, v, undefined, foot) : leftLine(m, foot)); // W79 walkgo: a walk reads miles in both modes; W86 ride: on a course the readout has the arrival and the time left, so the foot only the distance (no doubled text)
    const cf = nav.cf, r = cf?.last;
    if (!cf) return;
    if (!flight.flying) { showCard(false); return; }
    if (card.hidden) showCard(true);
    if (!r) { setArrow(arrowFile(cf.feature.properties.instructions[0])); put(dist, mi(cf.length)); put(road, placeName(nav.place)); /* W60 b */ put(etaEl, etaMi(cf.length, cf.speed())); return; } // W79 walkgo: mi
    card.classList.toggle("off", r.off);
    if (r.off) {
      // W25 course: something to steer by while it re-plots (flight B3): how far the landing pad is, and which way
      const here = lastFix()?.lonlat ?? near();
      showKeep(r.grace && !replotting, true); // W74 course
      const miss = (r.grace || r.kept) && !replotting ? cf.missed(here) : null; // W56 reroute: in the grace, the turn missed; W74 course: and kept
      setArrow("off_course"); put(dist, mi(miss ? miss.back_m : metres(here, cf.end))); put(road, miss ? `Missed: ${moveOnto(miss.ins)}` : pickWords(`Off course · pad ${compassWord(bearing(here, cf.end))}`, `Off route · destination ${compassWord(bearing(here, cf.end))}`)); /* W60 b */ // W56 reroute: miss // W79 walkgo: mi
      put(etaEl, r.kept ? etaMi(r.left, cf.speed()) /* W74 course */ : r.grace && !replotting ? pickWords(`New course in ${r.wait_s} s`, `New route in ${r.wait_s} s`) : replotFailed && !replotting ? "No route yet · trying again" : pickWords("Re-plotting…", "Rerouting…")); // W60 b // W31 navvoice: never stuck on it; W56 reroute: the grace // W79 walkgo: mi
      return;
    }
    showKeep(false, false); // W74 course
    if (Math.min(r.left, r.toPad) <= APPROACH_M && !foot) approach(nav.place); // W56 parking; W79 walkgo: a walker parks no bike
    const ins = cf.feature.properties.instructions.find((i) => i.along_m > r.s + 5 && i.turn !== "arrive");
    if (ins && /\b(port|starboard)\b/i.test(cardMove(ins, lingoMode()))) tipOnce("port", card, PORT_TIP, { flight: true }); // W56 reroute: the first port or starboard on the card; W60 b: in the mode, never in Plain
    if (r.phase === "arrive" || !ins) {
      const across = cf.feature.properties.instructions.at(-1)?.walk_m >= WALK_SAY_M; // W32 routing: the course stops across the street
      const side = cf.prompter.list.at(-1).side, name = `${across ? "Walk across" : pickWords("Landing pad", "Destination")}: ${mainName(lingo, nav.place.kind, placeName(nav.place))}`; // W31 navvoice: its side; W60 b
      setArrow("arrive"); put(dist, mi(Math.min(r.left, r.toPad))); put(road, side === "port" ? `◀ ${name}` : side === "starboard" ? `${name} ▶` : name); // W79 walkgo: mi
      if (r.phase === "arrive" && !foot) showAnchors(nav.place); // W54 flight; W79 walkgo: !foot
    } else {
      if (!anchorBtn.hidden) showAnchors(null); // W54 flight
      const back = r.back || (nav.route?.about && r.s <= ABOUT_M && travel != null && angleBetween(travel, bearing(cf.course.pointAt(r.s), cf.course.pointAt(Math.min(cf.length, r.s + 15)))) > 90); // W56 reroute: still facing away from it; W73 flight: r.back, riding the course backwards
      setArrow(back ? "come_about" : arrowFile(ins)); put(dist, mi(ins.along_m - r.s)); // W56 reroute: back // W79 walkgo: mi
      put(road, back ? `Turn around, then ${moveOnto(ins).replace(/^./, (c) => c.toLowerCase())}` : moveOnto(ins)); // W31 navvoice: port and starboard; W56 reroute: moveOnto, and back
    }
    put(etaEl, etaMi(r.left, cf.speed())); // W79 walkgo: mi
  }
  /** W74 course (SPEC §128, D7): in the off-course heads-up's grace the card's foot is Keep course, 56 px tall: a tap keeps
   *  this course for the spell off it (no re-plot; the card still shows the way back), and the foot is the To line again. */
  let footAs = "turns"; // W74 course: the foot as turns.js unfold made it, Keep course, or off course no button
  function showKeep(on, off) { // W74 course
    if (on && toEl.textContent !== pickWords(...KEEP)) { toEl.textContent = pickWords(...KEEP); foot.setAttribute("aria-label", pickWords(...KEEP)); fitFoot(); } // W74 course: in the mode, live
    const as = on ? "keep" : off ? "off" : "turns", was = footAs; // W74 course
    if (as === was) return; // W74 course
    footAs = as; // W74 course
    card.classList.toggle("keep", on); // W74 course
    if (as === "off") { foot.removeAttribute("role"); foot.removeAttribute("tabindex"); foot.removeAttribute("aria-label"); } // W74 course: off course nothing to unfold (turns.js shows no turns off it): not a button, its tap the card's
    else { foot.setAttribute("role", "button"); foot.tabIndex = 0; } // W74 course
    if (as === "turns") { foot.setAttribute("aria-label", "Turns ahead"); foot.setAttribute("aria-expanded", "false"); } // W74 course: turns.js unfold's label
    else foot.removeAttribute("aria-expanded"); // W74 course: a plain button while it is Keep course
    if (was === "keep") toLine(); // W74 course
    if ((was === "keep" || on) && !card.hidden) document.documentElement.style.setProperty("--card-h", cardH()); // W74 course
  } // W74 course
  function keepCourse() { // W74 course
    if (!nav.cf?.keep()) return; // W74 course
    note("course", "keep course"); // W74 course: W48 feedback's log
    tick(); // W74 course
  } // W74 course
  pose.on("fix", onFix);
  function beat() { // W77 rest: four times a second, from main.js's readout timer (hud), so it sleeps with a still chart
    const hide = flight.flying || !searchEntry; // W28 launch: landed (the Undo window) is the parked chart: the bar keeps Where to?, and a tap on it makes the landing final
    if (field.hidden !== hide) field.hidden = hide; // no mutation four times a second in flight
    lineLook(); // W31 navview: a preview opened or closed, a Land
    if (anchorsAfter && (performance.now() > anchorsAfter || nav.cf)) { anchorsAfter = 0; if (!nav.cf) showAnchors(null); } // W54 flight
    if (nav.leg?.n === 0) { if (flight.state === "parked") clear(); else showCard(flight.flying); } // W62 cometcard: between the legs, as a course
    if (!nav.cf) return;
    if (flight.state === "parked") clear(); // the Undo window closed after Land: the course goes with the flight
    else { tick(); thenTick(); fly.tick(); } // W31 navview: thenTick; W53 turns: fly.tick
  } // W77 rest: was its own setInterval, 250 ms

  let kept = null; // W28 resume: the course as engage() last had it
  const nav = {
    cf: null, place: null, style: null, route: null, via: [], replots: 0, offs: 0, flownS: 0, drawn: 0, lines: [], dragLog: [],
    turnIn: null, // W31 navview: in flight, the metres to the next turn (markTurn)
    get warns() { return warns; }, // W54 flight: for tests
    get active() { return !!nav.cf; },
    /** W47 firstload: the search's index while it loads (a pilot typing on a first open), else null; main.js's big downloads wait for it. */
    searchLoading: () => (searchP && !searchIn ? searchP.catch(() => {}) : null),
    /** main.js, at each step of the flight: the planned course's engine instead of the live one. False: no course. */
    moments(sFlown) {
      nav.flownS = sFlown;
      if (!nav.cf || !courseEngine) return false;
      const live = freeEngine();
      if (live) { // the live engine keeps its place, silently, and only its light years are said
        const n = live.history.length;
        live.silent = true;
        try { live.update(sFlown); } finally { live.silent = false; }
        for (const e of live.history.slice(n)) if (e.kind === "light_year") live.emit(e);
      }
      courseEngine.update(nav.cf.s);
      return true;
    },
    fix: onFix,
    beat, // W77 rest
    search, plot: route, pinAt, preview, // W73 flight: the router as plot(), apart from the course's route (with two route keys, route() was no function after a Launch)
    openRoute, openFile, // W67 routefile: a line (a flight's trail, app/log.js's Fly again) or a file, as a course
    routerReady, // W61 transit: the routing worker, for starchart.transit (app/transit.js)
    get router() { return routerKind; }, // W88 feedbackinfo
    /** W54 course: a shared course's link (its hash): that course's preview, plotted on this phone's graph through the same
     *  stops, its style the sender's. False: not a course. */
    /** W67 places: a #pin= link: its pin, in view, with its peek. False: not a pin. */
    async openPin(hash) { const p = parsePin(hash); if (!p) return false; await showPin(p.lonlat, p.name); return true; }, // W67 places
    /** W67 places: shared text (title, text and url, joined; the routefile lane's share_target hands it over): a link or
     *  coordinates drop their pin; a name, or a short link, goes to Where to?, which finds the name or says why. False:
     *  neither a link nor coordinates. */
    openText(text) { const link = parseLink(text, (p) => onChart(p)); if (!link) { const q = String(text).trim(); if (!q || q.length > 120 || q.includes("\n")) return false; // W67 merge: a few shared words are a search; W73 plan: onChart, for coordinates written longitude first
      input.focus(); input.value = q; showResults(); return true; } if (link.lonlat) { showPin(link.lonlat, link.name || "", link.zoom); return true; } // W67 places
      input.focus(); input.value = link.name || String(text).trim(); showResults(); return true; }, // W67 places
    get starred() { return starred(); }, // W67 places: for tests
    async openLink(hash) { // W54 course
      const c = parseCourse(hash); // W54 course
      if (!c) return false; // W54 course
      if (c.tooMany) { tip(input, pickWords(TOO_MANY), { ms: 6000 }); return true; } // W73 plan: says why nothing opens
      world.ready(c.from, 120); world.ready(c.to, 120); // W73 plan: asks for the ends' roads, else idle() has nothing to wait for and they are "Waypoint"
      await Promise.race([world.idle(), new Promise((r) => setTimeout(r, 2000))]); // W54 course: the roads, to name the ends
      const end = (ll) => (metres(ll, FORT.lonlat) <= 40 ? { ...FORT, lonlat: ll } : placeAt(ll)); // W54 course: the Fort by its name, at the link's own point
      routerReady().catch(() => {}); // W54 course
      preview(end(c.to), c.via, end(c.from), { style: c.style, other: graphDiffers(c.graph, graphEntry?.sha256), avoid: c.avoid || [] }); // W54 course; W73 avoid: its streets
      return true; // W54 course
    }, // W54 course
    /** W40 flight (F2): main.js, at Land: a sheet opened in flight goes, as its Fly it would launch a new flight; the chart
     *  stays where Land puts it. */
    landed() { if (ui.sheet && document.body.classList.contains("csheet-fly")) { ui.view = null; framing(false); closeSheet(false); } if (afootTrip) { afootTrip = false; gait("ride"); } }, // W79 walkgo: Land, back on the bike
    /** W104 oss2 fix pass 2: main.js, at Launch: a search's lit places go out, and the camera is Launch's. */
    launched() { unlightFound(true); }, // W104 oss2 fix pass 2
    /** W104 oss2 fix pass 2: main.js, the camera's mode changed (Locate, the Chart tab): while the places are lit, the pilot moved the chart. */
    moded() { if (ui.foundView) ui.foundMoved = true; }, // W104 oss2 fix pass 2
    undone() { if (nav.leg?.walk) { afootTrip = true; gait("walk"); } }, // W79 walkgo: main.js, Undo of Land mid-walk: on foot again
    // W28 resume (app/resume.js): the course in flight to keep, and back again in a new page; parked, the preview or the
    // search that is open, and back again (From "you" is worked out again, from the ship as it is then)
    get kept() { return kept && nav.cf ? { ...kept, s: nav.cf.s } : null; },
    restore(c) { engage({ ...c, fresh: true }); nav.cf.s = c.s || 0; },
    get open() { return { plan: ui.plan && ui.sheet?.classList.contains("cpreview") ? { ...ui.plan, via: ui.vias.slice() } : null, search: ui.results && input.value.trim() ? input.value : null }; },
    reopen({ plan, search }) {
      if (plan) return preview(plan.place, plan.via || [], plan.start?.you ? undefined : plan.start, plan.file && ui.file ? { style: ui.file.style, file: ui.file } : null); // W67 routefile: a file's, with its marks (in this page)
      if (search) { input.focus(); input.value = search; showResults(); }
    },
    get engine() { return courseEngine; },
    get burnTo() { return burnTarget({ home: homePlace(), fort: FORT, plain: isPlain() }); }, // W73 mission: home, else the Fort
    burnUp() { const to = nav.burnTo; if (to) preview(to, [], undefined, { burn: true }); return !!to; }, // W73 mission: Burn up, the in-flight preview
  };
  window.starchartCourse = nav; // for tests
  // W60 b: a switch of Words shows at once: the card's foot and its unfolded turns, and an open preview, made again in the
  // new words (the card's own words follow at its next tick)
  onLingo(() => { flyKey = null; toLine(); fitFoot(); if (nav.leg?.n === 0) between(nav.leg, true); /* W62 cometcard */ const plan = nav.open.plan; if (plan) nav.reopen({ plan }); }); // W60 b
  return nav;
}
