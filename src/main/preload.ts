import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("forge", {
  call: async (method: string, args?: unknown) => {
    const result = await ipcRenderer.invoke("forge", method, args);
    if (result.error) {
      const e = new Error(result.error.en);
      Object.assign(e, { localized: result.error });
      throw e;
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
