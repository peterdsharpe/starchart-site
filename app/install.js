// W22 pwa: Settings' Install row. Starchart installs as a web app (the manifest from app/build.mjs, the
// service worker app/sw.js): its own icon, and no browser bars.
//
// W47 install (design/app-ui/SPEC.md §58): the row opens the install guide, full screen (the <dialog id="install-guide">
// in app/index.html). The guide finds the device and the browser, says so if the app is installed, puts the browser's
// own Install button first when it gave one (`beforeinstallprompt`), and shows each browser's steps in tabs, the
// detected one first. On a computer it says first that Starchart is made for the phone, and folds the steps.
// W150 welcome2 (SPEC §270): the Starchart button (#getapp, atop the parked column) opens the same guide; it shows only in a
// browser tab, and goes once installed. The welcome card has no install row now.
//
//   - installed (display-mode standalone, or `appinstalled`), the row hides (W28 settings; it said so before)
//
// The listeners start when this module loads, so an early prompt is kept for the guide.

import { showPage } from "./subpage.js"; // W147 small6

let deferred = null, justInstalled = false;
const changed = () => globalThis.dispatchEvent?.(new CustomEvent("starchart:install"));
globalThis.addEventListener?.("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; changed(); });
globalThis.addEventListener?.("appinstalled", () => { deferred = null; justInstalled = true; changed(); });

/** Which browser's steps to show: by feature first, then by the user agent. (app/main.js reads it for the location's words.) */
export function browserOf({ ua = "", standalone, touch = 0, prompts = false } = {}) {
  const ios = /iPad|iPhone|iPod/.test(ua) || (standalone !== undefined && touch > 1); // navigator.standalone is WebKit on iOS and iPadOS
  if (ios) return "ios";
  if (/SamsungBrowser\//.test(ua)) return "samsung";
  if (/Firefox\//.test(ua)) return /Android/.test(ua) ? "firefox-android" : "firefox";
  if (prompts || /Chrome\/|Chromium\/|Edg\//.test(ua)) return /Android/.test(ua) ? "chrome-android" : "chrome";
  if (/Safari\//.test(ua) && /Macintosh/.test(ua)) return "safari-mac";
  return "other";
}

/**
 * W47 install: where Starchart runs. `uaData` is navigator.userAgentData (Chromium's: brands, platform), where there is one;
 * else the user agent string tells. `coarse` is (pointer: coarse), `short` the screen's short side in CSS px.
 * Returns { platform: "android" | "ios" | "computer", tab: the browser's tab in GUIDE, phone: a phone or tablet in the hand }.
 */
export function detect({ ua = "", uaData = null, standalone, touch = 0, coarse = false, short = 0 } = {}) {
  const brands = (uaData?.brands ?? []).map((b) => b.brand).join("|");
  const has = (brand, re) => brands.includes(brand) || re.test(ua);
  const ios = /iPad|iPhone|iPod/.test(ua) || (standalone !== undefined && touch > 1); // iPadOS says Macintosh: navigator.standalone and touch tell
  const android = !ios && (uaData?.platform === "Android" || /Android/.test(ua));
  let platform = "computer", tab;
  if (ios) { platform = "ios"; tab = /CriOS\//.test(ua) ? "ios-chrome" : "ios"; } // Firefox and Edge on iOS share Safari's Share sheet
  else if (android) {
    platform = "android";
    tab = has("Samsung Internet", /SamsungBrowser\//) ? "samsung" : /Firefox\//.test(ua) ? "firefox-android" : has("Microsoft Edge", /EdgA\//) ? "edge-android" : "chrome-android";
  } else tab = /Firefox\//.test(ua) ? "firefox" : has("Microsoft Edge", /Edg\//) ? "edge"
    : /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome\/|Chromium\//.test(ua) ? "safari-mac" : "chrome";
  return { platform, tab, phone: platform !== "computer" || (coarse && short > 0 && short < 600) }; // a Linux phone says it is a computer
}

/**
 * W47 install: each browser's steps, one thing to tap each, in the browser's own words (checked against its help pages,
 * or its source, on 2026-10-19: scratch/lanes/w47-install-final.md). ⋮, ≡ and ⋯ draw as the browsers' glyphs, and so
 * does the Share button after the word Share (install.css).
 */
export const GUIDE = [
  { id: "android", name: "Android", tabs: [
    { id: "chrome-android", name: "Chrome", steps: ["Tap ⋮ at the top right.", "Tap Install and create shortcut, or Install app.", "Tap Install."] },
    { id: "samsung", name: "Samsung Internet", steps: ["Tap ≡ at the bottom right.", "Tap Add page to, then Home screen.", "Tap Add."] },
    { id: "firefox-android", name: "Firefox", steps: ["Tap ⋮, then More.", "Tap Add app to Home screen.", "Tap Add."] },
    { id: "edge-android", name: "Edge", steps: ["Tap ≡ at the bottom.", "Tap Add to phone.", "Tap Install."] },
  ] },
  { id: "ios", name: "iPhone and iPad", tabs: [
    { id: "ios", name: "Safari", steps: ["Tap ⋯, then Share.", "Scroll down and tap Add to Home Screen.", "Make sure Open as Web App is on, then tap Add."],
      note: "On an iPad, or with Safari's Top or Bottom tab layout, Share is in the toolbar. Installed, Starchart keeps your Log safe: Safari can clear a tab's storage." },
    { id: "ios-chrome", name: "Chrome", steps: ["Tap Share at the right of the address bar.", "Tap Add to Home Screen.", "Tap Add."] },
  ] },
  { id: "computer", name: "Computer", tabs: [
    { id: "chrome", name: "Chrome", steps: ["Click ⋮ at the top right.", "Click Cast, save, and share, then Install page as app.", "Click Install."],
      note: "Or click the install icon at the right of the address bar." },
    { id: "edge", name: "Edge", steps: ["Click ⋯ at the top right.", "Click More tools, then Apps, then Install this site as an app.", "Click Install."],
      note: "Or click App available at the right of the address bar." },
    { id: "safari-mac", name: "Safari", steps: ["Click File in the menu bar, or Share in the toolbar.", "Click Add to Dock.", "Click Add."],
      note: "This needs macOS Sonoma or later." },
    { id: "firefox", name: "Firefox", steps: [],
      note: "Firefox on a computer can't install web apps. To install it, open it in Chrome or Edge, or on your phone." }, // W140 words: the lede says it works in this tab
  ] },
];

/**
 * What the row says. `installed`: the app runs on its own (display-mode standalone, fullscreen or minimal-ui,
 * or navigator.standalone). `prompt`: the browser gave us its install prompt. `justInstalled`: installed from
 * this tab. Returns { state: "installed" | "prompt" | "steps", title, small }. W47 install: every state but installed opens the guide.
 */
export function installRow({ installed = false, prompt = false, justInstalled = false, browser = "other" } = {}) {
  const ios = browser === "ios";
  // W55 layers2 (SPEC §71): no line that says what installing is (the row's long press and the guide say it); iOS keeps its fact
  if (installed) return { state: "installed", title: "Installed", small: ios ? "Its storage keeps your Log safe." : "" };
  if (justInstalled) return { state: "installed", title: "Installed",
    small: "Open it from your home screen." }; // W140 words
  return { state: prompt ? "prompt" : "steps", title: "Install Starchart", small: ios ? "Installed, it keeps your Log safe." : "" };
}

/** W47 install: the guide's first words, by state: { lede, button: show the browser's Install button, steps: show the tabs, fold: fold them }. */
export function guideText({ installed = false, justInstalled = false, prompt = false, phone = true } = {}) {
  if (installed) return { lede: "Starchart is installed. It opens from its own icon, with no browser bars.", button: false, steps: false, fold: false };
  if (justInstalled) return { lede: "Installed. Open it from your home screen.", /* W140 words */ button: false, steps: false, fold: false };
  const lede = phone ? "Installed, Starchart opens from your home screen, with no browser bars." // W140 words
    : "Starchart is made for your phone, on a ride. It works fine in this tab, too.";
  return { lede, button: prompt, steps: true, fold: !phone };
}

const GLYPH = { "⋮": "more", "≡": "menu", "⋯": "dots" };
/** W47 install: one step's nodes: its words, with the browsers' glyphs drawn in place of ⋮, ≡ and ⋯, and after Share. */
export function stepNodes(text, doc = document) {
  const out = [];
  for (const part of text.split(/(⋮|≡|⋯|\bShare\b)/)) {
    if (!part) continue;
    if (GLYPH[part]) out.push(Object.assign(doc.createElement("span"), { className: `g g-${GLYPH[part]}`, textContent: part }));
    else if (part === "Share") out.push(doc.createTextNode("Share"), Object.assign(doc.createElement("span"), { className: "g g-share", ariaHidden: "true" }));
    else out.push(doc.createTextNode(part));
  }
  return out;
}

const standaloneMQ = () => globalThis.matchMedia?.("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)");
/** W163 iosdownload (SPEC §290): an iPhone or iPad in a browser tab, not the Home Screen app: Safari can clear what a tab stores. */
export const iosTab = (nav = globalThis.navigator ?? {}, mq = standaloneMQ()) => detect({ ua: nav.userAgent, standalone: nav.standalone, touch: nav.maxTouchPoints }).platform === "ios" && !mq?.matches && nav.standalone !== true;
const make = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };

/** Fill and drive the row (`#install` in Settings), the guide (`#install-guide`) and the Starchart button (`#getapp`). */
export function mountInstall({ $ = (id) => document.getElementById(id) } = {}) {
  const row = $("install"), guide = $("install-guide");
  if (!row || !guide) return;
  const nav = globalThis.navigator ?? {};
  const browser = browserOf({ ua: nav.userAgent, standalone: nav.standalone, touch: nav.maxTouchPoints, prompts: "onbeforeinstallprompt" in globalThis });
  const coarse = !!globalThis.matchMedia?.("(pointer: coarse)").matches, sc = globalThis.screen ?? {};
  const found = detect({ ua: nav.userAgent, uaData: nav.userAgentData, standalone: nav.standalone, touch: nav.maxTouchPoints, coarse, short: Math.min(sc.width || 0, sc.height || 0) });
  const installed = () => !!standaloneMQ()?.matches || nav.standalone === true;
  const title = row.querySelector(".txt .t"), small = row.querySelector(".txt small");
  const body = guide.querySelector(".ig-body");
  let platform = found.platform, tab = found.tab, foldOpen = false;

  const tabRow = (label, cls, items, current, pick) => make("div", { className: cls, role: "tablist", ariaLabel: label },
    ...items.map((it) => {
      const b = make("button", { type: "button", role: "tab", textContent: it.name, onclick: () => pick(it) });
      b.dataset.id = it.id;
      b.setAttribute("aria-selected", String(it.id === current));
      return b;
    }));
  function steps() {
    const p = GUIDE.find((g) => g.id === platform), t = p.tabs.find((x) => x.id === tab) ?? p.tabs[0];
    const panel = make("div", { className: "ig-panel", role: "tabpanel", ariaLabel: `${t.name}, ${p.name}` });
    if (t.steps.length) panel.append(make("ol", { className: "steps" }, ...t.steps.map((s) => make("li", {}, make("span", {}, ...stepNodes(s))))));
    if (t.note) panel.append(make("p", { className: "ig-note", textContent: t.note }));
    return [
      tabRow("Device", "ig-plat", GUIDE, platform, (g) => { platform = g.id; tab = g.id === found.platform ? found.tab : g.tabs[0].id; draw(); focusTab(".ig-plat", g.id); }),
      tabRow("Browser", "ig-tabs", p.tabs, t.id, (x) => { tab = x.id; draw(); focusTab(".ig-tabs", x.id); }),
      panel];
  }
  const focusTab = (row, id) => body.querySelector(`${row} [data-id="${id}"]`)?.focus();
  function draw() {
    const g = guideText({ installed: installed(), justInstalled, prompt: !!deferred, phone: found.phone });
    guide.dataset.state = installed() || justInstalled ? "installed" : deferred ? "prompt" : "steps";
    const kids = [make("p", { className: "ig-lede", textContent: g.lede })];
    if (g.button) kids.push(make("button", { type: "button", className: "ig-now", textContent: "Install Starchart", onclick: prompt }),
      make("p", { className: "ig-or", textContent: "Or by hand, in your browser's menu:" }));
    if (g.steps && g.fold) {
      const d = make("details", { className: "ig-fold", open: foldOpen }, make("summary", { className: "row" },
        make("span", { className: "txt", textContent: "Install it on this computer" }), make("span", { className: "val", textContent: "›" })), ...steps());
      d.addEventListener("toggle", () => { foldOpen = d.open; });
      kids.push(d);
    } else if (g.steps) kids.push(...steps());
    body.replaceChildren(...kids);
  }
  async function prompt() {
    const p = deferred;
    deferred = null; // a prompt shows once; after it, the steps
    try {
      await p.prompt();
      const choice = await p.userChoice.catch(() => null);
      if (choice?.outcome === "accepted") justInstalled = true;
    } catch { /* W40 settings: the browser's prompt didn't open (a stale event): the steps stay, so the tap still answers */ }
    show();
  }
  function open() {
    platform = found.platform; tab = found.tab; foldOpen = false; // each open starts at this browser
    draw();
    showPage(guide); // W147 small6 (SPEC §264): the bar stays under it
  }
  const show = () => {
    const r = installRow({ installed: installed(), prompt: !!deferred, justInstalled, browser });
    row.dataset.state = r.state;
    title.textContent = r.title;
    small.textContent = r.small;
    row.hidden = r.state === "installed"; // W28 settings: only while it isn't installed
    const g = $("getapp");
    if (g) g.hidden = r.state === "installed"; // W150 welcome2: in a browser tab only
    if (guide.open) draw();
  };
  row.addEventListener("click", open);
  $("getapp")?.addEventListener("click", open); // W150 welcome2
  addEventListener("starchart:install", show);
  standaloneMQ()?.addEventListener?.("change", show);
  show();
}
