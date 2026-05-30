// desktop-app-cli-launcher
//
// Robustly launch and detect long-running CLI processes from a *packaged*
// Electron/Tauri desktop app — surviving the four gotchas that bite when you
// move from `npm start` to a real .app:
//
//   1. PATH      — a GUI-launched app gets a bare PATH, and a login shell only
//                  sources the profile (not ~/.zshrc), so your tool is "not found".
//   2. detection — naive process matching catches dying wrappers and double-launches.
//   3. survival  — children must outlive the app window, not die when it closes.
//   4. logging   — silent stdio hides the one failure you need to see.
//
// Zero dependencies beyond Node's built-ins (child_process, path, os).
// MIT licensed. See README.md for the full story.

"use strict";

const { spawn, exec } = require("child_process");
const path = require("path");
const os = require("os");

// (1) PATH. GUI apps inherit almost nothing, and `zsh -lc` (login, non-
// interactive) sources ~/.zprofile but NOT ~/.zshrc — which is where tools
// installed by uv/rustup/nvm/pyenv/Homebrew usually put themselves. So prepend
// the common install dirs ourselves. Add your own if your tool lives elsewhere.
const DEFAULT_TOOL_DIRS = [
  "$HOME/.local/bin",     // uv, pipx, many *-up installers
  "/opt/homebrew/bin",    // Homebrew on Apple Silicon
  "/usr/local/bin",       // Homebrew on Intel, /usr/local installs
  "$HOME/.cargo/bin",     // rustup
];

/**
 * Spawn a shell command detached, with a PATH that can actually find your CLI
 * tools, and with output captured to a log file (never /dev/null).
 *
 * @param {string} command   shell command, e.g. `exec my-cli serve --port 9000`
 * @param {object} [opts]
 * @param {string} opts.cwd          working directory (your project root)
 * @param {string} opts.logName      file name written under os.tmpdir()
 * @param {string[]} [opts.toolDirs] PATH dirs to prepend (defaults above)
 * @returns {import('child_process').ChildProcess}
 */
function launchDetached(command, { cwd, logName, toolDirs = DEFAULT_TOOL_DIRS } = {}) {
  const logPath = path.join(os.tmpdir(), logName || "cli-launcher.log");
  const pathPrefix = `export PATH="${toolDirs.join(":")}:$PATH"; `;
  // (3) survival: detached + unref() so the child keeps running after the app
  // (and even this Node process) exits. (4) logging: redirect to a real file.
  const child = spawn(
    "/bin/zsh",
    ["-lc", `${pathPrefix}${command} >> ${JSON.stringify(logPath)} 2>&1`],
    { cwd, detached: true, stdio: "ignore" }
  );
  child.unref();
  return child;
}

/**
 * (2) detection. Is the *actual worker* already running? Match the precise
 * argv of the running program — NOT just the module/script name, which also
 * matches launcher wrappers (uv, caffeinate, npm) and dying processes for a
 * second after they're killed. Matching the wrong thing makes you either
 * skip a launch you needed, or double-launch and corrupt shared state.
 *
 * Tip: a pgrep pattern that *starts* with `-` (e.g. `-m mymodule`) is parsed
 * as a flag and errors. Anchor on something that isn't a dash.
 *
 * @param {string} workerPattern  e.g. `python3 -m myapp.worker` or `node dist/server.js`
 * @returns {Promise<boolean>}
 */
function isRunning(workerPattern) {
  return new Promise((resolve) => {
    exec(`pgrep -f ${JSON.stringify(workerPattern)}`, (_err, stdout) =>
      resolve(Boolean(stdout && stdout.trim())));
  });
}

/**
 * Poll an HTTP endpoint until it answers 200 (or times out). Handy for "wait
 * for the server I just launched to be ready" before loading it in a window.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {number} [opts.tries=60]
 * @param {number} [opts.intervalMs=500]
 * @returns {Promise<boolean>}
 */
async function waitForHttp(url, { tries = 60, intervalMs = 500 } = {}) {
  const http = url.startsWith("https") ? require("https") : require("http");
  const ok = () =>
    new Promise((resolve) => {
      const req = http.get(url, (r) => { resolve(r.statusCode === 200); r.resume(); });
      req.on("error", () => resolve(false));
      req.setTimeout(1500, () => { req.destroy(); resolve(false); });
    });
  for (let i = 0; i < tries; i++) {
    if (await ok()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

module.exports = { launchDetached, isRunning, waitForHttp, DEFAULT_TOOL_DIRS };
