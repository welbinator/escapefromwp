// Preview storage helpers — create/read/delete preview records across D1 + R2.
// A "preview" is one D1 row (ec_previews) + its content JSON in R2 under
// previews/<id>/content.json (reuses the EXPORTS bucket, no new bucket).

function hex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// Persist a built site-model as a preview. Returns the new preview id.
export async function createPreview(env, { model, email, sourceUrl, inputMethod, totalEntries, ipHash, isSpam, spamReason }) {
  const id = hex(16);
  const contentKey = `previews/${id}/content.json`;
  await env.EXPORTS.put(contentKey, JSON.stringify(model), {
    httpMetadata: { contentType: "application/json" },
  });
  const b = model.brand || {};
  await env.DB.prepare(
    `INSERT INTO ec_previews
      (id, business_name, source_url, input_method, email, logo_key,
       brand_primary, brand_secondary, brand_text, content_key, total_entries,
       status, ip_hash, is_spam, spam_reason, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,'live',?,?,?,?)`
  ).bind(
    id, b.name || "", sourceUrl || "", inputMethod || "rest", email || "",
    b.logo_url || "", b.primary || "", b.secondary || "", b.text_on_primary || "",
    contentKey, totalEntries || 0, ipHash || "", isSpam ? 1 : 0, spamReason || "",
    new Date().toISOString()
  ).run();
  return id;
}

export async function getPreview(env, id) {
  if (!/^[0-9a-f]{32}$/.test(id || "")) return null;
  const row = await env.DB.prepare(`SELECT * FROM ec_previews WHERE id = ?`).bind(id).first();
  if (!row) return null;
  const obj = await env.EXPORTS.get(row.content_key);
  const model = obj ? await obj.json() : null;
  return { row, model };
}

// Count builds today for an email + ip (free-tier gate) and globally (spend cap).
export async function usageToday(env, { email, ipHash }) {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const byUser = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ec_previews WHERE created_at > ? AND (email = ? OR ip_hash = ?)`
  ).bind(since, email || "", ipHash || "").first();
  const global = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM ec_previews WHERE created_at > ?`
  ).bind(since).first();
  return { user: byUser?.n || 0, global: global?.n || 0 };
}

export async function markLiked(env, id, variant, { name, message } = {}) {
  await env.DB.prepare(
    `UPDATE ec_previews SET status='liked', liked_variant=?, lead_name=?, lead_message=?, liked_at=? WHERE id=?`
  ).bind(variant || "", name || "", message || "", new Date().toISOString(), id).run();
}

export async function markVariantDead(env, id) {
  // "Not for me" on the last live variant flips the whole preview to dead so the
  // cleanup cron reaps it early. (We don't track per-variant dead state yet.)
  await env.DB.prepare(`UPDATE ec_previews SET status='dead' WHERE id=? AND status='live'`).bind(id).run();
}
