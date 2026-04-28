#!/usr/bin/env node
/**
 * Deterministic asset generator for the Romeo & Juliet E2E suite.
 *
 *   pnpm e2e:assets            # regenerate every PNG (idempotent, byte-stable)
 *
 * Outputs (committed to the repo so CI is hermetic):
 *   tests/e2e/assets/portraits/<persona>.png   180x180  ~5 KB
 *   tests/e2e/assets/backdrops/<name>.png      1024x576
 *   tests/e2e/assets/props/<name>.png          512x512
 *
 * We use @napi-rs/canvas (pure-JS skia) so the generator runs anywhere Node 22
 * runs — no headless-Chromium dependency, no GPU. The portraits are stylized
 * (colored field + livery stripe + initials) rather than photoreal so we never
 * have to worry about copyright or asset drift.
 */

import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PORTRAITS = path.join(__dirname, "portraits");
const OUT_BACKDROPS = path.join(__dirname, "backdrops");
const OUT_PROPS = path.join(__dirname, "props");

mkdirSync(OUT_PORTRAITS, { recursive: true });
mkdirSync(OUT_BACKDROPS, { recursive: true });
mkdirSync(OUT_PROPS, { recursive: true });

// Color palette per house — keeps Capulets red, Montagues blue so visual
// inspection of perform-spec screenshots is unambiguous.
const HOUSE_COLORS = {
  capulet: { fill: "#7a0d0d", stroke: "#f4d36b", text: "#fdf3d8" },
  montague: { fill: "#0d2a7a", stroke: "#cfd8ef", text: "#eaf0ff" },
  prince: { fill: "#3a206b", stroke: "#f6e58d", text: "#f9eaff" },
  civic: { fill: "#3d3d3d", stroke: "#bdbdbd", text: "#ffffff" },
};

const PORTRAITS = [
  { name: "sampson", label: "Sm", house: "capulet" },
  { name: "gregory", label: "Gr", house: "capulet" },
  { name: "abram", label: "Ab", house: "montague" },
  { name: "balthasar", label: "Ba", house: "montague" },
  { name: "benvolio", label: "Bn", house: "montague" },
  { name: "tybalt", label: "Ty", house: "capulet" },
  { name: "officer", label: "Of", house: "civic" },
  { name: "capulet", label: "Cp", house: "capulet" },
  { name: "ladycapulet", label: "LC", house: "capulet" },
  { name: "montague", label: "Mt", house: "montague" },
  { name: "ladymontague", label: "LM", house: "montague" },
  { name: "prince", label: "Pr", house: "prince" },
  { name: "romeo", label: "Ro", house: "montague" },
];

function drawPortrait({ name, label, house }) {
  const size = 180;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const colors = HOUSE_COLORS[house];

  // background
  ctx.fillStyle = colors.fill;
  ctx.fillRect(0, 0, size, size);

  // diagonal livery stripe
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-Math.PI / 6);
  ctx.fillStyle = colors.stroke;
  ctx.fillRect(-size, -10, size * 2, 20);
  ctx.restore();

  // "head" disc
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2.6, 0, Math.PI * 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = colors.stroke;
  ctx.stroke();

  // initials
  ctx.fillStyle = colors.text;
  ctx.font = "bold 64px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size / 2);

  // tiny name plate
  ctx.font = "bold 14px sans-serif";
  ctx.fillStyle = colors.text;
  ctx.fillText(name, size / 2, size - 14);

  writeFileSync(path.join(OUT_PORTRAITS, `${name}.png`), canvas.toBuffer("image/png"));
}

function drawBackdrop({ name, top, bottom, label }) {
  const w = 1024;
  const h = 576;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // simple "buildings" silhouette
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  let x = 0;
  let seed = 1;
  while (x < w) {
    const bw = 60 + ((seed = (seed * 9301 + 49297) % 233280) % 90);
    const bh = 200 + (seed % 220);
    ctx.fillRect(x, h - bh, bw, bh);
    // window dots
    ctx.fillStyle = "rgba(255, 220, 120, 0.7)";
    for (let yy = h - bh + 30; yy < h - 30; yy += 30) {
      for (let xx = x + 10; xx < x + bw - 10; xx += 20) {
        if ((xx + yy) % 7 === 0) ctx.fillRect(xx, yy, 6, 8);
      }
    }
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    x += bw + 4;
  }

  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "bold 36px serif";
  ctx.textAlign = "center";
  ctx.fillText(label, w / 2, 50);

  writeFileSync(path.join(OUT_BACKDROPS, `${name}.png`), canvas.toBuffer("image/png"));
}

function drawProp({ name, label, fill }) {
  const size = 512;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // transparent background
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(size / 2, 30);
  ctx.lineTo(size - 60, size / 2);
  ctx.lineTo(size / 2, size - 30);
  ctx.lineTo(60, size / 2);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#1c1c1c";
  ctx.stroke();

  ctx.fillStyle = "#fff";
  ctx.font = "bold 44px serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size / 2);

  writeFileSync(path.join(OUT_PROPS, `${name}.png`), canvas.toBuffer("image/png"));
}

for (const p of PORTRAITS) drawPortrait(p);

drawBackdrop({
  name: "verona-street",
  top: "#f3c98a",
  bottom: "#5a2d1b",
  label: "Verona — A Public Place",
});
drawBackdrop({
  name: "capulet-gate",
  top: "#3b2150",
  bottom: "#0e0824",
  label: "Verona — The Capulet Gate",
});

drawProp({ name: "swords", label: "X", fill: "#a0a0a0" });
drawProp({ name: "edict", label: "E", fill: "#c19a4b" });

console.log("[e2e:assets] regenerated", PORTRAITS.length, "portraits, 2 backdrops, 2 props");
