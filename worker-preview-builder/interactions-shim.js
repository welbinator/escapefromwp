// interactions-shim.js
// ---------------------------------------------------------------------------
// Replica mode strips every <script> from the captured page (to avoid dragging
// along WordPress/theme JS, analytics, and trackers that assume a live backend).
// That kills pure-JS interactions — most visibly the mobile hamburger menu,
// dropdown/flyout submenus, and FAQ-style accordions.
//
// Rather than resurrecting the origin's JS, we inject ONE small dependency-free
// script that re-wires the STANDARD interaction patterns by reading the markup
// that's already in the snapshot (which we kept intact). It keys off universal
// accessibility conventions (aria-controls / aria-expanded / aria-haspopup) and
// common class names (menu-toggle, hamburger, nav-toggle, accordion, faq...).
//
// Design rules:
//   - Toggle aria-expanded + an is-open/open/active class. The theme's own CSS
//     almost always styles one of those states (we kept all their CSS), so the
//     visual result matches the original.
//   - A tiny backstop <style> covers the rare case where the "open" styling only
//     existed in JS (inline height/display), so a toggled panel still reveals.
//   - Idempotent, defensive, and silent on failure — never throw into the page.
//
// Returns the HTML with the shim injected right before </body>.
// ---------------------------------------------------------------------------

// The injected runtime. Kept as a plain string so it ships verbatim to the page.
// Written as an IIFE, vanilla JS, no dependencies, no globals leaked.
const SHIM_JS = `(function(){
  "use strict";
  if (window.__efwShim) return; window.__efwShim = true;

  var OPEN_CLASSES = ["is-open","is-active","open","active","show","expanded","toggled","menu-open"];

  // Resolve the element a toggle controls:
  //  1) aria-controls="id"  -> #id (most reliable; themes set this for a11y)
  //  2) data-target / href="#id"
  //  3) structural fallback: the toggle's parent's submenu child, or next sibling
  function resolveTarget(btn){
    var id = btn.getAttribute("aria-controls");
    if (id){ var byId = document.getElementById(id); if (byId) return byId; }
    var dt = btn.getAttribute("data-target") || btn.getAttribute("data-bs-target");
    if (dt && dt.charAt(0) === "#"){ var t = document.getElementById(dt.slice(1)); if (t) return t; }
    var href = btn.getAttribute("href");
    if (href && href.charAt(0) === "#" && href.length > 1){
      var h = document.getElementById(href.slice(1)); if (h) return h;
    }
    // Structural: a submenu/dropdown inside the same list item.
    var li = btn.closest("li, .menu-item, .nav-item, .etch-nav__item");
    if (li){
      var sub = li.querySelector(".sub-menu, .submenu, .dropdown-menu, .etch-nav__dropdown, .etch-nav__flyout, ul ul, .children");
      if (sub && !sub.contains(btn)) return sub;
    }
    // Last resort: the immediate next element sibling.
    if (btn.nextElementSibling) return btn.nextElementSibling;
    return null;
  }

  function isOpen(btn, target){
    if (btn.getAttribute("aria-expanded") === "true") return true;
    if (target){ for (var i=0;i<OPEN_CLASSES.length;i++){ if (target.classList.contains(OPEN_CLASSES[i])) return true; } }
    return false;
  }

  function setState(btn, target, open){
    btn.setAttribute("aria-expanded", open ? "true" : "false");
    // Toggle an open-class on BOTH the control and its target so whichever one
    // the theme's CSS keys off of gets the state. Add our generic .efw-open too.
    [btn, target].forEach(function(el){
      if (!el) return;
      el.classList.toggle("efw-open", open);
      // Mirror onto the theme's own likely class if it already uses one.
      OPEN_CLASSES.forEach(function(c){
        // Only add classes the stylesheet probably expects: we can't know which,
        // so we add the two most universal ("is-open","open") + .efw-open backstop.
      });
    });
    if (target){ target.classList.toggle("is-open", open); target.classList.toggle("open", open); }
    // Also toggle the common "menu-open" flag on <body> for themes that gate the
    // mobile panel off a body class.
    if (btn.matches("[aria-controls], .menu-toggle, .hamburger, .nav-toggle, .mobile-nav-toggle, [class*='menu-toggle'], [class*='hamburger']")){
      document.body.classList.toggle("efw-menu-open", open);
    }
  }

  function wireToggle(btn){
    if (btn.__efwWired) return; btn.__efwWired = true;
    btn.addEventListener("click", function(e){
      var target = resolveTarget(btn);
      // If it's a real link to another page (no in-page target), let it navigate.
      if (!target && btn.tagName === "A" && btn.getAttribute("href") && btn.getAttribute("href").charAt(0) !== "#") return;
      e.preventDefault();
      var open = !isOpen(btn, target);
      setState(btn, target, open);
    }, false);
  }

  // Toggle selector set: aria-driven first (most reliable), then common classes.
  var SELECTOR = [
    "[aria-controls][aria-expanded]",
    "[aria-haspopup='true']",
    "button[aria-expanded]",
    ".menu-toggle", ".hamburger", ".nav-toggle", ".mobile-nav-toggle", ".menu-button",
    "[class*='menu-toggle']", "[class*='hamburger']", "[class*='dropdown-toggle']", "[class*='flyout-toggle']",
    ".accordion-toggle", ".accordion-trigger", ".accordion-header button", ".faq-question", "[class*='accordion'] button"
  ].join(",");

  function scan(root){
    var nodes = (root || document).querySelectorAll(SELECTOR);
    for (var i=0;i<nodes.length;i++){ wireToggle(nodes[i]); }
  }

  function init(){
    scan(document);
    // Close open dropdowns when clicking outside (desktop flyouts).
    document.addEventListener("click", function(e){
      document.querySelectorAll("[aria-haspopup='true'][aria-expanded='true']").forEach(function(btn){
        var target = resolveTarget(btn);
        if (btn.contains(e.target) || (target && target.contains(e.target))) return;
        setState(btn, target, false);
      });
    }, true);
    // Re-scan if the DOM changes (rare, but cheap insurance).
    if (window.MutationObserver){
      var mo = new MutationObserver(function(){ scan(document); });
      mo.observe(document.body, { childList:true, subtree:true });
      setTimeout(function(){ mo.disconnect(); }, 8000); // stop watching after load settles
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();`;

// Backstop CSS: only kicks in when the theme had NO open-state rule of its own.
// Scoped to our generic .efw-open class so it never overrides the theme's real
// styling when that exists — it's purely a "make a toggled panel visible" net.
const SHIM_CSS = `
/* efw interaction backstop — reveals panels whose open-state styling lived in JS */
[aria-controls].efw-open ~ *[hidden],
.efw-open > [hidden] { }
/* If a controlled panel is still visually hidden after toggling, nudge it open.
   Low-specificity so any real theme rule wins. */
.efw-open:where(.sub-menu,.submenu,.dropdown-menu,nav,ul,.accordion-content,.faq-answer,[class*='dropdown'],[class*='flyout']) {
  display: block;
}
`;

// Inject the shim (CSS into <head>, JS before </body>) into a captured HTML doc.
export function injectInteractions(html) {
  try {
    const styleTag = `<style data-efw="interactions-backstop">${SHIM_CSS}</style>`;
    const scriptTag = `<script data-efw="interactions">${SHIM_JS}</script>`;
    let out = html;
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, `${styleTag}</head>`);
    else out = styleTag + out;
    if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, `${scriptTag}</body>`);
    else out = out + scriptTag;
    return out;
  } catch (_) {
    return html;
  }
}
