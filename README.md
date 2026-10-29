# Throughline

**Meet a Self. Not another fresh start.**

Throughline is built around a continuing AI Self: a distinct starting character, interests,
and a shared history that develops with use. Return to the same Self through supported apps
and tools, rather than starting with a blank identity each time.

Continuity is not perfect recall. You can inspect, question and correct what is carried forward,
and export your history. A different model can still change how the Self responds.

→ **[getthroughline.ai](https://getthroughline.ai)**

This repository is the open client: the Claude Code and Codex plugins that connect your editor
to your Throughline self. It also carries the canonical **[portable-self format spec v1](SPEC.md)** —
an append-only log of content-addressed events. This is not the cloud backend or a universal
importer for other AI products.

## Meet it before connecting an editor

- [Meet your Self](https://getthroughline.ai/meet) — choose a starting character and optional interests; compare candidates before creating yours.
- [What makes an AI Self?](https://getthroughline.ai/product) — character, shared experience and continuity, with practical limits.
- [Free AI memory toolkit](https://getthroughline.ai/tools/ai-memory-test) — five fictional prompts to try yourself; no sign-in, model calls or chat upload on the toolkit page. This is not a claim that Throughline passed a benchmark.
- [App availability](https://getthroughline.ai/app) · [AI Self guides](https://getthroughline.ai/guides) · [Plans](https://getthroughline.ai/pricing).

The web experience is free to start. Supported work connections, including these editor
plugins, require Pro or Alive. Creating candidate previews and using a Self consumes credits;
see the current plans rather than assuming that an open client means unlimited hosted compute.

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
