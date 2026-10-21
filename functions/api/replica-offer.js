// Cloudflare Pages Function — POST /api/replica-offer
// Handles the offer modal on a served replica (/replica/<id>):
//   choice:'yes' → record interest (flip to 'liked', exempt from cleanup),
//                  email James a lead alert + push to the Command Center.
//   choice:'no'  → enqueue a background 'emdash-zip' job: the worker extracts
//                  the site's content, builds a ready-to-run EmDash project
//                  (content + the exact-replica HTML + agent instructions),
//                  stores the zip in R2 and emails the customer the link.
// Email is NOT re-asked — it's already on the ec_previews row from the original form.

import { markLiked } from "./_lib/preview-store.js";
import { sendOfferLeadEmail } from "./_lib/send-email.js";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function notifyCC(env, { siteName, sourceUrl, replicaUrl, leadEmail, leadMessage }) {
  const secret = env.PUSH_NOTIFY_SECRET;
  if (!secret) return;
  const url = env.CC_NOTIFY_URL || "https://cc.crweb.design/api/push/notify";
  try {
    const ts = Math.floor(Date.now() / 1000);
    const message = `🔥 Site claim: ${siteName} wants the $49/mo build (no money down) — ${leadMessage || "(no message)"} | replica: ${replicaUrl}`;
    const body = JSON.stringify({ name: leadEmail, email: leadEmail, site: "escapefromwp.com", message, ts });
    const sig = await hmacHex(secret, `v0:${ts}:${body}`);
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-CC-Signature": `t=${ts},v0=${sig}` }, body });
  } catch (_) { /* non-fatal */ }
}

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: "Invalid request" }, 400); }

  const id = (data.id || "").toString().toLowerCase();
  const choice = (data.choice || "").toString();
  const message = (data.message || "").toString().trim().slice(0, 2000);
  if (!/^[0-9a-f]{32}$/.test(id)) return json({ ok: false, error: "bad id" }, 400);
  if (!env.DB) return json({ ok: false, error: "not configured" }, 500);

  const row = await env.DB.prepare(
    `SELECT business_name, source_url, email, status FROM ec_previews WHERE id=?`
  ).bind(id).first();
  if (!row) return json({ ok: false, error: "not found" }, 404);

  const siteName = row.business_name || row.source_url || "a site";
  const email = (row.email || "").toString();
  const origin = new URL(request.url).origin;
  const replicaUrl = `${origin}/replica/${id}`;

  // ---- YES: they want us to build & host it ---------------------------------
  if (choice === "yes") {
    try { await markLiked(env, id, "replica", { name: email, message }); } catch (_) {}
    await Promise.all([
      sendOfferLeadEmail(env, { siteName, sourceUrl: row.source_url, replicaUrl, leadEmail: email, leadMessage: message }),
      notifyCC(env, { siteName, sourceUrl: row.source_url, replicaUrl, leadEmail: email, leadMessage: message }),
    ]);
    return json({ ok: true, choice: "yes" });
  }

  // ---- NO: build & email them a ready-to-run EmDash project -----------------
  if (choice === "no") {
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return json({ ok: false, error: "We don't have a valid email on file — please email james@apexbranding.design." }, 400);
    let queued = false;
    try {
      if (env.PREVIEW_QUEUE) { await env.PREVIEW_QUEUE.send({ id, mode: "emdash-zip", url: row.source_url }); queued = true; }
    } catch (_) {}
    if (!queued) return json({ ok: false, error: "Export queue unavailable — please try again shortly." }, 503);
    return json({ ok: true, choice: "no", queued, email });
  }

  return json({ ok: false, error: "unknown choice" }, 400);
}
