// RESOURCES — tutorials, guides, and useful articles for escaping WordPress.
// Each entry: {
//   title, url (external link), source (site/author),
//   type (article|video|tutorial|guide),
//   date (YYYY-MM-DD),
//   summary (2–3 sentences),
//   categories (array of strings — taxonomy),
//   image (optional path under /images/resources/),
//   slug (optional — auto-derived from title when omitted)
// }

export const RESOURCE_TYPE_LABEL = {
  article:  "Article",
  video:    "Video",
  tutorial: "Tutorial",
  guide:    "Guide",
};

export const resources = [
  {
    title:    "EmDash CMS Tutorial: Build Your First Site",
    url:      "https://markodenic.com/emdash-cms/",
    source:   "Marko Denic",
    type:     "tutorial",
    date:     "2026-11-07",
    categories: ["emdash", "how-tos"],
    summary:
      "A step-by-step guide covering EmDash from an empty folder to a running site with a published post — including content queries, Cloudflare deployment, and importing from WordPress. Covers the key differences from WordPress: sandboxed plugins, structured Portable Text content, passkey auth, and AI-tool support.",
    slug:     "emdash-cms-tutorial-markodenic",
  },
];

// ── helpers ──────────────────────────────────────────────────────────────────

export function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function getResourceSlug(r) {
  return r.slug || slugify(r.title);
}

export function fmtDate(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
}

/** All unique category values across the resource list, sorted. */
export function allCategories() {
  const set = new Set();
  resources.forEach(r => (r.categories || []).forEach(c => set.add(c)));
  return [...set].sort();
}
