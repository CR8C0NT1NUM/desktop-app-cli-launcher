# desktop-app-cli-launcher

A tiny, dependency-free helper for launching long-running **CLI tools from a packaged Electron/Tauri desktop app** — the kind that works perfectly under `npm start` and then mysteriously fails the moment you ship a real `.app`.

Born from wrapping a couple of Python trading bots + a local dashboard server into a one-click macOS app. It launched fine in dev, then the packaged build sat on a spinning splash forever. The log — once I found it — said it all: `zsh:1: command not found: uv`.

## The four gotchas (and why dev hides all of them)

When you run `electron .` from your terminal, the app inherits *your* shell environment — full PATH, your tools, everything. A double-clicked `.app` inherits almost none of that. So four problems that were invisible in dev all surface at once:

### 1. PATH — "command not found", but only in the packaged app
A GUI-launched app starts with a bare PATH (`/usr/bin:/bin:...`). The obvious fix is to spawn through a login shell (`zsh -lc`) so it sources your profile — **but a non-interactive login shell sources `~/.zprofile`, not `~/.zshrc`**, and tools installed by `uv`, `rustup`, `nvm`, `pyenv`, and Homebrew usually add themselves to PATH in `~/.zshrc`. So your tool is still missing.

The fix: prepend the common install dirs to PATH yourself, in the spawned command.

```bash
# Reproduce the bug in one line (strip the env like a GUI app does):
env -i HOME="$HOME" /bin/zsh -lc 'which uv'        # → uv not found
# With the prefix this repo applies:
env -i HOME="$HOME" /bin/zsh -lc 'export PATH="$HOME/.local/bin:$PATH"; which uv'   # → found
```

### 2. Detection — don't double-launch, don't skip a needed launch
If your app should start a process only when it isn't already running, you need to detect "already running" *accurately*. Naive `pgrep -f mytool` also matches the launcher wrappers (`uv`, `caffeinate`, `npm`) and **dying processes for a second after you kill them** — so you skip a launch you actually needed. Match the precise worker argv instead. (Also: a `pgrep` pattern that starts with `-` is parsed as a flag and errors — anchor on something else.)

Getting this wrong the other way — launching a second copy — can corrupt shared state if both write the same files.

### 3. Survival — children must outlive the window
The whole point is that closing the app doesn't stop your background work. Spawn `detached` and `unref()` so the children are reparented to `init` and keep running.

### 4. Logging — never `stdio: "ignore"` to nowhere
A silent launch failure is the worst kind. Redirect to a log file in the temp dir so a bad spawn is diagnosable instead of a blank spinner. (Note: in a packaged app `os.tmpdir()` is **not** `/tmp` — it's a per-user `/var/folders/...` path. Look there.)

## Usage

```js
const { launchDetached, isRunning, waitForHttp } = require("./launcher");
const PROJECT = "/Users/you/path/to/your/project";

async function ensureBackend() {
  // Start the worker only if it isn't already running (worker-precise match).
  if (!(await isRunning("python3 -m myapp.worker"))) {
    launchDetached("exec my-cli worker", { cwd: PROJECT, logName: "myapp-worker.log" });
  }
  // Start the local server if nothing is serving yet, then wait for it.
  if (!(await waitForHttp("http://127.0.0.1:9000/health", { tries: 1 }))) {
    launchDetached("exec my-cli serve --port 9000", { cwd: PROJECT, logName: "myapp-server.log" });
  }
  return waitForHttp("http://127.0.0.1:9000/health");
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ /* ... */ });
  win.loadFile("loading.html");
  if (await ensureBackend()) win.loadURL("http://127.0.0.1:9000");
});
```

## When to use

- An Electron/Tauri app that should launch + supervise CLI tools (a local server, a daemon, a worker) the user installed separately
- Any "double-click the app → it spins up the backend → shows the UI" desktop wrapper
- macOS specifically (the PATH/login-shell details are zsh + `/var/folders`); the *shape* generalizes to Linux/Windows with different specifics

## When NOT to use

- You bundle the runtime inside the app (no external CLI dependency) — you don't have a PATH problem
- You want the children to die with the app — drop `detached`/`unref()`
- You need cross-platform out of the box — this is macOS-flavored; adapt the shell + paths

## Installation

Until this lands on npm: copy `launcher.js` into your Electron main process. ~90 lines, zero dependencies.

## The story

📖 **[My app worked perfectly — until I double-clicked it](./WRITEUP.md)** — the full write-up: the spinning splash, finding the log in the wrong `/tmp`, the `command not found: uv`, the `~/.zshrc`-vs-`~/.zprofile` trap, and the `env -i` reproduction.

## License

MIT. See `LICENSE`.
