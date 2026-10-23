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
import { injectInteractions } from "./interactions-shim.js";
import { RECORDER_FN, injectReplay, CONSENT_NEUTRALIZER_FN, CONSENT_SELECTORS_EXPORT, stripConsentHtml } from "./interaction-recorder.js";

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

    // Load the page. Use networkidle2 (tolerates up to 2 lingering connections)
    // instead of networkidle0, because many sites keep a socket open forever —
    // live chat (Crisp/Intercom/Tawk), analytics long-poll, YouTube/video embeds —
    // and networkidle0 would NEVER fire, timing the whole job out. If even
    // networkidle2 doesn't settle in time, we DON'T abandon the capture: we fall
    // back to a domcontentloaded wait and proceed with whatever rendered. A
    // slightly-less-complete replica beats an eternal "building" page + no email.
    //
    // PERF: this networkidle2 timeout is intentionally SHORT (18s). On sites with a
    // live-chat widget (Crisp etc.) the network never truly idles, so networkidle2
    // can only ever end by timing out — a long timeout just makes every such build
    // wait the full duration for nothing. 18s is plenty for a normal site to settle,
    // and for a chat-widget site it caps the dead wait, then the domcontentloaded
    // fallback (+6s paint) produces a complete replica. We do NOT block the chat
    // widget's requests: doing so makes Crisp retry its socket in a loop, generating
    // MORE network churn and defeating the purpose (learned the hard way).
    let blockedChat = 0; // retained for the log line below; always 0 now (no blocking)
    try {
      await page.goto(base, { waitUntil: "networkidle2", timeout: 18000 });
    } catch (navErr) {
      console.log(`[${id}] networkidle2 timed out (${String(navErr).slice(0, 80)}) — falling back to domcontentloaded`);
      try {
        await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
        // Give async content (images, fonts, hero) a moment to paint.
        await new Promise((r) => setTimeout(r, 6000));
      } catch (navErr2) {
        // If it's already on the page from the first attempt, keep going; only
        // bail if we truly have nothing.
        console.log(`[${id}] domcontentloaded also failed (${String(navErr2).slice(0, 80)}) — capturing current state`);
      }
    }
    if (blockedChat > 0) console.log(`[${id}] blocked ${blockedChat} live-chat/long-poll request(s) to speed up network-idle`);
    // Scroll to force lazy-load. Wrapped defensively: on some sites a late script
    // fires a client-side navigation/reload while we're scrolling, which destroys
    // the execution context ("Execution context was destroyed"). That must NOT kill
    // the whole capture — we still have a rendered page to mirror. So swallow it,
    // re-settle, and continue. Same for every in-page evaluate below.
    try {
      await page.evaluate(async () => {
        await new Promise((r) => {
          let y = 0; const t = setInterval(() => {
            window.scrollBy(0, 700); y += 700;
            if (y > document.body.scrollHeight + 2000) { clearInterval(t); r(); }
          }, 80);
        });
      });
    } catch (e) { console.log(`[${id}] scroll evaluate skipped: ${String(e).slice(0, 80)}`); }
    await new Promise((r) => setTimeout(r, 1500));
    try { await page.evaluate(() => window.scrollTo(0, 0)); } catch (_) {}
    await new Promise((r) => setTimeout(r, 400));

    // --- RECORD-AND-REPLAY: observe real interactions while origin JS is alive ---
    // Before we strip scripts, drive each candidate toggle (hamburger, dropdown,
    // accordion, tab) in the live page, diff the DOM, and record exactly what each
    // one changes. This stamps data-efw-tgl/data-efw-el onto the elements so the
    // recording survives into the captured HTML. Theme-agnostic: we replay what we
    // observed, instead of guessing from hardcoded selectors.
    //
    // CRITICAL: the hamburger/mobile menu only EXISTS at a mobile viewport (at the
    // 1440px desktop width it's display:none and the nav is already shown, so there
    // is nothing to click). So we record in TWO passes — a mobile pass (for the
    // hamburger + mobile nav) and a desktop pass (for desktop dropdowns/flyouts) —
    // then restore the desktop viewport before capturing HTML. The data-efw-* stamps
    // persist on the elements across the resize.
    let recording = { version: 1, toggles: [] };
    try {
      // Pass 1 — mobile viewport: hamburger + mobile nav.
      await page.setViewport({ width: 390, height: 850, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      await new Promise((r) => setTimeout(r, 500));
      const mobileRec = await page.evaluate(RECORDER_FN, { maxToggles: 40, settleMs: 350, pass: "m" });

      // Pass 2 — back to desktop: dropdowns/flyouts/accordions that only show wide.
      await page.setViewport({ width: 1440, height: 1800, deviceScaleFactor: 1 });
      await new Promise((r) => setTimeout(r, 400));
      const desktopRec = await page.evaluate(RECORDER_FN, { maxToggles: 40, settleMs: 350, pass: "d" });

      // Merge, de-duping by toggle id (a toggle already recorded on mobile wins).
      const seen = new Set();
      const merged = [];
      for (const rec of [mobileRec, desktopRec]) {
        if (!rec || !Array.isArray(rec.toggles)) continue;
        for (const tg of rec.toggles) {
          if (seen.has(tg.tgl)) continue;
          seen.add(tg.tgl); merged.push(tg);
        }
      }
      recording = { version: 1, toggles: merged };
    } catch (_) { recording = { version: 1, toggles: [] }; }

    // Make sure we're back at the desktop viewport even if the recording block threw
    // partway (a mid-recording navigation can leave us at the mobile viewport).
    try { await page.setViewport({ width: 1440, height: 1800, deviceScaleFactor: 1 }); } catch (_) {}

    // --- NEUTRALIZE consent/cookie banners + un-freeze off-canvas nav panels ---
    // Done AFTER recording (so their own open/close was observed if any) but BEFORE
    // we serialize. Consent platforms (CookieYes/Iubenda/Complianz/…) put all their
    // dismiss logic in vendor JS we're about to strip; left in place they freeze a
    // fixed, top-of-everything overlay that also eats clicks meant for the menu.
    // Their JS is gone, so they add nothing to a static demo — we remove them and
    // clear any body scroll-lock / inert nav panel they left behind.
    try {
      const neu = await page.evaluate(CONSENT_NEUTRALIZER_FN, CONSENT_SELECTORS_EXPORT);
      if (neu && (neu.removed || neu.unfrozen)) {
        console.log(`[${id}] consent neutralized: removed ${neu.removed}, unfroze ${neu.unfrozen}`);
      }
    } catch (e) { console.log(`[${id}] consent neutralize skipped: ${String(e).slice(0, 80)}`); }

    // Grab hydrated HTML (now carries the data-efw-* stamps from the recorder).
    // page.content() throws if the execution context was destroyed by a late
    // navigation/reload. Retry once after a short settle; if it still fails, fall
    // back to reading documentElement.outerHTML directly. Only truly give up if we
    // end up with nothing usable.
    let html = "";
    for (let attempt = 0; attempt < 2 && !html; attempt++) {
      try {
        html = await page.content();
      } catch (e) {
        console.log(`[${id}] page.content() attempt ${attempt + 1} failed: ${String(e).slice(0, 80)}`);
        await new Promise((r) => setTimeout(r, 1200));
        try { html = await page.evaluate(() => document.documentElement.outerHTML); } catch (_) {}
      }
    }
    if (!html || html.length < 2000) {
      throw new Error(`could not read page HTML after render (${html ? html.length + "b" : "empty"})`);
    }

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

    // Safety net: if the in-page consent neutralizer was skipped (destroyed
    // context) a banner can survive in the serialized HTML. Strip the well-known
    // consent containers + any lingering `inert` on off-canvas nav panels at the
    // string level so the menu isn't blocked and no frozen cookie wall ships.
    html = stripConsentHtml(html);

    // Re-wire interactions with BOTH systems, cleanly divided so neither
    // double-fires:
    //   • REPLAY (interaction-recorder) drives elements we stamped with
    //     data-efw-tgl — the exact observed behavior (dropdowns, flyouts, etc.).
    //   • SHIM (interactions-shim) handles everything we did NOT stamp — most
    //     importantly the mobile hamburger, whose stamp can be lost when the theme
    //     re-renders its nav on the mobile→desktop resize. The shim explicitly
    //     skips any element carrying data-efw-tgl, so the two never collide.
    // Injecting both (not either/or) is what fixes the "hamburger does nothing"
    // regression: even if the recorder couldn't keep the hamburger's stamp, the
    // shim still wires it.
    if (recording && recording.toggles && recording.toggles.length) {
      html = injectReplay(html, recording);
    }
    html = injectInteractions(html);

    return { ok: true, html, assets: cache.size, css_files: Object.keys(cssFiles).length, interactions_recorded: (recording && recording.toggles ? recording.toggles.length : 0) };
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 200) };
  } finally {
    try { await browser.close(); } catch (_) {}
  }
}
