// Sends the "your content is ready" email via Brevo (transactional API).
// From james@apexbranding.design (a verified Brevo sender) until EFW gets its own.

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function buildHtml({ siteName, downloadUrl, target, totalEntries, collections, notice }) {
  const targetLabel = target === "emdash" ? "EmDash" : "your chosen CMS";
  const rows = (collections || [])
    .map(
      (c) =>
        `<tr><td style="padding:6px 0;border-bottom:1px solid #eee;color:#444;font-size:14px">${escapeHtml(c.label)}</td>
         <td style="padding:6px 0;border-bottom:1px solid #eee;color:#111;font-size:14px;text-align:right;font-weight:600">${c.entries}</td></tr>`
    )
    .join("");
  const noticeBlock = notice
    ? `<p style="background:#fff8e6;border-left:3px solid #e6b800;padding:10px 14px;color:#7a5c00;font-size:13px;margin:16px 0">⚠️ ${escapeHtml(notice)}</p>`
    : "";

  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden">
    <tr><td style="background:#0b0405;padding:24px 28px">
      <span style="font-family:'Courier New',monospace;font-weight:700;font-size:16px;letter-spacing:1px;color:#ffffff">ESCAPE&nbsp;FROM&nbsp;<span style="color:#e32735">WP</span></span>
    </td></tr>
    <tr><td style="padding:30px 28px">
      <h1 style="font-size:22px;color:#111;margin:0 0 6px">Your content is liberated. 🔓</h1>
      <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 20px">
        We pulled the content from <strong>${escapeHtml(siteName)}</strong> and packaged it into an
        AI-ready bundle you can hand straight to a coding agent to rebuild in ${targetLabel}.
      </p>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 8px">
        ${rows}
        <tr><td style="padding:10px 0 0;color:#0a7d2c;font-size:14px;font-weight:600">Total extracted</td>
            <td style="padding:10px 0 0;color:#0a7d2c;font-size:14px;font-weight:700;text-align:right">${totalEntries} entries</td></tr>
      </table>
      ${noticeBlock}

      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 8px">
        <tr><td style="background:#e32735;border-radius:4px">
          <a href="${downloadUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none">⬇ Download your content bundle</a>
        </td></tr>
      </table>

      <p style="color:#999;font-size:12px;line-height:1.6;margin:14px 0 0">
        This link works for <strong>24 hours</strong>, then the file is permanently deleted —
        we don't keep copies of your content. If it expires, just
        <a href="https://escapefromwp.com/liberate" style="color:#0a7d2c">run the tool again</a>.
      </p>
      <p style="color:#bbb;font-size:12px;line-height:1.6;margin:10px 0 0">
        Inside the zip: your content as markdown, a content model for ${targetLabel}, and an
        <code>AGENT_INSTRUCTIONS.md</code> file that tells your AI agent exactly how to rebuild your site.
      </p>

      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#555;font-size:14px;line-height:1.6;margin:0">
        Want us to run the whole migration for you — design and all?
        <a href="https://escapefromwp.com/#breakout" style="color:#0a7d2c;font-weight:600">Plan your escape →</a>
      </p>
    </td></tr>
    <tr><td style="background:#faf9f8;padding:16px 28px;color:#999;font-size:11px;font-family:'Courier New',monospace">
      Escape From WP · WordPress migration &amp; rescue · escapefromwp.com
    </td></tr>
  </table>
</body></html>`;
}

export async function sendDownloadEmail(env, { to, siteName, downloadUrl, target, totalEntries, collections, notice }) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, error: "email not configured" };

  const payload = {
    sender: { name: "James @ Escape From WP", email: "james@apexbranding.design" },
    to: [{ email: to }],
    replyTo: { name: "James Welbes", email: "james@apexbranding.design" },
    subject: `🔓 Your content from ${siteName} is ready to download`,
    htmlContent: buildHtml({ siteName, downloadUrl, target, totalEntries, collections, notice }),
  };

  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `brevo ${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, messageId: data.messageId || null };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// -------- Preview-builder: email the visitor their 3 template links ----------

function buildPreviewHtml({ siteName, variants, totalEntries }) {
  const cards = (variants || []).map((v) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;border:1px solid #eee;border-radius:8px">
      <tr><td style="padding:16px 18px">
        <div style="font-size:16px;font-weight:700;color:#111">${escapeHtml(v.label)}</div>
        <div style="font-size:13px;color:#777;margin:2px 0 12px">${escapeHtml(v.blurb)}</div>
        <a href="${v.url}" style="display:inline-block;background:#0b0405;color:#fff;padding:11px 22px;border-radius:4px;font-size:14px;font-weight:600;text-decoration:none">View the ${escapeHtml(v.label)} version →</a>
      </td></tr>
    </table>`).join("");

  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;padding:24px;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden">
    <tr><td style="background:#0b0405;padding:24px 28px">
      <span style="font-family:'Courier New',monospace;font-weight:700;font-size:16px;letter-spacing:1px;color:#fff">ESCAPE&nbsp;FROM&nbsp;<span style="color:#e32735">WP</span></span>
    </td></tr>
    <tr><td style="padding:30px 28px">
      <h1 style="font-size:22px;color:#111;margin:0 0 6px">Your new site — 3 ways. 🎨</h1>
      <p style="color:#555;font-size:15px;line-height:1.6;margin:0 0 20px">
        We took the content from <strong>${escapeHtml(siteName)}</strong> (${totalEntries} items) and dropped it into
        three fresh designs. Open each one, see which feels right — no WordPress, no clutter, just your content looking good.
      </p>
      ${cards}
      <p style="color:#999;font-size:12px;line-height:1.6;margin:18px 0 0">
        On each preview you can tell us <em>“not for me”</em> or <em>“I like this one — let's talk.”</em>
        These links stay live for <strong>7 days</strong>.
      </p>
      <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
      <p style="color:#555;font-size:14px;line-height:1.6;margin:0">
        Like one? We'll finish it and host it for $49/mo.
        <a href="https://escapefromwp.com/#breakout" style="color:#0a7d2c;font-weight:600">Plan your escape →</a>
      </p>
    </td></tr>
    <tr><td style="background:#faf9f8;padding:16px 28px;color:#999;font-size:11px;font-family:'Courier New',monospace">
      Escape From WP · WordPress migration &amp; rescue · escapefromwp.com
    </td></tr>
  </table>
</body></html>`;
}

export async function sendPreviewLinksEmail(env, { to, siteName, variants, totalEntries }) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, error: "email not configured" };
  const payload = {
    sender: { name: "James @ Escape From WP", email: "james@apexbranding.design" },
    to: [{ email: to }],
    replyTo: { name: "James Welbes", email: "james@apexbranding.design" },
    subject: `🎨 3 new looks for ${siteName} — pick your favorite`,
    htmlContent: buildPreviewHtml({ siteName, variants, totalEntries }),
  };
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return { ok: false, error: `brevo ${res.status}: ${txt.slice(0, 200)}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, messageId: data.messageId || null };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// -------- Exact-replica mode: email the single replica link ------------------

export async function sendReplicaLinkEmail(env, { to, siteName, url, sourceUrl }) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, error: "email not configured" };
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#faf9f8;margin:0;padding:24px">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eee">
    <tr><td style="background:#0b0405;padding:22px 28px">
      <span style="color:#fff;font-weight:700;font-size:18px;letter-spacing:.5px">ESCAPE FROM <span style="color:#e32735">WP</span></span>
    </td></tr>
    <tr><td style="padding:28px">
      <h2 style="margin:0 0 10px;color:#111">Your site, rebuilt off WordPress.</h2>
      <p style="color:#555;line-height:1.6;margin:0 0 20px">We rebuilt <strong>${escapeHtml(siteName)}</strong> as a fast, self-contained site — same look, no WordPress, nothing phoning home to your old host. Take a look:</p>
      <p style="margin:0 0 22px"><a href="${url}" style="background:#4ee36b;color:#06230f;padding:13px 26px;border-radius:4px;text-decoration:none;font-weight:700;font-size:15px">View your rebuilt site →</a></p>
      <p style="color:#888;font-size:13px;line-height:1.6;margin:0 0 6px">This is a faithful visual copy of ${escapeHtml(sourceUrl || "your site")}. Want changes, extra pages, or to put it live on your own domain? Just reply to this email.</p>
    </td></tr>
    <tr><td style="background:#faf9f8;padding:16px 28px;color:#999;font-size:11px;font-family:'Courier New',monospace">
      Escape From WP · WordPress migration &amp; rescue · escapefromwp.com
    </td></tr>
  </table>
</body></html>`;
  const payload = {
    sender: { name: "James @ Escape From WP", email: "james@apexbranding.design" },
    to: [{ email: to }],
    replyTo: { name: "James Welbes", email: "james@apexbranding.design" },
    subject: `✅ ${siteName} — rebuilt off WordPress`,
    htmlContent: html,
  };
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { const txt = await res.text().catch(() => ""); return { ok: false, error: `brevo ${res.status}: ${txt.slice(0, 160)}` }; }
    const data = await res.json().catch(() => ({}));
    return { ok: true, messageId: data.messageId || null };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// -------- Preview-builder: notify James when a lead likes a variant ----------

export async function sendLeadLikedEmail(env, { siteName, variantLabel, variantUrl, leadName, leadEmail, leadMessage }) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, error: "email not configured" };
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:20px">
    <h2 style="margin:0 0 4px">🔥 New preview lead: ${escapeHtml(siteName)}</h2>
    <p style="color:#555;margin:0 0 16px">Someone liked the <strong>${escapeHtml(variantLabel)}</strong> version and wants to talk.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.7">
      <tr><td style="color:#888;padding-right:12px">Name</td><td><strong>${escapeHtml(leadName || "—")}</strong></td></tr>
      <tr><td style="color:#888;padding-right:12px">Email</td><td><a href="mailto:${escapeHtml(leadEmail)}">${escapeHtml(leadEmail || "—")}</a></td></tr>
      <tr><td style="color:#888;padding-right:12px;vertical-align:top">Message</td><td>${escapeHtml(leadMessage || "—")}</td></tr>
    </table>
    <p style="margin:18px 0 0"><a href="${variantUrl}" style="background:#0b0405;color:#fff;padding:11px 22px;border-radius:4px;text-decoration:none;font-weight:600">Open the preview they liked →</a></p>
  </body></html>`;
  const payload = {
    sender: { name: "Escape From WP", email: "james@apexbranding.design" },
    to: [{ email: "james.welbes@gmail.com" }],
    replyTo: { name: leadName || "Lead", email: leadEmail || "james@apexbranding.design" },
    subject: `🔥 Preview lead — ${siteName} liked the ${variantLabel} look`,
    htmlContent: html,
  };
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: `brevo ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, messageId: data.messageId || null };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// -------- Offer modal: YES → notify James a lead wants the $49/mo build ------

export async function sendOfferLeadEmail(env, { siteName, sourceUrl, replicaUrl, leadEmail, leadMessage }) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, error: "email not configured" };
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#111;max-width:560px;margin:0 auto;padding:20px">
    <h2 style="margin:0 0 4px">🔥 Site claim: ${escapeHtml(siteName)}</h2>
    <p style="color:#555;margin:0 0 16px">They saw their exact rebuilt site and want it live — <strong>no money down, $49/mo</strong> for unlimited updates. Follow up to close it.</p>
    <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.7">
      <tr><td style="color:#888;padding-right:12px">Email</td><td><a href="mailto:${escapeHtml(leadEmail)}">${escapeHtml(leadEmail || "—")}</a></td></tr>
      <tr><td style="color:#888;padding-right:12px">Original site</td><td>${escapeHtml(sourceUrl || "—")}</td></tr>
      <tr><td style="color:#888;padding-right:12px;vertical-align:top">Message</td><td>${escapeHtml(leadMessage || "—")}</td></tr>
    </table>
    <p style="margin:18px 0 0"><a href="${replicaUrl}" style="background:#0b0405;color:#fff;padding:11px 22px;border-radius:4px;text-decoration:none;font-weight:600">Open the rebuilt site they want →</a></p>
  </body></html>`;
  const payload = {
    sender: { name: "Escape From WP", email: "james@apexbranding.design" },
    to: [{ email: "james.welbes@gmail.com" }],
    replyTo: { name: "Lead", email: leadEmail || "james@apexbranding.design" },
    subject: `🔥 Site claim — ${siteName} wants the $49/mo build`,
    htmlContent: html,
  };
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { ok: false, error: `brevo ${res.status}` };
    const data = await res.json().catch(() => ({}));
    return { ok: true, messageId: data.messageId || null };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

// -------- Offer modal: NO → email the customer their EmDash site download -----

export async function sendZipEmail(env, { to, siteName, downloadUrl, target }) {
  const apiKey = env.BREVO_API_KEY;
  if (!apiKey) return { ok: false, error: "email not configured" };
  const isAstro = target === "astro";
  const label = isAstro ? "static Astro site" : "EmDash site";
  const blurb = isAstro
    ? `We packaged <strong>${escapeHtml(siteName)}</strong> as a ready-to-run <strong>static Astro</strong> project — your content baked in as Astro content collections, plus an exact copy of your original site to match the design, and step-by-step instructions your AI assistant can follow. No CMS, no database.`
    : `We packaged <strong>${escapeHtml(siteName)}</strong> as a ready-to-run EmDash + Astro project — your content baked in, plus an exact copy of your original site to match the design, and step-by-step instructions your AI assistant can follow.`;
  const html = `<!doctype html><html><body style="font-family:Arial,sans-serif;background:#faf9f8;margin:0;padding:24px">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #eee">
    <tr><td style="background:#0b0405;padding:22px 28px">
      <span style="color:#fff;font-weight:700;font-size:18px;letter-spacing:.5px">ESCAPE FROM <span style="color:#e32735">WP</span></span>
    </td></tr>
    <tr><td style="padding:28px">
      <h2 style="margin:0 0 10px;color:#111">Your ${label} is ready to download.</h2>
      <p style="color:#555;line-height:1.6;margin:0 0 20px">${blurb}</p>
      <p style="margin:0 0 22px"><a href="${downloadUrl}" style="background:#4ee36b;color:#06230f;padding:13px 26px;border-radius:4px;text-decoration:none;font-weight:700;font-size:15px">⬇ Download your ${label}</a></p>
      <p style="color:#888;font-size:13px;line-height:1.6;margin:0 0 6px">Unzip it, open <strong>README.md</strong>, and run <code>npm install</code> then <code>npm run dev</code>. This link is good for 24 hours. Changed your mind and want us to just build and host it for $49/mo? Reply to this email.</p>
    </td></tr>
    <tr><td style="background:#faf9f8;padding:16px 28px;color:#999;font-size:11px;font-family:'Courier New',monospace">
      Escape From WP &middot; WordPress migration &amp; rescue &middot; escapefromwp.com
    </td></tr>
  </table>
</body></html>`;
  const payload = {
    sender: { name: "James @ Escape From WP", email: "james@apexbranding.design" },
    to: [{ email: to }],
    replyTo: { name: "James Welbes", email: "james@apexbranding.design" },
    subject: `⬇ ${siteName} — your ${label} is ready`,
    htmlContent: html,
  };
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { const txt = await res.text().catch(() => ""); return { ok: false, error: `brevo ${res.status}: ${txt.slice(0, 160)}` }; }
    const data = await res.json().catch(() => ({}));
    return { ok: true, messageId: data.messageId || null };
  } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}
