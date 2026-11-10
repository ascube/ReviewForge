// Cross-build a self-contained x64 Windows installer with native Windows dependencies.
import { mkdir, cp, readFile, writeFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { build, Platform, Arch } from "electron-builder";
const exec = promisify(execFile),
  root = process.cwd();
const stage = path.join(root, ".cache/windows-stage"),
  cache = path.join(root, ".cache/downloads");
await mkdir(stage, { recursive: true });
await mkdir(cache, { recursive: true });
const manifest = JSON.parse(await readFile("package.json", "utf8"));
await cp("dist", path.join(stage, "dist"), { recursive: true });
await cp("package.json", path.join(stage, "package.json"));
await cp("package-lock.json", path.join(stage, "package-lock.json"));
for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
  await cp(file, path.join(stage, file));
await cp("docs/licenses", path.join(stage, "docs/licenses"), {
  recursive: true,
});
console.log(
  "Installing Windows production dependencies in isolated staging directory",
);
if (!process.argv.includes("--reuse-stage"))
  await exec(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--os=win32",
      "--cpu=x64",
      "--no-audit",
      "--no-fund",
    ],
    { cwd: stage, maxBuffer: 10_000_000, timeout: 600000 },
  );
const download = async (url, file, checksum) => {
  let valid = false;
  try {
    valid =
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex") === checksum;
  } catch {}
  if (!valid) {
    console.log("Downloading " + path.basename(file));
    // Resume only partial files from this exact version. Every artifact is checked against publisher metadata.
    await exec(
      "curl",
      [
        "--fail",
        "--location",
        "--silent",
        "--show-error",
        "--retry",
        "3",
        "--max-time",
        "900",
        "-C",
        "-",
        url,
        "-o",
        file,
      ],
      { timeout: 950000, maxBuffer: 1000000 },
    );
    if (
      createHash("sha256")
        .update(await readFile(file))
        .digest("hex") !== checksum
    )
      throw Error("Checksum mismatch: " + file);
  }
};
const embedded = JSON.parse(
  await readFile(
    path.join(stage, "node_modules/dugite/script/embedded-git.json"),
    "utf8",
  ),
)["win32-x64"];
const gitArchive = path.join(cache, embedded.name);
const electronVersion = manifest.devDependencies.electron;
const electronName = `electron-v${electronVersion}-win32-x64.zip`,
  electronArchive = path.join(cache, electronName);
const checksums = JSON.parse(
  await readFile("node_modules/electron/checksums.json", "utf8"),
);
await Promise.all([
  download(embedded.url, gitArchive, embedded.checksum),
  download(
    `https://github.com/electron/electron/releases/download/v${electronVersion}/${electronName}`,
    electronArchive,
    checksums[electronName],
  ),
]);
const gitDir = path.join(stage, "node_modules/dugite/git");
await mkdir(gitDir, { recursive: true });
await exec("tar", ["-xzf", gitArchive, "-C", gitDir]);
await stat(path.join(gitDir, "cmd/git.exe"));
await stat(
  path.join(stage, "node_modules/@github/copilot-sdk-win32-x64/package.json"),
);
// The staged app is intentionally free of development/build dependencies.
const appManifest = { ...manifest };
delete appManifest.devDependencies;
delete appManifest.config;
delete appManifest.scripts;
await writeFile(
  path.join(stage, "package.json"),
  JSON.stringify(appManifest, null, 2),
);
await rm(path.join(stage, "package-lock.json"));
console.log("Packaging Windows NSIS installer");
await build({
  targets: Platform.WINDOWS.createTarget(["nsis", "zip"], Arch.x64),
  projectDir: stage,
  config: {
    appId: "dev.reviewforge.desktop",
    productName: "ReviewForge Desktop",
    executableName: "ReviewForgeDesktop",
    electronVersion,
    electronDist: electronArchive,
    toolsets: { nsis: "1.2.1" },
    npmRebuild: false,
    nodeGypRebuild: false,
    directories: { output: path.join(root, "out/windows") },
    files: [
      "dist/**/*",
      "package.json",
      "node_modules/**/*",
      "LICENSE",
      "THIRD_PARTY_NOTICES.md",
      "docs/licenses/**/*",
    ],
    asarUnpack: ["node_modules/**/*"],
    win: {
      icon: path.join(root, "assets/icon.ico"),
      signExecutable: Boolean(process.env.CSC_LINK),
      artifactName: "ReviewForge-Desktop-${version}-Windows-${arch}.${ext}",
    },
    nsis: {
      oneClick: false,
      perMachine: false,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      installerLanguages: ["en_US", "zh_CN"],
      language: "1033",
      displayLanguageSelector: true,
      deleteAppDataOnUninstall: false,
    },
    publish: null,
  },
});
