const test = require('node:test');
const assert = require('node:assert');
const { TIERS, groupTier, sortHikes, validateHike } = require('../lib/tiers');

const counts = (s, a, b, c, d) => ({ S: s, A: a, B: b, C: c, D: d });

test('TIERS is S through D in order', () => {
  assert.deepEqual(TIERS, ['S', 'A', 'B', 'C', 'D']);
});

test('groupTier: zero votes gives null', () => {
  assert.equal(groupTier(counts(0, 0, 0, 0, 0)), null);
});

test('groupTier: a clear winner', () => {
  assert.equal(groupTier(counts(1, 4, 1, 0, 0)), 'A');
});

test('groupTier: a two-way tie goes to the higher tier', () => {
  assert.equal(groupTier(counts(0, 3, 0, 3, 0)), 'A'); // A ties C: A wins
  assert.equal(groupTier(counts(0, 0, 2, 2, 0)), 'B'); // B ties C: B wins
});

test('groupTier: all equal goes to S', () => {
  assert.equal(groupTier(counts(1, 1, 1, 1, 1)), 'S');
});

test('sortHikes: tier order, unsorted last', () => {
  const hikes = [
    { name: 'Z', groupTier: null, counts: counts(0, 0, 0, 0, 0), total: 0 },
    { name: 'M', groupTier: 'C', counts: counts(0, 0, 0, 2, 0), total: 2 },
    { name: 'A', groupTier: 'S', counts: counts(5, 0, 0, 0, 0), total: 5 },
    { name: 'B', groupTier: 'A', counts: counts(0, 3, 0, 0, 0), total: 3 },
  ];
  assert.deepEqual(sortHikes(hikes).map((h) => h.name), ['A', 'B', 'M', 'Z']);
});

test('sortHikes: agreement, then total, then name', () => {
  const hikes = [
    // Same tier, same agreement: more total votes first.
    { name: 'Few', groupTier: 'S', counts: counts(2, 0, 1, 0, 0), total: 3 },
    { name: 'Many', groupTier: 'S', counts: counts(2, 1, 1, 0, 0), total: 4 },
    // Same tier, more agreement first.
    { name: 'Agree', groupTier: 'S', counts: counts(4, 0, 0, 0, 0), total: 4 },
    // Same tier, same agreement, same total: alphabetical.
    { name: 'Beta', groupTier: 'S', counts: counts(1, 0, 0, 0, 0), total: 1 },
    { name: 'Alpha', groupTier: 'S', counts: counts(1, 0, 0, 0, 0), total: 1 },
  ];
  assert.deepEqual(sortHikes(hikes).map((h) => h.name),
    ['Agree', 'Many', 'Few', 'Alpha', 'Beta']);
});

test('sortHikes does not mutate its input', () => {
  const hikes = [
    { name: 'B', groupTier: 'A', counts: counts(0, 1, 0, 0, 0), total: 1 },
    { name: 'A', groupTier: 'S', counts: counts(1, 0, 0, 0, 0), total: 1 },
  ];
  sortHikes(hikes);
  assert.equal(hikes[0].name, 'B');
});

test('validateHike: trims and accepts a good body', () => {
  assert.deepEqual(validateHike({ name: '  Eagle Rock  ', note: ' view ', tier: 'B' }),
    { ok: true, name: 'Eagle Rock', note: 'view', tier: 'B' });
  assert.deepEqual(validateHike({ name: 'Eagle Rock' }),
    { ok: true, name: 'Eagle Rock', note: '', tier: null });
});

test('validateHike: empty or missing name', () => {
  assert.equal(validateHike({}).ok, false);
  assert.equal(validateHike({ name: '   ' }).ok, false);
  assert.equal(validateHike(null).ok, false);
});

test('validateHike: length limits', () => {
  assert.equal(validateHike({ name: 'x'.repeat(81) }).ok, false);
  assert.equal(validateHike({ name: 'x'.repeat(80) }).ok, true);
  assert.equal(validateHike({ name: 'ok', note: 'y'.repeat(201) }).ok, false);
  assert.equal(validateHike({ name: 'ok', note: 'y'.repeat(200) }).ok, true);
});

test('validateHike: bad tier', () => {
  assert.equal(validateHike({ name: 'ok', tier: 'F' }).ok, false);
  assert.equal(validateHike({ name: 'ok', tier: 's' }).ok, false);
  assert.equal(validateHike({ name: 'ok', tier: '' }).ok, false);
});
