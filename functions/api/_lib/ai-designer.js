// AI site designer — the "anti-slop" engine. At BUILD TIME only, makes 3
// parallel Claude calls, each producing a COMPLETE, bespoke, standalone HTML
// site from the business's REAL extracted content + REAL image URLs, one per
// design direction. The 3 HTML docs are stored in R2; the preview route just
// serves them (zero AI at view time — James's cost directive: AI runs once per
// build, baked into stored output).
//
// This REPLACES the template/block engine for previews. Instead of pouring
// content into fixed slots, each design direction is a real design system the
// model builds around the content (the anti-slop-web-design workflow, applied
// automatically per build).

const MODEL = "claude-sonnet-4-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const MAX_TOKENS = 16000; // a complete, detailed single-file site needs headroom; 8k truncated mid-document
const TIMEOUT_MS = 160000; // full-page generation runs ~80-130s; background task

// Three genuinely distinct design directions (personality + type + palette +
// layout feel). These are the "3 references" of the anti-slop workflow, baked
// in so each build yields three visually different, credible sites.
export const DESIGN_KEYS = ["warm", "bold", "editorial"];

export const DESIGNS = {
  warm: {
    label: "Warm & Editorial",
    blurb: "Serif elegance, soft palette, generous whitespace",
    brief: `DESIGN DIRECTION: "Warm & Editorial" — a refined, human, craft-forward look.
- Typography: display font "Fraunces" (serif, characterful) for headings; body font "Newsreader" (readable serif) for paragraphs. Load both from Google Fonts.
- Palette: warm and inviting — a soft cream/off-white background (e.g. #faf6f0), deep warm charcoal text (#2b2420), and ONE confident terracotta/clay accent (e.g. #c2663f). If the brand's real colors are provided and look good, weave them in, but keep the warm, calm, premium feel.
- Layout: generous whitespace, large comfortable line-height, editorial rhythm. Asymmetric hero (text left, image right or full-bleed). Content feels like a beautifully set magazine, not a grid of identical cards.
- Mood: trustworthy, established, warm, high-end small business.`,
  },
  bold: {
    label: "Bold & Modern",
    blurb: "Confident type, dark hero, vivid accent",
    brief: `DESIGN DIRECTION: "Bold & Modern" — a confident, contemporary, high-impact look.
- Typography: display font "Space Grotesk" (geometric, modern) for big headings; body font "Inter" for everything else. Load both from Google Fonts.
- Palette: high contrast and striking — a deep near-black or rich dark base for the hero (#0f1115), crisp light sections below, and ONE vivid saturated accent (e.g. electric indigo #4f46e5 or the brand's real primary color if provided and strong). Use the accent sparingly but boldly.
- Layout: a dramatic full-viewport dark hero with large type, then clean bright content sections. Big confident headings, strong visual hierarchy, modern spacing. Think a well-funded startup's site.
- Mood: confident, modern, premium, forward-looking.`,
  },
  editorial: {
    label: "Refined & Classic",
    blurb: "High-contrast, magazine layout, timeless",
    brief: `DESIGN DIRECTION: "Refined & Classic" — an elegant, timeless, high-contrast editorial look.
- Typography: display font "Playfair Display" (elegant high-contrast serif) for headings; body font "Source Sans 3" (clean humanist sans) for body. Load both from Google Fonts.
- Palette: sophisticated and restrained — near-white background (#ffffff / #f7f5f2), rich black text (#141414), and ONE muted gold/brass accent (e.g. #9a7b4f) for fine details and rules. Thin hairline dividers. If brand colors are provided and tasteful, use them as a secondary accent.
- Layout: magazine-style — strong typographic hierarchy, elegant section headers with small-caps or letterspaced labels, thin rules between sections, refined use of imagery. Classy, understated, expensive-feeling.
- Mood: timeless, premium, editorial, authoritative.`,
  },
};

// ---- Content packaging ---------------------------------------------------
// Turn the normalized site-model into a compact, truthful content brief the
// model designs around. We pass REAL copy + REAL image URLs only.

function cleanList(arr, n) {
  return (Array.isArray(arr) ? arr : []).filter(Boolean).slice(0, n);
}

function packContent(model) {
  const d = model.detections || {};
  const brand = model.brand || {};

  const content = {
    business_name: brand.name || "This Business",
    tagline: model.tagline || "",
    logo_url: brand.logo_url || null,
    brand_colors: {
      primary: brand.primary || null,
      secondary: brand.secondary || null,
      confidence: brand.color_confidence || "none",
    },
    nav: cleanList(model.nav, 7).map((n) => ({ label: n.label, href: n.href })),
    hero: {
      headline: model.hero?.headline || brand.name || "",
      subheadline: model.hero?.subheadline || "",
      image: model.hero?.image || null,
      cta: model.hero?.cta || "Get in touch",
    },
    sections: cleanList(model.features, 6).map((f) => ({
      title: f.title, text: f.text, image: f.image || null,
    })),
    gallery_images: cleanList(d.gallery?.images, 12),
    services: cleanList(d.services, 8).map((s) => ({ title: s.title, text: s.text || "", image: s.image || null })),
    faqs: cleanList(d.faqs, 8).map((f) => ({ q: f.q, a: f.a })),
    testimonials: cleanList(d.testimonials, 6).map((t) => ({ quote: t.quote, who: t.who || "" })),
    team: cleanList(d.team, 8).map((t) => ({ name: t.name, role: t.role || "", image: t.image || null })),
    timeline: cleanList(d.timeline, 8).map((t) => ({ year: t.year, event: t.event })),
    pricing: cleanList(d.pricing, 6),
    posts: cleanList(model.posts, 6).map((p) => ({ title: p.title, excerpt: p.excerpt, image: p.image || null })),
    contact: d.contact || {},
    source_url: model.source_url || "",
  };
  return content;
}

// ---- Prompt --------------------------------------------------------------

function buildSystemPrompt() {
  return `You are an elite web designer who builds beautiful, bespoke small-business websites. You will be given a single business's REAL content (already extracted from their old WordPress site) and ONE design direction. You output ONE complete, production-quality, responsive HTML document.

ABSOLUTE RULES:
1. Output ONLY the raw HTML document. Start with <!doctype html> and end with </html>. No markdown fences, no commentary, no explanation before or after.
2. Use ONLY the real content provided. NEVER invent facts, services, reviews, statistics, phone numbers, addresses, or copy. If a section has no data, omit that section entirely. Do NOT use lorem ipsum or placeholder text, EVER.
3. Use the REAL image URLs provided, exactly as given (they are absolute URLs to the business's actual photos). Only use images from the provided lists. If no suitable image exists for a spot, design without one (use color, type, and layout) rather than inventing or hotlinking anything else. Never use placeholder image services.
4. NEVER use em dashes (—) or en dashes (–) anywhere in the copy. Use periods, commas, or colons. (ASCII hyphens in compound words are fine.)
5. All CSS must be inline in a single <style> block in the <head>. All fonts via Google Fonts <link>. Self-contained single file. No external JS frameworks.
6. Mobile-first and fully responsive. Include a working responsive nav.
7. Include tasteful, restrained motion: gentle scroll-reveal (fade + small rise) on sections as they enter view via IntersectionObserver, a subtle hero entrance, and hover lift on buttons/cards. CRITICAL: the reveal must FAIL OPEN — add a 'js' class to <html> at script start and only hide elements when html.js is present, plus a setTimeout safety net that reveals everything after 2.5s. Fully disable motion under @media (prefers-reduced-motion: reduce). Never leave content invisible.
8. This must look like a real, premium, hand-built site for THIS specific business, not a generic template. Make genuinely bold design choices appropriate to the direction. Quality bar: it should look like a site a professional studio charged thousands for.
9. Write warm, specific, human marketing copy derived from the real content. Name the customer's need, be concrete, one clear idea per section. No AI-cliche phrases ("elevate", "unlock", "seamless", "in today's fast-paced world", "nestled").
10. Include a header with the business name (or logo image if a logo_url is provided) and nav, and a footer. Make the primary CTA point to the contact section.`;
}

function buildUserPrompt(design, content) {
  return `${design.brief}

Here is the business's REAL content as JSON. Design a complete site around it following the design direction above. Omit any section whose data is empty. Remember: real content only, real image URLs only, no lorem ipsum, no em dashes, fail-open motion.

CONTENT:
${JSON.stringify(content, null, 1)}

Now output the complete single-file HTML document and nothing else.`;
}

// ---- Claude call ---------------------------------------------------------

async function callClaude(env, system, user) {
  const key = env.ANTHROPIC_AI_API;
  if (!key) throw new Error("no anthropic key");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0.7,
        system,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error("anthropic " + res.status + " " + t.slice(0, 200));
    }
    const data = await res.json();
    const text = (data?.content || []).map((b) => b.text || "").join("");
    return text;
  } finally { clearTimeout(timer); }
}

// Strip any stray markdown fences / preamble and keep just the HTML document.
function extractHtml(text) {
  if (!text) return "";
  let t = text.trim();
  // Remove ```html ... ``` fences if the model wrapped the whole thing.
  const fence = t.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  // Drop any remaining stray fence lines / leading language label ("html").
  t = t.replace(/```+/g, "").trim();
  // Trim anything before <!doctype or <html (kills a leading "html" label etc).
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  // Trim anything after the final </html>.
  const end = t.toLowerCase().lastIndexOf("</html>");
  if (end !== -1) t = t.slice(0, end + 7);
  return t.trim();
}

// Final safety net: kill any em/en dashes the model slipped in (James's hard rule).
function dedash(html) {
  return html.replace(/\s*[\u2014\u2013]\s*/g, ", ").replace(/,\s*,/g, ",");
}

// If generation was cut off (no </html>), repair it so the page still renders
// instead of being discarded: close any open tags best-effort and force every
// element visible (the fail-open script may have been truncated away).
function repairHtml(html) {
  let h = html;
  if (!/<\/html>/i.test(h)) {
    // Drop a trailing partial tag like "<span" with no ">".
    const lastLt = h.lastIndexOf("<");
    const lastGt = h.lastIndexOf(">");
    if (lastLt > lastGt) h = h.slice(0, lastLt);
    // Force-reveal safety net + close the document.
    h += `\n<style>*{opacity:1!important;transform:none!important;visibility:visible!important}</style>\n</main></body></html>`;
  }
  return h;
}

// Design ONE direction → full HTML (or null on failure).
async function designOne(env, key, content) {
  try {
    const design = DESIGNS[key];
    const raw = await callClaude(env, buildSystemPrompt(), buildUserPrompt(design, content));
    let html = dedash(extractHtml(raw));
    if (!/^<!doctype html|^<html/i.test(html) || html.length < 2500) return null; // not a real doc
    html = repairHtml(html); // close + force-reveal if truncated
    return html;
  } catch (_) {
    return null;
  }
}

// Public: design all three in PARALLEL. Returns { warm, bold, editorial } with
// HTML strings (or null for any that failed). Never throws. (Kept for batch use.)
export async function designAllThree(env, model) {
  const content = packContent(model);
  const results = await Promise.all(
    DESIGN_KEYS.map((k) => designOne(env, k, content).then((html) => [k, html]))
  );
  const out = {};
  for (const [k, html] of results) out[k] = html;
  return out;
}

// Public: design ONE variant from a stored model. Used for lazy, per-request
// generation (one ~90s Claude call fits inside an HTTP request's unlimited wall
// time, unlike waitUntil which is capped at 30s). Returns HTML or null.
export async function designVariant(env, model, key) {
  if (!DESIGN_KEYS.includes(key)) return null;
  const content = packContent(model);
  return designOne(env, key, content);
}

export { packContent };
