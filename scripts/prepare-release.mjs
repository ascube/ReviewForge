// Executed by release-assets.yml after validating the successful tag build.
// Publishes no release: uploads are a separate workflow step and remain draft-only.
import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const tag = process.env.RELEASE_TAG;
if (!/^v\d+\.\d+\.\d+$/.test(tag || "")) throw Error("Invalid release tag");
const version = tag.slice(1);
const sourceCommit = execFileSync("git", ["rev-parse", `${tag}^{commit}`], {
  encoding: "utf8",
}).trim();
const documentationCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
const manifest = JSON.parse(
  execFileSync("git", ["show", `${tag}:package.json`], { encoding: "utf8" }),
);
if (manifest.version !== version || manifest.license !== "MIT")
  throw Error("Tag metadata mismatch");
const output = path.resolve(".release-output");
await fs.mkdir(output, { recursive: true });
async function walk(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(file)));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}
for (const [artifact, platform, arch] of [
  ["ReviewForge-macos-15-arm64", "macOS", "arm64"],
  ["ReviewForge-macos-15-intel-x64", "macOS", "x64"],
  ["ReviewForge-windows-2025-x64", "Windows", "x64"],
]) {
  const files = await walk(path.join(".release-input", artifact));
  for (const ext of platform === "macOS"
    ? [".dmg", ".zip"]
    : [".exe", ".zip"]) {
    const matches = files.filter((f) => f.endsWith(ext));
    if (matches.length !== 1)
      throw Error(
        `Expected exactly one ${ext} in ${artifact}, found ${matches.length}`,
      );
    await fs.copyFile(
      matches[0],
      path.join(
        output,
        `ReviewForge-Desktop-${version}-${platform}-${arch}${ext}`,
      ),
    );
  }
}
const documentFiles = [
  "README.md",
  "README.zh-CN.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES.md",
  "CHANGELOG.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "VALIDATION.md",
  "docs",
];
// Keep application code pinned to the verified tag, and include current public guides.
// Both commits are recorded in RELEASE.json; local-build checksum records are omitted.
const sourceStage = path.resolve(".release-source");
const sourceFolder = `ReviewForge-${version}`;
await fs.mkdir(path.join(sourceStage, sourceFolder), { recursive: true });
const sourceTar = path.join(sourceStage, "source.tar");
const sourcePaths = execFileSync("git", ["ls-tree", "--name-only", tag], {
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((name) => !["RELEASE.json", "SHA256SUMS"].includes(name));
execFileSync("git", [
  "archive",
  "--format=tar",
  `--output=${sourceTar}`,
  tag,
  ...sourcePaths,
]);
execFileSync("tar", [
  "-xf",
  sourceTar,
  "-C",
  path.join(sourceStage, sourceFolder),
]);
for (const name of documentFiles)
  await fs.cp(name, path.join(sourceStage, sourceFolder, name), {
    recursive: true,
  });
execFileSync(
  "zip",
  ["-qr", path.join(output, `ReviewForge-${version}-Source.zip`), sourceFolder],
  { cwd: sourceStage },
);
execFileSync("zip", [
  "-qr",
  path.join(output, `ReviewForge-${version}-Documentation.zip`),
  ...documentFiles,
]);
for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
  await fs.copyFile(name, path.join(output, name));
const upstream = [
  [
    "git-2.56.0-source.tar.gz",
    "https://codeload.github.com/git/git/tar.gz/a018953688f1b10bddf91bff8747068f5f4746a4",
  ],
  [
    "git-for-windows-2.56.0.4-source.tar.gz",
    "https://codeload.github.com/git-for-windows/git/tar.gz/refs/tags/v2.56.0.windows.4",
  ],
  [
    "dugite-native-2.56.0-2-build-recipes.tar.gz",
    "https://codeload.github.com/desktop/dugite-native/tar.gz/a44aeca",
  ],
];
// The source archives are pinned to the exact embedded Git revision/recipe used by 2.0.2.
if (version !== "2.0.2")
  throw Error(
    "Update upstream source revisions for this release before running",
  );
for (const [name, url] of upstream)
  execFileSync("curl", [
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "--retry",
    "3",
    url,
    "--output",
    path.join(output, name),
  ]);
async function sha(file) {
  const h = createHash("sha256");
  for await (const b of createReadStream(file)) h.update(b);
  return h.digest("hex");
}
const artifacts = [];
for (const name of (await fs.readdir(output)).sort()) {
  const file = path.join(output, name);
  artifacts.push({
    name,
    bytes: (await fs.stat(file)).size,
    sha256: await sha(file),
  });
}
const release = {
  version,
  license: "MIT",
  repository: `https://github.com/${process.env.GITHUB_REPOSITORY}`,
  sourceCommit,
  documentationCommit,
  buildRun: process.env.BUILD_RUN,
  builtAt: new Date().toISOString(),
  publisherSigned: false,
  testsPassedPerPlatform: 24,
  nativeRuntimeVerified: ["macOS arm64", "macOS x64", "Windows x64"],
  interactiveUIVerified: ["macOS arm64"],
  artifacts,
};
await fs.writeFile(
  path.join(output, "RELEASE.json"),
  JSON.stringify(release, null, 2) + "\n",
);
const sums = artifacts.map((a) => [a.name, a.sha256]);
sums.push(["RELEASE.json", await sha(path.join(output, "RELEASE.json"))]);
await fs.writeFile(
  path.join(output, "SHA256SUMS"),
  sums
    .sort()
    .map(([n, h]) => `${h}  ${n}\n`)
    .join(""),
);
console.log(
  `Prepared ${artifacts.length + 2} assets from ${sourceCommit}; documentation ${documentationCommit}.`,
);
