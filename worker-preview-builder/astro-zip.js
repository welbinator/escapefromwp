// Build a runnable STATIC ASTRO project for the "Generate zip → Static Astro" path.
//
// This is the non-EmDash deliverable. Instead of an EmDash seed + CMS wiring, it
// ships a plain static Astro site:
//   - `public/index.html` — the PRE-BUILT, pixel-identical homepage (exact copy of
//     the original, with every image/font/stylesheet bundled locally under
//     `public/_site/`). The downloaded site LOOKS like the original the moment it
//     runs — no design recreation required.
//   - `src/content/<collection>/*.md` — the WordPress content as Astro **content
//     collections** (markdown + frontmatter), one folder per content type.
//   - `src/content.config.ts` — a loose content-collections schema (glob loader)
//     so `astro build` picks the content up without the agent writing it by hand.
//   - `astro.config.mjs` + `package.json` — plain static Astro, NO EmDash/CMS deps.
//   - `reference/` — content.json + menus.json + the exact-copy HTML as a design brief.
//   - AGENT_INSTRUCTIONS.md / README.md — static-Astro-specific build steps.
//
// Shares the content extractor, replica-localization, and pre-built-homepage logic
// with emdash-zip.js so the two targets stay in lockstep.

import { extractSite, normalizeSiteUrl } from "../functions/api/_lib/wp-extract.js";
import { buildBundleFiles } from "../functions/api/_lib/build-bundle.js";
import { zipSync } from "../functions/api/_lib/zip.js";
import { slug, slugify, localizeReplica, staticHomepageFiles } from "./emdash-zip.js";

// Astro content-collection id: letters/numbers/underscore, start with a letter.
function collectionId(wpType) {
  let s = slugify(wpType);
  if (!/^[a-z]/.test(s)) s = "c_" + s;
  return s;
}

function scaffoldPackageJson(siteSlug) {
  return JSON.stringify({
    name: siteSlug,
    type: "module",
    version: "0.1.0",
    private: true,
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

function astroConfig() {
  return `import { defineConfig } from "astro/config";

// Plain static Astro site. Your exact-copy homepage ships as public/index.html
// (pixel-identical to your old site, assets bundled locally under public/_site/).
// Your WordPress content lives as Astro content collections in src/content/ — build
// routes for it in src/pages/ (see AGENT_INSTRUCTIONS.md). No CMS, no database.
export default defineConfig({
  // output: "static" is the default — this is a static site.
});
`;
}

// A loose content-collections config so `astro build` ingests the markdown without
// the agent hand-writing a schema. Every frontmatter field is optional/coerced so a
// stray key never fails the build; the agent can tighten it later.
function contentConfig(collectionIds) {
  const defs = collectionIds.map((id) =>
    `  ${/^[a-z_][a-z0-9_]*$/.test(id) ? id : JSON.stringify(id)}: defineCollection({\n` +
    `    loader: glob({ pattern: "**/*.md", base: "./src/content/${id}", generateId }),\n` +
    `    schema: contentSchema,\n` +
    `  }),`
  ).join("\n");
  return `import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

// Always derive the entry id from the FILE PATH (as a string). The default glob
// loader uses a \`slug\` frontmatter value when present, and WordPress slugs that are
// purely numeric (e.g. "2023") get parsed as numbers by YAML — which crashes the
// content layer with "id.endsWith is not a function". Coercing to the filename avoids that.
const generateId = ({ entry }) => String(entry).replace(/\\.md$/, "");

// Loose schema — every field optional so the imported WordPress content always
// builds. Tighten types/required fields once you've reviewed the content.
const contentSchema = z.object({
  title: z.coerce.string().optional(),
  slug: z.coerce.string().optional(),
  status: z.coerce.string().optional(),
  date: z.coerce.string().optional(),
  excerpt: z.coerce.string().optional(),
  featured_image: z.coerce.string().optional(),
  categories: z.array(z.coerce.string()).optional(),
  tags: z.array(z.coerce.string()).optional(),
  source_url: z.coerce.string().optional(),
}).passthrough();

export const collections = {
${defs}
};
`;
}

function agentInstructions(siteName, host, stats, totalEntries, menuData, prebuiltHome) {
  const list = (stats || []).map((s) => `- \`src/content/${s.collection}/\` — ${s.entries} entr${s.entries === 1 ? "y" : "ies"}`).join("\n") || "- (see src/content/)";
  const menuNote = menuData
    ? `\nThis package also includes \`reference/menus.json\` (${menuData.menus.length} menu${menuData.menus.length === 1 ? "" : "s"}, source: \`${menuData.source}\`). Rebuild the nav in your \`Base.astro\` header from it, preserving label order and nesting.`
    : "";
  const designSection = prebuiltHome
    ? `## The design is ALREADY BUILT — do not recreate it
This package ships your homepage **pre-built and pixel-identical** to the original at
\`public/index.html\`, with every image/font/stylesheet bundled locally under
\`public/_site/\`. The moment you run \`npm run dev\` it looks exactly like your old
site — you do **not** rebuild the design from scratch.

**Your job on the design is to PRESERVE it, then extend it:**
- Leave \`public/index.html\` as the faithful homepage, OR port it into
  \`src/layouts/Base.astro\` + \`src/pages/index.astro\` **verbatim** (same markup, same
  inline CSS, same \`/_site/...\` asset paths) if you want it to share a layout with the
  rest of the site. Either way the visual result must stay identical.
- **Never** replace it with a generic/starter theme. Diff your result against
  \`public/index.html\`.
- Reuse the exact header/footer markup + styles from \`public/index.html\` for every
  other route so the whole site is visually consistent.

### 🔌 CRITICAL: keep the interaction scripts, or the menu dies
\`public/index.html\` ends with TWO small \`<script>\` tags just before \`</body>\`
(\`data-efw="replay"\` and \`data-efw="interactions"\`) that make the **mobile menu,
dropdowns, and accordions** work with no WordPress/jQuery. If you port the homepage
into \`Base.astro\` or reuse the header on other routes, you MUST carry BOTH scripts
into the shared layout, and in Astro mark them \`is:inline\`
(\`<script is:inline data-efw="replay">\`) or Astro will hoist/break them and the menu
won't open.`
    : `## Match the exact design
\`reference/your-exact-site.html\` is a pixel-faithful, self-contained copy of your old
homepage (CSS inlined, assets rehosted). **It is your design brief — reproduce it
exactly.** Extract its fonts, colors, spacing, header, and footer and build your Astro
layout + homepage to match. Do NOT ship a generic/starter theme.

### 🔌 Keep the interaction scripts for the menu
\`reference/your-exact-site.html\` ends with two \`<script>\` tags (\`data-efw="replay"\`
and \`data-efw="interactions"\`) that drive the mobile menu/dropdowns with no WordPress.
Copy BOTH into your \`Base.astro\` (end of \`<body>\`), and in Astro mark them
\`is:inline\` or Astro will hoist/break them and the menu won't open.`;

  return `# Rebuild ${siteName} as a static Astro site — instructions for your AI coding assistant

> 🚨 **ONE NON-NEGOTIABLE RULE:** Your job is NOT done until you send the site owner the
> exact handoff message in the "MESSAGE FOR THE SITE OWNER" section at the very bottom of
> this file (Step 9). Copy it **verbatim**, replace only the URL placeholder, and send it
> as your final reply. Do not rewrite, shorten, or summarize it. Ending with just "it's
> live" or a bare link is a **FAILED task.**

You have a **static Astro package** built from **${host}**: your content as Astro
**content collections**${prebuiltHome ? ", a **pre-built exact-copy homepage**," : ", an **exact HTML copy** of the original homepage,"}
so your content AND your look are already done — you just assemble them. **No CMS, no
database** — this is a plain static Astro site.

## What's in this package
${prebuiltHome ? `- \`public/index.html\` + \`public/_site/\` — your **pre-built, pixel-identical homepage**
  and its locally-bundled assets. This IS the design, already done.` : `- \`reference/your-exact-site.html\` — the pixel-faithful visual copy. **Your design brief.**`}
- \`src/content/<collection>/*.md\` — **your content**, as Astro content collections
  (markdown + YAML frontmatter), one folder per WordPress content type.
- \`src/content.config.ts\` — a loose content-collections schema so \`astro build\` ingests
  the markdown out of the box.
- \`astro.config.mjs\` + \`package.json\` — plain static Astro (no CMS deps).
- \`reference/content.json\` + \`reference/menus.json\` — machine-readable manifest + nav.

## Content model
${list}
Total: **${totalEntries} entries.**

${designSection}

## Step-by-step (follow in order)
1. **Install:** \`npm install\`.
2. **Run it:** \`npm run dev\`, then open \`http://localhost:4321\`.${prebuiltHome ? " The homepage should already render your exact site from `public/index.html`." : ""}
3. **Build routes for your content.** For each collection in \`src/content/\`, add a route
   that renders its entries — e.g. a list page \`src/pages/<collection>/index.astro\` using
   \`getCollection("<collection>")\`, and a detail page
   \`src/pages/<collection>/[...slug].astro\` using \`render(entry)\` to output the markdown
   body. Reuse the exact header/footer/styles from${prebuiltHome ? " `public/index.html`" : " `reference/your-exact-site.html`"} so every page matches.
4. **Images:** frontmatter \`featured_image\` and inline markdown images reference the
   original media URLs (see \`reference/content.json\` \`media[]\`). Either keep them as
   remote URLs, or download them into \`src/assets/\`/\`public/\` and update the references.${menuNote}
5. **Redirects:** add old→new 301s to \`public/_redirects\` before going live. No 404s.
6. **Deploy:** \`npm run build\` → deploy \`dist/\` to Cloudflare Pages, Netlify, or any
   static host. Confirm the build succeeds and the deployed URL works.

## Rules
- The content is already structured — do NOT retype it. It's in \`src/content/\`.
- ${prebuiltHome ? "The design is already built in `public/index.html` — PRESERVE it; never swap in a generic theme." : "Match `reference/your-exact-site.html` faithfully — it IS the brief."} Preserve copy exactly.
- No live 404s — set redirects before changing URLs.

## ✅ YOU ARE NOT DONE UNTIL ALL OF THESE ARE TRUE
- [ ] \`npm run build\` succeeded
- [ ] The site is deployed and the URL opens and works
- [ ] Every collection has a route and all ${totalEntries} entries render
- [ ] **The EXACT "MESSAGE FOR THE SITE OWNER" below has been sent, with the real URL filled in**

---
---
## 📋 EVERYTHING ABOVE IS FOR YOU, THE AGENT. EVERYTHING BELOW IS THE MESSAGE FOR THE SITE OWNER.
The site owner is NOT a developer. Send it **verbatim** as your final reply. Change
**nothing** except replacing the URL placeholder on the first line with the real
local/deployed URL. Do not add commentary before or after it.
---
---

🎉 **Your new site is live:** [REPLACE THIS WITH THE REAL SITE URL BEFORE SENDING]

Your ${siteName} website has been rebuilt as a fast, modern **static site** — no more
WordPress, no plugins to update, nothing to hack. It looks exactly like your old site,
and all ${totalEntries} of your pages and posts came across.

## ⚠️ A couple of interactive things might need a quick touch-up (totally normal)
Your site is an exact copy of your old one, but a few features used to be powered by
WordPress behind the scenes. We re-wired the common ones (like your **mobile menu**),
but on some sites one or two interactive bits may still act up at first — things like:

- 📱 the **mobile / hamburger menu**
- 🔽 **dropdown** menus
- 🎞️ **sliders / carousels**
- ➕ **accordions / FAQ toggles**
- 📝 **forms** (contact, sign-up — these talked to WordPress and may need reconnecting)

**None of this is cause for worry — it's expected and every bit of it is fixable.**

## 💬 Just point and I'll fix it
Take a minute to click around your new site — **especially on your phone** — and try the
menus, buttons, and forms. 👉 **If ANYTHING doesn't work or doesn't look right, just tell
me what it is in plain words and I'll fix it for you.** Things like *"the menu on mobile
doesn't open"* or *"the contact form doesn't send"* are perfect. Point me at it and I'll
handle the rest. 🙂`;
}

// Main entry: returns { zip: Uint8Array, filename, siteName } or throws.
export async function buildAstroZip(env, { id, sourceUrl, businessName, replicaHtml }) {
  const base = normalizeSiteUrl(sourceUrl) || sourceUrl;
  const extract = await extractSite(base, { maxEntriesPerType: 500 });
  if (!extract || !extract.ok) {
    throw new Error("content extraction failed: " + (extract && extract.error ? extract.error : "unknown"));
  }
  const siteName = extract.site?.name || businessName || base;
  const host = (() => { try { return new URL(base).host; } catch { return "site"; } })();
  const siteSlug = slug(businessName || host);
  const stats = extract.collections.map((c) => ({ collection: collectionId(c.type), entries: c.entries.length }));
  const totalEntries = stats.reduce((n, s) => n + s.entries, 0);
  const menuData = extract.menus && extract.menus.menus?.length ? extract.menus : null;

  // Reference content (markdown + content.json + menus.json) from the proven builder.
  const { files: bundle } = buildBundleFiles(extract, "generic");

  const files = [];

  // 1) Project scaffold.
  files.push({ name: "package.json", data: scaffoldPackageJson(siteSlug) });
  files.push({ name: "astro.config.mjs", data: astroConfig() });
  files.push({ name: "src/content.config.ts", data: contentConfig(stats.map((s) => s.collection)) });
  files.push({ name: ".gitignore", data: "node_modules/\ndist/\n.astro/\n.env\n.wrangler/\n" });

  // 2) Content as Astro content collections under src/content/<collection>/*.md.
  //    The bundle emits content/<collection>/<slug>.md — move those under src/content/
  //    so Astro's glob loader ingests them; keep content.json + menus.json as reference.
  for (const f of bundle) {
    if (f.name === "README.md" || f.name === "AGENT_INSTRUCTIONS.md") continue;
    if (f.name.startsWith("content/")) {
      files.push({ name: "src/" + f.name, data: f.data });
    } else if (f.name.endsWith(".json")) {
      files.push({ name: `reference/${f.name}`, data: f.data });
    } else {
      files.push({ name: f.name, data: f.data });
    }
  }

  // 3) Exact-look reference HTML + PRE-BUILT, pixel-identical homepage.
  let prebuiltHome = false;
  if (replicaHtml && replicaHtml.length > 500) {
    files.push({ name: "reference/your-exact-site.html", data: replicaHtml });
    try {
      const local = await localizeReplica(replicaHtml);
      if (local && local.html) {
        for (const a of staticHomepageFiles(local.html)) {
          // staticHomepageFiles emits public/index.html + astro.config.mjs; skip the
          // config (we ship our own) and keep the homepage.
          if (a.name === "astro.config.mjs") continue;
          files.push(a);
        }
        for (const a of local.assets) files.push(a);
        prebuiltHome = true;
      }
    } catch (_) { /* fall back to reference-only if localization fails */ }
  }

  // 4) Instructions + README.
  files.push({ name: "AGENT_INSTRUCTIONS.md", data: agentInstructions(siteName, host, stats, totalEntries, menuData, prebuiltHome) });
  files.push({ name: "README.md", data:
`# ${siteName} — your static Astro site

Everything from **${host}**, packaged as a ready-to-run **static Astro** project —
your content as Astro content collections, plus an exact copy of your old site so the
design is already done. No WordPress, no CMS, no database.

## The short version
\`\`\`
npm install
npm run dev     # open http://localhost:4321
\`\`\`
${prebuiltHome ? "Your homepage already renders exactly like your old site (public/index.html)." : "Match reference/your-exact-site.html for the design."}
Your ${totalEntries} entries are in \`src/content/\` as Astro content collections.

Open **AGENT_INSTRUCTIONS.md** and hand this whole folder to your AI coding assistant to
build the routes for your content and fuse your exact design on top.

No WordPress required.
`});

  const zip = zipSync(files);
  const filename = `${siteSlug}-astro-site.zip`;
  return { zip, filename, siteName };
}
