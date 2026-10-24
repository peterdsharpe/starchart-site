// W35 welcome (design/app-ui/SPEC.md §49). arclight, 2026-10-17: "a first-time-only popup that explains what this is,
// where to read about SCUL (link to the lingo page), and a 'made with <3 by Arclight'".
//
// The card is index.html's <dialog id="welcome">. It is a first-time tip like the others (app/tips.js): "starchart.tip.welcome",
// marked seen as it shows, and Settings' "Show tips again" brings it back at the next open. main.js shows it first on a
// first open, never in the demo or in a flight that resumes, and the location prompt and the other tips wait for it.
// Modal, so its Start, its ×, Back and Escape close it (the browser's own close for Back and Escape).
import { seen, markSeen } from "./tips.js";
import { lingo, setLingo } from "./lingo-mode.js"; // W60 a

/** Show the welcome `dialog`, once ever. A promise that settles once it closes, or null if it has been seen. */
export function welcomeOnce(dialog) {
  if (!dialog || seen("welcome")) return null;
  markSeen("welcome");
  const words = dialog.querySelector("#welcome-lingo"); // W60 a: Words, SCUL or Plain; Start keeps what is picked (SCUL unless a button says otherwise)
  const show = () => { for (const b of words?.querySelectorAll("button") ?? []) b.setAttribute("aria-checked", String(b.dataset.v === lingo())); }; // W60 a
  words?.addEventListener("click", (e) => { const v = e.target.closest("button")?.dataset.v; if (v) { setLingo(v); show(); } }); // W60 a
  show(); // W60 a
  const closed = new Promise((done) => dialog.addEventListener("close", () => done(), { once: true }));
  dialog.showModal();
  dialog.focus(); // the card itself takes the first focus, so a phone shows no ring on Start before anything is touched; Tab still reaches the link, Start and the ×
  return closed;
}
