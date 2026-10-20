// Cloudflare Pages Function — POST /api/generate-preview
// Builds 3 template previews from a WordPress site (or WXR, later), stores one
// D1 row + content JSON in R2, and emails the visitor 3 standalone preview links.
// Gated: Turnstile + email + 1 free build per email/IP/day + global daily cap.
// Zero AI — hero copy is heuristic/hardcoded (James's cost directive).

import { extractSite, normalizeSiteUrl } from "./_lib/wp-extract.js";
import { findLogo, extractBrandColors } from "./_lib/brand-grab.js";
import { buildSiteModel } from "./_lib/site-model.js";
import { TEMPLATE_KEYS, TEMPLATES } from "./_lib/templates/index.js";
import { createPreview, usageToday, sha256Hex } from "./_lib/preview-store.js";
import { sendPreviewLinksEmail } from "./_lib/send-email.js";

// Free builds per email/IP per rolling 24h, and a global daily ceiling (abuse
// + cost guard — even though AI is off, extraction/storage isn't free).
const PER_USER_DAILY = 2;
const GLOBAL_DAILY = 200;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function verifyTurnstile(env, token, ip) {
  // If no secret configured, skip (lets local/dev work); in prod the secret is set.
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const body = new FormData();
    body.append("secret", env.TURNSTILE_SECRET);
    body.append("response", token);
    if (ip) body.append("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const out = await r.json();
    return !!out.success;
  } catch { return false; }
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function notifyCommandCenter(env, { email, siteUrl, totalEntries }) {
  const secret = env.PUSH_NOTIFY_SECRET;
  if (!secret) return;
  const url = env.CC_NOTIFY_URL || "https://cc.crweb.design/api/push/notify";
  try {
    const ts = Math.floor(Date.now() / 1000);
    const message = `Preview built: ${siteUrl} (${totalEntries} entries) — 3 templates emailed`;
    const body = JSON.stringify({ name: email, email, site: "escapefromwp.com", message, ts });
    const sig = await hmacHex(secret, `v0:${ts}:${body}`);
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-CC-Signature": `t=${ts},v0=${sig}` }, body });
  } catch (_) { /* non-fatal */ }
}

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: "Invalid request" }, 400); }

  const rawUrl = (data.url || "").toString().trim();
  const email = (data.email || "").toString().trim();
  const honeypot = (data.website_hp || "").toString().trim();
  const tsToken = (data.turnstile_token || data["cf-turnstile-response"] || "").toString();
  const ip = request.headers.get("CF-Connecting-IP") || "";

  if (honeypot) return json({ ok: false, error: "Blocked" }, 400);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ ok: false, error: "Please enter a valid email address." }, 400);

  if (!(await verifyTurnstile(env, tsToken, ip)))
    return json({ ok: false, error: "Please complete the verification challenge." }, 400);

  const base = normalizeSiteUrl(rawUrl);
  if (!base) return json({ ok: false, error: "Please enter a valid website URL." }, 400);

  // Rate / spend gate.
  const ipHash = ip ? await sha256Hex(ip + (env.IP_SALT || "efw")) : "";
  if (env.DB) {
    const use = await usageToday(env, { email, ipHash });
    if (use.global >= GLOBAL_DAILY)
      return json({ ok: false, error: "We're at today's preview limit — please try again tomorrow." }, 429);
    if (use.user >= PER_USER_DAILY)
      return json({ ok: false, error: `You've reached today's free preview limit (${PER_USER_DAILY}). Try again tomorrow, or reply to the email to talk.` }, 429);
  }

  // Extract content.
  let extract;
  try { extract = await extractSite(base, { maxEntriesPerType: 300 }); }
  catch (err) { return json({ ok: false, error: "Extraction failed: " + (err?.message || "unknown") }, 502); }
  if (!extract.ok) return json({ ok: false, error: extract.error || "Could not read content from that site." }, 422);

  const totalEntries = extract.collections.reduce((n, c) => n + c.entries.length, 0);

  // Grab brand kit from the homepage HTML (best-effort; never fatal).
  let brand = { business_name: extract.site?.name, logo_url: null };
  try {
    const home = await (await fetch(base, { headers: { "user-agent": "Mozilla/5.0 (EscapeFromWP preview bot)" } })).text();
    const logo = findLogo(home, base);
    brand = { business_name: extract.site?.name, logo_url: logo?.url || null, ...extractBrandColors(home) };
  } catch (_) { /* wordmark fallback */ }

  // Build the normalized site model (zero AI).
  let model;
  try { model = buildSiteModel(extract, brand); }
  catch (err) { return json({ ok: false, error: "Could not build the preview: " + (err?.message || "unknown") }, 500); }

  if (!env.EXPORTS || !env.DB) return json({ ok: false, error: "Preview storage is not configured." }, 500);

  // Persist (one row + content.json in R2).
  let id;
  try {
    id = await createPreview(env, { model, email, sourceUrl: base, inputMethod: "rest", totalEntries, ipHash });
  } catch (err) {
    return json({ ok: false, error: "Could not save the preview: " + (err?.message || "unknown") }, 500);
  }

  const origin = new URL(request.url).origin;
  const variants = TEMPLATE_KEYS.map((key) => ({
    key, label: TEMPLATES[key].label, blurb: TEMPLATES[key].blurb,
    url: `${origin}/preview/${id}/${key}`,
  }));

  // Email the 3 links + notify Command Center (non-blocking failures).
  const [, emailResult] = await Promise.all([
    notifyCommandCenter(env, { email, siteUrl: base, totalEntries }),
    sendPreviewLinksEmail(env, { to: email, siteName: model.brand.name, variants, totalEntries }),
  ]);

  return json({
    ok: true,
    preview_id: id,
    variants,
    emailed: !!(emailResult && emailResult.ok),
    email,
    summary: { site: model.brand.name, total_entries: totalEntries, method: extract.method },
  });
}
