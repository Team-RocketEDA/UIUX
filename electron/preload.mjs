// RocketEDA Desktop Preload Bridge
// Context-isolated narrow IPC surface (no credentials or raw process handles exposed)

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rocketDesktop", {
  getRuntimeInfo: () => ipcRenderer.invoke("rocket:get-runtime-info"),
});
