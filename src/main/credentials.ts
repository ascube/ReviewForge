import { execFile } from "node:child_process";
import { cleanEnv } from "./util";
export async function githubCredential(
  saved: string,
  env: NodeJS.ProcessEnv = process.env,
  cli?: () => Promise<string>,
) {
  if (saved.trim()) return { token: saved.trim(), source: "Settings" };
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN"])
    if (env[key]?.trim()) return { token: env[key]!.trim(), source: key };
  const readCLI =
    cli ??
    (async () => {
      for (const exe of process.platform === "win32"
        ? ["gh.exe"]
        : ["/opt/homebrew/bin/gh", "/usr/local/bin/gh", "gh"])
        try {
          return await new Promise<string>((resolve, reject) =>
            execFile(
              exe,
              ["auth", "token", "--hostname", "github.com"],
              {
                env: cleanEnv(),
                timeout: 10000,
                maxBuffer: 8192,
                windowsHide: true,
              },
              (err, out) => (err ? reject(err) : resolve(out.trim())),
            ),
          );
        } catch {}
      return "";
    });
  const token = await readCLI();
  return { token, source: token ? "GitHub CLI" : "Anonymous" };
}
