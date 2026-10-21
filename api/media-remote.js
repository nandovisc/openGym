/* Photos, GIFs and videos of a person's own exercises, kept in Supabase Storage (STORE=supabase).
 *
 * The same contract as createMediaStore() in media.js, which server.js calls through the same ten
 * methods (awaited, since these are network calls): the bytes sit in the private bucket
 * `opengym-media` at <uid>/<sha256>.<ext>, and the table opengym.media plays the part of the
 * folder listing and of .gc.json — which files a profile has, and since when each one has gone
 * unreferenced. Every check media.js makes is made here too, with its own helpers: the hash, the
 * magic bytes, the cap of the kind the bytes really are, the quota and the length of a video.
 *
 * What differs, and why:
 * - The upload is read into memory. A serverless function never receives a body over 4.5 MB in
 *   the first place, so the caps on such an instance stay below that (docs/VERCEL.md), and the
 *   app reads them from /api/config and refuses a larger file on the device.
 * - No free-disk floor (there is no disk), and no two-in-flight cap per profile: that counter
 *   would live in one instance's memory and say nothing about the others.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HASH_RE, MEDIA_TYPES, MediaError, mediaLimits, mp4Info, referencedHashes, sniffMedia } from './media.js';

const MB = 1024 * 1024;
const HOUR = 3600000;
const DAY = 24 * HOUR;
const EXT_MIME = Object.fromEntries(Object.entries(MEDIA_TYPES).map(([mime, t]) => [t.ext, mime]));
const round1 = n => Math.round(n * 10) / 10;
const contentType = req => String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
function contentLength(req) {
  const raw = req.headers?.['content-length'];
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}
const drain = req => { if (!req.readableEnded && !req.destroyed) { req.on('error', () => {}); req.resume(); } };

function readAll(req, max, maxMB) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, over = false;
    req.on('data', d => {
      if (over) return;
      size += d.length;
      if (size > max) { over = true; chunks.length = 0; reject(new MediaError(413, 'media-too-large', { maxMB })); return; }
      chunks.push(d);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', e => reject(Object.assign(e, { clientGone: true })));
  });
}

export function createRemoteMediaStore({ remote, bucket = 'opengym-media', limits, now = Date.now, readState = async () => null, log = console } = {}) {
  const L = { ...mediaLimits({}), ...(limits || {}) };
  const quotaBytes = L.quotaMB > 0 ? Math.round(L.quotaMB * MB) : 0;
  const capMB = kind => (kind === 'video' ? L.videoMB : kind === 'gif' ? L.gifMB : kind === 'doc' ? L.docMB : L.imageMB);
  const capOf = kind => Math.round(capMB(kind) * MB);
  const { rpc, storage } = remote;

  // The same sanitising as media.js: an id that sanitises to nothing would name the bucket root.
  function safe(uid) {
    const s = String(uid ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
    if (!s) throw new Error('media: a profile id is required');
    return s;
  }
  const objectPath = (id, hash, ext) => `${id}/${hash}.${ext}`;

  /** hash -> { ext, size, unref } of every file the profile has. */
  async function list(uid) {
    const rows = (await rpc('opengym_media_list', { p_uid: safe(uid) })) || [];
    return new Map(rows.map(r => [r.hash, { ext: r.ext, size: Number(r.size), unref: r.unref == null ? null : Number(r.unref) }]));
  }
  const usageOf = files => {
    let bytes = 0;
    for (const f of files.values()) bytes += f.size;
    return { bytes, count: files.size, quotaBytes };
  };
  async function stateOf(uid) {
    let S = null;
    try { S = await readState(uid); } catch { S = null; }
    return S && typeof S === 'object' && !Array.isArray(S) ? S : null;
  }
  // The grace clocks brought in line with `refs` (media.js reconcile): {hash: t | null} for every
  // file whose mark changes.
  function reconcile(files, refs, t) {
    const marks = {};
    for (const [h, f] of files) {
      if (refs.has(h)) { if (f.unref != null) { marks[h] = null; f.unref = null; } }
      else if (f.unref == null) { marks[h] = t; f.unref = t; }
    }
    return marks;
  }
  const saveMarks = (uid, marks) => Object.keys(marks).length
    ? rpc('opengym_media_marks', { p_uid: safe(uid), p_marks: marks })
    : null;

  async function noteState(uid, state) {
    const files = await list(uid);
    if (!files.size) return false;
    const marks = reconcile(files, referencedHashes(state), now());
    await saveMarks(uid, marks);
    return Object.keys(marks).length > 0;
  }

  async function sweep(uid, { graceMs = L.gcGraceDays * DAY } = {}) {
    const res = { removed: 0, freedBytes: 0, skipped: false };
    const files = await list(uid);
    if (!files.size) return res;
    const S = await stateOf(uid);
    if (!S) { res.skipped = true; return res; }   // never infer anything from a missing state
    const refs = referencedHashes(S);
    const t = now();
    const marks = reconcile(files, refs, t);
    const gone = [];
    for (const [h, f] of files) {
      if (refs.has(h)) continue;
      if (graceMs > 0 && !(t - f.unref >= graceMs)) continue;
      gone.push(h);
      delete marks[h];
      res.removed++;
      res.freedBytes += f.size;
    }
    if (gone.length) {
      const id = safe(uid);
      await storage.remove(bucket, gone.map(h => objectPath(id, h, files.get(h).ext)));
      await rpc('opengym_media_delete', { p_uid: id, p_hashes: gone });
    }
    await saveMarks(uid, marks);
    return res;
  }

  const existed = (hash, f) => ({ status: 200, body: { ok: true, hash, mime: EXT_MIME[f.ext], size: f.size, existed: true } });

  async function receive(uid, hash, req) {
    if (!HASH_RE.test(String(hash))) { drain(req); throw new MediaError(400, 'bad-request'); }
    try {
      const id = safe(uid);
      const declared = MEDIA_TYPES[contentType(req)];
      if (!declared) throw new MediaError(415, 'media-type');
      const cap = capOf(declared.kind);
      const len = contentLength(req);
      if (len != null && len > cap) throw new MediaError(413, 'media-too-large', { maxMB: capMB(declared.kind) });

      let files = await list(uid);
      const have = files.get(hash);
      if (have && (len == null || len === have.size)) {
        drain(req);
        // A device just vouched for it: a file on its way out starts its grace over.
        if (have.unref != null) await saveMarks(uid, { [hash]: now() });
        return existed(hash, have);
      }
      const need = len ?? cap;
      const used = () => usageOf(files).bytes - (files.get(hash)?.size || 0);
      if (quotaBytes && used() + need > quotaBytes) {
        try { await sweep(uid, { graceMs: HOUR }); } catch (err) { log.error('media: quota sweep failed for', id, err.message); }
        files = await list(uid);
        if (used() + need > quotaBytes) {
          throw new MediaError(413, 'media-quota', { usedMB: round1(usageOf(files).bytes / MB), quotaMB: L.quotaMB });
        }
      }

      const buf = await readAll(req, cap, capMB(declared.kind));
      if (crypto.createHash('sha256').update(buf).digest('hex') !== hash) throw new MediaError(400, 'hash-mismatch');
      const sn = sniffMedia(buf.subarray(0, 64));
      if (!sn || sn.category !== declared.category) throw new MediaError(415, 'media-type');
      if (buf.length > capOf(sn.kind)) throw new MediaError(413, 'media-too-large', { maxMB: capMB(sn.kind) });
      if (sn.ext === 'mp4' || sn.ext === 'mov') {
        // mp4Info reads by position from a file; /tmp is the one writable place on a function.
        const tmp = path.join(os.tmpdir(), 'opengym-' + crypto.randomBytes(12).toString('hex'));
        let info;
        try {
          fs.writeFileSync(tmp, buf);
          const fd = fs.openSync(tmp, 'r');
          try { info = mp4Info(fd, buf.length); } finally { fs.closeSync(fd); }
        } finally { try { fs.unlinkSync(tmp); } catch { /* never written */ } }
        if (!info) throw new MediaError(415, 'media-invalid');
        if (info.durationSec != null && info.durationSec > L.videoSec + 1) throw new MediaError(413, 'media-too-long', { maxSec: L.videoSec });
      }

      await storage.put(bucket, objectPath(id, hash, sn.ext), buf, sn.mime);
      if (have && have.ext !== sn.ext) {
        try { await storage.remove(bucket, [objectPath(id, hash, have.ext)]); } catch { /* gone */ }
      }
      // Unreferenced until the state push that names it arrives (media.js markIfUnreferenced).
      const S = await stateOf(uid);
      const unref = S && referencedHashes(S).has(hash) ? null : now();
      await rpc('opengym_media_put', { p_uid: id, p_hash: hash, p_ext: sn.ext, p_size: buf.length, p_unref: unref });
      return { status: 201, body: { ok: true, hash, mime: sn.mime, size: buf.length, existed: false } };
    } catch (err) {
      if (!err?.clientGone) drain(req);
      throw err;
    }
  }

  return {
    limits: L,
    remote: true,
    discard: drain,
    usage: async uid => usageOf(await list(uid)),
    has: async (uid, hash) => (await list(uid)).has(hash),
    /** { ext, mime, size, bytes } of a stored file, or null. A row whose object is gone is
     *  forgotten, so the device that has the file sends it again. */
    async file(uid, hash) {
      const f = (await list(uid)).get(hash);
      if (!f) return null;
      const id = safe(uid);
      const bytes = await storage.get(bucket, objectPath(id, hash, f.ext));
      if (!bytes || !bytes.length) {
        await rpc('opengym_media_delete', { p_uid: id, p_hashes: [hash] });
        return null;
      }
      return { ext: f.ext, mime: EXT_MIME[f.ext], size: bytes.length, bytes };
    },
    receive,
    async missing(uid, hashes) {
      const files = await list(uid);
      return { missing: [...new Set(hashes)].filter(h => !files.has(h)), usage: usageOf(files) };
    },
    noteState,
    sweep,
    async sweepAll({ uids = [], graceMs } = {}) {
      const known = new Set(uids.map(u => { try { return safe(u); } catch { return null; } }).filter(Boolean));
      const out = { swept: 0, removed: 0, freedBytes: 0, skipped: 0, orphans: 0, tmp: 0 };
      for (const id of (await rpc('opengym_media_users', {})) || []) {
        if (!known.has(id)) { out.orphans++; continue; }
        try {
          const r = await sweep(id, graceMs === undefined ? {} : { graceMs });
          if (r.skipped) out.skipped++; else out.swept++;
          out.removed += r.removed;
          out.freedBytes += r.freedBytes;
        } catch (err) { log.error('media: sweep failed for', id, err.message); }
      }
      return out;
    },
    /** Admin delete: every file of the profile. */
    async removeUser(uid) {
      const id = safe(uid);
      const files = await list(uid);
      if (!files.size) return;
      await storage.remove(bucket, [...files].map(([h, f]) => objectPath(id, h, f.ext)));
      await rpc('opengym_media_delete', { p_uid: id, p_hashes: [...files.keys()] });
    },
    cleanTmp: () => 0
  };
}
