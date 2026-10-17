English | [简体中文](README.zh-CN.md)

# tyler-claude-mods

[![CI](https://github.com/tyler4400/tyler-claude-mods/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/tyler4400/tyler-claude-mods/actions/workflows/ci.yml)

[Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/) I use myself: plugins whose hooks module runs inside Claude Code. They need Claude Code 2.1.287 or later. Each mod is its own plugin under `mods/`, and `.claude-plugin/marketplace.json` at the root lists them as one marketplace.

Both mods work in the desktop app and the terminal.

## status-card

[![Mods Code: status-card](https://modscode.com/badge/tyler4400-status-card.svg)](https://modscode.com/claude-mods/mods/tyler4400-status-card/)

A three-line recap card above the prompt: the goal, what Claude is doing or just did, and what waits on you. Line two shows the turn's elapsed time. **Details** sums up the session's mainline and next steps in one paragraph that never enters the conversation, and **Fold** shrinks the card to a one-line capsule. The recap is saved per conversation, so it is still there after a restart. Built on the source of [where-am-i](https://github.com/hamzafer/claude-code-mods/tree/main/mods/where-am-i) by [hamzafer](https://github.com/hamzafer). [More →](mods/status-card/README.md)

<img src="mods/status-card/docs/card-waiting.en.svg" alt="status-card card" width="720">

## session-title

[![Mods Code: session-title](https://modscode.com/badge/tyler4400-session-title.svg)](https://modscode.com/claude-mods/mods/tyler4400-session-title/)

Keeps the session title in the form `前缀｜MMDD｜主体` (prefix｜month-day｜subject). After every turn Haiku checks whether the title still names what the session is working on, rewrites it when the mainline has moved on, and leaves it alone for a passing question. [More →](mods/session-title/README.md)

<img src="mods/session-title/docs/drift.en.svg" alt="How the title follows the session" width="720">

## Install

In Claude Code in a terminal (the desktop app's Code tab has no `/plugin install`; once installed from a terminal, desktop sessions load it too):

```
/plugin install status-card --marketplace tyler4400/tyler-claude-mods
```

Or from a shell:

```bash
claude plugin marketplace add tyler4400/tyler-claude-mods
claude plugin install status-card@tyler-claude-mods --scope user
```

For session-title, use `session-title` in place of `status-card`. Then start a new session, or run `/reload-plugins` in an open one.

## Security

Mods are not sandboxed; they run with the same permissions as Claude Code. Read the source before installing, or list the hooks a mod registers and the interfaces it calls with:

```bash
claude plugin validate mods/status-card
```

## Development

```bash
claude plugin validate mods/<name>   # check the manifest and hooks module
claude plugin test mods/<name>       # run *.test.ts
```

Add this folder as a local marketplace (`claude plugin marketplace add <this folder>`) and install from it. `/reload-plugins` re-reads the folder, but after an app restart Claude Code loads the copy made at install time under `~/.claude/plugins/cache/tyler-claude-mods/<name>/<version>/`. So after changing code, bump the version in `plugin.json` and run:

```bash
claude plugin marketplace update tyler-claude-mods
claude plugin update <name>@tyler-claude-mods
```

A local marketplace records this folder's path. If you delete or move the folder, installed mods keep running from the cache but can no longer be updated or installed; run `claude plugin marketplace remove tyler-claude-mods` first, then add it from GitHub as above.

## License

MIT. status-card builds on the source of [where-am-i](https://github.com/hamzafer/claude-code-mods/tree/main/mods/where-am-i) in [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) (MIT, Copyright (c) 2026 Hamza Zafar).
