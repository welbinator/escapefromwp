// Cloudflare Pages Function — GET /preview/<id>/<template>
// Renders a stored preview through the requested template and injects the two
// floating modals ("Not for me" / "I like this — let's talk"). The modals POST
// to /api/preview-feedback. Dead/expired/missing previews show a friendly page.

import { getPreview, getPreviewHtml, putPreviewHtml, acquireBuildLock, releaseBuildLock } from "../api/_lib/preview-store.js";
import { designVariant } from "../api/_lib/ai-designer.js";

const VARIANT_KEYS = ["warm", "bold", "editorial"];

function html(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function friendly(title, msg) {
  return html(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#0b0405;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}
  a{color:#4ee36b}h1{font-size:1.6rem}</style></head><body><div><h1>${title}</h1><p style="color:#bbb;max-width:40ch">${msg}</p>
  <p><a href="https://escapefromwp.com/liberate">← Build a fresh preview</a></p></div></body></html>`, 404);
}

// The modal + feedback UI injected before </body> of every live preview.
function modalsHtml(id, variant) {
  return `
<style>
  #efw-bar{position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#0b0405;color:#fff;
    display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap;padding:14px 18px;
    font-family:system-ui,sans-serif;box-shadow:0 -6px 24px rgba(0,0,0,.3)}
  #efw-bar .lbl{font-size:13px;color:#cbd5e1;margin-right:4px}
  #efw-bar button{font:inherit;font-size:14px;font-weight:600;border-radius:6px;padding:10px 18px;border:0;cursor:pointer}
  #efw-no{background:#2b2b2b;color:#ddd}
  #efw-yes{background:#4ee36b;color:#06230f}
  #efw-note{position:fixed;left:0;right:0;top:0;z-index:99998;background:#4ee36b;color:#06230f;
    text-align:center;padding:8px;font:600 13px system-ui,sans-serif;transform:translateY(-100%);transition:.3s}
  #efw-note.show{transform:translateY(0)}
  #efw-modal{position:fixed;inset:0;z-index:100000;background:rgba(5,3,3,.75);display:none;place-items:center;padding:20px}
  #efw-modal.open{display:grid}
  #efw-modal .box{background:#fff;color:#111;border-radius:12px;max-width:420px;width:100%;padding:26px;font-family:system-ui,sans-serif}
  #efw-modal h3{margin:0 0 6px;font-size:1.3rem}
  #efw-modal p{margin:0 0 16px;color:#666;font-size:14px}
  #efw-modal input,#efw-modal textarea{width:100%;box-sizing:border-box;padding:11px;margin:0 0 12px;border:1px solid #ddd;border-radius:7px;font:inherit}
  #efw-modal textarea{min-height:84px;resize:vertical}
  #efw-modal .send{background:#0b0405;color:#fff;border:0;border-radius:7px;padding:12px 20px;font:600 15px system-ui;cursor:pointer;width:100%}
  #efw-modal .x{float:right;cursor:pointer;color:#999;font-size:20px;line-height:1;border:0;background:none}
  #efw-pad{height:66px}
</style>
<div id="efw-note"></div>
<div id="efw-bar">
  <span class="lbl">What do you think of this design?</span>
  <button id="efw-no">Not for me</button>
  <button id="efw-yes">I like this one — let's talk</button>
</div>
<div id="efw-pad"></div>
<div id="efw-modal">
  <div class="box">
    <button class="x" onclick="document.getElementById('efw-modal').classList.remove('open')">×</button>
    <h3>Nice — let's talk 👋</h3>
    <p>Drop your details and James will reach out about finishing this site and hosting it.</p>
    <form id="efw-form">
      <input name="name" placeholder="Your name" required>
      <input name="email" type="email" placeholder="Email" required>
      <textarea name="message" placeholder="Anything you want us to know? (optional)"></textarea>
      <button class="send" type="submit">Send to James →</button>
    </form>
  </div>
</div>
<script>
(function(){
  var ID=${JSON.stringify(id)}, VAR=${JSON.stringify(variant)};
  var note=document.getElementById('efw-note');
  function toast(t){ note.textContent=t; note.classList.add('show'); }
  function post(action, extra){
    return fetch('/api/preview-feedback',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(Object.assign({id:ID,variant:VAR,action:action},extra||{}))});
  }
  document.getElementById('efw-no').onclick=function(){
    post('reject').then(function(r){return r.json()}).then(function(res){
      document.getElementById('efw-bar').style.display='none';
      if(res && res.all_dead){ toast('Thanks for the feedback — no hard feelings.'); }
      else { toast('Got it — check your other two designs in the email. 👍'); }
    }).catch(function(){
      document.getElementById('efw-bar').style.display='none';
      toast('Thanks for the feedback — no hard feelings.');
    });
  };
  document.getElementById('efw-yes').onclick=function(){
    document.getElementById('efw-modal').classList.add('open');
  };
  document.getElementById('efw-form').onsubmit=function(e){
    e.preventDefault();
    var f=e.target, btn=f.querySelector('.send'); btn.disabled=true; btn.textContent='Sending…';
    post('like',{name:f.name.value,email:f.email.value,message:f.message.value}).then(function(r){return r.json()})
      .then(function(){ document.getElementById('efw-modal').classList.remove('open');
        document.getElementById('efw-bar').style.display='none';
        toast("Got it — James will be in touch soon. 🎉"); })
      .catch(function(){ btn.disabled=false; btn.textContent='Send to James →'; alert('Something went wrong — try again?'); });
  };
})();
</script>`;
}

function buildingPage(id, variant) {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="12">
  <title>Building your preview…</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;background:#0b0405;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}
    .spin{width:40px;height:40px;border:3px solid #2b2b2b;border-top-color:#4ee36b;border-radius:50%;animation:s .8s linear infinite;margin:0 auto 22px}
    @keyframes s{to{transform:rotate(360deg)}}
    h1{font-size:1.5rem;margin:0 0 10px}p{color:#bbb;max-width:44ch;line-height:1.6;margin:0 auto}
    .sub{color:#777;font-size:13px;margin-top:18px}
    @media (prefers-reduced-motion:reduce){.spin{animation-duration:2.5s}}
  </style></head><body><div>
  <div class="spin"></div>
  <h1>We're designing this site now.</h1>
  <p>Our designer is building this look from scratch using your real content. This can take a few minutes. This page refreshes itself, so you can just leave it open, or check the email we're sending you.</p>
  <p class="sub">Design: ${variant} · we'll email all three links when they're ready.</p>
  </div></body></html>`, 200);
}

export async function onRequestGet({ params, env }) {
  const parts = params.path || [];
  const id = (parts[0] || "").toLowerCase();
  const variant = VARIANT_KEYS.includes(parts[1]) ? parts[1] : "warm";

  if (!env.DB || !env.EXPORTS) return friendly("Preview unavailable", "Preview storage isn't configured right now.");

  const rec = await getPreview(env, id);
  if (!rec) return friendly("Preview not found", "This preview may have expired — previews are kept for 7 days.");
  if (rec.row.status === "dead") return friendly("Preview closed", "This preview was dismissed. Want to build a fresh one?");

  // Per-variant rejection: if THIS look was marked "not for me", close just it.
  const deadSet = new Set((rec.row.dead_variants || "").split(",").map((s) => s.trim()).filter(Boolean));
  if (deadSet.has(variant)) {
    const alive = VARIANT_KEYS.filter((k) => !deadSet.has(k));
    const others = alive.length
      ? `Your other designs are still here: ${alive.map((k) => `<a href="/preview/${id}/${k}">${k}</a>`).join(" · ")}`
      : "You've dismissed all three designs for this preview.";
    return friendly("You dismissed this design", others);
  }

  // Serve the AI-designed HTML. If not present, lazily generate THIS variant
  // inside the request (an HTTP request has unlimited wall time while the client
  // is connected, unlike waitUntil's 30s cap). A short R2 lock prevents two
  // concurrent viewers from both firing a Claude call for the same variant.
  let page = null;
  try { page = await getPreviewHtml(env, id, variant); } catch (_) {}

  if (!page) {
    if (!rec.model) return buildingPage(id, variant);
    let gotLock = false;
    try { gotLock = await acquireBuildLock(env, id, variant); } catch (_) {}
    if (!gotLock) return buildingPage(id, variant); // another request is building it

    try {
      const doc = await designVariant(env, rec.model, variant);
      if (doc) { await putPreviewHtml(env, id, variant, doc); page = doc; }
    } catch (_) { /* fall through to building page */ }
    finally { await releaseBuildLock(env, id, variant); }

    if (!page) return buildingPage(id, variant); // generation failed; retry on refresh
  }

  const injected = page.replace(/<\/body>/i, modalsHtml(id, variant) + "</body>");
  return html(injected);
}
