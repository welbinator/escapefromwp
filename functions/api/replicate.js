// Cloudflare Pages Function — POST /api/replicate
// Exact-replica mode: make a faithful, self-contained mirror of a live site
// (no redesign, no options). Creates a D1 row, enqueues a background capture
// job (mode:'replica') to the escapefromwp-preview-builder worker, and returns
// the replica link. The worker renders the site in headless Chrome, rehosts
// every asset to R2, and emails the link when ready.

import { normalizeSiteUrl } from "./_lib/wp-extract.js";
import { sha256Hex } from "./_lib/preview-store.js";

const PER_USER_DAILY = 3;
const GLOBAL_DAILY = 150;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function hex(n) {
  const b = new Uint8Array(n); crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) return true;
  if (!token) return false;
  try {
    const body = new FormData();
    body.append("secret", env.TURNSTILE_SECRET);
    body.append("response", token);
    if (ip) body.append("remoteip", ip);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    return !!(await r.json()).success;
  } catch { return false; }
}

async function usageToday(env, email, ipHash) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const u = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ec_previews WHERE created_at > ? AND (email = ? OR ip_hash = ?)`)
    .bind(since, email || "", ipHash || "").first();
  const g = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ec_previews WHERE created_at > ?`).bind(since).first();
  return { user: u?.n || 0, global: g?.n || 0 };
}

// --- Command Center push (HMAC) — mirrors functions/api/contact.js ---
async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function notifyCommandCenter(env, lead) {
  const secret = env.PUSH_NOTIFY_SECRET;
  if (!secret) return;
  const url = env.CC_NOTIFY_URL || "https://cc.crweb.design/api/push/notify";
  try {
    const ts = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
      name: lead.name || "", email: lead.email, site: "escapefromwp.com",
      message: lead.message || "", website: lead.website || "",
      tags: lead.tags || [], ts,
    });
    const sig = await hmacHex(secret, `v0:${ts}:${body}`);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CC-Signature": `t=${ts},v0=${sig}` },
      body,
    });
  } catch (_) { /* CC down — never block the build */ }
}

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false, error: "Invalid request" }, 400); }

  const rawUrl = (data.url || "").toString().trim();
  const email = (data.email || "").toString().trim();
  const honeypot = (data.website_hp || "").toString().trim();
  const tsToken = (data.turnstile_token || data["cf-turnstile-response"] || "").toString();
  const optin = data.optin === undefined ? true : !!data.optin;
  const ip = request.headers.get("CF-Connecting-IP") || "";

  if (honeypot) return json({ ok: false, error: "Blocked" }, 400);
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ ok: false, error: "Please enter a valid email address." }, 400);
  if (!(await verifyTurnstile(env, tsToken, ip)))
    return json({ ok: false, error: "Please complete the verification challenge." }, 400);

  const base = normalizeSiteUrl(rawUrl);
  if (!base) return json({ ok: false, error: "Please enter a valid website URL." }, 400);

  if (!env.DB || !env.EXPORTS) return json({ ok: false, error: "Storage is not configured." }, 500);

  const ipHash = ip ? await sha256Hex(ip + (env.IP_SALT || "efw")) : "";
  const allowlist = (env.ALLOWLIST_IPS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const bypass = env.LIMITS_OFF === "on" || (ip && allowlist.includes(ip));
  if (!bypass) {
    const use = await usageToday(env, email, ipHash);
    if (use.global >= GLOBAL_DAILY) return json({ ok: false, error: "We're at today's limit — try again tomorrow." }, 429);
    if (use.user >= PER_USER_DAILY) return json({ ok: false, error: `You've reached today's free limit (${PER_USER_DAILY}).` }, 429);
  }

  // Quick reachability check so we fail fast on dead/wrong URLs before queueing.
  let siteName = base.replace(/^https?:\/\//, "").replace(/\/$/, "");
  try {
    const home = await fetch(base, { headers: { "user-agent": "Mozilla/5.0 (EscapeFromWP)" }, redirect: "follow" });
    if (!home.ok && home.status >= 400) return json({ ok: false, error: `That site returned HTTP ${home.status}.` }, 422);
    const htmlText = await home.text();
    const m = htmlText.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (m) siteName = m[1].trim().slice(0, 120);
  } catch (_) {
    return json({ ok: false, error: "Could not reach that site." }, 422);
  }

  // Create a lightweight preview row (no content model needed for replica mode).
  const id = hex(16);
  try {
    await env.DB.prepare(
      `INSERT INTO ec_previews (id, business_name, source_url, input_method, email, content_key, total_entries, status, ip_hash, is_spam, spam_reason, created_at)
       VALUES (?,?,?,?,?,?,?, 'live', ?,0,'', ?)`
    ).bind(id, siteName, base, "replica", email, "", 0, ipHash, new Date().toISOString()).run();
  } catch (err) {
    return json({ ok: false, error: "Could not save: " + (err?.message || "unknown") }, 500);
  }

  let queued = false;
  try {
    if (env.PREVIEW_QUEUE) { await env.PREVIEW_QUEUE.send({ id, mode: "replica", url: base }); queued = true; }
  } catch (_) {}
  if (!queued) return json({ ok: false, error: "Build queue unavailable — please try again shortly." }, 503);

  // Opt-in → file the lead in the Command Center CRM, tagged "escape".
  // Their pasted WordPress URL becomes the contact's website. Never block the build.
  if (optin) {
    try {
      await notifyCommandCenter(env, {
        email, website: base, tags: ["escape"],
        message: `Opted in via /liberate. Site to rescue: ${base}`,
      });
    } catch (_) {}
  }

  const origin = new URL(request.url).origin;
  return json({
    ok: true, preview_id: id, queued, email,
    url: `${origin}/replica/${id}`,
    site: siteName,
  });
}
