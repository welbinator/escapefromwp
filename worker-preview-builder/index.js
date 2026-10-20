// Queue consumer Worker — escapefromwp preview builder.
//
// WHY THIS EXISTS: previews used to generate lazily inside the /preview view
// request (a ~50s Claude call). Cloudflare kills a Worker request the moment
// the client disconnects, and the build page's <meta refresh="12"> reloaded
// every 12s — cancelling the in-flight generation every time. Infinite spinner.
//
// FIX: generation is now a background job. /api/generate-preview enqueues the
// preview id; this consumer builds all 3 variants (warm/bold/editorial) with no
// client attached (queue consumers get up to 15 min wall time), stores each to
// R2 previews/<id>/<variant>.html, and emails the links only once at least one
// design is ready. The view route just serves whatever HTML exists.

import { designVariant, DESIGN_KEYS, DESIGNS } from "../functions/api/_lib/ai-designer.js";
import { sendPreviewLinksEmail } from "../functions/api/_lib/send-email.js";

async function loadModel(env, id) {
  const row = await env.DB.prepare(`SELECT * FROM ec_previews WHERE id=?`).bind(id).first();
  if (!row) return { row: null, model: null };
  const obj = await env.EXPORTS.get(row.content_key || `previews/${id}/content.json`);
  const model = obj ? await obj.json() : null;
  return { row, model };
}

async function hasHtml(env, id, variant) {
  const obj = await env.EXPORTS.head(`previews/${id}/${variant}.html`);
  return !!obj;
}

async function storeHtml(env, id, variant, html) {
  await env.EXPORTS.put(`previews/${id}/${variant}.html`, html, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
  });
}

// Build all three variants for one preview. Idempotent: skips any variant whose
// HTML already exists (so a queue retry after a partial build is cheap and never
// regenerates finished work).
async function buildPreview(env, id) {
  const { row, model } = await loadModel(env, id);
  if (!row) { console.log(`[${id}] no row; dropping`); return; }
  if (row.status === "dead") { console.log(`[${id}] dead; skipping`); return; }
  if (!model) { console.log(`[${id}] no model; dropping`); return; }

  let built = 0;
  for (const key of DESIGN_KEYS) {
    try {
      if (await hasHtml(env, id, key)) { built++; continue; }
      const t = Date.now();
      const html = await designVariant(env, model, key);
      if (html && html.length > 2500) {
        await storeHtml(env, id, key, html);
        built++;
        console.log(`[${id}] ${key} OK ${html.length}b ${((Date.now() - t) / 1000).toFixed(0)}s`);
      } else {
        console.log(`[${id}] ${key} FAILED (null/short)`);
      }
    } catch (e) {
      console.log(`[${id}] ${key} ERR ${String(e).slice(0, 160)}`);
    }
  }

  if (built === 0) throw new Error(`no variants built for ${id}`); // let the queue retry

  // Email the links once (guard against duplicate emails on retry via a marker).
  const marker = `previews/${id}/.emailed`;
  if (!(await env.EXPORTS.head(marker))) {
    try {
      const origin = env.SITE_ORIGIN || "https://escapefromwp.com";
      const variants = DESIGN_KEYS.map((k) => ({
        key, label: DESIGNS[k].label, blurb: DESIGNS[k].blurb,
        url: `${origin}/preview/${id}/${k}`,
      }));
      await sendPreviewLinksEmail(env, {
        to: row.email, siteName: (model.brand && model.brand.name) || "your site",
        variants, totalEntries: row.total_entries || 0,
      });
      await env.EXPORTS.put(marker, new Date().toISOString(), { httpMetadata: { contentType: "text/plain" } });
      console.log(`[${id}] emailed ${row.email}`);
    } catch (e) {
      console.log(`[${id}] email ERR ${String(e).slice(0, 160)}`);
    }
  }
}

export default {
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const id = msg.body && msg.body.id;
      if (!id || !/^[0-9a-f]{32}$/.test(id)) { msg.ack(); continue; }
      try {
        await buildPreview(env, id);
        msg.ack();
      } catch (e) {
        console.log(`[${id}] batch ERR ${String(e).slice(0, 160)} — retrying`);
        msg.retry();
      }
    }
  },
};
