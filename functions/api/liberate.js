// Cloudflare Pages Function — POST /api/liberate
// Extracts a WordPress site's content via the REST API (RSS fallback), logs the
// request as a lead (D1 + Command Center), builds a target-specific migration
// bundle, and returns it as a downloadable .zip.

import { extractSite, normalizeSiteUrl } from "./_lib/wp-extract.js";
import { buildBundle } from "./_lib/build-bundle.js";

const TARGETS = new Set(["emdash", "generic"]);

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Log the liberation request to the shared Command Center as a lead.
async function notifyCommandCenter(env, { email, siteUrl, target, totalEntries }) {
  const secret = env.PUSH_NOTIFY_SECRET;
  if (!secret) return;
  const url = env.CC_NOTIFY_URL || "https://cc.crweb.design/api/push/notify";
  try {
    const ts = Math.floor(Date.now() / 1000);
    const message = `Content liberation: ${siteUrl} → ${target} (${totalEntries} entries extracted)`;
    const body = JSON.stringify({
      name: email, email, site: "escapefromwp.com", message, ts,
    });
    const sig = await hmacHex(secret, `v0:${ts}:${body}`);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CC-Signature": `t=${ts},v0=${sig}` },
      body,
    });
  } catch (_) { /* CC down — not fatal */ }
}

async function logLead(env, { email, siteUrl, target, totalEntries, method }) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO ec_liberation_leads (email, site_url, target, total_entries, method, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(email, siteUrl, target, totalEntries, method, new Date().toISOString()).run();
  } catch (_) { /* table may not exist yet / ignore to not block download */ }
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  const rawUrl = (data.url || "").toString().trim();
  const target = (data.target || "emdash").toString().trim().toLowerCase();
  const email = (data.email || "").toString().trim();
  const honeypot = (data.website_hp || "").toString().trim();

  if (honeypot) return json({ ok: false, error: "Blocked" }, 400);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ ok: false, error: "Please enter a valid email address." }, 400);
  if (!TARGETS.has(target)) return json({ ok: false, error: "Unsupported target CMS." }, 400);

  const base = normalizeSiteUrl(rawUrl);
  if (!base) return json({ ok: false, error: "Please enter a valid website URL." }, 400);

  // Extract (REST → RSS fallback).
  let extract;
  try {
    extract = await extractSite(base, { maxEntriesPerType: 500 });
  } catch (err) {
    return json({ ok: false, error: "Extraction failed: " + (err?.message || "unknown error") }, 502);
  }
  if (!extract.ok) {
    return json({ ok: false, error: extract.error || "Could not extract content from that site." }, 422);
  }

  const totalEntries = extract.collections.reduce((n, c) => n + c.entries.length, 0);

  // Fire-and-forget lead logging (never block the download).
  await Promise.allSettled([
    logLead(env, { email, siteUrl: base, target, totalEntries, method: extract.method }),
    notifyCommandCenter(env, { email, siteUrl: base, target, totalEntries }),
  ]);

  // Build the bundle.
  let bundle;
  try {
    bundle = buildBundle(extract, target);
  } catch (err) {
    return json({ ok: false, error: "Could not build the export bundle: " + (err?.message || "unknown") }, 500);
  }

  // Stats summary goes in a header the frontend can read + show.
  const summary = {
    site: extract.site?.name || base,
    method: extract.method,
    total_entries: totalEntries,
    collections: extract.collections.map((c) => ({ type: c.type, label: c.label, entries: c.entries.length })),
    notice: extract.notice || null,
  };

  return new Response(bundle.bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${bundle.filename}"`,
      "X-Liberation-Summary": encodeURIComponent(JSON.stringify(summary)),
      "Access-Control-Expose-Headers": "X-Liberation-Summary, Content-Disposition",
      "Cache-Control": "no-store",
    },
  });
}
