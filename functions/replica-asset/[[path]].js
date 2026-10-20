// GET /replica-asset/<id>/<file> — serve a rehosted asset (image/font/etc.)
// that the replica capture stored in R2 under replica-assets/<id>/<file>.

const TYPES = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", svg: "image/svg+xml", ico: "image/x-icon", avif: "image/avif",
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
  css: "text/css", js: "text/javascript", bin: "application/octet-stream",
};

export async function onRequestGet({ params, env }) {
  const parts = params.path || [];
  const id = (parts[0] || "").toLowerCase();
  const file = parts.slice(1).join("/");
  if (!/^[0-9a-f]{32}$/.test(id) || !file || file.includes("..")) return new Response("Not found", { status: 404 });
  if (!env.EXPORTS) return new Response("Not found", { status: 404 });

  const obj = await env.EXPORTS.get(`replica-assets/${id}/${file}`);
  if (!obj) return new Response("Not found", { status: 404 });

  const ext = (file.split(".").pop() || "").toLowerCase();
  const ct = obj.httpMetadata?.contentType || TYPES[ext] || "application/octet-stream";
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
