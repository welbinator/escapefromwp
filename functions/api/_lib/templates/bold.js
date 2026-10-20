// Template: "bold" — high-contrast modern/startup look (dark hero, big sans
// type, sharp cards, confident accent). Same site-model contract as warm.js.
// EmDash-twin section structure: Hero / FeatureGrid / PostList / ContactCTA.

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// Bold leans on a strong accent; when brand color is low-confidence use the
// template's own electric palette rather than a muddy guessed color.
const PALETTE = { primary: "#4f46e5", secondary: "#06b6d4", ink: "#0b0f19", text: "#ffffff" };

function brandVars(brand) {
  const useBrand = brand.color_confidence === "high";
  return {
    primary: useBrand ? brand.primary : PALETTE.primary,
    secondary: useBrand ? brand.secondary : PALETTE.secondary,
    onPrimary: useBrand ? brand.text_on_primary : PALETTE.text,
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

export function renderBold(model) {
  const m = model;
  const v = brandVars(m.brand);
  const hero = `
  <section class="hero ${m.hero.image ? "has-media" : ""}">
    <div class="hero-inner wrap">
      <div class="hero-copy">
        <span class="eyebrow" style="color:${v.secondary}">${esc(m.brand.name)}</span>
        <h1>${esc(m.hero.headline)}</h1>
        <p class="sub">${esc(m.hero.subheadline)}</p>
        <a class="btn" href="#contact" style="background:${v.primary};color:${v.onPrimary}">${esc(m.hero.cta)} →</a>
      </div>
      ${m.hero.image ? `<div class="hero-media"><img src="${esc(m.hero.image)}" alt="${esc(m.brand.name)}"/></div>` : ""}
    </div>
  </section>`;

  const features = m.features?.length ? `
  <section class="features wrap" id="about">
    <div class="grid">
      ${m.features.map((f, i) => `
        <article class="card">
          <span class="num" style="color:${v.primary}">0${i + 1}</span>
          ${f.image ? `<div class="card-media"><img src="${esc(f.image)}" alt="${esc(f.title)}"/></div>` : ""}
          <h3>${esc(f.title)}</h3>
          ${f.text ? `<p>${esc(f.text)}</p>` : ""}
        </article>`).join("")}
    </div>
  </section>` : "";

  const posts = m.posts?.length ? `
  <section class="posts wrap" id="news">
    <h2>Latest</h2>
    <div class="post-grid">
      ${m.posts.slice(0, 6).map((p) => `
        <article class="post">
          ${p.image ? `<div class="post-media"><img src="${esc(p.image)}" alt="${esc(p.title)}"/></div>` : ""}
          <h3>${esc(p.title)}</h3>
          ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ""}
        </article>`).join("")}
    </div>
  </section>` : "";

  const contact = `
  <section class="contact" id="contact">
    <div class="wrap contact-inner" style="background:linear-gradient(135deg, ${v.primary}, ${v.secondary})">
      <h2>Let’s build something</h2>
      <p>Ready to bring ${esc(m.brand.name)} online, done right?</p>
      <a class="btn light" href="#contact">${esc(m.hero.cta)} →</a>
    </div>
  </section>`;

  const css = `
    :root{--p:${v.primary};--s:${v.secondary};--ink:${PALETTE.ink}}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Inter',system-ui,-apple-system,sans-serif;color:var(--ink);background:#fff;line-height:1.6;-webkit-font-smoothing:antialiased}
    img{max-width:100%;display:block;height:auto}
    .wrap{max-width:1160px;margin:0 auto;padding:0 24px}
    header{position:sticky;top:0;z-index:20;background:rgba(11,15,25,.9);backdrop-filter:blur(10px)}
    .bar{display:flex;align-items:center;justify-content:space-between;height:70px;max-width:1160px;margin:0 auto;padding:0 24px}
    .logo{max-height:34px;width:auto;background:#fff;padding:5px 9px;border-radius:7px}
    .wordmark{color:#fff;font-weight:800;font-size:1.3rem;letter-spacing:-.02em}
    .nav-links{display:flex;gap:26px;flex-wrap:wrap}
    .nav-links a{color:#cbd5e1;text-decoration:none;font-size:.94rem;font-weight:500}
    .nav-links a:hover{color:#fff}
    .btn{display:inline-block;padding:14px 30px;border-radius:999px;text-decoration:none;font-weight:700;font-size:.95rem}
    .btn.light{background:#fff;color:var(--ink)}
    .hero{background:var(--ink);color:#fff;padding:0}
    .hero-inner{display:grid;gap:48px;align-items:center;padding:88px 24px}
    .hero.has-media .hero-inner{grid-template-columns:1.05fr .95fr}
    .eyebrow{font-weight:700;text-transform:uppercase;letter-spacing:.14em;font-size:.8rem}
    .hero h1{font-size:clamp(2.4rem,6vw,4.4rem);line-height:1.03;letter-spacing:-.03em;margin:14px 0 20px;font-weight:800}
    .hero .sub{font-size:1.25rem;color:#cbd5e1;max-width:48ch;margin-bottom:32px}
    .hero-media img{border-radius:16px;box-shadow:0 30px 70px rgba(0,0,0,.5)}
    section{padding:80px 0}
    .features .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:30px}
    .card{border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;padding:0 0 24px;transition:transform .15s,box-shadow .15s}
    .card:hover{transform:translateY(-4px);box-shadow:0 18px 40px rgba(15,23,42,.1)}
    .card .num{display:block;font-weight:800;font-size:1rem;padding:22px 24px 0}
    .card-media{aspect-ratio:3/2;overflow:hidden;margin-top:14px}.card-media img{width:100%;height:100%;object-fit:cover}
    .card h3{font-size:1.35rem;font-weight:700;margin:18px 24px 8px;letter-spacing:-.01em}
    .card p{margin:0 24px;color:#475569}
    .posts h2,.features h2{font-size:2.2rem;font-weight:800;letter-spacing:-.02em;margin-bottom:34px}
    .post-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:30px}
    .post-media{aspect-ratio:16/10;border-radius:12px;overflow:hidden;margin-bottom:14px}
    .post-media img{width:100%;height:100%;object-fit:cover}
    .post h3{font-size:1.25rem;font-weight:700;margin-bottom:6px}
    .post p{color:#475569}
    .contact{padding:40px 0 90px}
    .contact-inner{border-radius:24px;padding:72px 32px;text-align:center;color:#fff}
    .contact h2{font-size:2.6rem;font-weight:800;letter-spacing:-.02em;margin-bottom:12px}
    .contact p{font-size:1.2rem;margin-bottom:30px;opacity:.95}
    footer{padding:40px 0;text-align:center;font-size:.86rem;color:#94a3b8}
    @media(max-width:760px){.hero.has-media .hero-inner{grid-template-columns:1fr}.bar{height:auto;flex-direction:column;gap:12px;padding:14px 24px}}
  `;
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>${esc(m.brand.name)} — Preview</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;800&display=swap" rel="stylesheet">
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
