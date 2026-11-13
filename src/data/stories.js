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
    author:   "WPTuts",
    handle:   "@WPTutz",
    source:   "Twitter / X",
    type:     "tweet",
    url:      "https://x.com/WPTutz/status/2120861457827156009",
    date:     "2026-11-12",
    storySlug: "wptutz-20261112",
    quote:    "That's one more site taken off WordPress and moved to a static version - less updates = Happier me!",
    summary:  "WPTuts has helped thousands of people get more from WordPress for years. Even they moved a site off it to a static version. The verdict: fewer updates, happier life. h/t @WPTutz",
    context:  "WPTuts has helped thousands of people get more from WordPress for years. Even they moved a site off it to a static version. The verdict: fewer updates, happier life.",
  },
  {
    author:   "Dave Foy",
    handle:   "@davefoy",
    source:   "davefoy.com",
    type:     "blog",
    url:      "https://www.davefoy.com/blog/how-i-built-this-site/",
    date:     "2026-11-09",
    storySlug: "davefoy-how-i-built-this-site",
    quote:    "I haven't written a single line of code. The site went live the next day. It runs on Cloudflare for free.",
    summary:  "Dave Foy has taught thousands of people to build WordPress sites with page builders for 20+ years. When it came time to rebuild his own site, he ditched both. The result: Astro + Cloudflare Pages, built with Claude Code, live in a day, $0 hosting. His insight: you need solid conventions and best practices more than ever — the AI is just the builder, the decisions are still yours.",
    context:  "Dave Foy has taught thousands of people to build WordPress sites with page builders for 20+ years. When it came time to rebuild his own site, he ditched both. The result: Astro + Cloudflare Pages, built with Claude Code, live in a day, $0 hosting. His insight: you need solid conventions and best practices more than ever — the AI is just the builder, the decisions are still yours.",
  },
  {
    author:   "Michal Barus",
    handle:   "@webjuice_ie",
    source:   "Twitter / X",
    type:     "tweet",
    url:      "https://x.com/webjuice_ie/status/2119805618504470668",
    date:     "2026-11-09",
    storySlug: "webjuice_ie-20261109",
    quote:    "My clients don't edit their site. They asked for a site, not an admin panel. We carried a login page, a theme and a plugin stack for nothing.",
    summary:  "16 years building on WordPress. Then Michal deleted it. His agency moved 40 client sites to Astro + Cloudflare Workers — and realized clients never wanted the CMS in the first place. They also never truly owned the code: theme licences, builder licences, plugin licences. The site works until one of them changes the rules.",
    context:  "16 years building on WordPress. Then Michal deleted it. His agency moved 40 client sites to Astro + Cloudflare Workers — and realized clients never wanted the CMS in the first place. They also never truly owned the code: theme licences, builder licences, plugin licences. The site works until one of them changes the rules.",
  },
  {
    author:   "Michal Barus",
    handle:   "@webjuice_ie",
    source:   "Twitter / X",
    type:     "thread",
    url:      "https://x.com/webjuice_ie/status/2117692965560762519",
    date:     "2026-11-03",
    storySlug: "webjuice_ie-20261103b",
    quote:    "The $90/month hosting savings were minor. The real win was eliminating hours spent monthly on maintenance, updates, and manual work. No servers to maintain, no plugins, no WP tax. Everything in one Git repo so AI agents can edit it. Owner approves every change.",
    summary:  "Michal's full step-by-step guide to migrating 40 WordPress sites to Astro + Cloudflare Workers: audit everything first, export content to Markdown, rebuild in Astro, deploy to Cloudflare, cut over DNS site by site. Includes before/after cost breakdown and when to stay on WordPress.",
    context:  "Michal's full step-by-step guide to migrating 40 WordPress sites to Astro + Cloudflare Workers: audit everything first, export content to Markdown, rebuild in Astro, deploy to Cloudflare, cut over DNS site by site, monitor Search Console. Includes before/after cost breakdown, the client request workflow, and when to stay on WordPress (WooCommerce, stores).",
  },
  {
    author:   "Michal Barus",
    handle:   "@webjuice_ie",
    source:   "Twitter / X",
    type:     "thread",
    url:      "https://x.com/webjuice_ie/status/2117614058513797331",
    date:     "2026-11-03",
    storySlug: "webjuice_ie-20261103",
    quote:    "The real cost of WordPress wasn't hosting — it was the endless hours on updates, plugin conflicts, hacked sites, and manual changes. Static files on Cloudflare = no plugins, no server patching, no WordPress vulnerabilities. Mobile PageSpeed went from 50–70 → 95–100.",
    summary:  "Michal runs an SEO agency that migrated 40 client WordPress sites to Astro + Cloudflare Workers. Follow-up thread answering the most common questions: why Astro, how long it took, how clients request edits now, how AI agents manage the repo.",
    context:  "Michal runs an SEO agency that migrated 40 client WordPress sites to Astro + Cloudflare Workers. This is his detailed follow-up thread answering the most common questions: why Astro, how long it took, how clients request edits now, how AI agents manage the repo, and when WordPress might still make sense.",
  },
  {
    author:  "Illia",
    handle:  "@illiaonline",
    source:  "LinkedIn",
    type:    "post",
    url:     "https://www.linkedin.com/posts/illiaonline_wordpress-ai-webdevelopment-share-7523145884658917376-PQf4/",
    date:    "2026-10-28",
    summary: "10 years ago clients paid him to move static HTML sites TO WordPress. Now they ask how to move back. The reason: AI agents manage their sites now, and agents work better with files than dashboards. The best stack depends on who — or what — is editing the content.",
    story:   `10 years ago, clients paid me to move their static HTML sites to WordPress. The pitch was simple: "You shouldn't need a developer to change a headline. Get a CMS, log in, click Edit, done."

Now I keep seeing people ask for the exact opposite.

"How do I convert my WordPress site to static HTML?"

Why? Because an AI agent manages their site now, and agents work much better with files than with dashboards.

The thinking flipped completely. Back then the CMS was the interface, because the person editing the site wasn't technical. Now the one editing the site is an AI agent, and its interface is plain text, Git, and a terminal.

A database, 40 plugins, and an admin panel were built for humans who click. An agent just wants a folder of files it can read, edit, commit, and deploy.

So the "outdated" static site is suddenly modern again.

I don't think WordPress is going away. It still powers a huge part of the web, and for many teams it's still the right tool. But the lesson I keep coming back to is this: the best stack depends on who (or what) is editing the content.

Ten years ago that was a marketing manager. Today it might be Claude.`,
    likes:   null,
    shares:  null,
  },
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
