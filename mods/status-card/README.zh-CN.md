[English](README.md) | 简体中文

# status-card

[![Mods Code](https://modscode.com/badge/tyler4400-status-card.svg)](https://modscode.com/claude-mods/mods/tyler4400-status-card/)

输入框上方的会话摘要卡片：目标、现在在做什么、等你处理的事。摘要按对话保存，重启 app 或几天后回看旧会话，卡片还在。适合长会话：离开一会儿再回来，一眼就能接上。

<img src="docs/card-waiting.zh.svg" alt="等你处理、展开了详情的卡片" width="720">

<img src="docs/card-idle.zh.svg" alt="空闲状态的卡片" width="720">

> 借鉴了 [hamzafer](https://github.com/hamzafer) 的 [where-am-i](https://github.com/hamzafer/claude-code-mods/tree/main/mods/where-am-i) 源码，详见 [致谢](#致谢)。

截图用示例数据画出，由 [docs/render_screenshots.py](docs/render_screenshots.py) 生成。

## 卡片上有什么

固定三行：

1. **🎯 目标**：整个会话的主线，只在你换了一件事做时才改。右侧是 **第 N 轮 · 更新时间**（工作中 N 是正在进行的这一轮；更新时间只在当天显示 `HH:mm`，其他日子不显示，对话里每条回复本来就有日期时间）。轮到你时，时间后面是**缓存提示**，见下方。
2. **现在**：Claude 工作时显示工作色的圆点和 **本轮：一句话目标**，一轮结束后显示 **✅** 和这一轮做了什么。右侧是 **调用次数 · 改了几个文件 · 用时**：工作中每秒更新，结束后保留这一轮的最终数字，重启后也在。不重复原生界面里逐条跳动的工具状态。
3. **⏳ 等你**：Claude 需要你处理的事。Claude 工作时（第二行已经说了在做什么）和没有要你处理的事时留空。右侧是 **详情** 和 **折叠** 两个按钮。

窗口变窄时，右侧的轮次、时间、缓存提示、统计和按钮保持完整，截断的是左侧文字。

- **缓存提示**：Claude 的提示缓存还剩多久，纯文字：剩 10 分钟以上是暗色的 `缓存还剩 45 分`，10 分钟以内是红色的 `缓存仅剩 6 分`，过期后是暗色的 `缓存过期`；趁缓存还在时接着聊，能省下重新写入整段上下文的费用。从主线程最后一次请求发出时算起，时长（5 分钟或 1 小时）从这个 session 的 transcript 里读；读不到时不显示。按模型分开记：切到这次还没用过的模型显示过期，切回原来的模型时继续显示它的剩余时间。缓存不是今天用的（如回看昨天的会话）时不显示。只在轮到你时显示，Claude 工作时不显示。

- **卡片边框颜色**表示状态：工作中、等你、空闲各一种颜色。
- **详情**：隔了很久回来、忘了这个会话在做什么时，用一段两三句话（中文最多 180 字）帮你接上：整个会话的主线和原因、做到哪了、接下来该做什么（包括说好但还没做的事）。从主线讲起，不会只讲最近的小问题。只画在卡片里，**不进入对话上下文**。按轮次缓存，没有新的一轮就不重新生成；展开状态下有新的一轮会自动刷新。
- **折叠**：把卡片收成一行胶囊，只显示一项：工作中是工作色圆点加"本轮：…"；有等你处理的事时是"⏳ 等你：…"；否则是 ✅ 加目标；右侧不显示轮次，工作中是更新时间和用时，轮到你时是更新时间和缓存提示，最后是 **展开** 按钮。胶囊按内容宽度显示，最宽撑满一行，放不下时先截断左侧文字。折叠状态跨会话保留。

## 安装

在终端的 Claude Code 里：

```
/plugin install status-card --marketplace tyler4400/tyler-claude-mods
```

或者在 shell 里：

```bash
claude plugin marketplace add tyler4400/tyler-claude-mods
claude plugin install status-card@tyler-claude-mods --scope user
```

第一轮你发出消息后卡片就出现；第一份摘要出来前，目标行显示「目标会在这一轮结束后总结」。在一轮进行中途装上的话，这一轮的卡片右侧没有调用次数和用时，下一轮开始显示。

**从 where-am-i 或 goal-card 升级：** 这是同一个 mod 的旧名字。先卸载旧的再装 status-card；摘要记录按 plugin 名分开保存，旧记录不会带过来。

```bash
claude plugin uninstall where-am-i@tyler-claude-mods   # 或 goal-card@tyler-claude-mods
claude plugin install status-card@tyler-claude-mods --scope user
```

## 配置

在 `/config` 或 `/plugin configure status-card@tyler-claude-mods` 里修改，改完自动生效。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `language` | `auto` | 摘要语言：`auto` 按你最近亲手发的消息判断中文或英文（后台通知、其他会话的消息不算）；`zh`；`en` |
| `model` | `haiku` | 生成摘要和详情用的模型 |
| `accentColor` | `suggestion` | 工作中的颜色：主题色名（`suggestion`、`claude`、`success`、`warning`、`error` 等）或 `#hex` |
| `waitingColor` | `warning` | 等你处理时的颜色 |
| `idleColor` | `success` | 空闲时的颜色 |
| `borderStyle` | `round` | 卡片边框：`round`、`single`、`bold`、`double`、`none` |
| `density` | `comfortable` | 行距：`comfortable` 行与行之间空一行；`compact` 紧凑 |
| `showMeta` | `true` | 显示"第 N 轮 · 时间" |
| `retentionDays` | `30` | 超过这么多天没更新的会话摘要会被清理 |

## 怎么工作的

**每轮两次模型调用。** 你发出消息时，后台调用一次 `haiku`，根据你的消息（开头 1000 + 结尾 500 字）和上一份摘要写出"本轮：…"那一句话，输出上限 80 token。

主对话每一轮结束后，再调用一次 `haiku` 更新摘要，输入是：

- 上一份摘要和**整个会话的滚动总结**（每轮在上一份基础上更新，最多约 400 字，依次是主线、已完成的里程碑、当前的小问题、还没做的待办）；
- 你在这个会话里发过的全部消息，每条取开头 150 字，超过 15 条时保留最早 3 条和最近 12 条，用来认出主线，避免被眼前的小问题带偏；
- 你这一轮的消息（开头 1000 字 + 结尾 500 字）；
- 这一轮工具调用的简短标签（命令的描述或前 60 个字符、文件路径、搜索词）；
- Claude 的回复（开头 1500 字 + 结尾 1500 字）。

超长内容保留头尾、中间注明省略了多少字，并告诉模型这是有意截断，避免它以为信息不完整。输出上限 700 token。

**展开详情**时再调用一次，输入是滚动总结、最新卡片、你发过的全部消息（同上）和最近 6 条消息（每条开头 600 + 结尾 600 字），输出两三句话，上限 400 token。

这些都是真实的模型请求，会计入你的用量。

**数据存在哪：** Claude Code 为每个 plugin 提供的 `$.store`，即 `~/.claude/plugins/store/` 下本 plugin 的 JSON 文件。每个 session 一条记录（最新摘要、滚动总结、轮次、更新时间、语言、上一轮统计、缓存的详情）和一条提示缓存状态（每个模型最后一次请求的时间和缓存时长），外加一个折叠偏好。超过 `retentionDays` 没更新的记录在会话启动时清理。

记录按 session id 存：续接、压缩上下文都不换 id，卡片原样找回。fork 或右键 Start a side chat 开出来的 session 会换新 id，它的 transcript 开头是从原对话复制来的条目、仍带着原 session 的 id，status-card 据此复制一份原卡片，之后两边各自更新。0.5.x 按"工作目录 + 第一条消息"指纹存的旧记录，只通过当时记下的 session id 对应关系迁移过来。

**它会做什么、不会做什么：** `tool.call` 只观察，调用原样放行，用来统计调用次数和被 Edit/Write 改过的文件；不改你的消息、不改 Claude 的回复。除了上面的模型调用，只在会话启动时运行一次 `date +%z` 取本机时区；当前 session 还没有卡片时，用 `grep` 从它自己的 transcript 里读出 `sessionId`，用来认出 fork 或 side chat 的原 session；每轮结束时用 `grep` 和 `tail` 读出 transcript 里最近几条含 `ephemeral_` 的行，得到这次写入提示缓存用的时长。没有其他网络请求，除此之外不读写 store 以外的文件。

Hooks：`session.start`、`classic.SessionStart`、`classic.UserPromptSubmit`、`classic.PostModelSwitch`、`session.end`、`prompt.submit`、`tool.call`、`turn.step`（只记请求发出的时间）、`turn.complete`、`ui.render`（`AbovePrompt`）。

## 局限

- 认 fork 和 side chat 的原 session 要读 transcript：如果 Claude Code 的 transcript 格式变了，它们会从空卡片开始，不会拿错别的会话的卡片。
- 缓存时长从 transcript 的 `usage.cache_creation` 读：如果 Claude Code 的 transcript 格式变了，缓存提示不再显示，不会显示错的时间。剩余时间是按最后一次请求推算的，不是向 API 查询的结果；在别处（如另一个进程）续接同一个会话发了请求时，这里不会知道。
- 模型调用失败或返回格式不对时，保留上一份摘要。
- 轮次是会话里你发出的、带文字的消息数，斜杠命令也会被计入；上下文压缩后只会继续往上加，不会倒退。
- 只在 Claude Code 的 desktop 和终端里绘制；VS Code 插件和 `claude -p` 里不显示。
- 在 Claude Code 2.1.294 / 2.1.295 / 2.1.299 上用 `claude plugin validate` 和 `claude plugin test` 验证过。

## 致谢

借鉴了 [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) 中 [where-am-i](https://github.com/hamzafer/claude-code-mods/tree/main/mods/where-am-i) 的源码（MIT，Copyright (c) 2026 Hamza Zafar），原名 where-am-i，为避免和原版重名改为 status-card。在原版基础上改为卡片样式，加上持久化、滚动总结、语言跟随、详情、折叠和可配置项。
