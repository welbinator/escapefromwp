// Page renderer — ties the composer plan + block library + theme into a full
// HTML document. A "template"/"theme" is now just a token set (themes.js); the
// LAYOUT is chosen per-content by the composer. renderPage(themeKey, model)
// is the single entry the preview route + generate endpoint call.

import { themeFor } from "./themes.js";
import { composePlan } from "./composer.js";
import { baseCss, header, footer, renderBlock } from "./blocks.js";

export function renderPage(themeKey, model) {
  const t = themeFor(themeKey, model.brand || {});
  const plan = composePlan(model, model.detections || {});

  const body = plan.map((b) => renderBlock(b.type, b.data, t, model)).join("\n");

  const fontLink = t.fonts.googleHref
    ? `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="${t.fonts.googleHref}" rel="stylesheet">`
    : "";

  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(model.brand?.name || "Website preview")}</title>
<meta name="robots" content="noindex,nofollow">
${fontLink}
<style>${baseCss(t)}</style>
</head><body id="top">
${header(model, t)}
<main>${body}</main>
${footer(model, t)}
<script>
(function(){
  var r=document.documentElement;r.classList.add("js");
  var els=[].slice.call(document.querySelectorAll(".rise,.rise-stagger"));
  if(!("IntersectionObserver" in window)){els.forEach(function(e){e.classList.add("in")});return;}
  var io=new IntersectionObserver(function(en){en.forEach(function(e){if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target);}})},{rootMargin:"0px 0px -8% 0px",threshold:0.08});
  els.forEach(function(e){io.observe(e)});
  setTimeout(function(){els.forEach(function(e){e.classList.add("in")})},2500);
})();
</script>
</body></html>`;
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// Expose the composed plan too (for debugging / future AI-composer diffing).
export function planFor(themeKey, model) {
  return composePlan(model, model.detections || {});
}
