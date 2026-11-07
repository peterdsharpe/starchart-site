// W23 fromto: the decisions behind From and To (SPEC §26), kept pure so Node can test them. app/fromto.js draws the
// editor; app/course.js's preview plots and launches by these rules.
//
// An end is a place, as the place sheet has it ({ lingo_name, name, place, kind, lonlat }), or YOU: your position,
// wherever the ship is when the course is plotted.
export const YOU = Object.freeze({ you: true, lingo_name: "Your position", name: "", place: "", kind: "you" });
/** W25 course (call 2): a rough position (±140 m) is known too. From is then "Your rough position", which launches from
 *  wherever the ship is, and the flight records once the fix is precise. */
export const ROUGH = Object.freeze({ you: true, rough: true, lingo_name: "Your rough position", name: "", place: "", kind: "you" });

/** W25 course: in flight with GPS lost, From is where the ship last had a fix. */
export const LAST_FIX = Object.freeze({ you: true, last: true, lingo_name: "Your last fix", name: "", place: "", kind: "you" });

/** `origin` is main.js's: "your ship" with a good fix (the ship shows), "your rough position", or null. */
export const startFrom = (origin) => (origin === "your ship" ? YOU : origin === "your rough position" ? ROUGH : null);

/** Where an end is: YOU's is `here`, the ship's position now. */
export const lonlatOf = (end, here) => (end?.you ? here : end?.lonlat ?? null);

/** The same end: both YOU, or the same name at the same spot. */
export const sameEnd = (a, b) => !!a && !!b && (a.you || b.you ? !!a.you && !!b.you : a.lingo_name === b.lingo_name && a.lonlat?.[0] === b.lonlat?.[0] && a.lonlat?.[1] === b.lonlat?.[1]);

/** The ends after `end` is picked for `which` ("from" or "to"): picking the other field's end swaps them. */
export function pickEnd({ from, to }, which, end) {
  const other = which === "from" ? to : from;
  const next = { from, to, [which]: end };
  if (sameEnd(other, end)) next[which === "from" ? "to" : "from"] = which === "from" ? from : to;
  return next;
}

/** The quick picks for either field: your position (or your rough one), home, the Fort, then the recent places; W25 course:
 *  never the other field's own end (`other`). */
export function quickPicks({ origin, spot = null, home = null, fort, recent = [], other = null }) { // W26 peek: spot, the last parked spot, with no position
  const rest = recent.filter((r) => r.lingo_name !== fort?.lingo_name && r.kind !== "space_station"); // W60 b: no Fort in Plain (fort null), but as a recent
  return [startFrom(origin) ?? spot, home, fort, ...rest].filter((p) => p && !sameEnd(p, other));
}

/**
 * W25 course: what Launch does. It always shows (arclight, 2026-10-16: "If I put in a route, you should let me start that
 * route."). Null when no position can come (location off or denied): the no-location sheet then says why. Otherwise the
 * flight starts from the ship: with From elsewhere it leads to From first (`lead`, and `via` starts with it), then
 * through the stops to To. In flight ("Fly it") From is the ship.
 */
export function launchPlan({ from, via = [], flying = false, canLaunch = true }) {
  if (!flying && !canLaunch) return null;
  const lead = !flying && !!from?.lonlat && !from.you;
  return { lead, via: lead ? [from.lonlat.slice(), ...via.map((v) => v.slice())] : via.map((v) => v.slice()) };
}
