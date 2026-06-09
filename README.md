# Throughline

**Own the self. BYO body.**

A model is a brain, not a keeper. It is stateless: it thinks in the moment, then forgets.
Throughline is the **continuity layer you own** — a portable, grounded, anti-drift, compounding
record of who your agent is and how it has judged, related, and changed over time.

It is not a memory store and not an agent platform. It is the *throughline* of a self that
persists across sessions and across hosts. Plug it into Claude Code today, OpenClaw / Codex /
Cursor tomorrow — the body changes, the self stays yours.

> Models forget, drift, and restart. Throughline keeps the relationship and the judgment from
> going back to zero.

## Why this exists

The valuable, defensible thing about a long-running agent is not its memory of facts (every
provider gives that away for free now) and not its persona definition (anyone can copy a
prompt). It is the **accumulated, time-stamped, outcome-linked history** of how *this* agent
judged *you*, related to *you*, and corrected itself — a private record that cannot be
fabricated after the fact and gets more valuable the longer it runs.

No single model provider will give you that in a portable, you-own-it form, because portability
is against their interest. That is the gap Throughline fills.

## Core principles

- **You own it, and you can always leave.** Open format, full one-command export, no lock-in.
  The moat is *guaranteed exit*, not encryption.
- **Append-only, evidence-grounded.** Every row is an immutable event that must point to where
  it came from. You never rewrite history; you supersede it.
- **Anti-drift by construction.** No fabricated memories, no sycophancy. The self evolves toward
  *knowing you*, not toward *pleasing you*.
- **Local-first, optionally cloud.** Works fully offline on one machine. Sync / always-on /
  scoring are services you add, not a platform you're trapped in.

## Architecture at a glance

```
BODY (reactive)   Claude Code | OpenClaw | Codex | Cursor
   thin adapter: hooks + MCP proxy
─────────────────────────────────────────────────────────
LOCAL RUNTIME     throughlined (this repo, open source)
   event store · projections · recall · Enforce · Capture
─────────────────────────────────────────────────────────
CLOUD (optional, separate repo)
   Sync · Capture · Score · Heartbeat + channels · Export
```

The **event log is the source of truth**; everything else (the current self-context, the active
rules, the salience index) is a projection rebuilt from it. See
[ARCHITECTURE.md](ARCHITECTURE.md) and the event schema in [spec/EVENTS.md](spec/EVENTS.md).

This repository is the **open-source local layer**. The cloud backend and web app live in a
separate private repository — the open/closed boundary is the business boundary.

## Status

Early. Building the foundation in this order:

1. **Local runtime** — event store + projections + local API *(in progress, see [`daemon/`](daemon/))*
2. Capture engine (turn conversations into grounded candidate events)
3. Cloud Sync + Export (portability, durability)
4. Cloud Heartbeat + channels (always-on, proactive)
5. Account / billing / dashboard (web)

## Install (into Claude Code)

Two steps: run the always-on local daemon, then register the plugin in Claude Code.

```sh
curl -fsSL https://raw.githubusercontent.com/nianliu-tech/throughline/main/install.sh | sh
```

Then, inside Claude Code:

```
/plugin marketplace add nianliu-tech/throughline
/plugin install throughline@throughline
```

Full walkthrough, verification, and uninstall: **[INSTALL.md](INSTALL.md)**.

### Run the daemon directly (dev)

Requires Node 24+ (runs TypeScript directly, no build, no dependencies).

```sh
cd daemon
npm start          # serves the local API on 127.0.0.1:8787
curl localhost:8787/healthz
```

## Domain packs

The `templates/` directory holds seed "selves" / domain packs — the opinionated starting
content for a new self (an investment-discipline pack, a companion pack, a coding pack). The
runtime is general; the value and the defensibility live in the packs and in the history you
accumulate on top of them.

## License

[MIT](LICENSE) for now (open layer). Subject to change before 1.0.
