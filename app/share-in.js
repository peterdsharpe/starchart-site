// W67 routefile (SPEC §94): what another app shared to Starchart. On installed Android Chrome, the manifest's share_target
// POSTs it to the service worker (app/sw.js takeShare), which keeps the files, title, text and url in a cache and opens
// ./?shared=1; this reads it once, takes it out of the cache and the address, and hands it to each onShare(fn) hook:
// app/course.js opens a route file; a link parser can plug in the same way. Nothing leaves the phone.
//
//   onShare(({ files, title, text, url }) => { ... });   // files: File[]
//   takeShared();                                         // at the start, once the chart is in

const CACHE = "starchart.share";
const hooks = [];
let last = null;

/** Call fn with each share; one already taken is handed to it at once. */
export function onShare(fn) {
  hooks.push(fn);
  if (last) fn(last);
}
/** The address says a share is waiting (?shared=1). */
export const shareWaiting = (loc = globalThis.location) => !!loc && new URLSearchParams(loc.search).has("shared");

/** Read the waiting share, once: the hooks get it; null when there is none. */
export async function takeShared(loc = globalThis.location, store = globalThis.caches) {
  if (!shareWaiting(loc)) return null;
  const q = new URLSearchParams(loc.search); q.delete("shared");
  history.replaceState(null, "", loc.pathname + (q.size ? `?${q}` : "") + loc.hash); // a reload doesn't open it again
  if (!store) return null;
  let got = null;
  try {
    const c = await store.open(CACHE), keys = await c.keys(), meta = keys.find((r) => r.url.endsWith("/shared/meta"));
    const m = meta && await (await c.match(meta)).json();
    if (m) {
      const files = await Promise.all(m.files.map(async (f, i) => { const k = keys.find((x) => x.url.endsWith(`/shared/${i}`)), r = k && await c.match(k); return r && new File([await r.blob()], f.name, { type: f.type }); }));
      got = { title: m.title || "", text: m.text || "", url: m.url || "", files: files.filter(Boolean) };
    }
    await store.delete(CACHE);
  } catch { /* storage off */ }
  if (!got) return null;
  last = got;
  for (const fn of hooks) { try { fn(got); } catch (e) { console.warn("share:", e.message); } }
  return got;
}
