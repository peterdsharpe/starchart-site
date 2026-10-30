// Download the tiles into the Origin Private File System, then check their SHA-256 (app/offline.js
// starts this worker). The file is named by its hash, so a download cut off halfway leaves the old
// file untouched and resumes from where it stopped with an HTTP Range request. Only a file whose
// hash matches is recorded in tiles/state.json, which is what the app reads at launch.

const post = (m) => self.postMessage(m);
// W74 integrity: the storage is full. A sync handle's write at the quota comes back short without throwing (Chromium), or throws
// QuotaExceededError; either way the download stops at once, keeps what's written for a resume by Range, and says why.
const FULL = "the storage is full";
const isFull = (err) => err?.message === FULL || err?.name === "QuotaExceededError";

self.onmessage = async ({ data: { url, sha256, bytes, path, name = `${sha256}.pmtiles`, state: stateName = "state.json", head = null, upto = false, dir: folders = ["tiles"] } }) => { // W17 course: name, state; W76 privacy: head, upto; W81 packstore: dir
  let access = null, opened = false; // W163 iosdownload (SPEC §290): OPFS that won't open (Safari Private Browsing's throws UnknownError)
  try {
    let dir = await navigator.storage.getDirectory(); // W81 packstore: a map pack's files go in packs/<id>/ (app/packs.js), the chart's in tiles/
    for (const n of folders) dir = await dir.getDirectoryHandle(n, { create: true }); // W81 packstore
    opened = true; // W163 iosdownload
    const fh = await dir.getFileHandle(name, { create: true });
    access = await fh.createSyncAccessHandle();
    let have = access.getSize();
    if (have > bytes) { access.truncate(0); have = 0; }
    if (head) { // W76 privacy: the chart's prefix, read and checked by the page (app/offline.js openPrefix), kept as the file's start
      if (access.write(head, { at: 0 }) !== head.byteLength) throw new Error(FULL);
      access.flush();
      have = Math.max(have, head.byteLength);
      if (upto) { post({ type: "prefix", loaded: have, total: bytes }); return; } // the rest waits for store(), as the guard says
    }
    if (have < bytes) {
      const res = await fetch(url, { cache: "no-store", headers: have ? { Range: `bytes=${have}-` } : {} });
      if (res.status === 200 && have) { access.truncate(0); have = 0; } // the server ignored the Range: start again
      else if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      let at = have, lastPost = 0;
      post({ type: "progress", loaded: at, total: bytes });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (access.write(value, { at }) !== value.byteLength) { reader.cancel().catch(() => {}); throw new Error(FULL); } // W74 integrity
        at += value.byteLength;
        if (at - lastPost > bytes / 100) { lastPost = at; post({ type: "progress", loaded: at, total: bytes }); }
      }
      access.flush();
      if (at !== bytes) throw new Error(`cut off at ${at} of ${bytes} bytes`);
    }
    post({ type: "verifying", loaded: bytes, total: bytes });
    const buf = new Uint8Array(bytes);
    access.read(buf, { at: 0 });
    const hex = [...new Uint8Array(await crypto.subtle.digest("SHA-256", buf))].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== sha256) { access.truncate(0); throw new Error("the downloaded file does not match data/manifest.json"); }
    access.close();
    access = null;
    const state = await dir.getFileHandle(stateName, { create: true });
    const sa = await state.createSyncAccessHandle();
    const json = new TextEncoder().encode(JSON.stringify({ sha256, bytes, path, verified_at: new Date().toISOString() }));
    sa.truncate(0);
    if (sa.write(json, { at: 0 }) !== json.byteLength) throw new Error(FULL); // W74 integrity
    sa.flush();
    sa.close();
    post({ type: "done", sha256 });
  } catch (err) {
    post({ type: "error", message: String(err && err.message || err), full: isFull(err), nostore: !opened && !isFull(err) }); // W74 integrity: full; W163 iosdownload: nostore, it never will in this tab
  } finally {
    if (access) { try { access.flush(); access.close(); } catch { /* already closed */ } }
  }
};
