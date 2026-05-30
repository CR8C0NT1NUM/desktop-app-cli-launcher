#!/usr/bin/env bash
# Reproduce the core PATH gotcha that makes a packaged desktop app fail with
# "command not found" even though the tool runs fine in your terminal.
#
# `env -i` strips the environment to nothing (keeping only HOME), which is a
# decent stand-in for the bare environment a double-clicked .app gets.
#
# Swap `uv` for whatever CLI your app launches (rustc, node, pyenv shims, ...).
set -u
TOOL="${1:-uv}"

echo "1) Bare login shell (what the packaged app effectively does):"
env -i HOME="$HOME" /bin/zsh -lc "which $TOOL" \
  && echo "   ...found (your dotfiles must put it in ~/.zprofile)" \
  || echo "   ✗ $TOOL NOT FOUND  <-- this is the bug"

echo
echo "2) Same shell, but with the install dirs prepended (the fix):"
env -i HOME="$HOME" /bin/zsh -lc \
  'export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$HOME/.cargo/bin:$PATH"; which '"$TOOL" \
  && echo "   ✓ resolved" \
  || echo "   still not found — add $TOOL's install dir to the PATH prefix"
