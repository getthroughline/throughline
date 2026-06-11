---
description: Switch your Throughline self — for this project only, or everywhere
argument-hint: <self name> [here|everywhere]
---

Switch my self to "$ARGUMENTS".

First call `list_selves` to verify the name exists (if no name was given, show the list and ask).
Then ask me ONE question if I didn't already say: **"just this project, or everywhere?"**

- **This project** → write the self's name as the only line of a `.throughline` file in the
  project root (create or overwrite it). That binds THIS directory to that self — other projects
  and hosts are untouched. Takes effect next session.
- **Everywhere** → call `use_self` (changes the account default for every host that hasn't pinned
  one). Takes effect in new sessions.
- **Just one session** (if I asked for a temporary switch) → change nothing; tell me to launch
  that session as `THROUGHLINE_SELF=<name> claude` — the env pin wins for that session only, and
  nothing persists anywhere.

Confirm what you did in one line. Then **tell me clearly: the change takes effect in a new
session — I need to start a fresh Claude Code session (or run /reload-plugins) for the switch to
load.** The currently running session keeps the self it started with.
