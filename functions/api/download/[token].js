// Cloudflare Pages Function — GET /api/download/:token
// Serves a previously-generated migration bundle from R2 by its token.
// Objects auto-expire after 24h via the bucket lifecycle rule.

export async function onRequestGet({ params, env }) {
  const token = (params.token || "").toString();
  // Tokens are 32 hex chars — reject anything else fast.
  if (!/^[a-f0-9]{32}$/.test(token)) {
    return new Response("Invalid download link.", { status: 400 });
  }
  if (!env.EXPORTS) {
    return new Response("Download storage is not configured.", { status: 500 });
  }

  const obj = await env.EXPORTS.get(`exports/${token}.zip`);
  if (!obj) {
    return htmlGone();
  }

  const filename = obj.httpMetadata?.contentDisposition
    ? obj.httpMetadata.contentDisposition
    : `attachment; filename="wordpress-content-export.zip"`;

  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": filename,
      "Cache-Control": "no-store",
    },
  });
}

function htmlGone() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Download expired — Escape From WP</title>
<style>
  body{background:#0b0405;color:#e8e6e3;font-family:system-ui,sans-serif;margin:0;
       display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px}
  .box{max-width:460px}
  h1{color:#e32735;font-size:24px;margin:0 0 12px}
  p{color:#9a9490;line-height:1.6;font-size:15px}
  a{color:#4ee36b;text-decoration:none;font-family:ui-monospace,monospace;font-size:13px;
    display:inline-block;margin-top:20px;border:1px solid #2a2320;padding:12px 20px}
</style></head>
<body><div class="box">
  <h1>This download has expired</h1>
  <p>Migration bundles are kept for 24 hours and then deleted so we're not storing
     copies of your content any longer than needed. Just run the tool again to get a fresh one.</p>
  <a href="/liberate">↻ Liberate my content again</a>
</div></body></html>`;
  return new Response(html, { status: 410, headers: { "Content-Type": "text/html; charset=utf-8" } });
}
