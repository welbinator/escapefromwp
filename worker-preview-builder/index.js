// Queue consumer Worker — escapefromwp preview builder.
//
// Builds the two AI-free deliverables as background jobs (queue consumers get up
// to 15 min wall time, no client attached):
//   mode 'replica'    → captureReplica(): an exact self-contained copy of the site.
//   mode 'emdash-zip' → buildEmdashZip(): a runnable EmDash project + replica zip.
// The old AI 3-variant redesign path was removed (James's directive: 100% AI-free).

import { sendReplicaLinkEmail, sendZipEmail } from "../functions/api/_lib/send-email.js";
import { captureReplica } from "./replica-capture.js";
import { buildEmdashZip } from "./emdash-zip.js";
import { buildAstroZip } from "./astro-zip.js";

// Build the exact-replica mirror for one preview row.
async function buildReplica(env, id) {
  const row = await env.DB.prepare(`SELECT * FROM ec_previews WHERE id=?`).bind(id).first();
  if (!row) { console.log(`[${id}] replica: no row`); return; }
  if (row.status === "dead") { console.log(`[${id}] replica: dead`); return; }

  // Idempotent: skip if already built.
  if (await env.EXPORTS.head(`previews/${id}/replica.html`)) {
    console.log(`[${id}] replica already present`);
  } else {
    const t = Date.now();
    const out = await captureReplica(env, id, row.source_url);
    if (!out.ok || !out.html || out.html.length < 2000) {
      throw new Error(`replica capture failed: ${out.error || "short html"}`);
    }
    await env.EXPORTS.put(`previews/${id}/replica.html`, out.html, {
      httpMetadata: { contentType: "text/html; charset=utf-8" },
    });
    console.log(`[${id}] replica OK ${out.html.length}b, ${out.assets} assets, ${out.css_files} css, ${((Date.now() - t) / 1000).toFixed(0)}s`);
  }

  // Email the single replica link once.
  const marker = `previews/${id}/.emailed`;
  if (!(await env.EXPORTS.head(marker))) {
    try {
      const origin = env.SITE_ORIGIN || "https://escapefromwp.com";
      await sendReplicaLinkEmail(env, {
        to: row.email, siteName: row.business_name || "your site",
        url: `${origin}/replica/${id}`, sourceUrl: row.source_url,
      });
      await env.EXPORTS.put(marker, new Date().toISOString(), { httpMetadata: { contentType: "text/plain" } });
      console.log(`[${id}] replica emailed ${row.email}`);
    } catch (e) { console.log(`[${id}] replica email ERR ${String(e).slice(0, 160)}`); }
  }
}

// Build & email a ready-to-run project zip (the offer modal's "No" / "Generate zip"
// path). `target` picks the deliverable: 'emdash' → EmDash project, 'astro' → plain
// static Astro project. Reuses the content extractor + the already-captured replica
// HTML. Idempotent + target-scoped via per-target R2 markers so the two targets never
// clobber each other's token or email. The marker object BODY holds the download token
// (JSON) so /api/zip-status can hand the browser the right link per target.
async function buildZipJob(env, id, target, kind) {
  const t0 = target === "astro" ? "astro" : "emdash";
  const k0 = kind === "bot" ? "bot" : "scripts";
  const row = await env.DB.prepare(`SELECT * FROM ec_previews WHERE id=?`).bind(id).first();
  if (!row) { console.log(`[${id}] ${t0}-${k0}-zip: no row`); return; }

  // Marker is scoped by target AND kind so all four outputs (emdash/astro ×
  // scripts/bot) have independent tokens and never clobber each other.
  const doneMarker = `previews/${id}/.zip-${t0}-${k0}.json`;
  if (await env.EXPORTS.head(doneMarker)) { console.log(`[${id}] ${t0}-${k0}-zip already done`); return; }

  // Reuse the exact-replica HTML we already captured, if present (design source).
  let replicaHtml = "";
  try {
    const r = await env.EXPORTS.get(`previews/${id}/replica.html`);
    if (r) replicaHtml = await r.text();
  } catch (_) {}

  const t = Date.now();
  const builder = t0 === "astro" ? buildAstroZip : buildEmdashZip;
  const { zip, filename, siteName } = await builder(env, {
    id, sourceUrl: row.source_url, businessName: row.business_name, replicaHtml, kind: k0,
  });

  // Store the zip under a fresh download token (served by /api/download/<token>,
  // 24h R2 lifecycle).
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  const token = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  await env.EXPORTS.put(`exports/${token}.zip`, zip, {
    httpMetadata: { contentType: "application/zip", contentDisposition: `attachment; filename="${filename}"` },
  });
  const origin = env.SITE_ORIGIN || "https://escapefromwp.com";
  const downloadUrl = `${origin}/api/download/${token}`;
  console.log(`[${id}] ${t0}-${k0}-zip built ${zip.length}b in ${((Date.now() - t) / 1000).toFixed(0)}s`);

  await sendZipEmail(env, { to: row.email, siteName: siteName || row.business_name || "your site", downloadUrl, target: t0, kind: k0 });
  // Write the done-marker LAST, with the token in its body, so zip-status only hands
  // out a link once the zip object exists.
  await env.EXPORTS.put(doneMarker, JSON.stringify({ token, filename, target: t0, kind: k0, at: new Date().toISOString() }),
    { httpMetadata: { contentType: "application/json" } });
  console.log(`[${id}] ${t0}-${k0}-zip emailed ${row.email}`);
}

export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const id = msg.body && msg.body.id;
      const mode = (msg.body && msg.body.mode) || "replica";
      const kind = (msg.body && msg.body.kind) || "scripts";
      if (!id || !/^[0-9a-f]{32}$/.test(id)) { msg.ack(); continue; }
      try {
        if (mode === "emdash-zip") await buildZipJob(env, id, "emdash", kind);
        else if (mode === "astro-zip") await buildZipJob(env, id, "astro", kind);
        else await buildReplica(env, id);
        msg.ack();
      } catch (e) {
        // Cloudflare Queues expose how many times THIS message has been delivered.
        // On the final allowed attempt, stop retrying and record the failure so the
        // user isn't stranded on an eternal "building" page with no email. The
        // consumer's max_retries is 3, so attempts 1..4 are possible; treat >=4 as final.
        const attempt = msg.attempts || 1;
        const FINAL = 4;
        if (attempt >= FINAL) {
          console.log(`[${id}] batch FAILED permanently (${mode}) after ${attempt} attempts: ${String(e).slice(0, 160)}`);
          try { await markBuildFailed(env, id, mode, String(e).slice(0, 180)); } catch (_) {}
          msg.ack(); // give up cleanly instead of infinite redelivery
        } else {
          console.log(`[${id}] batch ERR (${mode}) attempt ${attempt}: ${String(e).slice(0, 160)} — retrying`);
          msg.retry();
        }
      }
    }
  },
};

// Record a permanent build failure: flip the row to 'failed' (so the /replica page
// shows an honest error instead of spinning forever) and drop a .failed marker in R2.
async function markBuildFailed(env, id, mode, errText) {
  try { await env.DB.prepare(`UPDATE ec_previews SET status='failed' WHERE id=? AND status!='dead'`).bind(id).run(); } catch (_) {}
  const marker = `previews/${id}/.failed`;
  try {
    if (await env.EXPORTS.head(marker)) return;
    await env.EXPORTS.put(marker, JSON.stringify({ mode, error: errText, at: new Date().toISOString() }), {
      httpMetadata: { contentType: "application/json" },
    });
  } catch (_) {}
}
