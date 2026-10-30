// W77 hours (design/app-ui/SPEC.md §140): a place's opening hours, said only when it matters: "Closed", or "Closes 6 PM"
// within the hour, else nothing. The search index carries OSM's raw `opening_hours` string as `oh` (index v8 on).
//
//   parseHours(s)        the week's open stretches, or null for anything outside the subset below
//   hoursAt(s, now)      { state: "open" | "closed" | "unknown", closes?, opens? }: closes and opens are Dates
//   hoursLine(s, now)    { key: "closed" | "closes" | "opens", at? } or null: what the peek and the search row say
//
// The subset, read strictly: rules split by ";" (a later rule's days replace an earlier one's) or by ", " before a new
// weekday selector (an additional rule, adding to those days, or closing them if "off"); a rule is "24/7", or optional
// weekdays (Mo-Fr, Sa,Su, Fr-Mo) and then times (08:00-12:00,13:00-17:30, 18:00-02:00 past midnight, up to 24:00) or
// "off"/"closed". Anything else (PH and SH, months, dates, weeks, sunrise and sunset, comments, "+", "open", nth
// weekdays) makes the whole string unknown, which says nothing: a wrong line is worse than none. Times are the phone's
// own, Greater Boston's.

const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"], WD = `(?:${DAYS.join("|")})`;
const DAY = 1440, SOON = 60; // minutes; "within the hour" is 60 minutes or less
const TIME = /^(\d{1,2}):(\d{2})$/;

/** "07:30" -> 450; an end may run past midnight as OSM writes it ("02:00", or "26:00"), up to `max` hours. */
const minutes = (t, max = 24) => {
  const m = TIME.exec(t);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  return h > max || mi > 59 || (h === max && mi) ? null : h * 60 + mi;
};

/** "Mo-Fr,Su" -> [1, 2, 3, 4, 5, 0], or null. A range may wrap the week (Fr-Mo). */
function weekdays(sel) {
  const out = new Set();
  for (const part of sel.split(",")) {
    const [a, b, extra] = part.split("-");
    const i = DAYS.indexOf(a), j = b === undefined ? i : DAYS.indexOf(b);
    if (extra !== undefined || i < 0 || j < 0) return null;
    for (let d = i; ; d = (d + 1) % 7) { out.add(d); if (d === j) break; }
  }
  return [...out];
}

/** "08:00-12:00,13:00-02:00" -> [[480, 720], [780, 1560]], or null. An end at or before its start runs past midnight. */
function times(sel) {
  const out = [];
  for (const part of sel.split(",")) {
    const [a, b, extra] = part.split("-");
    const s = minutes(a ?? ""), e0 = minutes(b ?? "", 48);
    if (extra !== undefined || s == null || e0 == null || s >= DAY) return null;
    const e = e0 <= s ? e0 + DAY : e0;
    if (e - s > DAY) return null;
    out.push([s, e]);
  }
  return out;
}

/** One rule ("Mo-Fr 08:00-17:00", "Su off", "10:00-18:00", "24/7") -> { days, spans }, spans [] for off; else null. */
function rule(text) {
  const t = text.trim().split(/\s+/);
  if (t.length === 1 && t[0] === "24/7") return { days: [0, 1, 2, 3, 4, 5, 6], spans: [[0, DAY]] };
  let days = [0, 1, 2, 3, 4, 5, 6], every = true;
  if (t.length === 2) { days = weekdays(t[0]); if (!days) return null; t.shift(); every = false; } else if (t.length !== 1) return null;
  if (t[0] === "off" || t[0] === "closed") return { days, spans: [], every };
  const spans = times(t[0]);
  return spans && { days, spans, every };
}

/** The week's open stretches, by weekday (0 Sunday): [[start, end, doubt], ...] in minutes from that day's midnight, an
 *  end past 1440 running into the next day. Null when the string is outside the subset. `doubt` marks the part past
 *  midnight when a later rule sets the next day ("Su 10:00-01:00; Mo 11:00-01:00"): OSM's reference reader closes it
 *  at midnight, its author likely meant 1 AM, so it says nothing there; so too when an added "off" closes the next day
 *  ("Fr 18:00-02:00, Sa off"), or replaces or closes the day itself ("Mo-Su 18:00-02:00; Sa 10:00-12:00": Saturday's
 *  night into Sunday). */
export function parseHours(s) {
  if (typeof s !== "string" || !s.trim() || s.length > 255) return null;
  const week = DAYS.map(() => []), set = DAYS.map(() => -1), cut = DAYS.map(() => false);
  for (const [n, normal] of s.split(";").entries()) {
    if (!normal.trim()) continue; // a trailing ";"
    // ", " then a weekday starts an additional rule, which adds to its days rather than replacing them;
    // "08:00-12:00, 13:00-17:00" and "Mo, We" are one selector each; "17:00,Sa 10:00-14:00" is two rules
    const parts = normal.replace(/,\s+(?=\d)/g, ",").replace(new RegExp(`(${WD}),\\s+(?=${WD})`, "g"), "$1,").replace(new RegExp(`(\\d),\\s*(?=${WD}\\b)`, "g"), "$1, ")
      .split(new RegExp(`,\\s+(?=${WD}\\b)`));
    const rules = parts.map(rule);
    if (rules.some((r) => !r)) return null;
    if (n > 0 && rules.some((r) => r.every)) return null; // readers differ on whether a later rule with no weekdays replaces the days before it
    rules.forEach((r, i) => {
      for (const d of r.days) {
        // a rule that replaces a day's hours, or an added "off" that closes it ("Mo-Fr 09:00-17:00, We off"), leaves the
        // night after it in doubt: OSM's reference reader keeps an earlier rule's hours past that midnight
        const night = week[d].filter(([, b]) => b > DAY).map(([, b]) => [DAY, b, true]);
        if (i === 0) { week[d] = [...night, ...r.spans]; set[d] = n; } else if (r.spans.length) week[d] = [...week[d], ...r.spans];
        else { week[d] = night; cut[d] = true; }
      }
    });
  }
  return week.map((spans, d) => spans.flatMap(([a, b, doubt]) => (doubt ? [[a, b, true]] : b > DAY && (set[(d + 1) % 7] > set[d] || cut[(d + 1) % 7]) ? [[a, DAY, false], [DAY, b, true]] : [[a, b, false]])));
}

/** Local wall time `min` minutes after the midnight of `day0` (a Date at a local midnight), as a Date, so the minutes
 *  until it are real minutes across a DST change; null for a time the clock skips or says twice that night. */
function wall(day0, min) {
  const h = Math.floor((min % DAY) / 60), w = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + Math.floor(min / DAY), h, min % 60);
  return w.getHours() !== h || twice(w) ? null : w;
}
/** Whether the clock shows `t`'s time twice (the hour after 1 AM when DST ends). */
const twice = (t) => [-1, 1].some((k) => { const o = new Date(+t + k * 3600000); return o.getHours() === t.getHours() && o.getMinutes() === t.getMinutes(); });

/** Whether the place is open at `now` (a Date or ms), and when that changes. */
export function hoursAt(s, now = Date.now()) {
  const week = parseHours(s);
  if (!week) return { state: "unknown" };
  const t = new Date(now), today = new Date(t.getFullYear(), t.getMonth(), t.getDate()), d = t.getDay();
  const m = t.getHours() * 60 + t.getMinutes();
  // every stretch from yesterday to a week on, in minutes from today's midnight, merged where they touch
  const spans = [];
  for (let k = -1; k <= 7; k++) for (const [a, b, doubt] of week[(d + k + 7) % 7]) spans.push([a + k * DAY, b + k * DAY, doubt]);
  spans.sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const [a, b, doubt] of spans) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) { last[1] = Math.max(last[1], b); last[2] ||= doubt; } else merged.push([a, b, doubt]);
  }
  const open = merged.find(([a, b]) => a <= m && m < b);
  if (open?.[2] || twice(t)) return { state: "unknown" }; // its end is in doubt, or the clock is going round an hour again
  if (open && open[1] >= 7 * DAY) return { state: "open" };
  const next = !open && merged.find(([a]) => a > m), at = open ? wall(today, open[1]) : next && wall(today, next[0]);
  if ((open || next) && !at) return { state: "unknown" }; // a change at a time the clock skips or says twice
  if (next?.[2]) return { state: "closed" }; // W77 hours: the next span is a doubtful night: closed is true either way, its opening isn't (the re-review's P1)
  return open ? { state: "open", closes: at } : next ? { state: "closed", opens: at } : { state: "closed" };
}

/** What to say, or null: "closed", or "closes" (at) when it closes within the hour, or "opens" (at) when a closed place
 *  opens within the hour. Open for longer, or unknown: nothing. */
export function hoursLine(s, now = Date.now()) {
  const h = hoursAt(s, now), soon = (at) => at && at - new Date(now) <= SOON * 60000;
  if (h.state === "open") return soon(h.closes) ? { key: "closes", at: h.closes } : null;
  if (h.state === "closed") return soon(h.opens) ? { key: "opens", at: h.opens } : { key: "closed" };
  return null;
}

/** "6 PM", "5:30 PM", "12 AM". */
export const hourLabel = (at) => at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\s/g, " ").replace(":00 ", " ");

/** W77 hours: the words, [SCUL, Plain]; the same in both, since a closing time needs no lingo. */
export const WORDS = {
  closed: ["Closed", "Closed"],
  closes: (t) => [`Closes ${t}`, `Closes ${t}`],
  opens: (t) => [`Opens ${t}`, `Opens ${t}`],
};
/** The line's words in the mode `pick` gives ([SCUL, Plain] -> one), or "". */
export function hoursWords(s, now, pick) {
  const l = hoursLine(s, now);
  if (!l) return "";
  return pick(l.key === "closed" ? WORDS.closed : WORDS[l.key](hourLabel(l.at)));
}
