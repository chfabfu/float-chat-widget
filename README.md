# Claude Code Web

A floating desktop assistant for [Claude Code](https://claude.ai/code), built with Electron.

## Features

- **Floating chat window** - Always-on-top, draggable, frameless window
- **Ball mode** - Minimize to a floating ball that stays out of your way
- **Session management** - Browse and resume previous conversations
- **Markdown rendering** - Syntax highlighting for code blocks
- **System tray** - Minimize to tray when not needed

## Prerequisites

- [Claude Code CLI](https://claude.ai/code) installed and in PATH (`npm install -g @anthropic-ai/claude-code`)
- Node.js 18+

## Installation

```bash
git clone https://github.com/yourusername/claude-code-web.git
cd claude-code-web
npm install
```

## Usage

```bash
npm run app
```

## Building

### Option 1: Manual asar packaging (recommended)

```bash
# Copy Electron distribution
mkdir -p output
cp -r node_modules/electron/dist/* output/

# Rename executable (Windows)
mv output/electron.exe output/Claude\ Code\ Web.exe

# Pack app into asar
npx asar pack . output/resources/app.asar --unpack-dir node_modules
```

### Option 2: electron-builder

```bash
npm run build
```

> Note: electron-builder may be slow to download in some regions.

## How it works

The app calls the system `claude` CLI with `--output-format stream-json` and streams responses via IPC. This means CLI updates are applied automatically without repackaging.

## Screenshots

*(Add screenshots here)*

## License

MIT
