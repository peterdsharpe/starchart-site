// W47 firstload (design/app-ui/SPEC.md §59): a first open's welcome card from the first frame, not after app/main.js's files
// (about 1.5 MB with MapLibre, 14 s on a slow phone network). A module of its own, before main.js in index.html, so it runs
// as soon as its few small files are in; main.js takes its promise (window.starchartWelcome) and shows it itself if this
// one never ran. Not in the demo, nor when a flight resumes (app/welcome.js, SPEC §49).
import { welcomeOnce } from "./welcome.js";
import { keptFlight, verdict } from "./resume.js";
import { onLingo, swapWords } from "./lingo-mode.js"; // W60 a

const sim = new URLSearchParams(location.search).get("sim") === "demo";
window.starchartWelcome = sim || verdict(keptFlight(localStorage)) === "resume" ? null : welcomeOnce(document.getElementById("welcome"));
swapWords(); onLingo(() => swapWords()); // W60 a: index.html's words in the Words setting's mode, from the first frame, and live
