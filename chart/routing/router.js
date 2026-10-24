// Starchart's own pathfinder: A* over the routing graph that chart/routing/graph/build_graph.py writes.
// Pure JS over typed arrays, no DOM: it runs in Node tests and in a web worker (worker.js).
//
//   const router = new Router(arrayBuffer);
//   router.route({ from: [lon, lat], via: [[lon, lat], ...], to: [lon, lat], style: "wormhole" })
//     -> { geometry, distance_m, climb_m, time_s, maneuvers, bike_m, style, via_m }
//   W53 turns: and `elev` [[at_m, z_m], ...] at each junction, and `ways` [[at_m, kind], ...], each run of one lingo kind from at_m
//   W59 routes: and `bare` [[from_m, to_m], ...], the stretches with no bike support (Router.bare)
//   W67 graph3: and `junk` [at_m, ...], the Space Junk ridden through (gates, bollards), and `tracks` [[at_m, angle], ...],
//   each crossing of tram or light-rail track, or of heavy rail tagged ungated, with the angle (0 to 90 degrees) between course and rails
//   W104 oss2: and `dust` [[from_m, to_m], ...], the unpaved stretches (F.UNPAVED), for the course strip's texture
//
// W31 navvoice: `heading` (degrees from north) is optional too: the ship's heading, for a re-plot in flight; the course
// then sets out that way along the road it starts on, with no U-turn unless that way is a dead end, and a way back from a
// junction near the start costs BACK_COST more, so it doesn't come about by a sidewalk or a crossing either.
// W56 reroute: with `about` too (a turn just missed behind the ship), it also plans the course back the way the ship came,
// ridden or walked as the ways allow, and takes it if it is quicker by `ABOUT_S` or more; that course has `about: true`.
//
// Via points (W21 routes) are optional: the route is its legs joined, each leg leaving a via the way the last one came
// in (no U-turn there unless that way is a dead end), and `via_m` is each via's distance along the route.
//
// A maneuver is { at_m, lonlat, type, angle, exit, name, kind, then }: `type` is course.js's turn vocabulary
// (left, slight_right, keep_left, straight, u_turn, black_hole, arrive, ...), `angle` the heading change in
// degrees (+ is right), `exit` the black hole's exit number, `name` the OSM name of the road taken (the lingo
// pack makes it SCUL: see instructions.js), `kind` its lingo kind, and `then` the second turn of a folded jog.
// W53 lanes: a turn across the motor lanes also has `lanes` (Router.lanesAt; graph version 2).
//
// The costs are scul.brf's. Each edge carries the profile's cost factor in both directions (the builder
// ports the profile's way context); the search adds its node costs (traffic signals 20), its turn cost
// (90 x (1 - cos angle), none inside a rotary or on a bike route) and its climb cost (100 per metre climbed
// above a 1 % grade, after a 10 m buffer, as BRouter's StdPath does). A route style is a cost table over the
// same graph (STYLES below). The search runs over directed edges, so turn costs and turn restrictions are exact.
//
// `time_s` is the ride's time by PACE below, whatever the style; Quickest's costs are that time (README, "Route time").

const CLASSES = ["other", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street",
  "service", "cycleway", "path", "footway", "pedestrian", "steps", "track", "bridleway", "road"];
const C = Object.fromEntries(CLASSES.map((c, i) => [c, i]));
const BIKE = ["none", "shared", "laned", "shielded", "wormhole", "walk", "steps"];
const B = Object.fromEntries(BIKE.map((b, i) => [b, i]));
const F = { WRONG_FWD: 1, WRONG_REV: 2, BRIDGE: 4, ROTARY: 8, UNPAVED: 16, TUNNEL: 32, ROUTE: 64, CROSSING: 128 };
const N_SIGNAL = 1, N_WALK = 2, N_BLOCKED = 4;
const N_JUNK = 8, N_TRACKS = 16; // W67 graph3: Space Junk a bike may pass, and a track crossing (graph version 3)
const W_STOP = 1, W_GIVE = 2, W_CROSS = 3; // W67 graph3: a directed edge's wait at its head (Router.waits)
const S_RIGHT = 1, S_LEFT = 2, S_SEPARATE = 4; // W53 lanes: the bike's side (build_graph.py lane_facts)
const BOX_M = 40; // W53 lanes: a bike box this far before a turn, on its approach, is the turn's
const TYPES = { i4: Int32Array, u4: Uint32Array, f4: Float32Array, u2: Uint16Array, i2: Int16Array, u1: Uint8Array };
const M_PER_DEG = 111320;
const BUFFER_M = 10; // BRouter's elevation buffer: the climb cost counts only climbing beyond it
const CATCH_M = 40; // turns closer than this fold into one
const WALK_M = 40, ACROSS_M = 25; // W32 routing: a place this near a way may be walked to from it, across the street (Router.near)
const ASCEND_M = 5; // the reported climb's filter, which matches BRouter's "filtered ascend" best on its own profiles
const MPH = 0.44704;
const BACK_M = 80, BACK_COST = 1000; // W31 navvoice: a re-plot's ways back near the ship, and what one costs (about 1 km)
export const ABOUT_S = 15; // W56 reroute: what turning around costs a re-plot with `about`, in seconds of the ride's time
// W73 avoid: an avoided street's edges cost AVOID_X times as much, so a course always exists; a street is its edges of the
// same name joined to the one nearest its point (within AVOID_SNAP_M), out to AVOID_M from the point (Router.avoidEdges) // W73 avoid
export const AVOID_X = 20, AVOID_M = 150, AVOID_SNAP_M = 40; // W73 avoid
// W105 night: with `night` (the plan starts after sunset or before sunrise), a path or wormhole tagged lit=no (the graph's `lit`, // W105 night
// LIT_NO) costs NIGHT_X times as much in every style. Night only raises costs, so the CH-potentials' day bound stays admissible // W105 night
export const NIGHT_X = 1.25; // W105 night
const LIT_NO = 2, PATHS = new Set([C.cycleway, C.path, C.footway, C.pedestrian, C.track, C.bridleway]); // W105 night: build_graph.py's LIT_NO

/**
 * The time model: a cruising speed in mph by way, a climb penalty, and a wait at each pulsar (traffic signal) and
 * each gate walked through. Bike paths and bike lanes 12, other streets 11, slower ways by class (`slow`), unpaved
 * ground at 75 %; walking the bike (a sidewalk, the wrong way up a one-way) 3, steps 1. Each metre climbed (the
 * reported climb) adds `climb_s`; a right-angle turn `turn_s`, scaled by 1 - cos angle as the search's turn cost.
 * W33 routing2: a pulsar's wait is once per intersection: signals within `pulsar_m` of each other are one, a junction
 * within `inside_m` of one of its signals is in it, and a course waits `signal_s` each time it enters one (Router.zone).
 * W67 graph3: a stop sign the course meets costs `stop_s` (a bike's rolling stop), a give-way `give_s`, and riding a crossing
 * over an unsignalled tertiary or bigger road `cross_s`, each only from the approach it faces (Router.waits).
 */
export const PACE = {
  path: 12, street: 11, slow: { service: 9, living_street: 8, pedestrian: 7, path: 9, footway: 9, track: 9, bridleway: 8 },
  unpaved: 0.75, walk: 3, steps: 1, climb_s: 5, signal_s: 15, pulsar_m: 40, inside_m: 20, gate_s: 10, turn_s: 5,
  stop_s: 6, give_s: 3, cross_s: 3, // W67 graph3
};
/** W67 graph3: the seconds of a wait kind (Router.waits), read from PACE when used. */
const waitSec = (k) => (k === W_STOP ? PACE.stop_s : k === W_GIVE ? PACE.give_s : k === W_CROSS ? PACE.cross_s : 0);
const V_TOP = PACE.path * MPH; // Quickest's cost is seconds at this speed, so a metre never costs less than 1
// W32 routing: a metre walked between the place and the course, off the ways: twice a sidewalk walk's cost (scul.brf's
// 4.2), as the ground between isn't mapped; across Mass Ave (25 m) is still cheaper than a loop round to the other side
const WALK_COST = 8;
export const NOT_FREE = 1.35; // W70 alt: Wormholes' price of a metre that isn't transport-free, over scul.brf's
export const BARE_WORM = 1.1; // W77: and a bare metre (no bike support, Router.bare) a tenth more on top, so sharrows cost more than painted lanes
export const BARE_QUICK = 1.2; // W74 graph: arclight's D5, Quickest's price of a second ridden with no bike support (Router.bare)
/** Cruising speed in m/s on a directed edge. */
const cruise = (cls, bike, flags, wrong) => MPH * (wrong || bike === B.walk ? PACE.walk : bike === B.steps ? PACE.steps
  : (bike >= B.laned ? PACE.path : PACE.slow[CLASSES[cls]] ?? PACE.street) * (flags & F.UNPAVED ? PACE.unpaved : 1));

/**
 * Route styles: cost tables over one graph. `factor(sculFactor, cls, bike, flags, wrong)` is the cost per metre of
 * a directed edge (never below 1, so the straight-line heuristic stays admissible); `uphill` the cost per metre
 * climbed above `cutoff` (a grade); `turn` the cost of a 90-degree turn; `signal` a traffic signal's cost.
 */
export const STYLES = {
  // The default: scul.brf. Wormholes are magnetic, spacelanes cost 25, negi g-wells cost moderately.
  // W70 alt: and a metre its card doesn't count as transport-free (all but wormholes and protected lanes, walks too) costs
  // NOT_FREE times scul.brf's. At scul.brf's own price Porter Square to Hynes took Windsor St (67 %, 640 m bare) over the
  // MIT side (78 to 84 %, none bare) for a minute and three turns; over the 64 trips: +0.9 % time, +6.9 points car-free
  wormhole: { label: "Wormholes", factor: (f, cls, bike, flags, wrong, bare) => (wrong || (bike !== B.wormhole && bike !== B.shielded) ? NOT_FREE * f : f) * (bare ? BARE_WORM : 1), uphill: 100, cutoff: 0.01, turn: 90, signal: 20 }, // W70 alt; W77: BARE_WORM
  // scul.brf's ways (W70 alt: without Wormholes' NOT_FREE), but each metre of the reported climb (from a 0 % grade, beyond the 5 m buffer) costs 300 m of riding.
  // W32 routing: at 1,000 from a 0.3 % grade it detoured a kilometre for a metre the card didn't count, and climbed more
  // than another style on 11 of 62 trips; now it never climbs more than Wormholes, with 11 % less climb in 4 % less time.
  flat: { label: "Fewest negi g-wells", factor: (f) => f, uphill: 300, cutoff: 0, buffer: ASCEND_M, turn: 90, signal: 20 },
  // Time by PACE, in metres at the top speed, the climb counted as the reported climb is. Still legal (the wrong way is
  // walked, and costs one and a half times its walking time, so it is a few metres, not a block) and still
  // off spacelanes without a bike lane (three times their time). W32 routing: the wrong way cost scul.brf's penalty, 29 a
  // metre beside a spacelane, so from Mass Ave at Memorial Drive it rode 290 m east to save a 50 m walk west, and took
  // 772 s against Wormholes' 670 s (W31 nav audit, item 7).
  quickest: {
    label: "Quickest", uphill: PACE.climb_s * V_TOP, cutoff: 0, buffer: ASCEND_M, turn: PACE.turn_s * V_TOP,
    signal: PACE.signal_s * V_TOP, once: true, gate: PACE.gate_s * V_TOP, waits: true, // W67 graph3: waits, at PACE's seconds
    factor: (f, cls, bike, flags, wrong, bare) => { // W74 graph: bare
      const t = V_TOP / cruise(cls, bike, flags, wrong);
      return wrong ? 1.5 * t : cls === C.trunk && bike < B.laned ? 3 * t : bare ? BARE_QUICK * t : t; // W74 graph: D5
    },
    walk: 2 * V_TOP / (PACE.walk * MPH), // W32 routing: a walk between the place and the course, at twice its time
  },
};
export const DEFAULT_STYLE = "wormhole";
/** W21 routes: Scenic (car-free first) was what the default already does, so it was merged into it. */
export const STYLE_ALIASES = { scenic: "wormhole" };
export { M_PER_DEG, BUFFER_M, WALK_COST }; // W83 rustroute: for the search in WebAssembly (wasm.js)

/** Signed heading change in degrees from bearing byte a to bearing byte b (+ is right), in (-180, 180]. */
const turnDeg = (a, b) => { const d = ((b - a) & 255) * 360 / 256; return d > 180 ? d - 360 : d; };

export class Router {
  /** @param {ArrayBuffer|ArrayBufferView} data the graph file */
  constructor(data) {
    let buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const dv = new DataView(buf);
    const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
    if (magic !== "SCRG") throw new Error("not a Starchart routing graph");
    const hlen = dv.getUint32(8, true);
    const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hlen)));
    const base = 12 + hlen;
    const s = {};
    for (const [k, { offset, type, length }] of Object.entries(h.sections)) s[k] = new TYPES[type](buf, base + offset, length);
    this.header = h;
    this.s = s;
    const N = (this.N = h.junctions), E = (this.E = h.edges);
    this.names = new TextDecoder().decode(s.names).split("\n");
    // a local plane in metres for distances and the heuristic
    const [, S, , No] = h.bounds || [-180, -90, 180, 90]; // W73 tests: the west and east edges unused
    this.lat0 = (S + No) / 2;
    this.kx = M_PER_DEG * Math.cos(this.lat0 * Math.PI / 180);
    this.x = new Float64Array(N); this.y = new Float64Array(N);
    for (let i = 0; i < N; i++) { this.x[i] = s.lon[i] * 1e-6 * this.kx; this.y[i] = s.lat[i] * 1e-6 * M_PER_DEG; }
    // directed edges: d = 2e runs from -> to, d = 2e + 1 runs to -> from
    const deg = new Uint32Array(N + 1);
    for (let e = 0; e < E; e++) { deg[s.from[e]]++; deg[s.to[e]]++; }
    const start = (this.outStart = new Uint32Array(N + 1));
    for (let i = 0; i < N; i++) start[i + 1] = start[i] + deg[i];
    const fill = start.slice(0, N), out = (this.out = new Uint32Array(2 * E));
    for (let e = 0; e < E; e++) { out[fill[s.from[e]]++] = 2 * e; out[fill[s.to[e]]++] = 2 * e + 1; }
    // turn restrictions by incoming directed edge
    this.restr = new Map();
    for (let i = 0; i < (s.r_from?.length || 0); i++) {
      const k = s.r_from[i];
      if (!this.restr.has(k)) this.restr.set(k, []);
      this.restr.get(k).push({ to: s.r_to[i], only: s.r_only[i] === 1 });
    }
    // the largest connected piece of the network: start and end snap only onto it
    const parent = new Int32Array(N).map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let e = 0; e < E; e++) { const a = find(s.from[e]), b = find(s.to[e]); if (a !== b) parent[a] = b; }
    const size = new Uint32Array(N);
    for (let i = 0; i < N; i++) size[find(i)]++;
    let big = 0;
    for (let i = 0; i < N; i++) if (size[i] > size[big]) big = i;
    this.main = new Uint8Array(E);
    for (let e = 0; e < E; e++) this.main[e] = find(s.from[e]) === big ? 1 : 0;
    // per directed edge, for the search's inner loop: its head junction, its bearings out and in, restricted or not
    this.hd = new Uint32Array(2 * E); this.sb = new Uint8Array(2 * E); this.eb = new Uint8Array(2 * E);
    for (let d = 0; d < 2 * E; d++) { this.hd[d] = this.head(d); this.sb[d] = this.startB(d); this.eb[d] = this.endB(d); }
    this.hasR = new Uint8Array(2 * E);
    for (const k of this.restr.keys()) this.hasR[k] = 1;
    this.zone = this.intersections();
    this.wait = this.waits(); // W67 graph3
    this.costs = {};
    this.gen = 0;
    this.state = new Uint32Array(2 * E); // gen * 2 = open, gen * 2 + 1 = settled
    this.g = new Float64Array(2 * E);
    this.ehb = new Float32Array(2 * E);
    this.par = new Int32Array(2 * E);
    this.chpot = null; // W85 chpot: CH-potentials (chpot.js), once in; the search is plain A* until then (W83 algo's ALT tables before)
    this.pops = 0; // W83 algo: the heap pops of every search so far, for benchmarks
  }

  head(d) { const e = d >> 1; return d & 1 ? this.s.from[e] : this.s.to[e]; }
  tail(d) { const e = d >> 1; return d & 1 ? this.s.to[e] : this.s.from[e]; }
  startB(d) { const e = d >> 1; return d & 1 ? (this.s.bearing_end[e] + 128) & 255 : this.s.bearing_start[e]; }
  endB(d) { const e = d >> 1; return d & 1 ? (this.s.bearing_start[e] + 128) & 255 : this.s.bearing_end[e]; }
  bike(d) { const b = this.s.bike[d >> 1]; return d & 1 ? b >> 4 : b & 15; }
  wrong(d) { return (this.s.flags[d >> 1] & (d & 1 ? F.WRONG_REV : F.WRONG_FWD)) !== 0; }
  sculFactor(d) { return (d & 1 ? this.s.cost_rev : this.s.cost_fwd)[d >> 1] / 100; }
  name(d) { return this.names[this.s.name[d >> 1]] || ""; }
  rise(d) { return (this.s.elev_dm[this.head(d)] - this.s.elev_dm[this.tail(d)]) / 10; }
  /** W59 routes: directed edge d is ridden with the transports and no bike support: a through road (trunk to tertiary) with
   *  no lane or track (sharrows don't count, as the peek says), not tagged with a separate one beside it (W37 sidepath), and
   *  ridden, not walked. Quiet streets are not, whatever their lanes: OSM gives Back Bay's one-ways 2. */
  bare(d) { // W59 routes
    const e = d >> 1, s = this.s; // W59 routes
    if (this.bike(d) > B.shared || this.wrong(d) || s.cls[e] < C.trunk || s.cls[e] > C.tertiary) return false; // W59 routes
    return !(s.bike_side && ((s.bike_side[e] >> (d & 1 ? 4 : 0)) & S_SEPARATE)); // W59 routes: W37 sidepath
  } // W59 routes

  /**
   * W53 lanes: the motor lanes a turn from directed edge `legs[i][0]` crosses, or null. All must hold (SPEC §68): the
   * approach is a car road (trunk to residential) ridden on the road, not a bike way or a road whose bike way is separate;
   * the turn crosses the traffic, a port turn from the starboard edge (a bike lane or track there, or none) or a starboard
   * turn from a lone lane or track at port; and there are 2 or more motor lanes in the direction of travel. `cross` is the
   * lanes from the bike's edge to the nearest one whose turn:lanes allows the turn, that one included, or all of them
   * without turn:lanes, and it is 2 or more; turn:lanes that allow no lane this turn disagree with the course, and it stays
   * quiet. It never advises: it is the count. `turn` is each lane's arrows, left to right ("none" for none), and `use` the
   * lanes that turn this way; `box`, a bike box on the approach within BOX_M.
   */
  lanesAt(legs, i, type, junctionAt) { // W53 lanes
    const { s } = this; // W53 lanes
    if (!s.lanes || !/left|right/.test(type || "")) return null; // W53 lanes
    const d = legs[i][0], e = d >> 1, sh = d & 1 ? 4 : 0, bk = this.bike(d); // W53 lanes
    if (s.cls[e] < C.trunk || s.cls[e] > C.residential || bk >= B.wormhole) return null; // W53 lanes
    const side = (s.bike_side[e] >> sh) & 15; // W53 lanes
    if (side & S_SEPARATE) return null; // W53 lanes
    const edge = side & S_LEFT && !(side & S_RIGHT) ? "port" : "starboard", port = /left/.test(type); // W53 lanes
    if ((edge === "starboard") !== port) return null; // W53 lanes
    const tl = this.turnLanes(d); // W53 lanes
    const n = tl ? tl.length : (s.lanes[e] >> sh) & 15; // W53 lanes
    if (n < 2) return null; // W53 lanes
    const lr = port ? "left" : "right", want = type === `sharp_${lr}` ? [`sharp_${lr}`, lr] : type === lr ? [lr, `sharp_${lr}`] : [`slight_${lr}`, lr]; // W53 lanes
    const turn = tl && tl.map((v) => v.split(";").map((x) => x.trim() || "none")); // W53 lanes
    const use = turn && turn.map((a) => a.some((x) => want.includes(x))); // W53 lanes
    const k = use ? (port ? use.lastIndexOf(true) : use.indexOf(true)) : port ? 0 : n - 1; // W53 lanes
    const cross = port ? n - k : k + 1; // W53 lanes
    if (k < 0 || cross < 2) return null; // W53 lanes: no lane turns this way (the data and the course disagree), or the edge lane does
    if (!this.boxes) this.boxes = new Set(s.asl || []); // W53 lanes
    let box = false; // W53 lanes
    for (let j = i; j >= 0; j--) { // W53 lanes: back along the approach, leg by leg, until a leg starts BOX_M or more before the turn
      if ((box = this.boxes.has(legs[j][0])) || !j || junctionAt[i] - junctionAt[j - 1] >= BOX_M) break; // W53 lanes
    } // W53 lanes
    return { n, cross, side: edge, turn: turn || null, use: use || null, box }; // W53 lanes
  } // W53 lanes

  /** W53 lanes: directed edge d's turn:lanes, one value per lane left to right, or null (a binary search of tl_dir). */
  turnLanes(d) { // W53 lanes
    const { s } = this; // W53 lanes
    if (!s.tl_dir?.length) return null; // W53 lanes
    if (!this.tlNames) this.tlNames = new TextDecoder().decode(s.turn_lanes).split("\n"); // W53 lanes
    let lo = 0, hi = s.tl_dir.length - 1; // W53 lanes
    while (lo <= hi) { // W53 lanes
      const m = (lo + hi) >> 1; // W53 lanes
      if (s.tl_dir[m] === d) return this.tlNames[s.tl_str[m]].split("|"); // W53 lanes
      if (s.tl_dir[m] < d) lo = m + 1; else hi = m - 1; // W53 lanes
    } // W53 lanes
    return null; // W53 lanes
  } // W53 lanes

  /** The cost tables of a style, made once: cost per metre of each directed edge, and each junction's cost. */
  style(name = DEFAULT_STYLE) {
    name = STYLE_ALIASES[name] || name;
    if (this.costs[name]) return this.costs[name];
    const it = this.styleSteps(name); // W83 algo
    for (;;) { const r = it.next(); if (r.done) return r.value; } // W83 algo
  }

  /** W83 algo: style()'s build, yielding every 4096 directed edges (W85 chpot: chpot.js builds a style a slice at a time, between messages). */
  *styleSteps(name) {
    const st = STYLES[name];
    if (!st) throw new Error(`unknown route style ${name}`);
    const { s, E, N } = this;
    const perM = new Float32Array(2 * E), climbAt = new Float32Array(2 * E), turnW = new Float32Array(2 * E);
    const whole = new Float32Array(2 * E), waitC = st.waits ? new Float32Array(2 * E) : null; // W83 algo: filled in the loop
    for (let d = 0; d < 2 * E; d++) {
      const e = d >> 1;
      perM[d] = Math.max(1, st.factor(this.sculFactor(d), s.cls[e], this.bike(d), s.flags[e], this.wrong(d), this.bare(d))); // W74 graph: bare
      climbAt[d] = this.rise(d) - st.cutoff * s.len[e]; // the edge's change to the elevation buffer
      turnW[d] = s.flags[e] & (F.ROTARY | F.ROUTE) ? 0 : st.turn;
      perM[d] += turnW[d] * (s.curve ? s.curve[e] / 1000 : 0) / s.len[e]; // the turn cost of its bends, spread along it
      whole[d] = s.len[e] * perM[d]; // a whole edge's cost, climb aside
      if (waitC) waitC[d] = waitSec(this.wait[d]) * V_TOP; // W67 graph3: at the head
      if ((d & 0xfff) === 0xfff) yield; // W83 algo
    }
    yield; // W88 slices
    const node = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const f = s.node_flags[i];
      node[i] = f & N_BLOCKED ? Infinity : (f & N_SIGNAL && !st.once ? st.signal : 0) + (f & N_WALK ? st.gate ?? 100 : 0); // `once`: at entering an intersection (search)
    }
    const cos = new Float32Array(256).map((_, i) => 1 - Math.cos(i * 2 * Math.PI / 256));
    return (this.costs[name] ||= { name, st, perM, whole, climbAt, turnW, node, cos, waitC }); // W83 algo: name; ||=: unless a plan built it meanwhile
  }

  /** PACE's seconds per metre of directed edge d, its bends' turns spread along it. */
  secPerM(d) {
    const { s } = this, e = d >> 1, bends = s.flags[e] & (F.ROTARY | F.ROUTE) || !s.curve ? 0 : s.curve[e] / 1000;
    return 1 / cruise(s.cls[e], this.bike(d), s.flags[e], this.wrong(d)) + PACE.turn_s * bends / s.len[e];
  }

  /** A leg's waits at its end junction, going on to directed edge d2: the pulsar or gate, and the turn. */
  waitS(d, d2) {
    const f = this.s.node_flags[this.head(d)];
    const turn = this.s.flags[d2 >> 1] & (F.ROTARY | F.ROUTE) ? 0 : 1 - Math.cos(turnDeg(this.endB(d), this.startB(d2)) * Math.PI / 180);
    return (this.enters(d) ? PACE.signal_s : 0) + (f & N_WALK ? PACE.gate_s : 0) + PACE.turn_s * turn + waitSec(this.wait[d]); // W67 graph3: waitSec
  }

  /** W33 routing2: whether directed edge d enters an intersection with signals: its head is in one its tail isn't in. */
  enters(d) { const z = this.zone[this.head(d)]; return z >= 0 && z !== this.zone[this.tail(d)]; }

  /**
   * W33 routing2: each junction's intersection with signals (a signal junction's index), or -1: signals within
   * PACE.pulsar_m of each other are one intersection, and a junction within PACE.inside_m of one of its signals, by ways
   * no longer than that, is in it. OSM puts a signal on each approach and crossing, and a junction wherever a crosswalk or
   * sidewalk meets the road, so the edge into a signal is mostly a few metres long: until wave 33 a pulsar was waited at
   * only after 40 m of one edge, 7 of the 23 intersections from Porter to Haymarket (438 of 1,504 over 52 trips).
   */
  intersections() {
    const { s, N, x, y, outStart, out, hd } = this, R = PACE.pulsar_m;
    const sig = [];
    for (let i = 0; i < N; i++) if (s.node_flags[i] & N_SIGNAL) sig.push(i);
    const cell = new Map(), at = (cx, cy) => cx * 1e6 + cy;
    for (const i of sig) {
      const k = at(Math.floor(x[i] / R), Math.floor(y[i] / R));
      if (!cell.has(k)) cell.set(k, []);
      cell.get(k).push(i);
    }
    const zone = new Int32Array(N).fill(-1);
    for (const i of sig) zone[i] = i;
    const find = (i) => { while (zone[i] !== i) i = zone[i] = zone[zone[i]]; return i; };
    for (const i of sig) {
      const cx = Math.floor(x[i] / R), cy = Math.floor(y[i] / R);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of cell.get(at(cx + a, cy + b)) || []) {
        if (j < i && Math.hypot(x[i] - x[j], y[i] - y[j]) < R) { const p = find(i), q = find(j); if (p !== q) zone[p] = q; }
      }
    }
    for (const i of sig) zone[i] = find(i);
    // the junctions near each signal, by the ways from it, each in its nearest signal's intersection
    const near = new Float64Array(N).fill(Infinity);
    for (const i of sig) {
      near[i] = 0;
      const stack = [i];
      while (stack.length) {
        const v = stack.pop();
        for (let k = outStart[v]; k < outStart[v + 1]; k++) {
          const w = hd[out[k]], dd = Math.hypot(x[w] - x[i], y[w] - y[i]);
          if (dd < PACE.inside_m && dd < near[w]) { near[w] = dd; zone[w] = zone[i]; stack.push(w); }
        }
      }
    }
    return zone;
  }

  /**
   * W67 graph3: each directed edge's wait at its head junction (W_STOP, W_GIVE, W_CROSS or 0): the graph's stops and
   * give-ways by the approaches they face (build_graph.py), and a crossing way (F.CROSSING) into a junction on a tertiary or
   * bigger road, outside any intersection with signals.
   */
  waits() {
    const { s, E, outStart, out, zone } = this, w = new Uint8Array(2 * E);
    for (let i = 0; i < (s.wait_dir?.length || 0); i++) w[s.wait_dir[i]] = s.wait_kind[i];
    for (let d = 0; d < 2 * E; d++) {
      if (w[d] || !(s.flags[d >> 1] & F.CROSSING)) continue;
      const v = this.head(d);
      if (s.node_flags[v] & N_SIGNAL || zone[v] >= 0) continue;
      for (let k = outStart[v]; k < outStart[v + 1]; k++) {
        const e = out[k] >> 1;
        if (s.cls[e] >= C.trunk && s.cls[e] <= C.tertiary && !(s.flags[e] & F.CROSSING)) { w[d] = W_CROSS; break; }
      }
    }
    return w;
  }

  // ---- geometry --------------------------------------------------------------------------------------
  /** An edge's points from its `from` junction to its `to` junction, as [lon, lat], with their distances along it. */
  edgePoints(e) {
    const { s } = this;
    const a = s.from[e], b = s.to[e];
    const pts = [[s.lon[a] * 1e-6, s.lat[a] * 1e-6]];
    let lon = s.lon[a], lat = s.lat[a];
    for (let k = s.shape0[e]; k < s.shape0[e + 1]; k++) {
      lon += s.shape[2 * k]; lat += s.shape[2 * k + 1];
      pts.push([lon * 1e-6, lat * 1e-6]);
    }
    pts.push([s.lon[b] * 1e-6, s.lat[b] * 1e-6]);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + this.metres(pts[i - 1], pts[i]));
    const L = s.len[e], k = cum[cum.length - 1] ? L / cum[cum.length - 1] : 0;
    return { pts, cum: cum.map((c) => c * k) };
  }

  metres(a, b) { return Math.hypot((b[0] - a[0]) * this.kx, (b[1] - a[1]) * M_PER_DEG); }

  /** Nearest point on the main network to lonlat: { e, t (0..1 along the edge), d (metres away), at }. */
  snap(lonlat) {
    if (!this.grid) this.buildGrid();
    const { cell, gx0, gy0, nx, ny, cs, items } = this.grid;
    const px = lonlat[0] * this.kx, py = lonlat[1] * M_PER_DEG;
    const cx = Math.floor((px - gx0) / cell), cy = Math.floor((py - gy0) / cell);
    let best = null;
    for (let r = 0; r < 64; r++) {
      for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) {
        if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== r || i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const c = j * nx + i;
        for (let k = cs[c]; k < cs[c + 1]; k++) {
          const p = this.closest(items[k], px, py);
          if (!best || p.d < best.d) best = p;
        }
      }
      if (best && best.d < r * cell) break;
    }
    return best;
  }

  /** The point of edge e nearest (px, py) in the local plane: { e, t, d, at, dir (its segment's unit vector) }. */
  closest(e, px, py) {
    const { pts, cum } = this.edgePoints(e);
    let best = null;
    for (let q = 0; q + 1 < pts.length; q++) {
      const ax = pts[q][0] * this.kx, ay = pts[q][1] * M_PER_DEG, bx = pts[q + 1][0] * this.kx, by = pts[q + 1][1] * M_PER_DEG;
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
      const u = L2 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / L2)) : 0;
      const dd = Math.hypot(ax + u * vx - px, ay + u * vy - py);
      if (!best || dd < best.d) {
        const along = cum[q] + u * (cum[q + 1] - cum[q]);
        const L = Math.sqrt(L2) || 1;
        best = { e, t: this.s.len[e] ? along / this.s.len[e] : 0, d: dd, at: [(ax + u * vx) / this.kx, (ay + u * vy) / M_PER_DEG], dir: [vx / L, vy / L] };
      }
    }
    return best;
  }

  /**
   * W32 routing: where a course may start or end for a place: the nearest point of the nearest way, and of every way
   * across from the place (the walk to its nearest point crosses its line, not along it or along the nearest way) within
   * WALK_M of it and ACROSS_M farther than the nearest, each with the walk to the place (`walk`, metres); but not on a
   * spacelane without a bike lane or across one. Beyond WALK_M, the nearest point alone, with no walk. A rider stops on
   * whichever side is handy and walks the bike over.
   */
  near(lonlat) {
    const best = this.snap(lonlat);
    if (!best) return null;
    if (best.d > WALK_M) return [{ ...best, walk: 0 }];
    const { cell, gx0, gy0, nx, ny, cs, items } = this.grid, { s } = this;
    const px = lonlat[0] * this.kx, py = lonlat[1] * M_PER_DEG, seen = new Set();
    for (let j = Math.floor((py - WALK_M - gy0) / cell); j <= Math.floor((py + WALK_M - gy0) / cell); j++)
      for (let i = Math.floor((px - WALK_M - gx0) / cell); i <= Math.floor((px + WALK_M - gx0) / cell); i++)
        if (i >= 0 && j >= 0 && i < nx && j < ny) for (let k = cs[j * nx + i]; k < cs[j * nx + i + 1]; k++) seen.add(items[k]);
    // across: the walk at least 45 degrees off the way's line at its point, and off the nearest way's (else the course
    // rides along that way to it)
    const across = (p) => {
      const wx = p.at[0] * this.kx - px, wy = p.at[1] * M_PER_DEG - py, L = Math.hypot(wx, wy) || 1;
      return [p, best].every((q) => Math.abs(wx * q.dir[1] - wy * q.dir[0]) / L > Math.SQRT1_2);
    };
    const near = [...seen].map((e) => this.closest(e, px, py)).filter((p) => p.d <= WALK_M && (p.e === best.e || (across(p) && p.d <= best.d + ACROSS_M)));
    const lane = (e) => s.cls[e] === C.trunk && Math.max(this.bike(2 * e), this.bike(2 * e + 1)) < B.laned;
    const cross = (p) => near.some((q) => lane(q.e) && q.e !== p.e && this.crosses(q.e, [px, py], [p.at[0] * this.kx, p.at[1] * M_PER_DEG]));
    const out = near.filter((p) => p.e === best.e || (!lane(p.e) && !cross(p))).map((p) => ({ ...p, walk: p.d, place: lonlat }));
    return out.length ? out : [{ ...best, walk: best.d, place: lonlat }];
  }

  /** Whether edge e's line crosses the segment from p to q (points in the local plane). */
  crosses(e, p, q) {
    const { pts } = this.edgePoints(e);
    const side = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = [pts[k][0] * this.kx, pts[k][1] * M_PER_DEG], b = [pts[k + 1][0] * this.kx, pts[k + 1][1] * M_PER_DEG];
      if (side(a, b, p) * side(a, b, q) < 0 && side(p, q, a) * side(p, q, b) < 0) return true;
    }
    return false;
  }

  buildGrid() {
    const cell = 250, { E } = this; // W73 tests
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < this.N; i++) { x0 = Math.min(x0, this.x[i]); x1 = Math.max(x1, this.x[i]); y0 = Math.min(y0, this.y[i]); y1 = Math.max(y1, this.y[i]); }
    const nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1), ny = Math.max(1, Math.ceil((y1 - y0) / cell) + 1);
    const lists = new Map();
    for (let e = 0; e < E; e++) {
      if (!this.main[e]) continue;
      const { pts } = this.edgePoints(e);
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const p of pts) { const X = p[0] * this.kx, Y = p[1] * M_PER_DEG; a = Math.min(a, X); c = Math.max(c, X); b = Math.min(b, Y); d = Math.max(d, Y); }
      for (let j = Math.floor((b - y0) / cell); j <= Math.floor((d - y0) / cell); j++)
        for (let i = Math.floor((a - x0) / cell); i <= Math.floor((c - x0) / cell); i++) {
          if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
          const k = j * nx + i;
          if (!lists.has(k)) lists.set(k, []);
          lists.get(k).push(e);
        }
    }
    const cs = new Uint32Array(nx * ny + 1);
    for (let k = 0; k < nx * ny; k++) cs[k + 1] = cs[k] + (lists.get(k)?.length || 0);
    const items = new Uint32Array(cs[nx * ny]);
    for (const [k, l] of lists) items.set(l, cs[k]);
    this.grid = { cell, gx0: x0, gy0: y0, nx, ny, cs, items };
  }

  // ---- the search ------------------------------------------------------------------------------------
  /** Plan a course. from, each via and to are [lon, lat] (or {lon, lat}); style is a key of STYLES. */
  route({ from, via = [], to, style = DEFAULT_STYLE, heading = null, about = false, avoid = null, night = false }) { // W56 reroute: about; W73 avoid: avoid; W105 night: night
    if (night && !this.dark) return this.routeAtNight(arguments[0]); // W105 night
    if (avoid?.length && !this.avoiding) return this.routeAvoiding(arguments[0]); // W73 avoid
    if (about && heading != null) { // W56 reroute: the course the way the ship is going, or back the way it came, whichever is quicker
      const ahead = this.route({ from, via, to, style, heading }); // W56 reroute
      this.about = true; // W56 reroute: the turn back onto the course may be right at the start
      let back; // W56 reroute
      try { back = this.route({ from, via, to, style, heading: (heading + 180) % 360 }); } finally { this.about = false; } // W56 reroute
      return back && (!ahead || back.time_s + ABOUT_S < ahead.time_s) ? { ...back, about: true } : ahead; // W56 reroute
    } // W56 reroute
    style = STYLE_ALIASES[style] || style;
    const ll = (p) => (Array.isArray(p) ? p : [p.lon, p.lat]);
    const pts = [from, ...(via || []), to].map((p) => this.snap(ll(p)));
    if (pts.some((p) => !p)) return null;
    // W32 routing: the start and the end may be on any way near the place, with a walk to it (`near`); a via is on the
    // way nearest it
    const ends = [this.near(ll(from)), this.near(ll(to))], at = (k) => (k === 0 ? ends[0] : k === pts.length - 1 ? ends[1] : [{ ...pts[k], walk: 0 }]);
    const cost = this.style(style);
    let legs = [], total = 0, seeds = null, m = 0, start = null, end = null;
    const via_m = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      // a via is left the way the last leg came in, unless that way leads nowhere (a dead end): then back
      // W31 navvoice: a start with a `heading` (a re-plot from the moving ship) leaves the way the ship is going, unless
      // that way leads nowhere; with seeds, the start candidates (W32 routing's walk) are unused, so it starts on the ship's road
      if (k === 0 && heading != null) seeds = this.ahead(pts[0], heading);
      this.backs = k === 0 && heading != null ? this.backsNear(pts[0], heading) : null; // and doesn't come about on another way near it
      const path = (seeds && this.search(at(k), at(k + 1), cost, seeds)) || this.search(at(k), at(k + 1), cost);
      if (!path) return null;
      total += path.cost;
      if (k === 0) start = path.a;
      end = path.b;
      let part = this.legsOf(path, path.b);
      for (const [d, f0, f1] of part) m += this.s.len[d >> 1] * (f1 - f0);
      const prev = legs.at(-1);
      if (prev && prev[0] === part[0][0] && Math.abs(prev[2] - part[0][1]) < 1e-9) { prev[2] = part[0][2]; part = part.slice(1); } // on through the via
      legs.push(...part);
      if (k + 1 < pts.length - 1) via_m.push(Math.round(m));
      const [d, , f1] = legs.at(-1);
      seeds = [[d, 1 - f1]];
    }
    this.backs = null; // W31 navvoice
    if (legs.length > 1) legs = legs.filter(([, f0, f1]) => f1 - f0 > 1e-6);
    if (!legs.length) legs = [[2 * end.e, end.t, end.t]];
    const out = { ...this.describe(legs, end, total, start), style };
    if (this.avoiding) out.edges = [...new Set(legs.map(([d]) => d >> 1))]; // W73 avoid: for routeAvoiding, which takes it off
    if (via_m.length) out.via_m = via_m;
    return out;
  }

  /** W73 avoid: route() with `avoid`, a list of streets { name, at: [lon, lat] }: each one near the trip (within AVOID_M
   *  plus a third of its span, of the box round its points) costs AVOID_X times as much. The route says each street's // W73 avoid
   *  part in `avoids`: "bent" (the course without avoids rode it, this one doesn't), "ridden" (no way round), "clear" // W73 avoid
   *  (neither rode it), "missing" (nothing of that name near its point on this graph) or "far" (not looked for). */ // W73 avoid
  routeAvoiding(o) { // W73 avoid
    const ll = (p) => (Array.isArray(p) ? p : [p.lon, p.lat]), pts = [o.from, ...(o.via || []), o.to].map(ll); // W73 avoid
    const box = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))]; // W73 avoid
    const slack = AVOID_M + this.metres([box[0], box[1]], [box[2], box[3]]) / 3, gap = (p) => this.metres(p, [Math.max(box[0], Math.min(box[2], p[0])), Math.max(box[1], Math.min(box[3], p[1]))]); // W73 avoid
    const sets = o.avoid.map((a) => (Array.isArray(a?.at) && gap(a.at) <= slack ? this.avoidEdges(a) : null)); // W73 avoid: null, far
    const all = [...new Set(sets.flatMap((x) => x || []))], plan = () => this.route({ ...o, avoid: null }); // W73 avoid
    let r = null, plain = null; // W73 avoid
    this.avoiding = true; // W73 avoid: route() lists the edges it rode
    try { // W73 avoid
      if (all.length) { // W73 avoid: the avoided edges dearer in the style's tables while it plans, then as they were
        const c = this.style(o.style), keep = all.map((e) => [c.perM[2 * e], c.perM[2 * e + 1], c.whole[2 * e], c.whole[2 * e + 1]]); // W73 avoid
        for (const e of all) for (const d of [2 * e, 2 * e + 1]) { c.perM[d] *= AVOID_X; c.whole[d] *= AVOID_X; } // W73 avoid
        try { r = plan(); } finally { all.forEach((e, i) => { [c.perM[2 * e], c.perM[2 * e + 1], c.whole[2 * e], c.whole[2 * e + 1]] = keep[i]; }); } // W73 avoid
      } // W73 avoid
      plain = plan(); // W73 avoid
    } finally { this.avoiding = false; } // W73 avoid
    if (!all.length) r = plain; // W73 avoid
    if (!r) return null; // W73 avoid
    const rode = new Set(r.edges), would = new Set(plain?.edges || []), hits = (x, set) => x.some((e) => set.has(e)); // W73 avoid
    const avoids = sets.map((x) => (!x ? "far" : !x.length ? "missing" : hits(x, rode) ? "ridden" : hits(x, would) ? "bent" : "clear")); // W73 avoid
    delete r.edges; // W73 avoid
    return { ...r, avoids }; // W73 avoid
  } // W73 avoid
  /** W105 night: route() at night: the unlit paths' directed edges NIGHT_X dearer in the style's tables while it plans, then as // W105 night
   *  they were (as routeAvoiding does, so the CH-potentials and WebAssembly see the same tables). */ // W105 night
  routeAtNight(o) { // W105 night
    const s = this.s; // W105 night
    if (!this.unlit) { this.unlit = []; if (s.lit) for (let d = 0; d < 2 * this.E; d++) if (s.lit[d >> 1] === LIT_NO && (PATHS.has(s.cls[d >> 1]) || this.bike(d) === B.wormhole)) this.unlit.push(d); } // W105 night
    const c = this.style(o.style || DEFAULT_STYLE), keep = this.unlit.map((d) => [c.perM[d], c.whole[d]]); // W105 night
    for (const d of this.unlit) { c.perM[d] *= NIGHT_X; c.whole[d] *= NIGHT_X; } // W105 night
    this.dark = true; // W105 night: a nested route() (about, avoid) plans on these tables as they are
    try { return this.route(o); } finally { this.dark = false; this.unlit.forEach((d, i) => { [c.perM[d], c.whole[d]] = keep[i]; }); } // W105 night
  } // W105 night
  /** W73 avoid: the edges of an avoided street { name, at }: the edges named `name` (any case; "" is the name of the edge
   *  nearest `at`, and an unnamed one keeps to its road class) within AVOID_SNAP_M of `at`, and those of the same name // W73 avoid
   *  joined to them, junction by junction, while within AVOID_M of `at`; so a name the graph has elsewhere, or a street // W73 avoid
   *  that no longer reaches the point, is never taken. [] when nothing of that name is near. */ // W73 avoid
  avoidEdges({ name = "", at }) { // W73 avoid
    if (!this.grid) this.buildGrid(); // W73 avoid
    const { cell, gx0, gy0, nx, ny, cs, items } = this.grid, { s } = this; // W73 avoid
    const px = at[0] * this.kx, py = at[1] * M_PER_DEG, d = new Map(); // W73 avoid: each edge near, its distance from the point
    for (let j = Math.floor((py - AVOID_M - gy0) / cell); j <= Math.floor((py + AVOID_M - gy0) / cell); j++) // W73 avoid
      for (let i = Math.floor((px - AVOID_M - gx0) / cell); i <= Math.floor((px + AVOID_M - gx0) / cell); i++) // W73 avoid
        if (i >= 0 && j >= 0 && i < nx && j < ny) for (let k = cs[j * nx + i]; k < cs[j * nx + i + 1]; k++) if (!d.has(items[k])) d.set(items[k], this.closest(items[k], px, py).d); // W73 avoid
    const norm = (t) => String(t || "").trim().toLowerCase(); // W73 avoid
    let want = norm(name), cls = -1; // W73 avoid
    if (!want) { let e0 = -1; for (const [e, m] of d) if (m <= AVOID_SNAP_M && (e0 < 0 || m < d.get(e0))) e0 = e; if (e0 < 0) return []; want = norm(this.names[s.name[e0]]); if (!want) cls = s.cls[e0]; } // W73 avoid
    const same = (e) => d.get(e) <= AVOID_M && norm(this.names[s.name[e]]) === want && (cls < 0 || s.cls[e] === cls); // W73 avoid
    const got = new Set([...d.keys()].filter((e) => d.get(e) <= AVOID_SNAP_M && same(e))), todo = [...got]; // W73 avoid
    while (todo.length) { // W73 avoid
      const e = todo.pop(); // W73 avoid
      for (const v of [s.from[e], s.to[e]]) for (let k = this.outStart[v]; k < this.outStart[v + 1]; k++) { const e2 = this.out[k] >> 1; if (!got.has(e2) && same(e2)) { got.add(e2); todo.push(e2); } } // W73 avoid
    } // W73 avoid
    return [...got]; // W73 avoid
  } // W73 avoid
  /** `a` and `b`: where the leg may start and end, as `near` gives them, each with the walk to its place, costed at the
   *  style's `walk` per metre. `seeds`: [directed edge, fraction of it left to ride] to start from; by default both ways
   *  along each of a's edges. */
  search(a, b, cost, seeds = a.flatMap((p) => [[2 * p.e, 1 - p.t, p], [2 * p.e + 1, p.t, p]])) {
    const { s, x, y, state, g, ehb, par, outStart, out, hd, sb, eb: endb, hasR, zone } = this;
    const backs = this.backs; // W31 navvoice
    const { perM, whole, climbAt, turnW, node, cos, st, waitC } = cost; // W67 graph3: waitC
    const uphill = st.uphill, buffer = st.buffer ?? BUFFER_M, once = !!st.once, len = s.len;
    const gen = ++this.gen;
    const OPEN = gen * 2, DONE = gen * 2 + 1;
    if (gen * 2 + 1 >= 0xffffffff) { state.fill(0); this.gen = 0; return this.search(a, b, cost, seeds); }
    // the heuristic aims at the place: a walk costs at least its length, so riding to a way near it and walking on
    // costs at least the straight line to the place
    const walkC = st.walk ?? WALK_COST, aim = b[0].walk > 0 ? b[0].place : b[0].at, tx = aim[0] * this.kx, ty = aim[1] * M_PER_DEG;
    const ends = new Map(); // junction -> the ends on its edges: [directed edge onto it, fraction of it, the end, walk cost]
    for (const p of b) {
      for (const [v, dd, frac] of [[s.from[p.e], 2 * p.e, p.t], [s.to[p.e], 2 * p.e + 1, 1 - p.t]]) {
        if (!ends.has(v)) ends.set(v, []);
        ends.get(v).push([dd, frac, p, p.walk * walkC]);
      }
    }
    // a min-heap of (f, d) with lazy deletion
    let hf = new Float64Array(1024), hq = new Int32Array(1024), n = 0;
    const push = (f, d) => {
      if (n === hf.length) { const f2 = new Float64Array(n * 2), d2 = new Int32Array(n * 2); f2.set(hf); d2.set(hq); hf = f2; hq = d2; }
      let i = n++;
      while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= f) break; hf[i] = hf[p]; hq[i] = hq[p]; i = p; }
      hf[i] = f; hq[i] = d;
    };
    const pop = () => {
      const d = hq[0], lf = hf[--n], ld = hq[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= lf) break;
        hf[i] = hf[c]; hq[i] = hq[c]; i = c;
      }
      hf[i] = lf; hq[i] = ld;
      return d;
    };
    // W83 algo: Math.sqrt over Math.hypot (exact here, and faster). W85 chpot: with CH-potentials (chpot.js), the larger of the
    // straight line and the potential, which replaced W83 algo's ALT tables: its bound is at least theirs everywhere, and consistent
    const cp = this.chpot ?? null, si = cp ? cp.styleOf(cost) : -1, hp = si >= 0 ? cp.prepare(si, b, walkC) : null; // W85 chpot
    const h = hp ? (v, d) => { const dx = x[v] - tx, dy = y[v] - ty, e = Math.sqrt(dx * dx + dy * dy), p = hp(d); return p > e ? p : e; } // W85 chpot
      : (v) => { const dx = x[v] - tx, dy = y[v] - ty; return Math.sqrt(dx * dx + dy * dy); }; // W83 algo
    const endMark = this.endMark ??= new Uint32Array(this.N); // W83 algo: a junction with an end on its edges is marked with gen, so most pops skip ends.get
    for (const j of ends.keys()) endMark[j] = gen; // W83 algo
    let pops = 0; // W83 algo
    const climbCost = (buf0, dh) => { // BRouter's uphill buffer: only climbing beyond it is paid for
      let e2 = buf0 + dh, c = 0;
      if (e2 > buffer) { c = (e2 - buffer) * st.uphill; e2 = buffer; } else if (e2 < 0) e2 = 0;
      return [c, e2];
    };
    const f0 = new Map(), from = new Map(); // where each seed starts, as a fraction of its own direction, and its start
    const seed = (d, frac, p) => {
      const e = d >> 1, L = s.len[e] * frac;
      const [cc, e2] = climbCost(0, climbAt[d] * frac);
      g[d] = L * perM[d] + cc + (p ? p.walk * walkC : 0); ehb[d] = e2; par[d] = -1; state[d] = OPEN;
      f0.set(d, 1 - frac); from.set(d, p);
      push(g[d] + h(this.head(d), d), d); // W85 chpot: d
    };
    for (const [d, frac, p] of seeds) seed(d, frac, p);
    let best = Infinity, bestD = -2, bestVia = -1, bestB = null;
    // an end on a seed's edge, after the start in its direction: a direct ride
    for (const [d, frac, p] of seeds) for (const q of b) {
      if (d >> 1 !== q.e) continue;
      const p0 = 1 - frac, p1 = d & 1 ? 1 - q.t : q.t;
      if (p1 < p0) continue;
      const c = (p ? p.walk * walkC : 0) + s.len[q.e] * (p1 - p0) * perM[d] + climbCost(0, climbAt[d] * (p1 - p0))[0] + q.walk * walkC;
      if (c < best) { best = c; bestD = -1; bestVia = d; bestB = q; }
    }
    while (n > 0) {
      if (hf[0] >= best) break;
      const d = pop(); pops++; // W83 algo: pops
      if (state[d] === DONE) continue;
      state[d] = DONE;
      const v = hd[d], gd = g[d];
      const ed = d >> 1;
      // `once`: a pulsar is waited at once per intersection, on entering it (W33 routing2: `intersections`)
      const nc = (once && zone[v] >= 0 && zone[v] !== zone[hd[d ^ 1]] ? node[v] + st.signal : node[v]) + (waitC ? waitC[d] : 0); // W67 graph3: waitC
      if (nc === Infinity) continue;
      const eb = endb[d], r = hasR[d] ? this.restr.get(d) : null, hb = ehb[d];
      // an end: onto its edge part way, then the walk to the place
      const here = endMark[v] === gen ? ends.get(v) : undefined; // W83 algo: endMark
      if (here) for (const [dd, frac, q, wc] of here) {
        if ((dd >> 1) === ed || !this.allowed(r, dd)) continue;
        const c = gd + nc + turnW[dd] * cos[(sb[dd] - eb) & 255] * (frac > 0 ? 1 : 0)
          + len[dd >> 1] * frac * perM[dd] + climbCost(hb, climbAt[dd] * frac)[0] + wc;
        if (c < best) { best = c; bestD = d; bestVia = dd; bestB = q; }
      }
      for (let k = outStart[v], k1 = outStart[v + 1]; k < k1; k++) {
        const d2 = out[k];
        if ((d2 >> 1) === ed) continue; // no turning back on the same edge
        if (state[d2] === DONE) continue; // W85 chpot: the potential is consistent, so a settled edge stays settled (ALT's reopening gone)
        if (r && !this.allowed(r, d2)) continue;
        let e3 = hb + climbAt[d2], cc = 0;
        if (e3 > buffer) { cc = (e3 - buffer) * uphill; e3 = buffer; } else if (e3 < 0) e3 = 0;
        const c = gd + nc + turnW[d2] * cos[(sb[d2] - eb) & 255] + whole[d2] + cc + (backs !== null && backs.has(d2) ? BACK_COST : 0);
        if (state[d2] !== OPEN || c < g[d2]) {
          g[d2] = c; ehb[d2] = e3; par[d2] = d; state[d2] = OPEN;
          const w = hd[d2];
          push(c + h(w, d2), d2); // W83 algo: h; W85 chpot: d2
        }
      }
    }
    this.pops += pops; // W83 algo
    if (best === Infinity) return null;
    const ds = [];
    for (let d = bestD; d >= 0; d = par[d]) ds.push(d);
    ds.reverse();
    const d0 = bestD === -1 ? bestVia : ds[0];
    return { ds, last: bestVia, cost: best, direct: bestD === -1, f0: f0.get(d0), a: from.get(d0) || null, b: bestB };
  }

  /** W31 navvoice: the seed that rides snap point `p`'s edge within 60° of `heading` (degrees from north), or null when
   *  the edge runs across the heading. */
  ahead(p, heading) {
    const { pts, cum } = this.edgePoints(p.e), m = p.t * this.s.len[p.e];
    let q = 0;
    while (q < pts.length - 2 && cum[q + 1] < m) q++;
    const b = (Math.atan2((pts[q + 1][0] - pts[q][0]) * this.kx, (pts[q + 1][1] - pts[q][1]) * M_PER_DEG) * 180) / Math.PI;
    const off = Math.abs(((heading - b + 540) % 360) - 180);
    return off < 60 ? [[2 * p.e, 1 - p.t]] : off > 120 ? [[2 * p.e + 1, p.t]] : null;
  }

  /** W31 navvoice: the directed edges that set out from a junction within `BACK_M` of snap point `p` more than 120° from
   *  `heading`: a way back past the ship, which a course from it pays `BACK_COST` to take (a U-turn by the next junction). */
  backsNear(p, heading) {
    const { cell, gx0, gy0, nx, ny, cs, items } = this.grid, out = new Set();
    const px = p.at[0] * this.kx, py = p.at[1] * M_PER_DEG, r = Math.ceil(BACK_M / cell);
    const cx = Math.floor((px - gx0) / cell), cy = Math.floor((py - gy0) / cell);
    for (let j = cy - r; j <= cy + r; j++) for (let i = cx - r; i <= cx + r; i++) {
      if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
      for (let k = cs[j * nx + i]; k < cs[j * nx + i + 1]; k++) for (const d of [2 * items[k], 2 * items[k] + 1]) {
        const v = this.tail(d);
        if (Math.hypot(this.x[v] - px, this.y[v] - py) > BACK_M) continue;
        if (Math.abs(((heading - (this.sb[d] * 360) / 256 + 540) % 360) - 180) > 120) out.add(d);
      }
    }
    return out;
  }

  allowed(r, d2) {
    if (!r) return true;
    const e2 = d2 >> 1;
    for (const x of r) {
      const te = x.to >> 1;
      if (x.only ? te !== e2 : te === e2) return false;
    }
    return true;
  }

  // ---- the course ------------------------------------------------------------------------------------
  /** Points of directed edge d between fractions f0 and f1 of its own direction. */
  piece(d, f0 = 0, f1 = 1) {
    const e = d >> 1;
    let { pts, cum } = this.edgePoints(e);
    const L = this.s.len[e];
    if (d & 1) { pts = pts.slice().reverse(); cum = cum.map((c) => L - c).reverse(); }
    const at = (m) => {
      let i = 0;
      while (i < cum.length - 2 && cum[i + 1] < m) i++;
      const u = cum[i + 1] > cum[i] ? (m - cum[i]) / (cum[i + 1] - cum[i]) : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * u, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u];
    };
    const m0 = f0 * L, m1 = f1 * L;
    const outp = [at(m0)];
    for (let i = 0; i < pts.length; i++) if (cum[i] > m0 + 1e-6 && cum[i] < m1 - 1e-6) outp.push(pts[i]);
    outp.push(at(m1));
    return { pts: outp, m: m1 - m0 };
  }

  /** A path's legs: [directed edge, fraction from, fraction to], a start or end right on a junction left out. */
  legsOf(path, b) {
    let legs = [];
    if (path.direct) {
      const d = path.last;
      legs.push([d, path.f0, d & 1 ? 1 - b.t : b.t]);
    } else {
      legs.push([path.ds[0], path.f0, 1]);
      for (const d of path.ds.slice(1)) legs.push([d, 0, 1]);
      const dl = path.last;
      legs.push([dl, 0, dl & 1 ? 1 - b.t : b.t]);
    }
    if (legs.length > 1) legs = legs.filter(([, f0, f1]) => f1 - f0 > 1e-6);
    if (!legs.length) legs = [[path.last, 0, 0]];
    return legs;
  }

  /** `b` and `a`: where the course ends and starts, as `near` gives them; a walk to or from the place is `walk`. */
  describe(legs, b, cost, a = null) {
    const { s } = this;
    const geometry = [], ends = [];
    const junctionAt = []; // distance along the course at the end of each leg
    const bike_m = Object.fromEntries(BIKE.map((k) => [k, 0]));
    let dist = 0, time = 0;
    const elev = [];
    const prof = [], ways = []; // W53 turns: the course strip's heights [at_m, z_m] and way kinds [at_m, kind], in runs
    const steps = []; // W54 flight: the flights of steps along it, [from_m, to_m]
    const walks = []; // W86 ride: the stretches walked, [from_m, to_m]: steps, ways a bike is walked on, and the wrong way up a one-way (cruise's PACE.walk)
    const bare = []; // W59 routes: the stretches with no bike support, [from_m, to_m] (Router.bare)
    const dust = []; // W104 oss2: the unpaved stretches, [from_m, to_m]
    const junk = [], tracks = []; // W67 graph3: the Space Junk and the track crossings ridden through, at the leg's end junction
    const stops = []; // W86 stops: the stop signs met, at the junction the approach's sign faces [at_m, lon, lat]
    for (const [i, [d, f0, f1]] of legs.entries()) {
      const { pts, m } = this.piece(d, f0, f1);
      const next = legs[i + 1]?.[0];
      time += m * this.secPerM(d) + (next === undefined ? 0 : next >> 1 === d >> 1 ? 2 * PACE.turn_s : this.waitS(d, next)); // turning back at a via
      for (const p of geometry.length ? pts.slice(1) : pts) geometry.push([+p[0].toFixed(6), +p[1].toFixed(6)]);
      const z0 = s.elev_dm[this.tail(d)] / 10, z1 = s.elev_dm[this.head(d)] / 10;
      if (!elev.length) elev.push(z0 + (z1 - z0) * f0);
      if (!prof.length) prof.push([0, +elev[0].toFixed(1)]); // W53 turns
      elev.push(z0 + (z1 - z0) * f1);
      const k = this.kind(d); if (ways.at(-1)?.[1] !== k && m > 0) ways.push([Math.round(dist), k]); // W53 turns
      if (s.flags[d >> 1] & F.UNPAVED && m > 0) { const t = dust.at(-1); if (t && Math.round(dist) - t[1] <= 1) t[1] = Math.round(dist + m); else dust.push([Math.round(dist), Math.round(dist + m)]); } // W104 oss2
      if (this.bare(d) && m > 0) { const t = bare.at(-1); if (t && Math.round(dist) - t[1] <= 1) t[1] = Math.round(dist + m); else bare.push([Math.round(dist), Math.round(dist + m)]); } // W59 routes
      if ((this.bike(d) === B.walk || this.bike(d) === B.steps || this.wrong(d)) && m > 0) { const w = walks.at(-1); if (w && Math.round(dist) - w[1] <= 1) w[1] = Math.round(dist + m); else walks.push([Math.round(dist), Math.round(dist + m)]); } // W86 ride
      if (this.bike(d) === B.steps && m > 0) { const st = steps.at(-1); if (st && Math.round(dist) - st[1] <= 1) st[1] = Math.round(dist + m); else steps.push([Math.round(dist), Math.round(dist + m)]); } // W54 flight
      dist += m;
      if (i + 1 < legs.length && f1 === 1) { // W67 graph3: on through the leg's head
        const v = this.head(d), nf = s.node_flags[v];
        if (nf & N_JUNK) junk.push(Math.round(dist));
        if (nf & N_TRACKS) tracks.push([Math.round(dist), this.trackAngle(d, v)]);
        if (this.wait[d] === W_STOP) stops.push([Math.round(dist), +(s.lon[v] * 1e-6).toFixed(6), +(s.lat[v] * 1e-6).toFixed(6)]); // W86 stops
      }
      if (m > 0) prof.push([Math.round(dist), +elev.at(-1).toFixed(1)]); // W53 turns
      junctionAt.push(dist);
      ends.push(pts.at(-1));
      bike_m[BIKE[this.bike(d)]] += m;
    }
    // the climb, filtered: a rise counts only beyond a 5 m buffer, so that the elevation model's noise doesn't
    let climb = 0, buf = 0;
    for (let i = 1; i < elev.length; i++) {
      buf += elev[i] - elev[i - 1];
      if (buf > ASCEND_M) { climb += buf - ASCEND_M; buf = ASCEND_M; } else if (buf < 0) buf = 0;
    }
    const maneuvers = this.maneuvers(legs, junctionAt, dist, b.at, ends);
    for (const k in bike_m) bike_m[k] = Math.round(bike_m[k]);
    time += climb * PACE.climb_s;
    // W32 routing: the walks between the places and the course, drawn as walking: [from, to] lines
    const walk = { start: a?.walk >= 1 ? [a.place, a.at] : null, end: b.walk >= 1 ? [b.at, b.place] : null };
    let walked = 0;
    for (const w of [walk.start, walk.end]) if (w) walked += this.metres(...w);
    time += walked / (PACE.walk * MPH);
    if (walk.end) maneuvers.at(-1).walk_m = Math.round(b.walk);
    const r6 = (w) => w && w.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]);
    return { geometry, distance_m: Math.round(dist), climb_m: Math.round(climb), time_s: Math.round(time), maneuvers, bike_m, cost: Math.round(cost),
      walk_m: Math.round(walked), walk: { start: r6(walk.start), end: r6(walk.end) }, elev: prof, ways, steps, bare, junk, tracks, stops, walks, dust }; // W104 oss2: dust; W53 turns: elev, ways; W54 flight: steps; W59 routes: bare; W67 graph3: junk, tracks; W86 stops; W86 ride: walks
  }

  /** W67 graph3: the angle between the course along directed edge d and the track at its head v, 0 to 90 degrees. */
  trackAngle(d, v) {
    const { s } = this;
    let lo = 0, hi = (s.tr_node?.length || 0) - 1;
    while (lo <= hi) {
      const m = (lo + hi) >> 1;
      if (s.tr_node[m] === v) { const a = Math.abs(turnDeg(this.endB(d), s.tr_bear[m])); return Math.round(Math.min(a, 180 - a)); }
      if (s.tr_node[m] < v) lo = m + 1; else hi = m - 1;
    }
    return 90;
  }

  /** The lingo kind of the road on directed edge d (chart/lingo/lingo-pack.json). */
  kind(d) {
    const e = d >> 1, f = this.s.flags[e], bk = this.bike(d), cls = this.s.cls[e];
    if (f & F.ROTARY) return "black_hole";
    if (bk === B.wormhole) return "wormhole";
    if (bk === B.walk || bk === B.steps) return "space_walk";
    if (cls === C.trunk && bk < B.laned) return "transport_lane";
    return { shielded: "shielded_starpath", laned: "laned_starpath", shared: "shared_starpath" }[BIKE[bk]] || "starpath";
  }

  /** The turn instructions: one per decision a rider makes (see the file's header). */
  maneuvers(legs, junctionAt, total, end, ends = []) {
    const { s } = this;
    const raw = [];
    const lonlat = (v) => [s.lon[v] * 1e-6, s.lat[v] * 1e-6];
    // the name ahead at leg j: an unnamed stretch under 40 m (a crossing, a link) takes the next name
    const nameAhead = (j) => {
      let m = 0;
      for (let k = j; k < legs.length; k++) {
        const nm = this.name(legs[k][0]);
        if (nm) return { name: nm, kind: this.kind(legs[k][0]) };
        m += junctionAt[k] - (k ? junctionAt[k - 1] : 0);
        if (m >= 40) break;
      }
      return { name: "", kind: this.kind(legs[j][0]) };
    };
    const rideable = (d) => this.bike(d) !== B.walk && this.bike(d) !== B.steps;
    let lastName = this.name(legs[0][0]);
    let rotary = null;
    for (let i = 0; i + 1 < legs.length; i++) {
      const din = legs[i][0], dout = legs[i + 1][0], v = this.head(din);
      const at_m = junctionAt[i];
      if ((dout >> 1) === (din >> 1)) { // back the way it came, at a via in a dead end
        const ahead = nameAhead(i + 1);
        raw.push({ at_m, lonlat: ends[i], type: "u_turn", angle: 180, exit: null, ...ahead, then: null });
        if (ahead.name) lastName = ahead.name;
        continue;
      }
      const eb = this.endB(din);
      const inR = s.flags[din >> 1] & F.ROTARY, outR = s.flags[dout >> 1] & F.ROTARY;
      const opts = [];
      for (let k = this.outStart[v]; k < this.outStart[v + 1]; k++) {
        const d2 = this.out[k];
        if ((d2 >> 1) === (din >> 1) || d2 === dout) continue;
        if (!this.allowed(this.restr.get(din), d2)) continue;
        if (!rideable(d2) && rideable(dout)) continue; // a sidewalk beside the road is no choice to speak of
        opts.push({ d: d2, a: turnDeg(eb, this.startB(d2)) });
      }
      const a = turnDeg(eb, this.startB(dout));
      if (!inR && outR) { rotary = { i, at_m, v, eb, exits: 0 }; continue; }
      if (inR && outR) {
        if (rotary) rotary.exits += opts.filter((o) => !(s.flags[o.d >> 1] & F.ROTARY) && !this.wrong(o.d)).length;
        continue;
      }
      if (inR && !outR) {
        if (rotary) {
          const ahead = nameAhead(i + 1);
          raw.push({ at_m: rotary.at_m, lonlat: lonlat(rotary.v), type: "black_hole", angle: Math.round(turnDeg(rotary.eb, this.startB(dout))),
            exit: rotary.exits + 1, ...ahead, then: null });
          rotary = null;
          if (ahead.name) lastName = ahead.name;
        }
        continue;
      }
      const ahead = nameAhead(i + 1);
      const changed = ahead.name && ahead.name !== lastName;
      const same = ahead.name && ahead.name === lastName;
      if (ahead.name) lastName = ahead.name;
      if (!opts.length) continue; // a bend with no other way to go
      if ((at_m < 15 && !this.about) || total - at_m < 10) continue; // at the start a rider has no heading yet; at the end, the pad; W56 reroute: but come about, it has
      const straightest = Math.min(...opts.map((o) => Math.abs(o.a)));
      const rival = opts.find((o) => Math.abs(o.a) < 40 && Math.abs(o.a - a) < 60);
      let type = null;
      if (Math.abs(a) < 20) {
        // a fork: unless the road goes on by name and the other branch bends away more
        if (rival && !(same && Math.abs(a) + 5 < Math.abs(rival.a))) type = a < rival.a ? "keep_left" : "keep_right";
        else if (changed) type = "straight";
      } else if (Math.abs(a) < 55 && Math.abs(a) <= straightest && !changed) {
        if (rival) type = a < rival.a ? "keep_left" : "keep_right";
      } else type = turnType(a);
      const lanes = type && this.lanesAt(legs, i, type, junctionAt); // W53 lanes
      if (type) raw.push({ at_m, lonlat: lonlat(v), type, angle: Math.round(a), exit: null, ...ahead, then: null, ...(lanes ? { lanes } : {}) }); // W53 lanes
    }
    // fold turns within 40 m of each other into one (scul.brf's turnInstructionCatchingRange): a jog across a
    // road reads "Turn right, then turn left"
    const out = [];
    for (const m of raw) {
      const prev = out[out.length - 1];
      if (prev && m.at_m - prev.last_m < CATCH_M && ![prev.type, m.type].some((t) => t === "black_hole" || t === "u_turn")) {
        const net = ((prev.angle_in_sum + m.angle + 540) % 360) - 180;
        const sides = new Set([prev.first_type, m.type].map((t) => (/left/.test(t) ? "left" : /right/.test(t) ? "right" : "")));
        sides.delete("");
        if ((sides.size > 1 && Math.abs(net) < 45) || (sides.size === 1 && turnType(net) === "u_turn")) { // W74 graph: two turns one way are two turns, not a U-turn
          prev.type = prev.first_type; prev.then = m.type;
        } else {
          prev.type = turnType(net); prev.then = null;
          if (prev.type === "straight" && !m.name) prev.drop = true;
        }
        prev.angle = Math.round(net); prev.angle_in_sum = net; prev.last_m = m.at_m;
        prev.name = m.name; prev.kind = m.kind;
        continue;
      }
      out.push({ ...m, first_type: m.type, angle_in_sum: m.angle, last_m: m.at_m });
    }
    const list = out.filter((m) => !m.drop).map(({ first_type, angle_in_sum, last_m, drop, ...m }) => ({
      ...m, at_m: Math.round(m.at_m), lonlat: [+m.lonlat[0].toFixed(6), +m.lonlat[1].toFixed(6)] }));
    for (const m of list) if (m.lanes && !(m.lanes.side === "starboard" ? /left/ : /right/).test(m.type)) delete m.lanes; // W53 lanes: a fold that turned the other way
    list.push({ at_m: Math.round(total), lonlat: [+end[0].toFixed(6), +end[1].toFixed(6)], type: "arrive", angle: 0, exit: null, name: "", kind: null, then: null });
    return list;
  }
}

export function turnType(a) {
  const x = Math.abs(a), side = a > 0 ? "right" : "left";
  if (x < 20) return "straight";
  if (x > 170) return "u_turn";
  return (x < 55 ? "slight_" : x > 135 ? "sharp_" : "") + side;
}
