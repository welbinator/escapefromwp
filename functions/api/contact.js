// Cloudflare Pages Function — POST /api/contact
// Stores lead in D1 (ec_contact_submissions), scores spam, pushes to Command Center.
const JSON_HEADERS = { "Content-Type": "application/json" };

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

// --- spam heuristics (mirror of Apex/MC scoreSpam) ---
function scoreSpam({ name, email, site, message }) {
  const text = `${site || ""} ${message || ""}`;
  const urlCount = (text.match(/https?:\/\/|www\./gi) || []).length;
  const reasons = [];
  if (urlCount >= 3) reasons.push("too many links");
  if (/\b(viagra|casino|crypto|loan|seo services|backlink|betting|porn|escort)\b/i.test(text))
    reasons.push("spam keywords");
  if (/\[url=|\[link=|<a\s+href=/i.test(text)) reasons.push("markup in message");
  if (name && /[^\u0000-\u024F\s'.-]/.test(name)) reasons.push("non-latin name");
  if (name && email && name.trim().toLowerCase() === email.trim().toLowerCase())
    reasons.push("name equals email");
  return reasons.length ? reasons.join("; ") : null;
}

// --- Command Center push (HMAC) ---
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
      name: lead.name, email: lead.email, site: "escapefromwp.com", message: lead.message, ts,
    });
    const sig = await hmacHex(secret, `v0:${ts}:${body}`);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CC-Signature": `t=${ts},v0=${sig}` },
      body,
    });
  } catch (_) { /* CC down — row already saved; ignore */ }
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  const name = (data.name || "").toString().trim();
  const email = (data.email || "").toString().trim();
  const site = (data.site || "").toString().trim();
  const message = (data.message || "").toString().trim();
  const honeypot = (data.website_hp || "").toString().trim();

  if (!name || !email) return json({ ok: false, error: "Name and email are required" }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return json({ ok: false, error: "Please enter a valid email" }, 400);

  let isSpam = 0;
  let spamReason = null;
  if (honeypot) { isSpam = 1; spamReason = "honeypot"; }
  else {
    const reason = scoreSpam({ name, email, site, message });
    if (reason) { isSpam = 1; spamReason = reason; }
  }

  try {
    await env.DB.prepare(
      `INSERT INTO ec_contact_submissions (name, email, site, message, is_spam, spam_reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(name, email, site, message, isSpam, spamReason, new Date().toISOString()).run();
  } catch (err) {
    return json({ ok: false, error: "Could not save your request" }, 500);
  }

  if (!isSpam) {
    try { await notifyCommandCenter(env, { name, email, message }); }
    catch (_) { /* never block the submission */ }
  }

  return json({ ok: true });
}
