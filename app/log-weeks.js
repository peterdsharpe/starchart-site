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

/** The last `n` periods up to the one with `now` in it, oldest first: {start, end (exclusive), metres, climb_m, rides, walks}.
 *  One pass over `flights` (the Log's summaries: start, metres, excluded_m, climb_m); a flight counts in the period it
 *  started in, and only its counted metres (less any stretch at car speed), as the lifetime's. W235 logover (SPEC §497): a walk
 *  (`foot`) is counted apart, in `walks`, and adds no distance, climb or hi-fives (W127 walklog: the bars are her rides'). */
export function buckets(flights, { unit = "week", n = 12, now = Date.now() } = {}) {
  const cur = periodStart(now, unit), first = shift(cur, unit, 1 - n), end = shift(cur, unit, 1);
  const out = Array.from({ length: n }, (_, k) => ({ start: shift(first, unit, k), end: shift(first, unit, k + 1), metres: 0, climb_m: 0, rides: 0, walks: 0, hifives: 0 })); // W144 logmiles: hifives; W235 logover: walks (W144's minutes went: nothing shows them)
  for (const f of flights) {
    if (!(f.start >= first && f.start < end)) continue;
    let k = n - 1;
    while (out[k].start > f.start) k--; // the edges are the calendar's, so no Date per flight
    const b = out[k];
    if (f.foot) { b.walks++; continue; } // W235 logover
    b.metres += Math.max(0, (f.metres || 0) - (f.excluded_m || 0));
    b.climb_m += f.climb_m || 0;
    b.rides++;
    b.hifives += f.hifives || 0; // W144 logmiles (SPEC §259): the miles card's hi-fives
  }
  return out;
}

/** W235 logover (SPEC §497): the lifetime, for All's header: {rides, walks, metres, climb_m, hifives, since}, the rides' distance
 *  as the classes count it (`counted`, BlackBox.counted: a walk's none), their climb and hi-fives, and `since`, the start of the
 *  Log's first entry (ride or walk: the count's), or null with none. */
export function lifetime(flights, counted) {
  const out = { rides: 0, walks: 0, metres: 0, climb_m: 0, hifives: 0, since: null };
  for (const f of flights) {
    if (out.since == null || f.start < out.since) out.since = f.start;
    if (f.foot) { out.walks++; continue; }
    out.rides++; out.metres += counted(f); out.climb_m += f.climb_m || 0; out.hifives += f.hifives || 0;
  }
  return out;
}

let MD, MON, MONTH;
const md = (t) => (MD ||= new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })).format(t);
/** A short month name: "Oct". */
export const mon = (t) => (MON ||= new Intl.DateTimeFormat("en-US", { month: "short" })).format(t);
const month = (t) => (MONTH ||= new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" })).format(t);

/** A period's name: a week as "Oct 19 – 25" or "Sep 28 – Oct 4" (W235 logover: her picture's spaced dash), a month as "September 2026". */
export function label(b, unit) {
  if (unit === "month") return month(b.start);
  const last = new Date(b.end - DAY_MS / 2); // the Sunday, whatever the DST change did to the week's length
  return new Date(b.start).getMonth() === last.getMonth() ? `${md(b.start)} – ${last.getDate()}` : `${md(b.start)} – ${md(last)}`;
}

/** W235 logover: "Since Aug 24", the Log's first day; with its year ("Aug 24, 2025") when that isn't this year. */
export const since = (t, now = Date.now()) => (new Date(t).getFullYear() === new Date(now).getFullYear() ? md(t) : `${md(t)}, ${new Date(t).getFullYear()}`);

/** W235 logover (SPEC §497, her pictures): the axis under the bars, a column's two lines {top, under}. Week: the day its week
 *  starts on, and the month's short name under the first week that starts in a month, and under the first column (unless the
 *  second starts a month: R2 bigtext, SPEC §450, two names side by side ran together, "AUGSEP"). Month: its short name, and
 *  the year under the first column and under January. */
export function axis(bs, unit) {
  const d = (b) => new Date(b.start);
  if (unit === "month") return bs.map((b, k) => ({ top: mon(b.start), under: !k || !d(b).getMonth() ? String(d(b).getFullYear()) : "" }));
  const starts = (b) => d(b).getDate() <= 7; // the first week that starts in its month
  return bs.map((b, k) => ({ top: String(d(b).getDate()), under: starts(b) || (!k && !(bs[1] && starts(bs[1]))) ? mon(b.start) : "" }));
}
