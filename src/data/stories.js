// Success stories — people across the web who left WordPress.
// NOT clients (those live in escapees). These are blog posts, tweets, threads, etc.
// Add newest first. `type`: tweet | thread | blog | video | post

export const STORY_TYPE_LABEL = {
  tweet:  "Tweet",
  thread: "Thread",
  blog:   "Blog post",
  video:  "Video",
  post:   "Post",
};

export const stories = [
  {
    author:  "Michal Barus",
    handle:  "@webjuice_ie",
    source:  "X (Twitter)",
    type:    "tweet",
    url:     "https://x.com/webjuice_ie/status/2117248863505690703",
    date:    "2026-11-02",
    summary: "Moved 40 WordPress sites to Astro on Cloudflare Workers for free. Saved $90/month in Hetzner + Plesk costs. No more plugins, security patches, or the WordPress tax.",
    story:   `We moved 40 WordPress sites to Astro. They now run on Cloudflare Workers for free.

It took us 2–3 months. Before that we paid for Hetzner servers plus Plesk to keep them alive. Updates, plugins, security patches, the usual WordPress tax.

What we did:
1. Pulled the content out of WordPress
2. Rebuilt each site in Astro — static pages, no plugins
3. Deployed to Cloudflare Workers
4. Switched DNS site by site and checked each one live
5. Backed everything up, then cancelled Hetzner and Plesk

Result: around $90 a month saved and the sites are faster and all we can control with AI agents.

Still running WordPress for clients in 2026?`,
    likes:   308,
    shares:  12,
  },
];

export function fmtStoryDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00Z");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export function storySlug(s) {
  return s.handle.replace("@", "").toLowerCase() + "-" + s.date.replace(/-/g, "");
}
