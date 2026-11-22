// W35 welcome (design/app-ui/SPEC.md §49). arclight, 2026-10-17: "a first-time-only popup that explains what this is,
// where to read about SCUL (link to the lingo page), and a 'made with <3 by Arclight'".
//
// The card is index.html's <dialog id="welcome">. It is a first-time tip like the others (app/tips.js): "starchart.tip.welcome",
// marked seen as it shows, and Settings' "Show tips again" brings it back at the next open. main.js shows it first on a
// first open, never in the demo or in a flight that resumes, and the location prompt and the other tips wait for it.
// Modal, so its Start, its ×, Back and Escape close it (the browser's own close for Back and Escape).
// W150 welcome2 (SPEC §270): no SCUL offer and no install row; a row says Settings sets it up (Words is its first row), and
// the Starchart button in the column installs it (app/install.js).
import { seen, markSeen } from "./tips.js";

/** Show the welcome `dialog`, once ever. A promise that settles once it closes, or null if it has been seen. */
export function welcomeOnce(dialog) {
  if (!dialog || seen("welcome")) return null;
  markSeen("welcome");
  const closed = new Promise((done) => dialog.addEventListener("close", () => done(), { once: true }));
  dialog.showModal();
  dialog.focus(); // the card itself takes the first focus, so a phone shows no ring on Start before anything is touched; Tab still reaches Start and the × (and in SCUL the lingo link)
  return closed;
}
