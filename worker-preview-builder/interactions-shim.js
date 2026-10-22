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

  // Some builders (ElementsKit/Elementor, offcanvas navs) reveal the mobile panel
  // via a specific class on a specific element that has NO aria-controls link back
  // to the hamburger. Map a toggle to its panel structurally when aria/href fail.
  // Each entry: [toggle matches selector, panel selector to search document for].
  var PANEL_MAP = [
    [".elementskit-menu-hamburger,.elementskit-menu-toggler,.elementskit-menu-close", ".elementskit-menu-offcanvas-elements"],
    [".mobile-menu-toggle,.mobile-nav-toggle", ".mobile-menu,.mobile-nav,.offcanvas,.off-canvas"],
  ];

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
    // Builder-specific offcanvas panels that have no aria link to the toggle.
    for (var p=0;p<PANEL_MAP.length;p++){
      try {
        if (btn.matches(PANEL_MAP[p][0])){
          var panel = document.querySelector(PANEL_MAP[p][1]);
          if (panel) return panel;
        }
      } catch(_){}
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
    });
    if (target){
      target.classList.toggle("is-open", open);
      target.classList.toggle("open", open);
      // Builder offcanvas panels (ElementsKit etc.) reveal via an 'active' class.
      // Toggling it here is safe: on panels that don't use it, an extra class is inert.
      target.classList.toggle("active", open);
      // CRITICAL: many themes reveal the panel via an aria-expanded rule on the
      // TARGET itself (e.g. nav[aria-expanded='true']{display:block}), not via a
      // class. The button's own aria-expanded only drives the icon animation. So
      // mirror the state onto the target's aria-expanded too — but only if the
      // target isn't an interactive control whose aria-expanded means something
      // else (it's a plain container like nav/ul/div, which is the usual case).
      var tag = target.tagName;
      if (tag === "NAV" || tag === "UL" || tag === "DIV" || tag === "SECTION" || tag === "ASIDE") {
        target.setAttribute("aria-expanded", open ? "true" : "false");
      }
      // Offcanvas/drawer panels (Bricks x-offcanvas, many a11y drawers) are hidden
      // via [aria-hidden="true"] and slid in when it becomes "false". If the target
      // carries aria-hidden, flip it so the reveal transform applies.
      if (target.hasAttribute("aria-hidden")) {
        target.setAttribute("aria-hidden", open ? "false" : "true");
      }
    }
    // Also toggle the common "menu-open" flag on <body> for themes that gate the
    // mobile panel off a body class.
    if (btn.matches("[aria-controls], .menu-toggle, .hamburger, .nav-toggle, .mobile-nav-toggle, [class*='menu-toggle'], [class*='hamburger']")){
      document.body.classList.toggle("efw-menu-open", open);
    }
  }

  function wireToggle(btn){
    if (btn.__efwWired) return; btn.__efwWired = true;
    // Replay owns any element it stamped (data-efw-tgl) — don't double-wire it.
    if (btn.hasAttribute && btn.hasAttribute("data-efw-tgl")) return;
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

  // Dismiss ("close X") controls: cookie banners, modals, notices, popups. Origin
  // JS normally hides the container on click; with that JS stripped, the X does
  // nothing. We wire these to hide their nearest dismissible ancestor.
  var DISMISS_SELECTOR = [
    ".cmplz-close",                 // Complianz GDPR cookie banner
    "[class*='cookie'] [class*='close']", "[class*='cookie'][class*='close']",
    "[class*='consent'] [class*='close']",
    ".modal-close", ".close-modal", "[class*='modal'] [class*='close']",
    ".popup-close", "[class*='popup'] [class*='close']",
    "[class*='notice'] [class*='dismiss']", "[class*='dismiss']",
    "[aria-label='Close']", "[aria-label='Close dialog']", "[aria-label='Dismiss']"
  ].join(",");

  // Containers we allow a dismiss button to hide (nearest matching ancestor).
  var DISMISSABLE_ANCESTOR = [
    "[class*='cookiebanner']", "[class*='cookie-banner']", "[class*='cookie']",
    "[class*='consent']", "[role='dialog']", "[class*='modal']", "[class*='popup']",
    "[class*='notice']", "[class*='banner']", "[aria-modal='true']"
  ].join(",");

  function wireDismiss(btn){
    if (btn.__efwDismiss) return; btn.__efwDismiss = true;
    if (btn.hasAttribute && btn.hasAttribute("data-efw-tgl")) return;
    btn.addEventListener("click", function(e){
      var box = btn.closest(DISMISSABLE_ANCESTOR);
      if (!box) return;
      e.preventDefault(); e.stopPropagation();
      // Hide robustly: display:none inline wins over most theme CSS, and we also
      // add the common hidden classes some themes animate off of.
      box.style.setProperty("display", "none", "important");
      box.classList.add("cmplz-hidden", "efw-dismissed");
      box.setAttribute("aria-hidden", "true");
    }, false);
  }

  function scan(root){
    var r = root || document;
    var nodes = r.querySelectorAll(SELECTOR);
    for (var i=0;i<nodes.length;i++){ wireToggle(nodes[i]); }
    var dnodes = r.querySelectorAll(DISMISS_SELECTOR);
    for (var j=0;j<dnodes.length;j++){ wireDismiss(dnodes[j]); }
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
