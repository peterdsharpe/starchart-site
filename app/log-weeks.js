// W88 logweek (design/app-ui/SPEC.md §177): the Log's activity bars, distance and climb by week or by month.
// Pure functions, in the phone's local time, as the Log's days and year headings read: node --test app/tests/log-weeks.test.mjs
//
// A week starts on Monday, as most ride logs' weeks do, so a weekend's two rides fall in one week. Each period's edges come
// from the calendar (new Date(y, m, d)), never from adding 7 × 24 h, so a week across a DST change is 167 or 169 hours and
// a ride at 00:30 on its Monday is still that week's.

export const WEEK_START = 1; // W88 logweek: Monday (Date's getDay(): 0 is Sunday)
const DAY_MS = 864e5;

/** The start (ms) of the week or month (`unit`) that `t` falls in, at local midnight. */
export function periodStart(t, unit) {
  const d = new Date(t);
  if (unit === "month") return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() - WEEK_START + 7) % 7)).getTime();
}

/** The start of the period `k` periods after the one starting at `start` (k may be negative). */
function shift(start, unit, k) {
  const d = new Date(start);
  return (unit === "month" ? new Date(d.getFullYear(), d.getMonth() + k, 1) : new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7 * k)).getTime();
}

/** The last `n` periods up to the one with `now` in it, oldest first: {start, end (exclusive), metres, climb_m, rides}.
 *  One pass over `flights` (the Log's summaries: start, metres, excluded_m, climb_m); a flight counts in the period it
 *  started in, and only its counted metres (less any stretch at car speed), as the lifetime's. */
export function buckets(flights, { unit = "week", n = 12, now = Date.now() } = {}) {
  const cur = periodStart(now, unit), first = shift(cur, unit, 1 - n), end = shift(cur, unit, 1);
  const out = Array.from({ length: n }, (_, k) => ({ start: shift(first, unit, k), end: shift(first, unit, k + 1), metres: 0, climb_m: 0, rides: 0, minutes: 0, hifives: 0 })); // W144 logmiles: minutes, hifives
  for (const f of flights) {
    if (!(f.start >= first && f.start < end)) continue;
    let k = n - 1;
    while (out[k].start > f.start) k--; // the edges are the calendar's, so no Date per flight
    const b = out[k];
    b.metres += Math.max(0, (f.metres || 0) - (f.excluded_m || 0));
    b.climb_m += f.climb_m || 0;
    b.rides++;
    b.minutes += f.minutes || 0; b.hifives += f.hifives || 0; // W144 logmiles (SPEC §259): the miles card's time and hi-fives
  }
  return out;
}

/** W88 logavg (SPEC §182): her own average, {metres, climb_m, n}, over the completed periods of `bs` (the last, the one now
 *  is in, left out) from the one her first ride (`first`, its start in ms) fell in; null with fewer than two such periods. */
export function average(bs, first) { // W88 logavg
  const done = bs.slice(0, -1).filter((b) => b.end > first); // W88 logavg: an empty period after her first ride counts as 0
  if (done.length < 2) return null; // W88 logavg
  const sum = (k) => done.reduce((a, b) => a + b[k], 0); // W88 logavg
  return { metres: sum("metres") / done.length, climb_m: sum("climb_m") / done.length, n: done.length }; // W88 logavg
}

let MD, MON, MONTH;
const md = (t) => (MD ||= new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })).format(t);
/** A short month name: "Oct". */
export const mon = (t) => (MON ||= new Intl.DateTimeFormat("en-US", { month: "short" })).format(t);
const month = (t) => (MONTH ||= new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" })).format(t);

/** A period's name: a week as "Oct 5–11" or "Sep 28 – Oct 4", a month as "September 2026". */
export function label(b, unit) {
  if (unit === "month") return month(b.start);
  const last = new Date(b.end - DAY_MS / 2); // the Sunday, whatever the DST change did to the week's length
  return new Date(b.start).getMonth() === last.getMonth() ? `${md(b.start)}–${last.getDate()}` : `${md(b.start)} – ${md(last)}`;
}

/** The axis's labels: a month's short name under the week its 1st is in (and the first week's), or under every month. */
export function ticks(bs, unit) {
  return bs.map((b, k) => {
    if (unit === "month") return mon(b.start);
    const last = new Date(b.end - DAY_MS / 2);
    return last.getDate() <= 7 ? mon(last) : k ? "" : mon(b.start);
  });
}
