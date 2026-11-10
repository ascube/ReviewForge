import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("forge", {
  call: async (method: string, args?: unknown) => {
    const result = await ipcRenderer.invoke("forge", method, args);
    if (result.error) {
      // contextBridge preserves Error.message, but drops custom Error properties.
      // Select the language before the error crosses into the renderer.
      throw new Error(
        result.error[result.language === "zh-Hans" ? "zh" : "en"],
      );
    }
    return result.value;
  },
  subscribe: (listener: (state: unknown) => void) => {
    const callback = (_: unknown, state: unknown) => listener(state);
    ipcRenderer.on("state", callback);
    return () => ipcRenderer.removeListener("state", callback);
  },
  onAbout: (listener: () => void) => {
    const callback = () => listener();
    ipcRenderer.on("show-about", callback);
    return () => ipcRenderer.removeListener("show-about", callback);
  },
});
