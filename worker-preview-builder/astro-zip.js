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

function agentInstructions(siteName, host, stats, totalEntries, menuData, prebuiltHome, fullyRendered) {
  const list = (stats || []).map((s) => `- \`src/content/${s.collection}/\` — ${s.entries} entr${s.entries === 1 ? "y" : "ies"}`).join("\n") || "- (see src/content/)";

  // When fullyRendered, the zip is a COMPLETE site: homepage + every collection
  // route already generated server-side. There is nothing for a bot to assemble —
  // `npm install && npm run build` produces the finished site. Ship a short,
  // deploy-only README instead of the bot-assembly playbook.
  if (fullyRendered) {
    return `# ${siteName} — your finished static Astro site

This is a **complete, ready-to-deploy** static Astro site built from **${host}**. The
homepage AND a page for every one of your ${totalEntries} content entries are **already
built** — there is nothing to assemble. No WordPress, no CMS, no database.

## Deploy it (two commands)
\`\`\`
npm install
npm run build      # outputs the finished site to dist/
\`\`\`
Then deploy the \`dist/\` folder to Cloudflare Pages, Netlify, or any static host. To preview
locally first: \`npm run dev\` and open http://localhost:4321.

## What's already done for you
- \`public/index.html\` + \`public/_site/\` — your **pixel-identical homepage** with all
  images/fonts/CSS bundled locally. Served untouched at \`/\`.
- \`src/content/<collection>/*.md\` — your ${totalEntries} entries as Astro content collections.
- \`src/layouts/Base.astro\` + \`src/lib/shell.json\` — the layout that wraps every inner
  page in your homepage's **exact header, footer, and menu scripts**, so the whole site
  looks consistent and the mobile menu works everywhere.
- \`src/pages/<collection>/\` — a list page and a detail page per content type, **already
  generated.** Your routes:
${(stats || []).filter((s) => s.entries).map((s) => `  - \`/${s.collection}/\` + \`/${s.collection}/<slug>\` (${s.entries} page${s.entries === 1 ? "" : "s"})`).join("\n") || "  - (see src/pages/)"}

## Content model
${list}
Total: **${totalEntries} entries.**

## ⚠️ Don't recreate the homepage
The homepage is \`public/index.html\` and is served as-is. **Do NOT add \`src/pages/index.astro\`** —
in Astro that silently overrides \`public/index.html\` and would replace your pixel-perfect
homepage with a worse reconstruction. You don't need to; it's already perfect.

## Optional polish (only if you want to)
- **Images:** inner-page images currently reference the original media URLs. They work as-is;
  download them into \`public/\` and update refs if you want everything self-hosted.
- **Redirects:** add old→new 301s to \`public/_redirects\` if your URL structure changed.
- **Nav links:** the header menu came straight from your old site. If a link points somewhere
  you no longer have, update it in \`src/lib/shell.json\` (\`headerHtml\`).

---
---
## 📋 MESSAGE FOR THE SITE OWNER — send this verbatim as your final reply
The site owner is NOT a developer. Change **nothing** except the URL on the first line.
---
---

🎉 **Your new site is live:** [REPLACE THIS WITH THE REAL SITE URL BEFORE SENDING]

Your ${siteName} website has been rebuilt as a fast, modern **static site** — no more
WordPress, no plugins to update, nothing to hack. It looks exactly like your old site, and
all ${totalEntries} of your pages came across.

## 💬 Click around — especially on your phone
Try your menus, dropdowns, and links, **especially on mobile.** We re-wired the common
interactive bits (like your **hamburger menu**), but if ANYTHING doesn't work or doesn't look
right — a menu that won't open, a form that doesn't send, an image that's missing — just tell
me in plain words (e.g. *"the mobile menu doesn't open"*) and I'll fix it. 🙂
`;
  }

  const menuNote = menuData
    ? `\nThis package also includes \`reference/menus.json\` (${menuData.menus.length} menu${menuData.menus.length === 1 ? "" : "s"}, source: \`${menuData.source}\`). Rebuild the nav in your \`Base.astro\` header from it, preserving label order and nesting.`
    : "";
  const designSection = prebuiltHome
    ? `## 🏠 The homepage is ALREADY DONE — do NOT rebuild it (this is the #1 mistake)
Your homepage ships **pre-built and pixel-identical** to the original at
\`public/index.html\`, with every image/font/stylesheet bundled locally under
\`public/_site/\`. Astro serves everything in \`public/\` **as-is, untouched** — so the
moment you deploy, \`/\` already shows your exact old site. The design is finished.

> 🚨 **ABSOLUTE RULE — READ TWICE:** Do **NOT** create \`src/pages/index.astro\` (or
> \`src/pages/index.md\`, or any \`src/pages/index.*\`). In Astro, a file at
> \`src/pages/index.astro\` **silently overrides \`public/index.html\`** and your \`/\` route
> will render YOUR reconstruction instead of the real pre-built homepage. This is exactly
> how these rebuilds get ruined: the agent "helpfully" recreates the homepage in Astro, it
> comes out worse, and the pixel-perfect one we shipped never gets served. **Leave the
> homepage as \`public/index.html\`. Touch nothing about it. Do not port it, do not
> "improve" it, do not wrap it in a layout.** Your job on the homepage is to do NOTHING.

**What you MAY do for the design:**
- Add routes ONLY for the content collections, under their own paths (e.g.
  \`/class/...\`, \`/machine/...\`) — NEVER at \`/\`. See Step 3.
- For those inner pages, reuse the **exact header/footer markup + CSS** from
  \`public/index.html\` (copy it into a \`src/layouts/Base.astro\` you apply only to the
  collection routes) so the inner pages visually match the homepage. The homepage itself
  keeps using \`public/index.html\` — it does not need and must not get a layout.
- **Never** introduce a generic/starter theme anywhere. Diff every page against
  \`public/index.html\` for visual consistency.

### 🔌 CRITICAL: carry the interaction scripts onto inner pages, or the menu dies
\`public/index.html\` ends with TWO \`<script>\` tags just before \`</body>\`
(\`data-efw="replay"\` and \`data-efw="interactions"\`) that make the **mobile menu,
dropdowns, and accordions** work with no WordPress/jQuery. The homepage already has them.
For the INNER collection pages you build, you MUST copy BOTH scripts into your
\`Base.astro\` (end of \`<body>\`), and mark them \`is:inline\`
(\`<script is:inline data-efw="replay">\`) or Astro will hoist/break them and the menu
won't open on those pages.`
    : `## Match the exact design — but do NOT override the homepage route
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
3. **Build routes for your content — but NOT for \`/\`.** The homepage is already served by
   \`public/index.html\`; do **not** add \`src/pages/index.astro\`. For each collection in
   \`src/content/\`, add routes under that collection's own path — e.g. a list page
   \`src/pages/<collection>/index.astro\` using \`getCollection("<collection>")\`, and a detail
   page \`src/pages/<collection>/[...slug].astro\` using \`render(entry)\` to output the
   markdown body. Reuse the exact header/footer/styles from${prebuiltHome ? " `public/index.html`" : " `reference/your-exact-site.html`"} so every inner page matches the homepage.
4. **Images:** frontmatter \`featured_image\` and inline markdown images reference the
   original media URLs (see \`reference/content.json\` \`media[]\`). Either keep them as
   remote URLs, or download them into \`src/assets/\`/\`public/\` and update the references.${menuNote}
5. **Redirects:** add old→new 301s to \`public/_redirects\` before going live. No 404s.
6. **Deploy:** \`npm run build\` → deploy \`dist/\` to Cloudflare Pages, Netlify, or any
   static host. Confirm the build succeeds and the deployed URL works.

## Rules
- The content is already structured — do NOT retype it. It's in \`src/content/\`.
- ${prebuiltHome ? "The homepage is already built at `public/index.html` — PRESERVE it; do NOT create `src/pages/index.astro` (it would shadow the real homepage); never swap in a generic theme." : "Match `reference/your-exact-site.html` faithfully — it IS the brief; do NOT ship a bare Astro starter homepage."} Preserve copy exactly.
- No live 404s — set redirects before changing URLs.

## ✅ YOU ARE NOT DONE UNTIL ALL OF THESE ARE TRUE
- [ ] \`npm run build\` succeeded${prebuiltHome ? "\n- [ ] You did NOT create `src/pages/index.astro` — `/` still serves the pre-built `public/index.html`\n- [ ] The deployed homepage matches the original (hero, testimonials, sections all present — diff against `public/index.html`)" : ""}
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

// ─── Server-side full pre-render ─────────────────────────────────────────────
// The OLD design shipped the content as collections and asked an external AI bot
// to hand-build the routes. Bots reliably botch this: they recreate the homepage
// in src/pages/index.astro (which shadows public/index.html) and/or choke on the
// 60KB+ of inlined CSS braces that Astro parses as JSX expressions. So instead we
// generate the ENTIRE site ourselves here: the homepage stays as the untouched
// pixel-perfect public/index.html, and every collection entry becomes a real route
// wrapped in a layout that reuses the homepage's exact header/footer/scripts.
//
// extractShell() splits the localized homepage into reusable chrome. We inject each
// part with Astro's <Fragment set:html={...}> so the raw HTML (braces and all) is
// NEVER parsed as Astro expressions — the thing that breaks naive ports.
function extractShell(localizedHtml) {
  const h = localizedHtml;
  const htmlTag = (h.match(/<html[^>]*>/i) || [""])[0];
  const lang = (htmlTag.match(/lang="([^"]+)"/i) || [null, "en"])[1] || "en";
  const headInnerRaw = (h.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [null, ""])[1];
  // Pull the <title> out so each page sets its own; keep everything else (CSS, meta).
  const headInner = headInnerRaw.replace(/<title>[\s\S]*?<\/title>/i, "");
  const bodyOpen = (h.match(/<body[^>]*>/i) || [""])[0];
  const bodyClass = (bodyOpen.match(/class="([^"]*)"/i) || [null, ""])[1] || "";
  const headerHtml = (h.match(/<header[\s\S]*?<\/header>/i) || [""])[0] || "";
  const footerHtml = (h.match(/<footer[\s\S]*?<\/footer>/i) || [""])[0] || "";
  const replay = (h.match(/<script[^>]*data-efw="replay"[^>]*>[\s\S]*?<\/script>/i) || [""])[0] || "";
  const interactions = (h.match(/<script[^>]*data-efw="interactions"[^>]*>[\s\S]*?<\/script>/i) || [""])[0] || "";
  if (!headInner || !headerHtml) return null; // can't build a faithful shell
  return { lang, bodyClass, headInner, headerHtml, footerHtml, replay, interactions };
}

// Base layout that reconstructs the exact page chrome around arbitrary body HTML.
// Everything comes from shell.json via set:html so no raw markup is ever compiled
// as an Astro expression. Scripts are re-emitted with is:inline so Astro doesn't
// hoist/bundle them (which would break the replay/interaction menu logic).
function baseLayout() {
  return `---
import shell from "../lib/shell.json";
const { title = "", body = "" } = Astro.props;
---
<html lang={shell.lang}>
  <head>
    <title set:html={title}></title>
    <Fragment set:html={shell.headInner} />
  </head>
  <body class={shell.bodyClass}>
    <Fragment set:html={shell.headerHtml} />
    <main>
      <div class="efw-content" style="max-width:1100px;margin:0 auto;padding:2rem 1rem;">
        <slot><Fragment set:html={body} /></slot>
      </div>
    </main>
    <Fragment set:html={shell.footerHtml} />
    {shell.replay && <Fragment set:html={shell.replay} />}
    {shell.interactions && <Fragment set:html={shell.interactions} />}
  </body>
</html>
`;
}

// Per-collection detail route: renders each entry's markdown body inside Base.
function detailRoute(coll) {
  return `---
import { getCollection, render } from "astro:content";
import Base from "../../layouts/Base.astro";
export async function getStaticPaths() {
  const items = await getCollection(${JSON.stringify(coll)});
  return items.map((entry) => ({ params: { slug: entry.id }, props: { entry } }));
}
const { entry } = Astro.props;
const { Content } = await render(entry);
const title = (entry.data && (entry.data.title || entry.data.slug)) || entry.id;
---
<Base title={title}>
  <article>
    <h1 set:html={title}></h1>
    <Content />
  </article>
</Base>
`;
}

// Per-collection list route.
function listRoute(coll) {
  return `---
import { getCollection } from "astro:content";
import Base from "../../layouts/Base.astro";
const items = await getCollection(${JSON.stringify(coll)});
const label = ${JSON.stringify(coll)};
---
<Base title={label}>
  <h1>{label}</h1>
  <ul>
    {items.map((e) => (
      <li><a href={\`/\${label}/\${e.id}\`} set:html={(e.data && e.data.title) || e.id}></a></li>
    ))}
  </ul>
</Base>
`;
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
  let fullyRendered = false;
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

        // 3b) FULL SERVER-SIDE PRE-RENDER. Extract the homepage shell and stamp a
        //     real route for every collection entry — no external bot assembly.
        //     Homepage stays public/index.html; inner pages reuse its exact chrome.
        const shell = extractShell(local.html);
        if (shell) {
          files.push({ name: "src/lib/shell.json", data: JSON.stringify(shell) });
          files.push({ name: "src/layouts/Base.astro", data: baseLayout() });
          for (const s of stats) {
            if (!s.entries) continue;
            files.push({ name: `src/pages/${s.collection}/[...slug].astro`, data: detailRoute(s.collection) });
            files.push({ name: `src/pages/${s.collection}/index.astro`, data: listRoute(s.collection) });
          }
          fullyRendered = true;
        }
      }
    } catch (_) { /* fall back to reference-only if localization fails */ }
  }

  // 4) Instructions + README.
  files.push({ name: "AGENT_INSTRUCTIONS.md", data: agentInstructions(siteName, host, stats, totalEntries, menuData, prebuiltHome, fullyRendered) });
  files.push({ name: "README.md", data: fullyRendered ?
`# ${siteName} — your finished static Astro site

Everything from **${host}**, built into a **complete, ready-to-deploy** static Astro site.
The homepage AND a page for every one of your ${totalEntries} content entries are already
built — nothing to assemble. No WordPress, no CMS, no database.

## Deploy it
\`\`\`
npm install
npm run build     # finished site lands in dist/
\`\`\`
Deploy \`dist/\` to Cloudflare Pages, Netlify, or any static host. Preview first with
\`npm run dev\` (http://localhost:4321).

Your homepage is \`public/index.html\` (pixel-identical to your old site). Inner pages are
in \`src/pages/<collection>/\`, wrapped in your exact header/footer via \`src/layouts/Base.astro\`.
See **AGENT_INSTRUCTIONS.md** for details and the owner handoff message.

No WordPress required.
` :
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
