// Template/theme registry — now a thin adapter over the component system.
// A "template" = a visual THEME (themes.js); the LAYOUT is composed per-content
// by the composer. Public API is unchanged so routes/endpoints keep working:
//   TEMPLATES, TEMPLATE_KEYS, renderTemplate(key, model)

import { renderPage } from "../page-render.js";
import { THEMES, THEME_KEYS } from "../themes.js";

export const TEMPLATES = Object.fromEntries(
  THEME_KEYS.map((k) => [k, { key: k, label: THEMES[k].label, blurb: THEMES[k].blurb }])
);
export const TEMPLATE_KEYS = THEME_KEYS;

export function renderTemplate(key, model) {
  const k = TEMPLATE_KEYS.includes(key) ? key : TEMPLATE_KEYS[0];
  return renderPage(k, model);
}
