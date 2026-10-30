// W86 avatar (design/app-ui/SPEC.md §173): your colour on the chart. W101 avatars (§197): her note, 2026-10-23, "We shouldn't be
// selecting colors, we should be selecting the avatar itself, and the avatars should look a bit different from each other."
// So Settings › Avatar (SCUL "Pilot") is a row of avatars, each a small picture of itself, drawn by the marker's own code
// (app/ship-model.js and app/ship-model-gl.js) and kept as starchart.avatar: today's rider with the basket, a racer, a cargo
// bike, an arrow, and in SCUL the ship too. Each has its own fixed colours; the marker takes the pick live in every form (on
// the bike, on foot, stood up on a flat chart, dimmed while GPS is lost): app/main.js asks avatarOf() for the build.
// W112 avatars2 (§224): her note, 2026-10-24, five slots, one-to-one across the word modes: Plain's Racer, Racer, Basket,
// Basket (her yellow) and Arrow are SCUL's Ship, Ship, Tall ship, Tall ship and Arrow, so switching words keeps the slot.
// W124 avatars3 (§234): her note, 2026-10-24, "the bike color customization should be separate from that": the avatar is a
// type (starchart.avatar: Racer, Basket, Cargo, Arrow; SCUL's Ship, Tall ship, Tallest ship, Arrow) and a colour
// (starchart.avatar.color), each kept across the word modes, the colour for every type.
//
// Migration: "default" (or nothing) is each word mode's own marker, the ship in SCUL and the rider in Plain, as before. W112's
// slots are their type and colour (MIGRATE): her yellow Basket stays a yellow Basket. Nothing is rewritten until she picks;
// a type picked then keeps the old value's colour. The heading beam, the accuracy ring and the trail stay in --you (§173).
// W157 avatars5 (§277): her notes, 2026-10-25, "all avatar colors need to be bold": red (Plain's default for every type), a
// hi-vis green, a golden yellow, pink, blue, purple. White went: a stored white is the default. SCUL keeps each type's own paints.
// W186 palette (§328): her row of 2026-10-28 08:50, "purple, yellow, red, green, and light gray, with purple being the default",
// in her palette's shades (her accent, yellow, red, green and silver); a stored pink or blue is purple, the nearest (ΔE2000 24, 16).
// W192 icons7 (§338): her row of 2026-10-29 06:04, "the default pointer, listed first on the avatar list, should be the arrow. In light
// mode, purple avatars should take on the darker purple accent color of light mode": in Plain the Arrow is the default and first (SCUL
// keeps its ship); a stored type is kept. On a light map purple is her day accent (tokens.json color-light), the others as by night.
import { get, set } from "./settings.js";
import { pick, onLingo } from "./lingo-mode.js";
import { tapTick } from "./motion.js";
import { buildShip, ShipMotion, hex } from "./ship-model.js";
import { LOOKS, ShipMeshGL } from "./ship-model-gl.js";

export const KEY = "starchart.avatar";
/** W124 avatars3 (§234): the colour, a pick of its own, kept for every type and both word modes (her "I want to be yellow!"). */
export const COLOR_KEY = "starchart.avatar.color";
/** W124 avatars3: the swatches, in the row's order, each a token: the rider's helmet and jacket, the pilot's suit and shields,
 *  the arrow's core. W86's colours are among them (its green, --phosphor, is the set's --terraform-glow now). */
export const COLORS = { purple: "avatar-purple", yellow: "avatar-yellow", red: "avatar-red", green: "avatar-green", grey: "avatar-grey" }; // W186 palette: her five, in her order
/** W186 palette: the stored colours that went, each the nearest of hers (ΔE2000: pink 24 from purple, blue 16). */
export const OLD_COLORS = { pink: "purple", blue: "purple" };
/** W124 avatars3 (§234): her note, 2026-10-24, "a couple of different bikes which map as counterparts, so say the cargo bike in
 *  Plain view could be a very tall bike in SCUL view". The types, in the picker's order, each a value of starchart.avatar and
 *  its build [SCUL, Plain]: Racer ↔ Ship, Basket ↔ Tall ship, Cargo ↔ the Tallest ship, the Arrow. */
export const AVATARS = { racer: ["chibi", "racer"], commuter: ["tall", "commuter"], cargo: ["tallest", "cargo"], arrow: ["arrow", "arrow"] };
/** W192 icons7 (§338): the picker's order [SCUL, Plain], each mode's default first: SCUL's Ship, Plain's Arrow. */
export const ORDER = [Object.keys(AVATARS), ["arrow", "racer", "commuter", "cargo"]];
/** W124 avatars3: each type's own colour [SCUL, Plain]: with no colour picked it wears its own paints, and so it does in this one.
 *  W157 avatars5: SCUL's ships wear their own white paints (null: no swatch); in Plain every type is red, a tint. W186 palette: purple,
 *  her default; SCUL's arrow its own blue ("blue", no swatch now). */
export const OWN = { racer: [null, "purple"], commuter: [null, "purple"], cargo: [null, "purple"], arrow: ["blue", "purple"] };
/** W124 avatars3: the old values that are no type now, each [type, colour]: W112's ship, green Ship and yellow Tall ship, W86's
 *  colours on each mode's own (her yellow is the yellow Basket, as in W112). W101's "cargo" is the Cargo type again. */
export const MIGRATE = {
  ship: ["racer"], racer2: ["racer", "green"], sunny: ["commuter", "yellow"], yellow: ["commuter", "yellow"],
  pink: ["default", "purple"], purple: ["default", "purple"], blue: ["default", "purple"], green: ["default", "green"], // W186 palette: pink and blue, purple
};
/** The words, [SCUL, Plain]: the rows' names, each type's under its picture (short enough for 320 px); NAMES, read aloud. */
export const WORDS = {
  row: ["Pilot", "Avatar"], color: ["Color", "Color"], // W101 avatars: was "Pilot color", "Avatar color"; W124 avatars3: color
  racer: ["Ship", "Racer"], commuter: ["Tall", "Basket"], cargo: ["Tallest", "Cargo"], arrow: ["Arrow", "Arrow"], // W124 avatars3
};
export const NAMES = { racer: ["Ship", "Racer"], commuter: ["Tall ship", "Basket"], cargo: ["Tallest ship", "Cargo"], arrow: ["Arrow", "Arrow"] }; // W124 avatars3
/** W124 avatars3: each swatch's name, read aloud, the same in both modes. */
export const COLOR_NAMES = { purple: "Purple", yellow: "Yellow", red: "Red", green: "Green", grey: "Gray" }; // W157 avatars5; W186 palette: hers ("light gray", Gray as the app's US spelling)

/** W124 avatars3: the colour kept for every type, from starchart.avatar.color, or the one an old value of starchart.avatar
 *  carries; null for none picked (each type its own). */
export const keptColor = (v, c) => (COLORS[c] ? c : OLD_COLORS[c] || MIGRATE[v]?.[1] || null); // W186 palette: OLD_COLORS
/** W124 avatars3: type `t` in colour `color` in a word mode: its tint, a token, or null for its own paints (its own colour too).
 *  W157 avatars5: Plain always tints (its own is red, not the old paints). */
export const tintOf = (t, color, plain) => (color && (plain || color !== OWN[t][0]) ? COLORS[color] : null);

/** The avatar for starchart.avatar `v` and starchart.avatar.color `c` in a word mode: { pick (an AVATARS key), color (a
 *  COLORS key), build, tint (a token or null) }. "default" (or none) is each mode's own type, the ship in SCUL and, W192 icons7, the
 *  Arrow in Plain (was the basket rider); with no colour picked, each type wears its own. W124 avatars3: a type and a colour are the
 *  same in either mode. */
export function avatarOf(v, plain, c = "default") {
  const m = plain ? 1 : 0, w = MIGRATE[v]?.[0] || v, p = AVATARS[w] ? w : ORDER[m][0], color = keptColor(v, c) || OWN[p][m]; // W192 icons7: ORDER, the default first
  return { pick: p, color, build: AVATARS[p][m], tint: tintOf(p, color, plain) };
}
/** W192 icons7 (§338): tint `t`'s paint, color-light's (`day`, given on a light map) where it has one, purple her day accent, else color's. */
export const paintOf = (t, color, day = null) => day?.[t] || color[t];
/** The marker's colour, a hex from the colour table, or null for its own paints (W86 avatar; W124 avatars3: the colour picked).
 *  W192 icons7: `day`, color-light on a light map. */
export const avatarHex = (color, plain, v = get(KEY), c = get(COLOR_KEY), day = null) => { const t = avatarOf(v, plain, c).tint; return t ? paintOf(t, color, day) ?? null : null; };

// ---- W101 avatars: the pictures --------------------------------------------------------------------------------------
const nrm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dt = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** The pictures' view: from the front and the right (az, degrees round from behind), down at tilt degrees from straight down. */
export const VIEW = { az: 140, tilt: 55, arrow: { az: 200, tilt: 25 } };

/**
 * Draw avatars into 2D canvases, as the marker's own mesh, lit and outlined as on the chart: `items` [{ canvas, build, gait,
 * tint }], each canvas drawn at its own size. One WebGL context for them all, let go after. `color`: the tokens' table.
 */
export function drawAvatars(items, { color, you = color.you, view = VIEW, lamps = true } = {}) { // W112 avatars2: lamps, lit or not
  if (!items.length) return;
  const cv = document.createElement("canvas"), gl = cv.getContext("webgl2", { antialias: true, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
  if (!gl) return;
  const g = new ShipMeshGL(gl), s = new ShipMotion();
  s.still = true;
  const ink = new Float32Array(hex(color.void)), rim = new Float32Array(hex(you));
  for (const { canvas, build, gait = "ride", tint = null } of items) {
    const W = canvas.width, H = canvas.height, mesh = buildShip(color, { build, gait, detail: 1.5, avatar: tint, dark: lamps }); // W150 avatars4: dark
    g.upload(mesh); s.rolls = !!mesh.rolls; s.walks = !!mesh.walks; s.step(0, 0);
    const v = build === "arrow" ? view.arrow : view, az = (v.az * Math.PI) / 180, tl = (v.tilt * Math.PI) / 180;
    const back = nrm([Math.sin(az) * Math.sin(tl), -Math.cos(az) * Math.sin(tl), Math.cos(tl)]); // toward the eye
    const right = nrm(crs([0, 0, 1], back)), up = crs(back, right);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; // the picture's extent: every solid vertex, seen from the eye
    for (let i = 0, d = mesh.data; i < mesh.opaque * 12; i += 12) {
      const p = [d[i], d[i + 1], d[i + 2] + s.z], x = dt(p, right), y = dt(p, up);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const k = 0.9 * Math.min(W / (x1 - x0), H / (y1 - y0)), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2; // px a unit, a margin round it
    const sx = 2 / W, sy = 2 / H, sz = -1 / (4 * k); // model px to clip: orthographic, x right, y up, depth toward the eye
    const M = new Float32Array([right[0] * sx, up[0] * sy, back[0] * sz, 0, right[1] * sx, up[1] * sy, back[1] * sz, 0,
      right[2] * sx, up[2] * sy, back[2] * sz, 0, -cx * k * sx, -cy * k * sy, 0, 1]);
    const f = nrm([up[0], up[1], 0]), L = nrm([-0.55 * right[0] + 0.55 * f[0], -0.55 * right[1] + 0.55 * f[1], 0.63]); // from the top left, as on the chart
    cv.width = W; cv.height = H;
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    g.draw(M, s, { size: k, light: new Float32Array(L), eye: new Float32Array(back.map((x) => x * 20)), rim, ink, look: LOOKS.toon, lamps }); // W112 avatars2: lamps
    const c2 = canvas.getContext("2d");
    c2.clearRect(0, 0, W, H); c2.drawImage(cv, 0, 0);
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
}

/**
 * The avatars into `group` (a radiogroup in Settings), each a button with its picture and its name: a tap sets
 * starchart.avatar. `color` is the tokens' colour table; `plain()` true in Plain words. The pictures are drawn the first
 * time the row is seen, and again when the colour changes. W112 avatars2: `dark()` true on a dark map, where the pictures'
 * lamps are lit, as the marker's are; again when the theme changes, and the word mode (each type its mode's avatar).
 * W124 avatars3 (§234): after the group, a second radiogroup, the colour's swatches, kept as starchart.avatar.color; every
 * picture wears the colour picked (or each its own, none picked).
 * W192 icons7 (§338): each mode's default first (ORDER); on a light map the pictures and swatches take `day`'s paints (paintOf).
 */
export function mountAvatar({ group, color, day = null, plain, dark = () => true }) { // W192 icons7: day, color-light
  if (!group) return;
  const radio = (box, v, cls) => {
    const b = Object.assign(document.createElement("button"), { type: "button", className: cls || "" });
    b.setAttribute("role", "radio"); b.dataset.v = v; box.append(b);
    return b;
  };
  const bs = Object.keys(AVATARS).map((v) => { const b = radio(group, v); b.append(document.createElement("canvas"), document.createElement("span")); return b; }); // the picture and its name
  const sw = Object.assign(document.createElement("div"), { className: "swatches" }); // W124 avatars3: the colours, each the marker's own paint (not Daystar's darker token)
  sw.setAttribute("role", "radiogroup"); group.after(sw);
  const cs = Object.keys(COLORS).map((v) => { const b = radio(sw, v); b.setAttribute("aria-label", COLOR_NAMES[v]); return b; });
  const paint = (t) => paintOf(t, color, dark() ? null : day); // W192 icons7: purple her day accent on a light map
  let seen = false, drawn = "";
  const draw = () => {
    for (const b of cs) b.style.setProperty("--sw", paint(COLORS[b.dataset.v])); // W192 icons7: by the theme (was set once)
    if (!seen) return;
    const kept = keptColor(get(KEY), get(COLOR_KEY)), dpr = Math.min(3, devicePixelRatio || 1), m = plain() ? 1 : 0, lamps = !!dark(), key = `${kept}/${dpr}/${m}/${lamps}`; // W112 avatars2: m, lamps; W124 avatars3: kept
    if (key === drawn) return;
    drawn = key;
    drawAvatars(bs.map((b) => {
      const c = b.firstChild, r = c.getBoundingClientRect(), w = Math.round((r.width || 56) * dpr), h = Math.round((r.height || 48) * dpr);
      c.width = w; c.height = h;
      const v = b.dataset.v, tint = tintOf(v, kept || OWN[v][m], !!m); // W124 avatars3: each type in the colour kept, or its own
      return { canvas: c, build: AVATARS[v][m], tint: tint ? paint(tint) : null }; // W192 icons7: paint
    }), { color, lamps }); // W112 avatars2: lamps
  };
  const words = () => {
    const order = ORDER[plain() ? 1 : 0]; bs.sort((a, b) => order.indexOf(a.dataset.v) - order.indexOf(b.dataset.v)); group.append(...bs); // W192 icons7: the mode's default first, Tab and the arrow keys in that order
    group.setAttribute("aria-label", pick(WORDS.row)); sw.setAttribute("aria-label", pick(WORDS.color)); // W124 avatars3
    for (const b of bs) { b.lastChild.textContent = pick(WORDS[b.dataset.v]); b.setAttribute("aria-label", pick(NAMES[b.dataset.v])); }
    drawn = ""; draw();
  };
  const show = () => {
    const at = avatarOf(get(KEY), plain(), get(COLOR_KEY)); // W124 avatars3: the type and the colour, each its row's pick
    for (const [all, p] of [[bs, at.pick], [cs, at.color]]) {
      const none = !all.some((b) => b.dataset.v === p); // W157 avatars5: SCUL's own paints check no swatch, so Tab lands on the first
      for (const b of all) { b.setAttribute("aria-checked", String(b.dataset.v === p)); b.tabIndex = b.dataset.v === p || (none && b === all[0]) ? 0 : -1; }
    }
  };
  words(); show();
  onLingo(() => { words(); show(); });
  new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { seen = true; draw(); } }).observe(group);
  addEventListener("starchart:settings", (e) => { if (e.detail.key === KEY || e.detail.key === COLOR_KEY) { show(); draw(); } });
  addEventListener("starchart:theme", draw); // W112 avatars2: the lamps, lit on a dark map only
  const choose = (b) => {
    const v = get(KEY);
    if (b.parentNode === sw) { if (b.dataset.v === get(COLOR_KEY)) return; set(COLOR_KEY, b.dataset.v); } // W124 avatars3: the colour
    else {
      if (b.dataset.v === v) return;
      if (!COLORS[get(COLOR_KEY)] && MIGRATE[v]?.[1]) set(COLOR_KEY, MIGRATE[v][1]); // W124 avatars3: an old value's colour stays with the next type (her yellow)
      set(KEY, b.dataset.v);
    }
    tapTick();
  };
  for (const [box, on] of [[group, bs], [sw, cs]]) {
    box.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) choose(b); });
    box.addEventListener("keydown", (e) => { // the arrow keys move the choice, as a radio group's do (settings.js's segs)
      const at = on.indexOf(e.target.closest("button"));
      const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: on.length - 1 }[e.key];
      if (to === undefined || at < 0) return;
      e.preventDefault();
      const b = on[(to + on.length) % on.length];
      choose(b); b.focus();
    });
  }
}
