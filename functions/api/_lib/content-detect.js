// Content-type detectors — deterministic, zero AI. Scan the extract + built
// pages/posts and emit typed content blobs the composer can turn into blocks:
//   gallery, faqs, testimonials, team, pricing, services, timeline, videos,
//   contact, logos, stats. Everything is best-effort and returns [] when unsure
// (the composer simply won't place a block it has no data for).

function textOf(md) {
  return String(md || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\(\/[^)]*\)/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\/[a-z0-9][a-z0-9\-\/]*\//gi, " ")
    .replace(/[#>*_`~\[\]!]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Reject strings that are NOT human prose: URL slugs (viking-pfaff-know-how),
// URL path fragments (/09/west-side), bare filenames, or text with fewer than
// two real words. Used to keep scraped junk out of card copy + timeline events.
export function isJunkText(s) {
  s = String(s || "").trim();
  if (!s) return true;
  // strip wrapping bullets / parens / brackets / dashes
  const core = s.replace(/^[\s\-•*·()\[\]]+/, "").replace(/[\s()\[\]]+$/, "").trim();
  if (!core) return true;
  // contains a URL path fragment (has "/" and no spaces) → junk
  if (core.includes("/") && !/\s/.test(core)) return true;
  // pure slug: lowercase/number tokens joined only by hyphens, no spaces
  if (!/\s/.test(core) && /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/i.test(core)) return true;
  // looks like a bare filename
  if (!/\s/.test(core) && /\.(jpg|jpeg|png|webp|gif|avif|svg|pdf|html?)$/i.test(core)) return true;
  // needs at least two word-ish tokens (2+ letters each) to be real prose
  const words = core.split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w));
  if (words.length < 2) return true;
  return false;
}

// Return cleaned prose, or "" if the string is junk (slug/path/wordless).
export function proseOrEmpty(s) {
  return isJunkText(s) ? "" : String(s || "").trim();
}

// Pull ALL image URLs out of a markdown body (full-size preferred).
export function imagesIn(md) {
  const out = [];
  const re = /\((https?:\/\/[^\s)]+?\.(?:jpg|jpeg|png|webp|gif|avif)[^\s)]*|\/\/[^\s)]+?\.(?:jpg|jpeg|png|webp|gif|avif)[^\s)]*)\)/gi;
  let m;
  while ((m = re.exec(md || ""))) {
    let u = m[1];
    if (/-\d+x\d+\.(jpg|jpeg|png|webp|gif|avif)/i.test(u)) u = u.replace(/-\d+x\d+(\.(jpg|jpeg|png|webp|gif|avif))/i, "$1");
    if (u.startsWith("//")) u = "https:" + u;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

// Gallery = a page/entry with many images and little prose (photo-led site).
function detectGallery(allEntries) {
  let best = null;
  for (const e of allEntries) {
    const imgs = imagesIn(e.content_md);
    if (imgs.length >= 4) {
      const prose = textOf(e.content_md).length;
      const score = imgs.length - prose / 400;
      if (!best || score > best.score) best = { score, title: e.title, images: imgs.slice(0, 12) };
    }
  }
  return best ? { title: best.title, images: best.images } : null;
}

// FAQ = Q/A patterns: headings ending in "?" followed by text, or "Q:/A:" pairs.
function detectFaqs(allEntries) {
  const faqs = [];
  for (const e of allEntries) {
    const md = e.content_md || "";
    // Heading questions: lines starting with # ... ?
    const hre = /^#{1,4}\s*(.+\?)\s*$/gm;
    let m;
    while ((m = hre.exec(md))) {
      const q = m[1].trim();
      const after = md.slice(m.index + m[0].length);
      const a = textOf(after.split(/\n#{1,4}\s/)[0]).slice(0, 320);
      if (q.length > 8 && a.length > 10) faqs.push({ q, a });
    }
    // Bold questions: **Question?** answer
    const bre = /\*\*(.+?\?)\*\*\s*([^\n*][^\n]*)/g;
    while ((m = bre.exec(md))) {
      const q = m[1].trim(), a = textOf(m[2]).slice(0, 320);
      if (q.length > 8 && a.length > 6 && !faqs.some((f) => f.q === q)) faqs.push({ q, a });
    }
  }
  return faqs.length >= 3 ? faqs.slice(0, 8) : null;
}

// Testimonials = blockquotes, or lines with "— Name" attribution / quote marks.
function detectTestimonials(allEntries) {
  const quotes = [];
  for (const e of allEntries) {
    const md = e.content_md || "";
    const bq = /^>\s*(.+)$/gm;
    let m;
    while ((m = bq.exec(md))) {
      const line = textOf(m[1]);
      if (line.length > 30 && line.length < 400) {
        const nameM = line.match(/[—–-]\s*([A-Z][a-zA-Z.'\s]{2,40})$/);
        quotes.push({ quote: nameM ? line.replace(nameM[0], "").trim() : line, who: nameM ? nameM[1].trim() : "" });
      }
    }
    // “curly-quote” testimonials
    const cq = /[“"]([^”"]{30,320})[”"]\s*[—–-]?\s*([A-Z][a-zA-Z.'\s]{2,40})?/g;
    while ((m = cq.exec(md))) {
      const q = textOf(m[1]);
      if (q.length > 30 && !quotes.some((x) => x.quote.slice(0, 40) === q.slice(0, 40)))
        quotes.push({ quote: q, who: (m[2] || "").trim() });
    }
  }
  return quotes.length >= 2 ? quotes.slice(0, 6) : null;
}

// Team = a page titled team/about/staff listing people (image + name + role-ish).
function detectTeam(allEntries) {
  const page = allEntries.find((e) => /team|our-staff|staff|people|meet/i.test(e.slug || ""));
  if (!page) return null;
  const imgs = imagesIn(page.content_md);
  // Pair images with nearby capitalized name lines (best-effort).
  const names = (textOf(page.content_md).match(/\b([A-Z][a-z]+ [A-Z][a-z]+)\b/g) || []).slice(0, 8);
  if (imgs.length >= 2 && names.length >= 2) {
    return names.slice(0, Math.min(imgs.length, names.length, 8)).map((n, i) => ({ name: n, image: imgs[i] || "", role: "" }));
  }
  return null;
}

// Pricing = $ amounts with labels, or a pricing/plans page with tiers.
function detectPricing(allEntries) {
  const page = allEntries.find((e) => /pric|plans|packages|rates|membership/i.test(e.slug || "") || /pric|plans|packages|rates/i.test(e.title || ""));
  if (!page) return null;
  const md = page.content_md || "";
  const tiers = [];
  // $NN or $NN/mo near a heading
  const re = /(?:^|\n)#{1,4}\s*(.+?)\n[\s\S]{0,200}?\$(\d{1,4})(?:\s*\/\s*(mo|month|yr|year|hr|hour))?/g;
  let m;
  while ((m = re.exec(md))) {
    tiers.push({ name: textOf(m[1]).slice(0, 40), price: "$" + m[2], period: m[3] ? "/" + m[3] : "" });
  }
  if (tiers.length >= 2) return tiers.slice(0, 4);
  // fallback: bare $ amounts
  const amounts = [...md.matchAll(/\$(\d{2,4})(?:\s*\/\s*(mo|month|yr|year))?/g)].slice(0, 4);
  if (amounts.length >= 2) return amounts.map((a, i) => ({ name: `Option ${i + 1}`, price: "$" + a[1], period: a[2] ? "/" + a[2] : "" }));
  return null;
}

// Slugs/titles that already have their OWN dedicated block — exclude from the
// generic services/features pool so they don't appear twice.
const DEDICATED = /faq|frequently|contact|get-in-touch|pricing|plans|packages|our-team|staff|privacy|terms|cart|checkout/i;

// Services = pages that look like offerings (non-utility, short, action-y titles).
function detectServices(pages, heroSlug) {
  const eligible = pages.filter((p) => p.slug !== heroSlug && !DEDICATED.test((p.slug || "") + " " + (p.title || "")));
  const svc = eligible.filter((p) => /service|what-we|offer|solution|capabilit/i.test((p.slug || "") + " " + (p.title || "")));
  const src = svc.length >= 3 ? svc : eligible.filter((p) => (p.excerpt || "").length > 20);
  // Reject cards whose excerpt is a slug/URL-path/wordless junk string.
  const clean = src.filter((p) => !isJunkText(p.excerpt || ""));
  if (clean.length < 3) return null;
  return clean.slice(0, 6).map((p) => ({ title: p.title, text: (p.excerpt || "").slice(0, 130), image: p.image || "" }));
}

// Timeline = history/about page with years (19xx/20xx) + events.
function detectTimeline(allEntries) {
  for (const e of allEntries) {
    if (!/histor|about|story|journey|since/i.test((e.slug || "") + " " + (e.title || ""))) continue;
    const md = e.content_md || "";
    const events = [];
    const re = /\b((?:19|20)\d{2})\b[\s:–-]*([^\n.]{8,120})/g;
    let m;
    while ((m = re.exec(md))) {
      const text = textOf(m[2]).slice(0, 110);
      if (!isJunkText(text)) events.push({ year: m[1], text });
    }
    if (events.length >= 3) return events.slice(0, 6);
  }
  return null;
}

// Videos = youtube/vimeo embeds or links in any body.
function detectVideos(allEntries) {
  const vids = [];
  for (const e of allEntries) {
    const md = e.content_md || "";
    const re = /(?:youtube\.com\/watch\?v=|youtu\.be\/|player\.vimeo\.com\/video\/|vimeo\.com\/)([\w-]{6,})/gi;
    let m;
    while ((m = re.exec(md))) {
      const id = m[1];
      const isVimeo = /vimeo/i.test(m[0]);
      const embed = isVimeo ? `https://player.vimeo.com/video/${id}` : `https://www.youtube.com/embed/${id}`;
      if (!vids.some((v) => v.embed === embed)) vids.push({ embed, title: e.title });
    }
  }
  return vids.length ? vids.slice(0, 3) : null;
}

// Contact = address / phone / email pulled from a contact-ish page or any body.
function detectContact(allEntries) {
  const blob = allEntries.map((e) => textOf(e.content_md)).join("\n");
  // Phone: require a real phone shape (parens, dots, or +, or 10 grouped digits),
  // NOT a bare year-range like "1927-1952".
  let phone = "";
  const pcands = blob.match(/(\+?\d{1,2}[\s.-]?)?(\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g) || [];
  if (pcands.length) phone = pcands[0].trim();
  const email = (blob.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || [])[0] || "";
  const addr = (blob.match(/\d{1,5}\s+[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way|Ct|Court)\b[^\n,]*(?:,\s*[A-Z][a-zA-Z]+)?(?:,?\s*[A-Z]{2}\s*\d{5})?/) || [])[0] || "";
  if (phone || email || addr) return { phone, email, address: addr.trim() };
  return null;
}

// Main entry — returns a detections object keyed by block type.
export function detectContent({ allEntries, pages, heroSlug }) {
  return {
    gallery: detectGallery(allEntries),
    faqs: detectFaqs(allEntries),
    testimonials: detectTestimonials(allEntries),
    team: detectTeam(allEntries),
    pricing: detectPricing(allEntries),
    services: detectServices(pages, heroSlug),
    timeline: detectTimeline(allEntries),
    videos: detectVideos(allEntries),
    contact: detectContact(allEntries),
  };
}
