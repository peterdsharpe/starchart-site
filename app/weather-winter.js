// W102 winter (design/app-ui/SPEC.md §199): the National Weather Service's winter alerts for Greater Boston, pure, so Node
// tests it and app/weather.js asks with it.
//
// - The source: api.weather.gov's active alerts for three fixed forecast zones, the same request for every pilot: no
//   request carries a position (never `?point=`).
// - The chip: a snow or ice alert in effect takes the place of the chip's "No rain". SCUL's word for snow is Heavy
//   Radiation (the glossary: "Heavy Radiation is snow or hail"); the club has none for ice, so ice is "Ice" in both modes.
import { pick } from "./lingo-mode.js";

export const HOST = "https://api.weather.gov";
/** Southeast Middlesex (Cambridge, Somerville, Newton, Arlington, Medford), Suffolk (Boston) and Eastern Norfolk (Brookline,
 *  Quincy): the zones the chart's middle lies in. */
export const ZONES = ["MAZ014", "MAZ015", "MAZ016"];
export const ALERTS = `${HOST}/alerts/active?zone=${ZONES.join(",")}`;
export const ALERTS_MS = 15 * 60000; // at most one request in 15 minutes
/** The NWS's winter events, by what is on the road: snow or ice. The cold ones (Extreme Cold, Cold Weather, Freeze) aren't. */
const KIND = { "Blizzard Warning": "snow", "Winter Storm Warning": "snow", "Snow Squall Warning": "snow", "Winter Weather Advisory": "snow",
  "Winter Storm Watch": "snow", "Ice Storm Warning": "ice", "Freezing Fog Advisory": "ice" };
const RANK = { warning: 3, advisory: 2, watch: 1 }; // what is in effect now before what may come
/** A snow alert whose words speak of freezing rain or ice and never of snow is an ice one (the NWS folded the freezing rain
 *  advisory into the winter weather advisory). */
const iceOnly = (t) => /freezing rain|\bice\b|icy/i.test(t) && !/snow/i.test(t);

/** The winter alert issued from /alerts/active's GeoJSON at `now` (ms): { kind: "snow" | "ice", level: "warning" |
 *  "advisory" | "watch", event, onset, ends, expires (ms, or NaN) }, the strongest, ice before snow at the same level; or
 *  null. `ends` is the hazard's end, never the message's `expires`, which only drops a stale one. */
export function winterOf(json, now) {
  let best = null;
  for (const f of json?.features ?? []) {
    const p = f?.properties ?? {}, event = String(p.event ?? "");
    let kind = KIND[event];
    if (!kind || p.status !== "Actual" || p.messageType === "Cancel") continue;
    const onset = Date.parse(p.onset ?? ""), ends = Date.parse(p.ends ?? ""), expires = Date.parse(p.expires ?? "");
    if (ends <= now || expires <= now) continue;
    if (kind === "snow" && iceOnly(`${p.headline ?? ""} ${p.description ?? ""}`)) kind = "ice";
    const level = event.split(" ").pop().toLowerCase(), a = { kind, level, event, onset, ends, expires };
    const score = (x) => RANK[x.level] * 2 + (x.kind === "ice");
    if (!best || score(a) > score(best) || (score(a) === score(best) && ends > best.ends)) best = a;
  }
  return best;
}
/** The words, [SCUL, Plain]: the glossary's Heavy Radiation for snow; ice the same in both. */
export const WORDS = { snow: ["Heavy radiation", "Snow"], ice: ["Ice", "Ice"] };
/** The chip's words in `mode` (else the setting's): "Heavy radiation warning" (Plain "Snow warning"), "Ice advisory" in both. */
export const winterLine = (a, mode) => `${mode ? WORDS[a.kind][mode === "meatspace" ? 1 : 0] : pick(WORDS[a.kind])} ${a.level}`;
/** The spoken line: the fact, then stop (BRIEF §6.5): "Heavy radiation warning.", "Snow warning.", "Ice warning." */
export const winterVoice = (a, mode) => `${winterLine(a, mode)}.`;
/** In effect at `now`: its onset come, or none given. */
export const winterOn = (a, now) => !(a.onset > now);
/** A time as the sheet says it: "7:00 PM", another day's "Sun 7:00 PM". */
function at(t, now) {
  const d = new Date(t), clock = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date(now).toDateString() ? clock : `${d.toLocaleDateString("en-US", { weekday: "short" })} ${clock}`;
}
/** The sheet's line: the NWS's own name for it, when it starts if not yet, and when it ends: "Winter Storm Warning until
 *  7:00 PM", "Winter Storm Warning from 7:00 PM until Sun 1:00 PM". */
export const winterNote = (a, now) =>
  `${a.event}${winterOn(a, now) ? "" : ` from ${at(a.onset, now)}`}${Number.isFinite(a.ends) ? ` until ${at(a.ends, now)}` : ""}.`;
