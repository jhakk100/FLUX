import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outputPath = path.resolve(process.argv[2] ?? "assets/flux.ico");
const size = 64;
const pixels = Buffer.alloc(size * size * 4);
const letterF = ["11111", "10000", "11110", "10000", "10000", "10000", "10000"];
const letterU = ["10001", "10001", "10001", "10001", "10001", "10001", "01110"];

function pixel(x, y, red, green, blue) {
  if (x < 0 || x >= size || y < 0 || y >= size) return;
  const offset = ((size - 1 - y) * size + x) * 4;
  pixels[offset] = blue;
  pixels[offset + 1] = green;
  pixels[offset + 2] = red;
  pixels[offset + 3] = 255;
}

function drawLetter(rows, originX, originY, scale) {
  rows.forEach((row, rowIndex) => [...row].forEach((value, columnIndex) => {
    if (value !== "1") return;
    for (let y = 0; y < scale; y += 1) for (let x = 0; x < scale; x += 1) pixel(originX + columnIndex * scale + x, originY + rowIndex * scale + y, 232, 31, 41);
  }));
}

for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) pixel(x, y, 5, 5, 6);
drawLetter(letterF, 5, 14, 5);
drawLetter(letterU, 34, 14, 5);

const bitmapHeader = Buffer.alloc(40);
bitmapHeader.writeUInt32LE(40, 0);
bitmapHeader.writeInt32LE(size, 4);
bitmapHeader.writeInt32LE(size * 2, 8);
bitmapHeader.writeUInt16LE(1, 12);
bitmapHeader.writeUInt16LE(32, 14);
bitmapHeader.writeUInt32LE(pixels.length, 20);
const mask = Buffer.alloc((size * size) / 8);
const image = Buffer.concat([bitmapHeader, pixels, mask]);
const iconHeader = Buffer.alloc(6);
iconHeader.writeUInt16LE(0, 0);
iconHeader.writeUInt16LE(1, 2);
iconHeader.writeUInt16LE(1, 4);
const directory = Buffer.alloc(16);
directory.writeUInt8(size, 0);
directory.writeUInt8(size, 1);
directory.writeUInt16LE(1, 4);
directory.writeUInt16LE(32, 6);
directory.writeUInt32LE(image.length, 8);
directory.writeUInt32LE(iconHeader.length + directory.length, 12);
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, Buffer.concat([iconHeader, directory, image]));
console.log(`Created ${outputPath}`);
