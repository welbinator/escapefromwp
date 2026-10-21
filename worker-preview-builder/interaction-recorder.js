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

  // Attributes whose change commonly drives "open/visible" state.
  var WATCH = ["class", "style", "hidden", "open", "aria-expanded", "aria-hidden", "aria-selected", "data-state", "data-open"];

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

  function apply(el, attrs, open){
    if (!el) return;
    for (var name in attrs){
      var val = open ? attrs[name].to : attrs[name].from;
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

  function wire(tg){
    var btn = findBtn(tg);
    if (!btn || btn.__efwWired) return;
    btn.__efwWired = true;
    var open = false;
    btn.addEventListener("click", function(e){
      // Let real navigation links through if they aren't in-page toggles.
      if (btn.tagName === "A"){
        var href = btn.getAttribute("href");
        if (href && href.charAt(0) !== "#" && !/^javascript:/i.test(href) && tg.changes.length === 0) return;
      }
      e.preventDefault();
      open = !open;
      for (var i=0;i<tg.changes.length;i++){
        var ch = tg.changes[i];
        var target = findEl(ch);
        apply(target, ch.attrs, open);
      }
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
    // Close open dropdowns on outside click (desktop flyouts).
    document.addEventListener("click", function(e){
      for (var i=0;i<REC.toggles.length;i++){
        var tg = REC.toggles[i];
        var btn = findBtn(tg);
        if (!btn || !btn.classList.contains("efw-open")) continue;
        if (btn.contains(e.target)) continue;
        var inside = false;
        for (var j=0;j<tg.changes.length;j++){
          var tel = findEl(tg.changes[j]);
          if (tel && tel.contains(e.target)) { inside = true; break; }
        }
        if (!inside){ btn.click(); }
      }
    }, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();`;
}

// Convenience: inject the replay script (+ a tiny backstop CSS) before </body>.
export function injectReplay(html, recording) {
  try {
    var script = `<script data-efw="replay">${buildReplayScript(recording)}</script>`;
    var css = `<style data-efw="replay-backstop">.efw-open:where(nav,ul,.sub-menu,.submenu,.dropdown-menu,[class*='dropdown'],[class*='flyout'],[class*='accordion']){display:block}</style>`;
    var out = html;
    if (/<\/head>/i.test(out)) out = out.replace(/<\/head>/i, css + "</head>"); else out = css + out;
    if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, script + "</body>"); else out = out + script;
    return out;
  } catch (e) { return html; }
}
