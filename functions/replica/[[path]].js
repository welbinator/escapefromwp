// GET /replica/<id> — serve the stored exact-replica mirror (with the offer modal
// injected), or a self-refreshing "building" page while the worker captures it.

function html(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function buildingPage() {
  return html(`<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="refresh" content="15">
  <title>Rebuilding your site…</title>
  <style>body{font-family:system-ui,sans-serif;background:#0b0405;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}
  .spin{width:40px;height:40px;border:3px solid #2b2b2b;border-top-color:#4ee36b;border-radius:50%;animation:s .8s linear infinite;margin:0 auto 22px}
  @keyframes s{to{transform:rotate(360deg)}}h1{font-size:1.5rem;margin:0 0 10px}p{color:#bbb;max-width:44ch;line-height:1.6;margin:0 auto}
  @media(prefers-reduced-motion:reduce){.spin{animation-duration:2.5s}}</style></head>
  <body><div><div class="spin"></div><h1>Rebuilding your site off WordPress.</h1>
  <p>We're capturing every page, image and font and rehosting it on fast infrastructure. This usually takes a minute or two. This page refreshes itself — or check the email we're sending you.</p></div></body></html>`, 200);
}

function notFound() {
  return html(`<!doctype html><html><head><meta charset="utf-8"><title>Not found</title>
  <style>body{font-family:system-ui,sans-serif;background:#0b0405;color:#fff;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px}a{color:#4ee36b}</style></head>
  <body><div><h1>Replica not found</h1><p style="color:#bbb">This may have expired — rebuilds are kept for 7 days.</p>
  <p><a href="https://escapefromwp.com/liberate">← Rebuild your site</a></p></div></body></html>`, 404);
}

// The floating "claim this site" offer, injected into every served replica.
// Self-contained: scoped styles + inline JS, no external deps. The preview id is
// baked in so the modal can call /api/replica-offer.
function offerMarkup(id) {
  return `
<style id="efw-offer-style">
  #efw-offer-bar,#efw-offer-modal *{box-sizing:border-box}
  #efw-offer-bar{position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:#0b0405;color:#fff;
    border-top:2px solid #4ee36b;font-family:system-ui,-apple-system,sans-serif;
    display:flex;align-items:center;justify-content:center;gap:18px;padding:12px 18px;flex-wrap:wrap;box-shadow:0 -6px 24px rgba(0,0,0,.4)}
  #efw-offer-bar .efw-bar-txt{font-size:14px;line-height:1.4;max-width:620px}
  #efw-offer-bar .efw-bar-txt b{color:#4ee36b}
  #efw-offer-bar button{font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;border:0;padding:11px 18px;border-radius:6px;white-space:nowrap}
  #efw-offer-open{background:#4ee36b;color:#06230f}
  #efw-offer-dismiss{background:transparent;color:#9a9490;border:1px solid #2a2320;font-weight:500}
  #efw-offer-modal{position:fixed;inset:0;z-index:2147483100;background:rgba(5,2,3,.78);backdrop-filter:blur(4px);
    display:none;align-items:center;justify-content:center;padding:20px;font-family:system-ui,-apple-system,sans-serif}
  #efw-offer-modal.open{display:flex}
  #efw-offer-card{background:#120a0b;border:1px solid #2a2320;border-radius:12px;max-width:470px;width:100%;
    padding:30px 26px;color:#e8e6e3;box-shadow:0 20px 60px rgba(0,0,0,.6);max-height:92vh;overflow:auto}
  #efw-offer-card h2{margin:0 0 10px;font-size:22px;color:#fff;line-height:1.25}
  #efw-offer-card .efw-price{color:#4ee36b;font-weight:700}
  #efw-offer-card p{color:#bbb;line-height:1.6;font-size:14px;margin:0 0 18px}
  #efw-offer-card .efw-btn{display:block;width:100%;font-family:inherit;font-size:15px;font-weight:600;cursor:pointer;
    border:0;padding:14px;border-radius:7px;margin-top:10px}
  #efw-yes{background:#4ee36b;color:#06230f}
  #efw-no{background:transparent;color:#cfcac6;border:1px solid #2a2320;font-weight:500}
  #efw-offer-card .efw-close{float:right;background:none;border:0;color:#6c6460;font-size:22px;cursor:pointer;line-height:1;margin:-6px -6px 0 0}
  #efw-offer-msg{margin-top:16px;font-size:14px;line-height:1.6}
  #efw-offer-msg.ok{color:#4ee36b}#efw-offer-msg.err{color:#ff6b6b}
  #efw-offer-card input,#efw-offer-card textarea{width:100%;background:#0b0405;border:1px solid #2a2320;color:#fff;
    border-radius:6px;padding:11px;font-family:inherit;font-size:14px;margin-top:8px}
  #efw-offer-card .efw-sub{font-size:12px;color:#8a837f;margin:14px 0 0}
  @media(prefers-reduced-motion:no-preference){#efw-offer-card{animation:efwpop .18s ease-out}@keyframes efwpop{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}}
</style>
<div id="efw-offer-bar">
  <span class="efw-bar-txt">Like what you see? <b>Get this exact site live</b> — no money down.</span>
  <button id="efw-offer-open">See the offer</button>
  <button id="efw-offer-dismiss" aria-label="Dismiss">✕</button>
</div>
<div id="efw-offer-modal" role="dialog" aria-modal="true" aria-labelledby="efw-offer-h">
  <div id="efw-offer-card">
    <button class="efw-close" id="efw-offer-x" aria-label="Close">×</button>
    <div id="efw-offer-step1">
      <h2 id="efw-offer-h">Want this site for <span class="efw-price">no money down</span> and <span class="efw-price">$49/mo</span> for unlimited updates?</h2>
      <p>We'll put this exact design on your own domain, off WordPress, and handle your updates for you. No setup fee, cancel anytime.</p>
      <button class="efw-btn" id="efw-yes">Yes! Let's do it</button>
      <button class="efw-btn" id="efw-no">No thanks — just send me a zip</button>
      <p class="efw-sub">Prefer the DIY route? We'll email you a ready-to-run EmDash project built from your site.</p>
    </div>
    <div id="efw-offer-step-yes" style="display:none">
      <h2>Great — let's get you set up.</h2>
      <p>Drop a note if you'd like (optional) and we'll follow up at the email you used. That's it.</p>
      <textarea id="efw-yes-msg" rows="3" placeholder="Anything you want us to know? (optional)"></textarea>
      <button class="efw-btn" id="efw-yes-send">Send — I'm in</button>
      <div id="efw-offer-msg"></div>
    </div>
  </div>
</div>
<script>
(function(){
  var ID=${JSON.stringify(id)};
  var bar=document.getElementById('efw-offer-bar');
  var modal=document.getElementById('efw-offer-modal');
  var step1=document.getElementById('efw-offer-step1');
  var stepYes=document.getElementById('efw-offer-step-yes');
  var msg=document.getElementById('efw-offer-msg');
  function open(){modal.classList.add('open');}
  function close(){modal.classList.remove('open');}
  document.getElementById('efw-offer-open').onclick=open;
  document.getElementById('efw-offer-x').onclick=close;
  document.getElementById('efw-offer-dismiss').onclick=function(){bar.style.display='none';};
  modal.addEventListener('click',function(e){if(e.target===modal)close();});
  function post(body){return fetch('https://escapefromwp.com/api/replica-offer',{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({id:ID},body))}).then(function(r){return r.json();});}
  document.getElementById('efw-yes').onclick=function(){step1.style.display='none';stepYes.style.display='block';};
  document.getElementById('efw-yes-send').onclick=function(){
    var btn=this;btn.disabled=true;msg.className='';msg.textContent='Sending…';
    post({choice:'yes',message:(document.getElementById('efw-yes-msg').value||'').slice(0,2000)}).then(function(d){
      if(d&&d.ok){msg.className='ok';msg.textContent="✓ You're in! We'll be in touch at your email shortly to get this live.";}
      else{msg.className='err';msg.textContent='Something went wrong — please email james@apexbranding.design and we\\'ll sort it.';btn.disabled=false;}
    }).catch(function(){msg.className='err';msg.textContent='Network error — please try again.';btn.disabled=false;});
  };
  document.getElementById('efw-no').onclick=function(){
    step1.style.display='none';stepYes.style.display='block';
    document.querySelector('#efw-offer-step-yes h2').textContent='No problem — building your EmDash site.';
    document.querySelector('#efw-offer-step-yes p').textContent="We're packaging a ready-to-run EmDash project from your site and emailing it to you. It'll land in a few minutes.";
    document.getElementById('efw-yes-msg').style.display='none';
    var sb=document.getElementById('efw-yes-send');sb.style.display='none';
    msg.className='';msg.textContent='Starting your export…';
    post({choice:'no'}).then(function(d){
      if(d&&d.ok){msg.className='ok';msg.textContent="✓ On its way. Check your inbox in a few minutes for your EmDash site download.";}
      else{msg.className='err';msg.textContent=(d&&d.error)||'Something went wrong — please try again.';}
    }).catch(function(){msg.className='err';msg.textContent='Network error — please try again.';});
  };
})();
</script>`;
}

export async function onRequestGet({ params, env }) {
  const id = (params.path && params.path[0] || "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(id)) return notFound();
  if (!env.DB || !env.EXPORTS) return notFound();

  const row = await env.DB.prepare(`SELECT status FROM ec_previews WHERE id=?`).bind(id).first();
  if (!row) return notFound();
  if (row.status === "dead") return notFound();

  const obj = await env.EXPORTS.get(`previews/${id}/replica.html`);
  if (!obj) return buildingPage();

  // Inject the offer modal just before </body> (fall back to append).
  let page = await obj.text();
  const inject = offerMarkup(id);
  if (/<\/body>/i.test(page)) page = page.replace(/<\/body>/i, inject + "</body>");
  else page += inject;

  return new Response(page, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}
