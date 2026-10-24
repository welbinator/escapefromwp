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

  const menus = [];
  if (extract.menus && Array.isArray(extract.menus.menus)) {
    function mapItems(items) {
      if (!Array.isArray(items)) return [];
      return items.map((it) => {
        const item = {
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
        slug: m.slug || "main",
        name: m.name || "Main Menu",
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
export async function localizeReplica(replicaHtml, sourceUrl) {
  if (!replicaHtml || replicaHtml.length < 500) return null;
  // Rewrite internal links to relative paths first.
  let html = rewriteInternalLinks(replicaHtml, sourceUrl);

  // Find every absolute reference to one of our rehosted assets.
  const re = /https?:\/\/[^"')\s]+\/replica-asset\/[0-9a-f]{32}\/[A-Za-z0-9._-]+/g;
  const urls = [...new Set(html.match(re) || [])];
  const assets = [];
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
   \`http://localhost:4321/_emdash/admin\` (⚠️ MUST use \`localhost\`, NEVER \`127.0.0.1\` — passkeys require a secure context).
   The first visit launches the **setup wizard**. Enter the site identity + admin user, and **choose to INCLUDE sample content**
   when asked — that is what applies the seed's entries and navigation menus. Finish the wizard. Your collections
   and all entries are now in the database. (If you skip "include content", the entries
   won't load — re-run against a fresh DB.)
   *(Tip: you can also bypass the passkey setup locally by visiting \`http://localhost:4321/_emdash/api/auth/dev-bypass\`)*.
5. **Verify content:** the EmDash admin should now list every collection with its entries.
${prebuiltHome
  ? `6. **Verify the look:** open the site root — it should already render your exact
   homepage from \`public/index.html\`. If it doesn't, make sure \`public/\` was copied in.
7. **Make it EmDash-driven (optional but recommended):** port \`public/index.html\` into
   \`src/layouts/Base.astro\` + \`src/pages/index.astro\` **verbatim**, then swap the
   hardcoded text/images for the seeded collection data via EmDash's content API +
   \`<PortableText />\`. The rendered page must stay visually identical to the original.
   **Carry the two \`data-efw\` interaction scripts into \`Base.astro\` (end of \`<body>\`)
   and mark them \`is:inline\` — see "🔌 keep the interaction scripts" above — or the
   mobile menu breaks on the ported site.**
8. **Other routes:** add one route per collection (e.g. \`src/pages/[slug].astro\`),
   reusing the SAME header/footer/styles **and the same \`Base.astro\` layout (which now
   carries the interaction scripts)** from \`public/index.html\` so every page matches
   AND its menu works.`
  : `6. **Study the exact look:** open \`reference/your-exact-site.html\`. Extract design
   tokens — fonts, colors, spacing, header/footer, section layouts.
7. **Build the layout + homepage:** create \`src/layouts/Base.astro\` and rebuild
   \`src/pages/index.astro\` to match the reference, pulling text/images from the seeded
   collections via EmDash's content API + \`<PortableText />\`.
8. **Templates:** add one route per collection (e.g. \`src/pages/[slug].astro\`) styled
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
    const cleanReplica = rewriteInternalLinks(replicaHtml, sourceUrl);
    files.push({ name: "reference/your-exact-site.html", data: cleanReplica });
    try {
      const local = await localizeReplica(replicaHtml, sourceUrl);
      if (local && local.html) {
        for (const f of staticHomepageFiles(local.html)) files.push(f);
        for (const a of local.assets) files.push(a);
        prebuiltHome = true;
      }
    } catch (_) { /* fall back to reference-only if localization fails */ }
  }

  // 5) Instructions + README.
  // The handoff message the agent must send the owner lives INSIDE AGENT_INSTRUCTIONS.md
  // as its final numbered step — NOT as a separate file. A second file doubled the chance
  // an agent read one and missed the other (reported by a real agent), so it's inlined.
  files.push({ name: "AGENT_INSTRUCTIONS.md", data: agentInstructions(siteName, host, stats, totalEntries, menuData, prebuiltHome) });
  const readmeBot =
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
# 3. Install + run
npm install
npm run dev

# 4. Open the admin setup wizard in your browser:
# 👉 http://localhost:4321/_emdash/admin
# ⚠️ IMPORTANT: Always use \`localhost\`, NEVER \`127.0.0.1\`!
# EmDash uses passkeys/WebAuthn, which browsers block on numeric IP addresses.
\`\`\`

Your ${totalEntries} entries and menus load during that setup step (choose **"include sample content"**). Then open
**AGENT_INSTRUCTIONS.md** and hand this whole folder to your AI coding assistant to
fuse your exact design (reference/your-exact-site.html) on top.

No WordPress required.
`;
  const readmeScripts =
`# ${siteName} — your EmDash site (set up yourself, no AI)

Everything from **${host}**, packaged as a ready-to-run **EmDash CMS** site —
your content baked into a seed, and your exact design${prebuiltHome ? " already built as the live homepage" : " included as a reference"}.
Your mobile menu, dropdowns, and accordions already work (the interaction scripts
are baked into the homepage) — no WordPress, no jQuery.

## Run it — a few commands
\`\`\`
# 1. Scaffold the real EmDash starter (correct wiring out of the box)
npm create astro@latest my-site -- --template @emdash-cms/template-starter-cloudflare

# 2. Copy THIS folder's contents into my-site/ (overwrite seed/seed.json;
#    keep public/index.html + public/_site/ so the design & menus come along)
cp -r ./* my-site/        # or drag the files in
cd my-site

# 3. Install and run
npm install
npm run dev
\`\`\`

- Your homepage renders immediately at \`http://localhost:4321/\`${prebuiltHome ? " from \`public/index.html\` — pixel-identical to your old site, with all menu links matching your exact original slugs" : ""}.
- To load your ${totalEntries} content entries into the CMS, open:
  👉 **\`http://localhost:4321/_emdash/admin\`**
  *(⚠️ **IMPORTANT:** MUST use \`localhost\`, NEVER \`127.0.0.1\` — browser passkey security blocks \`127.0.0.1\`)*.
  Complete the one-time setup and choose **"include content"** — that's when EmDash imports \`seed/seed.json\` (collections, posts, and navigation menus).
  *(Shortcut: to bypass the passkey setup locally, visit \`http://localhost:4321/_emdash/api/auth/dev-bypass\`)*.
- Deploy with \`npm run build\` then push \`dist/\` to Cloudflare Pages (see EmDash docs).

That's the whole process — no AI assistant needed. If you'd rather hand it to an AI
coding assistant, \`AGENT_INSTRUCTIONS.md\` has a prompt for that too.
`;
  files.push({ name: "README.md", data: k0 === "bot" ? readmeBot : readmeScripts });

  const zip = zipSync(files);
  const filename = `${siteSlug}-emdash-${k0 === "bot" ? "forbot" : "site"}.zip`;
  return { zip, filename, siteName };
}
