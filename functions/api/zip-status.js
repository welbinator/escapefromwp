// Cloudflare Pages Function — GET /api/zip-status?id=<previewId>
// Polled by the liberate page after the user clicks "Generate the full export".
// Returns { ok, ready, download_url?, filename? }:
//   - ready:false while the queued 'emdash-zip' worker job is still building.
//   - ready:true + download_url once the worker has stored the zip + token.
// The worker persists the download token on ec_previews.spam_reason and writes a
// `previews/<id>/.emdash-emailed` marker when the build+email completes.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  const id = (new URL(request.url).searchParams.get("id") || "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) return json({ ok: false, error: "bad id" }, 400);
  if (!env.DB || !env.EXPORTS) return json({ ok: false, error: "not configured" }, 500);

  const row = await env.DB.prepare(
    `SELECT business_name, spam_reason FROM ec_previews WHERE id=?`
  ).bind(id).first();
  if (!row) return json({ ok: false, error: "not found" }, 404);

  const token = (row.spam_reason || "").toString();
  const done = await env.EXPORTS.head(`previews/${id}/.emdash-emailed`);

  // Ready once the worker has both persisted a valid token AND written the done
  // marker (so we never hand out a URL before the zip object exists).
  if (done && /^[a-f0-9]{32}$/.test(token)) {
    const origin = new URL(request.url).origin;
    return json({ ok: true, ready: true, download_url: `${origin}/api/download/${token}` });
  }
  return json({ ok: true, ready: false });
}
