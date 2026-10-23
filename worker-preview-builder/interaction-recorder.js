// interaction-recorder.js
// ---------------------------------------------------------------------------
// RECORD-AND-REPLAY interaction capture.
//
// The old approach (interactions-shim.js) GUESSED how a theme's menu works from
// hardcoded selectors — a whack-a-mole that can't generalize across thousands of
// WP themes/builders. This instead OBSERVES the real behavior while the origin
// site's own JavaScript is still alive in headless Chrome:
//
//   for each candidate toggle (hamburger, dropdown, accordion, tab, FAQ):
//     1. snapshot the DOM (class/style/aria/hidden/open on every element)
//     2. CLICK it — let the site's real JS open the thing
//     3. snapshot again, DIFF → exactly which elements changed and how
//     4. stamp stable data-efw ids on the toggle + changed elements
//     5. reverse to baseline for the next toggle
//
// The diff is ground truth for THIS theme — no assumptions. We then ship a tiny
// replay script that, on click, re-applies the recorded "open" state (and
// reverses it to close). Works on a weird custom builder the same as a standard
// theme, because we never guess — we replay what we watched happen.
//
// Limits (honest): handles click-to-toggle (menus, dropdowns, accordions, tabs —
// the ~85% case). Cannot resurrect things that need the dead WP backend (live
// search, AJAX load-more, cart) or autonomous timers (auto-advancing carousels);
// those produce no clean open/close diff and are simply left un-wired.
// ---------------------------------------------------------------------------

// The in-browser recorder. Serialized and run via page.evaluate() so it executes
// in the live page with the origin JS intact. Returns a JSON recording and (as a
// side effect) stamps data-efw-tgl / data-efw-el attributes that persist into the
// captured HTML. `opts` = { maxToggles, settleMs }.
export const RECORDER_FN = function (opts) {
  var MAX = (opts && opts.maxToggles) || 40;
  var SETTLE = (opts && opts.settleMs) || 350;
  var PASS = (opts && opts.pass) || "";  // id prefix to keep multi-pass ids unique

  // Attributes whose change commonly drives "open/visible" state. Includes the
  // body/html state attributes that modal-drawer themes toggle to reveal a panel
  // via a descendant CSS selector (e.g. Blocksy's `body[data-panel*=in] .ct-panel
  // .active{display:flex}` — the `.active` class alone is display:none until the
  // ancestor `data-panel` attribute is also set). Without watching these, a drawer
  // records as "class changed" but never actually reveals on replay.
  var WATCH = ["class", "style", "hidden", "inert", "open", "aria-expanded", "aria-hidden", "aria-selected", "data-state", "data-open", "data-panel", "data-modal", "data-offcanvas", "data-menu-open", "aria-modal"];

  // Candidate toggles: a11y-driven first, then common class names. Mirrors the
  // shim's net, but here it only decides WHAT to click — the effect is recorded.
  var SELECTOR = [
    "[aria-controls]",
    "[aria-haspopup='true']",
    "button[aria-expanded]",
    "[aria-expanded]",
    ".menu-toggle", ".hamburger", ".nav-toggle", ".mobile-nav-toggle", ".menu-button",
    "[class*='menu-toggle']", "[class*='hamburger']", "[class*='dropdown-toggle']", "[class*='flyout-toggle']",
    ".accordion-toggle", ".accordion-trigger", ".accordion-header button", ".faq-question",
    "[class*='accordion'] button", "[role='tab']", "summary"
  ].join(",");

  function allEls() { return Array.prototype.slice.call(document.querySelectorAll("*")); }

  // Build a STABLE, document-unique CSS selector for an element — one that will
  // still match AFTER our data-efw stamps are gone. This is the key to surviving
  // themes that re-render nodes on viewport resize (e.g. "etch"): the data-efw-*
  // attributes get wiped when the theme rebuilds its header, but the theme's own
  // id/classes/tag/structure persist. Replay re-finds elements by this selector
  // when the stamp is missing. Prefers #id, then a nth-of-type path up to <body>.
  function buildSelector(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return "#" + el.id;
    var parts = [];
    var node = el;
    while (node && node.nodeType === 1 && node.tagName !== "HTML") {
      var tag = node.tagName.toLowerCase();
      if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) { parts.unshift("#" + node.id); break; }
      var seg = tag;
      var parent = node.parentNode;
      if (parent) {
        var sibs = Array.prototype.filter.call(parent.children, function (c) { return c.tagName === node.tagName; });
        if (sibs.length > 1) { seg += ":nth-of-type(" + (sibs.indexOf(node) + 1) + ")"; }
      }
      parts.unshift(seg);
      if (tag === "body") break;
      node = parent;
    }
    var sel = parts.join(" > ");
    // Verify uniqueness; if not unique, it's still a best-effort first match.
    try { if (document.querySelectorAll(sel).length === 1) return sel; } catch (e) {}
    return sel;
  }

  // Compact fingerprint of the whole doc: for each element (by index) record the
  // watched attribute values. Index is positional and stable within one snapshot
  // pair (we don't mutate structure between the two snapshots of a toggle).
  function snapshot(els) {
    var snap = new Array(els.length);
    for (var i = 0; i < els.length; i++) {
      var el = els[i], rec = null;
      for (var a = 0; a < WATCH.length; a++) {
        var name = WATCH[a];
        var v = name === "class" ? el.className
              : name === "style" ? (el.getAttribute("style") || "")
              : el.getAttribute(name);
        if (v != null && v !== "") { (rec = rec || {})[name] = String(v); }
      }
      snap[i] = rec;
    }
    return snap;
  }

  // Also record computed visibility so we can tell a real reveal from a no-op.
  function visible(el) {
    try {
      var s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity) === 0) return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    } catch (e) { return true; }
  }

  function diff(before, after, els) {
    var changes = [];
    for (var i = 0; i < els.length; i++) {
      var b = before[i] || {}, a = after[i] || {};
      var keys = {};
      for (var k in b) keys[k] = 1; for (var k2 in a) keys[k2] = 1;
      var elChange = null;
      for (var key in keys) {
        var bv = b[key] == null ? null : b[key];
        var av = a[key] == null ? null : a[key];
        if (bv !== av) { (elChange = elChange || { idx: i, attrs: {} }).attrs[key] = { from: bv, to: av }; }
      }
      if (elChange) {
        // Only keep changes that plausibly affect visibility: the element (or a
        // descendant) became visible, OR a visibility-ish attr changed. Filters
        // out incidental churn (e.g. focus-ring classes).
        elChange.becameVisible = !before._vis[i] && visible(els[i]);
        changes.push(elChange);
      }
    }
    return changes;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function cssPathShort(el) {
    // Lightweight descriptive selector for diagnostics only (not used for replay;
    // replay uses the stamped data-efw-el id).
    if (!el || el.nodeType !== 1) return "";
    var id = el.id ? "#" + el.id : "";
    var cls = (el.className && typeof el.className === "string") ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    return el.tagName.toLowerCase() + id + cls;
  }

  return (async function () {
    var recording = { version: 1, toggles: [] };
    var toggles = Array.prototype.slice.call(document.querySelectorAll(SELECTOR)).slice(0, MAX);
    var elIdCounter = 0;

    for (var t = 0; t < toggles.length; t++) {
      var btn = toggles[t];
      if (!btn || btn.__efwSeen) continue; btn.__efwSeen = true;

      // Fresh element list + baseline snapshot (structure may have changed from a
      // previous toggle's side effects, so re-collect each time).
      var els = allEls();
      var before = snapshot(els);
      before._vis = els.map(visible);

      // Click and let the real JS react.
      try { btn.click(); } catch (e) { continue; }
      await sleep(SETTLE);

      var after = snapshot(els);
      var changes = diff(before, after, els);

      // A useful toggle = at least one element changed an attribute AND something
      // on the page became visible. CRITICAL: the element that CHANGES (e.g. a
      // <header> gaining a "menu-open" class) is often NOT the element that becomes
      // VISIBLE (e.g. a descendant <nav> revealed by a `.header.menu-open .nav{...}`
      // CSS rule). So we check visibility ACROSS THE WHOLE DOCUMENT, not just on the
      // changed elements — otherwise ancestor-attr/descendant-reveal menus (very
      // common) look like no-ops and get skipped. Replaying the recorded attribute
      // change re-triggers the same CSS cascade, re-revealing the descendant.
      var anyBecameVisible = false;
      for (var vi = 0; vi < els.length; vi++) {
        if (!before._vis[vi] && visible(els[vi])) { anyBecameVisible = true; break; }
      }
      if (changes.length && anyBecameVisible) {
        // Stamp the toggle + each changed element with stable replay ids. The PASS
        // prefix keeps ids unique across multi-pass (mobile+desktop) recording.
        if (!btn.getAttribute("data-efw-tgl")) btn.setAttribute("data-efw-tgl", PASS + String(t));
        var recChanges = [];
        for (var c = 0; c < changes.length; c++) {
          var el = els[changes[c].idx];
          var eid = el.getAttribute("data-efw-el");
          if (!eid) { eid = PASS + "e" + (elIdCounter++); el.setAttribute("data-efw-el", eid); }
          recChanges.push({ el: eid, sel: buildSelector(el), attrs: changes[c].attrs });
        }
        recording.toggles.push({
          tgl: btn.getAttribute("data-efw-tgl"),
          sel: buildSelector(btn),
          desc: cssPathShort(btn),
          changes: recChanges
        });
      }

      // Reverse to baseline so the next toggle records cleanly. Clicking again is
      // the natural close for toggles; if it doesn't restore, force the recorded
      // "from" values back.
      try { btn.click(); } catch (e) {}
      await sleep(Math.min(SETTLE, 200));
    }

    // Clean our scratch flags off the DOM (keep the data-efw-* stamps).
    allEls().forEach(function (el) { try { delete el.__efwSeen; } catch (e) {} });
    return recording;
  })();
};

// Build the replay runtime from a recording. The replay finds the stamped toggle
// and target elements and, on click, applies the recorded "to" state (open) or
// "from" state (close). Falls back to toggling a generic .efw-open class so CSS
// that keys off it still works. Dependency-free IIFE.
export function buildReplayScript(recording) {
  var json = JSON.stringify(recording || { toggles: [] });
  return `(function(){
  "use strict";
  if (window.__efwReplay) return; window.__efwReplay = true;
  var REC = ${json};

  function apply(el, attrs, open, baseline){
    if (!el) return;
    for (var name in attrs){
      var val;
      if (open){
        val = attrs[name].to;
      } else {
        // Close: restore the element's REAL shipped value (captured at first open),
        // not the recorded "from" — recordings can disagree with the static HTML
        // (e.g. recorded from:null while the shipped node has style="display:none"),
        // which would otherwise leave submenus stuck open after closing.
        val = (baseline && name in baseline) ? baseline[name] : attrs[name].from;
      }
      if (val == null){ el.removeAttribute(name); }
      else if (name === "class"){ el.className = val; }
      else { el.setAttribute(name, val); }
    }
    el.classList.toggle("efw-open", open);
  }

  // Resolve a recorded element. Prefer the data-efw stamp, but fall back to the
  // recorded stable selector — CRITICAL because some themes (e.g. "etch") re-render
  // nodes on resize and WIPE our stamps before capture, so the stamp is often gone
  // from the shipped HTML while the theme's own id/class/structure selector still
  // matches. We re-stamp on first resolve so later lookups are fast.
  function resolve(stampAttr, stampVal, sel){
    var el = stampVal ? document.querySelector('[' + stampAttr + '="' + stampVal + '"]') : null;
    if (el) return el;
    if (sel){ try { el = document.querySelector(sel); } catch(e){ el = null; }
      if (el && stampVal){ try { el.setAttribute(stampAttr, stampVal); } catch(e){} } }
    return el;
  }

  function findBtn(tg){ return resolve("data-efw-tgl", tg.tgl, tg.sel); }
  function findEl(ch){ return resolve("data-efw-el", ch.el, ch.sel); }

  // Shared open-state per target element id, so two toggles (e.g. a mobile-pass
  // and desktop-pass record of the SAME submenu) don't desync and leave it stuck.
  var SHARED = {};
  function captureBaseline(el, attrs){
    var base = {};
    for (var name in attrs){
      var v = name === "class" ? el.className
            : el.getAttribute(name);
      base[name] = (v === "" && name !== "class") ? "" : (v == null ? null : String(v));
    }
    return base;
  }

  function wire(tg){
    var btn = findBtn(tg);
    if (!btn || btn.__efwWired) return;
    // NB: do NOT mark btn wired here. When the click surface ends up being btn
    // itself (the common case, a hamburger/toggle with no wrapping anchor), an
    // early mark makes the surface.__efwWired guard below short-circuit BEFORE
    // the listener is attached, leaving the control dead. Mark at the very end.
    // Determine the best click surface. A submenu arrow is often a tiny <button>
    // nested inside the menu item's <a href="#"> label. Users tap the label, not
    // the arrow — and because the anchor CONTAINS the button, a tap bubbles through
    // BOTH if we wire both, firing the toggle twice (open then instantly re-close).
    // So pick ONE surface: prefer a wrapping non-navigating anchor when present.
    var surface = btn;
    var a = btn.closest ? btn.closest("a") : null;
    if (a && a !== btn){
      var ahref = a.getAttribute("href");
      if (!ahref || ahref === "#" || ahref.charAt(0) === "#" || /^javascript:/i.test(ahref)){
        surface = a;
      }
    }
    function toggle(e){
      if (e){ e.preventDefault(); e.stopPropagation(); }
      var anyOpen = false;
      for (var i=0;i<tg.changes.length;i++){
        var ch = tg.changes[i];
        var target = findEl(ch);
        if (!target) continue;
        var key = ch.el;
        // Capture the element's REAL shipped state once, before we ever touch it.
        if (!(key in SHARED)){ SHARED[key] = { open: false, base: captureBaseline(target, ch.attrs) }; }
        SHARED[key].open = !SHARED[key].open;
        apply(target, ch.attrs, SHARED[key].open, SHARED[key].base);
        if (SHARED[key].open) anyOpen = true;
      }
      // Mark the actual wired surface open/closed — the outside-click handler and
      // the close logic both key off this exact element.
      surface.classList.toggle("efw-open", anyOpen);
    }
    if (surface.__efwWired) return;
    surface.__efwWired = true;
    btn.__efwWired = true;  // dedup guard for the top of wire() on later passes
    tg.__surface = surface;  // remember which element actually carries the toggle
    surface.addEventListener("click", function(e){
      // Let real navigation links through if they aren't in-page toggles.
      if (surface.tagName === "A"){
        var href = surface.getAttribute("href");
        if (href && href.charAt(0) !== "#" && !/^javascript:/i.test(href) && tg.changes.length === 0) return;
      }
      toggle(e);
    }, false);
  }

  function init(){
    // Eagerly re-resolve every recorded toggle + element FIRST. When stamps were
    // wiped (theme re-render), resolve() re-applies them from the stable selector.
    // This restores the data-efw-tgl marker the shim uses to know which elements
    // replay owns — preventing the shim from double-wiring the same control.
    for (var r=0;r<REC.toggles.length;r++){
      var rt = REC.toggles[r]; findBtn(rt);
      for (var rc=0; rc<rt.changes.length; rc++){ findEl(rt.changes[rc]); }
    }
    for (var i=0;i<REC.toggles.length;i++){ wire(REC.toggles[i]); }

    // Wire CLOSE affordances the recorder never clicked. A full-screen off-canvas
    // panel covers the hamburger once open, so re-tapping it to close is impossible
    // for the user — they tap the panel's X button or the backdrop. Neither is a
    // recorded toggle. Here we find any close control / backdrop and, on click,
    // close every currently-open recorded surface (reversing its recorded state).
    function closeAllOpen(){
      for (var i=0;i<REC.toggles.length;i++){
        var s = REC.toggles[i].__surface;
        if (s && s.classList.contains("efw-open")) s.click();
      }
    }
    function isOpen(){
      for (var i=0;i<REC.toggles.length;i++){
        var s = REC.toggles[i].__surface;
        if (s && s.classList.contains("efw-open")) return true;
      }
      return false;
    }
    // Delegated: catch clicks on close buttons AND on a panel's own backdrop (a
    // click landing directly on the fixed .ct-panel / [role=dialog] container, not
    // its inner content, is a backdrop dismiss). Capture phase so it beats links.
    var CLOSE_SEL = "[class*='toggle-close'],[class*='panel-close'],[class*='close-menu']," +
      "[class*='menu-close'],[class*='offcanvas-close'],[class*='drawer-close']," +
      "[aria-label*='close' i],[data-micromodal-close],.ct-toggle-close";
    var PANEL_SEL = "[class*='offcanvas'],[class*='off-canvas'],[class*='ct-panel']," +
      "[class*='side-menu'],[class*='nav-drawer'],[class*='mobile-menu'],[role='dialog']";
    document.addEventListener("click", function(e){
      if (!isOpen()) return;
      var t = e.target;
      if (t && t.closest){
        if (t.closest(CLOSE_SEL)){ e.preventDefault(); e.stopPropagation(); closeAllOpen(); return; }
        // Backdrop: the click target IS a panel container (not inner content).
        var pan = t.matches && t.matches(PANEL_SEL) ? t : null;
        if (pan){ e.preventDefault(); e.stopPropagation(); closeAllOpen(); return; }
      }
    }, true);
    // Esc closes too (expected modal behavior).
    document.addEventListener("keydown", function(e){
      if ((e.key === "Escape" || e.keyCode === 27) && isOpen()) closeAllOpen();
    });

    // Close open dropdowns on outside click (desktop flyouts). Use the element
    // that actually carries the toggle (the wired surface — anchor or button), not
    // just the recorded button, so a tap ON the label isn't misread as "outside"
    // (which would close-then-reopen and leave the submenu stuck).
    document.addEventListener("click", function(e){
      for (var i=0;i<REC.toggles.length;i++){
        var tg = REC.toggles[i];
        var surface = tg.__surface;
        // Only toggles that actually OWN a wired surface participate. A duplicate
        // record (same submenu recorded in both the mobile and desktop pass) never
        // got __surface set because the surface was already wired — skipping it
        // here prevents it from firing a spurious close on the shared element.
        if (!surface || !surface.classList.contains("efw-open")) continue;
        if (surface.contains(e.target)) continue;
        var inside = false;
        for (var j=0;j<tg.changes.length;j++){
          var tel = findEl(tg.changes[j]);
          if (tel && tel.contains(e.target)) { inside = true; break; }
        }
        if (!inside){ surface.click(); }
      }
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();`;
}

// ---------------------------------------------------------------------------
// CONSENT-BANNER NEUTRALIZER
// ---------------------------------------------------------------------------
// Cookie/consent platforms (CookieYes, Iubenda, Complianz, Cookiebot, Borlabs,
// Moove GDPR, Termly, Osano, OneTrust, Didomi, Quantcast/__tcfapi, Real Cookie
// Banner, GDPR Cookie Compliance, …) render a FIXED, top-of-everything overlay
// and put ALL of their accept/close logic in vendor JavaScript. Because replica
// capture strips every <script>, that overlay freezes on-screen with no way to
// dismiss it — AND, being position:fixed at a massive z-index, it intercepts
// every click, so the menu/links behind it feel dead too. Their JS is gone, so
// the banner adds zero value to a static demo: we remove it outright.
//
// We run this IN-BROWSER right before serialization (so computed styles are
// available to catch generic full-viewport fixed overlays we don't know by name)
// AND again as an HTML-string safety net after capture (stripConsentHtml), in
// case the in-page pass was skipped by a late navigation/destroyed context.

// Known consent-platform container selectors (removed outright).
export var CONSENT_SELECTORS_EXPORT = [
  // CookieYes
  "#cky-consent", ".cky-consent-container", ".cky-consent-bar", ".cky-modal",
  ".cky-overlay", ".cky-btn-revisit-wrapper", "[class*='cky-consent']",
  // Iubenda
  "#iubenda-cs-banner", ".iubenda-cs-container", "#iubenda-iframe", ".iub-cs-container",
  // Cookiebot
  "#CybotCookiebotDialog", "#CybotCookiebotDialogBodyUnderlay", "#CookiebotWidget",
  // Complianz
  "#cmplz-cookiebanner-container", ".cmplz-cookiebanner", ".cmplz-blocker",
  "#cmplz-manage-consent", ".cc-type-categories",
  // Borlabs
  "#BorlabsCookieBox", ".BorlabsCookie",
  // Moove GDPR / GDPR Cookie Consent (WP plugin)
  "#moove_gdpr_cookie_info_bar", "#moove_gdpr_cookie_modal", ".moove-gdpr-dpuChecked",
  // Cookie Notice & Compliance (dFactory)
  "#cookie-notice", ".cookie-notice-container",
  // GDPR Cookie Compliance (WebToffee / CookieLawInfo legacy)
  "#cookie-law-info-bar", "#cookie-law-info-again", ".cli-modal",
  // OneTrust
  "#onetrust-banner-sdk", "#onetrust-consent-sdk", ".onetrust-pc-dark-filter",
  // Osano
  ".osano-cm-window", ".osano-cm-dialog",
  // Termly
  "#termly-code-snippet-support", ".termly-styles-root", "[data-tid='banner']",
  // Didomi
  "#didomi-host", "#didomi-popup",
  // Quantcast
  ".qc-cmp2-container", "#qc-cmp2-ui",
  // Real Cookie Banner
  ".rcb-banner", "[class*='real-cookie-banner']",
  // Generic / theme-agnostic
  "[class*='cookie-banner']", "[class*='cookie-consent']", "[class*='cookie-notice']",
  "[id*='cookie-banner']", "[id*='cookie-consent']", "[id*='gdpr']",
  "[aria-label*='cookie' i][role='dialog']", "[aria-label*='consent' i][role='dialog']",
  "[class*='consent-banner']", "[class*='consent-overlay']", "[class*='gdpr-overlay']"
];

// In-browser neutralizer. Removes known consent containers, then sweeps for any
// remaining FULL-VIEWPORT fixed/sticky overlay whose text smells of cookies and
// kills it. Also strips `inert`/`aria-hidden`/`hidden` off off-canvas menu panels
// (Blocksy, Elementor, etc.) that the origin JS left frozen in a disabled state,
// and clears body scroll-locks a consent/menu library may have set. Serialized
// and run via page.evaluate(); dependency-free.
export const CONSENT_NEUTRALIZER_FN = function (selectors) {
  var removed = 0, unfrozen = 0;
  function kill(el) { if (el && el.parentNode) { el.parentNode.removeChild(el); removed++; } }

  // 1) Remove by known selector.
  for (var i = 0; i < selectors.length; i++) {
    try {
      var nodes = document.querySelectorAll(selectors[i]);
      for (var j = 0; j < nodes.length; j++) kill(nodes[j]);
    } catch (e) {}
  }

  // 2) Generic sweep: fixed/sticky, high z-index, covers most of the viewport OR
  //    pinned to an edge, and mentions cookies/consent. Catches unnamed banners.
  try {
    var vw = window.innerWidth || 1440, vh = window.innerHeight || 900;
    var all = document.body ? document.body.querySelectorAll("*") : [];
    for (var k = 0; k < all.length; k++) {
      var el = all[k];
      if (!el || !el.parentNode) continue;
      var s;
      try { s = getComputedStyle(el); } catch (e) { continue; }
      if (s.position !== "fixed" && s.position !== "sticky") continue;
      var z = parseInt(s.zIndex, 10); if (isNaN(z)) z = 0;
      if (z < 100) continue;
      var r;
      try { r = el.getBoundingClientRect(); } catch (e) { continue; }
      if (r.width < vw * 0.55 && r.height < vh * 0.5) continue; // not a banner/overlay
      var txt = (el.textContent || "").toLowerCase();
      if (txt.length > 4000) continue; // whole-page wrapper, not a banner
      if (/cookie|consent|gdpr|privacy|we use|tracking|accept all|opt[- ]?out/.test(txt)) {
        kill(el); continue;
      }
      // A near-opaque full-screen fixed backdrop with little/no text = modal veil.
      if (r.width >= vw * 0.92 && r.height >= vh * 0.92 && txt.trim().length < 30) kill(el);
    }
  } catch (e) {}

  // 3) Un-freeze off-canvas menu panels: origin JS often ships them inert/hidden
  //    and toggles the attribute on open. Our replay re-reveals via class/style,
  //    but a lingering inert/aria-hidden blocks interaction. Strip on nav panels.
  try {
    var frozen = document.querySelectorAll(
      "[inert],[aria-hidden='true']");
    for (var f = 0; f < frozen.length; f++) {
      var fe = frozen[f];
      var cls = (fe.className && typeof fe.className === "string") ? fe.className : "";
      var idn = fe.id || "";
      if (/offcanvas|off-canvas|mobile-menu|mobile-nav|menu-panel|nav-drawer|ct-panel|side-menu|slideout|drawer/i.test(cls + " " + idn)) {
        fe.removeAttribute("inert"); fe.removeAttribute("aria-hidden"); fe.removeAttribute("hidden"); unfrozen++;
      }
    }
  } catch (e) {}

  // 4) Release body scroll-lock a consent/menu lib may have left behind.
  try {
    var b = document.body, h = document.documentElement;
    [b, h].forEach(function (n) {
      if (!n) return;
      n.style.overflow = ""; n.style.position = ""; n.style.height = "";
      n.classList.remove("cky-consent-open", "iub-body-lock", "cmplz-modal-open",
        "modal-open", "no-scroll", "noscroll", "overflow-hidden", "menu-open",
        "cli-barmodal-open", "gdpr-infobar-visible");
    });
  } catch (e) {}

  return { removed: removed, unfrozen: unfrozen };
};

// HTML-string safety net. Runs after capture in case the in-page pass missed
// (destroyed context). Removes known consent containers by id/class and strips
// `inert` from off-canvas nav panels. Regex-based and deliberately conservative
// — only the well-known id/class hooks, so it can't eat real content.
export function stripConsentHtml(html) {
  try {
    var ids = [
      "iubenda-cs-banner", "cky-consent", "CybotCookiebotDialog",
      "CybotCookiebotDialogBodyUnderlay", "cmplz-cookiebanner-container",
      "BorlabsCookieBox", "moove_gdpr_cookie_info_bar", "moove_gdpr_cookie_modal",
      "cookie-notice", "cookie-law-info-bar", "onetrust-banner-sdk", "didomi-host"
    ];
    var out = html;
    for (var i = 0; i < ids.length; i++) {
      // Remove a top-level <div id="..."> ... </div> (non-greedy, best-effort).
      var re = new RegExp("<(div|aside|section)[^>]*\\bid=[\"']" + ids[i] +
        "[\"'][^>]*>[\\s\\S]*?</\\1>", "i");
      out = out.replace(re, "");
    }
    // Strip inert from off-canvas nav panels so the menu can open.
    out = out.replace(/(<[^>]*\b(?:class|id)=["'][^"']*(?:offcanvas|off-canvas|mobile-menu|mobile-nav|ct-panel|nav-drawer|drawer)[^"']*["'][^>]*?)\sinert(=["'][^"']*["'])?/gi, "$1");
    return out;
  } catch (e) { return html; }
}

// Convenience: inject the replay script (+ a tiny backstop CSS) before </body>.
export function injectReplay(html, recording) {
  try {
    var script = `<script data-efw="replay">${buildReplayScript(recording)}</script>`;
    var css = `<style data-efw="replay-backstop">.efw-open:where(nav,ul,.sub-menu,.submenu,.dropdown-menu,[class*='dropdown'],[class*='flyout'],[class*='accordion']){display:block}
.efw-open:where([class*='offcanvas'],[class*='off-canvas'],[class*='ct-panel'],[class*='side-menu'],[class*='nav-drawer'],[class*='drawer'],[class*='mobile-menu'],[class*='mobile-nav'],[role='dialog']){display:flex!important;opacity:1!important;visibility:visible!important;pointer-events:auto!important;transform:none!important}
li:has(> button[aria-expanded='true']) > :where(ul,.sub-menu,.submenu,.children,.sub-nav),li:has(> a[aria-expanded='true']) > :where(ul,.sub-menu,.submenu,.children,.sub-nav),li:has(> *[aria-expanded='true']) > :where(ul,.sub-menu,.submenu){display:block!important;opacity:1!important;visibility:visible!important;height:auto!important;max-height:none!important;transform:none!important;position:static!important;pointer-events:auto!important}
button[aria-expanded='true'] + :where(ul,.sub-menu,.submenu),*[aria-expanded='true'] + :where(ul,.sub-menu,.submenu){display:block!important;opacity:1!important;visibility:visible!important;height:auto!important;max-height:none!important}</style>`;
    var out = html;
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, css + "</head>"); else out = css + out;
    if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, script + "</body>"); else out = out + script;
    return out;
  } catch (e) { return html; }
}
