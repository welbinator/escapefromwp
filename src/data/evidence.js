// EVIDENCE ENTRIES — reasons to escape WordPress, collected from the wild.
// Shared by the evidence index (/evidence) and the per-post pages (/evidence/<slug>).
// Each entry: {
//   title, url (the external source), source (site/author),
//   type (article|tweet|linkedin|video|post), date (YYYY-MM-DD),
//   summary (1–2 sentences),
//   image (optional path under /images/evidence/ — OMIT when the link has no usable OG image),
//   slug (optional — auto-derived from the title when omitted; set manually to keep a share URL stable)
// }
export const evidence = [
  {
    title: "16 Years of WordPress. Then I Deleted It.",
    url: "https://x.com/webjuice_ie/status/2119805618504470668",
    source: "@webjuice_ie (Michal Barus, web agency owner)",
    type: "tweet",
    date: "2026-11-09",
    summary: "After 16 years building on WordPress, Michal Barus moved 40 client sites to Astro + Cloudflare Workers. His verdict: clients never needed the CMS — they asked for a site, not an admin panel. The login page, the theme license, the plugin stack — all dead weight carried for nothing.",
    slug: "16-years-wordpress-deleted-webjuice",
  },
  {
    title: "While People Are Leaving WordPress, Leadership Is Adding Frivolous Features to Core",
    url: "https://x.com/Tmeister/status/2118796736344867152",
    source: "@Tmeister (Enrique Chavez, WordPress developer)",
    type: "tweet",
    date: "2026-11-06",
    summary: "Developer @wesbos migrated 307 posts, 6.7GB of photos, and 15 years on a $600 Bluehost server to EmDash — while WordPress leadership adds random features to core 'just for fun.' h/t @Tmeister",
    slug: "wp-leadership-frivolous-features-tmeister",
  },
  {
    title: "Hackers Race to Hijack WordPress Sites in the Seconds They Spend Updating",
    url: "https://x.com/IntCyberDigest/status/2118681050679292135",
    source: "@IntCyberDigest (International Cyber Digest, 275k followers)",
    type: "tweet",
    date: "2026-11-06",
    summary: "A WordPress core update puts the installer in a public folder — whoever hits it first becomes admin. Wordfence has blocked 240,000+ hijack attempts exploiting this window. h/t @IntCyberDigest",
    slug: "wordpress-update-hijack-intcyberdigest",
  },
  {
    title: "CISA Warns of Active Exploitation During WordPress Updates — Patch to 7.1.4 Now",
    url: "https://x.com/dipakcgajjar/status/2118023426023866500",
    source: "@dipakcgajjar (WordPress specialist, 5.4k followers)",
    type: "tweet",
    date: "2026-11-04",
    summary:
      "CISA issued an active exploitation warning: attackers are targeting WordPress sites specifically during core update windows — the update process itself is an attack surface. WordPress specialist Dipak Gajjar is urging site owners not to wait for scheduled maintenance and update to 7.1.4 immediately. Static sites don't have a CMS to patch, ever.",
    slug: "cisa-wordpress-update-exploit-dipakcgajjar",
  },
  {
    title: "WordPress 7.1.4: Yet Another Security Release",
    url: "https://www.searchenginejournal.com/wordpress-announces-another-security-release-version-7-1-4/594798/",
    source: "Search Engine Journal",
    type: "article",
    date: "2026-10-29",
    summary:
      "WordPress 7.1.4 is a security release, making it the fourth maintenance/security patch in the 7.1 cycle alone. The WordPress team is asking all sites to update immediately. If you're running WordPress, this is your life: another week, another mandatory update or you're exposed. A static site has no CMS to patch.",
    image: null,
  },
  {
    title: "Another emergency PHP security release — and WordPress runs on PHP",
    url: "https://www.php.net/archive/2026.php#2026-10-20-1",
    source: "php.net",
    type: "post",
    date: "2026-10-20",
    summary:
      "The PHP security team gave advance notice of an urgent security release scheduled for 21 October 2026 — the kind of patch-now bulletin that lands on a regular cadence. WordPress is built on PHP, so every one of these is a server your WordPress site has to keep patched, or quietly fall behind. A static, pre-built site has no live PHP for an attacker to reach in the first place — the whole class of risk simply goes away.",
    image: null,
  },
  {
    title: "Stolen UpdraftCentral keys are backdooring WordPress sites",
    url: "https://patchstack.com/articles/updraftcentral-key-compromise-wordpress-backdoors/",
    source: "Patchstack",
    type: "article",
    date: "2026-10-19",
    summary:
      "Attackers holding valid UpdraftCentral keys are silently installing backdoor plugins on sites running UpdraftPlus — WordPress's most popular backup plugin, with 4M+ installs. There's no CVE and no plugin update that stops it: the commands are correctly signed, so every check passes. Worse, the remote-control checkbox ships ticked by default, enrolling sites that never knowingly used the service. The only fix is to delete your UpdraftCentral keys. A textbook case of plugin-layer risk that simply can't exist on a static, plugin-free stack.",
    image: null,
  },
  {
    title: "Even WordPress leadership can't make the case for WordPress",
    url: "https://x.com/PineDigitalCo/status/2106712178363670769",
    source: "@PineDigitalCo",
    type: "tweet",
    date: "2026-10-04",
    summary:
      "Agency owner Ryan Logan says the quiet part out loud: when WordPress's own leadership, the people who founded and run the project, won't stand behind it or recommend it, how is anyone else supposed to? When the founder can't defend using WordPress, that is your sign to stop using WordPress too.",
    image: null,
  },
  {
    title: "We Moved 5 WordPress Sites to EmDash CMS 1.0",
    url: "https://vapvarun.com/emdash-cms-five-wordpress-sites-1-0/",
    source: "vapvarun.com",
    type: "article",
    date: "2026-10-01",
    summary:
      "A WordPress plugin/theme shop gives the honest field report of moving five of their own content sites off WordPress and onto EmDash CMS (the open-source, Astro-based CMS from Cloudflare). Their takeaway: content sites are exactly where a WordPress install carries the most weight for the least return — every plugin you don't need is just more code to update, audit, and patch.",
    image: null,
  },
  {
    title: "A critical Elementor flaw let attackers create admin accounts from one link",
    url: "https://x.com/bradvin/status/2105643896659480912",
    source: "@bradvin",
    type: "tweet",
    date: "2026-10-01",
    summary:
      "WordPress plugin developer Brad Vincent urges everyone on Elementor 4.3.0/4.3.1 to update immediately: both carry a CSRF bug rated 8.8/10. If a logged-in admin opens a crafted link, an attacker can silently create a new admin account. It's the kind of plugin-layer vulnerability that simply doesn't exist when there are no plugins to exploit.",
    image: null,
  },
  {
    title: "Cleaning 60+ WordPress Installs on a Fully-Infected WHM Server",
    url: "https://vapvarun.com/cleaning-60-wordpress-installs-on-a-fully-infected-whm-server/",
    source: "vapvarun.com",
    type: "article",
    date: "2026-09-13",
    summary:
      "A hands-on incident report: one cPanel server with 22 accounts and 60+ WordPress installs reinfected itself over and over because the backdoor hid in nine places at once — mu-plugins, drop-ins, the database, cron, rogue admins, theme code, .htaccess, decoy files, and an SSH key. A stark look at how fragile a plugin-heavy WordPress stack really is.",
    image: null,
  },
];

export const TYPE_LABEL = {
  article: "Blog article",
  tweet: "Post on X",
  linkedin: "LinkedIn post",
  video: "Video",
  post: "Post",
};

export const slugify = (s) =>
  (s || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

// Each entry gets a stable slug (explicit `slug` wins; otherwise derived from title).
export const getSlug = (e) => e.slug || slugify(e.title);

export const fmtDate = (d) => {
  if (!d) return "";
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};
