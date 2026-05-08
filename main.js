const { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const readline = require("readline");

let mainWindow = null;
let tray = null;

// ── Session storage ──
const HOME = os.homedir();
const PROJECT_DIR = process.cwd().replace(/[^a-zA-Z0-9]/g, "-");
const SESSIONS_DIR = path.join(HOME, ".claude", "projects", PROJECT_DIR);

const CLAUDE_CMD =
  process.platform === "win32"
    ? path.join(process.env.APPDATA || "", "npm", "claude.cmd")
    : "claude";

// ── Tray ──
function createTray() {
  const size = 16;
  const canvas = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - size / 2, dy = y - size / 2;
      const i = (y * size + x) * 4;
      if (Math.sqrt(dx * dx + dy * dy) < size / 2 - 1) {
        canvas[i] = 233; canvas[i + 1] = 69; canvas[i + 2] = 96; canvas[i + 3] = 255;
      }
    }
  }
  tray = new Tray(nativeImage.createFromBuffer(canvas, { width: size, height: size }));
  tray.setToolTip("Claude Code");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Show", click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { label: "Hide", click: () => { if (mainWindow) mainWindow.hide(); } },
    { type: "separator" },
    { label: "Quit", click: () => { app.quit(); } },
  ]));
  tray.on("click", () => {
    if (mainWindow) mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
  });
}

// ── Window ──
function createWindow() {
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: 420, height: 600,
    x: screenW - 460, y: screenH - 640,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: false, resizable: true, hasShadow: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  mainWindow.setMenu(null);
  mainWindow.loadFile(path.join(__dirname, "public", "index.html"));
  mainWindow.setAlwaysOnTop(true, "floating");
  mainWindow.on("closed", () => { mainWindow = null; });
}

// ── Window IPC ──
ipcMain.on("win-minimize", () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.on("win-maximize", () => {
  if (mainWindow) mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on("win-close", () => { app.quit(); });

let savedBounds = null;
ipcMain.on("win-to-ball", () => {
  if (!mainWindow) return;
  savedBounds = mainWindow.getBounds();
  mainWindow.setOpacity(0);
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  mainWindow.setAlwaysOnTop(true, "screen-saver");
  mainWindow.setBounds({ x, y, width, height });
  mainWindow.setResizable(false);
  mainWindow.setHasShadow(false);
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
  setTimeout(() => { if (mainWindow) mainWindow.setOpacity(1); }, 80);
});
ipcMain.handle("win-from-ball", () => {
  if (!mainWindow) return;
  mainWindow.setOpacity(0);
  if (savedBounds) { mainWindow.setBounds(savedBounds); savedBounds = null; }
  mainWindow.setResizable(true);
  mainWindow.setHasShadow(true);
  mainWindow.setIgnoreMouseEvents(false);
  setTimeout(() => { if (mainWindow) mainWindow.setOpacity(1); }, 80);
});
ipcMain.on("set-ignore-mouse", (e, ignore) => {
  if (!mainWindow) return;
  ignore ? mainWindow.setIgnoreMouseEvents(true, { forward: true }) : mainWindow.setIgnoreMouseEvents(false);
});

// ── Ball image config ──
const CONFIG_FILE = path.join(app.getPath("userData"), "ball-config.json");

function loadBallConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch (e) {}
  return {};
}

function saveBallConfig(cfg) {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg), "utf-8"); } catch (e) {}
}

ipcMain.handle("ball-get-image", () => {
  const cfg = loadBallConfig();
  return cfg.ballImage || null;
});

ipcMain.handle("ball-pick-image", async () => {
  const result = await dialog.showOpenDialog({
    title: "选择悬浮球图片",
    filters: [
      { name: "图片", extensions: ["png", "jpg", "jpeg", "gif", "webp", "apng", "svg", "bmp", "ico"] },
    ],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".gif": "image/gif", ".webp": "image/webp", ".apng": "image/apng",
    ".svg": "image/svg+xml", ".bmp": "image/bmp", ".ico": "image/x-icon",
  };
  const mime = mimeMap[ext] || "image/png";
  const buf = fs.readFileSync(filePath);
  const base64 = `data:${mime};base64,${buf.toString("base64")}`;
  const cfg = loadBallConfig();
  cfg.ballImage = base64;
  saveBallConfig(cfg);
  return base64;
});

ipcMain.on("ball-clear-image", () => {
  const cfg = loadBallConfig();
  delete cfg.ballImage;
  saveBallConfig(cfg);
});

// ── Sessions API (IPC, no HTTP) ──
ipcMain.handle("sessions-list", () => {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) return [];
    const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith(".jsonl"));
    const sessions = files.map(file => {
      const id = file.replace(".jsonl", "");
      const filePath = path.join(SESSIONS_DIR, file);
      const stat = fs.statSync(filePath);
      let preview = "", timestamp = stat.mtime.toISOString();
      try {
        for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
          if (!line.trim()) continue;
          const obj = JSON.parse(line);
          if (obj.type === "user" && obj.message?.content) {
            const c = obj.message.content;
            preview = typeof c === "string" ? c : JSON.stringify(c);
            timestamp = obj.timestamp || timestamp;
            break;
          }
        }
      } catch (e) {}
      return { id, preview: preview.slice(0, 80), timestamp };
    });
    sessions.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return sessions;
  } catch (err) { return []; }
});

ipcMain.handle("sessions-messages", (e, id) => {
  try {
    const filePath = path.join(SESSIONS_DIR, id + ".jsonl");
    if (!fs.existsSync(filePath)) return [];
    const messages = [];
    for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      const obj = JSON.parse(line);
      if (obj.type === "user" && obj.message?.content) {
        const c = obj.message.content;
        if (Array.isArray(c) && c[0]?.type === "tool_result") continue;
        messages.push({ role: "user", content: typeof c === "string" ? c : JSON.stringify(c), timestamp: obj.timestamp });
      }
      if (obj.type === "assistant" && obj.message?.content) {
        const blocks = Array.isArray(obj.message.content) ? obj.message.content : [obj.message.content];
        const parts = [];
        for (const b of blocks) {
          if (b.type === "text" && b.text) parts.push({ type: "text", text: b.text });
          else if (b.type === "tool_use") parts.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
          else if (b.type === "thinking" && b.thinking) parts.push({ type: "thinking", text: b.thinking });
        }
        if (parts.length > 0) {
          const last = messages[messages.length - 1];
          if (last && last.role === "assistant") last.parts.push(...parts);
          else messages.push({ role: "assistant", parts, timestamp: obj.timestamp });
        }
      }
    }
    return messages;
  } catch (err) { return []; }
});

ipcMain.handle("sessions-delete", (e, id) => {
  try {
    const filePath = path.join(SESSIONS_DIR, id + ".jsonl");
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { ok: true };
  } catch (err) { return { error: err.message }; }
});

// ── Claude CLI (IPC stream) ──
let claudeProcess = null;
let sessionId = null;

function setupProcess(e, userText) {
  const args = ["--output-format", "stream-json", "--input-format", "stream-json", "--verbose", "--max-turns", "10"];
  if (sessionId) args.push("--resume", sessionId);

  claudeProcess = spawn(CLAUDE_CMD, args, { stdio: ["pipe", "pipe", "pipe"], shell: true });
  let stderrBuf = "";
  claudeProcess.stderr.on("data", c => { stderrBuf += c.toString(); });
  claudeProcess.on("error", () => {
    e.sender.send("claude-error", "Failed to start claude");
  });
  claudeProcess.on("exit", code => {
    if (code !== 0 && code !== null) e.sender.send("claude-error", `Exit ${code}: ${stderrBuf.slice(0, 300)}`);
  });

  claudeProcess.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: userText } }) + "\n");

  const rl = readline.createInterface({ input: claudeProcess.stdout, crlfDelay: Infinity });
  rl.on("line", line => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.type === "system" && event.subtype === "init") {
        sessionId = event.session_id;
        e.sender.send("claude-init", { session_id: sessionId, model: event.model });
      } else if (event.type === "assistant") {
        const content = event.message?.content;
        if (!content) return;
        for (const block of Array.isArray(content) ? content : [content]) {
          if (block.type === "text") e.sender.send("claude-text", block.text);
          else if (block.type === "tool_use") e.sender.send("claude-tool", { id: block.id, name: block.name, input: block.input });
          else if (block.type === "thinking") e.sender.send("claude-thinking", block.thinking);
        }
      } else if (event.type === "permission_request") {
        e.sender.send("claude-permission", { id: event.id, tool: event.tool, input: event.input, description: event.description });
      } else if (event.type === "result") {
        sessionId = event.session_id;
        e.sender.send("claude-done", { session_id: sessionId, cost: event.total_cost_usd, usage: event.usage });
        claudeProcess = null;
      }
    } catch (e) {}
  });
  rl.on("close", () => {
    if (sessionId) e.sender.send("claude-done", { session_id: sessionId });
  });
}

ipcMain.on("claude-chat", (e, userText) => {
  if (claudeProcess) { claudeProcess.removeAllListeners(); claudeProcess.kill(); claudeProcess = null; }
  setupProcess(e, userText);
});

ipcMain.on("claude-permission-response", (e, { id, approved }) => {
  if (!claudeProcess) return;
  claudeProcess.stdin.write(JSON.stringify({ type: "permission_response", id, approved }) + "\n");
});

ipcMain.on("claude-stop", (e) => {
  if (claudeProcess) {
    claudeProcess.removeAllListeners();
    claudeProcess.kill();
    claudeProcess = null;
    e.sender.send("claude-done", { session_id: sessionId, stopped: true });
  }
});

ipcMain.on("claude-new-session", () => {
  sessionId = null;
  if (claudeProcess) { claudeProcess.kill(); claudeProcess = null; }
});

ipcMain.on("claude-resume", (e, id) => { sessionId = id; });

// ── App lifecycle ──
app.whenReady().then(() => {
  createWindow();
  createTray();
});
app.on("window-all-closed", () => { app.quit(); });
app.on("activate", () => { if (!mainWindow) createWindow(); });
