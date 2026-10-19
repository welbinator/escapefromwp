// Cloudflare Pages Function — POST /api/submit-escapee
// Accepts multipart/form-data (business name, website, rescued URL, story, optional thumbnail).
// Stores thumbnail in R2 + row in D1 (status 'pending'), scores spam, notifies Command Center.
const JSON_HEADERS = { "Content-Type": "application/json" };
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

function scoreSpam({ business_name, website_url, rescued_url, story }) {
  const text = `${website_url || ""} ${rescued_url || ""} ${story || ""}`;
  const urlCount = (text.match(/https?:\/\/|www\./gi) || []).length;
  const reasons = [];
  if (urlCount >= 6) reasons.push("too many links");
  if (/\b(viagra|casino|crypto|loan|seo services|backlink|betting|porn|escort)\b/i.test(text))
    reasons.push("spam keywords");
  if (/\[url=|\[link=|<a\s+href=/i.test(text)) reasons.push("markup in story");
  if (business_name && /[^\u0000-\u024F\s'.&,-]/.test(business_name)) reasons.push("non-latin name");
  return reasons.length ? reasons.join("; ") : null;
}

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
      name: lead.business_name,
      email: "",
      site: "escapefromwp.com",
      message: `New escapee submission: ${lead.business_name} (${lead.website_url}) — pending review`,
      ts,
    });
    const sig = await hmacHex(secret, `v0:${ts}:${body}`);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CC-Signature": `t=${ts},v0=${sig}` },
      body,
    });
  } catch (_) { /* CC down — row already saved; ignore */ }
}

function normUrl(u) {
  u = (u || "").toString().trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

export async function onRequestPost({ request, env }) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid request" }, 400);
  }

  const business_name = (form.get("business_name") || "").toString().trim();
  const website_url = normUrl(form.get("website_url"));
  const rescued_url = normUrl(form.get("rescued_url"));
  const story = (form.get("story") || "").toString().trim();
  const case_study_url = normUrl(form.get("case_study_url"));
  const honeypot = (form.get("website_hp") || "").toString().trim();
  const thumb = form.get("thumbnail");

  if (!business_name || !website_url) {
    return json({ ok: false, error: "Business name and your website link are required" }, 400);
  }
  if (!/^https?:\/\/[^\s.]+\.[^\s]+$/.test(website_url)) {
    return json({ ok: false, error: "Please enter a valid website link" }, 400);
  }

  let isSpam = 0, spamReason = null;
  if (honeypot) { isSpam = 1; spamReason = "honeypot"; }
  else {
    const reason = scoreSpam({ business_name, website_url, rescued_url, story });
    if (reason) { isSpam = 1; spamReason = reason; }
  }

  // Thumbnail → R2 (optional)
  let thumbKey = null;
  if (thumb && typeof thumb === "object" && thumb.size > 0) {
    if (thumb.size > 5 * 1024 * 1024) {
      return json({ ok: false, error: "Thumbnail must be under 5 MB" }, 400);
    }
    const type = thumb.type || "";
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(type)) {
      return json({ ok: false, error: "Thumbnail must be a PNG, JPG, WEBP, or GIF image" }, 400);
    }
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp"
      : type.includes("gif") ? "gif" : "jpg";
    thumbKey = `thumbs/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
    try {
      await env.THUMBS.put(thumbKey, thumb.stream(), {
        httpMetadata: { contentType: type },
      });
    } catch (_) {
      thumbKey = null; // upload failed — fall back to OG image at approval
    }
  }

  try {
    await env.DB.prepare(
      `INSERT INTO ec_escapee_submissions
        (business_name, website_url, rescued_url, story, case_study_url, thumb_key, status, is_spam, spam_reason, form_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, 'escapee', ?)`
    ).bind(business_name, website_url, rescued_url, story, case_study_url, thumbKey, isSpam, spamReason, new Date().toISOString()).run();
  } catch (err) {
    return json({ ok: false, error: "Could not save your submission" }, 500);
  }

  if (!isSpam) {
    try { await notifyCommandCenter(env, { business_name, website_url }); }
    catch (_) { /* never block the submission */ }
  }

  return json({ ok: true });
}
