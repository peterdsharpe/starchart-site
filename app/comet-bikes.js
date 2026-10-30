// W59 cometbikes (design/app-ui/SPEC.md §83): may a bike board this comet now? The MBTA's bike rules as a table, each with
// its source, and the peeks' words. Pure: no DOM, no network. app/comets.js asks it for a comet's peek, a Comet Station's,
// a Sandworm Nest's, and for the view that fades the comets that can't take a bike now (starchart.comets.bikes).
//
// arclight's tester, 2026-10-19: "only in the comets where you can bring a bike ... something like the red line will be off
// during rush hour". The rules are in Boston's time, whatever the phone's zone.

import { pick } from "./lingo-mode.js"; // W60 b

export const CHECKED = "2026-10-19"; // the date the rules below were read from the MBTA's pages
export const SOURCE = {
  rules: "https://www.mbta.com/bikes", // the rules by line, folding bikes, the three platforms, holidays and events
  train: "https://www.mbta.com/bikes/bringing-your-bike-the-train", // two a subway car, four a Commuter Rail coach off peak
  bus: "https://www.mbta.com/bikes/using-bus-bike-racks", // a rack for two on the front of every non-electric bus
  trips: "https://api-v3.mbta.com/trips", // a Commuter Rail train's own bikes_allowed (1 yes, 2 no), its timetable's bike symbol
};

const H = 60; // minutes of the day
/**
 * The rules for a standard (non-folding) bike, by route, first match. `weekday`: the times, [from, to) in minutes of the
 * day, when bikes can't board on a weekday; by direction when it differs (0 the Blue Line's inbound, to Bowdoin; 1 its
 * outbound, to Wonderland). `trip`: on weekdays each train says (its bikes_allowed); unknown, "some trains".
 *
 * Not in the table, as the peek can't know them: a folded bike boards every service at all times; bikes "may be
 * prohibited on certain holidays, during special events, or during service disruptions" (mbta.com/bikes). The weekday
 * rules hold on a holiday too, since the page gives no exception. Ferries take bikes at all times and carry no comets (W61 transit: their row is for the comet planner).
 */
export const RULES = [
  { match: /^(Red|Orange)$/, weekday: [[7 * H, 10 * H], [16 * H, 19 * H]], src: SOURCE.rules }, // "Yes, except 7 – 10 AM and 4 – 7 PM"
  { match: /^Blue$/, weekday: { 0: [[7 * H, 9 * H]], 1: [[16 * H, 18 * H]] }, src: SOURCE.rules }, // "Inbound: Yes, except 7 – 9 AM; Outbound: Yes, except 4 – 6 PM"
  { match: /^(Green|Mattapan)/, never: true, src: SOURCE.rules }, // "Weekdays: No; Weekends: No"
  { match: /^CR-(Greenbush|Kingston|NewBedford|Fairmount)$/, always: true, src: SOURCE.rules }, // "allowed on all ... trains at all times"
  { match: /^CR-/, trip: true, src: SOURCE.rules }, // "Weekdays: Yes, look for bike symbols on timetables; Weekends: Yes"
  { match: /^Boat-/, always: true, src: SOURCE.rules }, // W61 transit: "allowed on ferries at all times" (the comet planner's, chart/routing/transit.js)
  { match: /./, rack: true, src: SOURCE.bus }, // the buses and the Silver Line: "Yes, on bike racks"
];
/** The parent stations whose platforms take no bike at any time (mbta.com/bikes): Park Street, Downtown Crossing, Government Center. */
export const NO_PLATFORM = ["place-pktrm", "place-dwnxg", "place-gover"];

/**
 * W59 cometbikes: the words, each in SCUL's (a pilot's bike is a ship) and plain, for the plain-language mode of W60. The
 * peeks show `scul` today. Flagged for arclight's veto. W60 b: the peeks show the Words mode's, through lingo-mode.js pick().
 */
export const WORDS = { // W86 settings: the bike rule says bikes in SCUL too (W73 review C3); the Settings row keeps its ships
  ok: { scul: "Bikes OK", plain: "Bikes OK" },
  okUntil: { scul: "Bikes until {t}", plain: "Bikes until {t}" },
  no: { scul: "No bikes", plain: "No bikes" },
  noUntil: { scul: "No bikes until {t}", plain: "No bikes until {t}" },
  some: { scul: "Bikes on some trains", plain: "Bikes on some trains" },
  platform: { scul: "No bikes on these platforms", plain: "No bikes on these platforms" },
  rack: { scul: "Front rack: 2 bikes", plain: "Front rack: 2 bikes" },
  view: { scul: "Only comets that take ships", plain: "Only comets that take bikes" },
  viewMore: { scul: "The comets that can't take a ship now fade, and brighten when they can.", plain: "The trains that can't take a bike now fade, and brighten when they can." },
};
export const word = (k, t = "", mode) => (mode ? WORDS[k][mode === "meatspace" ? "plain" : mode] : pick(WORDS[k])).replace("{t}", t); // W60 b: no mode, the Words setting's

const DAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };
let fmt = null;
/** Boston's wall clock at `now` (a Date or ms): { weekday (Monday to Friday), min (minutes of the day), date ("2026-10-20") }. */
export function boston(now) {
  fmt ||= new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(fmt.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const day = DAYS[p.weekday];
  return { weekday: day >= 1 && day <= 5, min: (+p.hour % 24) * H + +p.minute, date: `${p.year}-${p.month}-${p.day}` };
}
/** The routes whose trains say for themselves on weekdays whether they take bikes (the Commuter Rail's, but four). */
export const tripRoutes = (routes) => routes.filter((r) => RULES.find((x) => x.match.test(r)).trip);
/** "10:00", "4:00": the app's clock (app/course-logic.js clockAt), from minutes of the day. */
export const clockOf = (min) => `${((Math.floor(min / H) + 11) % 12) + 1}:${String(min % H).padStart(2, "0")}`;

/**
 * May a standard bike board `route` (an MBTA route id) going `dir` at `now`? `bikes`: the train's bikes_allowed when known
 * (the Commuter Rail's). Returns { ok: true, false, or null (some trains), until: the minute of the day it changes today, or
 * null, rack: a bus's front rack }. With no `dir`, the Blue Line counts both directions' times.
 */
export function bikesNow(route, dir, now, { bikes = 0 } = {}) {
  const rule = RULES.find((r) => r.match.test(route || ""));
  if (rule.never) return { ok: false, until: null };
  if (rule.always) return { ok: true, until: null };
  if (rule.rack) return { ok: true, until: null, rack: true };
  const { weekday, min } = boston(now);
  if (!weekday) return { ok: true, until: null };
  if (rule.trip) return { ok: bikes === 1 ? true : bikes === 2 ? false : null, until: null };
  const spans = Array.isArray(rule.weekday) ? rule.weekday : dir === 0 || dir === 1 ? rule.weekday[dir] : Object.values(rule.weekday).flat();
  const inside = spans.find(([a, b]) => min >= a && min < b);
  if (inside) return { ok: false, until: inside[1] };
  const next = spans.map(([a]) => a).filter((a) => a > min).sort((a, b) => a - b)[0];
  return { ok: true, until: next ?? null };
}

/** The peek's words for a verdict: "No bikes until 10:00", "Bikes until 4:00", "Bikes OK", "No bikes", "Bikes on some trains", "Front rack: 2 bikes". */
export function bikeWords(v, mode) { // W60 b: no mode, the Words setting's
  if (v.rack) return word("rack", "", mode);
  if (v.ok === null) return word("some", "", mode);
  if (v.until == null) return word(v.ok ? "ok" : "no", "", mode);
  return word(v.ok ? "okUntil" : "noUntil", clockOf(v.until), mode);
}

/** Should the view that shows only the comets that take bikes fade this comet now? Only when its train surely can't. */
export const fades = (route, dir, now, bikes = 0) => bikesNow(route, dir, now, { bikes }).ok === false;

/**
 * A Comet Station's line: its groups ({ route, name, dir, headsign }, app/comets-logic.js arrivalsAt) as one line of words,
 * or "". All the same, the words once ("No bikes until 10:00"); else each with its lines ("Orange: no bikes until 10:00 ·
 * Green: no bikes"), and so when a train is marked on its own time; a line whose two ways differ with its destination ("Blue to Bowdoin"). A Commuter Rail train that says so
 * is marked on its own time instead (`perTrain`), so its line is left out here. `station`: the parent station's id.
 */
export function stationWords(groups, now, { station = "", name = (g) => g.route, perTrain = () => false, mode } = {}) { // W60 b: mode
  if (NO_PLATFORM.includes(station)) return word("platform", "", mode);
  const rows = groups.filter((g) => !perTrain(g)).map((g) => ({ g, text: bikeWords(bikesNow(g.route, g.dir, now), mode) }));
  const some = rows.length < groups.length; // a train marked on its own time: then the words name their lines
  const split = (r) => rows.some((o) => o.g.route === r.g.route && o.text !== r.text);
  const by = new Map();
  for (const r of rows) {
    const text = r.text, n = split(r) && r.g.headsign ? `${name(r.g)} to ${r.g.headsign}` : name(r.g);
    const names = by.get(text) || [];
    if (!names.includes(n)) names.push(n);
    by.set(text, names);
  }
  if (by.size <= 1 && !some) return [...by.keys()][0] || "";
  return [...by].map(([text, names]) => `${names.join(", ")}: ${text[0].toLowerCase()}${text.slice(1)}`).join(" · ");
}
