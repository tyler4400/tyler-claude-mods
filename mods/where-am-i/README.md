# where-am-i

A recap card above the Claude Code prompt: the goal, what is happening now, the next step and what waits on you. The recap is saved per session, so it is still there after a restart or when you open an old session. Open the details for a one-paragraph summary of the session that never enters the conversation, or fold it into a one-line capsule.

输入框上方的会话摘要卡片。适合长会话：离开一会儿再回来，或者几天后回看旧会话，一眼就能接上。

## 卡片上有什么

固定三行：

1. **🎯 目标**：整个会话的目标，只在明显变化时才改。右侧是 **第 N 轮 · 更新时间**（当天只显示时间，其他日子带日期）。
2. **● 现在**：Claude 工作时显示 **本轮：一句话目标**，右侧是 **调用次数 · 改了几个文件 · 已用时**（每秒更新），不重复原生界面里逐条跳动的工具状态；一轮结束后左侧显示这一轮做了什么，右侧保留这一轮的最终统计。
3. **⏳ 等你** 或 **→ 下一步**：Claude 需要你处理什么时显示"等你"，否则显示下一步。右侧是 **详情** 和 **折叠** 两个按钮。

窗口变窄时，右侧的轮次、时间和按钮保持完整，截断的是左侧文字。

- **卡片边框颜色**表示状态：工作中、等你、空闲各一种颜色。
- **详情**：隔了很久回来、忘了这个会话在做什么时，用一段两三句话（中文最多 180 字）帮你接上：整个会话的主线和原因、做到哪了、接下来该做什么（包括说好但还没做的事）。从主线讲起，不会只讲最近的小问题。只画在卡片里，**不进入对话上下文**。按轮次缓存，没有新的一轮就不重新生成；展开状态下有新的一轮会自动刷新。
- **折叠**：把卡片收成一行胶囊（状态点、目标、等你标记、轮次），点胶囊上的目标恢复。折叠状态跨会话保留。
- `/where`：打开卡片并展开详情。注意：命令本身会在对话里留下一行提示文字。

## 安装

在终端的 Claude Code 里：

```
/plugin install where-am-i --marketplace tyler4400/tyler-claude-mods
```

或者在 shell 里：

```bash
claude plugin marketplace add tyler4400/tyler-claude-mods
claude plugin install where-am-i@tyler-claude-mods --scope user
```

第一轮结束后卡片出现。

## 配置

在 `/config` 或 `/plugin configure where-am-i@tyler-claude-mods` 里修改，改完自动生效。

| 选项 | 默认 | 说明 |
| --- | --- | --- |
| `language` | `auto` | 摘要语言：`auto` 按你最近的消息判断中文或英文；`zh`；`en` |
| `model` | `haiku` | 生成摘要和详情用的模型 |
| `accentColor` | `suggestion` | 工作中的颜色：主题色名（`suggestion`、`claude`、`success`、`warning`、`error` 等）或 `#hex` |
| `waitingColor` | `warning` | 等你处理时的颜色 |
| `idleColor` | `success` | 空闲时的颜色 |
| `borderStyle` | `round` | 卡片边框：`round`、`single`、`bold`、`double`、`none` |
| `density` | `comfortable` | 行距：`comfortable` 行与行之间空一行；`compact` 紧凑 |
| `showMeta` | `true` | 显示"第 N 轮 · 时间" |
| `showNext` | `true` | 没有等你处理的事时，第三行显示"下一步" |
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

**数据存在哪：** Claude Code 为每个 plugin 提供的 `$.store`，即 `~/.claude/plugins/store/` 下本 plugin 的 JSON 文件。每个对话一条记录（最新摘要、滚动总结、轮次、更新时间、语言、缓存的详情），外加一个折叠偏好。超过 `retentionDays` 没更新的记录在会话启动时清理。

app 重启后续接对话、或 fork 对话时，Claude Code 会换一个新的 session id，但对话内容原样带过去。所以记录不按 session id 存，而是按"工作目录 + 第一条消息"的指纹认出同一个对话。

**它会做什么、不会做什么：** `tool.call` 只观察，调用原样放行，用来统计调用次数和被 Edit/Write 改过的文件；不改你的消息、不改 Claude 的回复。除了上面的模型调用，只在会话启动时运行一次 `date +%z` 取本机时区。没有其他网络请求，不读写 store 以外的文件。

Hooks：`session.start`、`session.end`、`prompt.submit`、`tool.call`、`turn.complete`、`command.run`（`/where`）、`ui.render`（`AbovePrompt`）。

## 局限

- 第一轮结束前没有摘要，卡片不显示。
- fork 出来的对话和原对话指纹相同，会共用同一张卡片，直到其中一个有新的一轮把它覆盖。
- 续接前如果上下文被压缩过，第一条消息会变成压缩摘要，指纹对不上，卡片要等新的一轮结束后才重新出现。
- 模型调用失败或返回格式不对时，保留上一份摘要。
- 轮次是会话里你发出的、带文字的消息数，斜杠命令也会被计入。
- 只在 Claude Code 的 desktop 和终端里绘制；VS Code 插件和 `claude -p` 里不显示。
- 在 Claude Code 2.1.294 / 2.1.295 上用 `claude plugin validate` 和 `claude plugin test` 验证过。

## 致谢

fork 自 [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) 的 where-am-i（MIT，Copyright (c) 2026 Hamza Zafar）。在原版基础上改为卡片样式，加上持久化、滚动总结、语言跟随、详情、折叠和可配置项。
