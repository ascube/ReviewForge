import MakerDMG from "@electron-forge/maker-dmg";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);

// Build directly from a staging folder. This avoids Finder/mounted-volume
// customization, which fails during detach on the Intel macOS CI runner.
export default class NativeDMG extends MakerDMG {
  async make({ dir, makeDir, appName, packageJSON, targetArch }) {
    const output = path.resolve(
      makeDir,
      "dmg",
      targetArch,
      `${appName}-${packageJSON.version}-${targetArch}.dmg`,
    );
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), "reviewforge-dmg-"));
    try {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.cp(
        path.join(dir, `${appName}.app`),
        path.join(stage, `${appName}.app`),
        { recursive: true, preserveTimestamps: true, verbatimSymlinks: true },
      );
      await fs.symlink("/Applications", path.join(stage, "Applications"));
      await execute(
        "/usr/bin/hdiutil",
        [
          "create",
          "-srcfolder",
          stage,
          "-volname",
          appName,
          "-fs",
          "HFS+",
          "-format",
          "UDZO",
          "-ov",
          output,
        ],
        { timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024 },
      );
      await execute("/usr/bin/hdiutil", ["verify", output], {
        timeout: 120000,
      });
      return [output];
    } finally {
      await fs.rm(stage, { recursive: true, force: true });
    }
  }
}
