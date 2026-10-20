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

// ---------------------------------------------------------------------------
// Menu / navigation extraction (best-effort; WP exposes menus inconsistently).
// Tries, in order:
//   1. WP-API Menus plugin   → /wp-json/wp-api-menus/v2/menus
//   2. WP REST Menus (v1)    → /wp-json/menus/v1/menus
//   3. Core menus endpoint   → /wp-json/wp/v2/menus (usually auth-walled)
//   4. Block-theme nav       → /wp-json/wp/v2/navigation (HTML-in-post)
//   5. Homepage <nav> HTML   → derive a flat menu from rendered links
// Each item is normalized to { label, url, path, parent_index, order, children }.
// ---------------------------------------------------------------------------

function normItem(label, url, base) {
  label = htmlToText(label || "").trim();
  url = (url || "").trim();
  let path = url;
  try {
    const u = new URL(url, base);
    // Keep internal paths relative so the agent can remap to new routes.
    path = u.host === new URL(base).host ? (u.pathname.replace(/\/$/, "") || "/") + u.hash : u.href;
  } catch {}
  return { label, url, path };
}

// Build a nested tree from a flat list that carries id + parent refs.
function nestById(flat) {
  const byId = new Map();
  flat.forEach((n) => byId.set(String(n._id), { ...n, children: [] }));
  const roots = [];
  for (const n of byId.values()) {
    const pid = n._parent != null ? String(n._parent) : "0";
    if (pid !== "0" && byId.has(pid)) byId.get(pid).children.push(n);
    else roots.push(n);
  }
  const strip = (nodes) =>
    nodes
      .sort((a, b) => (a._order || 0) - (b._order || 0))
      .map(({ _id, _parent, _order, ...rest }) => ({ ...rest, children: strip(rest.children) }));
  return strip(roots);
}

export async function extractMenus(base) {
  // 1) WP-API Menus plugin (richest: full items with parent + order)
  const listPlugin = await fetchJson(`${base}/wp-json/wp-api-menus/v2/menus`);
  if (listPlugin.ok && Array.isArray(listPlugin.data) && listPlugin.data.length) {
    const menus = [];
    for (const m of listPlugin.data.slice(0, 10)) {
      const detail = await fetchJson(`${base}/wp-json/wp-api-menus/v2/menus/${m.ID || m.term_id || m.id}`);
      const items = detail.ok && Array.isArray(detail.data?.items) ? detail.data.items : [];
      const flat = items.map((it) => ({
        ...normItem(it.title, it.url, base),
        _id: it.ID || it.id,
        _parent: it.parent || it.menu_item_parent || 0,
        _order: it.order || it.menu_order || 0,
      }));
      menus.push({ name: htmlToText(m.name || m.slug || "Menu"), slug: m.slug || "", items: nestById(flat) });
    }
    if (menus.some((x) => x.items.length)) return { source: "wp-api-menus", menus };
  }

  // 2) WP REST Menus v1
  const listV1 = await fetchJson(`${base}/wp-json/menus/v1/menus`);
  if (listV1.ok && Array.isArray(listV1.data) && listV1.data.length) {
    const menus = [];
    for (const m of listV1.data.slice(0, 10)) {
      const detail = await fetchJson(`${base}/wp-json/menus/v1/menus/${m.slug || m.term_id || m.id}`);
      const items = detail.ok && Array.isArray(detail.data?.items) ? detail.data.items : [];
      const flat = items.map((it) => ({
        ...normItem(it.title, it.url, base),
        _id: it.ID || it.id,
        _parent: it.menu_item_parent || it.parent || 0,
        _order: it.order || it.menu_order || 0,
      }));
      menus.push({ name: htmlToText(m.name || m.slug || "Menu"), slug: m.slug || "", items: nestById(flat) });
    }
    if (menus.some((x) => x.items.length)) return { source: "wp-rest-menus-v1", menus };
  }

  // 3) Block-theme navigation (HTML content inside a wp_navigation post)
  const nav = await fetchJson(`${base}/wp-json/wp/v2/navigation?per_page=10`);
  if (nav.ok && Array.isArray(nav.data) && nav.data.length) {
    const menus = [];
    for (const n of nav.data) {
      const html = n.content?.rendered || n.content?.raw || "";
      const items = linksFromHtml(html, base);
      if (items.length) menus.push({ name: htmlToText(n.title?.rendered || "Navigation"), slug: n.slug || "", items });
    }
    if (menus.length) return { source: "block-navigation", menus, notice: "Menu derived from block-theme navigation markup — hierarchy is best-effort." };
  }

  // 4) Last resort: scrape the homepage <nav> links.
  const home = await fetchText(base);
  if (home) {
    const navBlock = (home.match(/<nav\b[\s\S]*?<\/nav>/i) || [])[0] || home;
    const items = linksFromHtml(navBlock, base).slice(0, 40);
    if (items.length) {
      return {
        source: "homepage-html",
        menus: [{ name: "Primary (inferred)", slug: "primary", items }],
        notice: "No menu API was publicly available — this menu was inferred from the homepage navigation links and may be incomplete or include non-menu links.",
      };
    }
  }

  return null;
}

// Pull a flat list of {label,url,path} from anchor tags in an HTML blob.
function linksFromHtml(html, base) {
  if (!html) return [];
  const out = [];
  const seen = new Set();
  const aRe = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRe.exec(html)) && out.length < 60) {
    const href = m[1];
    if (/^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    const label = htmlToText(m[2]).trim();
    if (!label) continue;
    const item = normItem(label, href, base);
    const key = item.label + "|" + item.path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, children: [] });
  }
  return out;
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
    menus: await extractMenus(base).catch(() => null),
  };
}
