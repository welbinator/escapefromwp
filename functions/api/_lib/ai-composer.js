// AI composer — ONE Gemini call per preview build, at generate-time only.
// Its output is baked into the stored model, so rendering the 3 themes (and every
// later re-view) stays 100% deterministic and token-free. On ANY failure it
// returns the model unchanged and the deterministic composer takes over, so AI
// can never break or block a build (James's cost + reliability directive).
//
// AI decides THREE things it does better than rules — nothing else:
//   1. block ORDER (which sections, in what sequence) -> model.ai_plan
//   2. hero COPY (headline/subheadline/cta) when the source has none good
//   3. junk IMAGE rejection (the "little Stinker" problem) -> urls stripped
// AI never invents content/numbers; it only picks from blocks we actually have
// and rewrites copy from real page text.

const MODEL = "gemini-2.5-flash";
const TIMEOUT_MS = 12000;

// Deterministic junk-image denylist (zero-cost, always-on first layer). Catches
// obvious irrelevant/placeholder images by filename so we never depend on the
// AI's variable judgment for the clear cases. AI still handles subtler ones.
const JUNK_FILENAME = /(toilet|tissue|placeholder|sample|dummy|lorem|test-?image|default-?thumb|no-?image|coming-?soon|spacer|blank|1x1|pixel|avatar|sprite|icon-|favicon)/i;
function isJunkImage(url) {
  if (!url) return false;
  const file = (url.split("/").pop() || "").split("?")[0];
  return JUNK_FILENAME.test(file);
}
// Strip a set of bad URLs everywhere they appear in the model (hero/features/
// gallery/services). Returns a new model.
function stripImages(model, badSet) {
  if (!badSet.size) return model;
  const m = { ...model, hero: { ...model.hero }, detections: { ...(model.detections || {}) } };
  if (badSet.has(m.hero.image)) m.hero.image = null;
  if (Array.isArray(m.features)) m.features = m.features.map((f) => badSet.has(f.image) ? { ...f, image: null } : f);
  if (m.detections.gallery?.images) m.detections.gallery = { ...m.detections.gallery, images: m.detections.gallery.images.filter((u) => !badSet.has(u)) };
  if (Array.isArray(m.detections.services)) m.detections.services = m.detections.services.map((s) => badSet.has(s.image) ? { ...s, image: null } : s);
  return m;
}

// Public: deterministic-only junk strip (runs ALWAYS, even with AI off).
export function stripJunkImages(model) {
  const bad = new Set();
  const scan = (u) => { if (isJunkImage(u)) bad.add(u); };
  scan(model.hero?.image);
  (model.features || []).forEach((f) => scan(f.image));
  (model.detections?.services || []).forEach((s) => scan(s.image));
  (model.detections?.gallery?.images || []).forEach(scan);
  return stripImages(model, bad);
}

// Blocks the AI is allowed to place. Must match BLOCK_TYPES in blocks.js.
const ALLOWED = [
  "hero", "services", "cardGrid", "gallery", "carousel", "featureSplit",
  "timeline", "statBand", "team", "testimonials", "video", "pricing",
  "postList", "faqs", "contact", "ctaBand",
];

// Build a compact, token-cheap inventory of what content is actually available,
// so the AI orders real blocks and flags real images — never hallucinates.
function buildInventory(model, d) {
  const inv = { business: model.brand?.name || "this business", blocks: {}, images: [] };
  const has = (k, v) => { if (v) inv.blocks[k] = v; };

  has("hero", { headline: model.hero?.headline || "", sub: model.hero?.subheadline || "" });
  if (d.services?.length) has("services", `${d.services.length} services: ` + d.services.map((s) => s.title).slice(0, 8).join(", "));
  else if (model.features?.length >= 3) has("cardGrid", `${model.features.length} feature cards: ` + model.features.map((f) => f.title).slice(0, 8).join(", "));
  if (d.gallery?.images?.length) has("gallery", `${d.gallery.images.length} images`);
  if (d.timeline?.length) has("timeline", `${d.timeline.length} milestones`);
  if (d.team?.length) has("team", `${d.team.length} people`);
  if (d.testimonials?.length) has("testimonials", `${d.testimonials.length} reviews`);
  if (d.videos?.length) has("video", `${d.videos.length} videos`);
  if (d.pricing?.length) has("pricing", `${d.pricing.length} tiers`);
  if (model.posts?.length >= 3) has("postList", `${model.posts.length} posts`);
  if (d.faqs?.length) has("faqs", `${d.faqs.length} Q&A`);
  has("contact", "contact details");

  // Candidate hero/feature images for junk-filtering (filename + alt + context).
  const pushImg = (url, context) => {
    if (!url || inv.images.find((i) => i.url === url) || inv.images.length >= 14) return;
    const file = (url.split("/").pop() || "").split("?")[0];
    inv.images.push({ url, file, context: (context || "").slice(0, 80) });
  };
  if (model.hero?.image) pushImg(model.hero.image, "homepage hero image for " + inv.business);
  (model.features || []).forEach((f) => pushImg(f.image, f.title));
  (d.services || []).forEach((s) => pushImg(s.image, s.title));
  (d.gallery?.images || []).slice(0, 8).forEach((u) => pushImg(u, "gallery image"));
  return inv;
}

function buildPrompt(inv) {
  return `You are laying out a small-business website from already-extracted content. Return ONLY JSON.

Business: ${inv.business}
Available blocks (place ONLY these, each at most once): ${JSON.stringify(inv.blocks)}
Allowed block types (ignore any not in "Available blocks"): ${ALLOWED.join(", ")}
Candidate images (flag any that are junk/irrelevant for a professional homepage — e.g. a product like toilet paper used as a hero, placeholder/sample/logo-sprite/icon, broken-looking thumbnails): ${JSON.stringify(inv.images)}

Rules:
- "hero" MUST be first; "ctaBand" MUST be last; "contact" near the end.
- Order the rest for a compelling homepage narrative (what we do -> proof/showcase -> story -> social proof -> details).
- Only include a block if it appears in "Available blocks".
- Rewrite hero copy ONLY from real context; concise, benefit-led, no hype, no invented facts/numbers. If current hero copy is already good, keep it.
- Do NOT invent content or images.

Return JSON exactly:
{"order":["hero",...,"ctaBand"],"hero":{"headline":"...","subheadline":"...","cta":"..."},"reject_images":["<url>",...]}`;
}

async function callGemini(env, prompt) {
  const key = env.GOOGLE_AI_API;
  if (!key) throw new Error("no key");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // gemini-2.5-flash is a THINKING model — leaving thinking on burns the
          // output budget on reasoning tokens and truncates the JSON (MAX_TOKENS).
          // Disable thinking for this structured, low-reasoning task + give headroom.
          generationConfig: {
            temperature: 0.4,
            responseMimeType: "application/json",
            maxOutputTokens: 800,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    if (!res.ok) throw new Error("gemini " + res.status);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    return JSON.parse(text);
  } finally { clearTimeout(timer); }
}

// Public: returns a possibly-enhanced COPY of the model. Never throws.
export async function enhanceModelWithAI(env, model) {
  try {
    // Layer 1 (deterministic, free): kill obvious junk images first.
    model = stripJunkImages(model);
    const d = model.detections || {};
    const inv = buildInventory(model, d);
    const out = await callGemini(env, buildPrompt(inv));

    const m = { ...model, hero: { ...model.hero }, detections: { ...d } };

    // 1) Hero copy (only overwrite with non-empty, sane strings).
    if (out.hero && typeof out.hero === "object") {
      const clamp = (s, n) => (typeof s === "string" ? s.trim().slice(0, n) : "");
      if (clamp(out.hero.headline, 90)) m.hero.headline = clamp(out.hero.headline, 90);
      if (clamp(out.hero.subheadline, 180)) m.hero.subheadline = clamp(out.hero.subheadline, 180);
      if (clamp(out.hero.cta, 30)) m.hero.cta = clamp(out.hero.cta, 30);
    }

    // 2) Block order -> ai_plan (validated against allowed + dedup; hero/cta forced).
    if (Array.isArray(out.order)) {
      let order = out.order.filter((x) => ALLOWED.includes(x));
      order = [...new Set(order)];
      if (order[0] !== "hero") order = ["hero", ...order.filter((x) => x !== "hero")];
      order = order.filter((x) => x !== "ctaBand").concat("ctaBand");
      if (order.length >= 3) m.ai_plan = order;
    }

    // 3) Junk-image rejection — strip flagged URLs everywhere they appear.
    if (Array.isArray(out.reject_images) && out.reject_images.length) {
      const bad = new Set(out.reject_images.filter((u) => typeof u === "string"));
      if (bad.has(m.hero.image)) m.hero.image = null;
      if (Array.isArray(m.features)) m.features = m.features.map((f) => bad.has(f.image) ? { ...f, image: null } : f);
      if (m.detections.gallery?.images) {
        m.detections = { ...m.detections, gallery: { ...m.detections.gallery, images: m.detections.gallery.images.filter((u) => !bad.has(u)) } };
      }
      if (Array.isArray(m.detections.services)) {
        m.detections.services = m.detections.services.map((s) => bad.has(s.image) ? { ...s, image: null } : s);
      }
    }

    m.ai_enhanced = true;
    return m;
  } catch (_) {
    return model; // deterministic composer takes over — build never blocked.
  }
}
