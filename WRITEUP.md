# My app worked perfectly — until I double-clicked it

*The war story behind this pattern. — Cameron Meese*

I'd wrapped a couple of Python trading bots and a little local dashboard server into a one-click macOS app. The idea was simple: double-click an icon, the backend spins up, the UI appears. No terminal, no `uv run` incantations, no remembering which thing to start first.

Under `npm start` it was flawless. Spun up the bots, served the dashboard, loaded the window. Ship it.

Then I packaged it into a real `.app`, double-clicked it like a normal human would, and watched it sit on a spinning "waiting for dashboard…" splash. Forever.

This is the story of the four things that only break once you leave the terminal behind.

## The first problem: finding out what broke at all

The worst part of a packaged app failing is that there's nothing to read. No terminal, no stack trace, just a window that never advances. My first instinct — dump logs — ran straight into the second lesson of this whole saga: **in a packaged app, `os.tmpdir()` is not `/tmp`.** It's a per-user `/var/folders/…/T/` path. I'd been tailing `/tmp` like an idiot while the real log sat somewhere I wasn't looking.

Once I found it, the whole mystery collapsed into one line:

```
zsh:1: command not found: uv
```

## Why dev hid everything

Here's the thing that took me a beat to internalize. When you run `electron .` from your terminal, the app inherits *your* shell environment — your full PATH, your tools, all of it. A double-clicked `.app` inherits almost none of that. It launches from a bare GUI context with a minimal PATH like `/usr/bin:/bin`.

So `uv` — installed in `~/.local/bin`, perfectly on my PATH in every terminal I'd ever tested in — simply did not exist as far as the packaged app was concerned. Dev mode had been quietly papering over the problem the entire time.

And the "obvious" fix has a trap in it. *Just spawn through a login shell so it sources my profile,* right? `zsh -lc`. Except a non-interactive login shell sources `~/.zprofile`, **not** `~/.zshrc` — and `uv`, `nvm`, `pyenv`, `rustup`, and Homebrew almost all add themselves to PATH in `~/.zshrc`. So the login shell trick runs, feels clever, and still can't find your tool.

I reproduced it in one line, which is the moment it stopped being spooky and started being a bug:

```bash
# Strip the env down to what a GUI app gets:
env -i HOME="$HOME" /bin/zsh -lc 'which uv'        # → not found
# Prepend the install dir yourself:
env -i HOME="$HOME" /bin/zsh -lc 'export PATH="$HOME/.local/bin:$PATH"; which uv'   # → found
```

The fix wasn't a shell trick. It was: stop relying on the profile, and prepend the common install dirs to PATH explicitly, in the command I spawn.

## The three that were waiting behind it

Fixing PATH got the backend launching — and exposed three more things dev had been hiding.

**Detection.** I only wanted to start the bots if they weren't already running. Naive `pgrep -f mytool` is a trap: it also matches the wrapper processes (`uv`, `caffeinate`, `npm`) *and* matches a process you just killed for a second or two while it dies. So you think it's still running, skip the launch you actually needed, and you're back to a dead backend. The fix is to match the precise worker argv, not a loose substring. (Bonus gotcha: a `pgrep` pattern that *starts* with `-` gets parsed as a flag and errors out. Anchor on something else.)

**Survival.** The entire point of this app is that closing the window doesn't kill your background work. That doesn't happen for free — you have to spawn the children `detached` and `unref()` them so they get reparented to `init` and outlive the app.

**Logging.** And the one that started this whole mess: never `stdio: "ignore"` into the void. A silent launch failure is the worst possible failure, because it gives you a spinning splash and nothing to debug. Redirect to a log file — in the *right* temp dir — so the next time something breaks, it tells you instead of just hanging.

## What I'd tell past me

`npm start` is not a test of your packaged app. It's a test of your *dev environment*, which is a completely different machine wearing your app's clothes. The terminal hands your app a rich inherited world — PATH, tools, stdio you can see — and the packaged `.app` strips all of it away.

So when something works in dev and dies on double-click, don't look for a logic bug. Look for an *assumption about the environment* that was true in the terminal and false in the wild.

I pulled the four fixes into a tiny, zero-dependency helper so I never have to rediscover them: [`desktop-app-cli-launcher`](https://github.com/CR8C0NT1NUM/desktop-app-cli-launcher). About 90 lines. May it save you the hour I spent tailing the wrong `/tmp`.
