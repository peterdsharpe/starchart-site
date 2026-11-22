// W241 leftovers8 (design/app-ui/SPEC.md §504): where a route or a pin goes that comes without a tap on the map, decided in one place.
// A route's preview and a pin with its pop-up show on the map only, never over Settings (its pages too), the Log, a ride's page or
// the all-rides map. What she didn't ask for just now (the plan left open last time, the link or the share the app was opened by,
// a route or a pin made ready after she opened a page) waits for the map; a link that reaches the running app takes her to the map,
// as the Chart tab would. On a ride, and on the map (the welcome card over it too), it opens as it comes, as before.

/** The ways in, each `true` if she asked for it just now. */
export const WAYS = {
  plan: false, // the plan or the search left open last time, back at the start's end (app/main.js takeParked)
  opened: false, // the #course= or #pin= link the app was opened by, at the start's end, or one kept from a visit that left it held
  share: false, // what another app shared to the app (app/share-in.js), read at the start's end
  link: true, // a #course= or #pin= link that reached the running app (app/main.js's hashchange)
  ready: false, // a route or a pin made ready after its way in (a link's roads, a route file's match: app/course.js), a page she opened meanwhile hers
};

/** "now": open it now; "held": hold it, to open the first time the map shows; "map": shut the page as the Chart tab would, then
 *  open it. `flight`: the flight's state; `tab`: app/screen.js tab(), "chart" with the welcome card over the map too. */
export function arrive(way, { flight, tab }) {
  if (!(way in WAYS)) throw new Error(`arrive: no way in "${way}"`);
  if (flight !== "parked" || tab === "chart") return "now";
  return WAYS[way] ? "map" : "held";
}
