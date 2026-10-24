// W86 avatar (design/app-ui/SPEC.md §173): your colour on the chart. "I would like to customize the color of my avatar! I want
// to be yellow!" A row of swatches in Settings, kept as starchart.avatar; the marker takes it live in every form (the ship,
// the person on a bike, on foot, standing up on a flat chart, dimmed while GPS is lost): app/ship-model-layer.js setAvatar(),
// which paints the suit in SCUL and the helmet and the coat in Plain (app/ship-model.js). The heading beam and the
// accuracy ring stay in --you: they are where the phone thinks you are, as the rough ring and the locate button are.
//
// The colours are the tokens' (design/tokens.json "color"), the dark ones in both themes, as the marker's mesh is: its ink
// outline (--void) parts it from either chart. Orange is the course's, so it is not offered.
import { get, set } from "./settings.js";
import { pick, onLingo } from "./lingo-mode.js";
import { tapTick } from "./motion.js";
import { PAINT, RIDERS, RIDER_PAINT } from "./ship-model.js";

export const KEY = "starchart.avatar";
/** The swatches, in their order: a value of starchart.avatar and its token (none: the paints as they were). */
export const AVATARS = { default: null, yellow: "pulsar", pink: "luna", purple: "black-hole", blue: "you", green: "phosphor" };
/** The words, [SCUL, Plain]: the row's name for screen readers and each swatch's. */
export const WORDS = {
  row: ["Pilot color", "Avatar color"], // US spelling, as her note and the app's miles are; W88 settings3: her "avatar color", and the pilot's in SCUL
  default: ["Stock paint", "Usual colors"], yellow: "Yellow", pink: "Pink", purple: "Purple", blue: "Blue", green: "Green",
};

/** The pilot's colour for a value, a hex from the colour table, or null for the paints as they were. */
export const avatarHex = (color, v = get(KEY)) => (AVATARS[v] ? color[AVATARS[v]] ?? null : null);

/**
 * The swatches into `group` (a radiogroup in Settings), each a 44 px button: a tap sets starchart.avatar. `color` is the
 * tokens' colour table; `build()` the marker's build (app/main.js shipBuild), whose own colours the default's swatch shows.
 */
export function mountAvatar({ group, color, build }) {
  if (!group) return;
  const bs = Object.keys(AVATARS).map((v) => {
    const b = Object.assign(document.createElement("button"), { type: "button" });
    b.setAttribute("role", "radio"); b.dataset.v = v;
    b.append(document.createElement("i")); // the swatch, a disc in the colour with the marker's ink round it
    group.append(b);
    return b;
  });
  const stock = () => (RIDERS[build()] ? [color[RIDER_PAINT.helmet], color[RIDERS[build()].coat]] : [color[PAINT.suit]]);
  const paint = () => {
    group.setAttribute("aria-label", pick(WORDS.row));
    for (const b of bs) {
      const v = b.dataset.v, [a, z = a] = v === "default" ? stock() : [avatarHex(color, v)];
      b.firstChild.style.background = a === z ? a : `linear-gradient(135deg, ${a} 50%, ${z} 50%)`;
      b.setAttribute("aria-label", pick(WORDS[v]));
    }
  };
  const show = () => { const v = get(KEY); for (const b of bs) { b.setAttribute("aria-checked", String(b.dataset.v === v)); b.tabIndex = b.dataset.v === v ? 0 : -1; } };
  group.style.setProperty("--ink", color.void);
  paint(); show();
  onLingo(paint);
  addEventListener("starchart:settings", (e) => { if (e.detail.key === KEY) show(); });
  const choose = (b) => { if (b.dataset.v === get(KEY)) return; set(KEY, b.dataset.v); tapTick(); };
  group.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) choose(b); });
  group.addEventListener("keydown", (e) => { // the arrow keys move the choice, as a radio group's do (settings.js's segs)
    const at = bs.indexOf(e.target.closest("button"));
    const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: bs.length - 1 }[e.key];
    if (to === undefined || at < 0) return;
    e.preventDefault();
    const b = bs[(to + bs.length) % bs.length];
    choose(b); b.focus();
  });
}
