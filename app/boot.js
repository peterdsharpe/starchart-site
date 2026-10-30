// W47 firstload (design/app-ui/SPEC.md §59): the start's last resort. Each step of the start has its own retry or timeout
// (app/main.js), but app/main.js's own files come before any of them: when one fails to come in (the connection dropped
// mid-load), the module never runs, and the app sat half-loaded until a force close. Here the page loads again instead, once
// the phone is back online, after 2, 8 and then 30 s, at most three times in five minutes (this tab's sessionStorage).
// Deferred, so it never holds the first paint; it still runs before the module scripts, and their load errors come in that order.
(() => {
  // the start's hexes (app/hexload.css) are still in Calm from the first frame, as app/main.js's calmWanted says (W133 settings4: no Calm motion switch)
  let saver = false; // W113 settings2: Battery saver calms the motion too (app/settings.js calmFrom)
  try { saver = localStorage.getItem("starchart.smooth") === "30"; } catch { /* storage off */ }
  const calm = new URLSearchParams(location.search).get("calm") === "1" || saver; // W113 settings2: saver
  document.documentElement.classList.toggle("calm-start", calm);
  document.body.classList.toggle("calm", calm || matchMedia("(prefers-reduced-motion: reduce)").matches); // W76 look: the CSS's Calm (app/motion.css), as calmWanted, before the modules (the welcome)
  // W69 boot (SPEC §105): ?boot=hold keeps the start's hexes looping over the chart, for a review of their motion (tests only)
  document.documentElement.classList.toggle("boot-hold", new URLSearchParams(location.search).get("boot") === "hold");

  const KEY = "starchart:boot-tries";
  const NET = /fetch|network|import|load failed|timed out|timeout/i; // Chrome's, Safari's and Firefox's words for a lost request
  let armed = false;
  function again() {
    if (armed || window.starchart) return; // started: the app's own retries take it from here
    let tries = [];
    try { tries = (JSON.parse(sessionStorage.getItem(KEY)) || []).filter((t) => Date.now() - t < 300_000); } catch { /* none */ }
    if (tries.length >= 3) return;
    armed = true;
    const go = () => { try { sessionStorage.setItem(KEY, JSON.stringify([...tries, Date.now()])); } catch { /* full */ } location.reload(); };
    const soon = () => setTimeout(go, [2000, 8000, 30_000][tries.length]);
    if (navigator.onLine) soon(); else addEventListener("online", soon, { once: true });
  }
  // a module script that could not load (the error event at its element), or the start's own failure (an uncaught error)
  addEventListener("error", (e) => {
    if (e.target instanceof HTMLScriptElement) return again();
    if (NET.test(`${e.error?.name} ${e.error?.message ?? e.message}`)) again();
  }, true);
  addEventListener("unhandledrejection", (e) => { if (NET.test(`${e.reason?.name} ${e.reason?.message}`)) again(); });
})();
