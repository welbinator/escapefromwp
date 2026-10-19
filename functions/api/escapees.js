// Cloudflare Pages Function — GET /api/escapees
// Returns APPROVED, non-spam escapee submissions for the public escapees page.
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" };

export async function onRequestGet({ env }) {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, business_name, website_url, rescued_url, story, case_study_url, thumb_key, og_image, prisoner_no, approved_at
         FROM ec_escapee_submissions
        WHERE status = 'approved' AND is_spam = 0
        ORDER BY approved_at ASC, id ASC`
    ).all();

    const escapees = (results || []).map((r) => ({
      id: r.id,
      name: r.business_name,
      url: r.website_url,
      rescued_url: r.rescued_url || null,
      story: r.story || "",
      case_study_url: r.case_study_url || null,
      prisoner_no: r.prisoner_no || String(r.id).padStart(4, "0"),
      image: r.thumb_key ? `/escapee-thumb/${r.thumb_key.replace(/^thumbs\//, "")}` : (r.og_image || null),
    }));

    return new Response(JSON.stringify({ ok: true, escapees }), { headers: JSON_HEADERS });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, escapees: [] }), { status: 500, headers: JSON_HEADERS });
  }
}
