// Build a ready-to-run EmDash project zip for the "No, just give me a zip" path.
//
// Produces a single zip the customer can unpack and run (`npm install && npm run dev`)
// containing:
//   - A runnable EmDash + Astro project scaffold (package.json, astro.config, emdash.config)
//   - Their content baked in: emdash/seed.json (content model) + content/<collection>/*.md
//   - content.json + menus.json manifests (machine-readable)
//   - reference/your-exact-site.html — the exact-replica HTML we already captured
//   - AGENT_INSTRUCTIONS.md — tells their AI assistant how to fuse the exact look
//     (reference HTML) onto the default EmDash theme, step by step
//   - README.md — plain-language quickstart
//
// Content comes from the same extractor the /liberate bundle uses, so this reuses
// proven code. The exact-look half is the replica HTML we stored at capture time.

import { extractSite, normalizeSiteUrl } from "../functions/api/_lib/wp-extract.js";
import { buildBundleFiles } from "../functions/api/_lib/build-bundle.js";
import { zipSync } from "../functions/api/_lib/zip.js";

function slug(s) {
  return (s || "site").toString().toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60) || "site";
}

// Minimal but real EmDash/Astro scaffold files. Kept deliberately small — the
// agent instructions drive the real theme work. Versions are left loose so
// `npm install` resolves current releases.
function scaffoldFiles(siteSlug, siteName) {
  const files = [];
  files.push({ name: "package.json", data: JSON.stringify({
    name: siteSlug,
    type: "module",
    version: "0.1.0",
    private: true,
    scripts: {
      dev: "astro dev",
      build: "astro build",
      preview: "astro preview",
      seed: "emdash seed",
      "emdash": "emdash",
    },
    dependencies: {
      "astro": "^5.0.0",
      "@emdash-cms/core": "latest",
      "@emdash-cms/admin": "latest",
    },
    devDependencies: {
      "emdash": "latest",
      "wrangler": "^3.0.0",
    },
  }, null, 2) });

  files.push({ name: "astro.config.mjs", data:
`import { defineConfig } from "astro/config";

// Standard EmDash + Astro config. Deploy target is Cloudflare Pages (D1 + R2),
// matching how Escape From WP ships sites. If you deploy elsewhere, swap the
// adapter per the Astro docs.
export default defineConfig({
  site: "https://${siteSlug}.example.com",
  output: "static",
});
` });

  files.push({ name: "emdash.config.ts", data:
`// EmDash project config. The content model lives in seed.json (generated from
// your WordPress site). Run \`npx emdash seed\` to load it into your dev DB.
export default {
  name: ${JSON.stringify(siteName)},
  collectionsSeed: "./seed.json",
};
` });

  files.push({ name: ".gitignore", data: "node_modules/\ndist/\n.astro/\n.env\n.wrangler/\n" });

  files.push({ name: "public/_redirects", data: "# Add 301s here before changing any live URLs — no 404s at cutover.\n" });

  files.push({ name: "src/pages/index.astro", data:
`---
// Starter home page. Replace this with your real homepage once you've fused the
// exact look from reference/your-exact-site.html (see AGENT_INSTRUCTIONS.md).
// Your content is already available through EmDash collections (emdash/seed.json).
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${siteName}</title>
  </head>
  <body>
    <main style="max-width:720px;margin:10vh auto;font-family:system-ui,sans-serif;padding:0 20px;line-height:1.6">
      <h1>${siteName}</h1>
      <p>This is a fresh EmDash + Astro project seeded with your content.</p>
      <p>Open <code>AGENT_INSTRUCTIONS.md</code> and hand it to your AI assistant to
         rebuild your exact design on top of this project.</p>
    </main>
  </body>
</html>
` });

  return files;
}

function agentInstructions(siteName, host, stats) {
  const list = (stats || []).map((s) => `- \`${s.collection}\` — ${s.entries} entr${s.entries === 1 ? "y" : "ies"}`).join("\n") || "- (see content.json)";
  return `# Rebuild ${siteName} in EmDash — instructions for your AI coding assistant

You have a ready-to-run **EmDash + Astro** project, pre-seeded with all the content
from **${host}**, plus an **exact HTML copy of the original site** to match the look.

Your job: make this EmDash project render as the content-managed version of the
original site — same design, but now driven by editable EmDash collections instead
of WordPress.

## What's in this zip
- \`seed.json\` — the content model (one collection per content type).
- \`content/<collection>/*.md\` — every page/post as markdown with frontmatter.
- \`content.json\` — machine-readable manifest (all entries + media URLs).
- \`menus.json\` — the site navigation (when it could be extracted).
- \`reference/your-exact-site.html\` — **the exact visual copy** of the original
  homepage (self-contained: all CSS inlined, images/fonts already rehosted). This
  is your design source of truth.
- \`src/\` — a minimal Astro starter to replace.

## Content model
${list}

## Step-by-step
1. **Install & run:** \`npm install\` then \`npx emdash seed\` (loads seed.json into the
   dev database), then \`npm run dev\`. Confirm the EmDash admin shows your collections.
2. **Study the exact look:** open \`reference/your-exact-site.html\` in a browser. This
   is pixel-faithful to the original. Extract its design tokens — fonts, colors,
   spacing, header/footer, section layouts.
3. **Build the layout:** create \`src/layouts/Base.astro\` reproducing the header, nav
   (from \`menus.json\`), and footer from the reference HTML. Wire the EmDash CSS vars
   (\`--font-body\`, \`--font-heading\`, \`--color-primary\`, etc.) to the real values.
4. **Rebuild the homepage:** replace \`src/pages/index.astro\` to match the reference
   homepage's sections, but pull text/images from the seeded collections via
   \`getEmDashCollection()\` / \`getEmDashEntry()\` + \`<PortableText />\`.
5. **Templates:** add \`src/pages/posts/[slug].astro\` (and one route per collection)
   styled to match the reference. Reuse the reference's typography/spacing.
6. **Media → WebP + R2** for production (optional but recommended).
7. **Redirects:** add any old→new URL 301s to \`public/_redirects\` before going live.
8. **Deploy:** Cloudflare Pages + D1 + R2 (EmDash's standard target), or your host.

## Rules
- Match the reference design faithfully — it IS the brief.
- Preserve all original copy exactly.
- Portable Text: EmDash rich text is Portable Text JSON, not markdown/HTML — convert
  the markdown bodies as you import them into components.
- No live 404s — set up redirects before changing any URLs.

Hand this whole folder to your assistant and work through the steps in order.
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

  // Content bundle (markdown + seed.json + manifests), reusing the proven builder.
  const { files: bundle } = buildBundleFiles(extract, "emdash"); // [{name,data}]
  const stats = extract.collections.map((c) => ({ collection: c.type, entries: c.entries.length }));

  // Assemble the full project: scaffold + content bundle + reference HTML + agent md.
  const files = [];
  for (const f of scaffoldFiles(siteSlug, siteName)) files.push(f);
  for (const f of bundle) {
    // Keep bundle's content/ + manifests, but don't clobber our README/AGENT files.
    if (f.name === "README.md" || f.name === "AGENT_INSTRUCTIONS.md") continue;
    files.push(f);
  }
  if (replicaHtml && replicaHtml.length > 500) {
    files.push({ name: "reference/your-exact-site.html", data: replicaHtml });
  }
  files.push({ name: "AGENT_INSTRUCTIONS.md", data: agentInstructions(siteName, host, stats) });
  files.push({ name: "README.md", data:
`# ${siteName} — your EmDash site

A ready-to-run EmDash + Astro project built from **${host}**, plus an exact copy of
your original site to match the design.

## Quick start
\`\`\`
npm install
npx emdash seed     # load your content into the dev database
npm run dev         # run the site + EmDash admin locally
\`\`\`

## Make it look exactly like your old site
Open **AGENT_INSTRUCTIONS.md** and hand it (and this whole folder) to your AI coding
assistant. It walks through fusing your exact design (reference/your-exact-site.html)
onto this content-managed project.

Your content is already here — no WordPress required.
`});

  // Convert string data to the zipSync file shape (it accepts {name, data:string|Uint8Array}).
  const zip = zipSync(files);
  const filename = `${siteSlug}-emdash-site.zip`;
  return { zip, filename, siteName };
}
