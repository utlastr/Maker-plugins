const test = require("node:test");
const assert = require("node:assert/strict");
const { clean } = require("../extension/edge-cleanup.js");

test("removes a white matte mixture without eroding alpha or the opaque foreground", () => {
  const pixels = new Uint8ClampedArray([
    0, 0, 0, 0, 137, 147, 157, 128, 20, 40, 60, 255, 0, 0, 0, 0
  ]);
  assert.equal(clean(pixels, 4, 1, [255, 255, 255]), 1);
  assert.ok(Math.abs(pixels[4] - 20) <= 2);
  assert.ok(Math.abs(pixels[5] - 40) <= 2);
  assert.ok(Math.abs(pixels[6] - 60) <= 2);
  assert.equal(pixels[7], 128);
  assert.deepEqual([...pixels.slice(8, 12)], [20, 40, 60, 255]);
});

test("preserves white artwork, already clean edges and isolated translucent details", () => {
  for (const pixels of [
    [0, 0, 0, 0, 255, 255, 255, 128, 255, 255, 255, 255],
    [0, 0, 0, 0, 20, 40, 60, 128, 20, 40, 60, 255],
    [0, 0, 0, 0, 200, 200, 200, 128, 0, 0, 0, 0]
  ]) {
    const data = Uint8ClampedArray.from(pixels);
    assert.equal(clean(data, 3, 1, [255, 255, 255]), 0);
    assert.deepEqual([...data], pixels);
  }
});
