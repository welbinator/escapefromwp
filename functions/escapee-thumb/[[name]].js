// Cloudflare Pages Function — GET /escapee-thumb/:name
// Serves an uploaded escapee thumbnail from R2.
export async function onRequestGet({ params, env }) {
  const name = Array.isArray(params.name) ? params.name.join("/") : params.name;
  const key = `thumbs/${name}`;
  const obj = await env.THUMBS.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("etag", obj.httpEtag);
  return new Response(obj.body, { headers });
}
