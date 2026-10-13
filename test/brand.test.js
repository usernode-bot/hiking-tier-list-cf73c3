const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

const pngSize = (file) => {
  const buf = fs.readFileSync(file);
  assert.ok(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${file} is a PNG`);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
};

test('manifest declares the icon image and keeps the emoji fallback', () => {
  const dapp = JSON.parse(fs.readFileSync(path.join(ROOT, 'dapp.json'), 'utf8'));
  assert.equal(dapp.icon.image, 'brand/icon.png');
  assert.equal(dapp.icon.emoji, '🥾');
});

test('app icon is a 1024x1024 PNG of 256 KB or less', () => {
  const { width, height, bytes } = pngSize(path.join(ROOT, 'brand', 'icon.png'));
  assert.equal(width, 1024);
  assert.equal(height, 1024);
  assert.ok(bytes <= 256 * 1024, `icon is ${bytes} bytes`);
});

test('featured pictures exist in light and dark at 1600x900', () => {
  for (const name of ['featured-light.png', 'featured-dark.png']) {
    const { width, height } = pngSize(path.join(ROOT, 'brand', name));
    assert.equal(width, 1600, `${name} width`);
    assert.equal(height, 900, `${name} height`);
  }
});

test('brand SVGs use only Homeroom palette colours, no text, gradients or filters', () => {
  const allowed = new Set(['fffeea', 'ffee6f', '3090e1', 'a9cf97', 'ffffff', 'fcfab3', '000000', 'b9b9b9']);
  const svgs = fs.readdirSync(path.join(ROOT, 'brand')).filter((f) => f.endsWith('.svg'));
  assert.ok(svgs.length >= 3, 'the SVG sources are committed');
  for (const name of svgs) {
    const svg = fs.readFileSync(path.join(ROOT, 'brand', name), 'utf8');
    for (const m of svg.matchAll(/#[0-9a-fA-F]{3,8}/g)) {
      assert.ok(allowed.has(m[0].slice(1).toLowerCase()), `${name} uses non-brand colour ${m[0]}`);
    }
    assert.ok(!/<text/i.test(svg), `${name} has no text`);
    assert.ok(!/Gradient/i.test(svg), `${name} has no gradient`);
    assert.ok(!/filter/i.test(svg), `${name} has no filter`);
  }
});