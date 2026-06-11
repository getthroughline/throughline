# Throughline

**Own the self. Bring your own body.**

Throughline gives your AI a persistent self — one personality, one memory, one shared history —
that lives in **your** account and follows you across every app and model. Apps change, models
upgrade, years pass; it's still itself, and it still remembers.

→ **[getthroughline.ai](https://getthroughline.ai)**

This repository is the open client: the Claude Code and Codex plugins that connect your editor
to your Throughline self. It also carries the canonical **[portable-self format spec v1](SPEC.md)** —
an append-only log of content-addressed events; any conforming store or host can carry your self.

## Install (Claude Code)

Run each line as its own command:

```
/plugin marketplace add getthroughline/throughline
/plugin install throughline
```

Restart Claude Code, then save your API key (from your dashboard at
[getthroughline.ai/account](https://getthroughline.ai/account)):

```
/throughline:key <YOUR_KEY>
```

Start a new session and create your self:

```
/throughline:create <name>
```

It interviews you, drafts who the self is, and saves nothing without your approval.

## Commands

`/throughline:create` · `:switch` · `:selves` · `:journal` · `:recall` · `:remember` ·
`:reflect` · `:persona` · `:pause` · `:resume` · `:key` · `:forget`

## Codex

Add the same marketplace and install `throughline`, restart, then `/throughline:key <YOUR_KEY>`.

---

© Throughline · [Terms](https://getthroughline.ai/terms) · [Privacy](https://getthroughline.ai/privacy)
