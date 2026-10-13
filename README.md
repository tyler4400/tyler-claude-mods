English | [简体中文](README.zh-CN.md)

# tyler-claude-mods

[Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/) I use myself: plugins whose hooks module runs inside Claude Code. They need Claude Code 2.1.287 or later. Each mod is its own plugin under `mods/`, and `.claude-plugin/marketplace.json` at the root lists them as one marketplace.

| Mod | What it does | Where |
| --- | --- | --- |
| [where-am-i](mods/where-am-i/README.md) | A recap card above the prompt: goal, now, next step, what waits on you. Kept across restarts, with one-paragraph details and a fold-to-capsule button | desktop, terminal |
| [session-title](mods/session-title/README.md) | Keeps the session title in the form `前缀｜MMDD｜主体` with Haiku, and follows the session when its mainline moves | desktop, terminal |

<img src="mods/where-am-i/docs/card-waiting.en.svg" alt="where-am-i card" width="720">

## Install

In Claude Code in a terminal (the desktop app's Code tab has no `/plugin install`; once installed from a terminal, desktop sessions load it too):

```
/plugin install where-am-i --marketplace tyler4400/tyler-claude-mods
```

Or from a shell:

```bash
claude plugin marketplace add tyler4400/tyler-claude-mods
claude plugin install where-am-i@tyler-claude-mods --scope user
```

Then start a new session, or run `/reload-plugins` in an open one.

## Security

Mods are not sandboxed; they run with the same permissions as Claude Code. Read the source before installing, or list the hooks a mod registers and the interfaces it calls with:

```bash
claude plugin validate mods/where-am-i
```

## Development

```bash
claude plugin validate mods/<name>   # check the manifest and hooks module
claude plugin test mods/<name>       # run *.test.ts
```

Add this folder as a local marketplace (`claude plugin marketplace add <this folder>`) and install from it. `/reload-plugins` re-reads the folder, but after an app restart Claude Code loads the copy cached at install time. So after changing code, bump the version in `plugin.json` and run `claude plugin update <name>@tyler-claude-mods`.

## License

MIT. where-am-i is forked from the mod of the same name in [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) (MIT, Copyright (c) 2026 Hamza Zafar).
