// Starchart's themes: Dark (the default, space-y, AMOLED black), Daystar (light, for riding by day) and By the sun. A
// classic script in <head>, after the stylesheets: it sets <html data-theme> before the first paint, so the page never
// flashes the wrong theme.
//
// Settings (W15-common.md): localStorage "starchart.theme" = dark | light | sun, read here at start and again
// on each "starchart:settings" event. W124 settings3: a stored "system" (Like the phone, gone) becomes, once, what the phone
// prefers then, so nothing changes on screen. W28 settings: Dark
// is always AMOLED black (arclight, 2026-10-17: "I don't think anyone's gonna want non-AMOLED black in 2026"), so
// the old switch, "starchart.amoled", is gone and the grey Dark with it.
//
// The chart switches by a paint diff, with no reload and no setStyle: every style has the same layers
// and ids (chart/style/build_style.py), so only the paint values that differ are set, and the app's
// own sources and layers (the course, the ship, the ChartMotion GL layer) are never touched. AMOLED is
// a few overrides on the dark paint: every void becomes #000. Once the chart and the chrome are both
// switched, window gets "starchart:theme" with { theme: "dark" | "light", amoled }.
//
// main.js: style = await getJSON(starchartTheme.styleFile); starchartTheme.prepare(style) before
// makeMap; starchartTheme.attach(map, { motion, at }) after.
//
// W73 dark (design/app-ui/SPEC.md §120): "sun", By the sun: Daystar from sunrise, Dark from sunset, reckoned at the Fort as
// app/dusk.js does (weather-logic.js's sunAltitude, again here, as this is a classic script). It looks every LOOK_MS and
// switches only while starchartTheme.hold() is false (main.js: no turn within 20 s), the chart's paint cross-fading over FADE_MS.
(() => {
  const html = document.documentElement;
  const STYLES = { dark: "chart/style/saturnight.json", light: "chart/style/saturnight-daystar.json" };
  // W185 colours (SPEC §321): the dark void and AMOLED's black from design/tokens.css, loaded above this classic script; the halo as the style writes it
  const tok = (v) => getComputedStyle(html).getPropertyValue(v).trim(), halo = (h) => `rgba(${[1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",")},0.85)`; // W185 colours
  const VOID = tok("--map-void"), BLACK = tok("--fixed-black"), SYSTEM_HALO = halo(VOID); // the dark void (design/tokens.json), as the style writes it; W185 colours; W186 palette: the chart's, her ground (color-map)
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  if (get("starchart.theme") === "system") try { localStorage.setItem("starchart.theme", matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"); } catch { /* storage off */ } // W124 settings3
  const hand = () => { html.dataset.hand = get("starchart.hand") === "left" ? "left" : "right"; }; // W122 homerow: <html data-hand>, Settings › Buttons, for app/home.css, from the first frame
  hand(); // W122 homerow
  html.toggleAttribute("data-wx-on", get("starchart.layer.weather") === "on"); // W173 uismall (SPEC §302): with Weather on, its circle looks for the radar from the first frame (app/weather.css i-wx-boot), not the layer-off cloud
  // W73 dark: the sun at the Fort, as app/weather-logic.js's sunAltitude and isDay
  const SKY = [-71.13946, 42.3596], RAD = Math.PI / 180, LOOK_MS = 15000, FADE_MS = 1200; // W73 dark: FADE_MS is --t-ceremony
  function sunUp(ms) { // W73 dark
    const [lon, lat] = SKY, d = ms / 86400000 - 10957.5, g = (357.529 + 0.98560028 * d) * RAD, q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD, e = (23.439 - 0.00000036 * d) * RAD;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(e) * Math.sin(L));
    const ha = ((280.46061837 + 360.98564736629 * d + lon) * RAD) - ra;
    return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD > -0.833;
  }

  /** The theme the settings ask for, resolved: { theme: "dark" | "light", amoled }. */
  function wanted() {
    const t = get("starchart.theme");
    const theme = t === "light" || (t !== "dark" && sunUp(Date.now())) ? "light" : "dark"; // W73 dark: sun; W160 logsettings (SPEC §286, her note 18): By the sun for a rider who never chose (app/settings.js KEYS' default)
    return { theme, amoled: theme === "dark" }; // W28 settings: Dark is AMOLED black
  }

  let want = wanted();
  const metas = {};
  const meta = (name) => (metas[name] ??= document.querySelector(`meta[name="${name}"]`));
  function chrome({ theme, amoled }) {
    html.dataset.theme = theme;
    html.toggleAttribute("data-amoled", amoled);
    meta("color-scheme")?.setAttribute("content", theme);
    // The browser's bar takes the ground's colour; the stylesheets above have loaded, so it is the token's.
    meta("theme-color")?.setAttribute("content", getComputedStyle(html).getPropertyValue("--void").trim() || VOID);
  }
  chrome(want);

  // ---- the chart --------------------------------------------------------------------------------
  /** AMOLED: the dark style's void, wherever it is painted, becomes #000. */
  const black = (v) => (v === VOID ? BLACK : v === SYSTEM_HALO ? halo(BLACK) : Array.isArray(v) ? v.map(black) : v); // W185 colours
  const paintOf = (style, amoled) => {
    const out = {};
    for (const L of style.layers) {
      const p = {};
      for (const [k, v] of Object.entries(L.paint || {})) p[k] = JSON.stringify(amoled ? black(v) : v);
      out[L.id] = p;
    }
    return out;
  };
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  /** W112 palette: the wormholes' particles in the style's own wormhole colour (Daystar's bike blue, not the token's teal). */
  const wormOf = (style, ink) => { const c = style.layers.find((l) => l.id === "wormhole")?.paint?.["line-color"]; if (ink && typeof c === "string") ink.worm = hex(c); }; // W112 palette

  let map = null, motion = null, at = null, spriteAt = null, shown = null; // shown: { theme, amoled, paint }
  const styles = {}, sprites = {}, inks = {};
  const load = (theme) => (styles[theme] ??= fetch(at(STYLES[theme])).then((r) => {
    if (!r.ok) throw new Error(`${STYLES[theme]}: HTTP ${r.status}`);
    return r.json();
  }).catch((err) => { delete styles[theme]; throw err; })); // a failed fetch is tried again at the next switch
  let seq = 0, pristine = null; // the dark style's layers before AMOLED's overrides, to switch back to

  async function chart(w, fade = 0) { // W73 dark: fade, the cross-fade's ms
    const n = ++seq;
    const style = await load(w.theme);
    if (n !== seq || !map) return false; // a later switch won
    const t0 = performance.now();
    const paint = paintOf(style, w.amoled);
    let set = 0;
    for (const id in paint) {
      if (!map.getLayer(id)) continue;
      const was = shown.paint[id] || {};
      for (const k in paint[id]) if (paint[id][k] !== was[k]) {
        if (fade) map.setPaintProperty(id, `${k}-transition`, { duration: fade, delay: 0 }); // W73 dark: then back to the style's own
        map.setPaintProperty(id, k, JSON.parse(paint[id][k])); set++;
      }
    }
    if (w.theme !== shown.theme) map.setGlobalStateProperty?.("theme", w.theme); // W150 mapink (SPEC §269): the street names' kind words by day (build_style.py by_theme), in the layout both styles share
    if (sprites[w.theme] !== sprites[shown.theme]) map.setSprite(sprites[w.theme] ??= spriteAt(style.sprite)); // W111 sprite3x: main.js's, the 3x sheet on a 2.625x or 3x phone
    wormOf(style, inks[w.theme]); // W112 palette
    if (motion && inks[w.theme]) for (const k in inks[w.theme]) motion.rgb[k]?.set(inks[w.theme][k]);
    if (fade) setTimeout(() => { for (const id in paint) if (map.getLayer(id)) for (const k in paint[id]) map.setPaintProperty(id, `${k}-transition`, undefined); }, fade + 100); // W73 dark
    shown = { ...w, paint };
    map.triggerRepaint();
    window.__themeCost = { ms: performance.now() - t0, set }; // read by tests/e2e/app-theme.spec.mjs
    return true;
  }

  function done() {
    dispatchEvent(new CustomEvent("starchart:theme", { detail: { theme: want.theme, amoled: want.amoled } }));
  }

  let failing = false; // W190 statefacts: the chart's style failed, until one comes
  async function update(fade = 0) { // W73 dark: fade, By the sun's own switch
    const w = wanted();
    if (w.theme === want.theme && w.amoled === want.amoled) return;
    want = w;
    // W73 dark: with a fade, the chrome switches halfway through the chart's (a view transition's fade would take the taps for
    // its length: Land, the tallies)
    if (!fade || !map) chrome(w);
    if (!map) return; // attach() brings the chart to it
    try {
      if (!(await chart(w, fade))) return;
      failing = false; // W190 statefacts
      if (fade) { await new Promise((r) => setTimeout(r, fade / 2)); if (want !== w) return; chrome(w); } // W73 dark
      done();
    } catch (err) { // W190 statefacts (SPEC §331): the chart's style didn't come (was: the chrome switched anyway, over the old chart, and a pick
      // of the same theme did nothing): the chrome and starchartTheme.current stay with the chart as shown, so the next pick, or By the sun's next look, tries again
      if (want === w) { want = { theme: shown.theme, amoled: shown.amoled }; chrome(want); } // W190 statefacts
      if (!failing) console.error("theme:", err); // W190 statefacts: once a failure streak, as By the sun tries again every 15 s
      failing = true; // W190 statefacts
    }
  }
  // W73 dark: By the sun, at sunrise and sunset, unless a turn is near (hold); again when the page comes back
  const bySun = () => {
    if (["dark", "light"].includes(get("starchart.theme"))) return; // W160 logsettings: By the sun, chosen or the default
    if (map) for (const t in STYLES) load(t).catch(() => {}); // both styles ready, so the fade starts on time
    if (!window.starchartTheme.hold?.()) update(document.hidden ? 0 : FADE_MS);
  };
  setInterval(bySun, LOOK_MS); // W73 dark
  document.addEventListener("visibilitychange", () => { if (!document.hidden) bySun(); }); // W73 dark

  addEventListener("starchart:settings", (e) => {
    if (e.detail?.key === "starchart.theme") update();
    if (e.detail?.key === "starchart.hand") hand(); // W122 homerow: live
  });

  window.starchartTheme = {
    /** W73 dark: main.js's: true while By the sun must wait (a turn near). */
    hold: null,
    /** W73 dark: By the sun's day, at time `ms`, and its look now; for tests. */
    sunUp, look: () => bySun(),
    /** The style file for the theme at start, so the chart is drawn in it from the first frame. */
    get styleFile() { return STYLES[want.theme]; },
    get current() { return { ...want }; },
    /** Before makeMap: AMOLED's overrides on the style the chart starts with. */
    prepare(style) {
      if (!want.amoled) return style;
      pristine = { ...style, layers: structuredClone(style.layers) };
      for (const L of style.layers) if (L.paint) for (const k in L.paint) L.paint[k] = black(L.paint[k]);
      return style;
    },
    /** After makeMap: switch the chart from here on. `style` is the one the map was made with. */
    attach(m, { style, motion: mo, tokens, at: atFn, sprite }) { // W111 sprite3x: sprite
      map = m; motion = mo; at = atFn; spriteAt = sprite; // W111 sprite3x
      const theme = style.name === "Daystar" ? "light" : "dark";
      const amoled = theme === "dark" && !!pristine;
      styles[theme] = Promise.resolve(pristine || style);
      sprites[theme] = style.sprite;
      // The GL layer's colours, by theme. Its star (the particles' cores, the disks' glints) stays lit by
      // day: white, as the style's wormhole cores (build_style.py DAY_LIT).
      for (const [th, C, star] of [["dark", tokens.color, "starlight"], ["light", tokens["color-light"], "space-2"]]) {
        inks[th] = { pulsar: hex(C.pulsar), hole: hex(C["black-hole"]), star: hex(C[star]), worm: hex(C.wormhole) };
      }
      wormOf(style, inks[theme]); // W112 palette
      shown = { theme, amoled, paint: paintOf(style, false) }; // as drawn: prepare() has blackened it for AMOLED
      if (motion) for (const k in inks[theme]) motion.rgb[k]?.set(inks[theme][k]);
      const settle = theme !== want.theme || amoled !== want.amoled ? chart(want) : Promise.resolve(true);
      settle.then((ok) => ok && done(), (err) => console.error("theme:", err));
    },
  };
})();
