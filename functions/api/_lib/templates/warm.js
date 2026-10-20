// Template: "warm" — approachable small-business look (serif display, soft
// cards, generous spacing). Renders a site-model → full static HTML page.
//
// EmDash-twin structure: the page is composed of the SAME named sections an
// EmDash/Astro build would use (Hero, FeatureGrid, PostList, ContactCTA), each
// driven by the model's collections. Converting a winning preview to a real
// EmDash site = port these sections to .astro components reading the same data.

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// mdlite → safe inline HTML for body copy (headings, para, bold/italic, links, lists).
function mdInline(md) {
  if (!md) return "";
  let h = esc(md);
  h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return h;
}

// Template palettes — used when brand color_confidence is low (safe fallback).
const PALETTE = { primary: "#8a5a3b", secondary: "#c98b5e", bg: "#fbf7f2", ink: "#2b211a", text: "#ffffff" };

function brandVars(brand) {
  const useBrand = brand.color_confidence === "high";
  const primary = useBrand ? brand.primary : PALETTE.primary;
  const secondary = useBrand ? brand.secondary : PALETTE.secondary;
  const onPrimary = useBrand ? brand.text_on_primary : PALETTE.text;
  return { primary, secondary, onPrimary };
}

function logoOrWordmark(brand, v) {
  if (brand.logo_url) return `<img class="logo" src="${esc(brand.logo_url)}" alt="${esc(brand.name)}" />`;
  return `<span class="wordmark" style="color:${v.primary}">${esc(brand.name)}</span>`;
}

function navHtml(nav) {
  if (!nav?.length) return "";
  return `<nav class="nav-links">${nav.map((n) =>
    `<a href="${esc(n.href)}"${n.external ? ' rel="nofollow noopener"' : ""}>${esc(n.label)}</a>`).join("")}</nav>`;
}

function heroHtml(m, v) {
  const img = m.hero.image
    ? `<div class="hero-media"><img src="${esc(m.hero.image)}" alt="${esc(m.brand.name)}" loading="eager"/></div>` : "";
  return `
  <section class="hero ${m.hero.image ? "has-media" : ""}">
    <div class="hero-copy">
      <h1>${esc(m.hero.headline)}</h1>
      <p class="sub">${esc(m.hero.subheadline)}</p>
      <a class="btn" href="#contact" style="background:${v.primary};color:${v.onPrimary}">${esc(m.hero.cta)}</a>
    </div>
    ${img}
  </section>`;
}

function featuresHtml(m, v) {
  if (!m.features?.length) return "";
  return `
  <section class="features" id="about">
    <div class="feature-grid">
      ${m.features.map((f) => `
        <article class="card">
          ${f.image ? `<div class="card-media"><img src="${esc(f.image)}" alt="${esc(f.title)}" loading="lazy"/></div>` : `<div class="card-dot" style="background:${v.secondary}"></div>`}
          <h3>${esc(f.title)}</h3>
          ${f.text ? `<p>${esc(f.text)}</p>` : ""}
        </article>`).join("")}
    </div>
  </section>`;
}

function postsHtml(m, v) {
  if (!m.posts?.length) return "";
  return `
  <section class="posts" id="news">
    <h2 style="color:${v.primary}">Latest</h2>
    <div class="post-grid">
      ${m.posts.slice(0, 6).map((p) => `
        <article class="post">
          ${p.image ? `<div class="post-media"><img src="${esc(p.image)}" alt="${esc(p.title)}" loading="lazy"/></div>` : ""}
          <h3>${esc(p.title)}</h3>
          ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ""}
        </article>`).join("")}
    </div>
  </section>`;
}

function contactHtml(m, v) {
  return `
  <section class="contact" id="contact" style="background:${v.primary};color:${v.onPrimary}">
    <h2>${esc("Let’s work together")}</h2>
    <p>Ready to bring ${esc(m.brand.name)} online, done right? Get in touch.</p>
    <a class="btn ghost" href="#contact" style="border-color:${v.onPrimary};color:${v.onPrimary}">${esc(m.hero.cta)}</a>
  </section>`;
}

export function renderWarm(model) {
  const m = model;
  const v = brandVars(m.brand);
  const css = `
    :root{--p:${v.primary};--s:${v.secondary};--bg:${PALETTE.bg};--ink:${PALETTE.ink}}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Georgia,'Times New Roman',serif;color:var(--ink);background:var(--bg);line-height:1.6}
    img{max-width:100%;display:block;height:auto}
    .wrap{max-width:1120px;margin:0 auto;padding:0 24px}
    header{position:sticky;top:0;background:rgba(251,247,242,.92);backdrop-filter:blur(6px);border-bottom:1px solid #eadfd3;z-index:10}
    .bar{display:flex;align-items:center;justify-content:space-between;height:72px}
    .logo{max-height:40px;width:auto}
    .wordmark{font-size:1.4rem;font-weight:700;letter-spacing:.3px}
    .nav-links{display:flex;gap:22px;flex-wrap:wrap}
    .nav-links a{color:var(--ink);text-decoration:none;font-size:.98rem;font-family:system-ui,sans-serif}
    .nav-links a:hover{color:var(--p)}
    .btn{display:inline-block;padding:13px 26px;border-radius:6px;text-decoration:none;font-family:system-ui,sans-serif;font-weight:600;font-size:.95rem;border:2px solid transparent}
    .btn.ghost{background:transparent;border-width:2px}
    .hero{padding:72px 0;display:grid;gap:40px;align-items:center}
    .hero.has-media{grid-template-columns:1.1fr .9fr}
    .hero h1{font-size:clamp(2.1rem,5vw,3.6rem);line-height:1.1;margin-bottom:18px;color:var(--p)}
    .hero .sub{font-size:1.2rem;margin-bottom:28px;max-width:46ch}
    .hero-media img{border-radius:12px;box-shadow:0 20px 50px rgba(80,50,20,.18)}
    section{padding:64px 0}
    .features .feature-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:28px}
    .card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 8px 24px rgba(80,50,20,.08);padding-bottom:22px}
    .card-media{aspect-ratio:3/2;overflow:hidden}.card-media img{width:100%;height:100%;object-fit:cover}
    .card-dot{height:8px}
    .card h3{font-size:1.3rem;margin:18px 22px 8px;color:var(--p)}
    .card p{margin:0 22px;font-size:1rem;color:#5a4a3a}
    .posts h2,.features h2{font-size:2rem;margin-bottom:28px;text-align:center}
    .post-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:26px}
    .post-media{aspect-ratio:16/10;border-radius:10px;overflow:hidden;margin-bottom:12px}
    .post-media img{width:100%;height:100%;object-fit:cover}
    .post h3{font-size:1.2rem;color:var(--p);margin-bottom:6px}
    .post p{color:#5a4a3a}
    .contact{text-align:center;border-radius:0}
    .contact h2{font-size:2.2rem;margin-bottom:12px}
    .contact p{font-size:1.15rem;margin-bottom:26px;opacity:.95}
    footer{padding:40px 0;text-align:center;font-family:system-ui,sans-serif;font-size:.88rem;color:#9b8a78}
    @media(max-width:760px){.hero.has-media{grid-template-columns:1fr}.bar{height:auto;flex-direction:column;gap:12px;padding:14px 0}}
  `;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(m.brand.name)} — Preview</title>
<style>${css}</style></head>
<body>
<header><div class="wrap bar">${logoOrWordmark(m.brand, v)}${navHtml(m.nav)}</div></header>
<main class="wrap">
${heroHtml(m, v)}
${featuresHtml(m, v)}
${postsHtml(m, v)}
</main>
${contactHtml(m, v)}
<footer>${esc(m.brand.name)} · preview built by Escape From WP</footer>
</body></html>`;
}
