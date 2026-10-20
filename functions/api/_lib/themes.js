// Theme tokens — the visual DNA of each look, decoupled from layout. A block
// renders the SAME structure; the theme supplies fonts/colors/spacing/radius so
// the composer can place any block in any theme. Brand color overrides the
// theme accent ONLY when confidence is high (else the theme's own accent wins,
// so a preview never looks wrong).

const THEMES = {
  warm: {
    label: "Warm",
    blurb: "Approachable & friendly",
    fonts: {
      display: `"Fraunces", Georgia, "Times New Roman", serif`,
      body: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
      googleHref: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&display=swap",
    },
    color: {
      accent: "#b4532a",       // terracotta
      accentText: "#ffffff",
      ink: "#2b2422",
      sub: "#6b5f59",
      bg: "#fdfaf6",
      panel: "#f6efe7",
      line: "#e8ddd2",
      star: "#d98324",
    },
    radius: { sm: "8px", md: "14px", lg: "22px", pill: "999px" },
    space: { section: "72px", gap: "26px" },
    heroStyle: "soft",          // soft | split | overlay
    sectionLabelCase: "none",
  },
  bold: {
    label: "Bold",
    blurb: "Modern & high-contrast",
    fonts: {
      display: `"Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`,
      body: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`,
      googleHref: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&display=swap",
    },
    color: {
      accent: "#4f46e5",       // indigo
      accentText: "#ffffff",
      ink: "#0b0f19",
      sub: "#5b6472",
      bg: "#ffffff",
      panel: "#f3f4f8",
      line: "#e5e7eb",
      star: "#f59e0b",
      heroBg: "#0b0f19",        // dark hero
      heroInk: "#ffffff",
      heroSub: "#cbd5e1",
    },
    radius: { sm: "8px", md: "12px", lg: "16px", pill: "999px" },
    space: { section: "84px", gap: "24px" },
    heroStyle: "overlay",
    sectionLabelCase: "upper",
  },
  editorial: {
    label: "Editorial",
    blurb: "Refined & magazine-like",
    fonts: {
      display: `"Playfair Display", Georgia, "Times New Roman", serif`,
      body: `"Georgia", "Times New Roman", serif`,
      googleHref: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@500;600;700&display=swap",
    },
    color: {
      accent: "#8a6d3b",       // muted gold-brown
      accentText: "#ffffff",
      ink: "#1a1a1a",
      sub: "#6a6a6a",
      bg: "#faf8f5",
      panel: "#f0ece5",
      line: "#e2ddd4",
      star: "#8a6d3b",
    },
    radius: { sm: "2px", md: "3px", lg: "4px", pill: "2px" },
    space: { section: "92px", gap: "30px" },
    heroStyle: "split",
    sectionLabelCase: "upper",
  },
};

// Merge a high-confidence brand color into a theme (accent swap + readable text).
export function themeFor(key, brand) {
  const base = THEMES[key] || THEMES.warm;
  const t = JSON.parse(JSON.stringify(base));
  t.key = THEMES[key] ? key : "warm";
  if (brand && (brand.confidence === "high" || brand.color_confidence === "high") && /^#[0-9a-f]{6}$/i.test(brand.primary || "")) {
    t.color.accent = brand.primary;
    t.color.accentText = brand.text_on_primary || brand.text || readableOn(brand.primary);
  }
  return t;
}

export function readableOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const L = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return L > 0.6 ? "#111111" : "#ffffff";
}

export const THEME_KEYS = Object.keys(THEMES);
export { THEMES };
