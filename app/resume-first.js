// W213 resume2 (design/app-ui/SPEC.md §405, her row 8.4 of 11-10; UX rules 40 and 52): back to a ride Android dropped in the
// background, the ride's own screen from the first frame, never the home screen until app/main.js has carried it on (its
// late("Launch"), seconds later on a phone). A classic script in <head> (the CSP allows no inline script), after
// app/words-first.js: when app/resume.js's verdict on the kept ride is "resume", it marks <html data-flight="flying"
// data-resume="route|ride"> and, as words-first.js does, watches the parser and sets each part as it comes in, before anything
// paints: the ride's bar shown with the kept distance and time so far, Where to? and Record away, the tabs away. SCUL's tallies
// show at Launch, as before: their taps work only from then. With a route, app/course.css draws #comeback in the turn card's
// place until the card comes. An End tap meanwhile is kept (starchartEndTap): main.js says it ends once the chart is in, and ends
// it then. main.js takes it from here (coming, unresume()). Nothing here waits: two reads of localStorage, as app/first.js's.
(() => {
  const AWAY_MS = 2 * 3600e3, LY = 1609.344; // app/resume.js AWAY_MS (app/tests/resume.test.mjs holds them together); main.js LY
  let k = null, c = null;
  try { if (new URLSearchParams(location.search).get("sim") !== "demo") { k = JSON.parse(localStorage.getItem("starchart:resume")); c = k?.course && JSON.parse(localStorage.getItem("starchart:resume-course")); } } catch { /* none, or storage off */ }
  if (!k?.rec?.id || k.landed || Date.now() - (k.last || k.launched) > AWAY_MS) return; // app/resume.js verdict(): only "resume"
  const html = document.documentElement, scul = html.dataset.lingo !== "meatspace", walk = k.rec.footAt != null; // words-first.js marks Plain; a walk carried on is a walk (main.js launch)
  Object.assign(html.dataset, { flight: "flying", resume: c?.route || c?.leg ? "route" : "ride" }, scul ? { lingo: "scul" } : {}); // app/lingo-mode.js marks SCUL later, the same; a route as app/resume.js keptFlight() finds one (its own key, written apart)
  const text = { warp: "–", ly: (Math.max(0, k.metres || 0) / LY).toFixed(2), mins: String(Math.max(0, Math.floor((Date.now() - k.launched) / 60000))) }; // main.js hud(): no speed till a fix; the minutes through the gap
  const put = (n, t) => { if (n.textContent !== t) n.textContent = t; }; // again as the parser adds to it (its records' target, or its text's parent: a split download, as words-first.js grew())
  const part = (n) => {
    const id = n.id;
    if (id === "readout") n.hidden = false;
    else if (id === "gobar") n.hidden = true; // Where to? and Record
    else if (id === "bar") { n.classList.add("away"); n.inert = true; } // the tabs, as app/log.js showBar() in flight
    else if (id in text) put(n, text[id]);
    else if (scul && walk && n.matches("#readout .lbl")) put(n, n.matches("#ly + .lbl") ? "mi" : n.matches(".warp .lbl") ? "mph" : n.textContent); // main.js afootWords(); Plain's are these already
  };
  const all = (n) => { if (n.nodeType !== 1) return; part(n); for (const e of n.querySelectorAll("[id], .lbl")) part(e); };
  const watch = new MutationObserver((rs) => { for (const r of rs) { const n = r.type === "characterData" ? r.target.parentElement : r.target; if (n?.nodeType === 1) part(n); r.addedNodes.forEach(all); } });
  watch.observe(html, { childList: true, subtree: true, characterData: true });
  document.addEventListener("DOMContentLoaded", () => watch.disconnect(), { once: true });
  document.addEventListener("click", (e) => { if (html.dataset.resume && e.target.closest?.("#land")) { window.starchartEndTap = true; dispatchEvent(new Event("starchart:endtap")); } }, true);
})();
