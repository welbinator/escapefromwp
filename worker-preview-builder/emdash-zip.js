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

function slug(s) {
  return (s || "site").toString().toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "site";
}

function slugify(s) {
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

// Build the spec-correct EmDash seed with collections + baked-in content + settings.
function buildSeed(extract, siteName, base) {
  const collections = [];
  const content = {};

  for (const c of extract.collections) {
    const cslug = emdashCollectionSlug(c.type);
    const { fields, hasImg, hasExcerpt, hasCats, hasTags } = fieldsFor(c);
    collections.push({
      slug: cslug,
      label: c.label,
      labelSingular: c.labelSingular && c.labelSingular !== c.label ? c.labelSingular : depluralize(c.label),
      fields,
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

      const data = { title: e.title || uniq };
      if (hasExcerpt && e.excerpt) data.excerpt = e.excerpt;
      data.content = mdToPortableText(e.content_md);
      if (hasImg && e.featured_image) data.featured_image = { $media: e.featured_image };
      if (hasCats && e.categories?.length) data.categories = e.categories.map((x) => slugify(x));
      if (hasTags && e.tags?.length) data.tags = e.tags.map((x) => slugify(x));

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
  };
  return seed;
}

function scaffoldPackageJson(siteSlug) {
  return JSON.stringify({
    name: siteSlug,
    type: "module",
    version: "0.1.0",
    private: true,
    // EmDash discovers the seed via this pointer (docs: package.json#emdash.seed).
    emdash: { seed: "seed/seed.json" },
    scripts: {
      dev: "astro dev",
      build: "astro build",
      preview: "astro preview",
    },
    dependencies: {
      astro: "^5.0.0",
    },
  }, null, 2);
}

// Pull the exact-copy replica HTML apart and rebundle it so the downloaded site
// renders IDENTICALLY offline, with no dependency on escapefromwp.com:
//   - every rehosted asset (/replica-asset/<id>/<file> on our origin) is fetched
//     and written into the zip under public/_site/<file>
//   - the HTML's references are rewritten to the local /_site/<file> path
// Returns { html, assets: [{name,data(Uint8Array)}] } or null if nothing usable.
async function localizeReplica(replicaHtml) {
  if (!replicaHtml || replicaHtml.length < 500) return null;
  // Find every absolute reference to one of our rehosted assets.
  const re = /https?:\/\/[^"')\s]+\/replica-asset\/[0-9a-f]{32}\/[A-Za-z0-9._-]+/g;
  const urls = [...new Set(replicaHtml.match(re) || [])];
  const assets = [];
  let html = replicaHtml;
  const UA = {
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "accept": "*/*",
  };
  for (const u of urls) {
    const file = u.split("/").pop();
    try {
      const res = await fetch(u, { headers: UA, cf: { cacheTtl: 0 } });
      if (!res.ok) continue;
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!buf.byteLength) continue;
      assets.push({ name: `public/_site/${file}`, data: buf });
      html = html.split(u).join(`/_site/${file}`);
    } catch (_) { /* skip a failed asset, keep going */ }
  }
  // Any stray references to our origin that we couldn't bundle: leave them absolute
  // (still load online) rather than break them.
  return { html, assets };
}

// Build a static Astro homepage that renders the exact-copy HTML verbatim, plus an
// Astro config set up for a plain static build. This means the DOWNLOADED site looks
// exactly like the original the moment it runs — the bot's job becomes wiring the
// seeded content into the other routes, not recreating the design from scratch.
function staticHomepageFiles(localizedHtml) {
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
  other route so the whole site is visually consistent with the original.`
    : `## Match the exact design
\`reference/your-exact-site.html\` is a pixel-faithful, self-contained copy of your old
homepage (CSS inlined, assets rehosted). **It is your design brief — reproduce it
exactly.** Extract its fonts, colors, spacing, header, and footer and build your Astro
layout + homepage to match. Do NOT ship a generic/starter theme.`;
  return `# Rebuild ${siteName} in EmDash — instructions for your AI coding assistant

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

## Step-by-step (follow in order — do NOT seed before scaffolding)
1. **Scaffold a real EmDash project** from the official template (this gives you the
   correct Astro config, adapter, and \`src/live.config.ts\` wiring — don't hand-write it):
   \`\`\`
   npm create astro@latest my-site -- --template @emdash-cms/template-starter-cloudflare
   cd my-site
   \`\`\`
   (Use \`@emdash-cms/template-starter\` for a non-Cloudflare/Node target.)
2. **Drop in the content + design.** Copy this package's \`seed/seed.json\` over the
   template's \`seed/seed.json\` (the template already points \`package.json#emdash.seed\`
   at it; if yours differs, set it). ${prebuiltHome ? "Copy \`public/\` (the pre-built homepage + \`_site/\` assets) in too, plus \`reference/\` and \`content/\` for reference." : "Also copy \`reference/\` and \`content/\` in for reference."}
3. **Install:** \`npm install\`.
4. **Run first setup — this is where the content imports.** \`npm run dev\`, then open
   \`http://localhost:4321/_emdash/admin\`. The first visit launches the **setup wizard**.
   Enter the site identity + admin user, and **choose to INCLUDE sample content** when
   asked — that is what applies the seed's entries. Finish the wizard. Your collections
   and all entries are now in the database. (If you skip "include content", the entries
   won't load — re-run against a fresh DB.)
5. **Verify content:** the EmDash admin should now list every collection with its entries.
${prebuiltHome
  ? `6. **Verify the look:** open the site root — it should already render your exact
   homepage from \`public/index.html\`. If it doesn't, make sure \`public/\` was copied in.
7. **Make it EmDash-driven (optional but recommended):** port \`public/index.html\` into
   \`src/layouts/Base.astro\` + \`src/pages/index.astro\` **verbatim**, then swap the
   hardcoded text/images for the seeded collection data via EmDash's content API +
   \`<PortableText />\`. The rendered page must stay visually identical to the original.
8. **Other routes:** add one route per collection (e.g. \`src/pages/[slug].astro\`),
   reusing the SAME header/footer/styles from \`public/index.html\` so every page matches.`
  : `6. **Study the exact look:** open \`reference/your-exact-site.html\`. Extract design
   tokens — fonts, colors, spacing, header/footer, section layouts.
7. **Build the layout + homepage:** create \`src/layouts/Base.astro\` and rebuild
   \`src/pages/index.astro\` to match the reference, pulling text/images from the seeded
   collections via EmDash's content API + \`<PortableText />\`.
8. **Templates:** add one route per collection (e.g. \`src/pages/[slug].astro\`) styled
   to match the reference.`}${menuNote}
9. **Redirects:** add old→new 301s to \`public/_redirects\` before going live. No 404s.
10. **Deploy:** Cloudflare Pages + D1 + R2 (EmDash's standard target), or your host.

## Rules
- The content is already structured — do NOT retype it. It's in \`seed/seed.json\`.
- ${prebuiltHome ? "The design is already built in \`public/index.html\` — PRESERVE it; never swap in a generic theme. Diff your result against it." : "Match \`reference/your-exact-site.html\` faithfully — it IS the brief."} Preserve copy exactly.
- Seed applies once on first setup; never rely on re-seeding a live site to add content.
- No live 404s — set redirects before changing URLs.

Hand this whole folder to your assistant and work the steps in order.
`;
}

// Main entry: returns { zip: Uint8Array, filename, siteName } or throws.
export async function buildEmdashZip(env, { id, sourceUrl, businessName, replicaHtml }) {
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
  const seed = buildSeed(extract, siteName, base);
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
  //    The whole point: the downloaded site must LOOK like the original out of the
  //    box, so we ship the exact copy as the live homepage (public/index.html) with
  //    its assets bundled locally — instead of asking the bot to recreate the design.
  let prebuiltHome = false;
  if (replicaHtml && replicaHtml.length > 500) {
    files.push({ name: "reference/your-exact-site.html", data: replicaHtml });
    try {
      const local = await localizeReplica(replicaHtml);
      if (local && local.html) {
        for (const f of staticHomepageFiles(local.html)) files.push(f);
        for (const a of local.assets) files.push(a);
        prebuiltHome = true;
      }
    } catch (_) { /* fall back to reference-only if localization fails */ }
  }

  // 5) Instructions + README.
  files.push({ name: "AGENT_INSTRUCTIONS.md", data: agentInstructions(siteName, host, stats, totalEntries, menuData, prebuiltHome) });
  files.push({ name: "README.md", data:
`# ${siteName} — your EmDash content package

Everything from **${host}**, packaged for **EmDash CMS** — with your content already
structured as an EmDash seed so it loads itself, plus an exact copy of your old site
to match the design.

## The short version
EmDash applies its seed **once, during first-time setup**. So the workflow is:
scaffold a real EmDash project, drop in this \`seed/seed.json\`, then run setup.

\`\`\`
# 1. Scaffold the real EmDash template (correct wiring out of the box)
npm create astro@latest my-site -- --template @emdash-cms/template-starter-cloudflare
cd my-site

# 2. Copy this package's seed/ (and reference/, content/) into my-site/, overwriting seed/seed.json
# 3. Install + run, then complete first-time setup (INCLUDE content when asked)
npm install
npm run dev     # open http://localhost:4321/_emdash/admin → setup wizard
\`\`\`

Your ${totalEntries} entries load during that setup step. Then open
**AGENT_INSTRUCTIONS.md** and hand this whole folder to your AI coding assistant to
fuse your exact design (reference/your-exact-site.html) on top.

No WordPress required.
`});

  const zip = zipSync(files);
  const filename = `${siteSlug}-emdash-site.zip`;
  return { zip, filename, siteName };
}
