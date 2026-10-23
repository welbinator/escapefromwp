// Cloudflare Pages Function — GET /api/zip-status?id=<previewId>&target=<emdash|astro>
// Polled by the liberate page after the user clicks "Generate zip".
// Returns { ok, ready, download_url?, filename? }:
//   - ready:false while the queued zip worker job is still building.
//   - ready:true + download_url once the worker has stored the zip + token.
// The worker writes a per-target done-marker `previews/<id>/.zip-<target>.json` whose
// BODY is { token, filename, target, at } — written LAST, after the zip object exists.
// Each target has its own marker/token so EmDash and static Astro never collide.

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").toLowerCase();
  const target = (url.searchParams.get("target") || "emdash") === "astro" ? "astro" : "emdash";
  const kind = (url.searchParams.get("kind") || "scripts") === "bot" ? "bot" : "scripts";
  if (!/^[0-9a-f]{32}$/.test(id)) return json({ ok: false, error: "bad id" }, 400);
  if (!env.DB || !env.EXPORTS) return json({ ok: false, error: "not configured" }, 500);

  const row = await env.DB.prepare(`SELECT business_name FROM ec_previews WHERE id=?`).bind(id).first();
  if (!row) return json({ ok: false, error: "not found" }, 404);

  const marker = await env.EXPORTS.get(`previews/${id}/.zip-${target}-${kind}.json`);
  if (marker) {
    let token = "", filename = "";
    try { const m = JSON.parse(await marker.text()); token = (m.token || "").toString(); filename = m.filename || ""; } catch (_) {}
    if (/^[a-f0-9]{32}$/.test(token)) {
      return json({ ok: true, ready: true, download_url: `${url.origin}/api/download/${token}`, filename });
    }
  }
  return json({ ok: true, ready: false });
}
