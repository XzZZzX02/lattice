import { build } from "vite";
import { mkdir, copyFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { verifyExtensionBundle } from "./verify-bundle.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "dist-extension");
for (const entry of ["content", "background"]) {
  await build({
    configFile: false,
    root,
    publicDir: false,
    // Vite library builds preserve process.env by default; extension scripts have no Node runtime.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    esbuild: { jsx: "automatic" },
    build: {
      outDir: output,
      emptyOutDir: entry === "content",
      target: "chrome120",
      lib: {
        entry: resolve(root, `extension/src/${entry}.${entry === "content" ? "tsx" : "ts"}`),
        name: `Lattice${entry}`,
        formats: ["iife"],
        fileName: () => `${entry}.js`
      }
    }
  });
}
for (const filename of ["manifest.json", "native.css"]) {
  await copyFile(resolve(root, "extension/public", filename), resolve(output, filename));
}
await copyFile(resolve(root, "extension/README.md"), resolve(output, "INSTALL.md"));
await copyFile(resolve(root, "extension/ACCEPTANCE.md"), resolve(output, "ACCEPTANCE.md"));
const manifest = JSON.parse(await readFile(resolve(output, "manifest.json"), "utf8"));
if (manifest.content_scripts[0].js[0] !== "content.js") throw new Error("Invalid extension bundle");
await verifyExtensionBundle(output);
await mkdir(resolve(root, "artifacts"), { recursive: true });
execFileSync("/usr/bin/zip", ["-q", "-r", "-FS", resolve(root, "artifacts/lattice-chatgpt-extension.zip"), "."], { cwd: output });
console.log(`Load unpacked: ${output}`);
console.log(`Archive: ${resolve(root, "artifacts/lattice-chatgpt-extension.zip")}`);
