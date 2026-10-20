// Template: "editorial" — refined magazine look (big serif headlines, airy
// whitespace, thin rules, understated accent). Same site-model contract.
// EmDash-twin section structure: Hero / FeatureGrid / PostList / ContactCTA.

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Understated — accent is used sparingly (rules, links). Low-confidence brand
// color falls back to a near-black ink so it always reads as intentional.
const PALETTE = { primary: "#1a1a1a", accent: "#a6755a", paper: "#fcfbf9", ink: "#1a1a1a", text: "#ffffff" };

function brandVars(brand) {
  const useBrand = brand.color_confidence === "high";
  return {
    accent: useBrand ? brand.primary : PALETTE.accent,
    onAccent: useBrand ? brand.text_on_primary : PALETTE.text,
  };
}

function logoOrWordmark(brand) {
  if (brand.logo_url) return `<img class="logo" src="${esc(brand.logo_url)}" alt="${esc(brand.name)}"/>`;
  return `<span class="wordmark">${esc(brand.name)}</span>`;
}

function navHtml(nav) {
  if (!nav?.length) return "";
  return `<nav class="nav-links">${nav.map((n) =>
    `<a href="${esc(n.href)}"${n.external ? ' rel="nofollow noopener"' : ""}>${esc(n.label)}</a>`).join("")}</nav>`;
}

export function renderEditorial(model) {
  const m = model;
  const v = brandVars(m.brand);

  const hero = `
  <section class="hero ${m.hero.image ? "has-media" : ""}">
    ${m.hero.image ? `<figure class="hero-media"><img src="${esc(m.hero.image)}" alt="${esc(m.brand.name)}"/></figure>` : ""}
    <div class="hero-copy">
      <span class="kicker" style="color:${v.accent}">${esc(m.brand.name)}</span>
      <h1>${esc(m.hero.headline)}</h1>
      <p class="sub">${esc(m.hero.subheadline)}</p>
      <a class="link-cta" href="#contact" style="color:${v.accent};border-color:${v.accent}">${esc(m.hero.cta)}</a>
    </div>
  </section>`;

  const features = m.features?.length ? `
  <section class="features" id="about">
    <div class="feat-list">
      ${m.features.map((f, i) => `
        <article class="feat ${i % 2 ? "rev" : ""}">
          ${f.image ? `<figure class="feat-media"><img src="${esc(f.image)}" alt="${esc(f.title)}"/></figure>` : `<div class="feat-media placeholder"></div>`}
          <div class="feat-copy">
            <span class="idx" style="color:${v.accent}">${String(i + 1).padStart(2, "0")}</span>
            <h3>${esc(f.title)}</h3>
            ${f.text ? `<p>${esc(f.text)}</p>` : ""}
          </div>
        </article>`).join("")}
    </div>
  </section>` : "";

  const posts = m.posts?.length ? `
  <section class="posts" id="news">
    <div class="rule"></div>
    <h2>Journal</h2>
    <div class="post-grid">
      ${m.posts.slice(0, 6).map((p) => `
        <article class="post">
          ${p.image ? `<figure class="post-media"><img src="${esc(p.image)}" alt="${esc(p.title)}"/></figure>` : ""}
          <h3>${esc(p.title)}</h3>
          ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ""}
        </article>`).join("")}
    </div>
  </section>` : "";

  const contact = `
  <section class="contact" id="contact">
    <div class="rule"></div>
    <h2>Begin a conversation</h2>
    <p>Ready to bring ${esc(m.brand.name)} online, with the care it deserves?</p>
    <a class="btn" href="#contact" style="background:${v.accent};color:${v.onAccent}">${esc(m.hero.cta)}</a>
  </section>`;

  const css = `
    :root{--a:${v.accent};--ink:${PALETTE.ink};--paper:${PALETTE.paper}}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Georgia,'Iowan Old Style','Palatino',serif;color:var(--ink);background:var(--paper);line-height:1.7}
    img{max-width:100%;display:block;height:auto}
    .wrap,section{max-width:1080px;margin:0 auto;padding-left:28px;padding-right:28px}
    header{border-bottom:1px solid #e7e2da}
    .bar{display:flex;align-items:baseline;justify-content:space-between;gap:20px;max-width:1080px;margin:0 auto;padding:26px 28px}
    .logo{max-height:40px;width:auto}
    .wordmark{font-size:1.5rem;letter-spacing:.02em;font-weight:700}
    .nav-links{display:flex;gap:26px;flex-wrap:wrap}
    .nav-links a{color:var(--ink);text-decoration:none;font-family:system-ui,sans-serif;font-size:.82rem;text-transform:uppercase;letter-spacing:.1em}
    .nav-links a:hover{color:var(--a)}
    .kicker,.idx,.kicker{font-family:system-ui,sans-serif;text-transform:uppercase;letter-spacing:.18em;font-size:.76rem;font-weight:600}
    section{padding-top:84px;padding-bottom:84px}
    .hero{display:grid;gap:48px;align-items:center}
    .hero.has-media{grid-template-columns:1fr 1fr}
    .hero h1{font-size:clamp(2.4rem,5.5vw,4rem);line-height:1.08;margin:16px 0 22px;font-weight:400}
    .hero .sub{font-size:1.3rem;color:#4a443c;max-width:44ch;margin-bottom:28px;font-style:italic}
    .hero-media img{width:100%;aspect-ratio:4/5;object-fit:cover}
    .link-cta{font-family:system-ui,sans-serif;font-size:.9rem;text-decoration:none;border-bottom:2px solid;padding-bottom:3px;letter-spacing:.02em}
    .feat-list{display:flex;flex-direction:column;gap:72px}
    .feat{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center}
    .feat.rev .feat-media{order:2}
    .feat-media img{width:100%;aspect-ratio:4/3;object-fit:cover}
    .feat-media.placeholder{aspect-ratio:4/3;background:#efe9e0}
    .feat-copy h3{font-size:1.9rem;font-weight:400;margin:10px 0 12px;line-height:1.15}
    .feat-copy p{font-size:1.1rem;color:#4a443c}
    .rule{height:1px;background:#ddd6cc;margin-bottom:40px}
    .posts h2,.contact h2{font-size:2.1rem;font-weight:400;margin-bottom:34px}
    .post-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:40px}
    .post-media img{width:100%;aspect-ratio:3/2;object-fit:cover;margin-bottom:14px}
    .post h3{font-size:1.35rem;font-weight:400;margin-bottom:6px}
    .post p{color:#4a443c}
    .contact{text-align:center}
    .contact p{font-size:1.25rem;color:#4a443c;max-width:50ch;margin:0 auto 28px;font-style:italic}
    .btn{display:inline-block;padding:14px 34px;text-decoration:none;font-family:system-ui,sans-serif;font-weight:600;font-size:.92rem;letter-spacing:.03em}
    footer{border-top:1px solid #e7e2da;padding:34px 0;text-align:center;font-family:system-ui,sans-serif;font-size:.82rem;color:#9a9388}
    @media(max-width:760px){.hero.has-media,.feat{grid-template-columns:1fr}.feat.rev .feat-media{order:0}.bar{flex-direction:column;gap:14px;align-items:flex-start}}
  `;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(m.brand.name)} — Preview</title>
<style>${css}</style></head>
<body>
<header><div class="bar">${logoOrWordmark(m.brand)}${navHtml(m.nav)}</div></header>
${hero}
${features}
${posts}
${contact}
<footer>${esc(m.brand.name)} · preview built by Escape From WP</footer>
</body></html>`;
}
