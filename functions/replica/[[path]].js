// GET /replica/<id> — serve the stored exact-replica mirror, or a self-refreshing
// "building" page while the background worker captures it.

function html(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function buildingPage() {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="15">
  <title>Rebuilding your site…</title>
  <style>body{font-family:system-ui,sans-serif;background:#0b0405;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}
  .spin{width:40px;height:40px;border:3px solid #2b2b2b;border-top-color:#4ee36b;border-radius:50%;animation:s .8s linear infinite;margin:0 auto 22px}
  @keyframes s{to{transform:rotate(360deg)}}h1{font-size:1.5rem;margin:0 0 10px}p{color:#bbb;max-width:44ch;line-height:1.6;margin:0 auto}
  @media(prefers-reduced-motion:reduce){.spin{animation-duration:2.5s}}</style></head>
  <body><div><div class="spin"></div><h1>Rebuilding your site off WordPress.</h1>
  <p>We're capturing every page, image and font and rehosting it on fast infrastructure. This usually takes a minute or two. This page refreshes itself — or check the email we're sending you.</p></div></body></html>`, 200);
}

function notFound() {
  return html(`<!doctype html><html><head><meta charset="utf-8"><title>Not found</title>
  <style>body{font-family:system-ui,sans-serif;background:#0b0405;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}a{color:#4ee36b}</style></head>
  <body><div><h1>Replica not found</h1><p style="color:#bbb">This may have expired — rebuilds are kept for 7 days.</p>
  <p><a href="https://escapefromwp.com/liberate">← Rebuild your site</a></p></div></body></html>`, 404);
}

export async function onRequestGet({ params, env }) {
  const id = (params.path && params.path[0] || "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) return notFound();
  if (!env.DB || !env.EXPORTS) return notFound();

  const row = await env.DB.prepare(`SELECT status FROM ec_previews WHERE id=?`).bind(id).first();
  if (!row) return notFound();
  if (row.status === "dead") return notFound();

  const obj = await env.EXPORTS.get(`previews/${id}/replica.html`);
  if (!obj) return buildingPage();
  return new Response(obj.body, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
