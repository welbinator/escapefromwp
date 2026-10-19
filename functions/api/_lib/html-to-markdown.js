// Dependency-free HTML → Markdown converter for WordPress REST content.
// Not a general-purpose converter — tuned for post/page body HTML, and it
// strips page-builder scaffolding (Etch/Elementor/Divi wrappers, data-* attrs,
// shortcodes) so the output is clean prose for an AI agent to re-model.

function decodeEntities(s) {
  if (!s) return "";
  const named = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
    "&#039;": "'", "&apos;": "'", "&nbsp;": " ", "&hellip;": "…", "&#8230;": "…",
    "&#8217;": "’", "&#8216;": "‘", "&#8220;": "“", "&#8221;": "”",
    "&#8211;": "–", "&#8212;": "—", "&mdash;": "—", "&ndash;": "–",
  };
  s = s.replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
  s = s.replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  return s.replace(/&[a-z#0-9]+;/gi, (m) => named[m] ?? m);
}

function stripShortcodes(s) {
  // Remove [shortcode ...] and [/shortcode] but keep inner text.
  return s.replace(/\[\/?[^\]]+\]/g, "");
}

// Collapse a tag's attributes we care about (href/src/alt) out of the messy rest.
function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : "";
}

export function htmlToMarkdown(html) {
  if (!html) return "";
  let s = html;

  // Images → ![alt](src), links → [text](href), with script/style/comments
  // stripped first. Built in one clean pass from the original HTML.
  s = html
    .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = attr(tag, "src") || attr(tag, "data-src");
      const alt = attr(tag, "alt");
      return src ? `\n![${alt}](${src})\n` : "";
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, a, inner) => {
      const href = attr("<a " + a + ">", "href");
      const text = inner.replace(/<[^>]+>/g, "").trim();
      return href && text ? `[${text}](${href})` : text;
    });

  // Headings.
  s = s.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_, t) => `\n\n# ${t.replace(/<[^>]+>/g, "").trim()}\n\n`);
  s = s.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_, t) => `\n\n## ${t.replace(/<[^>]+>/g, "").trim()}\n\n`);
  s = s.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_, t) => `\n\n### ${t.replace(/<[^>]+>/g, "").trim()}\n\n`);
  s = s.replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_, t) => `\n\n#### ${t.replace(/<[^>]+>/g, "").trim()}\n\n`);
  s = s.replace(/<h[56]\b[^>]*>([\s\S]*?)<\/h[56]>/gi, (_, t) => `\n\n##### ${t.replace(/<[^>]+>/g, "").trim()}\n\n`);

  // Bold / italic.
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `**${t.trim()}**`);
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, t) => `*${t.trim()}*`);

  // List items.
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_, t) => `\n- ${t.replace(/<[^>]+>/g, "").trim()}`);
  s = s.replace(/<\/(ul|ol)>/gi, "\n\n");
  s = s.replace(/<(ul|ol)\b[^>]*>/gi, "\n");

  // Blockquotes.
  s = s.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, t) => `\n\n> ${t.replace(/<[^>]+>/g, "").trim()}\n\n`);

  // Paragraphs & line breaks & block boundaries.
  s = s.replace(/<\/p>/gi, "\n\n").replace(/<p\b[^>]*>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(div|section|article|header|footer|figure|figcaption)>/gi, "\n\n");

  // Strip every remaining tag (this kills page-builder wrapper divs + data-* attrs).
  s = s.replace(/<[^>]+>/g, "");

  s = stripShortcodes(s);
  s = decodeEntities(s);

  // Whitespace cleanup: collapse 3+ newlines, trim trailing spaces per line.
  s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return s;
}

// Plain-text helper for titles/excerpts (strip tags + decode).
export function htmlToText(html) {
  if (!html) return "";
  return decodeEntities(stripShortcodes(html.replace(/<[^>]+>/g, ""))).replace(/\s+/g, " ").trim();
}
