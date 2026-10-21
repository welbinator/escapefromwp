// Replica capture — produce a near-exact, self-contained mirror of a live site.
//
// Runs inside the queue worker using Cloudflare Browser Rendering (headless
// Chrome via env.BROWSER). Steps:
//   1. Render the page (JS runs → lazy images resolve), scroll to force loads.
//   2. Grab the fully-hydrated HTML + every stylesheet the page loaded.
//   3. Rewrite relative URLs to absolute, inline all CSS.
//   4. Download every referenced asset (images, fonts, CSS url() backgrounds)
//      and REHOST to R2 under replica-assets/<id>/<hash>.<ext> so the mirror
//      keeps working after the origin WP site dies (James's asset-hosting = B).
//   5. Rewrite asset refs to our serving route /replica-asset/<id>/<file>.
//   6. Store the final HTML at previews/<id>/replica.html.

import puppeteer from "@cloudflare/puppeteer";

const SITE_ORIGIN_DEFAULT = "https://escapefromwp.com";

function absUrl(u, base) {
  try { return new URL(u, base).href; } catch { return null; }
}

async function sha1Hex(str) {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function extFromUrl(u, contentType) {
  try {
    const p = new URL(u).pathname;
    const m = p.match(/\.([a-z0-9]{2,5})(?:$|\?)/i);
    if (m) return m[1].toLowerCase();
  } catch (_) {}
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("woff2")) return "woff2";
  if (ct.includes("woff")) return "woff";
  if (ct.includes("ttf") || ct.includes("truetype")) return "ttf";
  if (ct.includes("svg")) return "svg";
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("gif")) return "gif";
  return "bin";
}

// True if the bytes look like an actual image/font/media file (not an HTML
// challenge/error page a CDN handed us in place of the asset).
function looksBinaryAsset(buf, ct) {
  const b = new Uint8Array(buf);
  if (b.byteLength < 8) return false;
  const ctl = (ct || "").toLowerCase();
  if (ctl.includes("text/html") || ctl.startsWith("text/plain")) return false;
  // Sniff leading bytes for an HTML document regardless of content-type.
  const head = new TextDecoder("latin1").decode(b.subarray(0, 64)).trim().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.startsWith("<head")) return false;
  return true;
}

// Fetch one URL with realistic browser headers. Returns {ok, ct, buf} or null.
async function fetchAssetOnce(url, referer) {
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "accept": "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        ...(referer ? { referer } : {}),
      },
      cf: { cacheTtl: 0 },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    const buf = await res.arrayBuffer();
    return { ok: true, ct, buf };
  } catch (_) { return null; }
}

// Download one asset and rehost to R2. Returns the public replica path, or null.
// Cached by URL within a single capture so we don't fetch the same file twice.
// pageOrigin: the site's own origin — used as a fallback host when a third-party
// CDN serves a bot-challenge/HTML page instead of the real file (common with
// edge CDNs like nxedge that reject non-browser user-agents or hotlinking).
async function rehostAsset(env, id, url, cache, selfOrigin, pageOrigin) {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url);
  try {
    const referer = pageOrigin || (() => { try { return new URL(url).origin; } catch { return ""; } })();
    let r = await fetchAssetOnce(url, referer);

    // If the response is missing or looks like an HTML challenge page, retry the
    // same path on the site's own origin (WP serves the file there directly).
    if (!r || !looksBinaryAsset(r.buf, r.ct)) {
      let fallbackUrl = null;
      try {
        const u = new URL(url);
        if (pageOrigin && new URL(pageOrigin).host !== u.host) {
          fallbackUrl = new URL(u.pathname + u.search, pageOrigin).toString();
        }
      } catch (_) {}
      if (fallbackUrl) {
        const r2 = await fetchAssetOnce(fallbackUrl, pageOrigin);
        if (r2 && looksBinaryAsset(r2.buf, r2.ct)) r = r2;
        else { cache.set(url, null); return null; }
      } else { cache.set(url, null); return null; }
    }

    const ct = r.ct;
    const buf = r.buf;
    if (buf.byteLength === 0 || buf.byteLength > 12 * 1024 * 1024) { cache.set(url, null); return null; }
    const hash = (await sha1Hex(url)).slice(0, 16);
    const ext = extFromUrl(url, ct);
    const key = `replica-assets/${id}/${hash}.${ext}`;
    await env.EXPORTS.put(key, buf, { httpMetadata: { contentType: ct || "application/octet-stream" } });
    // Absolute URL to OUR origin so it resolves regardless of any <base> tag.
    const path = `${(selfOrigin || "").replace(/\/$/, "")}/replica-asset/${id}/${hash}.${ext}`;
    cache.set(url, path);
    return path;
  } catch (_) { cache.set(url, null); return null; }
}

// Rewrite url(...) inside a CSS string: resolve against the stylesheet URL, then
// rehost each referenced file (fonts, background images) to R2.
async function rewriteCssUrls(env, id, css, cssBaseUrl, cache, selfOrigin, pageOrigin) {
  const urls = [];
  css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (m, u) => { urls.push(u); return m; });
  const map = {};
  for (const u of urls) {
    if (/^(data:)/i.test(u)) continue;
    const abs = absUrl(u, cssBaseUrl);
    if (!abs) continue;
    if (map[u] !== undefined) continue;
    map[u] = await rehostAsset(env, id, abs, cache, selfOrigin, pageOrigin);
  }
  return css.replace(/url\(\s*["']?([^"')]+)["']?\s*\)/gi, (m, u) => {
    if (/^(data:)/i.test(u)) return m;
    const rep = map[u];
    return rep ? `url("${rep}")` : m;
  });
}

// Capture + build the self-contained replica for one page. Returns { ok, html }.
export async function captureReplica(env, id, pageUrl) {
  const base = pageUrl;
  const selfOrigin = (env.SITE_ORIGIN || "https://escapefromwp.com").replace(/\/$/, "");
  let pageOrigin = ""; try { pageOrigin = new URL(base).origin; } catch (_) {}
  const browser = await puppeteer.launch(env.BROWSER);
  const cache = new Map();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1800, deviceScaleFactor: 1 });

    // Collect every CSS file the page loads.
    const cssFiles = {};
    page.on("response", async (res) => {
      try {
        const ct = res.headers()["content-type"] || "";
        if (ct.includes("text/css") || res.url().split("?")[0].endsWith(".css")) {
          cssFiles[res.url()] = await res.text();
        }
      } catch (_) {}
    });

    await page.goto(base, { waitUntil: "networkidle0", timeout: 55000 });
    // Scroll to force lazy-load.
    await page.evaluate(async () => {
      await new Promise((r) => {
        let y = 0; const t = setInterval(() => {
          window.scrollBy(0, 700); y += 700;
          if (y > document.body.scrollHeight + 2000) { clearInterval(t); r(); }
        }, 80);
      });
    });
    await new Promise((r) => setTimeout(r, 1500));
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 400));

    // Grab hydrated HTML.
    let html = await page.content();

    // --- Rewrite relative src/href/data-src/srcset to ABSOLUTE first. ---
    html = html.replace(/\b(src|href|data-src|data-lazy-src)=["']([^"']+)["']/gi, (m, attr, u) => {
      if (/^(https?:|data:|#|mailto:|tel:|javascript:)/i.test(u)) return m;
      const a = absUrl(u, base); return a ? `${attr}="${a}"` : m;
    });
    html = html.replace(/\b(srcset|data-srcset)=["']([^"']+)["']/gi, (m, attr, set) => {
      const fixed = set.split(",").map((part) => {
        const [u, d] = part.trim().split(/\s+/);
        if (!u) return part.trim();
        if (/^(https?:|data:)/i.test(u)) return part.trim();
        const a = absUrl(u, base); return a ? `${a}${d ? " " + d : ""}` : part.trim();
      }).join(", ");
      return `${attr}="${fixed}"`;
    });

    // --- Collect all <img> src + srcset URLs and rehost them. ---
    const imgUrls = new Set();
    html.replace(/<img\b[^>]*>/gi, (tag) => {
      const s = tag.match(/\bsrc=["']([^"']+)["']/i); if (s && /^https?:/i.test(s[1])) imgUrls.add(s[1]);
      const ss = tag.match(/\bsrcset=["']([^"']+)["']/i);
      if (ss) ss[1].split(",").forEach((p) => { const u = p.trim().split(/\s+/)[0]; if (/^https?:/i.test(u)) imgUrls.add(u); });
      return tag;
    });
    // og:image / link icons too.
    html.replace(/<(?:meta|link)\b[^>]*\b(?:content|href)=["'](https?:\/\/[^"']+\.(?:png|jpe?g|webp|gif|svg|ico))["'][^>]*>/gi,
      (m, u) => { imgUrls.add(u); return m; });

    const urlMap = {};
    for (const u of imgUrls) urlMap[u] = await rehostAsset(env, id, u, cache, selfOrigin, pageOrigin);
    // Replace every rehosted URL throughout the HTML.
    for (const [u, rep] of Object.entries(urlMap)) {
      if (!rep) continue;
      html = html.split(u).join(rep);
    }

    // --- Inline CSS (with url() rehosting), drop <link> + <script>. ---
    let bundled = "";
    for (const [url, css] of Object.entries(cssFiles)) {
      bundled += `\n/* ${url} */\n` + await rewriteCssUrls(env, id, css, url, cache, selfOrigin, pageOrigin) + "\n";
    }
    // Rehost url()s inside inline <style> blocks too (fonts often declared there).
    const styleBlocks = [...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
    for (const sb of styleBlocks) {
      const fixed = await rewriteCssUrls(env, id, sb[1], base, cache, selfOrigin, pageOrigin);
      if (fixed !== sb[1]) html = html.replace(sb[0], `<style>${fixed}</style>`);
    }
    html = html.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, "");
    html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
    html = html.replace(/<script\b[^>]*\/?>/gi, "");
    // Keep <link rel=preload as=font> working by rehosting those hrefs.
    const preloads = [...html.matchAll(/<link\b[^>]*\bhref=["'](https?:\/\/[^"']+\.(?:woff2?|ttf|otf))["'][^>]*>/gi)];
    for (const pl of preloads) {
      const rep = await rehostAsset(env, id, pl[1], cache, selfOrigin, pageOrigin);
      if (rep) html = html.replace(pl[1], rep);
    }
    html = html.replace(/<\/head>/i, `<style>${bundled}</style></head>`);

    return { ok: true, html, assets: cache.size, css_files: Object.keys(cssFiles).length };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  } finally {
    try { await browser.close(); } catch (_) {}
  }
}
