// W29 comets: live T trains as comets on the chart (design/app-ui/SPEC.md §41). The pure part: the MBTA V3 API's
// requests and replies, the comets' paths along their lines, the times by the MBTA's display guidelines, and the
// politeness rules. No DOM, no MapLibre, no network: app/comets.js does those.
//
// arclight, 2026-10-17: "It would be kind of cool if you could show live location of the T trains "comets",
// color-coded by the line they run on. That obviously shouldn't be the forefront".
//
// Every request asks for every train, or for a stop the pilot tapped, never for anything near the pilot.
import { dur } from "./duration.js"; // W68 fixes: "1h 12m"
import { COLOURS } from "./colours.js"; // W185 colours (SPEC §321): the named colours, from design/tokens.json

export const MBTA = "https://api-v3.mbta.com";
/** The routes the comets fly: the subway and light rail (route types 0 and 1), then the commuter rail (2). */
export const SUBWAY = ["Red", "Mattapan", "Orange", "Blue", "Green-B", "Green-C", "Green-D", "Green-E"];
export const RAIL = ["CR-Fairmount", "CR-Fitchburg", "CR-Worcester", "CR-Franklin", "CR-Greenbush", "CR-Haverhill", "CR-Kingston",
  "CR-Lowell", "CR-Needham", "CR-NewBedford", "CR-Newburyport", "CR-Providence"];
const TYPES = "0,1,2";

// The requests. A key, when there is one, goes in the query (api_key), so each request stays a simple one with no CORS
// preflight. The brackets stay as they are: the API reads them either way, and the URLs stay readable.
const keyed = (u, key) => (key ? `${u}&api_key=${encodeURIComponent(key)}` : u);
/** Every train's place: 3 to 5 KB compressed. */
export const vehiclesUrl = (key) => keyed(`${MBTA}/vehicles?filter[route_type]=${TYPES}&fields[vehicle]=latitude,longitude,bearing,current_status,direction_id,updated_at`, key);
/** Each route's colour and name, and the lines its trains follow (the canonical patterns' shapes): about 56 KB, once a week. */
export const shapesUrl = (key) => keyed(`${MBTA}/route_patterns?filter[route]=${[...SUBWAY, ...RAIL].join(",")}&filter[canonical]=true` +
  "&include=representative_trip.shape,route&fields[route_pattern]=direction_id&fields[trip]=headsign&fields[shape]=polyline&fields[route]=color,long_name,type", key);
/** A comet's coming stops, with its destination. */
export const tripUrl = (trip, key) => keyed(`${MBTA}/predictions?filter[trip]=${encodeURIComponent(trip)}&include=stop,trip` +
  "&fields[prediction]=arrival_time,departure_time,status,stop_sequence,schedule_relationship&fields[stop]=name,platform_code&fields[trip]=headsign,bikes_allowed&sort=stop_sequence", key); // W59 cometbikes: bikes_allowed
/** The next trains at a Comet Station: the predictions within about 300 m of the station's own point on the chart. */
export const stationUrl = ([lon, lat], key) => keyed(`${MBTA}/predictions?filter[latitude]=${lat.toFixed(5)}&filter[longitude]=${lon.toFixed(5)}` +
  `&filter[radius]=0.003&filter[route_type]=${TYPES}&include=stop,trip,vehicle&fields[prediction]=arrival_time,departure_time,status,direction_id,schedule_relationship` +
  "&fields[stop]=name,latitude,longitude,platform_code&fields[trip]=headsign,bikes_allowed&fields[vehicle]=current_status&sort=departure_time", key); // W59 cometbikes: bikes_allowed

/** W33 peeks: the next sandworms (buses) at a Sandworm Nest: the predictions within about 100 m of the nest's own point on
 *  the chart, with each route's number and colour. */
export const nestUrl = ([lon, lat], key) => keyed(`${MBTA}/predictions?filter[latitude]=${lat.toFixed(5)}&filter[longitude]=${lon.toFixed(5)}` +
  "&filter[radius]=0.001&filter[route_type]=3&include=stop,trip,vehicle,route&fields[prediction]=arrival_time,departure_time,status,direction_id,schedule_relationship" +
  "&fields[stop]=name,latitude,longitude,platform_code&fields[trip]=headsign&fields[vehicle]=current_status&fields[route]=short_name,color&sort=departure_time", key);

/** W189 transittimes (SPEC §329): with Comets off, a tapped bus stop's predictions, naming its stops (the walker's file's ids;
 *  never a position), one ask a tap. */
export const stopUrl = (ids, key) => keyed(`${MBTA}/predictions?filter[stop]=${ids.map(encodeURIComponent).join(",")}&include=vehicle` +
  "&fields[prediction]=arrival_time,departure_time,status,direction_id,schedule_relationship&fields[vehicle]=current_status&sort=departure_time", key);

/** W59 cometbikes: the day's trains on `routes` and whether each takes bikes (its bikes_allowed): about 8 KB for the
 *  Commuter Rail's, once a weekday while the view of the comets that take bikes is on. `date` is Boston's ("2026-10-20"). */
export const bikeTripsUrl = (routes, date, key) => keyed(`${MBTA}/trips?filter[route]=${routes.join(",")}&filter[date]=${date}&fields[trip]=bikes_allowed`, key);
/** W59 cometbikes: that reply as trip id → bikes_allowed (1 yes, 2 no, 0 unknown). */
export const parseBikeTrips = (json) => new Map((json?.data || []).map((t) => [t.id, t.attributes?.bikes_allowed ?? 0]));

/** Where the comets fly: the commuter rail's reach, so a chart elsewhere asks for nothing. [west, south, east, north] */
export const AREA = [-72.0, 41.5, -70.5, 43.0];
export const inArea = (b) => !!b && b[0] < AREA[2] && b[2] > AREA[0] && b[1] < AREA[3] && b[3] > AREA[1];

// ---- the replies ----
const rel = (o, k) => o.relationships?.[k]?.data?.id ?? null;
const time = (s) => (s ? Date.parse(s) : null);
/** The vehicles reply: one comet per train with a place. */
export function parseVehicles(json) {
  const out = [];
  for (const v of json?.data || []) {
    const a = v.attributes || {};
    if (!Number.isFinite(a.latitude) || !Number.isFinite(a.longitude)) continue;
    out.push({ id: v.id, route: rel(v, "route"), trip: rel(v, "trip"), stop: rel(v, "stop"), lon: a.longitude, lat: a.latitude,
      bearing: Number.isFinite(a.bearing) ? a.bearing : null, status: a.current_status || "", dir: a.direction_id, at: time(a.updated_at) });
  }
  return out;
}

/** Google's encoded polyline: [[lon, lat], ...]. */
export function decodePolyline(s) {
  const out = [];
  let i = 0, lat = 0, lon = 0;
  const next = () => { let r = 0, sh = 0, b; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32 && i < s.length); return r & 1 ? ~(r >> 1) : r >> 1; };
  while (i < s.length) { lat += next(); lon += next(); out.push([lon / 1e5, lat / 1e5]); }
  return out;
}

const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / Math.PI; };
export { mercX, mercY };

/** A route's line in mercator units, for following it: nearest points and points along it, with no allocation. */
export class Line {
  constructor(coords, dir = 0) {
    const n = coords.length;
    this.dir = dir;
    this.x = new Float64Array(n); this.y = new Float64Array(n); this.s = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      this.x[i] = mercX(coords[i][0]); this.y[i] = mercY(coords[i][1]);
      this.s[i] = i ? this.s[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.y[i] - this.y[i - 1]) : 0;
    }
    this.length = this.s[n - 1] || 0;
  }
  /** The nearest point to mercator (px, py): `out` = [s along the line, its distance off]. */
  nearest(px, py, out = [0, 0]) {
    const { x, y, s } = this;
    let best = Infinity, bs = 0;
    for (let i = 1; i < x.length; i++) {
      const ax = x[i - 1], ay = y[i - 1], dx = x[i] - ax, dy = y[i] - ay, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
      const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey;
      if (d < best) { best = d; bs = s[i - 1] + t * (s[i] - s[i - 1]); }
    }
    out[0] = bs; out[1] = Math.sqrt(best);
    return out;
  }
  /** The point at `d` along the line (clamped to its ends), into out[o], out[o + 1]. */
  at(d, out, o = 0) {
    const { x, y, s } = this, n = x.length;
    if (d <= 0 || n < 2) { out[o] = x[0]; out[o + 1] = y[0]; return; }
    if (d >= this.length) { out[o] = x[n - 1]; out[o + 1] = y[n - 1]; return; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m] <= d) lo = m; else hi = m; }
    const t = (d - s[lo]) / (s[hi] - s[lo] || 1);
    out[o] = x[lo] + t * (x[hi] - x[lo]); out[o + 1] = y[lo] + t * (y[hi] - y[lo]);
  }
}

/** The route patterns reply: each route's { name, color, type } and its lines, one per canonical pattern. */
export function parseShapes(json) {
  const inc = new Map((json?.included || []).map((o) => [`${o.type}:${o.id}`, o]));
  const routes = {}, lines = {};
  for (const o of json?.included || []) if (o.type === "route") routes[o.id] = { name: o.attributes.long_name, color: lineColour(o.id), type: o.attributes.type }; // W186 palette: her line colour, not the feed's
  for (const p of json?.data || []) {
    const route = rel(p, "route"), trip = inc.get(`trip:${rel(p, "representative_trip")}`), shape = trip && inc.get(`shape:${rel(trip, "shape")}`);
    if (!route || !shape?.attributes?.polyline) continue;
    (lines[route] ||= []).push({ dir: p.attributes?.direction_id ?? 0, polyline: shape.attributes.polyline });
  }
  return { routes, lines };
}
/** W192 icons7 (SPEC §338): a bus's colour by the feed's own route_color, the MBTA's and Massport's (tokens.json mbta bus, silver, shuttle). */
const BUS_HINT = { FFC72C: "bus", "7C878E": "silver", "0E3475": "shuttle" };
/** W186 palette (SPEC §328): a line's colour, her palette's by the route's family, by night or by day (tokens.json mbta, mbta-day): Red
 *  and Mattapan red, Orange orange, Blue blue, Green green, the Commuter Rail magenta. W192 icons7 (SPEC §338), her row 4: a bus by
 *  `hint`, the feed's route_color ("FFC72C" or "#FFC72C"): a local bus her yellow, the Silver Line her grey, an airport shuttle her blue;
 *  anything else (a ferry, a bus with no hint) her grey, as before. */
export function lineColour(id = "", light = false, hint = "") {
  const M = light ? COLOURS["mbta-day"] : COLOURS.mbta, bus = BUS_HINT[String(hint || "").replace(/^#/, "").toUpperCase()]; // W192 icons7
  return /^Red|^Mattapan/.test(id) ? M.red : /^Orange/.test(id) ? M.orange : /^Blue/.test(id) ? M.blue : /^Green/.test(id) ? M.green : /^CR-|^Commuter Rail/.test(id) ? M.purple
    : bus ? M[bus] : COLOURS.palette[light ? "day" : "night"].grey; // W192 icons7: bus
}
/** A route that the shapes don't name yet: the MBTA's colours by family (the colours of /routes, 2026-10-17). W186 palette: hers. */
export function routeOf(routes, id) {
  if (routes?.[id]) return routes[id];
  return { name: id.replace(/^CR-/, "") + " Line", color: lineColour(id), type: /^CR-/.test(id) ? 2 : 1 }; // W185 colours; W186 palette: lineColour (the subway's family else the Commuter Rail's)
}

// ---- W111 stationlines (SPEC §215): a Comet Station's lines with Comets off, from the tiles alone ----
/** The tiles' lines (SCHEMA `line`), in the MBTA's order; the T's, then the commuter rail. */
export const LINES = ["Red", "Mattapan", "Orange", "Blue", "Green", "Commuter Rail"];
export const STATION_LINE_M = 80; // a T track this near a station serves it: v15 over 171 stations, 157 exact (150 m, the pipeline's: 153; 60 m: 157, Ashmont's Mattapan lost)
const segM = (p, a, b) => { // metres from p to the segment a-b, on a plane at p's latitude
  const k = Math.cos((p[1] * Math.PI) / 180), ax = (a[0] - p[0]) * k, ay = a[1] - p[1], dx = (b[0] - a[0]) * k, dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy) * 111320;
};
const lineOf = (route) => (/^CR-/.test(route) ? "Commuter Rail" : /^Green/.test(route) ? "Green" : LINES.includes(route) ? route : null);
/** The comets timetable's stations (its JSON header, chart/transit/build_timetable.py) with the lines stopping at each:
 *  [{ name, ll, lines: Set }]. It has the bike set only: Red, Orange, Blue and the commuter rail, no Green or Mattapan. */
export function timetableStations(h) {
  const out = (h?.stations || []).map((s) => ({ name: s.name, ll: s.ll, lines: new Set() }));
  for (const p of h?.patterns || []) { const l = lineOf(p.r); if (l) for (const i of p.st) out[i]?.lines.add(l); }
  return out.filter((s) => s.lines.size);
}
const TABLE_M = 300, NEAR_M = 100; // a timetable station of the tapped one's name this near is it (South Station's points are 168 m apart); of another name, this near
/** A station's lines: its own `line` (tiles v16: "Green;Orange"), else, as the pipeline's rule, the T lines whose
 *  `comet_trail` tracks (`tracks`: GeoJSON features with `line`) pass within `r` m of `at` ([lon, lat]), else the commuter
 *  rail's. With the timetable's `table` (timetableStations), its station's lines instead, and the tiles' Green and Mattapan:
 *  the tracks can't tell a commuter rail stop from a line beside the T. [{ line, name, color }] in LINES' order, or []. */
export function stationLines(props, at, tracks = [], r = STATION_LINE_M, table = null) {
  let got = new Set(String(props?.line || "").split(";"));
  if (!LINES.some((l) => got.has(l))) {
    const near = new Set();
    for (const f of tracks) {
      const l = f.properties?.line, g = f.geometry;
      if (!LINES.includes(l) || near.has(l)) continue;
      const parts = g?.type === "LineString" ? [g.coordinates] : g?.type === "MultiLineString" ? g.coordinates : [];
      if (parts.some((c) => c.some((q, i) => i && segM(at, c[i - 1], q) <= r))) near.add(l);
    }
    const t = [...near].filter((l) => l !== "Commuter Rail");
    got = new Set(t.length ? t : [...near]);
  }
  const k = Math.cos((at[1] * Math.PI) / 180), m = (s) => Math.hypot((s.ll[0] - at[0]) * k, s.ll[1] - at[1]) * 111320;
  const named = (s) => [props?.name, props?.base].includes(s.name) || String(props?.name || "").startsWith(`${s.name} `);
  const st = (table || []).filter((s) => m(s) <= (named(s) ? TABLE_M : NEAR_M)).sort((a, b) => named(b) - named(a) || m(a) - m(b))[0];
  if (st) got = new Set([...st.lines, ...[...got].filter((l) => l === "Green" || l === "Mattapan")]);
  return LINES.filter((l) => got.has(l)).map((line) => ({ line, name: line === "Commuter Rail" ? line : `${line} Line`, color: routeOf({}, line).color }));
}

// ---- the paths: each comet glides from where it was drawn to its new place, along its line ----
// A mercator unit is 29,600 km on the ground in Boston (the equator's 40,075 km × cos 42.4°).
// W92 cometsnap: arclight, 2026-10-23: "it's safe to make the assumption that the T's are going to stay on the tracks …
// they probably don't have great GPS underground". A train up to 150 m off its line (W29: 30 m) is drawn on it, and one
// farther off where the MBTA says. Past either end of its line (a terminal's loop, a yard's tracks, which the lines leave
// out) W29's 30 m stays: each train more than 30 m off its line in the kept replies (one in ten, 60 to 130 m) is one of
// those, and is drawn on that track rather than pulled to its line's end.
export const SNAP = 5e-6;  // about 150 m: off its line by more, a comet goes straight, at its own place (W92 cometsnap; W29's 30 m)
const END = 1e-6; // about 30 m, W29's: past either end of its line (a terminal's loop, a yard's tracks, which the lines leave out), as far (W92 cometsnap)
const OWN = 5e-7; // about 15 m: its own direction's line first (W92 cometsnap: W29's SNAP / 2)
const reach = (l, s) => (s > 0 && s < l.length ? SNAP : END); // W92 cometsnap: how far off its line a place at `s` along it may be
export const LEAP = 1e-4;  // about 3 km: a comet that moved farther jumps
const KEEP = 1e-7; // W153 tstations: about 3 m: the line a comet was on wins over another as near (two branches' shared trunk)
const STEP = 5e-7; // W153 tstations: about 15 m: a straight glide shorter than this is the GPS's noise, no heading: its bearing is
/**
 * The glide for a comet's new place. `lines` are its route's Lines; `from` is where it is drawn now ([x, y] mercator) or
 * null; `to` is its new place. Returns { line, s0, s1, fwd, jump } along a line (`fwd`: the line runs the comet's way),
 * or { line: null, jump, end } for a straight glide, `end` its line's point nearest `to` when `to` is near one (W92
 * cometsnap: from a place off its line onto it), else null. `jump`: the first place, or one too far to glide to. A comet
 * never glides backward along its line: a small step back (the GPS's noise) holds it where it is.
 * W153 tstations (SPEC §272): `prev`, the line it glided on last, wins a tie (the trunk two branches share: a train from
 * Ashmont keeps Ashmont's line past JFK/UMass, so its tail never turns down Braintree's); and a straight glide onto a line
 * gives that line as `along`, with its `s1`, `fwd` and the point there (`at`), for its tail (placeComet); one off `prev`, out
 * to a stray fix, gives `prev` and the place it left it (the review's P2).
 */
export function glideOf(lines, from, to, dir, tmp = [0, 0], prev = null) {
  const jump = !from || Math.hypot(to[0] - from[0], to[1] - from[1]) > LEAP; // a jump still lies on its line, for its tail
  let best = null, bd = Infinity, near = null, nd = Infinity;
  for (const l of lines || []) {
    l.nearest(to[0], to[1], tmp);
    const s1 = tmp[0], d1 = tmp[1], own = (l.dir === dir ? 0 : OWN) - (l === prev ? KEEP : 0); // its own direction's line first; W153 tstations: then its last
    if (d1 <= reach(l, s1) && d1 + own < nd) { nd = d1 + own; near = { line: l, s1 }; } // W92 cometsnap
    if (!jump) l.nearest(from[0], from[1], tmp);
    const d = Math.max(d1, jump ? 0 : tmp[1]) + own;
    if (d1 <= reach(l, s1) && (jump || tmp[1] <= reach(l, tmp[0])) && d < bd) { bd = d; best = { line: l, s0: jump ? s1 : tmp[0], s1 }; }
  }
  if (!best) {
    const end = near ? [0, 0] : null; if (near) near.line.at(near.s1, end); // W92 cometsnap
    if (near) return { line: null, jump, end, along: near.line, s1: near.s1, fwd: near.line.dir === dir, at: end }; // W153 tstations: along, onto its line
    if (!jump && prev && (lines || []).includes(prev) && (prev.nearest(from[0], from[1], tmp), tmp[1] <= reach(prev, tmp[0]))) { // W153 tstations review: off its line, out to a stray fix
      const at = [0, 0], s1 = tmp[0]; prev.at(s1, at);
      return { line: null, jump, end, along: prev, s1, fwd: prev.dir === dir, at };
    }
    return { line: null, jump, end, along: null };
  }
  best.jump = jump;
  best.fwd = best.line.dir === dir;
  if (best.fwd ? best.s1 < best.s0 : best.s1 > best.s0) best.s1 = best.s0;
  return best;
}

/**
 * W153 tstations (SPEC §272), his note: "sometimes the comet trails do not align with the tracks ... the comet trail goes straight
 * back, off of the tracks ... like it goes 90 degrees off". A comet's head at u (0 to 1) along its glide `g` (glideOf) from
 * `from` to `to`, into head; and its tail's n dots, `len` mercator units long at the fractions spots[k] (tailSpots), into
 * tail[2k], tail[2k + 1]. On its line the tail is the line's stretch behind the head, cut by arc length, so it bends with
 * the track. A straight glide onto its line (from a fix off it: underground, the GPS strays 200 m) hangs the line's stretch
 * behind `end` from the head, so the tail runs along the track, never across it, and lies on it once there (it was the
 * glide's own heading: 77 degrees off the Red Line south of South Station, and kept while the train stood). A glide out
 * from its line to a stray fix hangs the stretch behind the place it left from the head, parallel to that track. Off any line,
 * straight back along the glide, or the train's bearing where the glide is the GPS's noise. No allocation.
 */
export function placeComet(g, from, to, u, bearing, len, spots, n, head, tail) {
  if (g?.line) {
    const s = g.s0 + (g.s1 - g.s0) * u, back = g.fwd ? -1 : 1;
    g.line.at(s, head);
    for (let k = 0; k < n; k++) g.line.at(s + back * len * spots[k], tail, 2 * k);
    return;
  }
  const e = g?.end || to;
  head[0] = from[0] + (e[0] - from[0]) * u; head[1] = from[1] + (e[1] - from[1]) * u;
  if (g?.along) {
    const back = g.fwd ? -1 : 1, ox = head[0] - g.at[0], oy = head[1] - g.at[1]; // W153 tstations review: hung from its anchor, `end` or the place it left
    for (let k = 0; k < n; k++) { g.along.at(g.s1 + back * len * spots[k], tail, 2 * k); tail[2 * k] += ox; tail[2 * k + 1] += oy; }
    return;
  }
  let dx = e[0] - from[0], dy = e[1] - from[1], d = Math.hypot(dx, dy);
  if (d < STEP && bearing != null) { const b = (bearing * Math.PI) / 180; dx = Math.sin(b); dy = -Math.cos(b); d = 1; }
  for (let k = 0; k < n; k++) { const t = d < 1e-9 ? 0 : (len * spots[k]) / d; tail[2 * k] = head[0] - dx * t; tail[2 * k + 1] = head[1] - dy * t; }
}

// ---- the times, by the MBTA's real-time display guidelines (mbta.com/developers/real-time-display-guidelines) ----
/** One prediction's words: "Boarding", "Arriving", "8 min", "1h 12m" (W68 fixes), the status ("Stopped 3 stops away"), or for
 *  the commuter rail its departure clock ("3:47", with its status); null for one not to show. `vehicle` is the
 *  prediction's train ({ status, stop }), `here` the ids of the stop and its platforms, `clock` formats a Date.
 *  `ends`: a comet's own last stop, which has no departure, still shows its arrival (its coming stations; never a board). */
export function etaOf(p, now, { rail = false, vehicle = null, here = null, ends = false, clock = (d) => d.toISOString().slice(11, 16) } = {}) {
  if (p.relation === "CANCELED" || p.relation === "SKIPPED") return null;
  if (p.status && !rail) return p.status; // the subway shows its status in place of the countdown
  if (p.departure == null && !(ends && p.arrival != null)) return null; // nobody can board it
  if (rail) return [clock(new Date(p.departure ?? p.arrival)), p.status, p.track ? `Track ${p.track}` : ""].filter(Boolean).join(" · ");
  const secs = ((p.arrival ?? p.departure) - now) / 1000;
  // Boarding first: a train already stopped there says so rather than "Arriving"
  if (p.departure != null && vehicle?.status === "STOPPED_AT" && (here ? here.includes(vehicle.stop) : vehicle.stop === p.stop) && (secs <= 90 || (p.arrival != null && p.arrival < now && p.departure > now))) return "Boarding";
  if (secs < 0) return null; // gone
  if (secs <= 30) return "Arriving";
  const min = Math.floor(secs / 60 + 0.5);
  return dur(min); // W68 fixes: "1h 12m", as every duration
}

/** A predictions reply as plain rows: { id, stop, stopName, track, route, dir, headsign, vehicle, arrival, departure, status, relation, seq },
 *  and W33 peeks: the route's number and colour when the reply includes its route (a sandworm's). */
export function parsePredictions(json) {
  const inc = new Map((json?.included || []).map((o) => [`${o.type}:${o.id}`, o]));
  return (json?.data || []).map((p) => {
    const a = p.attributes || {}, stop = inc.get(`stop:${rel(p, "stop")}`), trip = inc.get(`trip:${rel(p, "trip")}`), veh = inc.get(`vehicle:${rel(p, "vehicle")}`), route = inc.get(`route:${rel(p, "route")}`)?.attributes;
    return { id: p.id, stop: rel(p, "stop"), stopName: stop?.attributes?.name || "", track: stop?.attributes?.platform_code || "",
      parent: stop ? rel(stop, "parent_station") : null, stopAt: stop?.attributes?.latitude != null ? [stop.attributes.longitude, stop.attributes.latitude] : null,
      route: rel(p, "route"), routeName: route?.short_name || "", routeColor: route?.color || "", // W33 peeks: routeName, routeColor; W192 icons7 (SPEC §338): the feed's own, lineColour's hint (W186 palette: was her line colour, a bus her grey)
      trip: rel(p, "trip"), dir: a.direction_id, headsign: trip?.attributes?.headsign || "", bikes: trip?.attributes?.bikes_allowed ?? 0, // W59 cometbikes: 1 yes, 2 no, 0 unknown
      vehicle: rel(p, "vehicle"), vehicleStatus: veh?.attributes?.current_status || "", vehicleStop: veh ? rel(veh, "stop") : null,
      arrival: time(a.arrival_time), departure: time(a.departure_time), status: a.status || "", relation: a.schedule_relationship || "", seq: a.stop_sequence };
  });
}

/** A comet's coming stops: [{ name, eta }], the next `n` that the guidelines show. */
export function comingStops(rows, now, comet, { n = 5, clock } = {}) {
  const rail = /^CR-/.test(comet?.route || "");
  const out = [];
  for (const r of rows.slice().sort((a, b) => a.seq - b.seq)) {
    const eta = etaOf(r, now, { rail, vehicle: comet && { status: comet.status, stop: comet.stop }, ends: true, clock });
    if (eta) out.push({ name: r.stopName, eta });
    if (out.length >= n) break;
  }
  return out;
}

const DIST = (a, b) => Math.hypot((a[0] - b[0]) * Math.cos((b[1] * Math.PI) / 180), a[1] - b[1]);
/**
 * A Comet Station's next trains (or W33 peeks: a Sandworm Nest's next sandworms), by line and direction:
 * [{ route, name, color, dir, station, headsign, etas: ["Arriving", "8 min"] }] (name and color from the reply's routes, or ""), the
 * headsign the next trains' ("Ashmont/Braintree" when they go to both). Of the
 * stations the reply has (it asks within about 300 m), only the nearest to the station's point `at` [lon, lat].
 */
export function arrivalsAt(rows, at, now, { per = 2, clock, mark = () => "" } = {}) { // W59 cometbikes: mark(row), words after a train's time
  let station = null, bd = Infinity;
  for (const r of rows) if (r.stopAt) { const d = DIST(r.stopAt, at); if (d < bd) { bd = d; station = r.parent || r.stop; } }
  const groups = new Map();
  for (const r of rows) {
    if ((r.parent || r.stop) !== station) continue;
    const rail = /^CR-/.test(r.route || ""), eta = etaOf(r, now, { rail, vehicle: { status: r.vehicleStatus, stop: r.vehicleStop }, here: [r.stop], clock });
    if (!eta) continue;
    const key = `${r.route}|${r.dir}`;
    const g = groups.get(key) || { route: r.route, name: r.routeName || "", color: r.routeColor || "", dir: r.dir, station, heads: [], etas: [] }; // W33 peeks: name, color; W59 cometbikes: station
    groups.set(key, g);
    if (g.etas.length < per) { g.etas.push(eta + mark(r)); if (r.headsign && !g.heads.includes(r.headsign)) g.heads.push(r.headsign); }
  }
  return [...groups.values()].map(({ heads, ...g }) => ({ ...g, headsign: heads.sort().join("/") }))
    .sort((a, b) => /^CR-/.test(a.route) - /^CR-/.test(b.route) || (a.name || a.route).localeCompare(b.name || b.route, "en", { numeric: true }) || a.dir - b.dir); // the subway first; W33 peeks: sandworm 9 before 47
}

/**
 * W189 transittimes (SPEC §329): a bus stop's times by route, the timetable's `rows` (walktransit.js stopTimes()) with the
 * predictions `live` (parsePredictions()) in place of the times they cover: each row's predicted ones as the station peek says
 * them ("Arriving", "8 min"), then its timetable's from 2 min past the last of those, as clock times, `n` in all.
 * [{ ...row, etas: ["8 min", "12:29"] }], rows with none left out.
 */
export function stopEtas(rows, live, now, { n = 3, clock = (d) => d.toISOString().slice(11, 16) } = {}) {
  return rows.map((row) => {
    const got = (live || []).filter((r) => r.route === row.route && r.dir === row.dir).map((r) => [r.departure ?? r.arrival, etaOf(r, now, { vehicle: { status: r.vehicleStatus, stop: r.vehicleStop }, here: [r.stop], clock })])
      .filter(([t, e]) => e && t != null).sort((a, b) => a[0] - b[0]).slice(0, n);
    const last = got.length ? got.at(-1)[0] + 120000 : now;
    return { ...row, etas: [...got.map(([, e]) => e), ...row.times.filter((t) => t >= last).map((t) => clock(new Date(t)))].slice(0, n) };
  }).filter((r) => r.etas.length);
}

// ---- politeness ----
export const POLL_MS = 15000, IDLE_MS = 30000, STILL_MS = 60000; // every 15 s; 30 s once the chart has been still a minute with nothing open
export const STALE_MS = 90000; // older than this, the comets go: their places would be wrong
/**
 * W50 layers: how a comet looks. Layers can switch the comets off (app/layers.js), so they are a little stronger when on
 * (arclight, 2026-10-19: "we can actually slightly increase their visibility"): the head 15 % bigger, the glow and the
 * tail brighter. W29's were a radius of 3.1 px at z12, +0.6 a zoom, 2.4 to 5.8 px; glows of 0.3 (Dark) and 0.22
 * (Daystar); a tail from 0.8. Bike first: a comet stays a small dot under the course and the labels.
 */
export const LOOK = { r12: 4.7, perZoom: 0.9, rMin: 3.6, rMax: 8.6, glow: { dark: 0.38, light: 0.3 }, tail: 0.9 }; // W150 mapink: the head 1.3 times W50's (her note: "make the head of the comets a bit bigger"), was 3.6, 0.7, 2.8 and 6.6 px
/** A comet head's radius in CSS px at zoom z: small at low zoom. */
export const cometRadius = (z) => Math.max(LOOK.rMin, Math.min(LOOK.rMax, LOOK.r12 + (z - 12) * LOOK.perZoom));
/** W144 tlines (SPEC §258): a tail's length in head radii, her note "Please make the trains tail a bit longer": 12, 1.5 times
 *  W95 cometlook's 8. W150 mapink (SPEC §269): back to 0.1.65's length on the screen (her note of 09:07: "it's fine as is"),
 *  W95's eight radii of a head 1.3 times smaller. */
export const TAIL_R = 6.15;
/** W150 mapink: a tail dot's radius in px at f along the tail (0 at the head, 1 at its tip) behind a head of radius r: narrower
 *  than the head, to a point (W95 cometlook). */
export const tailRadius = (r, f) => 0.6 + 0.8 * r * (1 - f) ** 0.6;
/**
 * W150 mapink (SPEC §269), her note: "keep the comets dots with a tail even when zoomed in, instead of displaying a line of dots".
 * Where a tail's n dots lie behind a head of radius r px, as fractions of its length (TAIL_R r) in out[k], nearest first.
 * Evenly spaced, a step was half a head's radius, and up close the narrow far dots (0.6 px plus) stood apart from one
 * another; here each step is the same share of the dot's own radius, so the dots overlap to the tip at every zoom.
 */
const SPOTS_M = 256, spotsG = new Float64Array(SPOTS_M + 1); // tailSpots' scratch, kept: comets.js calls it each frame of a zoom
export function tailSpots(r, n, out = new Float64Array(n)) {
  const M = SPOTS_M, g = spotsG; // g[i]: the tail to i / M, in dot radii (g[0] stays 0)
  for (let i = 1; i <= M; i++) g[i] = g[i - 1] + (TAIL_R * r) / M / tailRadius(r, (i - 0.5) / M);
  for (let k = 0, i = 1; k < n; k++) {
    const want = (g[M] * (k + 1)) / (n + 1);
    while (g[i] < want) i++;
    out[k] = (i - 1 + (want - g[i - 1]) / (g[i] - g[i - 1])) / M;
  }
  return out;
}
/** W144 tlines: two trains nearer than SIDE.near head radii (on the screen: about 6 m at z17) each move SIDE.push radii to
 *  their own side of the line ("If two trains are crossing, then separate them slightly to the sides of the line"). */
export const SIDE = { near: 2.2, push: 0.8 };
/**
 * W144 tlines: each of `n` trains' offset to its own side, the right of its way (the T keeps right), when another is near.
 * x, y: heads in px (y down); dx, dy: each one's way, a unit vector; r: the head's radius in px. Writes out[2i], out[2i+1]
 * in px: none when no other is within SIDE.near r, easing in to SIDE.push r as they close, so a train never jumps aside.
 */
export function sideOffsets(n, x, y, dx, dy, r, out) {
  const far = SIDE.near * r, close = far / 2;
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let j = 0; j < n && k < 1; j++) {
      if (j === i) continue;
      const d = Math.hypot(x[j] - x[i], y[j] - y[i]);
      if (d < far) { const t = Math.min(1, (far - d) / (far - close)); k = Math.max(k, t * t * (3 - 2 * t)); }
    }
    out[2 * i] = -dy[i] * SIDE.push * r * k; out[2 * i + 1] = dx[i] * SIDE.push * r * k;
  }
  return out;
}
/** May the comets ask now? Only on, with the page in view, online, the chart showing and in the comets' area, and not on
 *  Data Saver (which asks only when the pilot taps). */
export const mayPoll = (s) => !!(s.on && s.visible && s.online && s.chart && s.area && !s.saveData);
/** The wait before the next ask: `still` ms since the chart last moved, `open` a comet's or station's peek. */
export const pollDelay = ({ still = 0, open = false }) => (open || still < STILL_MS ? POLL_MS : IDLE_MS);

/** At most `max` requests in any `windowMs`, and after a 429 none for a minute, then two, four, up to ten. */
export class Limiter {
  constructor(max = 20, windowMs = 60000) { this.max = max; this.windowMs = windowMs; this.times = []; this.until = 0; this.fails = 0; }
  /** Take a request's place now, if there is one. */
  take(now) {
    if (now < this.until) return false;
    while (this.times.length && now - this.times[0] >= this.windowMs) this.times.shift();
    if (this.times.length >= this.max) return false;
    this.times.push(now);
    return true;
  }
  /** The ms until a request may go: 0 now. */
  wait(now) {
    if (now < this.until) return this.until - now;
    while (this.times.length && now - this.times[0] >= this.windowMs) this.times.shift();
    return this.times.length < this.max ? 0 : this.times[0] + this.windowMs - now;
  }
  /** A reply's status: a 429 backs off. */
  answer(status, now) {
    if (status === 429) { this.until = now + Math.min(600000, 60000 * 2 ** this.fails); this.fails++; }
    else if (status >= 200 && status < 400) this.fails = 0;
  }
}
