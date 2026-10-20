// Builds the downloadable migration bundle from extracted WP content.
// Target-aware: EmDash produces a seed.json shaped to EmDash's content model;
// a generic target produces portable markdown + a content.json manifest.

import { zipSync } from "./zip.js";

const te = new TextEncoder();

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_{2,}/g, "_")
    .slice(0, 63) || "untitled";
}

// Light depluralizer for a nicer singular label when WP didn't supply one.
// Leaves words it isn't sure about untouched ("Oops" stays "Oops").
function depluralize(label) {
  if (!label) return label;
  if (/[^aeiou]ies$/i.test(label)) return label.replace(/ies$/i, "y");
  if (/(ches|shes|sses|xes|zes)$/i.test(label)) return label.replace(/es$/i, "");
  if (/ss$|us$|is$|ops$/i.test(label)) return label; // oops/class/status/axis
  if (/[^s]s$/i.test(label)) return label.replace(/s$/i, "");
  return label;
}

// EmDash collection slugs: lowercase, letters/numbers/underscore, <=63, start w/ letter.
function emdashCollectionSlug(wpType) {
  let s = slugify(wpType);
  if (!/^[a-z]/.test(s)) s = "c_" + s;
  return s;
}

// Map a WP type → a sensible EmDash field set. Content model is consistent:
// title/slug/excerpt/content/featured_image + taxonomy fields when present.
function emdashFieldsFor(collection) {
  const hasCats = collection.entries.some((e) => e.categories?.length);
  const hasTags = collection.entries.some((e) => e.tags?.length);
  const hasImg = collection.entries.some((e) => e.featured_image);
  const hasExcerpt = collection.entries.some((e) => e.excerpt);
  const fields = [
    { slug: "title", label: "Title", type: "string", required: true },
  ];
  if (hasExcerpt) fields.push({ slug: "excerpt", label: "Excerpt", type: "text" });
  fields.push({ slug: "content", label: "Content", type: "portableText" });
  if (hasImg) fields.push({ slug: "featured_image", label: "Featured Image", type: "image" });
  if (hasCats) fields.push({ slug: "categories", label: "Categories", type: "multiSelect",
    options: [...new Set(collection.entries.flatMap((e) => e.categories || []))].map((c) => ({ label: c, value: slugify(c) })) });
  if (hasTags) fields.push({ slug: "tags", label: "Tags", type: "multiSelect",
    options: [...new Set(collection.entries.flatMap((e) => e.tags || []))].map((c) => ({ label: c, value: slugify(c) })) });
  return fields;
}

function yamlFrontmatter(obj) {
  const esc = (v) => {
    if (v == null) return '""';
    if (Array.isArray(v)) return "[" + v.map((x) => JSON.stringify(String(x))).join(", ") + "]";
    const s = String(v);
    return /[:#\-?{}\[\],&*!|>'"%@`\n]/.test(s) || s.trim() !== s ? JSON.stringify(s) : s;
  };
  const lines = ["---"];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    lines.push(`${k}: ${esc(v)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

// Build the complete bundle. Returns { filename, bytes }.
export function buildBundle(extract, target) {
  const files = [];
  const siteName = extract.site?.name || extract.site?.base || "wordpress-site";
  const host = (() => { try { return new URL(extract.site.base).host; } catch { return "site"; } })();
  const stamp = new Date().toISOString().slice(0, 10);

  // Summary stats for the manifest + README.
  const stats = extract.collections.map((c) => ({
    collection: c.type, label: c.label, entries: c.entries.length, capped: !!c.capped,
  }));
  const totalEntries = stats.reduce((n, s) => n + s.entries, 0);

  // 1) Per-entry markdown (shared by all targets) under content/<collection>/<slug>.md
  const mediaUrls = new Set();
  for (const c of extract.collections) {
    for (const e of c.entries) {
      const fname = `content/${slugify(c.type)}/${e.slug || slugify(e.title) || e.id}.md`;
      const fm = {
        title: e.title,
        slug: e.slug || undefined,
        status: e.status || "published",
        date: e.date || undefined,
        excerpt: e.excerpt || undefined,
        featured_image: e.featured_image || undefined,
        categories: e.categories?.length ? e.categories : undefined,
        tags: e.tags?.length ? e.tags : undefined,
        source_url: e.link || undefined,
      };
      if (e.featured_image) mediaUrls.add(e.featured_image);
      // collect inline images from markdown
      const imgRe = /!\[[^\]]*\]\(([^)]+)\)/g; let m;
      while ((m = imgRe.exec(e.content_md))) mediaUrls.add(m[1]);
      files.push({ name: fname, data: yamlFrontmatter(fm) + (e.content_md || "") + "\n" });
    }
  }

  // 2) Target-specific schema file
  if (target === "emdash") {
    const seed = {
      version: "1",
      collections: extract.collections.map((c) => ({
        slug: emdashCollectionSlug(c.type),
        label: c.label,
        labelSingular: c.labelSingular && c.labelSingular !== c.label ? c.labelSingular : depluralize(c.label),
        fields: emdashFieldsFor(c),
      })),
    };
    files.push({ name: "seed.json", data: JSON.stringify(seed, null, 2) });
  }

  // 3) Machine-readable manifest of everything extracted
  files.push({
    name: "content.json",
    data: JSON.stringify({
      source: { name: siteName, url: extract.site.base, extracted_at: new Date().toISOString(), method: extract.method },
      target,
      stats, total_entries: totalEntries,
      media: [...mediaUrls],
      collections: extract.collections.map((c) => ({
        type: c.type, label: c.label,
        entries: c.entries.map((e) => ({
          title: e.title, slug: e.slug, status: e.status, date: e.date,
          excerpt: e.excerpt, featured_image: e.featured_image,
          categories: e.categories, tags: e.tags, source_url: e.link,
          markdown_file: `content/${slugify(c.type)}/${e.slug || slugify(e.title) || e.id}.md`,
          acf: e.acf,
        })),
      })),
    }, null, 2),
  });

  // 4) Agent instructions + human README
  files.push({ name: "AGENT_INSTRUCTIONS.md", data: agentInstructions(target, extract, stats, totalEntries, mediaUrls.size) });
  files.push({ name: "README.md", data: humanReadme(target, siteName, extract.site.base, stats, totalEntries, mediaUrls.size, extract.notice) });

  const bytes = zipSync(files);
  const filename = `${slugify(host)}-content-${target}-${stamp}.zip`;
  return { filename, bytes };
}

function agentInstructions(target, extract, stats, totalEntries, mediaCount) {
  const list = stats.map((s) => `- \`${s.collection}\` → ${s.entries} entr${s.entries === 1 ? "y" : "ies"}${s.capped ? " (capped at the export limit)" : ""}`).join("\n");
  if (target === "emdash") {
    return `# Agent Instructions — Rebuild this content in EmDash CMS

You are an AI agent helping migrate a WordPress site's **content** (not design) into **EmDash CMS**. Everything you need is in this bundle. There is no styling or layout here by design — you are rebuilding the content model and entries only.

## What's in this bundle
- \`seed.json\` — an EmDash seed file defining one collection per WordPress content type, with fields already chosen (title, excerpt, content, featured_image, categories/tags where present). This is the EmDash content model.
- \`content/<collection>/<slug>.md\` — one markdown file per entry, with YAML frontmatter (title, slug, status, date, excerpt, featured_image URL, categories, tags, source_url) and the body as markdown.
- \`content.json\` — a machine-readable manifest of every collection, entry, and media URL.

## Content types found
${list}
Total: **${totalEntries} entries**, **${mediaCount} media URLs**.

## How to rebuild it in EmDash
1. **Create the content model.** Use \`seed.json\` for a new EmDash site (it's applied on first boot via the setup wizard), OR, for an existing site, create the equivalent collections + fields under **Content Types** in the admin panel (seed files only apply to brand-new sites). Collection + field *slugs* are permanent in EmDash — set them before creating entries.
2. **Convert body content to Portable Text.** EmDash rich-text (\`portableText\` fields) is structured JSON, NOT markdown or HTML. For each entry, parse the markdown body in its \`.md\` file and convert it to Portable Text blocks (headings → block style h2/h3, paragraphs → normal blocks, links → markDefs, lists → list blocks, images → image blocks referencing uploaded media).
3. **Import the media.** Download each URL in \`content.json\` \`media[]\`, upload it into the EmDash media library, and wire \`featured_image\` + inline images to the resulting media references.
4. **Create entries.** For each \`.md\` file, create an entry in the matching collection: map frontmatter → fields, the converted Portable Text → the \`content\` field, and set \`slug\` + \`status\` from the frontmatter so URLs and publish state carry over.
5. **Map taxonomies.** \`categories\`/\`tags\` frontmatter values correspond to the \`multiSelect\` options defined in \`seed.json\`. Preserve them, or convert to EmDash taxonomies if the site prefers true taxonomy terms.

## Notes
- \`status: publish\` from WordPress → \`published\` in EmDash.
- Preserve \`slug\` values exactly to keep existing URLs working (set up redirects for any that change).
- Some entries may include an \`acf\` object in \`content.json\` (Advanced Custom Fields data) — add matching EmDash fields if that structured data matters to the site.
- This export is **content only**. Recreate layout, theme, and design in your Astro + EmDash templates separately.
${extract.notice ? `\n> ⚠️ ${extract.notice}` : ""}
`;
  }
  // generic target
  return `# Agent Instructions — Rebuild this content

This bundle contains the **content** (not design) of a WordPress site, ready to rebuild in your chosen CMS.

## What's in this bundle
- \`content/<collection>/<slug>.md\` — one markdown file per entry with YAML frontmatter + markdown body.
- \`content.json\` — machine-readable manifest of all collections, entries, and media URLs.

## Content types found
${list}
Total: **${totalEntries} entries**, **${mediaCount} media URLs**.

## How to use it
1. Create one content collection/type per folder under \`content/\`, with fields matching the frontmatter keys (title, excerpt, date, featured_image, categories, tags).
2. Create an entry per \`.md\` file; map frontmatter → fields and the markdown body → your rich-text/body field.
3. Download the media URLs from \`content.json\` and re-link featured + inline images.
4. Preserve \`slug\` values to keep URLs stable; add redirects for any that change.

This export is content only — recreate design/layout separately.
${extract.notice ? `\n> ⚠️ ${extract.notice}` : ""}
`;
}

function humanReadme(target, siteName, url, stats, totalEntries, mediaCount, notice) {
  const list = stats.map((s) => `| ${s.label} (\`${s.collection}\`) | ${s.entries}${s.capped ? " ⚠️ capped" : ""} |`).join("\n");
  return `# Your content, liberated from WordPress

Extracted from **${siteName || url}** (${url}) by [Escape From WP](https://escapefromwp.com).
Target CMS: **${target === "emdash" ? "EmDash" : target}**

## What you got
| Content type | Entries |
|---|---|
${list}

**Total: ${totalEntries} entries · ${mediaCount} media files referenced.**

## What to do with it
1. **Unzip this folder** somewhere you can find it.
2. **Open your AI coding assistant** (Claude Code, Cursor, GitHub Copilot, etc.) inside your new site's project.
3. **Point it at this folder** and say something like: *"Here's my old WordPress site's content. Follow AGENT_INSTRUCTIONS.md and rebuild it in ${target === "emdash" ? "EmDash" : "my CMS"}."*

The agent reads **AGENT_INSTRUCTIONS.md**, builds the content model from \`${target === "emdash" ? "seed.json" : "content.json"}\`, converts each markdown file, and creates your entries. You review the result before going live.

${target === "emdash" ? `> **Prefer a straight import instead of an agent?** EmDash also has a built-in WordPress importer (admin → **Import from WordPress**) that takes a WordPress WXR export (**Tools → Export** in wp-admin) or the EmDash Exporter plugin. That path imports content directly without an AI agent — use it if you'd rather not rebuild via an assistant. This bundle is the agent-driven alternative for when you can't (or don't want to) touch the WordPress admin.\n` : ""}

## Important
- This is **content only** — your posts, pages, and custom content. It does **not** include your theme, design, or layout (those are rebuilt fresh, which is the whole point of escaping WordPress).
- Media files are **referenced by URL**, not bundled. Your agent (or we) will download them during the rebuild.
- Double-check the extracted content before deleting your WordPress site. Keep a backup.
${notice ? `\n> ⚠️ **Note:** ${notice}` : ""}

---
Want us to do the whole migration for you? → https://escapefromwp.com/#breakout
`;
}
