const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const { TIERS, groupTier, sortHikes, validateHike } = require('./lib/tiers');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Visitors with no Homeroom account ("guests") may look around this app at
// its own address, read-only (every public app). The platform marks
// them with a token of their own: ES256, signed by a key of its own (its
// public half is USERNODE_GUEST_JWT_PUBLIC_KEY), this audience, `pur:
// 'guest'`, `guest: true`, and no id or username. Such a visitor is
// `req.guest`, never `req.user`, and every write they try is answered 401
// `account_required`, which the bridge turns into "Make an account to
// continue".
const GUEST_AUDIENCE = APP_AUDIENCE ? APP_AUDIENCE + ':guest' : null;
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// "Now" for this request, as a Date: `req.now`, set for every request by
// the middleware below. Read the day and the time through it (and
// `usernode.now()` in the page), never `new Date()` or SQL's NOW(),
// wherever they decide what shows: a reminder, a rota, a deadline.
// Production always gets the real time. A staging preview may be shown as of
// a chosen moment: the platform opens it with `?un-now=<ISO time>`, and the
// page sends `usernode.now()` on as the `x-usernode-now` header. Only a
// staging container reads either. See "Time-dependent features" in the
// platform conventions.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const PREVIEW_NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
  const raw = IS_STAGING ? (req.headers['x-usernode-now'] || req.query['un-now']) : null;
  return typeof raw === 'string' && PREVIEW_NOW.test(raw) ? new Date(raw) : new Date();
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  req.now = requestNow(req);
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }
  if (!req.user && token && GUEST_PUBLIC_KEY && GUEST_AUDIENCE) {
    try {
      const guest = jwt.verify(token, GUEST_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: GUEST_AUDIENCE,
      });
      if (guest && guest.pur === 'guest' && guest.guest === true) req.guest = true;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet. A guest may READ: every GET,
  // `/api/*` included, so read routes must not assume req.user (use
  // `req.user ? req.user.id : null`). Every write needs an account.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user && req.guest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(401).json({ error: 'account_required' });
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── Schema ───────────────────────────────────────────────────────────────
// All tables are public: group content and usernames only.
const DEMO_IDS = ['demo-alder', 'demo-birch', 'demo-juniper', 'demo-maple', 'demo-sorrel', 'demo-willow'];

async function bootSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS hikes (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      added_by_id TEXT NOT NULL,
      added_by_username TEXT NOT NULL,
      demo BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL
    )`);
  // Case-insensitive shared-name rule, per demo mode (demo names live in
  // their own namespace, so they cannot collide with real ones).
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS hikes_name_key
    ON hikes (demo, lower(name))`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tier_votes (
      hike_id INT NOT NULL REFERENCES hikes(id),
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      tier CHAR(1) NOT NULL CHECK (tier IN ('S','A','B','C','D')),
      updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (hike_id, user_id)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS demo_viewers (
      user_id TEXT PRIMARY KEY,
      seeded_at TIMESTAMPTZ NOT NULL
    )`);
}

// Shared-name rule: capitals and outer spaces ignored → 409 duplicate.
function isDuplicateName(err) {
  return err && err.code === '23505';
}

// Shape one hike row (plus its votes) the way /api/state returns them.
function shapeHike(hike, votes, me) {
  const counts = { S: 0, A: 0, B: 0, C: 0, D: 0 };
  let total = 0;
  let mine = null;
  for (const v of votes) {
    counts[v.tier] += 1;
    total += 1;
    if (me && v.user_id === me.id) mine = v.tier;
  }
  return {
    id: hike.id,
    name: hike.name,
    note: hike.note,
    addedBy: hike.added_by_username,
    createdAt: hike.created_at,
    counts,
    total,
    mine,
    groupTier: groupTier(counts),
  };
}

// Demo mode: staging previews opened with ?demo=1 show the made-up hikes.
const wantDemo = (req) => IS_STAGING && req.query.demo === '1';

// Load every hike of the request's mode with its votes, shaped and sorted.
async function loadState(req, me) {
  const demo = wantDemo(req);
  const { rows: hikes } = await pool.query(
    `SELECT * FROM hikes WHERE demo = $1 ORDER BY id`,
    [demo]
  );
  const { rows: votes } = await pool.query(
    `SELECT hike_id, user_id, username, tier FROM tier_votes
     WHERE hike_id = ANY($1::int[])`,
    [hikes.map((h) => h.id)]
  );
  const byHike = new Map();
  for (const h of hikes) byHike.set(h.id, []);
  for (const v of votes) {
    if (byHike.has(v.hike_id)) byHike.get(v.hike_id).push(v);
  }
  const shaped = sortHikes(hikes.map((h) => shapeHike(h, byHike.get(h.id) || [], me)));
  const voters = new Set();
  for (const v of votes) voters.add(v.user_id);
  return { me: me ? { id: me.id, username: me.username } : null, hikes: shaped, voters: voters.size, demo };
}

// Fetch one hike of the request's mode, shaped. null when missing.
async function loadHike(req, me, id) {
  const { rows } = await pool.query(
    `SELECT * FROM hikes WHERE id = $1 AND demo = $2`,
    [id, wantDemo(req)]
  );
  if (!rows.length) return null;
  const { rows: votes } = await pool.query(
    `SELECT hike_id, user_id, username, tier FROM tier_votes WHERE hike_id = $1`,
    [id]
  );
  return shapeHike(rows[0], votes, me);
}

// ── API ──────────────────────────────────────────────────────────────────

app.get('/api/state', async (req, res) => {
  try {
    const me = req.user ? { id: req.user.id, username: req.user.username } : null;
    const state = await loadState(req, me);
    // First visit to the demo: give the viewer their own votes so the
    // preview shows a personal sort. A row in demo_viewers records that the
    // seeding ran once, so the viewer's own edits are never overwritten.
    if (state.demo && req.user) {
      const seeded = await pool.query(
        `INSERT INTO demo_viewers (user_id, seeded_at) VALUES ($1, $2)
         ON CONFLICT (user_id) DO NOTHING RETURNING user_id`,
        [req.user.id, req.now]
      );
      if (seeded.rowCount) {
        const picks = [
          [900001, 'S'], [900002, 'S'], [900003, 'A'], [900004, 'A'],
          [900006, 'B'], [900007, 'C'], [900009, 'C'], [900010, 'B'],
          [900012, 'D'], [900013, 'D'],
        ];
        for (const [hikeId, tier] of picks) {
          await pool.query(
            `INSERT INTO tier_votes (hike_id, user_id, username, tier, updated_at)
             VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
            [hikeId, req.user.id, req.user.username, tier, req.now]
          );
        }
        Object.assign(state, await loadState(req, me));
      }
    }
    res.json(state);
  } catch (err) {
    console.error('GET /api/state failed: ' + err.message);
    res.status(500).json({ error: 'load_failed' });
  }
});

app.post('/api/hikes', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'account_required' });
  const check = validateHike(req.body);
  if (!check.ok) return res.status(400).json({ error: check.error });
  const demo = wantDemo(req);
  try {
    const created = await pool.query(
      `INSERT INTO hikes (name, note, added_by_id, added_by_username, demo, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [check.name, check.note, req.user.id, req.user.username, demo, req.now]
    );
    const id = created.rows[0].id;
    if (check.tier) {
      await pool.query(
        `INSERT INTO tier_votes (hike_id, user_id, username, tier, updated_at)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [id, req.user.id, req.user.username, check.tier, req.now]
      );
    }
    res.status(201).json(await loadHike(req, req.user, id));
  } catch (err) {
    if (isDuplicateName(err)) {
      return res.status(409).json({ error: 'duplicate', name: check.name });
    }
    console.error('POST /api/hikes failed: ' + err.message);
    res.status(500).json({ error: 'save_failed' });
  }
});

app.put('/api/hikes/:id/vote', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'account_required' });
  const tier = req.body ? req.body.tier : null;
  if (!TIERS.includes(tier)) return res.status(400).json({ error: 'bad_tier' });
  const id = Number(req.params.id);
  try {
    // The hike must exist in this request's demo mode.
    const owner = await pool.query(
      `SELECT id FROM hikes WHERE id = $1 AND demo = $2`,
      [id, wantDemo(req)]
    );
    if (!owner.rowCount) return res.status(404).json({ error: 'not_found' });
    await pool.query(
      `INSERT INTO tier_votes (hike_id, user_id, username, tier, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (hike_id, user_id)
       DO UPDATE SET tier = $4, username = $3, updated_at = $5`,
      [id, req.user.id, req.user.username, tier, req.now]
    );
    res.json(await loadHike(req, req.user, id));
  } catch (err) {
    console.error('PUT vote failed: ' + err.message);
    res.status(500).json({ error: 'save_failed' });
  }
});

app.delete('/api/hikes/:id/vote', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'account_required' });
  const id = Number(req.params.id);
  try {
    const owner = await pool.query(
      `SELECT id FROM hikes WHERE id = $1 AND demo = $2`,
      [id, wantDemo(req)]
    );
    if (!owner.rowCount) return res.status(404).json({ error: 'not_found' });
    await pool.query(
      `DELETE FROM tier_votes WHERE hike_id = $1 AND user_id = $2`,
      [id, req.user.id]
    );
    res.json(await loadHike(req, req.user, id));
  } catch (err) {
    console.error('DELETE vote failed: ' + err.message);
    res.status(500).json({ error: 'save_failed' });
  }
});

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user && !req.guest) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/hiking-tier-list-cf73c3/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/hiking-tier-list-cf73c3/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function start() {
  await bootSchema();
  if (IS_STAGING) await seedStagingDemo();
  const server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;

  // Stop accepting, drain what is in flight, then close the pool.
  let closing = false;
  async function shutdown(signal) {
    if (closing) return;
    closing = true;
    console.log(`${signal}: draining…`);
    server.close();
    setTimeout(() => pool.end().then(() => process.exit(0)), 3000).unref();
    try {
      await new Promise((resolve) => server.close(resolve));
      await pool.end();
      process.exit(0);
    } catch (err) {
      console.error('shutdown failed: ' + err.message);
      process.exit(1);
    }
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// Made-up hikes and hikers for the staging preview (?demo=1), per the spec's
// staging-demo section. Idempotent; a no-op outside staging.
async function seedStagingDemo() {
  const fake = DEMO_IDS;
  const hikes = [
    [900001, 'Granite Notch Summit', 'Steep last mile, huge view at the top'],
    [900002, 'Lantern Peak', 'Go for sunrise'],
    [900003, 'Mossback Creek Gorge', 'Wet feet guaranteed'],
    [900004, 'Sunset Bluff Overlook', 'Short, best at golden hour'],
    [900005, 'Fern Hollow Falls', 'Waterfall at the halfway point'],
    [900006, 'Otter Lake Loop', 'Flat loop around the lake'],
    [900007, 'Whistling Cedar Path', 'Windy along the ridge'],
    [900008, 'Copper Leaf Canyon', 'Best in autumn'],
    [900009, 'Bluebell Meadow Trail', 'Wildflowers in May'],
    [900010, 'Heron Marsh Boardwalk', 'Bring binoculars'],
    [900011, 'Quarry Pond Stroll', 'An easy afternoon'],
    [900012, 'Switchback Hill', 'Forty switchbacks, no view'],
    [900013, 'Crooked Pine Ridge', 'Overgrown after the bridge'],
    [900014, 'Owl Hollow Spur', 'Just added, nobody has tried it'],
  ];
  for (let i = 0; i < hikes.length; i++) {
    const [id, name, note] = hikes[i];
    const user = fake[i % fake.length];
    await pool.query(
      `INSERT INTO hikes (id, name, note, added_by_id, added_by_username, demo, created_at)
       VALUES ($1, $2, $3, $4, $5, true, to_timestamp(0)) ON CONFLICT DO NOTHING`,
      [id, name, note, 'staging-' + user, user]
    );
  }
  // Fake votes per hike, one row per (hike, fake hiker): S, A, B, C, D counts.
  const votePlan = [
    [900001, [5, 1, 0, 0, 0]],
    [900002, [3, 2, 1, 0, 0]],
    [900003, [1, 4, 1, 0, 0]],
    [900004, [2, 3, 1, 0, 0]],
    [900005, [2, 3, 0, 0, 0]],
    [900006, [0, 2, 3, 1, 0]],
    [900007, [0, 1, 3, 2, 0]],
    [900008, [0, 1, 2, 0, 0]],
    [900009, [0, 0, 1, 4, 1]],
    [900010, [0, 1, 1, 3, 0]],
    [900011, [0, 0, 0, 2, 1]],
    [900012, [0, 0, 0, 1, 4]],
    [900013, [0, 0, 1, 1, 3]],
  ];
  let n = 0;
  for (const [hikeId, counts] of votePlan) {
    for (let t = 0; t < 5; t++) {
      for (let c = 0; c < counts[t]; c++) {
        const user = fake[n % fake.length];
        await pool.query(
          `INSERT INTO tier_votes (hike_id, user_id, username, tier, updated_at)
           VALUES ($1, $2, $3, $4, to_timestamp(0)) ON CONFLICT DO NOTHING`,
          [hikeId, 'staging-' + user, user, TIERS[t]]
        );
        n++;
      }
    }
  }
}

start().catch(err => { console.error(err); process.exit(1); });
