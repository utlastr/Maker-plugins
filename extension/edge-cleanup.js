(() => {
  function clean(data, width, height, background) {
    const source = new Uint8ClampedArray(data);
    let changed = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4, alpha = source[offset + 3] / 255;
      if (alpha <= 0 || alpha >= 1) continue;
      let transparent = false, interior = -1, distance = Infinity;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const near = (ny * width + nx) * 4, d = dx * dx + dy * dy;
        if (!source[near + 3]) transparent = true;
        if (source[near + 3] >= 250 && d < distance) { interior = near; distance = d; }
      }
      if (!transparent || interior < 0) continue;
      // Only remove a known matte mixture; keep white artwork and the original alpha.
      let mixedError = 0, cleanError = 0;
      for (let c = 0; c < 3; c++) {
        const expected = source[interior + c] * alpha + background[c] * (1 - alpha);
        mixedError += Math.abs(source[offset + c] - expected);
        cleanError += Math.abs(source[offset + c] - source[interior + c]);
      }
      if (mixedError > 45 || mixedError + 12 >= cleanError) continue;
      for (let c = 0; c < 3; c++)
        data[offset + c] = Math.max(0, Math.min(255,
          (source[offset + c] - background[c] * (1 - alpha)) / alpha));
      changed++;
    }
    return changed;
  }
  globalThis.MakerEdgeCleanup = { clean };
  if (typeof module !== "undefined") module.exports = { clean };
})();
