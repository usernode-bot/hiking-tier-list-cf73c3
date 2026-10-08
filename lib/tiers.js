// Pure helpers for tier placement. Used by both server.js and public/app.js
// (app.js re-implements the calls it needs so the optimistic view matches the
// server's answer), so keep this file free of anything that needs Node.

const TIERS = ['S', 'A', 'B', 'C', 'D'];

// The tier with the most votes; a tie goes to the higher tier (first maximum
// scanning S to D). null when nobody has voted.
function groupTier(counts) {
  let best = null;
  let bestCount = 0;
  for (const tier of TIERS) {
    const n = counts[tier] || 0;
    if (n > bestCount) {
      best = tier;
      bestCount = n;
    }
  }
  return best;
}

// Order hikes within a view: by tier position of groupTier (unsorted last),
// then by the winning tier's count (agreement) descending, then total votes
// descending, then name.
function sortHikes(hikes) {
  const pos = (t) => (t ? TIERS.indexOf(t) : TIERS.length);
  const key = (h) => {
    const gt = h.groupTier;
    const winning = gt ? (h.counts[gt] || 0) : 0;
    return [pos(gt), -winning, -(h.total || 0)];
  };
  return hikes.slice().sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < 3; i++) {
      if (ka[i] !== kb[i]) return ka[i] - kb[i];
    }
    return a.name.localeCompare(b.name);
  });
}

// Validate and normalise a new-hike body. Returns
// { ok: true, name, note, tier } or { ok: false, error }.
function validateHike(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'bad_body' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!name) return { ok: false, error: 'empty_name' };
  if (name.length > 80) return { ok: false, error: 'name_too_long' };
  if (note.length > 200) return { ok: false, error: 'note_too_long' };
  const tier = body.tier == null ? null : body.tier;
  if (tier !== null && !TIERS.includes(tier)) return { ok: false, error: 'bad_tier' };
  return { ok: true, name, note, tier };
}

module.exports = { TIERS, groupTier, sortHikes, validateHike };
