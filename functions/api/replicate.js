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

// --- SSRF guard: a user pastes an arbitrary URL that we then point headless
// Chrome at, so we must make sure it resolves to a PUBLIC address and isn't an
// internal/metadata target. Mirrors liberate.sh's "public addresses, checked
// after DNS resolution" rule.
function ipIsPrivate(ip) {
  // IPv4
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10) return true;                         // 10.0.0.0/8
    if (a === 127) return true;                        // loopback
    if (a === 0) return true;                          // 0.0.0.0/8
    if (a === 169 && b === 254) return true;           // link-local / cloud metadata 169.254.169.254
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64.0.0/10
    if (a >= 224) return true;                         // multicast / reserved
    return false;
  }
  // IPv6
  const lo = ip.toLowerCase();
  if (lo === "::1" || lo === "::") return true;
  if (lo.startsWith("fe80") || lo.startsWith("fc") || lo.startsWith("fd")) return true; // link-local / ULA
  if (lo.startsWith("::ffff:")) return ipIsPrivate(lo.slice(7));                         // v4-mapped
  return false;
}

// Resolve the host via Cloudflare DNS-over-HTTPS and verify every answer is a
// public IP. Returns { ok:true } or { ok:false, error }. Fails closed.
async function assertPublicHost(hostname) {
  const host = (hostname || "").toLowerCase().replace(/\.$/, "");
  if (!host) return { ok: false, error: "Please enter a valid website URL." };
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".home.arpa")) {
    return { ok: false, error: "That address isn't a public website." };
  }
  // Bare IP literal pasted directly — check it without DNS.
  if (/^[0-9.]+$/.test(host) || host.includes(":")) {
    if (ipIsPrivate(host)) return { ok: false, error: "That address isn't a public website." };
    return { ok: true };
  }
  const doh = async (type) => {
    try {
      const r = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
        { headers: { accept: "application/dns-json" } });
      const j = await r.json();
      return (j.Answer || []).filter((a) => a.type === (type === "A" ? 1 : 28)).map((a) => a.data);
    } catch { return null; }
  };
  const [a4, a6] = await Promise.all([doh("A"), doh("AAAA")]);
  if (a4 === null && a6 === null) return { ok: false, error: "Could not reach that site." };
  const ips = [...(a4 || []), ...(a6 || [])];
  if (!ips.length) return { ok: false, error: "Could not resolve that website's address." };
  for (const ip of ips) if (ipIsPrivate(ip)) return { ok: false, error: "That address isn't a public website." };
  return { ok: true };
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
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ ok: false, error: "Please enter a valid email address." }, 400);
  if (!(await verifyTurnstile(env, tsToken, ip)))
    return json({ ok: false, error: "Please complete the verification challenge." }, 400);

  const base = normalizeSiteUrl(rawUrl);
  if (!base) return json({ ok: false, error: "Please enter a valid website URL." }, 400);

  // SSRF guard — resolve the host and reject private/internal/metadata targets
  // before we ever point headless Chrome (or our reachability fetch) at it.
  let hostname = "";
  try { hostname = new URL(base).hostname; } catch { return json({ ok: false, error: "Please enter a valid website URL." }, 400); }
  const pub = await assertPublicHost(hostname);
  if (!pub.ok) return json({ ok: false, error: pub.error }, 400);

  if (!env.DB || !env.EXPORTS) return json({ ok: false, error: "Storage is not configured." }, 500);

  const ipHash = ip ? await sha256Hex(ip + (env.IP_SALT || "efw")) : "";

  // In-flight dedupe — if this same email/IP already has a recent build running (or
  // done) for this exact URL, hand back that job instead of spawning another.
  // Blunts repeat-submit abuse and saves a duplicate headless-Chrome render.
  try {
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const dupe = email
      ? await env.DB.prepare(
          `SELECT id, business_name FROM ec_previews
           WHERE source_url = ? AND email = ? AND is_spam = 0 AND created_at > ?
           ORDER BY created_at DESC LIMIT 1`
        ).bind(base, email, recent).first()
      : (ipHash
          ? await env.DB.prepare(
              `SELECT id, business_name FROM ec_previews
               WHERE source_url = ? AND ip_hash = ? AND is_spam = 0 AND created_at > ?
               ORDER BY created_at DESC LIMIT 1`
            ).bind(base, ipHash, recent).first()
          : null);
    if (dupe && dupe.id) {
      const origin = new URL(request.url).origin;
      return json({
        ok: true, preview_id: dupe.id, queued: true, email: email || "", deduped: true,
        url: `${origin}/replica/${dupe.id}`, site: dupe.business_name || base,
      });
    }
  } catch (_) { /* dedupe is best-effort — never block a real build */ }

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
  if (optin && email) {
    try {
      await notifyCommandCenter(env, {
        email, website: base, tags: ["escape"],
        message: `Opted in via /liberate. Site to rescue: ${base}`,
      });
    } catch (_) {}
  }

  const origin = new URL(request.url).origin;
  return json({
    ok: true, preview_id: id, queued, email: email || "",
    url: `${origin}/replica/${id}`,
    site: siteName,
  });
}
