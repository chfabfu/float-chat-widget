const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Window controls
  minimize: () => ipcRenderer.send("win-minimize"),
  maximize: () => ipcRenderer.send("win-maximize"),
  close: () => ipcRenderer.send("win-close"),
  toBall: () => ipcRenderer.send("win-to-ball"),
  fromBall: () => ipcRenderer.invoke("win-from-ball"),
  setIgnoreMouse: (v) => ipcRenderer.send("set-ignore-mouse", v),

  // Sessions
  sessionsList: () => ipcRenderer.invoke("sessions-list"),
  sessionsMessages: (id) => ipcRenderer.invoke("sessions-messages", id),
  sessionsDelete: (id) => ipcRenderer.invoke("sessions-delete", id),

  // Claude CLI
  chat: (text) => ipcRenderer.send("claude-chat", text),
  stop: () => ipcRenderer.send("claude-stop"),
  permissionResponse: (id, approved) => ipcRenderer.send("claude-permission-response", { id, approved }),
  newSession: () => ipcRenderer.send("claude-new-session"),
  resume: (id) => ipcRenderer.send("claude-resume", id),

  // Ball image
  ballGetImage: () => ipcRenderer.invoke("ball-get-image"),
  ballPickImage: () => ipcRenderer.invoke("ball-pick-image"),
  ballClearImage: () => ipcRenderer.send("ball-clear-image"),

  // Claude events
  onInit: (cb) => ipcRenderer.on("claude-init", (_, d) => cb(d)),
  onText: (cb) => ipcRenderer.on("claude-text", (_, t) => cb(t)),
  onTool: (cb) => ipcRenderer.on("claude-tool", (_, d) => cb(d)),
  onThinking: (cb) => ipcRenderer.on("claude-thinking", (_, t) => cb(t)),
  onPermission: (cb) => ipcRenderer.on("claude-permission", (_, d) => cb(d)),
  onDone: (cb) => ipcRenderer.on("claude-done", (_, d) => cb(d)),
  onError: (cb) => ipcRenderer.on("claude-error", (_, msg) => cb(msg)),
});
