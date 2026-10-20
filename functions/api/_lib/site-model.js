// Content → site-model mapper. Deterministic, zero AI. Turns a raw WP extract
// (collections + menus) into a normalized model the templates render:
//   { brand, nav[], hero{}, pages[], posts[], contact{} }
// Heuristics pick the homepage, derive hero copy, and bucket content — no LLM.
// An optional AI hero-headline call lives in the generate endpoint, NOT here;
// this module always produces usable hardcoded copy on its own.

import { htmlToText } from "./html-to-markdown.js";
import { detectContent } from "./content-detect.js";

const STOP_SLUGS = new Set(["cart", "checkout", "my-account", "wp-login", "privacy-policy", "terms", "terms-of-service", "sample-page"]);

// Default/boilerplate WP content that must never surface in a preview.
const JUNK_TITLE = /^(hello world|sample page|privacy policy|my account|cart|checkout)$/i;
const JUNK_BODY = /welcome to wordpress\.?\s*this is your first post/i;
// Internal/test/utility pages whose titles reveal they aren't real content.
const JUNK_SLUG = /(^|[-_])(test|debug|tmp|temp|import|export|loop|staging|draft|placeholder|demo|example|wip|backup|old|copy)([-_]|$)/i;

function isJunkEntry(e) {
  const title = (e.title || "").trim();
  const slug = (e.slug || "").toLowerCase();
  if (!title) return true;
  if (JUNK_TITLE.test(title)) return true;
  if (JUNK_BODY.test(e.content_md || "")) return true;
  if (JUNK_SLUG.test(slug)) return true;
  return false;
}

// First sentence / lead paragraph from markdown, cleaned + length-capped.
// Robust against the converter's messy linked-image markdown — strips all
// image/link/URL residue, then returns the first real prose sentence.
function leadText(md, max = 180) {
  if (!md) return "";
  // Work line-by-line: find the first line that is real prose (not an image/
  // link/url dump), since WP homepages often lead with image galleries.
  const lines = md.split(/\n+/);
  for (let raw of lines) {
    let s = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")         // std images
      .replace(/\[[^\]]*\]\([^)]*\)/g, " ")          // std links (drop entirely)
      .replace(/\]?\(https?:[^)]*\)/g, " ")          // orphan (url) + ](url)
      .replace(/\]?\(\/\/[^)]*\)/g, " ")             // protocol-relative (//url)
      .replace(/https?:\/\/\S+/g, " ")               // bare urls
      .replace(/[#>*_`~\[\]!]+/g, " ")               // md punctuation incl stray [ ] !
      .replace(/\s+/g, " ")
      .trim();
    if (s.length < 25) continue;                     // too short → not a lead
    if (!/[a-z]{4,}/i.test(s)) continue;             // no real words
    const sentence = (s.match(/^.*?[.!?](\s|$)/) || [s])[0].trim();
    const out = sentence.length > 40 ? sentence : s;
    return out.length > max ? out.slice(0, max - 1).replace(/\s\S*$/, "") + "…" : out;
  }
  return "";
}

// First inline image URL in a markdown body (hero fallback when no featured img).
// Handles both std ![alt](url) and the converter's (url)](url) linked-image mush.
function firstInlineImage(md) {
  if (!md) return "";
  const m = md.match(/\((https?:\/\/[^\s)]+\.(?:jpg|jpeg|png|webp|gif|avif|svg)[^\s)]*|\/\/[^\s)]+\.(?:jpg|jpeg|png|webp|gif|avif|svg)[^\s)]*)\)/i);
  if (!m) return "";
  let u = m[1];
  if (/-\d+x\d+\.(jpg|jpeg|png|webp|gif|avif)/i.test(u)) u = u.replace(/-\d+x\d+(\.(jpg|jpeg|png|webp|gif|avif))/i, "$1"); // prefer full-size
  return u.startsWith("//") ? "https:" + u : u;
}

function clip(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).replace(/\s\S*$/, "") + "…" : s; }

function pageScore(e) {
  const s = (e.slug || "").toLowerCase();
  let score = 0;
  if (s === "home" || s === "homepage" || s === "front-page") score += 100;
  if (/welcome|start/.test(s)) score += 20;
  score += Math.min((e.content_md || "").length / 200, 40); // richer page = better hero
  if (e.featured_image) score += 15;
  if (e.menu_order) score -= e.menu_order; // respect author ordering
  return score;
}

// Build nav from the richest extracted menu; fall back to top-level pages.
function buildNav(extract, pages) {
  const menus = extract.menus?.menus || [];
  const primary = menus.find((m) => /primary|main|header|nav/i.test(m.name + " " + m.slug)) || menus[0];
  if (primary?.items?.length) {
    return primary.items.slice(0, 7).map((it) => ({
      label: clip(it.label, 22),
      href: it.path || it.url || "#",
      external: /^https?:\/\//i.test(it.path || ""),
    }));
  }
  // Fallback: top-level pages by menu_order.
  return pages
    .filter((p) => !p.parent)
    .sort((a, b) => (a.menu_order || 0) - (b.menu_order || 0))
    .slice(0, 6)
    .map((p) => ({ label: clip(p.title, 22), href: "#" + (p.slug || ""), external: false }));
}

export function buildSiteModel(extract, brand) {
  const collections = extract.collections || [];
  const pagesCol = collections.find((c) => c.type === "page" || c.type === "pages");
  const postsCol = collections.find((c) => c.type === "post" || c.type === "posts");

  // Usable pages (drop utility/system/junk pages, empty stubs).
  const pages = (pagesCol?.entries || [])
    .filter((e) => e.title && !STOP_SLUGS.has((e.slug || "").toLowerCase()) && !isJunkEntry(e))
    .map((e) => ({
      title: e.title, slug: e.slug, parent: e.parent, menu_order: e.menu_order,
      excerpt: e.excerpt || leadText(e.content_md),
      body_md: e.content_md || "",
      image: e.featured_image || firstInlineImage(e.content_md) || "",
      image_alt: e.featured_image_alt || e.title,
    }));

  // Hero = best homepage candidate (or richest page, or newest post).
  const heroPage = [...pages].sort((a, b) => pageScore(b) - pageScore(a))[0];
  const posts = (postsCol?.entries || [])
    .filter((e) => e.title && !isJunkEntry(e))
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0))
    .map((e) => ({
      title: e.title, slug: e.slug, date: e.date,
      excerpt: e.excerpt || leadText(e.content_md, 140),
      image: e.featured_image || firstInlineImage(e.content_md) || "",
      image_alt: e.featured_image_alt || e.title,
      categories: e.categories || [],
    }));

  const siteName = extract.site?.name || brand?.business_name || heroPage?.title || "Your Business";
  const tagline = extract.site?.description || "";

  // Hardcoded hero copy (AI can override headline later, but this always works).
  const hero = {
    headline: tagline && tagline.length < 70 ? tagline : siteName,
    subheadline: leadText(heroPage?.body_md, 160) || tagline || `Welcome to ${siteName}.`,
    image: heroPage?.image || posts.find((p) => p.image)?.image || "",
    cta: "Get in touch",
  };

  // "Feature" cards: non-hero pages that have REAL text (no empty cards), and
  // NOT pages that already have a dedicated block (faq/contact/pricing/etc).
  const DEDICATED_FEAT = /faq|frequently|contact|get-in-touch|pricing|plans|packages|our-team|staff|privacy|terms|cart|checkout/i;
  const featurePages = pages.filter((p) => p !== heroPage && (p.excerpt || "").length > 20
    && !DEDICATED_FEAT.test((p.slug || "") + " " + (p.title || "")));
  let featureSrc = featurePages;
  if (featureSrc.length < 3) {
    const extra = posts.filter((p) => (p.excerpt || "").length > 20).map((p) => ({ title: p.title, excerpt: p.excerpt, image: p.image }));
    featureSrc = [...featurePages, ...extra];
  }
  const features = featureSrc.slice(0, 6).map((x) => ({
    title: clip(x.title, 48),
    text: clip(x.excerpt || "", 140),
    image: x.image || "",
  }));

  // Contact signal — did we find a contact page? (for the nav CTA target)
  const contactPage = pages.find((p) => /contact|get-in-touch|reach/.test((p.slug || "").toLowerCase()));

  // Content-type detections for the composer (galleries, faqs, testimonials,
  // team, pricing, services, timeline, videos, contact). Scan ALL entries.
  const allEntries = collections.flatMap((c) => (c.entries || []).filter((e) => !isJunkEntry(e)));
  const detections = detectContent({ allEntries, pages, heroSlug: heroPage?.slug });

  return {
    brand: {
      name: siteName,
      logo_url: brand?.logo_url || null,
      primary: brand?.primary || "#1f2933",
      secondary: brand?.secondary || "#e32735",
      text_on_primary: brand?.text || "#ffffff",
      color_confidence: brand?.confidence || "none",
    },
    nav: buildNav(extract, pages),
    hero,
    features,
    posts: posts.slice(0, 9),
    page_count: pages.length,
    post_count: posts.length,
    has_contact_page: !!contactPage,
    source_url: extract.site?.base || "",
    tagline,
    detections,
  };
}
