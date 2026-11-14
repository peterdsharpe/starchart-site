// W226 cardfirst (design/app-ui/SPEC.md §474): the walker's timetable for a station's or stop's card, in a worker of its own (app/walk.js
// stops()), so a card's times never wait for the routing graph (10.5 MB, which the routing worker loads first) and the file can be read ahead
// off the page. The stored file is unzipped here; the planner's copy stays the routing worker's (chart/routing/worker.js).
//   w.postMessage({ type: "walktable", id, blob })   -> { type: "walktable", id, feed }   the stored file, gzipped (or `buffer`, unzipped)
//   w.postMessage({ type: "stoptimes", id, lonlat, name, at, ref, station }) -> { type: "stoptimes", id, result } (walktransit.js stopTimes())
// An error answers { type: "error", id, message }.
import { readTimetable } from "../chart/routing/transit.js";
import { stopTimes } from "../chart/routing/walktransit.js";

let walktable = null;
self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "walktable") {
      walktable = readTimetable(m.buffer || (await new Response(m.blob.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()));
      self.postMessage({ type: "walktable", id: m.id, feed: walktable.feed });
    } else if (m.type === "stoptimes") {
      if (!walktable) throw new Error("no walk timetable loaded");
      self.postMessage({ type: "stoptimes", id: m.id, result: stopTimes(walktable, m.lonlat, m.name, m.at, { ref: m.ref, station: m.station }) });
    }
  } catch (err) { self.postMessage({ type: "error", id: m.id, message: String(err.message || err) }); }
};
