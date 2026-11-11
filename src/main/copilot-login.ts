import { z } from "zod";
import { ForgeError } from "./util";

// Only the runtime's GitHub device authorization page may be opened automatically.
export const loginPrompt = z.object({
  url: z.string().refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.origin === "https://github.com" &&
        url.pathname === "/login/device" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }),
  code: z.string().regex(/^[A-Z0-9-]{4,32}$/),
  expiresAt: z.number().finite(),
});

export async function signInCopilot(
  client: any,
  notify: (prompt: z.infer<typeof loginPrompt>) => Promise<void>,
  signal: AbortSignal,
  timeoutMs = 10 * 60 * 1000,
) {
  const session = await client.createSession({
    availableTools: [],
    tools: [],
    mcpServers: {},
    skillDirectories: [],
    enableConfigDiscovery: false,
    enableFileHooks: false,
    enableOnDemandInstructionDiscovery: false,
    enableHostGitOperations: false,
    enableSessionStore: false,
    enableSkills: false,
    onPermissionRequest: () => ({ kind: "denied-by-rules", rules: [] }),
  });
  const login = session.rpc.accounts.login;
  let flowId: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort = () => {};
  const cancelled = () =>
    new ForgeError("Copilot sign-in cancelled.", "已取消 Copilot 登录。");
  try {
    if (signal.aborted) throw cancelled();
    const flow = await login.begin({
      kind: "githubDotCom",
      method: "device-code",
    });
    flowId = flow.flowId;
    if (signal.aborted) throw cancelled();
    const interrupted = new Promise<never>((_, reject) => {
      abort = () => reject(cancelled());
      signal.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () =>
          reject(
            new ForgeError(
              "Copilot sign-in expired. Start sign-in again.",
              "Copilot 登录已过期，请重新登录。",
            ),
          ),
        timeoutMs,
      );
    });
    await Promise.race([
      interrupted,
      (async () => {
        let step = flow.step;
        for (let count = 0; count < 20; count++) {
          if (step.kind === "completed") {
            if (step.result.status === "completed") return;
            throw new ForgeError(
              "Copilot could not finish secure sign-in. Check system credential storage and try again. Plaintext credentials were not accepted.",
              "Copilot 无法完成安全登录，请检查系统凭据存储后重试。未接受明文存储凭据。",
            );
          }
          if (step.kind !== "device-code" && step.kind !== "awaiting")
            throw new ForgeError(
              "Copilot sign-in did not complete. Start sign-in again.",
              "Copilot 登录未完成，请重新登录。",
            );
          if (step.kind === "device-code") {
            const seconds = z
              .number()
              .positive()
              .finite()
              .parse(step.expiresIn);
            await notify(
              loginPrompt.parse({
                url: step.verificationUri,
                code: step.userCode,
                expiresAt: Date.now() + Math.min(seconds * 1000, timeoutMs),
              }),
            );
          }
          if (signal.aborted) throw cancelled();
          step = await login.advance({ flowId });
        }
        throw new ForgeError(
          "Copilot sign-in did not complete.",
          "Copilot 登录未完成。",
        );
      })(),
    ]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    if (flowId) await login.cancel({ flowId }).catch(() => {});
    await session.disconnect().catch(() => {});
  }
}
