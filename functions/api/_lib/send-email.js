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
