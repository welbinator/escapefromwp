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
    author:  "Aaron Edwards",
    handle:  "@uglyrobot",
    source:  "X (Twitter)",
    type:    "tweet",
    url:     "https://x.com/uglyrobot/status/2041115125315223967",
    date:    "2025-10-14",
    summary: "Former WordPress CTO helped his sister ditch WordPress hosting in 10 minutes. Free Cloudflare Pages + ChatGPT built and deployed a beautiful, fast, secure static site. She updates it by just telling ChatGPT. \"Why WP?\"",
    story:   `My sister needed a new website. Had already bought WordPress hosting and a domain. Couldn't figure out how to build a site. 50 plugins preinstalled, upgrade notices everywhere, overwhelming. I've been in WP for over 15 years — I no longer can build a site with it.

In 10 mins set her up with free Cloudflare Pages and a few prompts in Codex (included free in her ChatGPT Plus sub) and it built and deployed a beautiful fast secure static site for her.

Now she can just tell ChatGPT if she needs any updates and it just does it.

Why WP?`,
    likes:   null,
    shares:  null,
  },
  {
    author:  "Michal Barus",
    handle:  "@webjuice_ie",
    source:  "X (Twitter)",
    type:    "tweet",
    url:     "https://x.com/webjuice_ie/status/2115065418972835962",
    date:    "2026-10-28",
    summary: "Agency switched 40 client sites from WordPress to Astro on Cloudflare. The real reason: AI agents can read, edit, and PR plain files in Git — they can't do that with wp-admin. WordPress was built for humans clicking buttons. The new stack is built for agents.",
    story:   `We switched all our client sites from WordPress to Astro on Cloudflare.

The real reason wasn't just speed or security. It was agents.

WordPress was built for humans clicking buttons. Our new stack is built for agents that plan, code, and ship under human approval.

Plain files in Git repos. AI agents can read, edit, and generate clean diffs and pull requests. Changes go through human-reviewed PRs with before/after screenshots.

No wp-admin login surface for bots. No plugins that break overnight. No maintenance at 2am.

WordPress was built for humans. We built our stack for agents.`,
    likes:   null,
    shares:  null,
  },
  {
    author:  "Matt Evans",
    handle:  "@mattevanstech",
    source:  "X (Twitter)",
    type:    "tweet",
    url:     "https://x.com/mattevanstech/status/2108750183790256604",
    date:    "2026-10-10",
    summary: "Ditched WordPress for EmDash amid the Automattic leadership drama. Short, punchy, and says everything.",
    story:   `I ditched my WordPress for #EmDash. I'm not sure what is going on… 🍿`,
    likes:   null,
    shares:  null,
  },
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
