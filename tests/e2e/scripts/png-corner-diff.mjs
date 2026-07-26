#!/usr/bin/env node
// Compare corner regions of two PNGs (decoded via headless chromium canvas).
// Usage: node png-corner-diff.mjs a.png b.png <cornerSizePx>
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const [a, b, sizeArg] = process.argv.slice(2);
const size = Number(sizeArg ?? 25);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const res = await page.evaluate(
  async ({ a64, b64, size }) => {
    const load = (b64) =>
      new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img);
        img.onerror = rej;
        img.src = `data:image/png;base64,${b64}`;
      });
    const [ia, ib] = await Promise.all([load(a64), load(b64)]);
    const data = (img) => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return { d: ctx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
    };
    const A = data(ia);
    const B = data(ib);
    if (A.w !== B.w || A.h !== B.h) return { error: `size mismatch ${A.w}x${A.h} vs ${B.w}x${B.h}` };
    const regions = {
      topLeft: [0, 0],
      topRight: [A.w - size, 0],
      bottomLeft: [0, A.h - size],
      bottomRight: [A.w - size, A.h - size],
      center: [Math.floor(A.w / 2 - size / 2), Math.floor(A.h / 2 - size / 2)],
    };
    const out = {};
    for (const [name, [x0, y0]] of Object.entries(regions)) {
      let diff = 0, maxd = 0;
      for (let y = y0; y < y0 + size; y++)
        for (let x = x0; x < x0 + size; x++) {
          const i = (y * A.w + x) * 4;
          const d = Math.max(
            Math.abs(A.d[i] - B.d[i]),
            Math.abs(A.d[i + 1] - B.d[i + 1]),
            Math.abs(A.d[i + 2] - B.d[i + 2]),
          );
          if (d > 8) diff++;
          if (d > maxd) maxd = d;
        }
      out[name] = { changedPx: diff, maxChannelDiff: maxd, totalPx: size * size };
    }
    return out;
  },
  {
    a64: readFileSync(a).toString("base64"),
    b64: readFileSync(b).toString("base64"),
    size,
  },
);
console.log(JSON.stringify(res, null, 2));
await browser.close();
