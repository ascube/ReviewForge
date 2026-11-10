import { build } from "esbuild";
import { build as viteBuild } from "vite";
import { mkdir, copyFile, rm } from "node:fs/promises";
await rm("dist/main", { recursive: true, force: true });
await mkdir("dist/main", { recursive: true });
await build({
  entryPoints: ["src/main/index.ts", "src/main/copilot-worker.ts"],
  outdir: "dist/main",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  packages: "external",
  sourcemap: true,
});
await build({
  entryPoints: ["src/main/preload.ts"],
  outfile: "dist/main/preload.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  target: "node22",
});
await viteBuild({
  root: "src/renderer",
  base: "./",
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
});
