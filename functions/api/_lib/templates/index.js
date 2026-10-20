// Template registry — maps a template key to its renderer + display metadata.
// Add a new look by dropping a renderer in ./templates and registering it here.
import { renderWarm } from "./warm.js";
import { renderBold } from "./bold.js";
import { renderEditorial } from "./editorial.js";

export const TEMPLATES = {
  warm: { label: "Warm", blurb: "Approachable & friendly", render: renderWarm },
  bold: { label: "Bold", blurb: "Modern & high-contrast", render: renderBold },
  editorial: { label: "Editorial", blurb: "Refined & magazine-like", render: renderEditorial },
};

export const TEMPLATE_KEYS = Object.keys(TEMPLATES);

export function renderTemplate(key, model) {
  const t = TEMPLATES[key] || TEMPLATES.warm;
  return t.render(model);
}
