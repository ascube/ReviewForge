import squirrelStartup from "electron-squirrel-startup";
import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  safeStorage,
  shell,
  Menu,
  clipboard,
} from "electron";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import { createTwoFilesPatch } from "diff";
import { atomicFile } from "./recovery";
import { copyStore } from "./storage";
import { githubCredential } from "./credentials";
import { reviewReport } from "./report";
import { Store } from "./store";
import { Service } from "./service";
import { Copilot } from "./copilot";
import { repoInfo, gitText } from "./git";
import { ForgeError, fail, digest, redact } from "./util";
import type { Settings } from "../shared/types";
let window: BrowserWindow, service: Service, configDirectory: string;
let prefs: Settings;
const fixture = process.env.REVIEWFORGE_FIXTURE_DIRECTORY;
if (fixture) app.setPath("userData", fixture);
app.setName("ReviewForge Desktop");
if (squirrelStartup) app.quit();
const smokeTest = process.argv.includes("--smoke-test");
const single = smokeTest || app.requestSingleInstanceLock();
if (!single) app.quit();
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => service?.cancel());
async function readSecret(key: string) {
  try {
    const bytes = await fs.readFile(path.join(configDirectory, `${key}.vault`));
    return (await safeStorage.decryptStringAsync(bytes)).result;
  } catch (e: any) {
    if (e.code === "ENOENT") return "";
    throw new ForgeError(
      "Unable to unlock saved credentials. Check the system credential prompt.",
      "无法解锁已保存凭据，请检查系统授权提示。",
    );
  }
}
async function saveSecret(key: string, value: string) {
  if (!(await safeStorage.isAsyncEncryptionAvailable()))
    fail(
      "System credential encryption is unavailable.",
      "系统凭据加密不可用。",
    );
  if (value.trim())
    await fs.writeFile(
      path.join(configDirectory, `${key}.vault`),
      await safeStorage.encryptStringAsync(value.trim()),
      { mode: 0o600 },
    );
  else await fs.rm(path.join(configDirectory, `${key}.vault`), { force: true });
}
const emit = () => {
  if (window && !window.isDestroyed())
    window.webContents.send("state", service.state());
};
async function savePrefs() {
  await atomicFile(
    path.join(configDirectory, "settings.json"),
    Buffer.from(JSON.stringify(prefs, null, 2)),
    0o600,
  );
}
const choose = async (title: string) => {
  const r = await dialog.showOpenDialog(window, {
    title,
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled ? null : r.filePaths[0];
};
function menus() {
  const zh = prefs.language === "zh-Hans";
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "ReviewForge",
        submenu: [
          {
            label: zh ? "关于 ReviewForge" : "About ReviewForge",
            click: () => {
              if (!window || window.isDestroyed()) {
                createWindow();
                window.webContents.once("did-finish-load", () =>
                  window.webContents.send("show-about"),
                );
              } else {
                window.show();
                window.focus();
                window.webContents.send("show-about");
              }
            },
          },
          { type: "separator" },
          { role: "quit", label: zh ? "退出" : "Quit" },
        ],
      },
      {
        label: zh ? "编辑" : "Edit",
        submenu: [
          { role: "undo", label: zh ? "撤销" : "Undo" },
          { role: "redo", label: zh ? "重做" : "Redo" },
          { type: "separator" },
          { role: "cut", label: zh ? "剪切" : "Cut" },
          { role: "copy", label: zh ? "复制" : "Copy" },
          { role: "paste", label: zh ? "粘贴" : "Paste" },
          { role: "selectAll", label: zh ? "全选" : "Select All" },
        ],
      },
      {
        label: zh ? "视图" : "View",
        submenu: [
          { role: "resetZoom", label: zh ? "实际大小" : "Actual Size" },
          { role: "zoomIn", label: zh ? "放大" : "Zoom In" },
          { role: "zoomOut", label: zh ? "缩小" : "Zoom Out" },
          {
            role: "togglefullscreen",
            label: zh ? "切换全屏" : "Toggle Full Screen",
          },
        ],
      },
    ]),
  );
}
function createWindow() {
  window = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1000,
    minHeight: 700,
    title: "ReviewForge",
    backgroundColor: "#10151d",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (e) => e.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_w, _p, cb) =>
    cb(false),
  );
  window.loadFile(path.join(__dirname, "../renderer/index.html"));
}
async function dispatch(method: string, args: any) {
  if (method === "state") return service.state();
  if (method === "copy") {
    clipboard.writeText(z.string().parse(args.text));
    return;
  }
  if (
    service.progress.busy &&
    ![
      "cancel",
      "repository",
      "openExternal",
      "openWorkspace",
      "openData",
      "export",
    ].includes(method)
  )
    fail("Wait for the current operation.", "请等待当前操作完成。");
  if (method === "cancel") {
    service.cancel();
    return;
  }
  if (method === "chooseRepository") {
    const directory = await choose(
      prefs.language === "en" ? "Choose repository" : "选择仓库",
    );
    return directory ? repoInfo(directory) : null;
  }
  if (method === "repository")
    return repoInfo(z.string().parse(args.directory));
  if (method === "settings") {
    const v = z
      .object({
        language: z.enum(["en", "zh-Hans"]),
        model: z.string().max(200),
        authorName: z.string().max(200),
        authorEmail: z.string().max(200),
        githubToken: z.string().max(3000).optional(),
        copilotToken: z.string().max(3000).optional(),
      })
      .parse(args);
    if (v.githubToken !== undefined) await saveSecret("github", v.githubToken);
    if (v.copilotToken !== undefined)
      await saveSecret("copilot", v.copilotToken);
    prefs = {
      ...prefs,
      language: v.language,
      model: v.model,
      authorName: v.authorName,
      authorEmail: v.authorEmail,
      githubConfigured: Boolean(await readSecret("github")),
      copilotConfigured: Boolean(await readSecret("copilot")),
    };
    service.settings = prefs;
    await savePrefs();
    menus();
    emit();
    return service.state();
  }
  if (method === "chooseDataDirectory") {
    if (service.progress.busy)
      fail("Wait for the current operation.", "请等待当前操作完成。");
    const parent = await choose(
      prefs.language === "en" ? "Choose new data folder" : "选择新的数据文件夹",
    );
    if (!parent) return;
    return service.operation("Moving local data", undefined, async () => {
      const previous = service.store,
        previousPrefs = { ...prefs };
      const target = path.join(parent, "ReviewForgeDesktopData");
      const copied = await copyStore(previous, target);
      try {
        prefs.dataDirectory = copied.directory;
        await savePrefs();
        service.store = copied;
        previous.close();
      } catch (error) {
        prefs = previousPrefs;
        service.settings = prefs;
        copied.close();
        throw error;
      }
      return service.state();
    });
  }

  if (method === "openExternal") {
    const u = new URL(z.string().parse(args.url));
    if (
      !["https:", "http:", "mailto:"].includes(u.protocol) ||
      u.username ||
      u.password
    )
      fail(
        "Only HTTP, HTTPS and mail links can be opened.",
        "只能打开 HTTP、HTTPS 和邮件链接。",
      );
    return shell.openExternal(u.toString());
  }
  if (method === "openWorkspace") {
    const d = service.store.get(args.id);
    const root = d.workspace?.directory ?? d.snapshot.repository;
    if (root) return shell.openPath(root);
    return;
  }
  if (method === "openData") return shell.openPath(service.store.directory);
  if (method === "export") {
    const d = service.store.get(args.id);
    const r = await dialog.showSaveDialog(window, {
      title: prefs.language === "en" ? "Export review" : "导出审查",
      defaultPath: `ReviewForge-${d.id}.${d.snapshot.kind === "local" ? "md" : "json"}`,
      filters:
        d.snapshot.kind === "local"
          ? [{ name: "Markdown", extensions: ["md"] }]
          : [{ name: "JSON", extensions: ["json"] }],
    });
    if (r.filePath)
      await fs.writeFile(
        r.filePath,
        d.snapshot.kind === "local"
          ? reviewReport(d, prefs.language)
          : JSON.stringify(d, null, 2),
      );
    return;
  }
  if (method === "openDemo") return service.openDemo();
  if (method === "connection") return service.connection();
  if (method === "githubConnection") {
    const credential = await githubCredential(await readSecret("github"));
    const login = await service.githubConnection();
    const source =
      prefs.language === "zh-Hans"
        ? (({ Settings: "设置", Anonymous: "匿名" } as Record<string, string>)[
            credential.source
          ] ?? credential.source)
        : credential.source;
    prefs.githubIdentity = `${login} · ${source}`;
    emit();
    return prefs.githubIdentity;
  }
  if (method === "importPR")
    return service.importPR(z.string().parse(args.url));
  if (method === "capture")
    return service.capture(
      z
        .object({
          directory: z.string(),
          scope: z.enum(["working", "branch", "latest", "repository"]),
          baseRef: z.string(),
          subfolder: z.string(),
        })
        .parse(args),
    );
  const id = z.string().uuid().parse(args.id);
  if (method === "discardProposals") {
    const draft = service.draft(id),
      fingerprint = digest(draft.proposals);
    const zh = prefs.language === "zh-Hans";
    const result = await dialog.showMessageBox(window, {
      type: "warning",
      message: zh ? "丢弃本地修复草稿？" : "Discard local fix draft?",
      detail: zh
        ? "已应用的文件和恢复副本会保留。"
        : "Applied files and recovery copies are kept.",
      buttons: zh ? ["取消", "丢弃"] : ["Cancel", "Discard"],
      cancelId: 0,
      defaultId: 0,
    });
    if (result.response === 1) return service.discardProposals(id, fingerprint);
    return;
  }
  if (method === "previewReport")
    return reviewReport(service.draft(id), prefs.language);
  if (method === "workspaceFiles") return service.workspaceFiles(id);
  if (method === "readWorkspaceFile")
    return service.readWorkspaceFile(id, z.string().parse(args.path));
  if (method === "writeWorkspaceFile")
    return service.writeWorkspaceFile(
      id,
      z.string().parse(args.path),
      z.string().parse(args.content),
      z.string().parse(args.fingerprint),
      z.boolean().parse(args.discard ?? false),
    );
  if (method === "previewRecovery") return service.previewRecovery(id);
  if (method === "restoreFix")
    return service.restoreFix(id, z.string().parse(args.fingerprint));
  if (method === "useReplyDraft")
    return service.useReplyDraft(
      id,
      z.string().parse(args.itemID),
      z.boolean().parse(args.use),
    );
  if (method === "edit") return service.edit(id, args.patch);
  if (method === "archive")
    return service.archive(id, z.boolean().parse(args.archived));
  if (method === "delete") {
    const result = await dialog.showMessageBox(window, {
      type: "warning",
      message:
        prefs.language === "en"
          ? "Delete this local review permanently?"
          : "永久删除此本地审查？",
      detail:
        prefs.language === "en"
          ? "Workspace files and GitHub content are kept. This cannot be undone."
          : "工作区文件和 GitHub 内容会保留，此操作无法撤销。",
      buttons:
        prefs.language === "en" ? ["Cancel", "Delete"] : ["取消", "删除"],
      cancelId: 0,
      defaultId: 0,
    });
    if (result.response === 1) service.delete(id);
    return;
  }
  if (method === "analyze")
    return service.analyze(id, z.boolean().parse(args.resume));
  if (method === "previewReview") return service.previewReview(id);
  if (method === "approveReview")
    return service.approveReview(id, z.string().parse(args.fingerprint));
  if (method === "publishReview") return service.publishReview(id);
  if (method === "reconcileReview") return service.reconcileReview(id);
  if (method === "loadFeedback") return service.loadFeedback(id);
  if (method === "editFeedback") return service.editFeedback(id, args.items);
  if (method === "prepareWorkspace") {
    const local = args.useLocal
      ? await choose(
          prefs.language === "en" ? "Choose source repository" : "选择来源仓库",
        )
      : undefined;
    if (args.useLocal && !local) return;
    return service.prepareWorkspace(id, local ?? undefined);
  }
  if (method === "moveWorkspace") {
    const folder = await choose(
      prefs.language === "en"
        ? "Choose workspace parent folder"
        : "选择工作区父文件夹",
    );
    if (folder) return service.moveWorkspace(id, folder);
    return;
  }
  if (method === "generateFix")
    return service.generateFix(
      id,
      z.string().max(20000).parse(args.instructions),
    );
  if (method === "editProposal")
    return service.editProposal(
      id,
      z.string().parse(args.proposalID),
      z.string().parse(args.content),
      z.boolean().parse(args.selected),
    );
  if (method === "previewProposals") {
    const d = service.draft(id),
      items = d.proposals.filter((p) => p.selected && p.status === "pending");
    return {
      fingerprint: digest(items),
      items: items.map((p) => ({
        ...p,
        diff: createTwoFilesPatch(
          p.existed === false ? "/dev/null" : p.path,
          p.delete ? "/dev/null" : p.path,
          p.original,
          p.content,
        ),
      })),
    };
  }
  if (method === "applyProposals")
    return service.applyProposals(id, z.string().parse(args.fingerprint));
  if (method === "syncWorkspace") return service.syncWorkspace(id);
  if (method === "approveCode")
    return service.approveCode(id, z.string().parse(args.fingerprint));
  if (method === "previewCode") {
    const d = service.draft(id);
    return {
      preview: d.workspace?.preview,
      fingerprint: digest(d.workspace?.preview),
    };
  }
  if (method === "commit")
    return service.commit(id, z.string().max(10000).parse(args.message));
  if (method === "push")
    return service.push(id, z.boolean().parse(args.allowRewrite));
  if (method === "verify")
    return service.verify(
      id,
      z.string().parse(args.executable),
      z.array(z.string()).max(100).parse(args.arguments),
    );
  if (method === "generateReplies")
    return service.generateReplies(
      id,
      z.string().max(20000).parse(args.instructions),
      z.string().optional().parse(args.itemID),
    );
  if (method === "previewReplies") return service.previewReplies(id);
  if (method === "approveReplies")
    return service.approveReplies(id, z.string().parse(args.fingerprint));
  if (method === "publishReplies") return service.publishReplies(id);
  if (method === "reconcileReplies") return service.reconcileReplies(id);
  throw new ForgeError("Unknown application command.", "未知应用命令。");
}
app
  .whenReady()
  .then(async () => {
    if (smokeTest) {
      const folder = await fs.mkdtemp(
        path.join(os.tmpdir(), "reviewforge-native-"),
      );
      let code = 0;
      try {
        const probe = await new Copilot().run(
          { mode: "probe", token: "", directory: path.join(folder, "copilot") },
          async () => null,
        );
        const version = await gitText(folder, ["--version"]);
        const db = new Store(path.join(folder, "data"));
        db.close();
        console.log(JSON.stringify({ ok: true, git: version, ...probe }));
      } catch (error) {
        console.error(redact(String(error)));
        code = 1;
      } finally {
        await fs.rm(folder, { recursive: true, force: true });
      }
      app.exit(code);
      return;
    }
    configDirectory = app.getPath("userData");
    await fs.mkdir(configDirectory, { recursive: true });
    const saved = JSON.parse(
      await fs
        .readFile(path.join(configDirectory, "settings.json"), "utf8")
        .catch(() => "{}"),
    );
    prefs = {
      language: "en",
      dataDirectory: path.join(configDirectory, "data"),
      model: "",
      authorName: "",
      authorEmail: "",
      githubConfigured: false,
      copilotConfigured: false,
      ...saved,
    };
    prefs.githubConfigured = Boolean(await readSecret("github"));
    prefs.copilotConfigured = Boolean(await readSecret("copilot"));
    if (
      saved.dataDirectory &&
      saved.dataDirectory !== path.join(configDirectory, "data")
    ) {
      try {
        await fs.access(path.join(saved.dataDirectory, "reviews.sqlite"));
      } catch {
        fail(
          "The configured data folder is unavailable. Reconnect its drive before starting ReviewForge. Existing data has not been replaced.",
          "配置的数据目录不可用，请重新连接所在磁盘后启动 ReviewForge。原有数据未被替换。",
        );
      }
    }
    const store = new Store(prefs.dataDirectory);
    store.recover();
    service = new Service(
      store,
      prefs,
      new Copilot(),
      {
        read: async (key) =>
          key === "github"
            ? (await githubCredential(await readSecret(key))).token
            : readSecret(key),
      },
      emit,
    );
    menus();
    createWindow();
    ipcMain.handle("forge", async (event, method, args) => {
      if (
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        return { error: { en: "Invalid sender", zh: "请求来源无效" } };
      try {
        const value = await dispatch(method, args ?? {});
        emit();
        return { value };
      } catch (e) {
        return {
          language: prefs.language,
          error:
            e instanceof ForgeError
              ? { en: e.en, zh: e.zh }
              : {
                  en: redact(String(e)).slice(0, 1500),
                  zh: "操作未完成：" + redact(String(e)).slice(0, 1500),
                },
        };
      }
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  })
  .catch(async (error) => {
    if (smokeTest) {
      console.error("Native smoke test failed");
      app.exit(1);
      return;
    }
    await dialog.showMessageBox({
      type: "error",
      message:
        prefs?.language === "zh-Hans"
          ? "ReviewForge 无法打开本地数据。"
          : "ReviewForge could not open its local data.",
      detail:
        error instanceof ForgeError
          ? prefs?.language === "zh-Hans"
            ? error.zh
            : error.en
          : redact(String(error)),
    });
    app.quit();
  });
