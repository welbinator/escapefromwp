// Cloudflare Pages middleware — runs on every request.
// Canonicalize www -> apex with a 301 (SEO: avoids duplicate-content between
// www.escapefromwp.com and escapefromwp.com). Preserves path + query string.
export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (url.hostname === "www.escapefromwp.com") {
    url.hostname = "escapefromwp.com";
    return Response.redirect(url.toString(), 301);
  }

  return next();
}
