// Brand-kit grabber — deterministic, zero AI. Given a WP site's homepage HTML
// (and base URL), find the best logo and a primary/secondary brand color.
// Everything is best-effort with safe fallbacks so a miss never breaks a preview.

// --- logo detection ---------------------------------------------------------
// Priority: <link rel icon sizes big> → og:image (only if it looks like a logo)
// → <img> whose class/alt/src says "logo" → site icon → null (→ wordmark).
export function findLogo(html, base) {
  if (!html) return null;
  const abs = (u) => { try { return new URL(u, base).href; } catch { return null; } };

  // 1) Explicit logo <img> — strongest signal.
  const imgRe = /<img\b[^>]*>/gi;
  let m;
  const candidates = [];
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    const src = (tag.match(/\bsrc=["']([^"']+)["']/i) || [])[1];
    if (!src) continue;
    const hay = tag.toLowerCase();
    let score = 0;
    if (/logo/.test(hay)) score += 10;
    if (/\bclass=["'][^"']*\b(site-logo|custom-logo|brand|navbar-brand|header-logo)\b/i.test(tag)) score += 8;
    if (/\balt=["'][^"']*logo/i.test(tag)) score += 4;
    if (/header|masthead|brand|navbar/.test(hay)) score += 3;
    if (/\.svg(\?|$)/i.test(src)) score += 2;            // svg logos scale cleanly
    if (/icon|sprite|avatar|gravatar|emoji|spacer|pixel/.test(hay)) score -= 6;
    if (score > 0) candidates.push({ src: abs(src), score });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0] && candidates[0].src) return { url: candidates[0].src, kind: "img" };

  // 2) High-res favicon / apple-touch-icon.
  const iconRe = /<link\b[^>]*rel=["']([^"']*icon[^"']*)["'][^>]*>/gi;
  let best = null, bestSize = 0;
  while ((m = iconRe.exec(html))) {
    const tag = m[0];
    const href = (tag.match(/\bhref=["']([^"']+)["']/i) || [])[1];
    if (!href) continue;
    const sizes = (tag.match(/sizes=["'](\d+)/i) || [])[1];
    const sz = sizes ? parseInt(sizes, 10) : (/apple-touch/i.test(tag) ? 180 : 32);
    if (sz >= bestSize) { bestSize = sz; best = abs(href); }
  }
  if (best && bestSize >= 48) return { url: best, kind: "icon" };

  return null; // caller falls back to a text wordmark
}

// --- color extraction -------------------------------------------------------
// WordPress themes expose their palette in CSS custom properties and inline
// styles far more reliably than we could guess from a logo image. Pull hex/rgb
// colors from the homepage, rank by frequency, and pick a vivid primary.
export function extractBrandColors(html) {
  const fallback = { primary: "#1f2933", secondary: "#e32735", text: "#ffffff" };
  if (!html) return fallback;

  const counts = new Map();
  const bump = (hex) => counts.set(hex, (counts.get(hex) || 0) + 1);

  // hex colors
  let m;
  const hexRe = /#([0-9a-f]{6}|[0-9a-f]{3})\b/gi;
  while ((m = hexRe.exec(html))) bump(normHex(m[0]));
  // rgb()/rgba()
  const rgbRe = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/gi;
  while ((m = rgbRe.exec(html))) bump(rgbToHex(+m[1], +m[2], +m[3]));

  // Prefer colors declared in theme palette custom props (--wp--preset--color…).
  const presetRe = /--wp--preset--color--[a-z0-9-]+\s*:\s*(#[0-9a-f]{3,6}|rgba?\([^)]+\))/gi;
  const presets = [];
  while ((m = presetRe.exec(html))) {
    const v = m[1];
    const hex = v.startsWith("#") ? normHex(v) : (() => { const p = v.match(/\d+/g); return p ? rgbToHex(+p[0], +p[1], +p[2]) : null; })();
    if (hex) presets.push(hex);
  }

  // Candidate pool: presets first (authoritative), then frequency-ranked.
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  const pool = [...new Set([...presets, ...ranked])].filter(isUsableBrandColor);

  if (!pool.length) return { ...fallback, confidence: "none" };
  // Primary = first vivid, non-neutral color; secondary = next distinct one.
  const vivid = pool.filter(isVivid);
  const primary = (vivid[0] || pool[0]);
  const secondary = pool.find((c) => c !== primary && colorDist(c, primary) > 60) || "#e32735";
  // Confidence: a color declared in a theme preset custom-prop (not a framework
  // default) is trustworthy; a frequency-only hit is a guess. Callers use this
  // to decide whether to theme the preview or fall back to the template palette.
  const fromPreset = presets.includes(primary) && isUsableBrandColor(primary);
  return { primary, secondary, text: readableOn(primary), confidence: fromPreset ? "high" : "low" };
}

// --- helpers ----------------------------------------------------------------
function normHex(h) {
  h = h.toLowerCase();
  if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return h;
}
function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
  return "#" + c(r) + c(g) + c(b);
}
function rgbOf(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)); }
function luminance(hex) {
  const [r, g, b] = rgbOf(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function readableOn(hex) { return luminance(hex) > 0.45 ? "#111111" : "#ffffff"; }
function colorDist(a, b) {
  const [r1, g1, b1] = rgbOf(a), [r2, g2, b2] = rgbOf(b);
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2);
}
// Skip pure white/black/greys — they're not a brand color.
function isUsableBrandColor(hex) {
  if (WP_DEFAULT_PALETTE.has(hex)) return false; // Gutenberg ships these on every site
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max < 24) return false;            // near-black
  if (min > 236) return false;           // near-white
  if (max - min < 16 && max > 60 && max < 200) return false; // mid grey
  return true;
}

// Default Gutenberg/WordPress preset palette — present in core CSS on virtually
// every WP site regardless of theme, so they're noise, not brand signal.
const WP_DEFAULT_PALETTE = new Set([
  "#cf2e2e", "#ff6900", "#fcb900", "#7bdcb5", "#00d084",
  "#8ed1fc", "#0693e3", "#abb8c3", "#eeeeee", "#f78da7",
  "#9b51e0", "#313131", "#f1f1f1", "#000000", "#ffffff",
]);
function isVivid(hex) {
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  return (max - min) > 40; // has real saturation
}
