// WordPress REST API client for the content-liberation tool.
// Discovers content types, walks all entries with pagination, resolves
// taxonomies + featured media, and falls back to RSS when REST is locked down.

import { htmlToMarkdown, htmlToText } from "./html-to-markdown.js";

// WP core/internal types we never export as content collections.
const SKIP_TYPES = new Set([
  "attachment", "nav_menu_item", "wp_block", "wp_template", "wp_template_part",
  "wp_global_styles", "wp_navigation", "wp_font_family", "wp_font_face",
  "wp_navigation_menu", "oembed_cache", "custom_css", "customize_changeset",
  "revision", "user_request", "wp_pattern_category",
]);

const UA = "EscapeFromWP-Liberator/1.0 (+https://escapefromwp.com)";

// Normalize whatever the user typed into a base origin (https, no trailing slash).
export function normalizeSiteUrl(raw) {
  if (!raw) return null;
  let s = raw.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

async function fetchJson(url, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: ctrl.signal,
      cf: { cacheTtl: 0 },
    });
    const total = parseInt(res.headers.get("X-WP-Total") || "0", 10);
    const totalPages = parseInt(res.headers.get("X-WP-TotalPages") || "0", 10);
    const ct = res.headers.get("content-type") || "";
    if (!res.ok) return { ok: false, status: res.status, total, totalPages, data: null };
    if (!ct.includes("json")) return { ok: false, status: res.status, nonJson: true, data: null };
    const data = await res.json();
    return { ok: true, status: res.status, total, totalPages, data };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), data: null };
  } finally {
    clearTimeout(t);
  }
}

async function fetchText(url, { timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// Check the REST API is reachable and grab the site name.
export async function probeRest(base) {
  const root = await fetchJson(`${base}/wp-json/`);
  if (!root.ok || !root.data) return { rest: false };
  return {
    rest: true,
    name: htmlToText(root.data.name || ""),
    description: htmlToText(root.data.description || ""),
    gmt_offset: root.data.gmt_offset,
    namespaces: Array.isArray(root.data.namespaces) ? root.data.namespaces : [],
  };
}

// Discover which content types to export, with their REST base + labels.
export async function discoverTypes(base) {
  const r = await fetchJson(`${base}/wp-json/wp/v2/types`);
  if (!r.ok || !r.data) return [];
  const out = [];
  for (const [slug, info] of Object.entries(r.data)) {
    if (SKIP_TYPES.has(slug)) continue;
    if (info?.visibility && info.visibility.show_ui === false) continue;
    out.push({
      type: slug,
      rest_base: info.rest_base || slug,
      label: htmlToText(info.name || slug),
      labelSingular: htmlToText(info.labels?.singular_name || info.name || slug),
      hierarchical: !!info.hierarchical,
    });
  }
  return out;
}

// Pull a taxonomy term map { id: {name, slug} } for categories + tags.
async function fetchTermMap(base, taxRestBase) {
  const map = {};
  for (let page = 1; page <= 20; page++) {
    const r = await fetchJson(`${base}/wp-json/wp/v2/${taxRestBase}?per_page=100&page=${page}`);
    if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) break;
    for (const t of r.data) map[t.id] = { name: htmlToText(t.name), slug: t.slug };
    if (r.totalPages && page >= r.totalPages) break;
  }
  return map;
}

// Walk every entry of one type. Caps protect the Worker from runaway sites.
async function fetchAllEntries(base, restBase, { maxEntries = 500, maxPages = 20, terms = {} } = {}) {
  const entries = [];
  for (let page = 1; page <= maxPages; page++) {
    const r = await fetchJson(
      `${base}/wp-json/wp/v2/${restBase}?per_page=100&page=${page}&_embed=wp:featuredmedia&status=publish`
    );
    if (!r.ok || !Array.isArray(r.data) || r.data.length === 0) break;
    for (const p of r.data) {
      const fm = p?._embedded?.["wp:featuredmedia"]?.[0];
      const catIds = Array.isArray(p.categories) ? p.categories : [];
      const tagIds = Array.isArray(p.tags) ? p.tags : [];
      entries.push({
        id: p.id,
        slug: p.slug || "",
        status: p.status || "publish",
        title: htmlToText(p.title?.rendered || ""),
        excerpt: htmlToText(p.excerpt?.rendered || ""),
        content_html: p.content?.rendered || "",
        content_md: htmlToMarkdown(p.content?.rendered || ""),
        date: p.date || null,
        modified: p.modified || null,
        link: p.link || "",
        parent: p.parent || 0,
        menu_order: p.menu_order || 0,
        featured_image: fm?.source_url || "",
        featured_image_alt: htmlToText(fm?.alt_text || ""),
        categories: catIds.map((id) => terms.categories?.[id]?.name).filter(Boolean),
        tags: tagIds.map((id) => terms.tags?.[id]?.name).filter(Boolean),
        acf: p.acf && Object.keys(p.acf).length ? p.acf : undefined,
      });
      if (entries.length >= maxEntries) return { entries, capped: true };
    }
    if (r.totalPages && page >= r.totalPages) break;
  }
  return { entries, capped: false };
}

// RSS fallback — when REST is disabled. Lower fidelity: recent items only.
export async function fetchViaRss(base) {
  const xml = await fetchText(`${base}/feed/`);
  if (!xml) return null;
  const items = [];
  const itemRe = /<item\b[\s\S]*?<\/item>/gi;
  const pick = (block, tag) => {
    const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (!m) return "";
    return m[1].replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
  };
  let m;
  while ((m = itemRe.exec(xml)) && items.length < 100) {
    const block = m[0];
    const title = htmlToText(pick(block, "title"));
    const link = pick(block, "link");
    const date = pick(block, "pubDate");
    const html = pick(block, "content:encoded") || pick(block, "description");
    let slug = "";
    try { slug = new URL(link).pathname.replace(/\/$/, "").split("/").pop() || ""; } catch {}
    items.push({
      id: items.length + 1, slug, status: "publish", title,
      excerpt: "", content_html: html, content_md: htmlToMarkdown(html),
      date: date ? new Date(date).toISOString() : null, modified: null,
      link, parent: 0, menu_order: 0, featured_image: "", featured_image_alt: "",
      categories: [], tags: [],
    });
  }
  if (!items.length) return null;
  return [{ type: "post", rest_base: "posts", label: "Posts", labelSingular: "Post", entries: items, capped: false }];
}

// Top-level extraction orchestration.
export async function extractSite(base, { maxEntriesPerType = 500 } = {}) {
  const probe = await probeRest(base);

  if (!probe.rest) {
    const rss = await fetchViaRss(base);
    if (rss) return { ok: true, method: "rss", site: { name: "", base }, collections: rss, notice: "REST API unavailable — exported recent posts from the RSS feed only (limited export)." };
    return { ok: false, method: "none", error: "Could not reach the WordPress REST API or RSS feed. The site may block the API, require a password, or not be WordPress." };
  }

  const types = await discoverTypes(base);
  if (!types.length) {
    return { ok: false, method: "rest", error: "REST API responded but exposed no content types to export." };
  }

  // Shared taxonomy maps (posts use these; CPTs may too).
  const terms = {
    categories: await fetchTermMap(base, "categories"),
    tags: await fetchTermMap(base, "tags"),
  };

  const collections = [];
  for (const t of types) {
    const { entries, capped } = await fetchAllEntries(base, t.rest_base, { maxEntries: maxEntriesPerType, terms });
    if (entries.length === 0) continue; // skip empty types
    collections.push({ ...t, entries, capped });
  }

  if (!collections.length) {
    return { ok: false, method: "rest", error: "REST API is up but no published content was found to export." };
  }

  return {
    ok: true,
    method: "rest",
    site: { name: probe.name, description: probe.description, base },
    collections,
  };
}
