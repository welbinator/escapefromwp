// Component library — every block is a pure render fn (data, theme) -> HTML.
// Blocks are theme-agnostic: all color/font/spacing comes from theme tokens so
// the composer can place any block under any theme. Shared base CSS is emitted
// once by baseCss(theme). Zero AI, zero runtime deps (Workers have no npm).

export function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function img(src, alt, cls) {
  if (!src) return "";
  return `<img src="${esc(src)}" alt="${esc(alt || "")}" class="${cls || ""}" loading="lazy" referrerpolicy="no-referrer">`;
}
function label(theme, text) {
  const tf = theme.sectionLabelCase === "upper" ? "text-transform:uppercase;letter-spacing:.14em;" : "";
  return `<div class="sec-label" style="${tf}color:${theme.color.accent}">${esc(text)}</div>`;
}
function ctaBtn(theme, text, href) {
  return `<a class="btn" href="${esc(href || "#contact")}" style="background:${theme.color.accent};color:${theme.color.accentText};border-radius:${theme.radius.pill}">${esc(text || "Get in touch")}</a>`;
}

// ---- base CSS (once per page) -------------------------------------------------
export function baseCss(t) {
  return `
  *{box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{margin:0;font-family:${t.fonts.body};color:${t.color.ink};background:${t.color.bg};line-height:1.6}
  img{max-width:100%;display:block}
  a{color:inherit}
  h1,h2,h3{font-family:${t.fonts.display};line-height:1.12;margin:0 0 .4em;font-weight:700}
  h2{font-size:clamp(1.6rem,3.4vw,2.4rem)}
  h3{font-size:1.2rem}
  p{margin:0 0 1em}
  .wrap{max-width:1140px;margin:0 auto;padding:0 24px}
  section{padding:${t.space.section} 0}
  .sec-label{font-size:.8rem;font-weight:700;margin-bottom:10px}
  .btn{display:inline-block;padding:13px 26px;font-weight:700;text-decoration:none;font-size:.98rem;border:0;cursor:pointer}
  header.site{position:sticky;top:0;z-index:50;background:${hexA(t.color.bg, .92)};backdrop-filter:blur(8px);border-bottom:1px solid ${t.color.line}}
  .bar{display:flex;align-items:center;justify-content:space-between;height:70px}
  .logo{max-height:38px;width:auto}
  .wordmark{font-family:${t.fonts.display};font-weight:700;font-size:1.25rem;color:${t.color.ink};text-decoration:none}
  nav.links{display:flex;gap:22px;flex-wrap:wrap}
  nav.links a{color:${t.color.sub};text-decoration:none;font-size:.93rem;font-weight:600}
  nav.links a:hover{color:${t.color.accent}}
  .grid{display:grid;gap:${t.space.gap}}
  .muted{color:${t.color.sub}}
  .card{background:${t.color.bg};border:1px solid ${t.color.line};border-radius:${t.radius.md};overflow:hidden}
  .card .pad{padding:20px}
  .card img{aspect-ratio:16/10;object-fit:cover;width:100%}
  footer.site{background:${t.color.panel};padding:28px 0;color:${t.color.sub};font-size:.85rem;text-align:center;border-top:1px solid ${t.color.line}}
  @media(max-width:720px){nav.links{display:none}section{padding:52px 0}}
  /* ---- motion: tasteful, fail-open (content visible if JS off) ---- */
  .btn{transition:transform .18s ease, box-shadow .18s ease}
  .btn:hover{transform:translateY(-2px);box-shadow:0 8px 20px ${hexA(t.color.accent, .28)}}
  .card{transition:transform .2s ease, box-shadow .2s ease}
  .card:hover{transform:translateY(-3px);box-shadow:0 12px 30px rgba(0,0,0,.08)}
  .rise{transition:opacity .6s ease, transform .6s ease}
  html.js .rise{opacity:0;transform:translateY(20px)}
  html.js .rise.in{opacity:1;transform:none}
  html.js .rise-stagger > *{transition:opacity .55s ease, transform .55s ease}
  html.js .rise-stagger.in > *{opacity:1;transform:none}
  html.js .rise-stagger:not(.in) > *{opacity:0;transform:translateY(16px)}
  html.js .rise-stagger.in > *:nth-child(1){transition-delay:0s}
  html.js .rise-stagger.in > *:nth-child(2){transition-delay:.07s}
  html.js .rise-stagger.in > *:nth-child(3){transition-delay:.14s}
  html.js .rise-stagger.in > *:nth-child(4){transition-delay:.21s}
  html.js .rise-stagger.in > *:nth-child(5){transition-delay:.28s}
  html.js .rise-stagger.in > *:nth-child(n+6){transition-delay:.35s}
  @keyframes efwHeroText{from{opacity:0;transform:translateY(22px)}to{opacity:1;transform:none}}
  html.js .hero-anim h1{animation:efwHeroText .7s ease .05s both}
  html.js .hero-anim .hero-sub{animation:efwHeroText .7s ease .18s both}
  html.js .hero-anim .hero-cta{animation:efwHeroText .7s ease .30s both}
  html.js .hero-media img{animation:efwKen 16s ease-out both}
  @keyframes efwKen{from{transform:scale(1.08)}to{transform:scale(1)}}
  @media(prefers-reduced-motion:reduce){
    html.js .rise,html.js .rise-stagger>*,.rise{opacity:1!important;transform:none!important;transition:none!important}
    html.js .hero-anim h1,html.js .hero-anim .hero-sub,html.js .hero-anim .hero-cta,html.js .hero-media img{animation:none!important}
    .btn:hover,.card:hover{transform:none!important}
  }
  `;
}
function hexA(hex, a) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---- header + footer ----------------------------------------------------------
export function header(m, t) {
  const brand = m.brand.logo_url
    ? img(m.brand.logo_url, m.brand.name, "logo")
    : `<a class="wordmark" href="#top">${esc(m.brand.name)}</a>`;
  const links = (m.nav || []).map((n) => `<a href="${esc(n.href)}">${esc(n.label)}</a>`).join("");
  return `<header class="site"><div class="wrap bar">${brand}<nav class="links">${links}</nav>${ctaBtn(t, m.hero.cta, "#contact")}</div></header>`;
}
export function footer(m, t) {
  return `<footer class="site"><div class="wrap">${esc(m.brand.name)} · preview built by <a href="https://escapefromwp.com" style="color:${t.color.accent}">Escape From WP</a></div></footer>`;
}

// ---- BLOCKS -------------------------------------------------------------------
const BLOCKS = {
  hero(d, t, m) {
    const h = m.hero;
    const copy = `<div class="hero-copy">${label(t, m.brand.name)}<h1>${esc(h.headline)}</h1><p class="hero-sub muted" style="font-size:1.15rem;max-width:42ch">${esc(h.subheadline)}</p><div class="hero-cta">${ctaBtn(t, h.cta, "#contact")}</div></div>`;
    if (t.heroStyle === "overlay") {
      return `<section class="blk-hero overlay hero-anim" style="background:${t.color.heroBg || "#0b0f19"}">
        <div class="wrap" style="display:grid;grid-template-columns:1.1fr .9fr;gap:40px;align-items:center;color:${t.color.heroInk || "#fff"}">
          <div><div class="sec-label" style="color:${t.color.accent}">${esc(m.brand.name)}</div>
            <h1 style="color:${t.color.heroInk || "#fff"};font-size:clamp(2.1rem,5vw,3.4rem)">${esc(h.headline)}</h1>
            <p class="hero-sub" style="color:${t.color.heroSub || "#cbd5e1"};font-size:1.15rem;max-width:42ch">${esc(h.subheadline)}</p>
            <div class="hero-cta">${ctaBtn(t, h.cta, "#contact")}</div></div>
          ${h.image ? `<div class="hero-media" style="border-radius:${t.radius.lg};overflow:hidden">${img(h.image, h.headline)}</div>` : ""}
        </div></section>`;
    }
    if (t.heroStyle === "split") {
      return `<section class="blk-hero split hero-anim"><div class="wrap" style="display:grid;grid-template-columns:${h.image ? "1fr 1fr" : "1fr"};gap:48px;align-items:center">
        ${h.image ? `<div class="hero-media" style="border-radius:${t.radius.lg};overflow:hidden">${img(h.image, h.headline)}</div>` : ""}${copy}</div></section>`;
    }
    // soft
    return `<section class="blk-hero soft hero-anim" style="background:${t.color.panel}"><div class="wrap" style="display:grid;grid-template-columns:${h.image ? "1fr 1fr" : "1fr"};gap:44px;align-items:center">
      ${copy}${h.image ? `<div class="hero-media" style="border-radius:${t.radius.lg};overflow:hidden">${img(h.image, h.headline)}</div>` : ""}</div></section>`;
  },

  services(d, t) {
    const cards = d.map((s) => `<div class="card">${s.image ? img(s.image, s.title) : ""}<div class="pad"><h3>${esc(s.title)}</h3><p class="muted" style="font-size:.95rem">${esc(s.text)}</p></div></div>`).join("");
    return `<section class="blk-services"><div class="wrap"><div style="text-align:center;margin-bottom:34px">${label(t, "What we do")}<h2>Our services</h2></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${cards}</div></div></section>`;
  },

  cardGrid(d, t) {
    const cards = d.map((c, i) => `<div class="card"><div class="pad"><div style="font-family:${t.fonts.display};color:${t.color.accent};font-weight:700">${String(i + 1).padStart(2, "0")}</div><h3>${esc(c.title)}</h3><p class="muted" style="font-size:.95rem">${esc(c.text)}</p></div></div>`).join("");
    return `<section class="blk-cards" style="background:${t.color.panel}"><div class="wrap"><div style="margin-bottom:30px">${label(t, "Highlights")}<h2>What we're about</h2></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">${cards}</div></div></section>`;
  },

  gallery(d, t) {
    const imgs = d.images.map((u) => `<div style="border-radius:${t.radius.sm};overflow:hidden;aspect-ratio:1/1">${img(u, d.title)}</div>`).join("");
    return `<section class="blk-gallery"><div class="wrap"><div style="margin-bottom:26px">${label(t, "Gallery")}<h2>${esc(d.title || "A look at our work")}</h2></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${imgs}</div></div></section>`;
  },

  carousel(d, t) {
    // CSS scroll-snap carousel (no JS dep).
    const slides = d.images.map((u) => `<div class="slide" style="flex:0 0 72%;scroll-snap-align:center;border-radius:${t.radius.md};overflow:hidden">${img(u, d.title)}</div>`).join("");
    return `<section class="blk-carousel" style="background:${t.color.panel}"><div class="wrap"><div style="margin-bottom:22px">${label(t, "Showcase")}<h2>${esc(d.title || "See it in action")}</h2></div></div>
      <div style="display:flex;gap:18px;overflow-x:auto;scroll-snap-type:x mandatory;padding:4px 24px;max-width:1140px;margin:0 auto">${slides}</div></section>`;
  },

  featureSplit(d, t) {
    // alternating image/text rows
    const rows = d.map((f, i) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;align-items:center;margin-bottom:46px">
      ${f.image ? `<div style="order:${i % 2 ? 2 : 1};border-radius:${t.radius.md};overflow:hidden">${img(f.image, f.title)}</div>` : ""}
      <div style="order:${i % 2 ? 1 : 2}"><h3 style="font-size:1.5rem">${esc(f.title)}</h3><p class="muted">${esc(f.text)}</p></div></div>`).join("");
    return `<section class="blk-split"><div class="wrap">${rows}</div></section>`;
  },

  testimonials(d, t) {
    const items = d.map((q) => `<figure class="card" style="margin:0"><div class="pad"><div style="color:${t.color.star};font-size:1.1rem">★★★★★</div>
      <blockquote style="margin:10px 0 0;font-family:${t.fonts.display};font-size:1.1rem">“${esc(q.quote)}”</blockquote>
      ${q.who ? `<figcaption class="muted" style="margin-top:10px;font-weight:600">${esc(q.who)}</figcaption>` : ""}</div></figure>`).join("");
    return `<section class="blk-testimonials" style="background:${t.color.panel}"><div class="wrap"><div style="text-align:center;margin-bottom:30px">${label(t, "Testimonials")}<h2>What people say</h2></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">${items}</div></div></section>`;
  },

  team(d, t) {
    const members = d.map((p) => `<div style="text-align:center">${p.image ? `<div style="border-radius:${t.radius.pill === "999px" ? "50%" : t.radius.md};overflow:hidden;aspect-ratio:1/1;max-width:180px;margin:0 auto 12px">${img(p.image, p.name)}</div>` : ""}
      <div style="font-weight:700">${esc(p.name)}</div>${p.role ? `<div class="muted" style="font-size:.9rem">${esc(p.role)}</div>` : ""}</div>`).join("");
    return `<section class="blk-team"><div class="wrap"><div style="text-align:center;margin-bottom:34px">${label(t, "Our team")}<h2>Meet the people</h2></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">${members}</div></div></section>`;
  },

  pricing(d, t) {
    const cols = d.map((p, i) => `<div class="card" style="text-align:center;${i === 1 ? `border-color:${t.color.accent};border-width:2px` : ""}"><div class="pad">
      <h3>${esc(p.name)}</h3><div style="font-family:${t.fonts.display};font-size:2.4rem;color:${t.color.accent};font-weight:700">${esc(p.price)}<span style="font-size:1rem;color:${t.color.sub}">${esc(p.period || "")}</span></div>
      ${ctaBtn(t, "Choose", "#contact")}</div></div>`).join("");
    return `<section class="blk-pricing" style="background:${t.color.panel}"><div class="wrap"><div style="text-align:center;margin-bottom:34px">${label(t, "Pricing")}<h2>Simple, honest pricing</h2></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));max-width:860px;margin:0 auto">${cols}</div></div></section>`;
  },

  timeline(d, t) {
    const items = d.map((e) => `<div style="display:grid;grid-template-columns:90px 1fr;gap:18px;padding:14px 0;border-bottom:1px solid ${t.color.line}">
      <div style="font-family:${t.fonts.display};font-weight:700;color:${t.color.accent};font-size:1.3rem">${esc(e.year)}</div>
      <div class="muted">${esc(e.text)}</div></div>`).join("");
    return `<section class="blk-timeline"><div class="wrap" style="max-width:760px"><div style="margin-bottom:22px">${label(t, "Our story")}<h2>How we got here</h2></div>${items}</div></section>`;
  },

  faqs(d, t) {
    const items = d.map((f) => `<details style="border-bottom:1px solid ${t.color.line};padding:16px 0"><summary style="cursor:pointer;font-weight:700;font-family:${t.fonts.display};font-size:1.08rem;list-style:none">${esc(f.q)}</summary>
      <p class="muted" style="margin:10px 0 0">${esc(f.a)}</p></details>`).join("");
    return `<section class="blk-faqs" style="background:${t.color.panel}"><div class="wrap" style="max-width:780px"><div style="margin-bottom:20px">${label(t, "FAQ")}<h2>Common questions</h2></div>${items}</div></section>`;
  },

  video(d, t) {
    const v = d[0];
    return `<section class="blk-video"><div class="wrap" style="max-width:900px"><div style="text-align:center;margin-bottom:22px">${label(t, "Watch")}<h2>${esc(v.title || "See more")}</h2></div>
      <div style="position:relative;padding-bottom:56.25%;height:0;border-radius:${t.radius.md};overflow:hidden">
        <iframe src="${esc(v.embed)}" style="position:absolute;inset:0;width:100%;height:100%;border:0" allowfullscreen loading="lazy"></iframe></div></div></section>`;
  },

  postList(d, t) {
    const cards = d.slice(0, 6).map((p) => `<article class="card">${p.image ? img(p.image, p.title) : ""}<div class="pad"><h3 style="font-size:1.1rem">${esc(p.title)}</h3><p class="muted" style="font-size:.92rem">${esc(p.excerpt)}</p></div></article>`).join("");
    return `<section class="blk-posts"><div class="wrap"><div style="margin-bottom:28px">${label(t, "Latest")}<h2>From the blog</h2></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${cards}</div></div></section>`;
  },

  statBand(d, t) {
    const stats = d.map((s) => `<div style="text-align:center"><div style="font-family:${t.fonts.display};font-size:2.6rem;font-weight:700;color:${t.color.accent}">${esc(s.value)}</div><div class="muted">${esc(s.label)}</div></div>`).join("");
    return `<section class="blk-stats" style="background:${t.color.panel}"><div class="wrap"><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">${stats}</div></div></section>`;
  },

  contact(d, t, m) {
    const rows = [];
    if (d.phone) rows.push(`<div><div class="sec-label" style="color:${t.color.accent}">Phone</div>${esc(d.phone)}</div>`);
    if (d.email) rows.push(`<div><div class="sec-label" style="color:${t.color.accent}">Email</div>${esc(d.email)}</div>`);
    if (d.address) rows.push(`<div><div class="sec-label" style="color:${t.color.accent}">Visit</div>${esc(d.address)}</div>`);
    const mapEmbed = d.address ? `<iframe title="map" style="width:100%;height:260px;border:0;border-radius:${t.radius.md}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://www.google.com/maps?q=${encodeURIComponent(d.address)}&output=embed"></iframe>` : "";
    return `<section class="blk-contact" id="contact"><div class="wrap" style="display:grid;grid-template-columns:${mapEmbed ? "1fr 1fr" : "1fr"};gap:40px;align-items:center">
      <div>${label(t, "Get in touch")}<h2>Let's talk</h2><div class="grid" style="gap:16px;margin-top:16px">${rows.join("") || `<p class="muted">Ready to get started with ${esc(m.brand.name)}? Reach out and we'll be in touch.</p>`}</div></div>
      ${mapEmbed}</div></section>`;
  },

  ctaBand(d, t, m) {
    return `<section class="blk-cta" style="background:${t.color.accent}"><div class="wrap" style="text-align:center;color:${t.color.accentText}">
      <h2 style="color:${t.color.accentText}">${esc(d?.headline || "Ready to get started?")}</h2>
      <p style="color:${t.color.accentText};opacity:.9;max-width:46ch;margin:0 auto 22px">${esc(d?.sub || `Let's bring ${m.brand.name} to life, done right.`)}</p>
      <a class="btn" href="#contact" style="background:${t.color.bg};color:${t.color.ink};border-radius:${t.radius.pill}">${esc(m.hero.cta || "Get in touch")}</a></div></section>`;
  },
};

export function renderBlock(type, data, theme, model) {
  const fn = BLOCKS[type];
  if (!fn) return "";
  let html;
  try { html = fn(data, theme, model); } catch (_) { return ""; }
  if (!html || type === "hero") return html || "";
  // Reveal-on-scroll: fade the section up as it enters. For card grids, turn the
  // first .grid into a staggered reveal container (its children cascade in).
  html = html.replace(/^(\s*<section\b[^>]*\bclass=")/, "$1rise ");
  html = html.replace(/class="grid"/, 'class="grid rise-stagger"');
  return html;
}
export const BLOCK_TYPES = Object.keys(BLOCKS);
