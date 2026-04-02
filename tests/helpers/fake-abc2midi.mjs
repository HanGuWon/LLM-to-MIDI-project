import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const inputPath = process.argv[2];
const outputIndex = process.argv.indexOf("-o");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : path.join(process.cwd(), "output.mid");

if (!inputPath || !outputPath) {
  console.error("fake abc2midi requires an input file and -o output path");
  process.exit(2);
}

const input = await readFile(inputPath, "utf8");

if (input.includes("FAIL_TOOL")) {
  console.error("forced tool failure");
  process.exit(3);
}

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(
  outputPath,
  Buffer.from([
    0x4d, 0x54, 0x68, 0x64, 0x00, 0x00, 0x00, 0x06,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x60,
    0x4d, 0x54, 0x72, 0x6b, 0x00, 0x00, 0x00, 0x04,
    0x00, 0xff, 0x2f, 0x00,
  ]),
);

console.log(`converted ${path.basename(inputPath)}`);
console.error("simulated abc2midi warning");
