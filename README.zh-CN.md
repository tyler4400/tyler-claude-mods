[English](README.md) | 简体中文

# tyler-claude-mods

我自己在用的 [Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/)：hooks 模块在 Claude Code 里运行的 plugin，需要 Claude Code 2.1.287 或更高版本。每个 mod 是 `mods/` 下的一个独立 plugin，仓库根目录的 `.claude-plugin/marketplace.json` 把它们登记为一个 marketplace。

两个 mod 在 desktop 和终端里都能用。

## status-card

输入框上方的三行会话卡片：目标、Claude 正在做或刚做完什么、等你处理的事。第二行保留这一轮的调用次数、改动文件数和用时。**详情** 用一段话总结会话主线和接下来该做什么，不进入对话上下文；**折叠** 把卡片收成一行胶囊。摘要按对话保存，重启后还在。借鉴了 [hamzafer](https://github.com/hamzafer) 的 [where-am-i](https://github.com/hamzafer/claude-code-mods/tree/main/mods/where-am-i) 源码。[详细说明 →](mods/status-card/README.zh-CN.md)

<img src="mods/status-card/docs/card-waiting.zh.svg" alt="status-card 卡片" width="720">

## session-title

按「前缀｜MMDD｜主体」维护会话标题。每轮结束后由 Haiku 判断标题是否还说得出会话现在在做的事：主线变了就改，临时插问不动。[详细说明 →](mods/session-title/README.zh-CN.md)

<img src="mods/session-title/docs/drift.zh.svg" alt="标题怎么跟着主线走" width="720">

## 安装

在终端的 Claude Code 里（desktop 的 Code 标签页不支持 `/plugin install`，在终端装好后 desktop 会话也会加载）：

```
/plugin install status-card --marketplace tyler4400/tyler-claude-mods
```

或者在 shell 里：

```bash
claude plugin marketplace add tyler4400/tyler-claude-mods
claude plugin install status-card@tyler-claude-mods --scope user
```

安装 session-title 时把 `status-card` 换成 `session-title`。装好后新开会话，或在已打开的会话里运行 `/reload-plugins`。

## 安全

mod 不在沙箱里运行，权限和 Claude Code 一样。安装前可以先读源码，或用下面的命令列出它注册了哪些 hook、调用了哪些接口：

```bash
claude plugin validate mods/status-card
```

## 开发

```bash
claude plugin validate mods/<name>   # 检查 manifest 和 hooks 模块
claude plugin test mods/<name>       # 跑 *.test.ts
```

本机把这个目录加为 marketplace（`claude plugin marketplace add <本目录>`）后安装。`/reload-plugins` 会重新读取目录，但重启 app 后加载的是安装时复制到 `~/.claude/plugins/cache/tyler-claude-mods/<name>/<version>/` 的副本，所以改完代码要升 `plugin.json` 的版本，再运行：

```bash
claude plugin marketplace update tyler-claude-mods
claude plugin update <name>@tyler-claude-mods
```

本地 marketplace 记的是这个目录的路径。删掉或移走目录后，已装的 mod 仍从缓存运行，但无法再更新或安装；要先 `claude plugin marketplace remove tyler-claude-mods`，再按上面的方式从 GitHub 添加。

## License

MIT。status-card 借鉴了 [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) 中 [where-am-i](https://github.com/hamzafer/claude-code-mods/tree/main/mods/where-am-i) 的源码（MIT，Copyright (c) 2026 Hamza Zafar）。
