// W76 loghead (design/app-ui/SPEC.md §135): SCUL's season and Saturnight, for the Log's head. No DOM, no imports.
//
//   seasonOf(t)    { year, off }: in SCUL's season `year` from Alphamission (the first Saturday in April) to
//                  Omegamission (the first Saturday in November); off: the winter after `year`'s Omegamission, until
//                  the next Alphamission
//   saturnight(t)  "tonight" on a Saturday in season from 5 AM, "now" from 6 PM until 5 AM on the Sunday, else null
//
// A mission launches at about 9 PM and lands after midnight, so until 5 AM a time belongs to the day before: a flight
// at 1 AM after Omegamission is that season's, and Saturnight lasts the night. Local time, by the calendar (not by
// hours of 3.6e6 ms), so the night DST ends (Omegamission 2025's) is no different.
export const NIGHT_END = 5; // the hour a mission night ends
export const EVENING = 18; // Saturnight tonight, then from 6 PM it is Saturnight (5 of this season's launches were 6 PM)

/** The first Saturday of month `m` (0-based) of `y`, at noon. */
const firstSaturday = (y, m) => { const d = new Date(y, m, 1, 12); d.setDate(7 - d.getDay()); return d; };
export const alphamission = (y) => firstSaturday(y, 3);
export const omegamission = (y) => firstSaturday(y, 10);

/** The day time `t` belongs to, at noon: before 5 AM, the day before. */
export function nightDay(t) {
  const d = new Date(t);
  if (d.getHours() < NIGHT_END) d.setDate(d.getDate() - 1);
  d.setHours(12, 0, 0, 0);
  return d;
}

/** SCUL's season of time `t`: { year, off }. off is the winter: { year: 2026, off: true } runs from the day after
 *  Omegamission 2026 to the day before Alphamission 2027. */
const EDGES = new Map(), dayKey = (d) => d.getMonth() * 32 + d.getDate(); // W102 logscale: a year's two missions, made once (the Log asks for every flight's season), as calendar days, so a new time zone can't move them
export function seasonOf(t) {
  const d = nightDay(t), y = d.getFullYear(), k = dayKey(d);
  if (!EDGES.has(y)) EDGES.set(y, [dayKey(alphamission(y)), dayKey(omegamission(y))]);
  const [alpha, omega] = EDGES.get(y);
  if (k < alpha) return { year: y - 1, off: true };
  return { year: y, off: k > omega };
}

/** Saturnight at time `t`: "tonight" (a Saturday in season, 5 AM to 6 PM), "now" (6 PM to 5 AM on the Sunday), or null. */
export function saturnight(t) {
  const d = nightDay(t);
  if (d.getDay() !== 6 || seasonOf(t).off) return null;
  return new Date(t).getDay() === 6 && new Date(t).getHours() < EVENING ? "tonight" : "now";
}
