// W86 avatar (design/app-ui/SPEC.md §173): your colour on the chart. W101 avatars (§197): her note, 2026-10-23, "We shouldn't be
// selecting colors, we should be selecting the avatar itself, and the avatars should look a bit different from each other."
// So Settings › Avatar (SCUL "Pilot") is a row of avatars, each a small picture of itself, drawn by the marker's own code
// (app/ship-model.js and app/ship-model-gl.js) and kept as starchart.avatar: today's rider with the basket, a racer, a cargo
// bike, an arrow, and in SCUL the ship too. Each has its own fixed colours; the marker takes the pick live in every form (on
// the bike, on foot, stood up on a flat chart, dimmed while GPS is lost): app/main.js asks avatarOf() for the build.
//
// Migration: "default" (or nothing) is each word mode's own marker, the ship in SCUL and the rider in Plain, as before. A W86
// colour ("yellow" …) is that marker in that colour, so nobody's marker changes until they pick. Her "yellow" (10-22: "I want
// to be yellow!") is the Yellow avatar in Plain, today's rider in yellow, picked in Settings. Picking another drops the colour. The heading beam, the accuracy ring and the trail stay in --you (§173).
import { get, set } from "./settings.js";
import { pick, onLingo } from "./lingo-mode.js";
import { tapTick } from "./motion.js";
import { buildShip, ShipMotion, hex } from "./ship-model.js";
import { LOOKS, ShipMeshGL } from "./ship-model-gl.js";

export const KEY = "starchart.avatar";
/** W86 avatar's colours, values of starchart.avatar kept for the migration: each its token. */
export const COLORS = { yellow: "pulsar", pink: "luna", purple: "black-hole", blue: "you", green: "phosphor" };
/** W101 avatars: the avatars, in the picker's order, each a value of starchart.avatar and the marker's build. The ship is SCUL's alone. */
export const AVATARS = { ship: "chibi", commuter: "commuter", sunny: "commuter", racer: "racer", cargo: "cargo", arrow: "arrow" };
/** W101 avatars: an avatar in a colour of its own, a token: her "I want to be yellow!" (2026-10-22), today's rider in yellow. */
export const TINTS = { sunny: "pulsar" };
/** The words, [SCUL, Plain]: the row's name, and each avatar's, short enough to sit under its picture at 320 px. */
export const WORDS = {
  row: ["Pilot", "Avatar"], // W101 avatars: was "Pilot color", "Avatar color"
  ship: ["Ship", "Ship"], commuter: ["Basket", "Basket"], sunny: ["Yellow", "Yellow"], racer: ["Racer", "Racer"], cargo: ["Cargo", "Cargo"], arrow: ["Arrow", "Arrow"],
};

/** W101 avatars: the avatar for a value of starchart.avatar in a word mode: { pick (an AVATARS key), build, tint (a token or null) }. */
export function avatarOf(v, plain) {
  const own = plain ? "commuter" : "ship", w = plain && v === "yellow" ? "sunny" : v; // her yellow rider is the Yellow avatar now
  const p = AVATARS[w] && !(plain && w === "ship") ? w : own;
  return { pick: p, build: AVATARS[p], tint: TINTS[p] || (p === own && COLORS[v]) || null };
}
/** The marker's colour for a value, a hex from the colour table, or null for its own paints (W86 avatar; W101 avatars: old values only). */
export const avatarHex = (color, plain, v = get(KEY)) => { const t = avatarOf(v, plain).tint; return t ? color[t] ?? null : null; };

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
export function drawAvatars(items, { color, you = color.you, view = VIEW } = {}) {
  if (!items.length) return;
  const cv = document.createElement("canvas"), gl = cv.getContext("webgl2", { antialias: true, premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true });
  if (!gl) return;
  const g = new ShipMeshGL(gl), s = new ShipMotion();
  s.still = true;
  const ink = new Float32Array(hex(color.void)), rim = new Float32Array(hex(you));
  for (const { canvas, build, gait = "ride", tint = null } of items) {
    const W = canvas.width, H = canvas.height, mesh = buildShip(color, { build, gait, detail: 1.5, avatar: tint });
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
    g.draw(M, s, { size: k, light: new Float32Array(L), eye: new Float32Array(back.map((x) => x * 20)), rim, ink, look: LOOKS.toon });
    const c2 = canvas.getContext("2d");
    c2.clearRect(0, 0, W, H); c2.drawImage(cv, 0, 0);
  }
  gl.getExtension("WEBGL_lose_context")?.loseContext();
}

/**
 * The avatars into `group` (a radiogroup in Settings), each a button with its picture and its name: a tap sets
 * starchart.avatar. `color` is the tokens' colour table; `plain()` true in Plain words. The pictures are drawn the first
 * time the row is seen, and again when an old colour goes.
 */
export function mountAvatar({ group, color, plain }) {
  if (!group) return;
  const bs = Object.keys(AVATARS).map((v) => {
    const b = Object.assign(document.createElement("button"), { type: "button" });
    b.setAttribute("role", "radio"); b.dataset.v = v;
    b.append(document.createElement("canvas"), document.createElement("span")); // the picture and its name
    group.append(b);
    return b;
  });
  let seen = false, drawn = "";
  const draw = () => {
    if (!seen) return;
    const own = avatarOf("default", plain()).pick, at = avatarOf(get(KEY), plain()), t = at.pick === own ? at.tint : null, dpr = Math.min(3, devicePixelRatio || 1), key = `${t}/${dpr}`;
    if (key === drawn) return;
    drawn = key;
    drawAvatars(bs.map((b) => {
      const c = b.firstChild, r = c.getBoundingClientRect(), w = Math.round((r.width || 56) * dpr), h = Math.round((r.height || 48) * dpr);
      c.width = w; c.height = h;
      const v = b.dataset.v, tint = TINTS[v] || (v === own && t); // its own colour, or an old one on the mode's own
      return { canvas: c, build: AVATARS[v], tint: tint ? color[tint] : null };
    }), { color });
  };
  const words = () => {
    group.setAttribute("aria-label", pick(WORDS.row));
    for (const b of bs) { b.lastChild.textContent = pick(WORDS[b.dataset.v]); b.hidden = plain() && b.dataset.v === "ship"; }
    drawn = ""; draw();
  };
  const show = () => { const p = avatarOf(get(KEY), plain()).pick; for (const b of bs) { b.setAttribute("aria-checked", String(b.dataset.v === p)); b.tabIndex = b.dataset.v === p ? 0 : -1; } };
  words(); show();
  onLingo(() => { words(); show(); });
  new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { seen = true; draw(); } }).observe(group);
  addEventListener("starchart:settings", (e) => { if (e.detail.key === KEY) { show(); draw(); } });
  const choose = (b) => { if (b.dataset.v === get(KEY)) return; set(KEY, b.dataset.v); tapTick(); };
  const shown = () => bs.filter((b) => !b.hidden);
  group.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) choose(b); });
  group.addEventListener("keydown", (e) => { // the arrow keys move the choice, as a radio group's do (settings.js's segs)
    const on = shown(), at = on.indexOf(e.target.closest("button"));
    const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: on.length - 1 }[e.key];
    if (to === undefined || at < 0) return;
    e.preventDefault();
    const b = on[(to + on.length) % on.length];
    choose(b); b.focus();
  });
}
