import { utilityProcess } from "electron";
import path from "node:path";
import { cleanEnv, ForgeError, redact } from "./util";
export class Copilot {
  private current: ReturnType<typeof utilityProcess.fork> | undefined;
  async run(
    message: any,
    onTool: (operation: string, args: any) => Promise<any>,
  ): Promise<any> {
    if (this.current)
      throw new ForgeError("Copilot is busy.", "Copilot 正忙。");
    const child = utilityProcess.fork(
      path.join(__dirname, "copilot-worker.cjs"),
      [],
      { env: cleanEnv(), stdio: "pipe", serviceName: "ReviewForge Copilot" },
    );
    this.current = child;
    return new Promise((resolve, reject) => {
      let finished = false;
      let diagnostics = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        diagnostics = (diagnostics + chunk.toString()).slice(-3000);
      });
      const finish = (error: Error | null, value?: any) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        this.current = undefined;
        child.kill();
        error ? reject(error) : resolve(value);
      };
      const timer = setTimeout(
        () =>
          finish(
            new ForgeError(
              "Copilot timed out. Resume to retry unfinished work.",
              "Copilot 超时，请继续审查重试未完成的内容。",
            ),
          ),
        22 * 60 * 1000,
      );
      child.on("message", async (data: any) => {
        if (data.type === "done") finish(null, data.value);
        if (data.type === "error") finish(new ForgeError(data.en, data.zh));
        if (data.type === "tool") {
          try {
            const value = await onTool(data.op, data.args);
            if (!finished)
              child.postMessage({ type: "response", id: data.id, value });
          } catch (e) {
            if (!finished)
              child.postMessage({
                type: "response",
                id: data.id,
                error: String(e),
              });
          }
        }
      });
      child.on("exit", (code) =>
        finish(
          new ForgeError(
            "Copilot stopped (" +
              code +
              "). " +
              redact(diagnostics, [message.token ?? ""]).slice(-1500),
            "Copilot 已停止（" +
              code +
              "）：" +
              redact(diagnostics, [message.token ?? ""]).slice(-1500),
          ),
        ),
      );
      child.once("spawn", () =>
        child.postMessage({ type: "start", ...message }),
      );
    });
  }
  cancel() {
    this.current?.postMessage({ type: "cancel" });
    this.current?.kill();
  }
}
