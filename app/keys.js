// W190 settingsreg (design/app-ui/SPEC.md §332): every key the app keeps in the browser's storage, told once: what kind of key it
// is, and for a setting its values and its default. app/settings.js KEYS and get(), the backup's list (app/log.js KEPT) and the
// feedback's settings (app/feedback.js settingsNow) read it; app/tests/settings.test.mjs fails on a key in app/*.js that isn't here.
// No imports, so any module (and a test) can read it. The modules keep naming their own keys: this says what each one is.

/** What each kind of key is: kept past this tab (persisted), in a backup's settings (backup: app/log.js KEPT), and in the
 *  feedback's settings (reported: app/feedback.js settingsNow). */
export const KINDS = {
  setting: { persisted: true, backup: true, reported: true }, // a choice: Settings, Layers, the From/To switch, the route style
  mine: { persisted: true, backup: true, reported: false }, // her own places and streets (the feedback counts them, never names them)
  log: { persisted: true, backup: false, reported: false }, // the Log (app/blackbox.js): a backup carries it in its own part (app/logbook.js)
  device: { persisted: true, backup: false, reported: false }, // what this phone knows: the tips seen, the version, a flight to resume
  cache: { persisted: true, backup: false, reported: false }, // a copy of what the network gave
  tab: { persisted: false, backup: false, reported: false }, // sessionStorage: this tab's
  old: { persisted: true, backup: false, reported: false }, // an older version's key: a migration reads it once and removes it
};

/** Every key, by its kind; a key that ends in "." or ":" is a prefix (each tip's key, each notice's). A setting has its
 *  `values` (all strings) and its `default`: the first value, or { scul, meatspace } when it depends on the word mode. */
export const STORE = {
  "starchart.theme": { kind: "setting", values: ["sun", "dark", "light"] }, // W73 dark: sun, By the sun (app/theme.js); W124 settings3: no "system" (app/theme.js migrates it); W160 logsettings (SPEC §286): By the sun the default, a stored choice kept
  "starchart.tilt": { kind: "setting", values: ["flat", "tilted"] }, // the compass's long press (app/main.js)
  "starchart.sound": { kind: "setting", values: ["all", "directions", "off"] }, // W28 settings: Sound (app/calls.js); Directions by default since W56 voice2 (chatter was 62 % of what was said); W157 landmarks (SPEC §279, her ask): Detailed ("all") by default again, a stored choice kept
  "starchart.lingo": { kind: "setting", values: ["meatspace", "scul"] }, // W60 a: Words, SCUL or Plain (app/lingo-mode.js reads it; the code's word for Plain is the glossary's); W130 plaindefault: Plain first, the default
  "starchart.sound.on": { kind: "setting", values: ["all", "directions"] }, // W28 settings: the mode the sound button's tap comes back to; W157 landmarks: Detailed first
  "starchart:wake": { kind: "setting", values: ["1", "0"] },
  "starchart.smooth": { kind: "setting", values: ["auto", "60", "30"] }, // W20 chrome; W28 settings: Battery saver is "30", the governor's fps for following and the ambient motion; W56 perf: Auto (60, or a steady 30 when 60 doesn't hold; W102 fps30: 30 in flight while the chart barely moves), the default; Developer's Frame rate picks any
  "starchart.showfps": { kind: "setting", values: ["0", "1"] }, // W20 chrome: Show frame rate
  "starchart.comets": { kind: "setting", values: ["on", "off"] }, // W29 comets: live T trains on the chart (app/comets.js hears starchart:settings); W50 layers: its switch is in Layers
  "starchart.transit": { kind: "setting", values: ["on", "off"] }, // W128 small3: on by default (her note), a stored "off" stays off; W62 cometcard: Consider comets in routing (W68 settings2), bike plus comet in the course previews (app/comet-card.js KEY; main.js asks app/transit.js)
  "starchart.layer.tlines": { kind: "setting", values: ["on", "off"] }, // W50 layers: the T's lines, the comet tracks (app/layers.js); W55 layers2: with starchart.comets, the one Comets tile
  "starchart.layer.terrain": { kind: "setting", values: ["on", "off"], default: { scul: "on", meatspace: "off" } }, // W50 layers: the hills' tint and steep ground, and 3D when tilted (app/terrain.js); W192 mapfix3 (SPEC §337, her row 2): off by default in Plain, a crisp first look; SCUL keeps its look; a stored choice kept
  "starchart.layer.places": { kind: "setting", values: ["on", "off"] }, // W50 layers: the named places up close, the spot-* layers
  "starchart.layer.weather": { kind: "setting", values: ["off", "on"] }, // W52 weather: the rain radar and its nowcast, off by default (app/weather.js)
  "starchart.layer.quality": { kind: "setting", values: ["off", "on"] }, // W90 comfort: Flying (Plain's Ride quality), every road in the comfort scale, off by default (app/layers.js)
  "starchart.layer.lanes": { kind: "setting", values: ["on", "off"] }, // W59 routes: the streets' bike lanes in cyan, W23 comfort's shading (app/layers.js)
  "starchart.haptics.turns": { kind: "setting", values: ["off", "on"] }, // W69 motion: Turn buzzes, in flight: one long for port, two short for starboard; Android only; W88 settings3: Vibrate on taps (starchart.haptics) went
  "starchart.avatar": { kind: "setting", values: ["default", "yellow", "pink", "purple", "blue", "green", "ship", "commuter", "sunny", "racer", "cargo", "arrow", "racer2"] }, // W86 avatar: Your color, the marker's; W101 avatars: the avatars (app/avatar.js AVATARS), the colours kept for the migration; W112 avatars2: racer2, the green Racer and Ship
  "starchart.avatar.color": { kind: "setting", values: ["default", "purple", "yellow", "red", "green", "grey", "pink", "blue"] }, // W186 palette: her five; pink and blue kept for the migration (app/avatar.js OLD_COLORS) // W124 avatars3: the avatar's colour (app/avatar.js COLORS), kept for every type; "default", each type its own; W157 avatars5: red, green first, white went (a stored white is "default")
  "starchart.pace": { kind: "setting", values: ["100", ...Array.from({ length: 17 }, (_, i) => String(70 + 5 * i)).filter((v) => v !== "100")] }, // W59 pace: % of the router's speed, 70 to 150 in 5s (SPEC §81)
  "starchart.voice": { kind: "setting", values: ["lodestar", "vega", "critter"], default: { scul: "lodestar", meatspace: "vega" } }, // W147 voices2: no Rigel (migrate) // W129 critter: Burble became Critter (migrate) // W110 looks: no Mira // W97 voices: Settings › Sound › Voice (app/voices.js VOICES); W110 looks: a rider with no pick hears Lodestar in SCUL and Classic (vega) in Plain (app/voices.js voiceNow)
  "starchart.hand": { kind: "setting", values: ["right", "left"] }, // W122 homerow: Buttons, the round buttons' column and Launch at the right or the left (app/theme.js marks <html data-hand>; app/home.css)
  "starchart.pace.by": { kind: "setting", values: ["rides", "hand"] }, // W86 eta: learned from her rides (app/log.js), until she sets Pace by hand (SPEC §172)
  "starchart.walk": { kind: "setting", values: ["off", "on"] }, // W73 walk: the From/To row's Walk and T (app/walk-card.js KEY)
  "starchart.style": { kind: "setting", values: ["wormhole", "flat", "quickest"] }, // the route style picked last (app/course.js STYLE; app/course-logic.js STYLE_CARDS, styleOf)
  "starchart.deep": { kind: "setting", values: ["off", "on"] }, // W70 deep: the T underground at its depth (app/deep.js SETTING)
  "starchart.starred": { kind: "mine" }, // W67 places: her starred places (app/starred-logic.js KEY)
  "starchart.roads": { kind: "mine" }, // W133 roadprefs: the streets she prefers, avoids or never takes (app/avoid-logic.js KEY)
  "starchart.home": { kind: "mine" }, // the home place (app/course.js HOME)
  "starchart.places": { kind: "mine" }, // the recent picks (app/course.js RECENT)
  "starchart.blackbox": { kind: "log" }, // the flights' summaries (app/blackbox.js KEY)
  "starchart.blackbox.logs": { kind: "log" }, // the last flights' logs (app/blackbox.js LOGS)
  "starchart.tip.": { kind: "device" }, // the first-time tips seen (app/tips.js; Settings' Show tips again clears them)
  "starchart.hide.": { kind: "device" }, // the notices hidden for good (app/notice.js)
  "starchart:hint-hold": { kind: "device" }, // W25 rest's hold hint, still counted as seen (app/tips.js OLD)
  "starchart.version": { kind: "device" }, // the version that last ran here (app/changelog.js SEEN)
  "starchart.feedback.queue": { kind: "device" }, // the notes not sent yet (app/feedback.js)
  "starchart.feedback.draft": { kind: "device" }, // the note being written (app/feedback.js)
  "starchart.feedback.name": { kind: "device" }, // the name or contact of the last send that had one (app/feedback.js NAME)
  "starchart:resume": { kind: "device" }, // a flight to resume (app/resume.js FLIGHT)
  "starchart:resume-course": { kind: "device" }, // its course (app/resume.js ROUTE)
  "starchart:parked": { kind: "device" }, // the plan or search open when the app went (app/resume.js PARKED)
  "starchart:spot": { kind: "device" }, // the last parked spot, where the chart opens (app/resume.js SPOT)
  "starchart:nogps-seen": { kind: "device" }, // the no-GPS notice closed, and why (app/main.js NOGPS_SEEN)
  "starchart:comets-shapes": { kind: "cache" }, // the T's line shapes, a week (app/comets.js SHAPES)
  "starchart:boot-tries": { kind: "tab" }, // the reloads after a failed start (app/boot.js)
  "starchart:rough-seen": { kind: "tab" }, // the rough-position notice closed (app/main.js ROUGH_SEEN)
  "starchart:restored": { kind: "tab" }, // a restore's line, said after the restart (app/log.js DONE)
  "starchart.avoid": { kind: "old" }, // W73's avoided streets, before W133's levels (app/avoid-logic.js OLD_KEY)
  "starchart.chatter": { kind: "old" }, // W28's sound keys (app/calls.js migrates them)
  "starchart.muted": { kind: "old" },
  "starchart.motion": { kind: "old" }, // W133 settings4: no Motion, no Calm chart (app/settings.js migrate)
  "starchart:calm": { kind: "old" },
};

/** The entry for `key`, its own or its prefix's, or undefined. */
export const entry = (key) => STORE[key] ?? Object.entries(STORE).find(([k]) => /[.:]$/.test(k) && key.startsWith(k))?.[1];
/** The keys whose kind has `flag`: "persisted", "backup" or "reported". */
export const keysWith = (flag) => Object.keys(STORE).filter((k) => KINDS[STORE[k].kind][flag]);
/** A setting's default in word mode `mode` ("scul" or "meatspace"): a rider who never chose has it. */
export const defaultOf = (key, mode) => { const d = STORE[key]?.default ?? STORE[key]?.values?.[0]; return d && typeof d === "object" ? d[mode === "scul" ? "scul" : "meatspace"] : d; };
