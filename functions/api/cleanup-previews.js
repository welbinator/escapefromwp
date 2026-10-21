// Cloudflare Pages Function — POST /api/cleanup-previews
// Deletes expired previews: status='live' older than 7 days → remove the D1 row
// AND its R2 content object. status='liked' is EXEMPT (those are live leads).
// Protected by a shared secret (header x-cleanup-key = env.CLEANUP_KEY) so only
// the scheduled Hermes cron can trigger it. Returns a count of what it reaped.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

const MAX_AGE_DAYS = 7;

async function reap(env) {
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 3600 * 1000).toISOString();
  // Only 'live' previews expire; 'liked' are leads (keep), 'dead' also cleaned.
  const { results } = await env.DB.prepare(
    `SELECT id, content_key FROM ec_previews
      WHERE status IN ('live','dead') AND created_at < ?
      LIMIT 500`
  ).bind(cutoff).all();

  let rows = 0, objects = 0;
  for (const r of results || []) {
    // Delete the legacy single content object if present.
    try { if (r.content_key) { await env.EXPORTS.delete(r.content_key); objects++; } } catch (_) {}
    // Sweep ALL R2 objects for this preview: content.json, variant HTML,
    // replica.html, markers (previews/<id>/*) AND rehosted replica assets
    // (replica-assets/<id>/*). Paginate each prefix until exhausted.
    for (const prefix of [`previews/${r.id}/`, `replica-assets/${r.id}/`]) {
      let cursor;
      do {
        const listing = await env.EXPORTS.list({ prefix, cursor, limit: 1000 });
        for (const obj of listing.objects || []) {
          try { await env.EXPORTS.delete(obj.key); objects++; } catch (_) {}
        }
        cursor = listing.truncated ? listing.cursor : undefined;
      } while (cursor);
    }
    await env.DB.prepare(`DELETE FROM ec_previews WHERE id = ?`).bind(r.id).run();
    rows++;
  }
  return { rows, objects, cutoff };
}

export async function onRequestPost({ request, env }) {
  if (!env.CLEANUP_KEY || request.headers.get("x-cleanup-key") !== env.CLEANUP_KEY)
    return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.DB || !env.EXPORTS) return json({ ok: false, error: "not configured" }, 500);
  const out = await reap(env);
  return json({ ok: true, ...out });
}

// Allow GET with the key as a query param too (simpler for cron curl), same guard.
export async function onRequestGet({ request, env }) {
  const key = new URL(request.url).searchParams.get("key");
  if (!env.CLEANUP_KEY || key !== env.CLEANUP_KEY) return json({ ok: false, error: "unauthorized" }, 401);
  if (!env.DB || !env.EXPORTS) return json({ ok: false, error: "not configured" }, 500);
  const out = await reap(env);
  return json({ ok: true, ...out });
}
