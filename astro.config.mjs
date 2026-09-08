// @ts-check
import { defineConfig } from 'astro/config';

// PAGES_BASE is set only in the GitHub Pages staging build (repo subpath).
// Production (Cloudflare Pages, custom domain) leaves it unset → base "/".
const base = process.env.PAGES_BASE || undefined;

// https://astro.build/config
export default defineConfig({
  base,
  site: base ? 'https://welbinator.github.io' : 'https://escapefromwp.com',
});
