// Build a spec-correct EmDash content package for the "No, just give me a zip" path.
//
// IMPORTANT (why this was rebuilt): the first version shipped a hand-made Astro
// scaffold plus a schema-only `seed.json` at the repo root, with the actual
// pages/posts in loose `content/*.md` files. EmDash never reads those, so an AI
// bot that followed the zip produced an EMPTY site (header, no nav, no content).
//
// Per the real EmDash docs (docs.emdashcms.com/themes/seed-files):
//   - EmDash discovers a seed at `.emdash/seed.json`, or `package.json#emdash.seed`,
//     or `seed/seed.json`. It applies ONCE, on first setup, to an empty database.
//   - Seeded ENTRIES must live INSIDE the seed under a `content` block, grouped by
//     collection slug, each `{ id, slug, status, data:{...} }`.
//   - `portableText` fields are structured Portable Text JSON, NOT markdown/HTML.
//   - `settings` (title/tagline/url/logo) and `menus` also live in the seed.
//
// So this now emits:
//   - `seed/seed.json` — collections + ALL entries (as Portable Text) + settings,
//     the authoritative, spec-correct content payload EmDash actually ingests.
//   - `package.json` with `emdash.seed` -> "seed/seed.json" pointer.
//   - `content/<collection>/*.md` + `content.json` + `menus.json` — kept as
//     human/agent REFERENCE (and for the nav, which the agent wires up).
//   - `reference/your-exact-site.html` — the exact visual copy (design brief).
//   - AGENT_INSTRUCTIONS.md — scaffold from the REAL EmDash template, drop our
//     seed in, run first setup (THIS is the "import after setup" ordering fix),
//     then fuse the exact look.

import { extractSite, normalizeSiteUrl } from "../functions/api/_lib/wp-extract.js";
import { buildBundleFiles } from "../functions/api/_lib/build-bundle.js";
import { zipSync } from "../functions/api/_lib/zip.js";

export function slug(s) {
  return (s || "site").toString().toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "site";
}

export function slugify(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/_{2,}/g, "_").slice(0, 63) || "untitled";
}

// EmDash collection slug: lowercase, letters/numbers/underscore, start with a letter.
function emdashCollectionSlug(wpType) {
  let s = slugify(wpType);
  if (!/^[a-z]/.test(s)) s = "c_" + s;
  return s;
}

function depluralize(label) {
  if (!label) return label;
  if (/[^aeiou]ies$/i.test(label)) return label.replace(/ies$/i, "y");
  if (/(ches|shes|sses|xes|zes)$/i.test(label)) return label.replace(/es$/i, "");
  if (/ss$|us$|is$|ops$/i.test(label)) return label;
  if (/[^s]s$/i.test(label)) return label.replace(/s$/i, "");
  return label;
}

// Deterministic Portable Text key generator (stable across rebuilds for a given
// entry so re-seeding is idempotent).
function keyer(prefix) {
  let n = 0;
  return () => `${prefix}${(n++).toString(36)}`;
}

// Convert a markdown body into a minimal-but-valid Portable Text block array.
// Handles: ATX headings (#..######), unordered/ordered list items, blockquotes,
// and paragraphs. Inline markdown (bold/links) is left as literal text inside the
// span — faithful copy is preserved; the agent can enrich marks later. Images on
// their own line become image blocks with a `$media` URL (EmDash downloads them
// when a storage adapter is present, else keeps the URL as an external value).
function mdToPortableText(md) {
  const key = keyer("b");
  const skey = keyer("s");
  const blocks = [];
  const text = (md || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  if (!text.trim()) return blocks;

  const pushBlock = (style, listItem, content) => {
    const b = {
      _type: "block",
      _key: key(),
      style,
      markDefs: [],
      children: [{ _type: "span", _key: skey(), text: content, marks: [] }],
    };
    if (listItem) { b.listItem = listItem; b.level = 1; }
    blocks.push(b);
  };

  const paras = text.split(/\n{2,}/);
  for (let para of paras) {
    para = para.trim();
    if (!para) continue;

    // A standalone image: ![alt](url)
    const imgOnly = para.match(/^!\[[^\]]*\]\(([^)\s]+)[^)]*\)$/);
    if (imgOnly) {
      blocks.push({ _type: "image", _key: key(), asset: { $media: imgOnly[1] } });
      continue;
    }

    const lines = para.split("\n");
    const allUl = lines.every((l) => /^\s*[-*+]\s+/.test(l));
    const allOl = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
    if (allUl && lines.length) {
      for (const l of lines) pushBlock("normal", "bullet", l.replace(/^\s*[-*+]\s+/, "").trim());
      continue;
    }
    if (allOl && lines.length) {
      for (const l of lines) pushBlock("normal", "number", l.replace(/^\s*\d+[.)]\s+/, "").trim());
      continue;
    }

    const h = para.match(/^(#{1,6})\s+(.*)$/);
    if (h && lines.length === 1) {
      const lvl = Math.min(h[1].length, 6);
      const style = lvl === 1 ? "h1" : `h${lvl}`;
      pushBlock(style, null, h[2].trim());
      continue;
    }

    if (/^>\s?/.test(para)) {
      pushBlock("blockquote", null, para.replace(/^>\s?/gm, "").replace(/\n/g, " ").trim());
      continue;
    }

    // Default: a paragraph. Collapse soft line breaks into spaces.
    pushBlock("normal", null, para.replace(/\n/g, " ").trim());
  }
  return blocks;
}

// Derive the EmDash field set for a collection (mirrors build-bundle's mapping).
function fieldsFor(collection) {
  const hasCats = collection.entries.some((e) => e.categories?.length);
  const hasTags = collection.entries.some((e) => e.tags?.length);
  const hasImg = collection.entries.some((e) => e.featured_image);
  const hasExcerpt = collection.entries.some((e) => e.excerpt);
  const fields = [{ slug: "title", label: "Title", type: "string", required: true }];
  if (hasExcerpt) fields.push({ slug: "excerpt", label: "Excerpt", type: "text" });
  fields.push({ slug: "content", label: "Content", type: "portableText" });
  if (hasImg) fields.push({ slug: "featured_image", label: "Featured Image", type: "image" });
  if (hasCats) fields.push({ slug: "categories", label: "Categories", type: "multiSelect",
    options: [...new Set(collection.entries.flatMap((e) => e.categories || []))].map((c) => ({ label: c, value: slugify(c) })) });
  if (hasTags) fields.push({ slug: "tags", label: "Tags", type: "multiSelect",
    options: [...new Set(collection.entries.flatMap((e) => e.tags || []))].map((c) => ({ label: c, value: slugify(c) })) });
  return { fields, hasCats, hasTags, hasImg, hasExcerpt };
}

// Parse headings and associated paragraphs from the replica HTML so key sections
// are exposed as editable repeater blocks in EmDash.
export function extractSectionsFromHtml(html) {
  if (!html) return [];
  const headingRegex = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>([\s\S]*?)(?=<(?:h[1-3]|footer|body|$))/gi;
  let match;
  const sections = [];
  const seen = new Set();
  while ((match = headingRegex.exec(html)) !== null) {
    const heading = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!heading || heading.length < 3 || heading.length > 140 || seen.has(heading)) continue;
    seen.add(heading);
    const rest = match[3];
    const pMatch = rest.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const text = pMatch ? pMatch[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim() : "";
    sections.push({
      orig_heading: heading,
      heading: heading,
      orig_text: text,
      text: text,
    });
  }
  return sections;
}

// Build the spec-correct EmDash seed with collections + baked-in content + settings.
function buildSeed(extract, siteName, base, replicaHtml) {
  const collections = [];
  const content = {};
  const sections = extractSectionsFromHtml(replicaHtml);

  for (const c of extract.collections) {
    const cslug = emdashCollectionSlug(c.type);
    const { fields, hasImg, hasExcerpt, hasCats, hasTags } = fieldsFor(c);

    // If this is the page collection, add sections repeater so homepage sections are editable
    if ((c.type === "page" || cslug === "page") && sections.length) {
      // Put Page Sections right at the top under Title so users see them immediately
      const titleIdx = fields.findIndex((f) => f.slug === "title");
      const insertAt = titleIdx >= 0 ? titleIdx + 1 : 0;
      fields.splice(insertAt, 0, {
        slug: "sections",
        label: "Page Sections (Homepage)",
        type: "repeater",
        validation: {
          subFields: [
            { slug: "heading", label: "Section Heading", type: "string" },
            { slug: "text", label: "Section Text", type: "text" },
          ],
        },
      });
    }

    collections.push({
      slug: cslug,
      label: c.label,
      labelSingular: c.labelSingular && c.labelSingular !== c.label ? c.labelSingular : depluralize(c.label),
      fields,
      supports: ["drafts", "revisions", "preview", "search", "seo"],
    });

    const entries = [];
    const seen = new Set();
    for (const e of c.entries) {
      let s = e.slug || slugify(e.title) || String(e.id || "");
      if (!s) s = `entry-${entries.length + 1}`;
      // Ensure unique slug within the collection (seed conflict key).
      let uniq = s, i = 2;
      while (seen.has(uniq)) uniq = `${s}-${i++}`;
      seen.add(uniq);

      const isHome = (uniq === "home" || uniq === "front-page" || (cslug === "page" && entries.length === 0));
      const data = { title: e.title || uniq };
      if (hasExcerpt && e.excerpt) data.excerpt = e.excerpt;
      // The homepage layout is driven by native sections, not raw content markdown.
      // Omit raw markdown for home so the admin is clean and uncluttered.
      data.content = isHome ? [] : mdToPortableText(e.content_md);
      if (hasImg && e.featured_image) data.featured_image = { $media: e.featured_image };
      if (hasCats && e.categories?.length) data.categories = e.categories.map((x) => slugify(x));
      if (hasTags && e.tags?.length) data.tags = e.tags.map((x) => slugify(x));

      // Attach sections to the home page entry (clean heading + text only)
      if (isHome && sections.length) {
        data.sections = sections.map((s) => ({
          heading: s.heading,
          text: s.text,
        }));
      }

      entries.push({
        id: `${cslug}-${uniq}`,
        slug: uniq,
        status: (e.status === "publish" || e.status === "published" || !e.status) ? "published" : "draft",
        data,
      });
    }
    if (entries.length) content[cslug] = entries;
  }

  let url;
  try { url = new URL(base).origin; } catch { url = undefined; }

  const menus = [];
  if (extract.menus && Array.isArray(extract.menus.menus)) {
    function mapItems(items) {
      if (!Array.isArray(items)) return [];
      return items.map((it) => {
        const item = {
          type: "custom",
          label: it.label || "Link",
          url: it.path || it.url || "/",
        };
        if (it.children && it.children.length) {
          item.children = mapItems(it.children);
        }
        return item;
      });
    }
    for (const m of extract.menus.menus) {
      menus.push({
        name: "primary",
        label: m.name || "Primary Navigation",
        items: mapItems(m.items),
      });
    }
  }

  const seed = {
    $schema: "https://emdashcms.com/seed.schema.json",
    version: "1",
    meta: {
      name: siteName,
      description: `Content migrated from ${base} by Escape From WP`,
      author: "Escape From WP",
    },
    settings: {
      title: siteName,
      ...(extract.site?.tagline ? { tagline: extract.site.tagline } : {}),
      ...(url ? { url } : {}),
    },
    collections,
    content,
    ...(menus.length ? { menus } : {}),
  };
  return seed;
}

function scaffoldPackageJson(siteSlug) {
  return JSON.stringify({
    name: siteSlug,
    version: "0.1.0",
    private: true,
    type: "module",
    emdash: {
      seed: "seed/seed.json",
    },
    scripts: {
      dev: "astro dev",
      build: "astro build",
      preview: "astro preview",
      start: "node ./dist/server/entry.mjs",
    },
    dependencies: {
      "@astrojs/node": "^11.1.5",
      "@astrojs/react": "^7.0.0",
      astro: "^7.3.2",
      emdash: "^1.3.0",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
    },
  }, null, 2);
}

// Rewrite internal links pointing to the original site to root-relative paths
// (e.g. href="https://example.com/about/" -> href="/about/") so the site's menu
// and navigation stay on the new site with identical slugs and no redirects.
export function rewriteInternalLinks(html, sourceUrl) {
  if (!html || !sourceUrl) return html;
  try {
    const u = new URL(sourceUrl);
    const host = u.hostname.replace(/^www\./i, "");
    const regex = new RegExp(`\\bhref=["'](?:https?:)?\\/\\/(?:www\\.)?${host.replace(/\\./g, "\\.")}(?::\\d+)?(\\/[^"']*)?["']`, "gi");
    return html.replace(regex, (m, p) => {
      const cleanPath = p || "/";
      return `href="${cleanPath}"`;
    });
  } catch (_) {
    return html;
  }
}

// Pull the exact-copy replica HTML apart and rebundle it so the downloaded site
// renders IDENTICALLY offline, with no dependency on escapefromwp.com:
//   - every rehosted asset (/replica-asset/<id>/<file> on our origin) is fetched
//     and written into the zip under public/_site/<file>
//   - the HTML's references are rewritten to the local /_site/<file> path
//   - all internal links are rewritten to root-relative paths so the menus work locally
// Returns { html, assets: [{name,data(Uint8Array)}] } or null if nothing usable.
export async function localizeReplica(replicaHtml, sourceUrl, env) {
  if (!replicaHtml || replicaHtml.length < 500) return null;
  // Rewrite internal links to relative paths first.
  let html = rewriteInternalLinks(replicaHtml, sourceUrl);

  // Find every absolute reference to one of our rehosted assets.
  const re = /https?:\/\/[^"')\s]+\/replica-asset\/([0-9a-f]{32})\/([A-Za-z0-9._-]+)/g;
  const matches = [...html.matchAll(re)];
  const seen = new Set();
  const targets = [];
  for (const m of matches) {
    const fullUrl = m[0];
    const previewId = m[1];
    const file = m[2];
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    targets.push({ fullUrl, previewId, file });
  }

  const assets = [];
  const UA = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "accept": "*/*",
  };

  // Process in concurrent batches of 25 — reading directly from R2 if env.EXPORTS is available!
  const BATCH_SIZE = 25;
  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async ({ fullUrl, previewId, file }) => {
      try {
        let buf = null;
        if (env && env.EXPORTS) {
          const key = `replica-assets/${previewId}/${file}`;
          const obj = await env.EXPORTS.get(key);
          if (obj) buf = new Uint8Array(await obj.arrayBuffer());
        }
        if (!buf) {
          const res = await fetch(fullUrl, { headers: UA, cf: { cacheTtl: 0 } });
          if (res.ok) buf = new Uint8Array(await res.arrayBuffer());
        }
        if (buf && buf.byteLength) {
          assets.push({ name: `public/_site/${file}`, data: buf });
          html = html.split(fullUrl).join(`/_site/${file}`);
        }
      } catch (_) { /* skip a failed asset, keep going */ }
    }));
  }

  // Any stray references to our origin that we couldn't bundle: leave them absolute
  // (still load online) rather than break them.
  return { html, assets };
}

// Build a static Astro homepage that renders the exact-copy HTML verbatim, plus an
// Astro config set up for a plain static build. This means the DOWNLOADED site looks
// exactly like the original the moment it runs — the bot's job becomes wiring the
// seeded content into the other routes, not recreating the design from scratch.
export function staticHomepageFiles(localizedHtml) {
  const files = [];
  // Serve the exact copy as the root route via a passthrough Astro page. We emit the
  // full original document untouched (doctype/head/body) so styling is pixel-identical.
  // Astro's own wrapper is avoided by writing it as a static file in public/.
  files.push({ name: "public/index.html", data: localizedHtml });
  // Minimal Astro config so `npm run dev`/`build` works for the rest of the site.
  files.push({
    name: "astro.config.mjs",
    data: `import { defineConfig } from "astro/config";\n\n// The exact-copy homepage ships as public/index.html (pixel-identical to your old\n// site, assets bundled locally under public/_site/). Build the EmDash-driven routes\n// in src/pages/ for your other collections; see AGENT_INSTRUCTIONS.md.\nexport default defineConfig({\n  // output: "static" by default — fine for a content site.\n});\n`,
  });
  return files;
}

// Complete turnkey EmDash project scaffolding (Astro 7 + EmDash + React + Node adapter).
// Ships a runnable CMS project out of the box — zero external scaffolding needed.
export function emdashProjectFiles(siteName, siteSlug, localizedHtml, sections = []) {
  const files = [];

  // astro.config.mjs with Node/SQLite local dev setup for EmDash
  files.push({
    name: "astro.config.mjs",
    data: `import node from "@astrojs/node";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

export default defineConfig({
  output: "server",
  adapter: node({
    mode: "standalone",
  }),
  image: {
    layout: "constrained",
    responsiveStyles: true,
  },
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: "file:./data.db" }),
      storage: local({
        directory: "./uploads",
        baseUrl: "/_emdash/api/media/file",
      }),
    }),
  ],
  devToolbar: { enabled: false },
});
`,
  });

  // tsconfig.json
  files.push({
    name: "tsconfig.json",
    data: JSON.stringify({
      extends: "astro/tsconfigs/strict",
      compilerOptions: {
        jsx: "react-jsx",
        jsxImportSource: "react",
      },
    }, null, 2),
  });

  // src/live.config.ts
  files.push({
    name: "src/live.config.ts",
    data: `import { defineLiveCollection } from "astro:content";
import { emdashLoader } from "emdash/runtime";

export const collections = {
  _emdash: defineLiveCollection({ loader: emdashLoader() }),
};
`,
  });

  // src/utils/site-identity.ts
  files.push({
    name: "src/utils/site-identity.ts",
    data: `export function resolveStarterSiteIdentity(settings) {
  return {
    siteTitle: (settings && settings.title) || ${JSON.stringify(siteName)},
    siteTagline: (settings && settings.tagline) || "",
    siteLogo: (settings && settings.logo) || null,
  };
}
`,
  });

  // src/layouts/Base.astro
  files.push({
    name: "src/layouts/Base.astro",
    data: `---
import { getMenuWithCacheHint, getSiteSettingsWithCacheHint } from "emdash";
import { EmDashHead, EmDashBodyStart, EmDashBodyEnd } from "emdash/ui";
import { createPublicPageContext } from "emdash/page";
import { resolveStarterSiteIdentity } from "../utils/site-identity";

interface Props {
  title?: string;
  pageTitle?: string | null;
  description?: string | null;
  image?: string | null;
  canonical?: string | null;
  content?: { collection: string; id: string; slug?: string | null };
}

const { title = ${JSON.stringify(siteName)}, pageTitle, description, image, canonical, content } = Astro.props;
const [settingsResult, menuResult] = await Promise.all([
  getSiteSettingsWithCacheHint(),
  getMenuWithCacheHint("primary"),
]);
if (Astro.cache?.enabled) {
  Astro.cache.set(settingsResult.cacheHint);
  Astro.cache.set(menuResult.cacheHint);
}

const { siteTitle, siteTagline, siteLogo } = resolveStarterSiteIdentity(settingsResult.data);
const fullTitle = title === siteTitle ? title : \`\${title} — \${siteTitle}\`;
const pageDescription = description ?? siteTagline;
const menu = menuResult.data;

const pageCtx = createPublicPageContext({
  Astro,
  kind: content ? "content" : "custom",
  pageType: "website",
  title: fullTitle,
  pageTitle: pageTitle ?? title,
  description: pageDescription,
  canonical,
  image,
  content,
  siteName: siteTitle,
});
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{fullTitle}</title>
    <EmDashHead page={pageCtx} />
    <style>
      :root {
        --font-sans: system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;
      }
      body {
        margin: 0;
        font-family: var(--font-sans);
        color: #1e293b;
        line-height: 1.6;
        background: #fff;
      }
      header {
        border-bottom: 1px solid #e2e8f0;
        padding: 1rem 1.5rem;
        display: flex;
        justify-content: space-between;
        align-items: center;
        max-width: 1200px;
        margin: 0 auto;
      }
      .brand {
        font-weight: 700;
        font-size: 1.25rem;
        color: #0f172a;
        text-decoration: none;
      }
      nav {
        display: flex;
        gap: 1.25rem;
        align-items: center;
        flex-wrap: wrap;
      }
      nav a {
        color: #475569;
        text-decoration: none;
        font-size: 0.95rem;
        font-weight: 500;
      }
      nav a:hover {
        color: #0f172a;
      }
      main {
        max-width: 1200px;
        margin: 2rem auto;
        padding: 0 1.5rem;
      }
      article h1 {
        margin-top: 0;
        font-size: 2.25rem;
        color: #0f172a;
      }
    </style>
  </head>
  <body>
    <EmDashBodyStart page={pageCtx} />
    <header>
      <a class="brand" href="/">
        {siteLogo ? <img src={siteLogo.url} alt={siteLogo.alt || siteTitle} style="height:40px;width:auto;" /> : siteTitle}
      </a>
      <nav>
        {menu?.items?.map((item: any) => (
          <a href={item.url} target={item.target}>{item.label}</a>
        ))}
      </nav>
    </header>
    <main>
      <slot />
    </main>
    <EmDashBodyEnd page={pageCtx} />
  </body>
</html>
`,
  });

  // src/pages/index.astro: real native Astro template with extracted CSS and live EmDash variables
  if (localizedHtml && localizedHtml.length > 500) {
    // 1. Extract all inlined <style> blocks and write to public/_site/original-styles.css
    const styles = [...localizedHtml.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join("\n\n");
    if (styles.length) {
      files.push({ name: "public/_site/original-styles.css", data: styles });
    }

    // 2. Extract body
    const bodyMatch = localizedHtml.match(/<body([^>]*)>([\s\S]*?)<\/body>/i);
    const bodyAttrs = bodyMatch ? bodyMatch[1] : "";
    let body = bodyMatch ? bodyMatch[2] : localizedHtml;

    // Remove inlined style tags from body (they now live in original-styles.css)
    body = body.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

    // Ensure scripts in body are marked is:inline so Astro does not bundle or hoist them
    body = body.replace(/<script\b(?![^>]*\bis:inline\b)/gi, "<script is:inline");

    // Wire extracted headings into the template as real Astro variables
    const fieldDefs = [];
    if (sections && sections.length) {
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        const varName = `sec_${i}_heading`;
        fieldDefs.push(`const ${varName} = (home?.data?.sections && home.data.sections[${i}]?.heading) || ${JSON.stringify(s.heading)};`);
        body = body.replace(s.orig_heading, `{${varName}}`);
      }
    }

    files.push({
      name: "src/pages/index.astro",
      data: `---
import { getEmDashEntry } from "emdash";

// Fetch the Home page from EmDash
let home = null;
for (const col of ["page", "pages"]) {
  try {
    const res = await getEmDashEntry(col, "home");
    if (res && res.entry) { home = res.entry; break; }
  } catch (_) {}
}

const data = home?.data || {};

${fieldDefs.join("\n")}
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{data.title || ${JSON.stringify(siteName)}}</title>
    ${styles.length ? '<link rel="stylesheet" href="/_site/original-styles.css" />' : ""}
  </head>
  <body${bodyAttrs}>
${body}
  </body>
</html>
`,
    });
  } else {
    files.push({
      name: "src/pages/index.astro",
      data: `---
import Base from "../layouts/Base.astro";
---
<Base title=${JSON.stringify(siteName)}>
  <h1>${siteName}</h1>
  <p>Your EmDash CMS site is ready. Visit <a href="/_emdash/admin">/_emdash/admin</a> to manage your content.</p>
</Base>
`,
    });
  }

  // src/pages/[slug].astro (for CMS pages)
  files.push({
    name: "src/pages/[slug].astro",
    data: `---
import { getEmDashEntry, getSeoMeta, decodeSlug, getSiteSettings } from "emdash";
import { PortableText } from "emdash/ui";
import Base from "../layouts/Base.astro";
import { resolveStarterSiteIdentity } from "../utils/site-identity";

const slug = decodeSlug(Astro.params.slug);
if (!slug) return Astro.rewrite("/404");

let page = null;
let foundCol = "page";
for (const col of ["page", "pages", "post", "posts"]) {
  try {
    const res = await getEmDashEntry(col, slug);
    if (res && res.entry) {
      page = res.entry;
      foundCol = col;
      if (Astro.cache?.enabled && res.cacheHint) Astro.cache.set(res.cacheHint);
      break;
    }
  } catch (_) {}
}

if (!page) return Astro.rewrite("/404");

const { siteTitle } = resolveStarterSiteIdentity(await getSiteSettings());

const seo = getSeoMeta(page, {
  siteTitle,
  siteUrl: Astro.url.origin,
  path: Astro.url.pathname.replace(/\\/$/, ""),
});
---

<Base
  title={seo.title}
  pageTitle={seo.ogTitle}
  description={seo.description}
  canonical={seo.canonical}
  content={{ collection: foundCol, id: page.data.id, slug }}
>
  <article>
    <h1 {...page.edit.title}>{page.data.title}</h1>
    <PortableText value={page.data.content} />
  </article>
</Base>
`,
  });

  // src/pages/posts/[slug].astro (for CMS posts)
  files.push({
    name: "src/pages/posts/[slug].astro",
    data: `---
import { getEmDashEntry, getSeoMeta, decodeSlug, getSiteSettings } from "emdash";
import { Image, PortableText } from "emdash/ui";
import Base from "../../layouts/Base.astro";
import { resolveStarterSiteIdentity } from "../../utils/site-identity";

const slug = decodeSlug(Astro.params.slug);
if (!slug) return Astro.rewrite("/404");

const { entry: post, cacheHint } = await getEmDashEntry("posts", slug);
if (!post) return Astro.rewrite("/404");

if (Astro.cache?.enabled) Astro.cache.set(cacheHint);
const { siteTitle } = resolveStarterSiteIdentity(await getSiteSettings());

const seo = getSeoMeta(post, {
  siteTitle,
  siteUrl: Astro.url.origin,
  path: Astro.url.pathname.replace(/\\/$/, ""),
});
---

<Base
  title={seo.title}
  pageTitle={seo.ogTitle}
  description={seo.description}
  canonical={seo.canonical}
  image={seo.ogImage}
  content={{ collection: "posts", id: post.data.id, slug }}
>
  <article>
    {post.data.featured_image && (
      <div {...post.edit.featured_image}>
        <Image image={post.data.featured_image} />
      </div>
    )}
    <h1 {...post.edit.title}>{post.data.title}</h1>
    <PortableText value={post.data.content} />
  </article>
</Base>
`,
  });

  // src/pages/posts/index.astro (for posts list)
  files.push({
    name: "src/pages/posts/index.astro",
    data: `---
import { getEmDashCollection } from "emdash";
import { Image } from "emdash/ui";
import Base from "../../layouts/Base.astro";

const { entries: posts, cacheHint } = await getEmDashCollection("posts", {
  orderBy: { published_at: "desc" },
  limit: 20,
});
if (Astro.cache?.enabled) Astro.cache.set(cacheHint);
---

<Base title="All Posts">
  <h1>Posts</h1>
  {posts.length === 0 ? (
    <p>No posts yet.</p>
  ) : (
    <ul>
      {posts.map((post: any) => (
        <li>
          <a href={\`/posts/\${post.slug || post.id}\`}>
            {post.data.featured_image && (
              <div {...post.edit.featured_image}><Image image={post.data.featured_image} /></div>
            )}
            <h2 {...post.edit.title}>{post.data.title}</h2>
          </a>
          {post.data.excerpt && <p {...post.edit.excerpt}>{post.data.excerpt}</p>}
        </li>
      ))}
    </ul>
  )}
</Base>
`,
  });

  // src/pages/404.astro
  files.push({
    name: "src/pages/404.astro",
    data: `---
import Base from "../layouts/Base.astro";
---

<Base title="Page Not Found">
  <h1>404 - Page Not Found</h1>
  <p>The page you are looking for does not exist.</p>
  <a href="/">Go to Homepage</a>
</Base>
`,
  });

  // src/pages/page/[slug].astro: redirects /page/home -> / and /page/[slug] -> /[slug]
  // (so EmDash admin "Live view" buttons always find the right page)
  files.push({
    name: "src/pages/page/[slug].astro",
    data: `---
const { slug } = Astro.params;
if (slug === "home" || slug === "front-page") {
  return Astro.redirect("/", 302);
}
return Astro.redirect(\`/\${slug}\`, 302);
---
`,
  });

  // src/pages/post/[slug].astro: redirects /post/[slug] -> /posts/[slug]
  files.push({
    name: "src/pages/post/[slug].astro",
    data: `---
const { slug } = Astro.params;
return Astro.redirect(\`/posts/\${slug}\`, 302);
---
`,
  });

  return files;
}

// The exact human-facing handoff message the building agent must send the shop owner
// when the build is done. Inlined as the final numbered step of AGENT_INSTRUCTIONS.md
// (not shipped as a separate file — one file, one place to look).
// siteName/totalEntries are pre-filled; only the URL placeholder is left for the agent.
function handoffMessage(siteName, totalEntries) {
  return `🎉 **Your new site is live:** [REPLACE THIS WITH THE REAL SITE URL BEFORE SENDING]

## 🚨 STEP 1 — THE ONE CHOICE YOU CAN'T GET WRONG (please read)
The very first time you open your new site's admin, a **setup wizard** appears and asks
what content to start with. This is the single most important moment of the whole process.

### 👉 Choose **"Include sample content"** — NOT "Empty site."

That "sample content" is **your real ${siteName} content — all ${totalEntries} of your pages and posts.** It only *looks* like a generic option; it is actually everything we migrated for you.

⚠️ **If you choose "Empty site," you get a blank shell — none of your ${totalEntries} pages** — and there is **NO way to add them back later** except wiping it and starting the setup over. There is no undo button for this.

✅ **So, one more time: when the wizard asks, pick "Include sample content." Every single time.**

> **Already ran setup and your site came up empty?** No harm done — just reset to a fresh/empty database and run the setup again, this time choosing **"Include sample content."** (Re-importing into a site that's already set up will NOT work — it has to be a clean start.)

## ⚠️ STEP 2 — SOME INTERACTIVE THINGS MIGHT NEED A QUICK TOUCH-UP (totally normal)
Your site is an exact copy of your old one, but a handful of features used to be powered
by WordPress behind the scenes. When we freed your site from WordPress, we re-wired the
common ones (like your **mobile menu**) — but on some sites, one or two interactive bits
may still act up at first. The usual suspects:

- 📱 the **mobile / hamburger menu**
- 🔽 **dropdown** menus
- 🎞️ **sliders / carousels**
- ➕ **accordions / FAQ toggles**
- 📝 **forms** (contact, sign-up — these talked to WordPress and may need reconnecting)

**None of this is cause for worry — it's expected, and every bit of it is fixable.** You
don't need to hunt for problems or understand any of it.

## 💬 STEP 3 — I'VE GOT YOU, JUST POINT AND I'LL FIX IT
Take a minute to click around your new site — **especially on your phone** — and try the
menus, buttons, forms, and anything that moves.

👉 **If ANYTHING doesn't work or doesn't look right, just tell me what it is in plain words and I'll fix it for you.** You don't need technical terms — things like *"the menu on mobile doesn't open"* or *"the contact form doesn't send"* or *"the slider is stuck"* are perfect. Point me at it and I'll handle the rest. 🙂`;
}

function agentInstructions(siteName, host, stats, totalEntries, menuData, prebuiltHome) {
  const list = (stats || []).map((s) => `- \`${s.collection}\` — ${s.entries} entr${s.entries === 1 ? "y" : "ies"}`).join("\n") || "- (see seed/seed.json)";
  const menuNote = menuData
    ? `\nThis package also includes \`menus.json\` (${menuData.menus.length} menu${menuData.menus.length === 1 ? "" : "s"}, source: \`${menuData.source}\`). The seed does NOT pre-create menus — build them in the admin (or add a \`menus\` block to the seed) so the nav links to the entries you just seeded.`
    : "";
  const designSection = prebuiltHome
    ? `## The design is ALREADY BUILT — do not recreate it
This package ships your homepage **pre-built and pixel-identical** to the original at
\`public/index.html\`, with every image/font/stylesheet bundled locally under
\`public/_site/\`. The moment you run the project it looks exactly like your old site —
you do **not** rebuild the design from scratch.

**Your job on the design is to PRESERVE it, then extend it:**
- Leave \`public/index.html\` as the faithful homepage, OR port it into
  \`src/layouts/Base.astro\` + \`src/pages/index.astro\` **verbatim** (same markup, same
  inline CSS, same \`/_site/...\` asset paths) if you want it EmDash-driven. Either way
  the visual result must stay identical — same fonts, colors, spacing, header, footer.
- **Never** replace it with a generic/starter theme. If your result doesn't look like
  \`public/index.html\`, you did it wrong — diff against it.
- Reuse the exact header/footer markup + styles from \`public/index.html\` for every
  other route so the whole site is visually consistent with the original.

### 🔌 CRITICAL: keep the interaction scripts, or the menu dies
\`public/index.html\` ends with TWO small \`<script>\` tags just before \`</body>\` that
make the **mobile menu, dropdowns, and accordions** work with no WordPress/jQuery:
  - \`<script data-efw="replay">…</script>\` — replays the exact open/close behavior we
    recorded from your live site.
  - \`<script data-efw="interactions">…</script>\` — a generic fallback for anything not
    recorded.
These are self-contained vanilla JS. **If you port the homepage into \`Base.astro\` or
reuse the header on other routes, you MUST carry BOTH scripts into the shared layout**
(put them at the end of \`<body>\` in \`Base.astro\` so every page gets them). Two ways to
lose the menu — avoid both:
  1. **Don't strip them.** An agent "cleaning up" the HTML often deletes inline scripts.
     Keep these two verbatim.
  2. **Astro gotcha — mark them \`is:inline\`.** Astro processes/hoists any \`<script>\` in a
     \`.astro\` file by default, which breaks these. Write them as
     \`<script is:inline data-efw="replay">\` and \`<script is:inline data-efw="interactions">\`
     so Astro ships them to the browser untouched.
Verify after porting: load a page on a narrow screen, tap the hamburger — the nav must
open AND close. If it doesn't, you dropped or hoisted one of these scripts.`
    : `## Match the exact design
\`reference/your-exact-site.html\` is a pixel-faithful, self-contained copy of your old
homepage (CSS inlined, assets rehosted). **It is your design brief — reproduce it
exactly.** Extract its fonts, colors, spacing, header, and footer and build your Astro
layout + homepage to match. Do NOT ship a generic/starter theme.

### 🔌 Keep the interaction scripts for the menu
\`reference/your-exact-site.html\` ends with two \`<script>\` tags (\`data-efw="replay"\` and
\`data-efw="interactions"\`) that drive the mobile menu/dropdowns with no WordPress. Copy
BOTH into your \`Base.astro\` (end of \`<body>\`), and in Astro mark them \`is:inline\` —
\`<script is:inline data-efw="replay">\` — or Astro will hoist/break them and the menu
won't open.`;
  return `# Rebuild ${siteName} in EmDash — instructions for your AI coding assistant

> 🚨🚨 **STOP — TWO NON-NEGOTIABLE RULES BEFORE YOU DO ANYTHING ELSE** 🚨🚨
>
> **1. Your job is NOT done until you send the site owner the exact handoff message found
> in the "MESSAGE FOR THE SITE OWNER" section at the very bottom of this file** (it is the
> final numbered step, Step 11). Copy it **verbatim**, replace only the URL placeholder,
> and send it as your final reply. Do **NOT**
> rewrite it, shorten it, summarize it into a line or two, or replace it with your own
> wording. It is deliberately long and emphatic because the user is a shop owner, not a
> developer. Ending with just "it's live" or a link is a **FAILED task.**
>
> **2. The #1 way this migration fails is the user picking the wrong option in the EmDash
> setup wizard.** The handoff message's STEP 1 warns them to choose **"Include sample
> content"** (their real content) and NOT "Empty site." That warning must reach the user
> loud and intact — it's the whole reason the message exists. Do not soften or drop it.

You have an **EmDash content package** extracted from **${host}**: a spec-correct
EmDash **seed** (with every page/post baked in)${prebuiltHome ? ", a **pre-built exact-copy homepage**," : ", an **exact HTML copy** of the original homepage,"}
so your content AND your look are already done — you just assemble them.

> ⚠️ **Read this first — ordering matters.** In EmDash a seed is applied **once, on
> first setup, to an empty database** (see docs.emdashcms.com/themes/overview
> → "First setup"). You cannot "import content later" into an already-set-up site by
> re-running the seed. So the content must be in place as part of the seed BEFORE you
> complete the setup wizard. That is exactly how this package is built — do the steps
> in order and the content loads itself.

## What's in this package
- \`seed/seed.json\` — **the authoritative content.** Defines one collection per
  content type AND contains every entry (as Portable Text) plus site settings.
  EmDash ingests this on first setup. This is the file that makes your content appear.
- \`package.json\` — already points EmDash at the seed (\`emdash.seed\`).
${prebuiltHome ? `- \`public/index.html\` + \`public/_site/\` — your **pre-built, pixel-identical homepage**
  and its locally-bundled assets. This IS the design, already done.
- \`astro.config.mjs\` — minimal config so the project runs.` : `- \`reference/your-exact-site.html\` — the pixel-faithful visual copy. **Your design brief.**`}
- \`content/<collection>/*.md\`, \`content.json\`, \`menus.json\` — human/agent-readable
  REFERENCE copies of the same content + the navigation. Not read by EmDash directly.

## Content model
${list}
Total: **${totalEntries} entries.**

${designSection}

## Step-by-step
1. **Install dependencies:**
   \`\`\`bash
   npm install
   \`\`\`
2. **Start the local dev server:**
   \`\`\`bash
   npm run dev
   \`\`\`
3. **Run first setup — this is where the content imports.** Open
   \`http://localhost:4321/_emdash/admin\` (⚠️ MUST use \`localhost\`, NEVER \`127.0.0.1\` — passkeys require a secure context).
   The first visit launches the **setup wizard**. Enter the site identity + admin user, and **choose to INCLUDE sample content**
   when asked — that is what applies the seed's entries and navigation menus. Finish the wizard. Your collections
   and all entries are now in the database. (If you skip "include content", the entries
   won't load — re-run against a fresh DB.)
   *(Tip: you can also bypass the passkey setup locally by visiting \`http://localhost:4321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin\`)*.
4. **Verify content:** the EmDash admin should now list every collection with its entries and menus.
${prebuiltHome
  ? `5. **Verify the look:** open \`http://localhost:4321/\` — it already renders your exact
   homepage with all original styles and interactive menus intact.
6. **Inner page templates:** \`src/pages/[slug].astro\` and \`src/pages/posts/[slug].astro\` are
   already provided, rendering content entries with the dynamic EmDash menu.
7. **Other routes:** add one route per collection (e.g. \`src/pages/[slug].astro\`),
   reusing the SAME header/footer/styles from your exact site.`
  : `5. **Study the exact look:** open \`reference/your-exact-site.html\`. Extract design
   tokens — fonts, colors, spacing, header/footer, section layouts.
6. **Build the layout + homepage:** create \`src/layouts/Base.astro\` and rebuild
   \`src/pages/index.astro\` to match the reference, pulling text/images from the seeded
   collections via EmDash's content API + \`<PortableText />\`.
7. **Templates:** add one route per collection (e.g. \`src/pages/[slug].astro\`) styled
   to match the reference.`}${menuNote}
9. **Redirects:** add old→new 301s to \`public/_redirects\` before going live. No 404s.
10. **Deploy:** Cloudflare Pages + D1 + R2 (EmDash's standard target), or your host.
    Confirm \`npm run build\` succeeds and the deploy returns a working URL.
11. **🚨 SEND THE SITE-OWNER MESSAGE — this is a real build step, not optional cleanup.**
    Your job is **not done** when the deploy returns a URL. It is done when you have
    **sent the owner the exact message in the "MESSAGE FOR THE SITE OWNER" section below.**
    Copy that whole message verbatim, replace the URL placeholder with the real URL, and
    send it as your final reply. Do NOT summarize it, shorten it, drop a section, or
    reword it. Treat this exactly like Step 3 (\`npm install\`): a concrete action you
    perform, not a guideline. If you have not sent it, you have not finished.

## Rules
- The content is already structured — do NOT retype it. It's in \`seed/seed.json\`.
- ${prebuiltHome ? "The design is already built in \`public/index.html\` — PRESERVE it; never swap in a generic theme. Diff your result against it." : "Match \`reference/your-exact-site.html\` faithfully — it IS the brief."} Preserve copy exactly.
- Seed applies once on first setup; never rely on re-seeding a live site to add content.
- No live 404s — set redirects before changing URLs.

## ✅ YOU ARE NOT DONE UNTIL ALL OF THESE ARE TRUE
- [ ] \`npm run build\` succeeded
- [ ] The site is deployed and the URL opens and works
- [ ] The setup wizard was run with **"Include sample content"** so all ${totalEntries} entries loaded
- [ ] **The EXACT "MESSAGE FOR THE SITE OWNER" below has been sent, with the real URL filled in**

If the last box is not checked, the task is still open. Go send the message.

---
---
## 📋 EVERYTHING ABOVE IS FOR YOU, THE AGENT. EVERYTHING BELOW IS THE MESSAGE FOR THE SITE OWNER.
The site owner is NOT a developer — this message is written for a shop owner, not an
engineer. Send it **verbatim** as your final reply. Change **nothing** except replacing
the URL placeholder on the first line with the real local/deployed URL. Keep every
⚠️/🚨/👉 marker and all the bold text — they are what make the critical setup choice
impossible to miss. The #1 reason a migration "fails" is the owner picking "Empty site,"
so STEP 1 must be the loudest thing in your message. Do not add commentary before or
after it, and do not describe it ("here is the message...") — just send the message itself.
---
---

${handoffMessage(siteName, totalEntries)}
`;
}

// Main entry: returns { zip: Uint8Array, filename, siteName } or throws.
export async function buildEmdashZip(env, { id, sourceUrl, businessName, replicaHtml, kind }) {
  const k0 = kind === "bot" ? "bot" : "scripts";
  const base = normalizeSiteUrl(sourceUrl) || sourceUrl;
  const extract = await extractSite(base, { maxEntriesPerType: 500 });
  if (!extract || !extract.ok) {
    throw new Error("content extraction failed: " + (extract && extract.error ? extract.error : "unknown"));
  }
  const siteName = extract.site?.name || businessName || base;
  const host = (() => { try { return new URL(base).host; } catch { return "site"; } })();
  const siteSlug = slug(businessName || host);
  const stats = extract.collections.map((c) => ({ collection: emdashCollectionSlug(c.type), entries: c.entries.length }));
  const totalEntries = stats.reduce((n, s) => n + s.entries, 0);
  const menuData = extract.menus && extract.menus.menus?.length ? extract.menus : null;

  // Reference copies (markdown + content.json + menus.json) from the proven builder.
  const { files: bundle } = buildBundleFiles(extract, "emdash");

  const files = [];

  // 1) The authoritative, spec-correct EmDash seed (collections + content + settings).
  const seed = buildSeed(extract, siteName, base, replicaHtml);
  const homeEntry = (seed.content.page || []).find((e) => e.slug === "home" || e.slug === "front-page");
  const sections = homeEntry?.data?.sections || [];
  files.push({ name: "seed/seed.json", data: JSON.stringify(seed, null, 2) });

  // 2) package.json that points EmDash at the seed.
  files.push({ name: "package.json", data: scaffoldPackageJson(siteSlug) });
  files.push({ name: ".gitignore", data: "node_modules/\ndist/\n.astro/\n.env\n.wrangler/\n" });

  // 3) Reference copies — keep content/*.md + content.json + menus.json, but NOT the
  //    old bundle README/AGENT/seed (we write our own authoritative versions).
  for (const f of bundle) {
    if (f.name === "README.md" || f.name === "AGENT_INSTRUCTIONS.md" || f.name === "seed.json") continue;
    files.push({ name: f.name.startsWith("content/") || f.name.endsWith(".json") ? `reference/${f.name}` : f.name, data: f.data });
  }

  // 4) Exact-look reference HTML + PRE-BUILT, pixel-identical homepage.
  let prebuiltHome = false;
  let localized = null;
  if (replicaHtml && replicaHtml.length > 500) {
    const cleanReplica = rewriteInternalLinks(replicaHtml, sourceUrl);
    files.push({ name: "reference/your-exact-site.html", data: cleanReplica });
    try {
      localized = await localizeReplica(replicaHtml, sourceUrl, env);
      if (localized && localized.html) {
        for (const a of localized.assets) files.push(a);
        prebuiltHome = true;
      }
    } catch (_) { /* fall back to reference-only if localization fails */ }
  }

  // Push all turnkey EmDash project files (astro.config.mjs, tsconfig, Base.astro, src/pages/...)
  for (const f of emdashProjectFiles(siteName, siteSlug, localized ? localized.html : null, sections)) {
    files.push(f);
  }

  // 5) Instructions + README.
  // The handoff message the agent must send the owner lives INSIDE AGENT_INSTRUCTIONS.md
  // as its final numbered step — NOT as a separate file. A second file doubled the chance
  // an agent read one and missed the other (reported by a real agent), so it's inlined.
  files.push({ name: "AGENT_INSTRUCTIONS.md", data: agentInstructions(siteName, host, stats, totalEntries, menuData, prebuiltHome) });
  const readmeBot =
`# ${siteName} — your EmDash CMS project

Everything from **${host}**, packaged as a complete, ready-to-run **EmDash CMS** site.
Your content and navigation are pre-seeded, and your exact design is already built as the live homepage.

## Run it (2 commands)
\`\`\`bash
npm install
npm run dev
\`\`\`

- **Website:** 👉 \`http://localhost:4321\` (renders your exact site with all styling and menus working).
- **CMS Admin:** 👉 \`http://localhost:4321/_emdash/admin\` (⚠️ MUST use \`localhost\`, NEVER \`127.0.0.1\`).
  Complete first-time setup and choose **"Include sample content"** to import all ${totalEntries} entries and menus.
  *(Shortcut: bypass passkey setup locally via \`http://localhost:4321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin\`)*.

See **AGENT_INSTRUCTIONS.md** if you're working with an AI coding assistant.
`;
  const readmeScripts =
`# ${siteName} — your EmDash site (ready to run, no extra setup)

Everything from **${host}**, packaged as a complete, ready-to-run **EmDash CMS** site.
Your content and navigation are pre-seeded into EmDash, and your exact design${prebuiltHome ? " is already built as the live homepage" : " is included as reference"}.
Your mobile menu, dropdowns, and accordions already work (the interaction scripts are baked in) — no WordPress, no jQuery.

## Run it — just 2 commands!
\`\`\`bash
npm install
npm run dev
\`\`\`

- **Your homepage:** Renders immediately at 👉 **\`http://localhost:4321/\`** — pixel-identical to your old site, with all menu links matching your exact original slugs.
- **Your CMS Dashboard:** Open 👉 **\`http://localhost:4321/_emdash/admin\`**
  *(⚠️ **IMPORTANT:** MUST use \`localhost\`, NEVER \`127.0.0.1\` — browser passkey security blocks \`127.0.0.1\`)*.
  Complete the quick one-time setup and choose **"Include sample content"** — that's when EmDash imports all ${totalEntries} content entries, collections, and navigation menus.
  *(Shortcut: to bypass passkey setup during local dev, open \`http://localhost:4321/_emdash/api/setup/dev-bypass?redirect=/_emdash/admin\`)*.
- **Deploy:** When ready, run \`npm run build\` and deploy to Cloudflare Pages (see EmDash docs).

That's it! No scaffolding templates or file-copying required.
`;
  files.push({ name: "README.md", data: k0 === "bot" ? readmeBot : readmeScripts });

  const zip = zipSync(files);
  const filename = `${siteSlug}-emdash-${k0 === "bot" ? "forbot" : "site"}.zip`;
  return { zip, filename, siteName };
}
