// Renders the Folio icon set into public/ from two SVG sources:
//   public/folio-icon.svg            rounded tile: favicon and "any" purpose icons
//   icons/folio-icon-maskable.svg    full-bleed square with the mark inside the
//                                    maskable safe zone: Android adaptive icons
//                                    and the iOS home screen (which rounds it)
// Run with `npm run generate-icons` after changing either source, and commit the
// output: builds use the committed PNGs, so CI and Docker never need sharp.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const root = new URL("../", import.meta.url);
const tile = await readFile(new URL("public/folio-icon.svg", root));
const bleed = await readFile(new URL("icons/folio-icon-maskable.svg", root));

const png = (svg, size) =>
  sharp(svg, { density: Math.max(72, Math.ceil((72 * size) / 512) * 2) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();

const outputs = [
  ["pwa-64x64.png", tile, 64],
  ["pwa-192x192.png", tile, 192],
  ["pwa-512x512.png", tile, 512],
  ["maskable-icon-512x512.png", bleed, 512],
  ["apple-touch-icon-180x180.png", bleed, 180],
];
for (const [name, svg, size] of outputs) {
  await writeFile(new URL(`public/${name}`, root), await png(svg, size));
}

// favicon.ico: PNG-compressed entries at 16, 32 and 48 px (supported by every
// browser since IE Vista-era), so no extra encoder dependency is needed.
const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map((s) => png(tile, s)));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size, entry);
  header.writeUInt8(size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
await writeFile(new URL("public/favicon.ico", root), Buffer.concat([header, ...images]));
console.log("Icons written to public/");
