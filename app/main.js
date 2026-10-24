// Starchart 0.1 (Klingon): flight mode, on real GPS or the demo mission. The screen is
// design/app-ui/SPEC.md: a quiet chart when parked, Launch and Land, the maps-app location button and
// compass, the accuracy ring and heading beam, banner pills, and the settings behind one button.
//
// Where the ship is and which way it points comes from one module, the pose (app/pose.js). The event
// engine flies a course built from the pose's fixes, in the demo as on GPS, so nothing looks ahead
// along the route (W12-ux R14).
//
// URL: ?sim=demo [&speed=n] [&muted=1] [&calm=1] [&perf=1] [&lingo=scul|meatspace, for tests: the Words setting; W60 a]. See app/README.md.
import { makeMap, mapPixelRatio, maplibregl, protocol, setLingoMode } from "../chart/prototype/chart.js"; import { MISSING } from "../chart/prototype/tiles.js"; // W50 crisp: mapPixelRatio; W47 firstload: MISSING; W60 a: setLingoMode
import { lingo as lingoMode, onLingo, pick, plain } from "./lingo-mode.js"; // W60 a: the Words setting, SCUL or Plain
import { EventEngine } from "../chart/prototype/events.js";
import { firstOf, openWorld } from "../chart/prototype/world.js"; // W82 packmap: firstOf
import { ChartMotion, keepLayer } from "../chart/prototype/gl-layer.js"; // W39 ship: keepLayer
import { Governor, lively } from "../chart/prototype/perf.js"; import { mountFrameRate } from "./framerate.js"; import { gpsLine, noFixNotice, roughM, waitingWords, lostMs, lostWords, screenOffLine } from "./fixnote.js"; // W20 chrome; W21 glass: noFixNotice; W21 flight: lost
import { initSound, isSilent } from "../chart/prototype/sound.js";
import { num } from "../chart/prototype/params.js"; // W60 a: the mode is app/lingo-mode.js's
import { FollowCamera, frameDt, glideMs, pixels, AutoZoom, streetMps } from "../chart/prototype/follow.js"; // W29 polish: glideMs; W31 navview: AutoZoom, streetMps
import { NO_BANNER, bannerPill, PillQueue } from "../chart/prototype/banners.js";
import { writer, tallies } from "../chart/prototype/hud.js";
import { createPose } from "./pose.js";
import { LiveCourse } from "./live-course.js";
import { Matcher, forCourse } from "./match.js"; // W21 gps
import { bearing, metres } from "./geo.js"; // W25 rest: bearing
import { Trail } from "./trail.js";
import { FlightState } from "./flight-state.js";
import { canStore, keep, openPrefix, prune, quota, store, StoredSource, storedTiles } from "./offline.js"; // W40 settings: keep; W76 privacy: openPrefix
import { mountPacks } from "./packs.js"; // W81 packstore
import { outsideBoxes, withinBoxes } from "./packmap.js"; // W82 packdraw
import { get as setting, set as setSetting, mountSettings, pace } from "./settings.js"; // W15 settings; W59 pace: pace
import { BlackBox, Recorder, tiny } from "./blackbox.js"; // W15 settings; W68 logbulk: tiny
import { flightChatter, sayColourNow } from "./chatter.js"; // W15 settings
import { startFx } from "./fx.js"; // W15 chart
import { mountCourse } from "./course.js"; // W17 course
import { onShare, takeShared, shareWaiting } from "./share-in.js"; // W67 routefile: what another app shared to Starchart
import { mainName, placeName, restOf, allInside, etaOf } from "./course-logic.js"; // W27 friction: a flight is named for its course; W60 b: placeName; W75 chrome: restOf, allInside
import { ShipModel3D } from "./ship-model-layer.js"; // W21 shipin
import { KEY as AVATAR, avatarHex, mountAvatar } from "./avatar.js"; // W86 avatar
import { mountVoices } from "./voices.js"; // W97 voices
import { mountLog } from "./log.js"; import { Logbook } from "./logbook.js"; // W17 log
import { mountGhosts } from "./ghosts.js"; // W73 ghosts
import { mountTerrain } from "./terrain.js"; // W19 terrain
import { mountSoundPick, spoken, sounded, soundMode, setSound, toggleSound, muteVisit, SOUND, soundWords, warmVoice, keepLingo, WORDS as SOUND_WORDS } from "./calls.js"; /* W75 chrome: SOUND_WORDS */ /* W86 settings: sounded */ import { longPress } from "./press.js"; import { aboutStores, screenLine } from "./about.js"; // W18 controls
import { holdToHide, isHidden, mountNotice } from "./notice.js"; // W21 glass
import { mountScale } from "./scale.js"; // W21 scale
import { mountRough } from "./rough.js"; // W21 entry
import { mountShipGuard } from "./ship-guard.js"; // W39 ship
import { mountYouArrow } from "./youarrow.js"; // W21 flight
import { browserOf, mountInstall } from "./install.js"; // W22 pwa; W25 rest: browserOf
import { CourseFlow } from "./course-flow.js"; // W22 pretty
import { mountComfortHeat } from "./comfort-heat.js"; // W23 comfort
import { tip, why, say } from "./tip.js"; // W24 quiet: the one bubble; W73 a11y: say
import { tipOnce, tipGate, launchCard } from "./tips.js"; // W28 launch: first-time tips, and the first Launch's card
import { mountDownloads, mountPackRows } from "./downloads.js"; // W26 downloads; W82 packui: mountPackRows
import { backGuard, flightKeeper, flightLock, keepParked, keptFlight, resumedLine, takeParked, verdict, KEEP_MS } from "./resume.js"; // W28 resume; W40 log: flightLock
import { mountComets } from "./comets.js"; import { cometHooks } from "./hints.js"; // W29 comets
import { welcomeOnce } from "./welcome.js"; // W35 welcome
import { mountFeedback, gpsQuality } from "./feedback.js"; /* W88 feedbackinfo: gpsQuality */ import { note, changed, watchApp } from "./trail-log.js"; // W48 feedback
import { mountLayers, showLayers } from "./layers.js"; // W50 layers; W70 deep: showLayers, the tunnels with the Comets tile
import { mountAnchorages } from "./anchorages.js"; // W56 parking
import { mountStarred } from "./starred.js"; // W67 places
import { mountAvoidLayer } from "./avoid-layer.js"; // W80 avoidmap
import { mountWeather } from "./weather.js"; // W52 weather
import { mountTransit } from "./transit.js"; // W61 transit
import { mountWalk } from "./walk.js"; // W73 walk
import { WORDS as WALKW } from "./walk-card.js"; // W79 walkgo: Land's word for a walk
import { mountRadiation } from "./radiation.js"; // W54 flight
import { mountDusk, turnNear } from "./dusk.js"; // W73 dark
import { winterStyle, winterPaints, dimWinter } from "./water.js"; // W67 water
import { haptic, pulse, turnSide } from "./haptics.js"; import { mountMotion } from "./motion.js"; // W69 motion: haptics, and the UI's motion (SPEC §107)
import { setSfx, odometer, landSound, tallyTick, chime } from "./delight.js"; // W73 delight (SPEC §124)
import { mountMission } from "./mission.js"; // W73 mission: Burn up and the long-haul screen
import { mountChangelog } from "./changelog.js"; // W98 changelog

maplibregl.prewarm(); // start MapLibre's workers while the first files load (motion-9)

const ROOT = new URL("../", import.meta.url); // the site's root: works at / and under a path
const at = (p) => new URL(p, ROOT).href;
const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const sim = q.get("sim") === "demo";
const speed = num(q.get("speed"), 1, 0.1, 50);
const muted = q.get("muted") === "1";
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const calmWanted = () => q.get("calm") === "1" || ({ calm: true, full: false }[setting("starchart.motion")] ?? reduced); // W28 settings: Motion; W100 motion: the Calm motion switch, "calm" on, "full" off, unflipped the phone's
let calm = calmWanted();
document.body.classList.toggle("calm", calm); // the Calm chart setting, as prefers-reduced-motion (prototype-11)
document.documentElement.toggleAttribute("data-ios-installed", navigator.standalone === true); // W23 polish: the status band in Daystar (app/pretty.css)
let mode = lingoMode(); onLingo((m) => { mode = m; }); // W60 a: the Words setting, SCUL or Plain, live (app/lingo-mode.js); &lingo= stays for tests (R9)
const FORT = [-71.13946, 42.3596];
const MPH = 0.44704, LY = 1609.344;
// W47 firstload: a start file that fails (the connection dropped) or stalls (30 s, then 60 s, 120 s) is asked for again, after 1, 2, 4… s
// or as soon as the phone is back online, so the start never stops half-way; a missing file (HTTP 404) still fails at once.
const pause = (ms) => new Promise((r) => { const go = () => { clearTimeout(t); removeEventListener("online", go); r(); }, t = setTimeout(go, ms); addEventListener("online", go); }); // W47 firstload
const getJSON = async (p, tries = 0) => { // W47 firstload: tries
  try { // W47 firstload
    const r = await fetch(at(p), { signal: AbortSignal.timeout(30000 << Math.min(tries, 2)) }); // W47 firstload: the timeout
    if (!r.ok) throw Object.assign(new Error(`${p}: HTTP ${r.status}`), { http: true }); // W47 firstload: http
    return await r.json(); // W47 firstload: await, so a body cut short is tried again
  } catch (e) { if (e.http || tries >= 6) throw e; await pause(1000 << tries); return getJSON(p, tries + 1); } // W47 firstload
}; // W47 firstload

// ---- loading: one bar from 0 to 1, never a dead screen (R1) ----------------------------------------
let shownP = 0;
function progress(p) {
  p = Math.min(1, Math.max(shownP, p));
  if (p - shownP < 0.005 && p < 1) return;
  shownP = p;
  $("progress-bar").style.transform = `scaleX(${p})`;
  const pc = Math.round(p * 100);
  $("progress").setAttribute("aria-valuenow", pc);
  if (loadWord) loadWord.textContent = `Charting… ${pc} %`; // W21 entry
  if (loadWord && p >= 1) { loadWord.remove(); loadWord = null; } // W21 entry
  why($("locate"), p < 1 ? `Charting… ${pc} %` : null); // W25 rest: the location button, until the chart is in
}
let loadWord = null; // W21 entry: a slow load says so in words after 3 s, at the ship's spot, until the chart is drawn
setTimeout(() => { if (shownP < 1) { loadWord = Object.assign(document.createElement("p"), { id: "loadword", textContent: `Charting… ${Math.round(shownP * 100)} %` }); document.body.append(loadWord); } }, 3000); // W21 entry
progress(0.08);
const fx = startFx(); // W15 chart: the boot's lines, then the ping, the ground, the flash, the tilt and the tint
// Launch works while the chart loads: a flight launched early counts from the tap (SPEC §10).
if (muted) muteVisit(); // W28 settings: ?muted=1 is this visit's
$("sound").setAttribute("aria-pressed", String(soundMode() === "off")); // W28 settings: until the sound module is in; W25 rest: or as kept
let launchTap = null;
$("launch").onclick = () => { launchTap ??= performance.now(); tip($("launch"), pick("Launching once the chart is in.", "Recording once the chart is in.")); /* W88 ridemodes: Plain's Record */ }; // W60 a: pick // W24 quiet: it stays live, and says so
// W25 rest: the bar answers from the first frame (entry B1). Sound keeps its setting until the sound is in, Settings opens,
// and the Log opens once the chart is in; the location button says how far the chart is (progress, above).
let logTap = false;
// W28 settings: Sound is one key (app/calls.js); a tap is Off or the last mode that was on, and the sound follows once it is in
$("sound").onclick = () => { toggleSound(); tip($("sound"), soundWords()); }; // W28 settings; W34 cues: a bubble says which
addEventListener("starchart:settings", (e) => { if (e.detail.key === SOUND) $("sound").setAttribute("aria-pressed", String(soundMode() === "off")); }); // W28 settings
$("about").onclick = () => $("about-sheet").showModal();
$("tab-log").onclick = () => { logTap = true; tip($("tab-log"), "Opening the Log once the chart is in."); };
$("tab-chart").onclick = () => tip($("tab-chart"), `Charting… ${Math.round(shownP * 100)} %`); // until the bar's own tap, as the location button
const whereTo = document.querySelector("#gobar > .csearch input"); // W47 firstload: Where to? is index.html's, from the first frame
whereTo.onfocus = () => tip(whereTo.parentNode, "Getting the search ready…"); // W47 firstload: until app/course.js wires it (below), and the letters typed meanwhile stay
mountMotion(); // W69 motion: the glides, bursts and ticks (app/motion.js), from the first frame
mountSettings({ $, sound: { mode: soundMode, set: setSound } }); // W25 rest: from the first frame, was after the chart; W28 settings: sound
mountInstall({ $ }); // W22 pwa; W47 install: from the first frame, before the welcome card (its row) and with Settings
// W35 welcome: a first open's welcome comes first, from the first frame; not in the demo or a flight that resumes (app/welcome.js)
const welcome = "starchartWelcome" in window ? window.starchartWelcome : sim || verdict(keptFlight(localStorage)) === "resume" ? null : welcomeOnce($("welcome")); // W35 welcome; W47 firstload: app/first.js has shown it already
const owner = flightLock(), keptHere = sim ? null : keptFlight(localStorage); // W40 log: one tab owns a flight, by its Web Lock (app/resume.js)
const ours = !verdict(keptHere) || await owner.claim(keptHere.rec.id); // W40 log: another tab flies it, or is in its Undo window: leave it be

// The dev channel (`node app/build.mjs --dev`, hosting/lan.sh's second port) runs with no service
// worker, so every reload is the latest build; it removes one left from before.
const devChannel = document.querySelector('meta[name="starchart-channel"]')?.content === "dev";
// W47 firstload: a first visit (no service worker controls the page, so no update can be waiting) registers it once the first view
// is drawn and idle (firstView, at ready below): its precache, about 10 MB, then never competes with the first view's own files.
const firstVisit = "serviceWorker" in navigator && !navigator.serviceWorker.controller; // W47 firstload
let firstView = null; const viewed = new Promise((r) => { firstView = r; }); // W47 firstload
const swReg = !("serviceWorker" in navigator) ? Promise.resolve(null)
  : devChannel ? navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).then(() => null, () => null)
  : (firstVisit ? viewed : Promise.resolve()).then(() => keepLingo(mode, { url: at }).catch(() => {})).then(() => navigator.serviceWorker.register(at("sw.js"), { scope: at("./") })) /* W60 d: keepLingo */.catch((e) => { console.warn("service worker:", e.message); return null; }); // W47 firstload: viewed

// Every first file at once (motion-9).
const [TOK, lingo, build, data, style, release, demoGJ] = await Promise.all([
  getJSON("design/tokens.json"), getJSON("chart/lingo/lingo-pack.json"), getJSON("build.json"), getJSON("data/manifest.json"),
  getJSON(starchartTheme.styleFile), getJSON("app/version.json"), // W15 themes: the stored theme's style (app/theme.js)
  sim ? getJSON("chart/routing/demo/saturnight-demo-mission.geojson") : null,
]);
progress(0.18);
const VERSION = `${build.version} ${release.release}${build.channel === "dev" ? " · dev channel" : ""}`;
const tilesEntry = data.files.find((f) => f.kind === "tiles");
const tilesUrl = at(tilesEntry.path);
const PAD = sim ? demoGJ.features[0].geometry.coordinates[0].slice(0, 2) : FORT; // the launchpad

// ---- the pose: GPS or the demo, one interface (app/pose.js) -------------------------------------
const pose = createPose({ source: sim ? "sim" : "gps", sim: { speed, seed: 1, route: demoGJ, multipath: q.get("multipath") === "1" } }); // W21 gps: ?multipath=1
let gps = pose.status, lastFix = null, fixedAt = -Infinity, launchedAt = -Infinity; // W21 flight: fixedAt, launchedAt
const screenOff = { at: 0, until: 0, text: "" }; // W21 flight: a screen lock mid-flight (below)
const onPose = { fix: null, status: null }; // the handlers, once the screen is built
pose.on("status", (st) => { gps = st; onPose.status?.(); });
pose.on("fix", (f) => { lastFix = f; fixedAt = performance.now(); onPose.fix?.(f); }); // W21 flight: fixedAt
pose.on("fix", (f) => gpsQuality.add(f.accuracy_m)); // W88 feedbackinfo: the accuracy only, for the feedback's GPS line
const NO_POSITION = new Set(["denied", "unavailable", "insecure"]);
// GPS starts now, so a parked chart shows the ship; the compass asks again from the Launch tap (iOS
// needs a tap for it). The demo's rider waits on the launchpad until Launch.
if (!sim) welcome ? welcome.then(() => pose.start()) : pose.start(); // W35 welcome: the location prompt waits for the welcome

// ---- the chart: tiles from the phone when they are stored and checked, else from the network ----
// The event engine's world (chart/prototype/world.js) reads the same archive as the chart, at z15 in a
// worker, never what MapLibre has rendered, so the events are the same at any zoom or pan (prototype-2). W76 privacy: z13 until it is stored.
const world = openWorld(tilesUrl);
let worldFile; world.load.file = new Promise((r) => { worldFile = r; }); world.load.file.catch(() => {}); world.setZoom(13); // W76 privacy: a fix that comes before the chart's source is known reads nothing yet
pose.core.matcher = new Matcher(world); // W21 gps: the ship holds the road (app/match.js)
// W82 packmap (SPEC §155): the chart's source reads a list of archives, the base's first, then each stored map pack's (world.js
// firstOf): one source and the style's own layers, so nothing is drawn twice at a cut and a pack costs no layer
const chartTiles = [new pmtiles.PMTiles(tilesUrl)]; // W82 packmap
const readChart = (pm) => { chartTiles[0] = pm; protocol.add(firstOf(chartTiles)); }; // W82 packmap
readChart(chartTiles[0]); // W82 packmap: the network's, until a prefix or a stored file
/** Read the chart, and the world, from a stored tile file from now on. */
function readStored(file) {
  readChart(new pmtiles.PMTiles(new StoredSource(file, tilesUrl))); // W82 packmap: readChart
  world.load.file = file;
  world.setZoom(15); // W76 privacy
}
const stored = await storedTiles(tilesEntry);
let offline = false, storeState = stored ? "stored" : canStore() ? "network" : "unsupported", storeDetail = "";
if (stored) readStored(stored.file);
// W76 privacy (SPEC §132): until it is stored, the chart and the world read only the chart's prefix, the same bytes for every rider
// (app/offline.js): the chart draws z13 enlarged, the world reads z13, and nothing tells the tile host where the rider is
const prefix = !stored && tilesEntry.prefix_bytes ? openPrefix(tilesUrl, tilesEntry) : null; // W76 privacy
if (prefix) { readChart(new pmtiles.PMTiles(prefix.source)); world.load.file = prefix.file; } // W76 privacy; W82 packmap: readChart
worldFile(prefix ? prefix.file() : stored?.file ?? null); // W76 privacy: what came before reads from that too
// W82 packmap: each stored pack's tiles, after the base's, for the chart and the world; again whenever one is stored or removed
const packs = mountPacks({ manifest: data, at }); // W81 packstore: the map packs' store (app/packs.js)
let packKey = "", packsMap = null, packSync = Promise.resolve(); // W82 packmap
let packBoxes = [], edgeCut = false, edgeData = null; // W82 packdraw: the stored packs' boxes; the edge cut for them; the edge's GeoJSON
const syncPacks = () => (packSync = packSync.then(async () => { // W82 packmap: one at a time
  const list = packs.list(), all = await Promise.all(list.map((p) => packs.file(p.id, "tiles"))), files = all.filter(Boolean); // W82 packmap: stored and checked (an update's old one until its new one is); W82 packdraw: all
  const key = files.map((f) => `${f.name}:${f.size}`).join(); // W82 packmap
  if (key === packKey) return; // W82 packmap
  packBoxes = list.filter((p, i) => all[i]).map((p) => data.packs.find((x) => x.id === p.id).bounds); // W82 packdraw
  const gone = packKey.split(",").some((k) => k && !key.split(",").includes(k)); // W82 packmap: a pack removed (or replaced)
  packKey = key; // W82 packmap
  chartTiles.splice(1, Infinity, ...files.map((f) => new pmtiles.PMTiles(new StoredSource(f, `pack:${f.name}`)))); // W82 packmap
  world.load.packs = files; world.refresh(); // W82 packmap
  if (packsMap) { refreshChart(packsMap, gone); await drawPacks(packsMap); } // W82 packmap: drawn, or gone, at once; W82 packdraw: and the edge
}).catch((err) => console.warn("packs:", err.message))); // W82 packmap
/** W82 packdraw (SPEC §160): the edge's void, sea, coast and towns (`new-england`, over the chart's lines and fills) cut away in
 *  each stored pack's box, and the chart's point labels let into it (packmap.js); back as the style has them with none. */
const edgeJson = () => (edgeData ??= fetch(style.sources["new-england"].data).then((r) => r.json()).catch((err) => { edgeData = null; throw err; })); // W82 packdraw
async function drawPacks(m) { // W82 packdraw
  if (!packBoxes.length && !edgeCut) return; // W82 packdraw
  const ne = packBoxes.length ? await edgeJson() : null; // W82 packdraw: precached
  const boxes = packBoxes; edgeCut = boxes.length > 0; // W82 packdraw: the latest, after the wait
  m.getSource("new-england")?.setData(edgeCut ? outsideBoxes(ne, boxes) : style.sources["new-england"].data); // W82 packdraw
  for (const l of style.layers) { const f = withinBoxes(l.filter, boxes); if (f && m.getLayer(l.id) && withinBoxes(m.getFilter(l.id), [])) m.setFilter(l.id, edgeCut ? f : l.filter); } // W82 packdraw; at the review: a filter another module set (anchorages' "none") is left alone
} // W82 packdraw
/** W82 packmap: load every chart tile again, an errored one too. MapLibre 6's refreshTiles("chart") (its reload(true)) leaves an
 *  errored tile "loading" for good, so each tile is named, which loads it afresh; the out-of-view cache goes, as reload's does.
 *  A pack `gone`: a reload that fails keeps the tile's old data, so the tiles are dropped and read again (from the phone). */
function refreshChart(m, gone = false) { // W82 packmap
  const tm = m.style?.tileManagers?.chart; // W82 packmap
  if (!tm?._inViewTiles) return m.refreshTiles("chart"); // W82 packmap
  if (gone && tm.clearTiles && m._update) { tm.clearTiles(); return m._update(); } // W82 packmap: MapLibre asks for the view's tiles at the next frame
  tm._outOfViewCache?.reset(); // W82 packmap
  // W82 packdraw: a stored pack changes no loaded tile (the base's wins), only one with no data: errored, or left loading for good
  // by MapLibre's reload of an errored tile (the base's setUrl once it is stored). Reloaded by name, one past every archive's zoom
  // (z16) came back empty or stayed loading, over its parents: the chart went black and never idle. Dropped instead, each is asked
  // for afresh at the next frame and, past the archives' zoom, falls back to the pack's parent.
  if (tm._removeTile && m._update) { for (const t of tm._inViewTiles.getAllTiles()) if (!t.hasData()) tm._removeTile(t.tileID.key); return m._update(); } // W82 packdraw
  m.refreshTiles("chart", tm._inViewTiles.getAllTiles().map((t) => t.tileID.canonical)); // W82 packmap
} // W82 packmap
// W102 packfix (SPEC §203): the packs stored at launch go into the style the chart starts with (the edge cut, the labels' ring),
// so its first tiles load and parse once: a filter set after makeMap parsed every in-view tile again, and the refresh loaded again
// those still loading. A slow check or edge read holds the start 1 s at most; the packs then draw after it, as before.
const packStyle = packs.ready.then(syncPacks).then(async () => {
  if (!packBoxes.length) return null;
  const ne = await edgeJson(), boxes = packBoxes;
  return { key: packKey, style: { ...style, sources: { ...style.sources, "new-england": { ...style.sources["new-england"], data: outsideBoxes(ne, boxes) } },
    layers: style.layers.map((l) => { const f = withinBoxes(l.filter, boxes); return f ? { ...l, filter: f } : l; }) } };
}).catch((err) => { console.warn("packs:", err.message); return null; }); // W102 packfix
packs.on((d) => { if (d.state !== "downloading") syncPacks(); }); // W82 packmap: stored, paused, failed or removed
if (!prefix && !stored) world.setZoom(15); // W76 privacy: a manifest with no prefix reads the network as before
// The style's paths are root-relative (/chart/style/...): make them relative to this site.
style.sprite = at(style.sprite.replace(/^\//, ""));
style.glyphs = ROOT.href + style.glyphs.replace(/^\//, ""); // keep {fontstack}/{range} unescaped
style.sources.chart.url = "pmtiles://" + tilesUrl;
style.sources.chart.attribution = "OpenStreetMap"; // W58 clean: the chart says just "OpenStreetMap", with no link; About keeps the full credit, the ODbL and its link (SPEC §79)
style.sources["new-england"].data = at(style.sources["new-england"].data.replace(/^\//, "")); // W51 edge: past the data (precached)
starchartTheme.prepare(style); // W15 themes: AMOLED black from the first frame
const PLAIN_HIDES = ["starfield", "edge-stars", "edge-flavor", "fort"]; // W63 rider: in Plain, no starry background, no "Here be Freds" past the data, and no Fort or lore highlight (SPEC §91)
if (plain()) for (const l of style.layers) if (PLAIN_HIDES.includes(l.id)) l.layout = { ...l.layout, visibility: "none" }; // W63 rider: from the first frame
const WINTER = winterPaints(style); winterStyle(style); // W67 water: winter's fountains dimmed, from the first frame
let worldIn = false, chartIn = false;
const tilesSeen = new Set(), tilesDone = new Set(); // the first screen's tiles, from MapLibre's events
// W25 rest: the chart opens where the pilot was: at the first fix if one is in, else at the last parked spot, kept on this
// phone only (localStorage) and never sent anywhere, else at the launchpad; no more Fort, black, then a jump to the ship.
const SPOT = "starchart:spot";
let keptSpot = (() => { try { const v = JSON.parse(localStorage.getItem(SPOT)); return Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) ? v : null; } catch { return null; } })();
const START = sim ? PAD : lastFix?.lonlat.slice() ?? keptSpot ?? PAD; // W25 rest
world.ready(START); // the tiles at the start, while the chart loads; W25 rest: START
world.idle().then(() => { worldIn = true; loadTick(); });

// chart.js's makeMap, as the prototype's: no symbol fades (motion-1), the device's pixel ratio (W50 crisp), 2 at most
// under Battery saver (motion-3; W50 crisp), and the OpenStreetMap credit always shown (prototype-6). Gestures work from here on.
const madeIn = mode; // W60 a
const packed = await Promise.race([packStyle, new Promise((r) => setTimeout(r, 1000, null))]); edgeCut = !!packed; // W102 packfix
const map = await makeMap("map", { style: packed?.style ?? style, center: START, zoom: 16, bearing: 0, mode, pixelRatio: mapPixelRatio(setting("starchart.smooth") === "30"), until: "style" }); // W25 rest: START; W50 crisp: pixelRatio; W47 firstload: until the style, not every first tile
const drawEdge = () => drawPacks(map).catch((err) => console.warn("packs:", err.message)); // W82 packdraw
packsMap = map; if (packKey && packKey !== packed?.key) { refreshChart(map); drawEdge(); } // W82 packmap: a pack found while the chart loaded; W82 packdraw: drawEdge
map.on("style.load", () => { edgeCut = false; drawEdge(); }); // W82 packdraw: a restored context's style is the style's own again
map.on("sourcedata", (e) => { if (e.sourceId === "chart" && e.sourceDataChanged) refreshChart(map); }); // W102 packfix (SPEC §203): after the base's setUrl, MapLibre 6 leaves each errored tile "loading" for good (its loadTile waits on a load that isn't running), so those are asked for afresh
watchApp({ map, version: VERSION }); // W48 feedback: the trail log, from here on
onLingo((m) => setLingoMode(map, m)); if (mode !== madeIn) setLingoMode(map, mode); // W60 a: the labels follow Words live, and a pick made while the chart loaded
const plainChart = () => { const v = plain() ? "none" : "visible"; for (const id of PLAIN_HIDES) if (map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== v) map.setLayoutProperty(id, "visibility", v); map.triggerRepaint(); }; // W63 rider
plainChart(); onLingo(plainChart); addEventListener("starchart:theme", plainChart); map.on("style.load", plainChart); // W63 rider: at load, live, and again after a theme or a restored context
const winterChart = () => dimWinter(map, WINTER); addEventListener("starchart:theme", winterChart); map.on("style.load", winterChart); // W67 water: again after a theme's paint diff
let tileFailed = false; map.on("error", (e) => { if (e.tile && e.sourceId === "chart" && e.error?.message !== MISSING) tileFailed = true; }); // W47 firstload: a tile lost with the connection
addEventListener("online", () => { if (tileFailed) { tileFailed = false; map.refreshTiles("chart"); } }); // W47 firstload: asked for again once it is back
map.setMaxPitch(60); // W15 chart: two fingers up or down tilt the chart (touchPitch)
mountScale({ map }); // W21 scale: the light-years scale, beside the credit (app/scale.js)
// ---- the OpenStreetMap credit, as small as the licence allows (W16) ---------------------------------
// The OSMF's attribution guideline lets an interactive map fold the credit "automatically on map
// interaction such as panning, clicking, or zooming" or "automatically after five seconds", as long as
// the licence stays findable "from an '(i)' button in the corner of the map or an 'About' option". So
// it shows in full at start, folds to a small © at the bottom right, and a tap on the © shows it again
// for five seconds. About keeps the full credits. W58 clean: it reads "OpenStreetMap", with no link, and a hold on it
// opens About at its credits (below, with About).
const credit = map.getContainer().querySelector(".maplibregl-ctrl-attrib");
map.getContainer().querySelector(".maplibregl-ctrl-bottom-right").append(credit);
let creditOpen = true, creditTimer = 0;
function showCredit(open) {
  clearTimeout(creditTimer);
  creditOpen = open;
  credit.toggleAttribute("open", open);
  if (open) creditTimer = setTimeout(() => showCredit(false), 5000);
}
credit.querySelector("summary").addEventListener("click", (e) => { e.preventDefault(); showCredit(!creditOpen); });
map.on("resize", () => credit.toggleAttribute("open", creditOpen)); // MapLibre opens it again at each resize
for (const type of ["pointerdown", "wheel"]) map.getCanvasContainer().addEventListener(type, () => { if (creditOpen) showCredit(false); }, { passive: true });
progress(0.4);
// the first frame is drawn and every tile is in (it may already be, by the time load has resolved)
const idle = map.loaded() && map.areTilesLoaded() ? Promise.resolve() : new Promise((r) => map.once("idle", r)); // W47 firstload: map.loaded(), as makeMap no longer waits for the first tiles
idle.then(() => { chartIn = true; loadTick(); });
idle.then(fx.bootEnd); // W15 chart
const hexGone = () => { const h = $("hexload"); if (!h || h.classList.contains("gone") || document.documentElement.classList.contains("boot-hold")) return; h.classList.add("gone"); const go = () => h.remove(); h.addEventListener("animationend", (e) => { if (e.target === h && !e.pseudoElement) go(); }); setTimeout(go, 3000); }; // W47 firstload: the start's hexes fade (app/hexload.css); W69 boot: in 280 ms, gone once that has played (or 3 s on, should a busy phone hold its frames), and never with ?boot=hold
let mountsIn = null; const mounted = new Promise((r) => { mountsIn = r; }); // W77 split: the ship and the course are on the chart (below)
Promise.all([idle, mounted]).then(hexGone); // W47 firstload; W77 split: and never before the ship, on a start fast enough to be drawn between the tasks below
const tileKey = (e) => e.tile && (e.tile.tileID?.key ?? e.tile);
map.on("dataloading", (e) => { if (e.tile) { tilesSeen.add(tileKey(e)); loadTick(); } });
map.on("data", (e) => { if (e.tile) { tilesSeen.add(tileKey(e)); tilesDone.add(tileKey(e)); loadTick(); } });
function loadTick() {
  if (shownP >= 1) return;
  const tiles = chartIn ? 1 : tilesSeen.size ? tilesDone.size / tilesSeen.size : 0;
  progress(Math.min(0.95, 0.4 + 0.45 * tiles + (worldIn ? 0.15 : 0))); // W21 entry: 100 % only once the chart is drawn (ready, below)
}
// The ship at 62 % of the height heading up, and in the middle north up (W26 relief); a free chart keeps its top. While
// the no-location sheet is open its height is added at the bottom, so the spot the chart is centred on (the Fort) stays in sight above it.
let padMode = "follow"; // W26 relief: the camera's mode, as pad() last heard it (the camera comes later)
const padFor = (mode) => { // W26 relief
  const sheetH = $("nogps").hidden ? 0 : Math.round(innerHeight - $("nogps").offsetTop); // W25 rest: with the bar under it; W29 polish: offsetTop, its place once its slide-in (a translate) has ended
  return { top: mode === "heading" ? Math.round(innerHeight * 0.24) : mode === "free" ? map.getPadding().top : 0, bottom: sheetH, left: 0, right: 0 };
};
const pad = (ease = false, mode = padMode) => {
  const padding = padFor(mode); // W26 relief
  if (ease) map.easeTo({ padding, duration: 300, essential: true }); else map.setPadding(padding); // W29 polish: it glides in Calm too
};
pad();
addEventListener("resize", () => pad());
// W77 split (SPEC §142): the style's setup runs as five tasks, not one, so a tap or a frame can come between them: MapLibre's
// style with the lines above, the chart's layers, the ship, the trail and the flight, then the course. The order is the same,
// so every layer finds its `before` and keepLayer's order stays.
const breathe = () => (globalThis.scheduler?.yield ? scheduler.yield() : new Promise((r) => setTimeout(r, 0))); // W77 split
await breathe(); // W77 split

// ---- the animated chart: one WebGL 2 layer ---------------------------------------------------
const C = TOK.color;
const motion = new ChartMotion({ pulsar: C.pulsar, hole: C["black-hole"], star: C.starlight, worm: C.wormhole }, { calm, off: plain(), motion: TOK.motion }); // W65 plainlook: off in Plain
onLingo(() => { motion.off = plain(); motion.rebuild(); }); // W65 plainlook: no pulse, swirl or flow in Plain, live; the course flow stays
addEventListener("starchart:settings", (e) => { if (e.detail?.key === "starchart.layer.lanes") motion.schedule(); }); // W88 mapfix: the cycle tracks' flow goes and comes with the Bike lanes layer
const glKept = keepLayer(map, motion, "pulsar-dot"); // W39 ship: every custom layer comes back after a lost WebGL context, in its place
window.__motion = motion; // the perf overlay's gpu line (chart/prototype/perf.js)
const flow = new CourseFlow({ dark: { course: C.course, core: C.starlight }, light: { course: TOK["color-light"].course, core: TOK["color-light"]["space-2"] } }, { calm, theme: starchartTheme.current.theme, flowPxPerS: TOK.motion.wormhole_flow_px_per_s }); // W22 pretty
keepLayer(map, flow, "course-chevrons"); window.starchartFlow = flow; addEventListener("starchart:theme", (e) => flow.theme(e.detail.theme)); // W22 pretty: the preview's moving dots, above the course
for (const id of ["pulsar-beat", "wormhole-flow"]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "none");
const PLAIN_OFF = ["black-hole-ring-glow", "black-hole-ring"]; // W65 plainlook: a rotary is its road in Plain, with no purple ring
const plainOff = () => { for (const id of PLAIN_OFF) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", plain() ? "none" : "visible"); // W65 plainlook
  if (map.getLayer("black-hole")) map.setLayoutProperty("black-hole", "icon-image", plain() ? "rotary" : "black_hole"); }; // W65 plainlook: the road sign for the swirl
plainOff(); onLingo(plainOff); // W65 plainlook
const comets = mountComets({ map, calm, theme: starchartTheme.current.theme, before: "ghost-trail-glow", chart: () => { try { return logView !== "page" && !aboutSheet.open; } catch { return false; } } }); // W29 comets: the live trains, under the course and the labels
Object.assign(cometHooks, comets); addEventListener("starchart:theme", (e) => comets.theme(e.detail.theme)); // W29 comets: their peeks (app/hints.js)
// W70 deep (SPEC §109); arclight, 2026-10-20: "why not just make that be the default when both the comets + terrain are
// selected on?" So the T's tunnels show at their depth whenever Comets and Terrain are on, from the first tilt past 20°
// (the layer draws only tilted, with the hills, and nothing is fetched before); the Comets tile shows and hides it with
// the tracks (app/layers.js). ?deep=1 mounts it at once and ?deep=0 never, for tests. A failed fetch (offline) tries
// again at the next tilt.
let deepIn = null;
const deepWanted = () => ["starchart.comets", "starchart.layer.tlines", "starchart.layer.terrain"].every((k) => setting(k) !== "off");
const mountDeepOnce = () => {
  if (deepIn) return;
  deepIn = import("./deep.js").then((d) => d.mountDeep({ map, comets, url: at("chart/transit/deep-v1.json"), theme: starchartTheme.current.theme }))
    .then((d) => { window.starchart.deep = d; showLayers(map, "starchart.comets"); }).catch(() => { deepIn = null; });
};
const deepTilt = () => { if (map.getPitch() > 20 && deepWanted()) mountDeepOnce(); };
if (q.get("deep") === "1" || setting("starchart.deep") === "on") addEventListener("starchart:ready", mountDeepOnce, { once: true }); // W77 split: once window.starchart is in, which it names
else if (q.get("deep") !== "0") { map.on("pitchend", deepTilt); addEventListener("starchart:settings", deepTilt); } // ?deep=0: never, for tests of the surface
const terrain = mountTerrain({ map, data, at, tokens: TOK, protocol, after: idle, // W19 terrain: hills after the first frame, 3D when tilted (app/terrain.js)
  pinned: () => { try { return camera.mode !== "free"; } catch { return false; } }, // W26: following, 3D sits on the ship's ground (camera is made below)
  seen: () => new Promise((ok) => { const s = $("about-sheet"); if (!s.open) ok(); else s.addEventListener("close", ok, { once: true }); }) }); // W102 trim (SPEC §202): the first run's hills mount once Settings, opaque, is closed
mountComfortHeat(map, C, { on: q.get("comfort") === "1" }); // W23 comfort: the debug heat view (app/comfort-heat.js)
const layers = mountLayers({ map, $ }); // W92 panels: the card opens whole, over the ship if it must // W50 layers: the Layers button and card (app/layers.js); W55 layers2: its tiles, comets (with their tracks), terrain, places, weather
mountStarred({ map }); // W67 places: the starred places' marks, under the street labels (app/starred.js, SPEC §97)
const avoidLayer = mountAvoidLayer({ map, world }); // W80 avoidmap: the avoided streets' marks, from z13 (app/avoid-layer.js, SPEC §151)
mountAnchorages({ map, at, tilesFilter: () => { const l = style.layers.find((x) => x.id === "anchorage"); return l ? (packBoxes.length && withinBoxes(l.filter, packBoxes)) || l.filter : null; } }); // W82 packdraw, at the review: the tiles' racks take the packs' boxes; W56 parking: every anchorage when its tile is on (app/anchorages.js, SPEC §73; W86 map: no capacity); W77 split: asked for in the style's setup, as before the split, so a preview at ready counts Cambridge's racks (the re-review's P1); W102 trim (SPEC §202): now only when asked, the tile on or a preview's pad (app/course.js), which keeps that
const weather = mountWeather({ map, $, before: "comet-trail", theme: starchartTheme.current.theme, colour: (t) => [1, 3, 5].map((i) => parseInt((t === "light" ? TOK["color-light"] : C).caution.slice(i, i + 2), 16)), // W52 weather: the rain radar under the starpaths and the labels, and the parked chip (app/weather.js)
  chart: () => { try { return logView !== "page" && !aboutSheet.open; } catch { return false; } }, parked: () => { try { return !flight.flying; } catch { return true; } }, spot: () => lastFix?.lonlat ?? null, // W52 weather
  warm: (line) => import("../design/sound/sfx.js").then((s) => s.warm(line)) }); // W106 voicefix: a winter warning's clip as it comes (sfx.js is imported at initSound, below)
addEventListener("starchart:theme", (e) => weather.theme(e.detail.theme)); // W52 weather

// ---- you: the ship (TIG Spark Gap), over its heading beam and accuracy ring (SPEC §7, §17) ----------
await breathe(); // W77 split: the ship in its own task
const el = (tag, className) => Object.assign(document.createElement(tag), { className });
const shipBuild = () => (plain() ? "commuter" : "chibi"); // W63 rider: in Plain, a person on a bike (SPEC §91); SCUL, the ship
const ship = new ShipModel3D({ color: C, look: "toon", build: shipBuild(), avatar: avatarHex(C) }); // W21 shipin: the meshed ship, variant C (app/ship-model-layer.js); W63 rider: from the first frame; W86 avatar
onLingo(() => ship.setBuild(shipBuild())); // W63 rider: and live, a new mesh in the same layer
addEventListener("starchart:settings", (e) => { if (e.detail.key === AVATAR) ship.setAvatar(avatarHex(C)); }); // W86 avatar: Your color, live
mountAvatar({ group: $("set-avatar"), color: C, build: shipBuild }); // W86 avatar: its swatches in Settings
ship.motion.still = calm; // W21 shipin
keepLayer(map, ship); // W17 ship3d: one GL layer, standing up when the chart tilts; W39 ship: kept, as 0.1.10 lost it with the context
for (const type of ["pointerdown", "wheel"]) addEventListener(type, () => ship.cue("wake"), { passive: true, capture: true }); // W21 shipin: a touch anywhere
addEventListener("starchart:theme", () => { ship.setYou(getComputedStyle(document.documentElement).getPropertyValue("--you").trim()); map.triggerRepaint(); }); // W17 ship3d
let shipShown = false, shipPx = 64;
const HULL = 0.18; // the hull's half-width, as a share of the sprite's box
let p = null, spaceAt = null, ringPx = -1, spread = -1; // this frame's pose, and what the marks last showed
let est = null; // W31 navview: in a GPS gap on a course, { s, v, t, fed }: from s metres along the course at v m/s since t (estimate())
// An invisible symbol under the DOM ship keeps map labels from being drawn beneath it.
const shipSpace = (lonlat) => ({ type: "Feature", geometry: { type: "Point", coordinates: lonlat }, properties: {} });
map.addSource("ship-space", { type: "geojson", data: shipSpace(START) }); // W25 rest: START
map.addLayer({ id: "ship-space", type: "symbol", source: "ship-space",
  layout: { "icon-image": "landing_pad", "icon-size": 1.1, "icon-allow-overlap": true, "icon-rotation-alignment": "viewport" },
  paint: { "icon-opacity": 0 } });
const shipSize = () => {
  shipPx = Math.round(Math.max(48, Math.min(78, 68 + (map.getZoom() - 16) * 11)));
  if (ship.size !== shipPx) { ship.size = shipPx; map.triggerRepaint(); } // W17 ship3d
};
shipSize();
map.on("zoomend", () => { shipSize(); youMarks(); });

// ---- the star trail: the path flown since Launch (W16) ------------------------------------------
await breathe(); // W77 split
// One line source, sent again only when a fix moves the ship (1 Hz at most), never per frame
// (app/trail.js). A line in --you, your own blue, that fades a little toward the launch, over a soft glow,
// with a row of dust beside it; over the roads and the course, under the labels, the ship and the pills.
// W21 gps: it was --starlight, which read as one more road (arclight); blue is you, and no chart feature's.
// It stays after Land, so the whole flight shows at the landing pad, and goes at the next Launch.
const trail = new Trail();
map.addSource("trail", { type: "geojson", data: trail.geojson(), lineMetrics: true });
const zw = (a, b) => ["interpolate", ["linear"], ["zoom"], 12, a, 17, b];
const trailAt = map.getLayer("system-nebula") ? "system-nebula" : undefined;
const round = { "line-cap": "round", "line-join": "round" };
map.addLayer({ id: "trail-glow", type: "line", source: "trail", layout: round, paint: { "line-width": zw(6, 16), "line-blur": zw(4, 10), "line-opacity": 0.35 } }, trailAt); // W21 gps: a stronger glow
for (const [id, side, gap] of [["trail-dust", 1, 7], ["trail-dust-2", -1, 11]]) { // two rows of dust, out of step, so it sparkles
  map.addLayer({ id, type: "line", source: "trail", layout: round,
    paint: { "line-width": zw(1, 2), "line-offset": zw(2.5 * side, 6 * side), "line-dasharray": ["literal", [0, gap]], "line-opacity": 0.45 } }, trailAt);
}
map.addLayer({ id: "trail-casing", type: "line", source: "trail", layout: round, paint: { "line-width": zw(4.2, 6.4) } }, trailAt); // parts it from a wormhole's glow; W21 gps: wider
map.addLayer({ id: "trail", type: "line", source: "trail", layout: round, paint: { "line-width": zw(2, 3.4) } }, trailAt); // W21 gps: wider, so it reads as a line, not a street
/** The trail's ink, from the theme's --you (a darker blue on Daystar), on a --void casing. W21 gps: was --starlight */
function trailInk() {
  const css = getComputedStyle(document.documentElement), c = css.getPropertyValue("--you").trim(); // W21 gps
  const rgba = (hex, a) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(",")},${a})`;
  const flat = plain(); // W65 plainlook: in Plain one even line in your blue, with no fade, glow or dust
  const fade = (hex, a) => ["interpolate", ["linear"], ["line-progress"], 0, rgba(hex, flat ? a : a * 0.4), 0.6, rgba(hex, flat ? a : a * 0.75), 1, rgba(hex, a)]; // W21 gps: the launch end stays in view; W65 plainlook: flat
  for (const id of ["trail-glow", "trail-dust", "trail-dust-2"]) { map.setPaintProperty(id, "line-color", c); map.setLayoutProperty(id, "visibility", flat ? "none" : "visible"); } // W65 plainlook: visibility
  map.setPaintProperty("trail-casing", "line-gradient", fade(css.getPropertyValue("--void").trim(), 0.7));
  map.setPaintProperty("trail", "line-gradient", fade(c, 0.95));
}
trailInk();
addEventListener("starchart:theme", trailInk);
onLingo(trailInk); // W65 plainlook
// W39 ship (merge): between a WebGL context's restore and its style.load, MapLibre has no sources yet, so every app/ setData
// is `getSource(x)?.setData`: one update is dropped, the restored style keeps the data it had, and the next update draws.
const drawTrail = (end = null) => map.getSource("trail")?.setData(trail.geojson(end)); // end: the ship as drawn

// ---- the flight: parked, flying, landed with Undo (R7) -------------------------------------------
// Land, Undo, the Undo window, its timer line and the sticker run on real time (performance.now()), as
// the pilot lives them; only the flight's minutes count the demo's earth time, at its speed.
const flight = new FlightState();
const earthMs = (ms) => ms * (sim ? speed : 1);
let sticker = null, stickerTimer = 0; // the landed sticker (Land, below)

// ---- updates: never mid-flight, never in view (app/sw.js) --------------------------------------------
// A new version installs in the background. It takes over, with one reload, only while the app is out of
// sight (the screen locked, another app opened) and parked with nothing open; one already waiting at the start
// takes over at once, before the chart is in. W25 rest: it took over in view as soon as it had installed, so the
// first open after each deploy was usable at 3.4 s and reloaded at 14.1 s. (Waiting for every Starchart tab to
// close hid each update: a reload never closes the tab, so the phone kept the old version.)
let hadShell = "serviceWorker" in navigator && !!navigator.serviceWorker.controller; // not on a first visit
let staleShell = false; // another tab took an update while this one was flying
let forced = false; // W46 updates: Check for updates, the pilot's say: take it now, in view
let unfly = null; // W74 integrity: held from Launch to the final Land, so no tab's skip-waiting takes this one's cache (app/sw.js FLYING)
const flyingLock = (on) => { // W74 integrity: shared, so a second flying tab (a demo) holds it too
  if (on && !unfly) { let done = false, release = null; navigator.locks?.request("starchart:flying", { mode: "shared" }, () => (done ? null : new Promise((r) => { release = r; }))).catch(() => {}); unfly = () => { done = true; release?.(); }; } // W74 integrity
  else if (!on && unfly) { unfly(); unfly = null; } // W74 integrity
}; // W74 integrity
// Parked, and the landed sticker gone (a reload would wipe it): a Launch tap while loading counts as flying.
const parked = () => flight.state === "parked" && !sticker && (ready || launchTap === null)
  && !document.body.matches(".has-cfromto, .log-page, .log-flight") && !document.querySelector(".csheet:not(.cpreview)") && (!$("about-sheet").open || document.visibilityState === "hidden") && !$("welcome").open; // W46 updates: Settings, open as the app was left, holds nothing a reload would lose; W40 settings: nor the welcome (a reload would eat it); W21 entry: nor while a search, a sheet, Settings or the Log is open; W25 rest: nor the editor; W28 resume: a preview and the search come back after it
const unseen = () => document.visibilityState === "hidden" && (camera.mode !== "free" || !!nav.open.plan) && !(calls.pop && !calls.pop.hidden); // W28 resume: a preview's framing comes back with it // W25 rest: out of sight, and nor a panned chart or the sound's chooser (only once the chart is in)
const takeUpdate = (atStart = false) => swReg.then((reg) => { if (parked() && (atStart ? !ready : ready && unseen())) reg?.waiting?.postMessage("skip-waiting"); }); // W25 rest: atStart, unseen
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("controllerchange", () => {
  if (!hadShell) { hadShell = true; return; } // W46 updates: a first visit's own worker taking over; the page went on without one, and later updates came to nothing
  if (forced || (parked() && (!ready || unseen()))) location.reload(); else staleShell = true; // W25 rest: !ready, unseen; W46 updates: forced
});
// W46 updates: ask the server at each show and every 30 minutes in view, not only at a cold start. The installed app
// comes back from the background with no navigation, and so with no update check of the browser's own.
const askServer = () => swReg.then((reg) => reg?.update()).catch(() => {});
setInterval(() => { if (document.visibilityState === "visible") askServer(); }, 30 * 60_000);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") askServer(); });
swReg.then((reg) => {
  reg?.addEventListener("updatefound", () => {
    const w = reg.installing;
    w?.addEventListener("statechange", () => { if (w.state === "installed") takeUpdate(); });
  });
  takeUpdate(true); // one that finished installing on an earlier visit; W25 rest: true
});
/** Parked again (the Undo window over, or the sticker gone), or out of sight: take a waiting update. */
const parkedAgain = () => { if (parked() && ready && unseen()) { if (staleShell) location.reload(); else takeUpdate(); } }; // W25 rest: ready, unseen
new MutationObserver(() => parkedAgain()).observe(document.body, { attributes: true, attributeFilter: ["class"] }); // W21 entry: and again as each one closes
$("about-sheet").addEventListener("close", () => parkedAgain()); // W21 entry
document.addEventListener("visibilitychange", () => parkedAgain()); // W25 rest: out of sight
// W46 updates: About › Developer's Check for updates and Reload the app's code (SPEC §57). A tap is the pilot's say, so
// either may reload in view; never mid-flight. `cache: "no-store"` goes past the service worker (app/sw.js).
const shellCaches = () => caches.keys().then((ks) => ks.filter((k) => k.startsWith("starchart-") && k !== "starchart-voice" && k !== "starchart-glyphs"));
$("check-update").onclick = async () => {
  const row = $("check-update");
  if (flight.state !== "parked") return tip(row, pick("Land first, then update.", "End the ride first, then update.")); // W60 a
  const reg = await swReg;
  if (!reg) return tip(row, `No service worker here: each reload is the latest. ${VERSION}`);
  if (!navigator.onLine) return tip(row, "Offline: the check needs a signal.");
  const otherFlies = async () => !!(await navigator.locks?.query().catch(() => null))?.held?.some((l) => l.name === "starchart:flying"); // W74 integrity
  const flyMsg = () => pick("Another tab is flying: update after it lands.", "Another tab is riding: update after it ends."); // W74 integrity
  if (await otherFlies()) return tip(row, flyMsg()); // W74 integrity: app/sw.js would hold the update, and a forced one would reload here later
  try {
    await reg.update();
    const w = reg.installing || reg.waiting;
    if (!w) return tip(row, `Up to date: ${build.version} ${release.release}`);
    const next = await fetch("app/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    tip(row, next ? `Updating to ${next.version} ${next.release}…` : "Updating…", { ms: 10_000 });
    forced = true;
    const take = async () => { if (w.state === "installed") { if (await otherFlies()) { forced = false; tip(row, flyMsg()); } else w.postMessage("skip-waiting"); } else if (w.state === "redundant") { forced = false; tip(row, "The update didn't install. Try again later."); } };
    w.addEventListener("statechange", take); take();
  } catch { tip(row, navigator.onLine ? "The server didn't answer. Try again later." : "Offline: the check needs a signal."); }
};
$("reload-code").onclick = async () => {
  const row = $("reload-code");
  if (flight.state !== "parked") return tip(row, pick("Land first, then reload.", "End the ride first, then reload.")); // W60 a
  if (!navigator.onLine) return tip(row, "Offline: the reload needs a signal."); // W73 logsafe: offline, the shell it deletes couldn't come back
  tip(row, "Reloading the app's code…", { ms: 10_000 });
  if (!await fetch("build.json", { cache: "no-store" }).then((r) => r.ok, () => false)) return tip(row, "The server didn't answer. Try again later."); // W73 logsafe: the caches go only once the server answers
  for (const k of await shellCaches()) await caches.delete(k);
  for (const r of await navigator.serviceWorker?.getRegistrations() ?? []) await r.unregister();
  location.reload();
};
let course = null, engine = null, lastS = -1, ready = false;
/** The flight's course, from the pose's fixes: the path flown, and a straight look-ahead (app/live-course.js). */
const wormTags = (p) => (world.ready(p, 50) && world.roadsNear(p, 12)[0]?.properties.bike === "wormhole" ? "highway=cycleway" : "");
function pushFix(f) {
  if (!course) return;
  const [at, tags, opts] = forCourse(f, wormTags); // W21 gps: the road it holds, else the smoothed fix
  if (f.speed_mps >= 1 || !course.pts.length) course.push(at, f.course_deg ?? course.headingNow, tags, opts); // W21 gps
  else if (f.course_deg !== null && f.course_deg !== undefined) course.turn(f.course_deg);
  moments();
}
/** The moments run at every fix, so the engine sees each step of the course however slow the frames are
 *  (two fixes in one slow frame used to reach it as one step); the frame loop only catches up the first
 *  steps once the world is ready. They run only in flight, once the world has the tiles. */
function moments() {
  if (!(ready && flight.flying && course && course.pts.length && course.s !== lastS)) return;
  lastS = course.s;
  try { if (!nav.moments(course.s)) engine.update(course.s); } catch (err) { console.error(err); } // W17 course: a set course's engine instead
}

// ---- banners: pills above the readout, never over the ship, only in flight -------------------------
const GLYPHS = at("design/glyphs/");
const pills = new PillQueue($("banner"), ship, { hold: 3120 }); // W17 ship3d: its box on the screen; W73 polish: hold, the pill's 320 ms in, 2.6 s held and 200 ms out (app.css .bpill)
addEventListener("starchart:event", (e) => record.event(e.detail.kind)); // W17 log: pulsars and black holes passed
addEventListener("starchart:event", (e) => { const d = e.detail.data; if (e.detail.kind === "course_turn" && d?.stage === "now" && !d.again) haptic(turnSide(d.turn)); }); // W69 motion: Buzz the turns, off by default
addEventListener("starchart:event", (e) => tallyTick(e.detail.kind, plain())); // W73 delight: a tally's +1 ticks
addEventListener("starchart:event", (e) => {
  if (!flight.flying || NO_BANNER.has(e.detail.kind) || e.detail.kind === "launch") return;
  const b = bannerPill(e.detail, mode, { glyphs: GLYPHS }); // W54 flight: b
  if (e.detail.kind === "steps_ahead") b.prepend(el("i", "i i-steps glyph")); // W54 flight: the steps, drawn in CSS (app/turns.css)
  if (e.detail.kind === "tracks_ahead") b.prepend(el("i", "i i-tracks glyph")); // W67 graph3: the tracks, drawn in CSS (app/turns.css)
  if (e.detail.kind === "stop_ahead") b.prepend(el("i", "i i-stop glyph")); // W86 stops: the octagon, drawn in CSS (app/turns.css)
  pills.push(b); // W54 flight
});
await breathe(); // W77 split: the course and its search in their own task
let rough = null; // W21 entry: only rough positions (app/rough.js), mounted below with the camera
whereTo.onfocus = null; // W47 firstload: app/course.js has it now
const nav = mountCourse({ map, maplibregl, lingo, world, data, at, flight, pills, pose, packs, engine: () => engine, launch: () => launch(performance.now()), // W17 course; W82 packmap and packui: packs (mounted with the chart, above, before the course's search and offer)
  here: () => (lastFix ? lastFix.lonlat : shipShown ? ship.lngLat.slice() : rough?.spot() ?? PAD), earthMs, // W17 course; W21 entry: rough?.spot()
  origin: () => (sim || lastFix || shipShown ? "your ship" : rough?.spot() ? "your rough position" : null), canLaunch: () => sim || !NO_POSITION.has(gps.gps), lastFix: () => lastFix, flow, weather, // W21 entry: from the Fort without a ship; no Launch without GPS; W22 pretty: flow; W54 course: weather
  framing: (on, moved = false) => { // W25 course: while a sheet frames the chart, parked, the camera lets go of the ship and the no-location sheet steps aside; W27 card: moved, the pilot moved the chart meanwhile
    if (on) { sheetCam = flight.flying ? null : camera.mode; if (sheetCam) camera.setMode("free", { move: false }); nogpsAside = !$("nogps").hidden; if (nogpsAside) showNoGps(false); return; }
    if (sheetCam && !moved) camera.setMode(sheetCam, { move: false }); // W27 card: moved, it stays free where the pilot left it
    if (nogpsAside) showNoGps(true);
    sheetCam = null; nogpsAside = false;
  }, noPosition: () => { nogpsAside = false; showNoGps(true, { focus: true }); }, gpsLost: () => lost() > 0, // W25 course: Launch with location off says why, over the preview
  planned: (s) => record.stats?.planned(s, pace()), reached: () => record.stats?.reached(), // W59 pace: planned against flown, for the Log
  transit: () => transit, gap: (on) => { record.gap = on; }, walk: () => walk, afoot: () => { afoot = true; afootWords(); } }); // W79 walkgo: afoot, before its Launch // W62 cometcard: bike plus comet's card; the train leg, a gap in the Log // W73 walk: walk
const transit = mountTransit({ data, at, router: () => nav.routerReady(), weather }); // W61 transit; W62 cometcard: here, for the course
const walk = mountWalk({ data, at, router: () => nav.routerReady() }); // W73 walk: on foot and by T
// W79 walkgo (SPEC §148): a walk isn't a ride. From a walker's plan's Start to the final Land nothing goes to the Log (Recorder
// drop()), the readout reads mph and mi in both modes, Land says "Space walk ended" / "Walk ended", and there is no sticker.
let afoot = false; // W79 walkgo
function afootWords() { // W79 walkgo: after app/first.js's swapWords, as the Words change too
  const put = (sel, t) => { const n = document.querySelector(sel); if (n && n.textContent !== t) n.textContent = t; }; // W79 walkgo
  put("#readout .warp .lbl", afoot ? "mph" : pick("Warp", "mph")); put("#ly + .lbl", afoot ? "mi" : pick("LY", "mi")); put("#snack .t", afoot ? pick(WALKW.landed) : pick("Landed", "Ride ended")); // W79 walkgo
} // W79 walkgo
onLingo(afootWords); // W79 walkgo
starchartTheme.attach(map, { style, motion, tokens: TOK, at }); // W15 themes: switch the chart at runtime; W77 split: here, so its first starchart:theme (a microtask) comes once every listener above is in, as before the split
addEventListener("starchart:settings", (e) => { if (e.detail.key === "starchart.transit") { if (e.detail.value === "on") transit.enable(); else transit.disable(); } }); // W62 cometcard: on, the timetable at once (the data guard's rules); off, no plan asked
let sheetCam = null, nogpsAside = false; // W25 course
const radiation = mountRadiation({ weather, flying: () => flight.flying, ship: () => lastFix?.lonlat ?? null, // W54 flight: the rain ahead in flight, once a band (app/radiation.js)
  course: () => (nav.cf?.last && !nav.cf.last.off ? { course: nav.cf.course, s: nav.cf.s, v: nav.cf.speed() } : null), fire: (d) => dispatchEvent(new CustomEvent("starchart:event", { detail: d })) }); // W54 flight
const dusk = mountDusk({ flying: () => flight.flying, quiet: () => calm || soundMode() === "off" || !spoken("daystar_set"), fire: (d) => dispatchEvent(new CustomEvent("starchart:event", { detail: d })) }); // W73 dark: lights on at sunset, once a flight, only With chatter
starchartTheme.hold = () => turnNear({ flying: flight.flying, turnIn: nav.turnIn, speed: nav.cf?.speed() }); // W73 dark: By the sun waits while a turn is within 20 s
/** W54 course (SPEC §69): a #course= link: its preview, and the hash taken off the address (it never reached the host). */
const sharedCourse = () => { const h = location.hash; if (!h.startsWith("#course=") && !h.startsWith("#pin=")) return false; history.replaceState(null, "", location.pathname + location.search); if (h.startsWith("#pin=")) nav.openPin(h); else nav.openLink(h); return true; }; // W54 course; W67 places: #pin=, one place
addEventListener("hashchange", () => { if (ready) sharedCourse(); }); // W54 course: a link opened in the app's own tab
onShare((s) => { // W67 routefile: a shared route file opens as a course
  if (s.files[0]) return nav.openFile(s.files[0]);
  const text = [s.title, s.text, s.url].filter(Boolean).join("\n"); // W67 merge: a shared link, coordinates or a name: places' parser
  if (text && !nav.openText(text)) tip(document.querySelector("#gobar") || document.body, "No place in what was shared."); // W67 merge
});

// ---- sound: the icon only, a speaker with waves or with an X (R8) -------------------------------
const sfx = await initSound({ muted: soundMode() === "off" }); // W15 settings: kept on this phone; W28 settings: Sound's Off
const soundBtn = $("sound");
addEventListener("starchart:settings", (e) => { if (e.detail.key === SOUND && (soundMode() === "off") !== isSilent()) sfx.setSilentRunning(soundMode() === "off", { cue: sounded("silent_running") }); }); // W28 settings; W86 settings: its cue a tap's, only in All
why(soundBtn, null); // W24 quiet: wired
sfx.setVoiceFilter(spoken, sounded); // W18 controls; W28 settings: Directions or with chatter decide which lines are spoken; banners stay; W86 settings: and a tap's sounds only with chatter
sfx.setPlainSound(plain()); onLingo(() => sfx.setPlainSound(plain())); // W65 plainlook: Plain's quiet sounds, live (design/sound/sfx.js)
setSfx(sfx); // W73 delight
mountVoices({ group: $("set-voice"), build, sfx, url: at }); // W97 voices: Settings › Sound › Voice, and the picked voice from the first line
const calls = mountSoundPick({ button: soundBtn, settings: () => $("about").click() }); longPress(soundBtn, calls.open); // W18 controls; W28 settings: the chooser of the three; W75 chrome: and Settings, in flight, as the gear's tap
soundBtn.addEventListener("keydown", (e) => { if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) { e.preventDefault(); calls.open(); calls.pop.querySelector("[aria-checked=true]")?.focus(); } }); // W75 chrome: the hold's keys, so a keyboard reaches Settings in flight
soundBtn.onclick = () => { toggleSound(); if (!tipOnce("sound", soundBtn, "Hold for the sound choices.")) tip(soundBtn, soundWords()); }; // W28 launch: a first-time tip, after the first tap; W34 cues: else the bubble says which
addEventListener("click", (e) => { const c = e.target.closest?.(".cturn"); if (c && !e.target.closest("button") && soundMode() === "off") tip(c, "Sound is off."); }); // W34 cues: a tap on the turn card says the turn again, or why it can't

// ---- the camera, the location button and the compass (R2, R3) -------------------------------------
const camera = new FollowCamera(map, { mode: "follow" }); // W29 polish: its glides play in Calm too (BRIEF §7.8)
camera.padding = padFor; // W26 relief: the padding eases with the camera's change of mode
// W31 navview: in flight, following, the zoom follows the street's speed and the rider's (follow.js AUTO; SPEC §43). The
// stretch ahead runs from the ship to the turn card's room at the top, kept with or without a course so it never jumps.
const autoZoom = new AutoZoom(), CARD_PX = 130;
function roadZoom(f, mode = camera.mode) {
  if (!flight.flying || !f || nav.open.plan) return camera.setAuto(null); // parked, or a preview frames the chart
  const pd = padFor(mode), h = map.getContainer().clientHeight, y = pd.top + (h - pd.top - pd.bottom) / 2, px = y - Math.min(CARD_PX, 0.3 * y); // from the ship up, less the card's room: 130 px, or 30 % on a short screen
  camera.setAuto(autoZoom.update({ street: streetMps(f.match?.on ? f.match.props : null), rider: f.speed_mps || 0, lat: f.lonlat[1], px,
    turn: nav.turnIn, t: performance.now() }));
}
if (sim) { // W25 rest: the demo's ship sits on its pad, the Fort's, until Launch, and the location button goes to it (entry B3)
  shipShown = ship.on = true; ship.lngLat = PAD.slice(); ship.heading = camera.bearing = bearing(PAD, demoGJ.features[0].geometry.coordinates[1]);
  camera.update(PAD, ship.heading, 0); // W27 friction: no "Demo · Use GPS" chip; ?sim=demo is a hidden address for the tests
}
if (!sim) rough = mountRough({ map, core: pose.core, shown: () => shipShown, free: () => camera.mode === "free" }); // W21 entry
const shipGuard = mountShipGuard(map, ship); // W39 ship: the ship back on, or its layer again, if it stops drawing (app/ship-guard.js)
mountsIn(); // W77 split: the ship is placed, so the hexes may go
const LOC = {
  free: ["Location: free. Tap to follow your ship", "Location: free. Tap to follow you"], follow: // W60 a: a pair, picked where it is shown
    "Location: following, north up. Tap for heading up",
  turned: "Location: following. Tap for heading up", // follow at the bearing the pilot turned the chart to
  heading: "Location: following your heading. Tap for north up", searching: "Location: searching", off: "Location: off. Tap for help",
};
const locBtn = $("locate");
let locShown = "", locLabel = "";
function showLocate() {
  const s = NO_POSITION.has(gps.gps) && !sim ? "off" : shipShown ? camera.mode : "searching";
  const label = pick(LOC[s === "follow" && compassOff ? "turned" : s]) + ( // W60 a: pick
   lost() && s !== "off" ? ". GPS lost" : ""); // W21 flight
  ship.dim(Boolean(lost()) || !!est || (ship.on && !shipShown) || s === "off"); // W31 navview: est, an estimate in a GPS gap // W21 flight F2: dim while GPS is lost, whatever the button shows, and at a rough spot; W25 rest: and once location is taken away (entry B5)
  if (s === locShown && label === locLabel) return;
  locShown = s; locLabel = label;
  locBtn.className = "btn " + s + (label.endsWith("GPS lost") ? " lost" : ""); // W21 flight: it breathes
  locBtn.setAttribute("aria-label", label);
}
locBtn.onclick = () => {
  if (locShown === "off") return showNoGps(true, { focus: true });
  const was = camera.mode; // W34 cues
  if (flight.flying && camera.mode === "free" && freedFrom === "heading") camera.setMode("heading"); else camera.cycle(); // W21 flight: back to heading-up, as Google's Re-centre
  // The chart goes to the ship wherever it shows, dim or not: at a rough spot, or where GPS was lost (arclight, 2026-10-16:
  // "if you're displaying a faded marker, the arrow should still take me to the faded marker"); the camera has its spot.
  if (shipShown) fx.ping(); // W15 chart: the ping
  const turned = !shipShown ? null : camera.mode === "heading" ? "Heading up." : was === "heading" ? "North up." : null; // W34 cues: the chart turned round the ship, and the bubble says which way is up
  // W21 flight: #nofix says it already. A tap always answers (arclight: "if a button ever does not do anything, it should
  // at least emit a short bubble explaining why"): why the ship is dim, or that there is no position yet to go to.
  if (!sim && $("nofix").hidden && (lost() || !shipShown)) showLocTip(shipShown ? "GPS lost: showing your last fix." : null); // else the rough accuracy, or "Coordinates unknown."
  else if (turned) tip(locBtn, turned); // W34 cues
};
/** W25 rest (arclight's call): the Chart tab on the chart recentres on the ship, as tab bars do; with no ship, the bubble says
 *  why, as the location button's does. It replaces W24 quiet's "You're on the chart." */
function recentre(tab) {
  if (!ship.on) return showLocTip(null, tab);
  if (camera.mode === "free") camera.setMode("follow"); // parked: the bar shows only then
  fx.ping();
  if (lost() || !shipShown) showLocTip(shipShown ? "GPS lost: showing your last fix." : null, tab);
}
/** W25 rest (arclight's call): the first time the chart parks on the pilot's ship, ever, one passing hint by the ship. It goes
 *  by itself and never comes back. Not in the demo, whose ship is a show. */
function holdHint() {
  if (sim || !ready || !shipShown || flight.state !== "parked") return;
  tipOnce("hold", ship, pick("Hold the chart to set a course.", "Hold the chart to get directions.")); // W60 a: pick // W28 launch: a first-time tip (app/tips.js), with its ×, beside the ship
}
// W28 launch: the first-time tips show only off the demo, with nothing open, and in flight only about safety (app/tips.js)
tipGate((inFlight, inSheet) => !sim && (inFlight || !flight.flying) && !document.body.matches(`.has-csearch, ${inSheet ? "" : ".has-csheet, "}.has-cfromto, .log-page, .log-flight`) && !$("about-sheet").open && !$("welcome").open); // W35 welcome: nor while the welcome is up; W49 cards: a sheet's own tip, in it
// W21 locate: the button's answer when real GPS has no position yet (arclight: "a short 'Coordinates unknown' or
// something, for feedback"). Beside the button, for 2.5 s. The demo has no GPS to wait for, so it never says this.
function showLocTip(text = null, anchor = locBtn) { // W25 rest: anchor
  const r = roughM(pose.core.log, pose.core.fix);
  tip(anchor, text ?? (r !== null ? `Only a rough position, ±${r} m.` : "Coordinates unknown.")); // W24 quiet: the one bubble (app/tip.js)
}
/** While following, a pinch zooms around the ship's spot, so the ship does not slide away. A wheel zooms where the mouse
 *  is, as on Google Maps (arclight, 2026-10-16): with the mouse on the ship it keeps following and zooms around it;
 *  anywhere else it lets go of the ship first, as a drag does, and the locate button brings it back. */
const ON_SHIP_PX = 48;
let wheelCentre = null, mouseOnShip = false;
function wheelAround(centre) { if (centre !== wheelCentre) { wheelCentre = centre; map.scrollZoom.disable(); map.scrollZoom.enable(centre ? { around: "center" } : undefined); } }
function aroundShip(on) {
  map.touchZoomRotate.disable(); map.touchZoomRotate.enable(on ? { around: "center" } : undefined);
  wheelAround(on && mouseOnShip);
}
aroundShip(true);
{
  const box = map.getCanvasContainer();
  const onShip = (e) => {
    if (!ship.on || !ship.lngLat) return false;
    const r = box.getBoundingClientRect(), q = map.project(ship.lngLat);
    return Math.hypot(e.clientX - r.left - q.x, e.clientY - r.top - q.y) <= ON_SHIP_PX;
  };
  box.addEventListener("mousemove", (e) => { mouseOnShip = onShip(e); if (camera.mode !== "free") wheelAround(mouseOnShip); }, { passive: true });
  // Before MapLibre's own handler sees the wheel (it listens on the same box, without capture).
  box.addEventListener("wheel", (e) => {
    mouseOnShip = onShip(e);
    if (camera.mode === "free") return;
    if (mouseOnShip) wheelAround(true); else camera.setMode("free", { move: false });
  }, { capture: true, passive: true });
}
const compass = $("compass"), dial = $("dial");
let compassOff = null;
function showBearing() {
  const b = map.getBearing();
  dial.style.transform = `rotate(${-b}deg)`;
  const off = camera.mode === "heading" || Math.abs(((b + 540) % 360) - 180) > 1 || map.getPitch() > 1; // W15 chart: or tilted
  if (off === compassOff) return;
  compassOff = off;
  compass.classList.toggle("hide", !off);
  compass.tabIndex = off ? 0 : -1;
  compass.setAttribute("aria-hidden", String(!off));
  showLocate();
}
compass.classList.add("hide");
compass.hidden = false;
showBearing();
map.on("rotate", showBearing);
map.on("pitch", showBearing); // W15 chart
/** W18 controls: north up, the compass fading with the glide rather than after it (settled within 300 ms). */
function northUp() { camera.northUp(); compass.classList.add("hide"); setTimeout(() => { compassOff = null; showBearing(); }, camera.glideEnd - Date.now()); } // then true again, if a drag cut the glide short; W29 polish: after the glide, which scales with the turn
compass.onclick = () => { northUp(); tip(compass, "North up."); }; // W18 controls; W34 cues: the bubble
map.on("moveend", () => { if (compassOff && !flight.flying) tipOnce("compass", compass, "Hold the compass to tilt the chart."); }); // W28 launch: a first-time tip
longPress(compass, () => { // W18 controls: flat or tilted, and Tilt while flying (Settings) to match
  const ahead = flight.flying && camera.mode === "heading", tilted = ahead ? setting("starchart.tilt") === "tilted" : map.getPitch() > 1;
  setSetting("starchart.tilt", tilted ? "flat" : "tilted"); // heading-up eases to it (app/fx.js)
  if (!ahead) map.easeTo({ pitch: tilted ? 0 : 45, duration: glideMs(45), essential: true }); // W29 polish: a glide in Calm too, and with the phone's reduced motion
});
let freedFrom = null; // W21 flight: the mode a drag let go of
// W31 navview (audit #11): in flight with a course, a panned chart glides back to following after BACK_MS with no touch, so a
// bump on the bars can't leave the rider looking elsewhere. A ring on the location button counts down; any touch starts it
// again. Parked, or in flight with no course, nothing moves by itself (BRIEF §7.8).
const BACK_MS = 10_000;
let freeAt = 0, pokedAt = 0;
for (const ev of ["pointerdown", "wheel", "keydown"]) addEventListener(ev, () => { pokedAt = performance.now(); }, { capture: true, passive: true });
function comeBack(now) {
  const on = flight.flying && nav.active && camera.mode === "free" && !logView && !aboutSheet.open && !nav.open.plan
    && !document.body.matches(".has-csheet, .has-csearch, .has-cfromto");
  const left = on ? BACK_MS - (now - Math.max(freeAt, pokedAt, lastTouch)) : 0;
  if (on && left <= 0) camera.setMode(freedFrom === "heading" ? "heading" : "follow"); // as the location button would
  if (on && left > 0) { locBtn.dataset.back = ""; locBtn.style.setProperty("--back", (1 - left / BACK_MS).toFixed(3)); }
  else if ("back" in locBtn.dataset) { delete locBtn.dataset.back; locBtn.style.removeProperty("--back"); }
}
// W54 flight (SPEC §70; Google's overview): in flight on a course, a glass button frames the rest of the course, from the
// ship to the landing pad, gliding (a camera control, BRIEF §7.8), turned as the chart was and flat. A tap again, or 10 s
// with no touch (BACK_MS, above), and it is back to following. The camera is free meanwhile, as after a drag.
const overview = $("overview");
let overviewOn = false;
function clearOf() { // W75 chrome: from overviewFrame, for restShown too
  const card = document.querySelector(".cturn:not([hidden])")?.getBoundingClientRect(), ro = $("readout").getBoundingClientRect(), h = innerHeight;
  const want = { top: (card ? card.bottom : 60) + 24, bottom: h - Math.min(ro.top || h, h) + 24, left: 60, right: 60 }; // clear of the card, the readout and the right column
  if (card && card.width < innerWidth * 0.7) want.left = card.right + 24, want.top = 40; // landscape: the card at the left
  return want;
}
function overviewFrame() { // W54 flight
  const cf = nav.cf, pts = restOf(cf.course, cf.s, ship.lngLat); // W75 chrome: restOf
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]), cur = map.getPadding(), want = clearOf(); // W75 chrome: clearOf
  const padding = Object.fromEntries(Object.entries(want).map(([k, v]) => [k, Math.max(8, v - (cur[k] || 0))]));
  overviewOn = true;
  camera.setMode("free", { move: false });
  map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding, bearing: map.getBearing(), pitch: 0, maxZoom: 17,
    duration: glideMs(180), essential: true }); // the longest glide, 400 ms: a reframe
}
why(overview, null); // W54 flight: wired
overview.onclick = () => { // W54 flight
  if (!(flight.flying && nav.cf)) return tip(overview, pick("No course to show.", "No route to show.")); // W60 a: pick
  if (overviewOn && camera.mode === "free") return camera.setMode(freedFrom === "heading" ? "heading" : "follow"); // back, as the location button would
  overviewFrame();
};
// W75 chrome (D14a, SPEC §131): it steps out while the whole rest of the course is already on screen, clear of the card
// and the readout, as its frame would put it; checked once a second. Lit, it stays: then it is the way back.
let restShown = false, restAt = -Infinity;
function overviewTick() { // W54 flight: shown in flight on a course; lit while it frames it
  const on = flight.flying && nav.active && !!nav.cf, now = performance.now(); // W75 chrome
  if (!on) restAt = -Infinity; // W75 chrome: checked at once in the next flight
  else if (overviewOn) restShown = false, restAt = now; // W75 chrome: framing; checked again a second after the glide back
  else if (now - restAt >= 1000) { // W75 chrome
    restAt = now;
    const w = clearOf(), area = { left: w.left, top: w.top, right: innerWidth - w.right, bottom: innerHeight - w.bottom };
    restShown = allInside(restOf(nav.cf.course, nav.cf.s, ship.lngLat).map((p) => { const q = map.project(p); return [q.x, q.y]; }), area);
  }
  if (overviewOn && camera.mode !== "free") overviewOn = false;
  const show = on && (overviewOn || !restShown); // W75 chrome: overviewOn, restShown
  if (overview.hidden === show) overview.hidden = !show;
  const lit = String(overviewOn);
  if (overview.getAttribute("aria-pressed") !== lit) overview.setAttribute("aria-pressed", lit);
}
const youArrow = mountYouArrow(map), pointYou = () => youArrow.update(camera.mode === "free" && ship.on && !ship.away, ship.lngLat); // W21 flight: the ship off the screen
map.on("move", pointYou); // W21 flight
camera.onmode = (m, was) => { padMode = m; if (m === "free") { freedFrom = was; freeAt = performance.now(); } // W31 navview: freeAt
  aroundShip(m !== "free"); showLocate(); showBearing(); nav.moded(); }; // W104 oss2 fix pass 2: nav.moded // W21 flight: was; W26 relief: padMode
fx.attach({ map, maplibregl, ship, camera, s: () => course?.s ?? null }); // W15 chart, W17 ship3d

// ---- W17 log: the bottom bar while parked, and the Log (app/log.js). hold() is the Log's view: "page" covers
// the chart, so the frame loop pauses; "route" shows a flight, so the live camera lets go until the Chart tab.
let logView = null, logCam = null;
let wakeLoop = () => {}; // W77 rest: the frame loop's, once it is set up (below); asleep, it asks for frames again
function hold(view) {
  wakeLoop(); // W77 rest: the Log uncovered, or a flight's page
  if (view && !logView) logCam = { mode: camera.mode, center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
  if (view === "route") { camera.setMode("free", { move: false }); map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 }); } // a flight's page: not you, live (W39 ship: ship.away, in step())
  if (!view && logView) { pad(false, logCam.mode); map.jumpTo(logCam); camera.setMode(logCam.mode); ship.cue("wake"); } // the chart as it was; W21 shipin; W26 relief: logCam.mode
  logView = view;
}
const blackbox = new BlackBox(localStorage), logbook = new Logbook();
const record = new Recorder(blackbox, { counts: !sim, sink: logbook }); // the demo records nothing; GPS tracks go to the logbook
const ghosts = mountGhosts({ map, maplibregl, box: blackbox, logbook }); // W73 ghosts: the past flights, faint on the chart
const log = mountLog({ map, maplibregl, box: blackbox, logbook, at, hold, demo: sim, recentre, again: (line) => nav.openRoute(line), feedback: (lines) => feedbackPage.open(lines), ghosts }); // W21 logfix: demo; W25 rest: recentre; W67 routefile: again, Fly again's course; W74 flightlog: feedback; W73 ghosts: ghosts, for the season chart
log.current = () => (record.guard ? record.id : "");
logbook.onfail = () => log.say("Track not saved: storage full"); // W40 log: once a flight, in plain words (was silent)
// W28 resume: the flight is kept on this phone, every 15 s and as the page goes out of sight, and carried on at the next open
// (app/resume.js); parked, the preview or the search that is open. In flight, the first back at the root stays.
const keeper = flightKeeper(localStorage), kept = ours ? keptHere : null; // W40 log: ours
const epochOf = (t) => Date.now() - (performance.now() - t);
let lastKept = 0; // a resumed flight's last fix, until a new one comes
function keepFlight(hiding = false) {
  const rec = flight.state !== "parked" && record.snapshot(hiding);
  if (!rec) return;
  keeper.keep({ rec, launched: epochOf(flight.t0), last: fixedAt >= launchedAt ? epochOf(fixedAt) : lastKept || epochOf(flight.t0),
    metres: flight.metres(course ? course.s : 0), minutes: readouts.earthMinutes, trail: trail.lines, tally: { hi_five: tally.hi_five, cup_crush: tally.cup_crush },
    course: nav.kept, camera: camera.mode === "follow" ? "follow" : "heading", landed: flight.state === "landed" });
}
let keepTimer = setInterval(() => keepFlight(), KEEP_MS); // W77 rest: keepTimer, stopped while the parked chart sleeps
const keepAll = () => { if (flight.state === "parked") keepParked(localStorage, nav.open); else keepFlight(true); };
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") keepAll(); });
addEventListener("pagehide", keepAll);
const guard = backGuard({ say: () => tip($("land"), pick("Back again to leave. Your flight resumes when you come back.", "Back again to leave. Your ride resumes when you come back."), { ms: 3000 }) /* W60 a: pick */,
  make: () => (matchMedia("(pointer: coarse)").matches && window.CloseWatcher ? new CloseWatcher() : null) }); // W29 polish: touch screens only, as a desktop's CloseWatcher hears Escape too
/** Too long away, or landed: the flight goes to the Log as it was, with a note and no question (pilots are adults). */
function saveKept(k) {
  record.resume(k.rec);
  const end = k.landed ? k.at : k.last || k.launched;
  const f = record.final({ metres: k.metres, minutes: k.landed ? k.minutes : Math.floor((end - k.launched) / 60000), end });
  keeper.forget(); owner.release(); // W40 log
  if (f) { if (!log.dropTiny(f)) log.kept(f); } else log.say(pick("Log full: flight not saved", "Log full: ride not saved")); // W60 a: pick; W68 logbulk: dropTiny
}
if (kept && verdict(kept) === "save") saveKept(kept);
if (logTap) log.open(); // W25 rest: a tap on the Log tab while the chart loaded

// ---- the readout, four times a second at most, never per frame -------------------------------------
const put = writer($); const warpBox = document.querySelector("#readout .warp"), minsBox = $("mins").parentElement, rideBox = $("readout"); // W25 rest; W86 ride: minsBox; W88 ridemodes: rideBox
odometer([$("ly"), $("mins"), $("left")]); // W73 delight: their digits roll; W88 ridemodes: the minutes left too
const readouts = { warp: 0, ly: 0, earthMinutes: 0, metres: 0 };
/** W27 friction: the light years the Log counts: a stretch over 35 mph for more than 20 s is left out (the car guard). */
const countedLy = () => Math.max(0, readouts.metres - (record.guard?.excluded ?? 0)) / LY;
function hud() {
  const now = performance.now();
  if (mission.due(now)) p = pose.sample(now); // W73 mission x W77 rest: under the long-haul screen the loop sleeps, so this 4 Hz timer samples the pose for its warp
  nav.beat(); // W77 rest: the course's four times a second, in this one timer
  comeBack(now); estimate(now); overviewTick(); // W31 navview; W54 flight: overviewTick
  const rolling = !sim && flight.state === "landed" && lastFix?.speed_mps > 3 && now - fixedAt < 5000; // W21 flight: Land at speed keeps Undo
  if (rolling !== snack.classList.contains("hold")) { snack.classList.toggle("hold", rolling); if (!rolling) { snack.classList.remove("run"); void snack.offsetWidth; snack.classList.add("run"); } } // W21 flight: the timer runs once it slows
  if (flight.tick(now, rolling)) { showFlight(); parkedAgain(); landed(); } // W15 settings: the Black Box and the chatter
  if (flight.state !== "parked") {
    const m = flight.metres(course ? course.s : 0);
    Object.assign(readouts, { warp: flight.flying && p ? Math.round(p.speed_mps / MPH) : 0, ly: +(Math.max(0, m - (record.gapM || 0)) / LY).toFixed(2), // W62 cometcard, at the merge: no LY on the comet
      earthMinutes: Math.floor(earthMs(flight.elapsed(now)) / 60000), metres: m });
    put("warp", lost() ? "–" : String(readouts.warp)); // W21 flight: no fix, no speed
    warpBox.classList.toggle("lost", Boolean(lost())); // W25 rest: "No fix" under it
    put("ly", readouts.ly.toFixed(2));
    const cf = nav.cf, eta = flight.flying && cf && !nav.leg ? etaOf(cf.last?.left ?? cf.length, cf.speed()) : null; // W86 ride: on a course (not a comet's or a walk's legs), the arrival as the card has it
    put("mins", eta ? eta.clock : String(readouts.earthMinutes)); put("mins-l", eta ? "arrive" : "min"); // W86 ride: else the minutes flown; W88 ridemodes: "arrive" under the clock, the turn card's word, in both modes
    if (eta) put("left", String(eta.min)); // W88 ridemodes (SPEC §174): and the minutes left, big beside it
    minsBox.classList.toggle("eta", !!eta); rideBox.classList.toggle("to", !!eta); // W86 ride; W88 ridemodes: "to", a destination's readout (app/hud.css): speed and distance small
  }
  pointYou(); // W21 flight: the ship moves on while the chart is free
  mission.sync(); // W73 mission x W77 restfix: Burn up, Long haul and the long-haul screen, four times a second in this one timer; parked and still, it stops with it (showFlight() syncs Launch and Land)
  if (p && !mission.haul) { // W73 mission: nothing drawn under the long-haul screen
    youMarks();
    if (!spaceAt || pixels(metres(spaceAt, p.lonlat), p.lonlat[1], map.getZoom()) >= 6) { // motion-5
      spaceAt = [p.lonlat[0], p.lonlat[1]];
      map.getSource("ship-space")?.setData(shipSpace(spaceAt));
    }
  }
}
/** The accuracy ring (its radius the accuracy in metres) and the beam (twice the heading's uncertainty). */
function youMarks() {
  if (!p) return;
  const r = Math.round(pixels(p.accuracy_m || 0, p.lonlat[1], map.getZoom()));
  const showRing = r > Math.max(12, HULL * shipPx); // a faint ring, from where it shows past the hull
  const ringNow = showRing ? (Math.abs(r - ringPx) >= 1 ? (ringPx = r) : ringPx) : -1; // W17 ship3d: the layer's marks
  const beamNow = p.heading_source === "none" ? 0 : 1;
  const w = Math.round(Math.max(30, Math.min(90, 2 * (p.heading_halfwidth_deg || 0))));
  if (beamNow && Math.abs(w - spread) >= 2) spread = w;
  if (ringNow !== ship.ring || beamNow !== ship.beam || spread !== ship.spread) { Object.assign(ship, { ring: ringNow, beam: beamNow, spread }); map.triggerRepaint(); }
}

// ---- the frame loop, under the governor --------------------------------------------------------
// Full rate while the ship moves or turns, a fix is fresh, the pilot's fingers are on the chart or the
// chart animates; otherwise the pose is looked at four times a second, and nothing is drawn unless it changed. W77 rest: a still chart sleeps (after step()).
const gov = new Governor();
const frameRate = mountFrameRate({ map, gov, full: q.get("perf") === "1", $, extra: () => [gpsLine({ gps: gps.gps, log: pose.core.log, now: performance.now() })], flying: () => flight.flying }); // W20 chrome: Smoothness, Show frame rate, ?perf=1; W56 perf: flying, for the pixel ratio
let lastT = performance.now(), lastFixAt = -Infinity, lastTurn = -Infinity, lastTouch = -Infinity, simRunning = false;
let sweep = 0, turn = 0, paceAt = -Infinity, paceB = NaN, paceZ = NaN, paceH = NaN; // W102 fps30: the chart's turn and zoom at its corners (px a second) and the ship's turn (degrees a second), over 100 ms or more
// W56 perf: parked, a still chart rests after REST_MS with no touch, no move of the ship or the camera: the pulsars, black
// holes, wormholes and a preview's flow stop where they are (their clock pauses), and nothing is drawn. Any of those, a
// key, a setting, the page shown again or the chart uncovered (Settings, the Log) wakes it. In flight nothing rests.
const REST_MS = 20_000; // W56 perf
let wokeAt = performance.now(), motionMs = 0, covered = false; // W56 perf: the motion's clock runs only while awake
const wakeChart = () => { wokeAt = performance.now(); wakeLoop(); }; // W56 perf; W77 rest: wakeLoop
for (const type of ["pointerdown", "keydown", "wheel"]) addEventListener(type, wakeChart, true); // W56 perf
for (const type of ["starchart:settings", "starchart:theme"]) addEventListener(type, wakeChart); // W56 perf
document.addEventListener("visibilitychange", wakeChart); map.on("move", wakeChart); // W56 perf
const shown = [NaN, NaN, NaN]; // the lon, lat and heading last drawn
onPose.fix = (f) => {
  lastFixAt = performance.now(); pushFix(f);
  roadZoom(f); // W31 navview
  if (est) { est = null; showLocate(); } // W31 navview: the real fix takes over from the estimate, where it is
  keepSpot(f); // W25 rest
  if (flight.flying) record.fix(f, engine?.system?.name); // W15 settings: the car guard; W17 log: the track and its systems
  if (flight.flying && nav.cf && nav.place) record.stats?.course(mainName(lingo, nav.place.kind, placeName(nav.place))); // W27 friction: "To Davis" in the Log; W60 b: placeName, its name in the mode's words
  // W16: the star trail. Its points are the GPS gently smoothed (the matcher's Smoother), not the road-snapped spot, so it
  // keeps the ride's own shape (arclight, 2026-10-16); its end is the ship as drawn, so it runs out from under the ship.
  if (flight.flying && f.speed_mps >= 1 && trail.push(f.match?.smooth ?? f.lonlat) && !mission.haul) drawTrail(p?.lonlat); // W73 mission: kept, not drawn, under the long-haul screen
};
/** W25 rest: the last parked spot, the chart's start at the next open (above). */
function keepSpot(f) {
  if (sim || flight.flying || (keptSpot && metres(keptSpot, f.lonlat) < 25)) return;
  keptSpot = [+f.lonlat[0].toFixed(5), +f.lonlat[1].toFixed(5)];
  try { localStorage.setItem(SPOT, JSON.stringify(keptSpot)); } catch { /* full */ }
}
if (lastFix) keepSpot(lastFix); // W25 rest: one that came while the chart loaded
const angle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
// W20 chrome: the next frame is asked for after this one's work, so it comes after MapLibre's own callback. Asked
// for first, it ran before MapLibre's render, while that render was still pending, so each repaint it asked for
// drew a frame late: 30 fps at most for a 60 target.
const aboutSheet = $("about-sheet"); // W25 rest
function frame(t) { let why = 0; try { why = step(t); } finally { if (why) nap(t, why); else requestAnimationFrame(frame); } } // W77 rest: why, a still or covered chart sleeps
function step(t) {
  if (logView === "page" || aboutSheet.open || mission.haul) { covered = true; return COVERED; } // W17 log: the Log covers the chart; W25 rest: so does Settings; W56 perf: covered; W73 mission: the long-haul screen too; W77 rest: COVERED, it sleeps (hud() samples the long-haul screen's warp)
  if (covered) { covered = false; wakeChart(); } // W56 perf: uncovered, it wakes
  const away = document.body.classList.contains("log-flight"); // W39 ship: from what shows, not from paired calls: a flight's page hides the live ship
  if (away !== ship.away) { ship.away = away; pointYou(); map.triggerRepaint(); }
  if (camera.gesture || camera.held) lastTouch = t;
  if (camera.gesture) ship.cue("wake"); // W21 shipin: parked, the ship animates for a few seconds after a touch
  const busy = !p || (p.moving && (simRunning || !sim)) || simRunning || t - lastFixAt < 1500 || t - lastTurn < 2500 || t - lastTouch < 1000 || camera.settling // W31 navview
    || (!flight.flying && ship.moving); // W21 shipin: in flight the ship rides the governor's rate
  const resting = !flight.flying && !camera.settling && !ship.moving && t - Math.max(wokeAt, lastTouch, lastTurn) > REST_MS; // W56 perf
  gov.pace(t, flight.flying && !!p && !lively({ px_s: pixels(p.speed_mps || 0, p.lonlat[1], map.getZoom()) + sweep, deg_s: turn, // W102 fps30: in flight, a quiet chart cruises at 30
    touch: camera.gesture || camera.held || t - lastTouch < 1000, glide: map.isMoving() || Date.now() < camera.glideEnd })); // W102 fps30
  const fps = Math.max(gov.target(camera.gesture, busy || (!calm && !resting && motion.count + flow.count > 0)) || 4, comets.fps); // W22 pretty: flow.count; W29 comets: a frame each px a comet glides; W56 perf: not resting
  const perf = frameRate.perf; // W20 chrome: measuring only while a readout shows
  if (perf) window.__fpsTarget = fps; // the perf overlay's governor line
  if (!gov.due(t, fps)) return;
  const t0 = performance.now();
  const dt = frameDt(t, lastT);
  if (!resting) motionMs += Math.max(0, t - lastT); // W56 perf; W77 rest: max, a frame stamped before the wake
  lastT = t;
  p = pose.sample(t);
  if (p && est && nav.cf) { const a = estAt(t); p = { ...p, lonlat: a.lonlat, heading_deg: a.heading, speed_mps: est.v, moving: true }; } // W31 navview: a GPS gap, flown through
  if (p && t - paceAt >= 100) { // W102 fps30
    const sec = (t - paceAt) / 1000, b = map.getBearing(), z = map.getZoom();
    sweep = ((angle(b, paceB) * Math.PI) / 180 + Math.abs(z - paceZ) * Math.LN2) * (Math.hypot(innerWidth, innerHeight) / 2) / sec || 0;
    turn = angle(p.heading_deg, paceH) / sec || 0;
    paceAt = t; paceB = b; paceZ = z; paceH = p.heading_deg;
  }
  if (p) {
    if (!shipShown) {
      shipShown = true;
      ship.on = true; // W17 ship3d
      ship.cue("wake"); // W21 shipin
      camera.bearing = p.heading_deg;
      showLocate();
      showNoFix();
      fx.ping(); // W15 chart: the first fix
      setTimeout(holdHint, 800); // W25 rest: once the chart has gone to the ship
    }
    const turned = angle(p.heading_deg, shown[2]) > 0.5;
    if (turned) lastTurn = t;
    const moved = (p.lonlat[0] !== shown[0] || p.lonlat[1] !== shown[1]) // W77 rest: parked, a creep under a twentieth of a px (a glide's tail, which never quite ends) is no move
      && (flight.flying || !(pixels(metres(shown, p.lonlat), p.lonlat[1], map.getZoom()) < 0.05)); // W77 rest
    if (turned || moved) { // W77 rest: moved
      shown[0] = p.lonlat[0]; shown[1] = p.lonlat[1]; shown[2] = p.heading_deg; wokeAt = t; // W56 perf: the ship moved
      ship.lngLat[0] = p.lonlat[0]; ship.lngLat[1] = p.lonlat[1]; ship.heading = p.heading_deg; map.triggerRepaint(); // W17 ship3d
      camera.update(p.lonlat, p.heading_deg, dt.anim);
    } else if (t - lastTouch < 1000 || (camera.mode === "heading" && angle(camera.bearing, p.heading_deg) > 0.2) || camera.settling) { // W31 navview: or finish its zoom
      camera.update(p.lonlat, p.heading_deg, dt.anim); // settle after a gesture, or finish turning the chart
    }
  } else if (rough && !shipShown) {
    // Only rough positions: the ship at the best of them, dimmed, inside its accuracy ring (arclight: "I would expect to
    // still see the dim ship"). Nothing flies or records on them; the first good fix takes over as above.
    const spot = rough.spot();
    if (spot && (!ship.on || ship.lngLat[0] !== spot[0] || ship.lngLat[1] !== spot[1])) {
      if (!ship.on) { ship.on = true; ship.cue("wake"); }
      ship.lngLat[0] = spot[0]; ship.lngLat[1] = spot[1];
      camera.update(spot, camera.bearing, 0); // the camera's spot too: following keeps the dim ship in view, and the location button goes to it
      showLocate(); map.triggerRepaint();
    } else if (!spot && ship.on) { ship.on = false; showLocate(); map.triggerRepaint(); }
  }
  shipGuard.check(t, !!p && shipShown && ship.on && !ship.away); // W39 ship: a pose, dim or not, and the ship shown
  if (p) ship.speed = flight.flying ? p.speed_mps : 0; // W21 shipin: the wheels, the comets and the thruster
  if (p && ship.steer(t, p.speed_mps, p.heading_deg) && ship.lifted > 0) map.triggerRepaint(); // W17 ship3d: the lean into turns
  moments(); // catches up a flight launched early, once the world is ready; otherwise each fix runs them
  flow.tick(); // W23 polish: the route draws on, at the governor's rate
  motion.time = motionMs / 1000; // W56 perf: paused while resting (was t / 1000)
  flow.rest = resting; // W56 perf
  if (!calm && !resting && (motion.count + flow.count > 0 || ship.moving)) map.triggerRepaint(); // W22 pretty: flow.count; W21 shipin: only while something animates; the 4 Hz idle step looks at the pose; W56 perf: not resting
  if (comets.tick(t)) map.triggerRepaint(); // W29 comets: only when one in view has moved half a px
  if (perf) perf.tick(performance.now() - t0);
  // W77 rest: nothing on the screen can change by itself any more: parked and resting, no finger, glide, turn, estimate or
  // gliding comet, and the ship and its pose still (a fresh fix that moved nothing counts as still)
  const still = flight.state === "parked" && !camera.gesture && !camera.held && !camera.settling && !ship.moving && !simRunning && !est && !comets.fps // W77 rest
    && !(p && (p.moving || (camera.mode === "heading" && angle(camera.bearing, p.heading_deg) > 0.2))) && t - Math.max(wokeAt, lastTouch, lastTurn) > REST_MS; // W77 rest
  return still ? STILL : 0; // W77 rest
}
// W77 rest (SPEC §141): a still chart sleeps. Parked and resting, with nothing moving (above), the loop asks for no frame,
// and the readout's, the no-fix line's and the flight keeper's timers stop. Covered by the Log or Settings, it asks for no
// frame either, but the timers go on (a flight under the Log). What wakes it: a touch, a key, the wheel, a setting, the theme,
// the page shown again, a camera move, any frame MapLibre draws (a sheet's or a layer's change, the ship's cue), Launch,
// Land and Undo, the Log or Settings closed, and new comets. A fix, a GPS status, a compass turn of half a degree and,
// with comets shown, every 15 s (their fades and staleness) are looked at at once by peek(): one step,
// with no frame asked for, and it wakes only if something on the screen changed.
const COVERED = 1, STILL = 2; // W77 rest
let asleep = false, hudTimer = 0, noFixTimer = 0, napTimer = 0, napCompass = null; // W77 rest
function nap(t, why) { // W77 rest
  asleep = true;
  if (why !== STILL) return; // covered: hold() or the sheet's close wakes it
  hud(); // what this last look saw: a fix's accuracy ring, the course after the Undo window
  clearInterval(hudTimer); hudTimer = 0; clearInterval(keepTimer); keepTimer = 0;
  if (shipShown && !sim) { clearInterval(noFixTimer); noFixTimer = 0; showNoFix(); } // before the ship shows, "No GPS fix yet." comes by the clock
  if (rough && shipShown && !rough.spot()) { rough.stop(); rough = null; } // its ring is gone with the first good fix, for good
  napCompass = pose.core.f.compass;
  clearTimeout(napTimer); napTimer = comets.count ? setTimeout(peek, 15_000) : 0; // comets fade and go stale by the clock
}
wakeLoop = () => { // W77 rest
  if (!asleep) return;
  asleep = false; clearTimeout(napTimer); napTimer = 0;
  gov.wake(); lastT = performance.now(); // a frame at once; the clocks don't jump by the time asleep
  hudTimer ||= setInterval(hud, 250); keepTimer ||= setInterval(() => keepFlight(), KEEP_MS);
  if (!sim) noFixTimer ||= setInterval(showNoFix, 1000);
  requestAnimationFrame(frame);
};
function peek() { // W77 rest: one step now, asleep; it wakes the loop only if something changed
  if (!asleep) return;
  gov.wake(); // nap() and wakeLoop() clear napTimer, whatever called this
  const t = performance.now(), d = pose.core.d;
  if (!sim && d.t !== null) d.t = t - 1000 / 60; // the pose's spring steps one frame from the drawn spot, not the time asleep: the ship glides to a new fix
  const why = step(t), tg = d.tgt; // so whether the fix moves the ship is asked of where it aims, not of that first step
  const fh = pose.core.fused?.heading ?? null; // W77 rest: and whether the heading turns, asked of where it aims too (the re-review's P1)
  if (why === STILL && ((tg && pixels(metres(shown, tg), tg[1], map.getZoom()) >= 0.05) || (fh !== null && angle(fh, shown[2]) > 0.5))) wakeChart(); else if (why) nap(t, why); else wakeLoop();
}
pose.on("fix", peek); pose.on("status", peek); // W77 rest: after the course's own fix handler
pose.on("compass", () => { const c = pose.core.f.compass; if (asleep && c !== null && (napCompass === null || angle(c, napCompass) > 0.5)) peek(); }); // W77 rest
map.on("render", () => { if (!(logView === "page" || aboutSheet.open || mission.haul)) wakeLoop(); }); aboutSheet.addEventListener("close", () => wakeLoop()); comets.changed = () => wakeLoop(); // W77 rest; W102 trim: a render under a cover (step()'s COVERED) doesn't wake it, the cover's close does
requestAnimationFrame(frame);
hudTimer = setInterval(hud, 250); // the readout, the marks and the undo window: four times a second, never per frame; W77 rest: hudTimer

// ---- Launch, Land, Undo -------------------------------------------------------------------------
const launchBtn = $("launch"), readoutEl = $("readout"), snack = $("snack");
const mission = mountMission({ flight, nav, onCover: (on) => { if (!on) { drawTrail(); map.triggerRepaint(); wakeLoop(); } } }); // W73 mission: the trail kept under the long-haul screen, drawn again; W77 rest: and the loop wakes
onLingo(() => showFlight()); // W60 a: the tallies and the snackbar's units follow Words, mid-flight too
const enter = (node) => { node.classList.remove("enter"); void node.offsetWidth; node.classList.add("enter"); };
function unstick() {
  clearTimeout(stickerTimer);
  if (!sticker) return;
  sticker.remove();
  sticker = null;
  parkedAgain(); // an update waits while the sticker shows
}
map.on("click", () => { commitLanding(); unstick(); }); // W18 controls: a tap on the chart makes the landing final
// W18 controls: the second tap of a double tap on Land or Undo lands on what took its place, the bar or the chart: it does nothing
// (only a tap near the first one: a quick, deliberate tap elsewhere, such as on the Log tab, still counts)
let flipAt = -Infinity, flipX = 0, flipY = 0;
const flip = (e) => { flipAt = performance.now(); flipX = e.clientX; flipY = e.clientY; };
for (const type of ["click", "dblclick"]) addEventListener(type, (e) => {
  if (performance.now() - flipAt < 400 && Math.hypot(e.clientX - flipX, e.clientY - flipY) < 48 &&
      e.target.closest?.("#bar, .maplibregl-canvas-container")) { e.stopImmediatePropagation(); e.preventDefault(); }
  else if (type === "click") flipAt = -Infinity; // W30 flake: a tap that counts ends the guard, so Land, the Log tab, then the Chart tab where Land was all count
}, true);
addEventListener("click", (e) => { if (e.target.closest?.("#bar, #about, .csearch")) commitLanding(); }, true); // W18 controls: so does a tab, Settings or the search
/** W18 controls: the landing is final now (the pilot moved on), not at the end of the Undo window. */
function commitLanding(update = true) {
  if (!flight.commit()) return;
  showFlight(); landed();
  if (update) parkedAgain();
}
function showFlight() {
  wakeLoop(); // W77 rest: Launch, Land, Undo
  const s = flight.state;
  flyingLock(s !== "parked"); // W74 integrity
  const was = { launch: !launchBtn.hidden, readout: !readoutEl.hidden, snack: !snack.hidden };
  launchBtn.hidden = s === "flying"; // W18 controls: landed is the parked chart at once, with Undo on a snackbar; W27 friction: with location off too, and a tap opens the sheet
  readoutEl.hidden = s !== "flying";
  $("hifive").hidden = $("cup").hidden = s !== "flying" || plain(); // W60 a: SCUL's rituals; hidden in Plain
  snack.hidden = s !== "landed";
  log.bar(s !== "flying"); // W17 log, W18 controls
  soundBtn.setAttribute("aria-description", s === "flying" ? SOUND_WORDS.hold : "Hold for the sound choices."); // W75 chrome: a screen reader hears where Settings went
  if (map.getLayer("stop-label-dock") && (map.getLayoutProperty("stop-label-dock", "visibility") === "none") !== (s === "flying")) map.setLayoutProperty("stop-label-dock", "visibility", s === "flying" ? "none" : "visible"); // W21 flight: no bike-share docks in flight
  if (!launchBtn.hidden && !was.launch) enter(launchBtn);
  if (!readoutEl.hidden && !was.readout) enter(readoutEl);
  $("gobar").hidden = s === "flying"; // W28 launch: the bar, with the search, is parked only
  if (s === "flying" && !was.readout) if (plain() || afoot /* W79 walkgo: mph and mi */ || !tipOnce("units", readoutEl, "LY is a mile. Warp is mph.", { flight: true })) tipOnce("settings", soundBtn, SOUND_WORDS.tip, { flight: true }); // W60 a: Plain's units need no tip // W28 launch: at the first Launch (audit 4); W75 chrome: else where Settings went
  if (!snack.hidden) {
    if (!was.snack) { enter(snack); snack.classList.remove("run"); void snack.offsetWidth; snack.classList.add("run"); say(snack.querySelector(".t").textContent); } // W73 a11y: say; W73 polish: no numbers (the sticker has them)
  }
  frameRate.flight(); // W56 perf: the map's pixel ratio, 2 at most from Launch to Land
  mission.sync(); // W73 mission
}
// W28 launch: the first Launch with no destination (a course launches from its preview) says once what it does (app/tips.js)
const firstLaunch = () => !sim && !NO_POSITION.has(gps.gps) && launchCard($("gobar")); // W76 look (D14b): the bar's own Where to? and Launch are the pick
launchBtn.onclick = () => { if (!firstLaunch()) launch(performance.now()); }; // W28 launch
function launch(t, k = null) { // W28 resume: k, a kept flight to carry on
  launchBtn.disabled = false;
  if (!sim && NO_POSITION.has(gps.gps)) return showNoGps(true, { focus: true }); // W27 friction: Launch with location off says why
  // From the tap: the demo's sensors, or on iOS the compass permission, which only a tap may ask for
  // (GPS started at load, so start again). A refusal does not stop the launch: the heading is GPS's.
  if (!sim && ["needs-permission", "denied"].includes(gps.compass)) pose.stop();
  if (flight.state === "landed") commitLanding(false); // W18 controls: Launch in the Undo window; no update reload now
  pose.start();
  simRunning = sim;
  if (!flight.launch(t, 0)) return;
  nav.launched(); // W104 oss2 fix pass 2: a search's lit places go out
  if (!k) pulse(); // W69 motion: Launch's firm pulse (app/haptics.js); a resumed flight carries on quietly
  note("flight", k ? "Launch, carrying on a kept flight" : "Launch"); // W48 feedback
  ship.cue("launch"); // W21 shipin: the hop
  launchedAt = performance.now(); // W21 flight
  unstick();
  course = new LiveCourse({ from: k?.metres || 0 }); // W28 resume
  engine = new EventEngine(course, lingo, world, (e) => { if (!((afoot || plain()) && e.kind === "light_year")) dispatchEvent(new CustomEvent("starchart:event", { detail: e })); }, { mode: () => mode }); // W60 d: the lingo mode, read at every line; W79 walkgo: light years are a ship's, none on a walk; her note 2026-10-23 ("the milestone sound for each mile is distracting and unnecessary"): none in Plain either, an ordinary bike map's ride; SCUL keeps its light years
  if (k) engine.resume(k.metres); // W28 resume: where it was, said once already
  lastS = -1;
  if (lastFix) pushFix(lastFix);
  trail.clear(); // W16: a new trail from the launchpad
  if (k) trail.before = (k.trail || []).filter((l) => l.length >= 2); // W28 resume: the trail as it was, then a gap
  if (lastFix) trail.push(lastFix.match?.smooth ?? lastFix.lonlat); // W21 gps; the smoothed GPS, as in flight
  drawTrail();
  Object.assign(readouts, { warp: 0, ly: 0, earthMinutes: 0, metres: 0 });
  put("warp", "0"); put("ly", "0.00"); put("mins", "0"); put("mins-l", "min"); minsBox.classList.remove("eta"); rideBox.classList.remove("to"); // W86 ride: mins-l; W88 ridemodes: to
  fx.flying(true); fx.ping(); // W15 chart: before heading mode, which may tilt
  autoZoom.reset(); roadZoom(lastFix ?? (sim ? { lonlat: PAD } : null), k?.camera || "heading"); // W31 navview: Launch glides to the road's zoom
  camera.setMode(k?.camera || "heading"); // as Google's navigation does; W28 resume: or as it was
  showFlight();
  wake();
  nofix.again(); // W25 rest: a notice dismissed while parked shows again in flight, a new context (entry B6)
  tally.reset(); // W25 rest: the buttons start at zero (flight B1), before the recorder takes its base
  if (k) record.resume(k.rec); else record.launch(); // W28 resume
  if (afoot) record.drop(); // W79 walkgo: a walk, kept nowhere
  if (record.guard) owner.claim(record.id); // W40 log: this tab's flight, until the final Land
  chatter.launch(); // W15 settings
  lastKept = 0; if (k) resumed(k); // W28 resume
  guard.on(); keepFlight(); // W28 resume
}
/** W28 resume: the kept flight's clock, tallies and course, and a line that says it resumed. */
function resumed(k) {
  flight.t0 = performance.now() - (Date.now() - k.launched); // the minutes count on through the gap
  lastKept = k.last || k.launched;
  tally.set(k.tally);
  nav.flownS = k.metres;
  if (k.course) try { nav.restore(k.course); } catch (err) { console.warn("resume course:", err.message); }
  Object.assign(screenOff, { id: "resumed", until: performance.now() + 10000, text: resumedLine(Date.now() - (k.last || k.launched)) });
  showNoFix();
}
let modeAtLand = "heading";
$("land").onclick = (e) => {
  flip(e); // W18 controls
  hud(); // the numbers as they are at the tap
  if (!flight.land(performance.now(), course ? course.s : 0)) return;
  pulse(); // W69 motion: Land's firm pulse
  note("flight", "Land"); // W48 feedback
  nav.landed(); // W40 flight: a preview opened in flight closes
  guard.off(); keepFlight(); // W28 resume: landed, in the Undo window
  ship.cue("land"); // W21 shipin: the settle
  if (sim) { pose.stop(); simRunning = false; } // the demo's rider stops with you, until Launch or Undo
  modeAtLand = camera.mode;
  camera.setAuto(null); // W31 navview: landed, the zoom stays where it is, the pilot's
  fx.flying(false); // W15 chart
  camera.setMode("follow", { move: false });
  northUp(); // Land returns to Follow, north up (SPEC §5, §10); W18 controls
  pills.clear();
  showFlight();
  chime(landSound(slapSticker(), plain()), true); // W21 flight: a landing sounds, the effect only; W73 delight: the sticker's slap
  unwake();
  chatter.pause(); // W15 settings
};
$("undo").onclick = (e) => {
  flip(e); // W18 controls
  if (!flight.undo(performance.now())) return tip($("undo"), pick("The landing is final.", "Too late to undo.")); // W60 a: pick // W24 quiet
  pulse(); // W69 motion: Undo's firm pulse
  note("flight", "Undo"); // W48 feedback
  guard.on(); // W28 resume
  ship.cue("undo"); // W21 shipin: back to the flying hover, with no second hop
  nav.undone(); // W79 walkgo: a walk on, the person on foot again
  if (sim) { pose.start(); simRunning = true; }
  unstick();
  fx.flying(true); // W15 chart
  camera.setMode(modeAtLand); // as if Land had not been pressed
  showFlight();
  wake();
  chatter.resume(); // W15 settings
};
function slapSticker() {
  unstick();
  if (!shipShown || readouts.metres < 0.01 * LY || afoot) return; // a few seconds' flight gets the snackbar only; W79 walkgo: a walk, none
  if (plain()) return; // W76 look (D14c): Plain has no marker sticker; its Land is the snackbar, "Ride ended" and Undo
  if (!sim && setting("starchart.skiptiny") === "on" && tiny({ metres: readouts.metres, moving_s: record.stats?.moving_s ?? 0 })) return; // W68 logbulk: nor one that won't be kept
  const d = new Date();
  const day = d.getDay() === 6 && !plain() ? "Saturnight" : d.toLocaleDateString("en-US", { weekday: "long" }); // W60 a: no Saturnight in Plain
  const card = el("div", "");
  card.append(document.createTextNode(`${countedLy().toFixed(2)} ${pick("LY", "mi")}!`), // W60 a: mi
    Object.assign(el("small", ""), // W27 friction: counted
    { textContent: `${day}, ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` }));
  const cls = record.crossing(readouts.metres); // W15 settings: a star class reached
  if (cls) card.append(Object.assign(el("small", "cls"), { textContent: pick(`Now a ${cls.name}`, `Milestone: ${cls.ly} miles`) })); // W65 plainlook: Plain's milestones
  const box = el("div", "sticker" + (calm ? "" : " slap"));
  box.append(card);
  const id = record.id; // W25 rest: a tap on the sticker makes the landing final and opens this flight's page (the Log, in the demo)
  card.onclick = (e) => { e.stopPropagation(); commitLanding(); unstick(); if (!sim && blackbox.get(id)) log.openFlight(id); else log.open(); };
  sticker = new maplibregl.Marker({ element: box, anchor: "bottom", offset: [-36, -shipPx * 0.75 - 4] }).setLngLat(ship.lngLat).addTo(map); // W17 ship3d; W80 marker2d: higher by a quarter, as the ship stands up 25° on a flat chart
  stickerTimer = setTimeout(unstick, 12000);
  return cls ? "christening" : "sticker_slap"; // W73 delight: its sound
}

// ---- the tallies: in flight only; a long press takes one back --------------------------------------
const tally = tallies(() => (course ? flight.metres(course.s) : 0), $, { onCount: (kind, n, btn) => {
  btn.setAttribute("aria-label", `${kind === "hi_five" ? "Hi-five" : "Cup crush"}${n ? `, ${n}` : ""}`);
  record.tally(kind, n); // W17 log
}, onEmpty: (kind, btn) => tip(btn, kind === "hi_five" ? "No hi-fives to take back." : "No cup crushes to take back."), longPress }); // W24 quiet; W26 hold: the ring and the pop

// ---- no position: a bottom sheet, the demo, and try again --------------------------------------------
const WHY = {
  insecure: "GPS needs a secure page (https). This page was opened over plain http, so the browser keeps the position from it.",
  denied: [`Location is off for Starchart. ${whereOn()} Your position never leaves this droid.`, `Location is off for Starchart. ${whereOn(true)} Your position never leaves this phone.`], // W27 friction: where to turn it on; W60 a: [SCUL, Plain]; W76 privacy (D1): the privacy line is back
  unavailable: ["This droid gave no position. Check that location is on, or try outside.", "This phone gave no position. Check that location is on, or try outside."], // W60 a
};
let noGpsShown = false, noGpsWatch = null, statusHeard = false; // W27 friction: statusHeard
function showNoGps(open, { focus = false } = {}) {
  const why = pick(WHY[gps.gps]); // W60 a
  if (open && why) $("nogps-why").textContent = why;
  const hidden = !(open && why);
  if ($("nogps").hidden === hidden) return;
  const hadFocus = $("nogps").contains(document.activeElement);
  $("nogps").hidden = hidden;
  pad(!hidden); // eased open; closed at once, since a follow jump would stop an ease part-way
  // W16: focus goes into the sheet when the pilot opened it, and back to the location button when it
  // closes; Android's back gesture closes it, as it closes the Settings dialog (CloseWatcher, where there is one).
  if (!hidden && focus) $("nogps-close").focus();
  if (hidden && hadFocus) locBtn.focus();
  if (hidden) ship.cue("wake"); // W21 shipin: a closed sheet
  noGpsWatch?.destroy(); noGpsWatch = null;
  if (!hidden && window.CloseWatcher) { try { noGpsWatch = new CloseWatcher(); noGpsWatch.onclose = () => { noGpsWatch = null; closeNoGps(); }; } catch {} } // W27 friction: closeNoGps
}
// W27 friction: a plain close marks the sheet seen for this permission state; it opens by itself again once the state changes
const NOGPS_SEEN = "starchart:nogps-seen";
const closeNoGps = () => { try { localStorage.setItem(NOGPS_SEEN, gps.gps); } catch { /* storage off */ } showNoGps(false); }; // W27 friction
$("nogps-close").onclick = closeNoGps; // W27 friction
holdToHide($("nogps-close"), "no-location", { close: () => showNoGps(false), restore: () => showNoGps(true) }); // W21 glass: a long press, never again
/** W25 rest: where to allow location, in Chrome's own words on Android, else a short line. W27 friction: installed, the
 *  phone's settings, in general words (Android's own path through App info is unverified). */
function allowWhere() {
  if (matchMedia("(display-mode: standalone)").matches) return "Turn on location for Starchart in your phone's settings, then Try again.";
  if (browserOf({ ua: navigator.userAgent, prompts: "onbeforeinstallprompt" in globalThis }) !== "chrome-android") return "Allow it in the browser's site settings, then Try again.";
  return "Tap the icon left of the address, then Permissions › Location, and allow it. Then Try again.";
}
/** W27 friction: the sheet's first words on where to turn location on: installed, in a Chrome tab, or elsewhere. */
function whereOn(plainWords = false) { // W60 a: plainWords
  if (matchMedia("(display-mode: standalone)").matches) return "Turn on location for Starchart in your phone's settings.";
  if (browserOf({ ua: navigator.userAgent, prompts: "onbeforeinstallprompt" in globalThis }) === "chrome-android") return "In Chrome, tap the icon left of the address, then Permissions, then Location.";
  return plainWords ? "Allow it in the browser's site settings to see where you are." : "Allow it in the browser's site settings to see your ship."; // W60 a
}
let retrying = false; // W21 entry: Try again keeps the sheet up until a position comes, or says it's still not allowed
$("nogps-again").onclick = () => { retrying = true; pose.stop(); pose.start(); }; // W21 entry
$("nogps-where").onclick = () => { closeNoGps(); document.querySelector(".csearch input")?.focus(); }; // W40 flight: Where to?, as the bar's, which the sheet covers
addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("nogps").hidden) closeNoGps(); }); // W27 friction: closeNoGps
// A fix that never comes: after 20 s of searching, one plain line by the location button, until the first fix;
// W20 chrome: sooner, and saying so, when positions come that are all too rough to use (app/fixnote.js).
const nofix = mountNotice($("nofix")); // W21 glass: with an ×
// W27 friction: an × on the rough-position line holds for the session while parked; Launch still says it once (entry B6)
const ROUGH_SEEN = "starchart:rough-seen", roughSeen = () => { try { return sessionStorage.getItem(ROUGH_SEEN) === "1"; } catch { return false; } };
$("nofix").querySelector(".nx").addEventListener("click", () => { if (nofix.id === "rough-position") try { sessionStorage.setItem(ROUGH_SEEN, "1"); } catch { /* storage off */ } }); // W27 friction
function showNoFix() {
  const now = performance.now(), n = flight.flying && now < screenOff.until ? { id: screenOff.id || "screen-off", text: screenOff.text } // W28 resume: id // W21 flight: back from a screen lock
    : noFixNotice({ sim, shown: shipShown, gps: gps.gps, now, log: pose.core.log, fix: pose.core.fix, lost: lost() }); // W21 glass; W21 flight: lost
  nofix.show(n.id === "rough-position" && !flight.flying && roughSeen() ? "" : n.id, n.text); // W21 glass; W27 friction: roughSeen
  if (!sim) changed("gps", NO_POSITION.has(gps.gps) ? `off (${gps.gps})` : lost() ? "lost" : n.id === "rough-position" ? "rough" : lastFix ? "good" : "waiting"); // W48 feedback: its state, never the position
  showLocate(); if ($("about-sheet").open) aboutSource(); // W21 flight: the button and Settings follow a lost fix
}
// W31 navview (audit #8): on a course, a short GPS gap (a bridge, the Minuteman's underpasses) is flown through along the
// route at the last good speed, for up to GAP_MS: the ship moves on, dim, and the course gets an estimated fix each second, so
// the card counts down and the turns are called. The next real fix takes over, where it is. Nothing estimated is recorded.
const GAP_MS = 20_000;
function estimate(now) {
  const cf = nav.cf, r = cf?.last, gap = now - fixedAt;
  if (!flight.flying || !r || r.off || gap < 1500 || gap > GAP_MS || !(lastFix?.speed_mps >= 1)) { if (est) { est = null; showLocate(); } return; }
  if (!est) { est = { s: r.s, v: lastFix.speed_mps, t: fixedAt, fed: now }; showLocate(); }
  if (now - est.fed < 1000) return;
  est.fed = now;
  const at = estAt(now);
  nav.fix({ lonlat: at.lonlat, course_deg: at.heading, speed_mps: est.v, accuracy_m: lastFix.accuracy_m, t: now, estimated: true });
}
/** Where the estimate has the ship at `now`: {lonlat, heading}. */
const estAt = (now) => nav.cf.course.at(Math.min(nav.cf.length, est.s + (est.v * (now - est.t)) / 1000));
/** W21 flight: in flight on GPS, the ms with no fix (since Launch, before the first), from 5 s on; else 0. */
function lost() { return lostMs({ sim, flying: flight.flying, now: performance.now(), since: Math.max(fixedAt, launchedAt) }); }
if (!sim) noFixTimer = setInterval(showNoFix, 1000); // W20 chrome; W77 rest: noFixTimer
onPose.status = () => {
  if (!sim && NO_POSITION.has(gps.gps) && !noGpsShown && flight.state === "parked") { noGpsShown = true; if (!isHidden("no-location") && localStorage.getItem(NOGPS_SEEN) !== gps.gps) showNoGps(true); } // W21 glass: unless hidden for good; W21 flight: never by itself in flight; W27 friction: nor once seen in this state
  if (retrying && NO_POSITION.has(gps.gps)) { retrying = false; if (gps.gps === "denied") $("nogps-why").textContent = `Still not allowed. ${allowWhere()}`; // W21 entry; W25 rest: where
    tip($("nogps-again"), { denied: "Still not allowed.", insecure: "Still a plain http page.", unavailable: "Still no position." }[gps.gps]); } // W24 quiet: each Try again answers
  if (!NO_POSITION.has(gps.gps) && !(retrying && gps.gps === "waiting")) { retrying = false; showNoGps(false); if (statusHeard || gps.gps === "ok") localStorage.removeItem(NOGPS_SEEN); } // W21 entry: not while Try again asks; W27 friction: the state changed
  statusHeard = true; // W27 friction: the first call is the pose's starting "waiting", not a change
  showLocate();
  showNoFix();
  showFlight();
  aboutSource();
};
onPose.status();

// ---- wake lock: the screen stays on while flying, unless the pilot switches it off ---------------
let wakeWanted = localStorage.getItem("starchart:wake") !== "0", wakeLock = null, wakeNote = "", wakeAsking = false; // W40 flight: wakeAsking
async function wake() {
  if (!flight.flying || !wakeWanted || wakeLock || wakeAsking || document.visibilityState !== "visible") return showWake(); // W40 flight: one ask at a time
  if (!("wakeLock" in navigator)) { wakeNote = "This browser can't."; return showWake(); } // W28 settings: shorter
  wakeAsking = true; // W40 flight
  try {
    const l = await navigator.wakeLock.request("screen"); // W40 flight: a Land or the switch may come while it asks
    if (!flight.flying || !wakeWanted) l.release(); // W40 flight: let go at once, landed or switched off meanwhile
    else { wakeLock = l; l.addEventListener("release", () => { if (wakeLock === l) wakeLock = null; showWake(); }); } // W40 flight: only the live lock
    wakeNote = "";
  } catch { wakeNote = pick("The droid said no. Asks again at Launch.", "The phone said no. Asks again at Record or Start."); } // W60 a: pick; W88 ridemodes: Plain's Record // W28 settings: shorter
  wakeAsking = false; // W40 flight
  showWake();
}
function unwake() { if (wakeLock) wakeLock.release(); wakeLock = null; showWake(); }
function showWake() {
  $("wake").checked = wakeWanted;
  $("ab-wake").textContent = wakeWanted ? wakeNote : ""; // W28 settings: a line only when it can't
}
$("wake").onchange = (e) => {
  wakeWanted = e.target.checked;
  setSetting("starchart:wake", wakeWanted ? "1" : "0"); // W15 settings
  if (!wakeWanted) unwake();
  wake();
};
pose.on("visibility", ({ visible }) => { if (visible) wake(); }); // the browser drops the lock when hidden
// W21 flight: back mid-flight after a screen lock or the background, one line with its × says what stopped (GPS: the watch did)
pose.on("visibility", ({ visible }) => {
  const t = performance.now();
  if (!visible) { screenOff.at = flight.flying ? t : 0; return; }
  if (sim || !screenOff.at || t - screenOff.at < 5000) return;
  Object.assign(screenOff, { id: "screen-off", until: t + 10000, text: screenOffLine(t - screenOff.at), at: 0 }); // W28 resume: id
  trail.gap(); drawTrail(); // W29 polish: no fixes came while it was off, so the trail shows a gap, as after a resume
  showNoFix();
});

// ---- Settings and About: a bottom sheet (R12) ---------------------------------------------------------
addEventListener("starchart:settings", (e) => { // W28 settings: Motion; W100 motion: the Calm motion switch, in Appearance; a flip of Calm motion overrides the phone's reduced motion
  if (e.detail.key !== "starchart.motion") return;
  calm = calmWanted();
  document.body.classList.toggle("calm", calm);
  motion.calm = flow.calm = calm; // W22 pretty: flow.calm; W29 polish: the camera glides in Calm too
  ship.motion.still = calm; // W21 shipin
  comets.calm = calm; // W29 comets
  map.triggerRepaint();
});
// W15 settings: Sound, Theme, Battery saver and Show tips again are app/settings.js's rows (W28 settings).
// A flight counts in the Log from Launch to a final Land, on GPS only; the chatter says one flight's colour lines.
const colourBank = getJSON("design/sound/voice/colour-bank.json");
const sayColour = (l) => sfx.onChartEvent({ kind: "colour", voice: l.text });
const chatter = flightChatter({ bank: colourBank, store: localStorage, level: () => (soundMode() === "all" ? "light" : "off"), say: sayColour, // W28 settings: one rate, with chatter only
  state: () => ({ elapsed_s: earthMs(flight.elapsed(performance.now())) / 1000, ly: readouts.ly }), lingo: () => mode }); // W60 d: no colour in Plain
function landed() { const f = record.final({ metres: readouts.metres, minutes: readouts.earthMinutes, ...(flight.end ? { end: Date.now() - (performance.now() - flight.end.t) } : {}) }); if (f) { if (!log.dropTiny(f)) log.saved(); } else /* W68 logbulk: dropTiny */ if (!sim && !afoot) log.say(pick("Log full: flight not saved", "Log full: ride not saved")); /* W60 a: pick; W79 walkgo: a walk is kept nowhere */ if (afoot) { afoot = false; afootWords(); } /* W79 walkgo */ chatter.end(); keeper.forget(); owner.release(); } // W17 log; W21 logfix: a full store says so; W27 friction: end, the Land tap; W28 resume: forget; W40 log: release
const MB = (b) => `${(b / 1048576).toFixed(1)} MB`;
/** The Position row's words for the GPS state. A fix worse than 25 m is weak. (Called before this line runs.) */
function gpsWords() {
  if (lost()) return lostWords(lost()); // W21 flight
  if (gps.gps === "ok") {
    if (!gps.precise) return "GPS, weak fix. Is Precise Location off?";
    return lastFix && lastFix.accuracy_m > 25 ? "GPS, weak fix." : "GPS, good fix.";
  }
  return { waiting: waitingWords(pose.core.log, pose.core.fix), // W20 chrome
     denied: "GPS, not allowed.", unavailable: "GPS, no position.", insecure: "GPS, blocked on a plain http page." }[gps.gps] || "GPS, searching.";
}
function aboutSource() {
  $("ab-source").textContent = sim ? pick(`The demo mission, at ${speed}×.`, `The demo ride, at ${speed}×.`) : gpsWords(); // W60 a: pick // W28 settings: the demo's GPS and Demo switch left Settings
  $("ab-compass").textContent = {
    ok: "On, and corrected for the magnetic declination in Boston (13.9° W).",
    "needs-permission": pick("The droid asks at Launch.", "The phone asks at Record or Start."), // W60 a; W88 ridemodes: Plain's Record
    denied: "Not allowed, so the heading comes from GPS alone.",
    unavailable: "No compass here, so the heading comes from GPS alone.",
    uncalibrated: pick("Needs calibrating: move the droid in a figure eight.", "Needs calibrating: move the phone in a figure eight."), // W60 a
  }[gps.compass] || "—";
}
function showStore() {
  const about = $("about");
  about.classList.toggle("dl", storeState === "downloading");
  if (storeState === "downloading") about.style.setProperty("--dlp", String(parseFloat(storeDetail) / 100 || 0));
  $("ab-store-t").textContent = { network: "Read from the network", downloading: `Storing the chart · ${storeDetail}`, verifying: "Checking the stored chart",
    stored: "Stored and checked", error: "Download stopped", unsupported: "Network only" }[storeState];
  $("ab-store-i").className = "i " + ({ stored: "i-check", error: "i-warning", unsupported: "i-chart" }[storeState] || "i-download");
  $("ab-store-v").textContent = storeState === "stored" ? "Works offline" : "";
  $("ab-store-v").classList.toggle("ok", storeState === "stored");
  const keeps = prefix ? `The chart keeps drawing from its first ${MB(tilesEntry.prefix_bytes)}, without street detail` : "The chart keeps reading from the network"; // W76 privacy
  $("ab-store").textContent = {
    network: prefix ? pick(`Only its first ${MB(tilesEntry.prefix_bytes)} from the network, the same for every pilot; street detail comes with the download.`, `Only its first ${MB(tilesEntry.prefix_bytes)} from the network, the same for every rider; street detail comes with the download.`) : "Read from the network with Range requests, until the download finishes.", // W76 privacy
    downloading: pick(`Downloading into this droid's private storage: ${storeDetail} of ${MB(tilesEntry.bytes)}.`, `Downloading into this phone's private storage: ${storeDetail} of ${MB(tilesEntry.bytes)}.`), // W60 a
    verifying: "Downloaded; checking its SHA-256 against data/manifest.json.",
    stored: pick(`Stored on this droid (${MB(tilesEntry.bytes)}) and checked by SHA-256.`, `Stored on this phone (${MB(tilesEntry.bytes)}) and checked by SHA-256.`), // W60 a: pick; W55 layers2: its "Works offline" says the rest
    error: storeFull ? pick(`The droid's storage is full. ${keeps}.`, `The phone's storage is full. ${keeps}.`) : `The download stopped (${storeDetail}). ${keeps}${again ? ", and the download tries again later" : "; tap Download now to try again"}.`, // W40 settings: again; W74 integrity: storeFull
    unsupported: "This browser cannot store files for the app (it needs the Origin Private File System), so the chart needs a signal.",
  }[storeState] + (stored && !stored.current ? " An older stored chart is in use until the new one is checked." : "");
}
async function showQuota() {
  const qt = await quota();
  const size = (b) => (b >= 1073741824 ? `${(b / 1073741824).toFixed(1)} GB` : MB(b));
  $("ab-quota").textContent = qt ? `${size(qt.usage)} used of ${size(qt.quota)}${qt.persisted ? ", kept by the browser" : pick(", may be cleared if the droid runs short", ", may be cleared if the phone runs short")}.` : ""; // W22 pwa: iOS's "install keeps your Log" is in the Install row; W60 a: pick
}
function about() {
  $("ab-version").textContent = VERSION; // W28 settings: About's line; the commit is in Developer
  $("ab-v").textContent = VERSION;
  $("ab-changes-v").textContent = VERSION; // W98 changelog
  $("ab-commit").textContent = build.commit.slice(0, 12);
  $("ab-built").textContent = build.built_at.replace("T", " ").slice(0, 16) + " UTC";
  $("ab-bundle").textContent = build.bundle_hash.slice(0, 16);
  $("ab-data").textContent = `Greater Boston, OpenStreetMap data of ${data.osm_date || "unknown date"} (${data.version}).`;
  $("ab-hosts").textContent = `It talks only to ${location.host}, and to api-v3.mbta.com (the MBTA) ${pick("for the comets, the live T trains: it asks for every train, or for a comet, Comet Station or Sandworm Nest you tap", "for the live T trains: it asks for every train, or for a train or station you tap")}, and gets no location. With the Weather layer on, it asks mesonet.agron.iastate.edu (the Iowa Environmental Mesonet) for the rain radar, and api.weather.gov (the National Weather Service) for the winter alerts: the same tiles and alerts of the whole region for everyone, and no location. No accounts, analytics or trackers.`; // W28 settings: one line; W29 comets: the MBTA; W33 peeks: the nests; W52 weather: IEM; W60 a: pick; W102 winter: the NWS
  getJSON("design/sound/voice/lines.json").then((j) => { $("ab-voice").textContent = j.voice.attribution; }).catch(() => {});
  aboutSource(); showStore(); showWake(); showQuota();
  aboutStores({ data, group: $("ab-data").closest(".group"), MB }); $("ab-screen").textContent = screenLine(); // W18 controls
  frameRate.held(); // W56 perf: the rate the governor holds
  $("ab-ship").textContent = `WebGL lost ${glKept.lost}, back ${glKept.restored} · ship put back ${shipGuard.stats.readded}`; // W39 ship: since this open
}
longPress($("about"), () => { // W18 controls: Dark or Light, as in Settings; W28 settings: and a bubble says which
  const day = starchartTheme.current.theme !== "light";
  setSetting("starchart.theme", day ? "light" : "dark");
  tip($("about"), day ? pick("Daystar. Hold the gear again for Dark.", "Light. Hold the gear again for Dark.") : pick("Dark. Hold the gear again for Daystar.", "Dark. Hold the gear again for Light.")); // W28 settings; W60 a: pick
});
const sheet = $("about-sheet");
sheet.addEventListener("close", () => ship.cue("wake")); // W21 shipin: a closed sheet
sheet.addEventListener("close", () => tipOnce("gear", $("about"), pick("Hold the gear to switch Dark and Daystar.", "Hold the gear to switch Dark and Light."))); // W60 a: pick // W28 launch: a first-time tip (audit 5)
$("about").onclick = () => { about(); sheet.classList.remove("full"); sheet.showModal(); topHeight(); }; why($("about"), null); // W24 quiet: wired
longPress(credit, () => { about(); sheet.showModal(); topHeight(); const f = $("about-fold"), c = $("credits-fold"); f.open = c.open = true; requestAnimationFrame(() => c.querySelector(":scope > summary").scrollIntoView({ block: "start" })); }, { ms: 600 }); // W58 clean: a hold on the chart's credit opens About at its credits; a tap does nothing. 2026-10-20: the credits are a folder in About: open it
// W16: About's row sticks under the sheet's head while its pages scroll; folding it brings the row back in view.
const sheetTop = sheet.querySelector(".top"); // W20 chrome: About and the categories fold in app/settings.js
const topHeight = () => sheet.style.setProperty("--top-h", sheetTop.offsetHeight + "px");
if (sheet.open) { about(); topHeight(); } // W25 rest: opened while the chart loaded
onLingo(() => { if (sheet.open) about(); }); // W73 logsafe: a Words switch made in the open sheet refills About (the hosts, the chart's store, the quota)
addEventListener("resize", () => { if (sheet.open) topHeight(); });
sheet.addEventListener("click", (e) => { // a tap on the scrim closes it
  if (e.target !== sheet) return;
  const r = sheet.getBoundingClientRect();
  if (e.clientY < r.top || e.clientX < r.left || e.clientX > r.right) sheet.close();
});
/** A drag down on a sheet's handle or head closes it; a drag up opens it to full height. */
function dragSheet(node, close) {
  let y0 = null, dy = 0;
  node.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".top") || e.target.closest("button, a")) return;
    y0 = e.clientY; dy = 0;
    node.setPointerCapture?.(e.pointerId);
  });
  node.addEventListener("pointermove", (e) => {
    if (y0 === null) return;
    dy = e.clientY - y0;
    node.classList.add("dragging");
    node.style.setProperty("--dy", Math.max(0, dy) + "px");
  });
  const end = () => {
    if (y0 === null) return;
    y0 = null;
    node.classList.remove("dragging");
    node.style.removeProperty("--dy");
    if (dy > 80) close(); else if (dy < -30) node.classList.add("full");
  };
  node.addEventListener("pointerup", end);
  node.addEventListener("pointercancel", end);
}
dragSheet(sheet, () => sheet.close());
dragSheet($("nogps"), closeNoGps); // W27 friction: closeNoGps

// ---- the offline chart: download in the background, then switch to the stored file -----------
function markOffline() {
  offline = true;
  storeState = "stored";
  showStore();
  dispatchEvent(new CustomEvent("starchart:offline-ready", { detail: { version: data.version, sha256: tilesEntry.sha256 } }));
}
let tries = 0, storing = null, again = false, retryTimer = 0, storedNow = false; // W40 settings: one at a time; a retry waits (again); stored this visit
let storeFull = false; // W74 integrity: the storage is full: no retry, and the row says why
/** W40 settings: one store at a time: a second call (Download now, a retry) joins the one running, and a manual one replaces a waiting retry. */
function storeChart() { // W40 settings
  clearTimeout(retryTimer); removeEventListener("online", storeChart); again = false; // W40 settings
  return storing ??= storeOnce().finally(() => { storing = null; }); // W40 settings
} // W40 settings
async function storeOnce() { // W40 settings: storeChart's body
  if (storeState === "unsupported") return;
  if (storedNow || (stored && stored.current)) { // W40 settings: stored this visit, so a retry of a later file doesn't read and hash it again
    await swReady();
    prune([tilesEntry.sha256]);
    return markOffline();
  }
  prune([tilesEntry.sha256, stored?.state.sha256].filter(Boolean));
  try {
    await prefix?.saved; // W76 privacy: the download resumes after the prefix, once it is kept
    await store(tilesUrl, tilesEntry, ({ type, loaded, total }) => {
      if (type === "done" || type === "error") return; // the promise settles those
      storeState = type === "verifying" ? "verifying" : "downloading";
      storeDetail = `${Math.floor((100 * loaded) / total)} %`;
      showStore();
    });
    const fresh = await storedTiles(tilesEntry);
    if (!stored && fresh) { readStored(fresh.file); if (prefix) { map.getSource("chart")?.setUrl(style.sources.chart.url); prefix.drop(); } } // W76 privacy: z14 and z15 now, the source's max zoom read again, and the prefix's bytes let go
    storedNow = true; // W40 settings
    keep(); // W40 settings
    await swReady();
    markOffline();
  } catch (err) {
    storeState = "error";
    storeDetail = err.message;
    storeFull = !!err.full; // W74 integrity
    if (!storeFull && ++tries < 4) { again = true; if (navigator.onLine) retryTimer = setTimeout(storeChart, 30000 * tries); else addEventListener("online", storeChart, { once: true }); } // W40 settings: again, retryTimer; W74 integrity: none when full
    showStore(); downloads.show(); // W40 settings: after the retry is set, so both rows say whether one comes
  }
}
/** The app shell is cached once the service worker is active. None registered, or none active within
 *  15 s: go on, so the chart row never sticks. */
const swReady = () => swReg.then((reg) => reg && Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 15000))]));

const downloads = mountDownloads({ entries: data.files, supported: storeState !== "unsupported", start: storeChart, note: $("dlnote"), row: $("dl-row"), // W26 downloads
  onPause: () => { if (storeState === "downloading") { storeState = "network"; showStore(); } }, again: () => again }); // W26 downloads; W40 settings: again
mountPackRows({ packs, row: $("dl-row"), template: $("pack-row") }); // W82 packui: Settings › Offline chart's row per map pack
if (kept && verdict(kept) === "resume") launch(launchTap ?? performance.now(), kept); // W28 resume: closed mid-flight, it flies on
else if (launchTap !== null) launch(launchTap);

// ---- ready ------------------------------------------------------------------------------------
// The moments wait for the world's tiles at the launchpad too, so the first events never depend on how
// fast the chart drew (the world asked for them before the map was made).
showFlight();
showLocate();
// W47 firstload: or the chart's loading stalled, nothing new for 15 s (a request that hangs on a flaky network): the app goes on
// rather than stay half-loaded until a force close; MapLibre asks for a failed tile again at the next move, and the online event (below) asks now.
const stalled = new Promise((r) => { let last = performance.now(); const t = setInterval(() => { if (performance.now() - last > 15000) { clearInterval(t); r(); } }, 1000); for (const e of ["data", "dataloading"]) map.on(e, () => { last = performance.now(); }); }); // W47 firstload
Promise.race([Promise.all([idle, world.idle()]), stalled]).then(() => { // W47 firstload: stalled
  ready = true;
  progress(1);
  hexGone(); // W47 firstload: or here, a stalled load's
  if (creditOpen) showCredit(true); // W16: five seconds of the full credit once the chart is drawn, then the ©
  document.body.classList.add("loaded");
  setTimeout(holdHint, 800); // W25 rest: a fix that came while the chart loaded
  dispatchEvent(new CustomEvent("starchart:ready", { detail: { source: sim ? "sim" : "gps" } }));
  keep(); addEventListener("appinstalled", keep); // W40 settings: storage kept, asked at each start and once installed
  showStore();
  if (!sim) log.cutShort(); // W17 log: a flight the tab lost before its summary
  const shared = sharedCourse(); // W54 course: a shared course's link opens its preview, over what was open
  const sharedIn = shareWaiting(); if (sharedIn) takeShared(); // W67 routefile: a share from another app (app/sw.js), over what was open
  const was = flight.state !== "parked" || shared || sharedIn ? null : takeParked(localStorage); // W28 resume: parked, what was open comes back; W54 course: not over a shared course; W67 routefile: nor a share
  if (was) nav.reopen(was); // W28 resume
  Promise.race([nav.searchLoading(), new Promise((r) => setTimeout(r, 60000))]).then(() => (window.requestIdleCallback || setTimeout)(firstView, { timeout: 2000 })); // W47 firstload: a first visit's service worker, once a search the pilot started has its index (60 s at most)
  (firstVisit ? swReady() : Promise.resolve()).then(() => (window.requestIdleCallback || setTimeout)(() => downloads.begin(), { timeout: 5000 })); // a busy flight never idles: start within 5 s; W26 downloads: guarded; W47 firstload: on a first visit after the shell is cached (15 s at most)
  const warm = (m) => swReady().then((reg) => reg && (window.requestIdleCallback || setTimeout)(() => warmVoice(m, { build, url: at }), { timeout: 8000 })); // W60 d: the lingo mode's lines
  warm(mode); addEventListener("starchart:settings", (e) => { if (e.detail.key === "starchart.lingo") warm(e.detail.value); });
});

// W48 feedback (SPEC §60): Settings › Send feedback, with what the app was doing (app/trail-log.js): plain words, never the position
const feedbackPage = mountFeedback({ $, version: () => /* W74 flightlog: feedbackPage */ `${VERSION} · ${build.commit.slice(0, 12)}`, // W48 feedback
  app: () => ({ flight: flight.state, source: sim ? "the demo" : "GPS", camera: camera.mode, lingo: mode, // W48 feedback
    router: nav.router, silent: isSilent(), flights: blackbox.flights, packs: packs.list().map((p) => p.state), // W88 feedbackinfo: numbers and words, never a place
    course: nav.cf && { style: nav.style, metres: nav.cf.length, planned_s: nav.cf.feature.properties.time_s / (nav.cf.pace || 1), ride_s: nav.cf.clock.s, along_m: nav.cf.s } }) }); // W88 feedbackinfo

// W98 changelog (SPEC §194): what each version changed, from About's What's new; after an update, a note once, parked, with nothing open
mountChangelog({ page: $("changelog"), row: $("ab-changes"), version: build.version, // W98 changelog
  canShow: () => ready && flight.state === "parked" && !document.querySelector("dialog[open]") && !document.body.matches(".has-csearch, .has-csheet, .has-cfromto, .log-page, .log-flight") }); // W98 changelog

// ---- the debug handle, for tests ------------------------------------------------------------------
window.starchart = {
  version: VERSION,
  build: { commit: build.commit, built_at: build.built_at, bundle_hash: build.bundle_hash, data_version: data.version },
  state: () => ({ ...readouts, system: engine?.system ? engine.labelFor("system", engine.system) : "", lingo: mode, silent: isSilent(),
    source: sim ? "sim" : "gps", offline, flight: flight.state, camera: camera.mode }),
  get engine() { return engine; }, get course() { return course; },
  avoidLayer, // W80 avoidmap: for tests, .data()
  map, pose, world, camera, motion, flight, gov, // W56 perf: gov, the frame governor (.auto, .held, .measured)
  get asleep() { return asleep; }, // W83: for tests, the still chart asleep (W77 rest, SPEC §141)
  blackbox, colour: (o) => sayColourNow({ bank: colourBank, say: sayColour, ...o }), // W15 settings: for tests
  fx, // W15 chart
  trail, // W16: the star trail
  ship, // W17 ship3d: the layer; its getBoundingClientRect(), .ring (px, or -1), .beam, .spread, .lifted, .roll, .drawn; W21 shipin: .motion, .moving
  log, // W17 log
  ghosts, // W73 ghosts: .refresh(), .season, .n, .bounds
  resume: { back: () => guard.back(), get armed() { return guard.armed; } }, // W28 resume: Android's back, for tests
  terrain, // W19 terrain: .on3d, .ready, .switches, .height([lon, lat]) (W28 settings: .hills went)
  comets, // W29 comets: .set(on), .on, .count, .list(), .stats
  layers, // W50 layers: .open(), .close(), .shown
  weather, // W52 weather: .set(on), .on, .valid, .line, .words, .frames, .motion, .stats
  radiation, // W54 flight: .look(), .watch.band
  dusk, // W73 dark: .look(), .watch.flight
  transit, // W61 transit: .enable(), .plan(from, to, at, opts); W62 cometcard: the Settings toggle and the card use it
  walk, // W73 walk: .available, .plan(from, to, at), .live(plan)
  gl: glKept, shipGuard, // W39 ship: { lost, restored }, the WebGL context's losses and restores (keepLayer)
  packs, // W81 packstore: the map packs' store (app/packs.js); W82 packmap: mounted with the chart
};
