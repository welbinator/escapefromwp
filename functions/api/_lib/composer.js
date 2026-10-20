// Composer — decides WHICH blocks appear and in WHAT order, from the content
// signals we detected. Deterministic/rules-based today; outputs a JSON plan
// (array of {type, data}). An AI composer can later emit the SAME plan shape for
// smarter choices — the renderer never changes, so AI can't break layout.
//
// A "plan" is just an ordered list of block specs. The renderer walks it.

export function composePlan(model, detections) {
  const d = detections || {};
  const plan = [];
  const push = (type, data) => plan.push({ type, data });

  // 1) Hero is always first (data comes from the model, not detections).
  push("hero", null);

  // Decide a primary "what we offer" block: services if we found them, else the
  // model's feature cards. Prefer featureSplit when items have images (richer),
  // else a card grid.
  const services = d.services || (model.features?.length >= 3 ? model.features : null);
  if (services && services.length >= 3) {
    const withImgs = services.filter((s) => s.image).length;
    if (withImgs >= 2) push("featureSplit", services.slice(0, 4));
    else push("services", services.slice(0, 6));
  } else if (model.features?.length) {
    push("cardGrid", model.features.slice(0, 6));
  }

  // 2) Visual proof: gallery → carousel (many images) based on count/variety.
  if (d.gallery && d.gallery.images.length >= 6) push("carousel", d.gallery);
  else if (d.gallery && d.gallery.images.length >= 4) push("gallery", d.gallery);

  // 3) Timeline / story.
  if (d.timeline) push("timeline", d.timeline);

  // 4) Stats band — synthesize ONLY from real signals (never fabricate numbers).
  const stats = realStats(model, d);
  if (stats.length >= 3) push("statBand", stats);

  // 5) Team.
  if (d.team) push("team", d.team);

  // 6) Social proof.
  if (d.testimonials) push("testimonials", d.testimonials);

  // 7) Video.
  if (d.videos) push("video", d.videos);

  // 8) Pricing.
  if (d.pricing) push("pricing", d.pricing);

  // 9) Blog/post list (only if there are real posts and we have room).
  if (model.posts?.length >= 3) push("postList", model.posts);

  // 10) FAQ.
  if (d.faqs) push("faqs", d.faqs);

  // 11) Contact (with map if we found an address). Always present so the
  // nav/hero "#contact" CTAs always have a target; shows graceful copy if empty.
  push("contact", d.contact || {});

  // 12) Closing CTA band always last.
  push("ctaBand", null);

  // Safety: if the body is thin (just hero + cta), pad with whatever we have so
  // the preview never looks empty.
  if (plan.length <= 3 && model.posts?.length) {
    plan.splice(plan.length - 1, 0, { type: "postList", data: model.posts });
  }
  return plan;
}

// Only emit stats we can truthfully derive — never invent numbers.
function realStats(model, d) {
  const out = [];
  if (model.post_count >= 5) out.push({ value: String(model.post_count) + "+", label: "Articles published" });
  if (d.team?.length) out.push({ value: String(d.team.length), label: "Team members" });
  if (d.testimonials?.length) out.push({ value: String(d.testimonials.length) + "+", label: "Happy clients" });
  if (d.gallery?.images?.length) out.push({ value: String(d.gallery.images.length) + "+", label: "Projects shown" });
  if (model.page_count >= 5) out.push({ value: String(model.page_count), label: "Pages of content" });
  return out.slice(0, 4);
}
