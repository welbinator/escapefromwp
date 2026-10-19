// Cloudflare Pages Function — POST /api/liberate
// Extracts a WordPress site's content, stores the bundle in R2 under a random
// token (auto-deleted after 24h by the bucket lifecycle rule), emails a download
// link via Brevo, logs the lead (D1 + Command Center), and returns JSON with the
// download URL + an extraction summary. The frontend shows a download button and
// tells the user to check their email.

import { extractSite, normalizeSiteUrl } from "./_lib/wp-extract.js";
import { buildBundle } from "./_lib/build-bundle.js";
import { sendDownloadEmail } from "./_lib/send-email.js";

const TARGETS = new Set(["emdash", "generic"]);

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function notifyCommandCenter(env, { email, siteUrl, target, totalEntries }) {
  const secret = env.PUSH_NOTIFY_SECRET;
  if (!secret) return;
  const url = env.CC_NOTIFY_URL || "https://cc.crweb.design/api/push/notify";
  try {
    const ts = Math.floor(Date.now() / 1000);
    const message = `Content liberation: ${siteUrl} → ${target} (${totalEntries} entries extracted)`;
    const body = JSON.stringify({ name: email, email, site: "escapefromwp.com", message, ts });
    const sig = await hmacHex(secret, `v0:${ts}:${body}`);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CC-Signature": `t=${ts},v0=${sig}` },
      body,
    });
  } catch (_) { /* non-fatal */ }
}

async function logLead(env, { email, siteUrl, target, totalEntries, method, token }) {
  if (!env.DB) return;
  try {
    await env.DB.prepare(
      `INSERT INTO ec_liberation_leads (email, site_url, target, total_entries, method, download_token, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(email, siteUrl, target, totalEntries, method, token, new Date().toISOString()).run();
  } catch (_) { /* non-fatal */ }
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

  // Build the bundle.
  let bundle;
  try {
    bundle = buildBundle(extract, target);
  } catch (err) {
    return json({ ok: false, error: "Could not build the export bundle: " + (err?.message || "unknown") }, 500);
  }

  // Store it in R2 under a random token (auto-expires in 24h via lifecycle rule).
  const token = randomToken();
  if (!env.EXPORTS) {
    return json({ ok: false, error: "Export storage is not configured." }, 500);
  }
  try {
    await env.EXPORTS.put(`exports/${token}.zip`, bundle.bytes, {
      httpMetadata: {
        contentType: "application/zip",
        contentDisposition: `attachment; filename="${bundle.filename}"`,
      },
      customMetadata: { email, site: base, target, created: new Date().toISOString() },
    });
  } catch (err) {
    return json({ ok: false, error: "Could not store the export: " + (err?.message || "unknown") }, 500);
  }

  const origin = new URL(request.url).origin;
  const downloadUrl = `${origin}/api/download/${token}`;

  const summary = {
    site: extract.site?.name || base,
    method: extract.method,
    total_entries: totalEntries,
    collections: extract.collections.map((c) => ({ type: c.type, label: c.label, entries: c.entries.length })),
    notice: extract.notice || null,
  };

  // Lead logging + email (parallel, non-blocking failures).
  const [, , emailResult] = await Promise.all([
    logLead(env, { email, siteUrl: base, target, totalEntries, method: extract.method, token }),
    notifyCommandCenter(env, { email, siteUrl: base, target, totalEntries }),
    sendDownloadEmail(env, {
      to: email,
      siteName: summary.site,
      downloadUrl,
      target,
      totalEntries,
      collections: summary.collections,
      notice: summary.notice,
    }),
  ]);

  return json({
    ok: true,
    download_url: downloadUrl,
    filename: bundle.filename,
    emailed: !!(emailResult && emailResult.ok),
    email,
    expires_hours: 24,
    summary,
  });
}
