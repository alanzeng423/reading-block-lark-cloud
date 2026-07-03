import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(root, "extension");
const outDir = resolve(root, "dist");
const zipPath = resolve(outDir, "reading-block-lark-extension.zip");

for (const file of ["extension/manifest.json", "extension/src/lib/config.js"]) {
  if (!existsSync(resolve(root, file))) {
    throw new Error(`${file} is missing. Run npm run configure first.`);
  }
}

mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync("zip", ["-r", "-q", zipPath, "manifest.json", "src", "icons"], {
  cwd: extensionDir,
  stdio: "inherit",
});

console.log(`Wrote ${zipPath}`);
