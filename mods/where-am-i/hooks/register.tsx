// where-am-i：输入框上方的会话摘要卡片，摘要存进 $.store，重启或回看旧会话时恢复。
// fork 自 hamzafer/claude-code-mods 的 where-am-i（MIT），改为卡片样式并加上持久化、滚动总结和语言跟随。
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { DetailView, Lang, SessionRecord, TurnProgress, TurnStats } from '../types'
import {
  clip,
  countTurns,
  describeTool,
  detailRequest,
  formatElapsed,
  formatStats,
  formatTime,
  intentRequest,
  labels,
  parseIntent,
  parseOffset,
  parseSummary,
  resolveLang,
  summaryRequest,
} from './recap'

type Engine = EngineInterface

// store 是 ~/.claude/plugins/store/ 下本 plugin 的 JSON 文件
// conv:<指纹> 是一个对话的记录；id:<session id> 记住这个 session 属于哪个对话；session:<id> 是 0.3.0 之前的旧格式
const CONV_PREFIX = 'conv:'
const ID_PREFIX = 'id:'
const LEGACY_PREFIX = 'session:'
const FOLDED_KEY = 'pref:folded'
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_LOG = 20
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

// 由宿主保管，热重载后仍在；跨进程的部分另存 $.store
const recordAtom = atom({ plugin: 'where-am-i', key: 'record' } as const, null as SessionRecord | null)
const progress = atom({ plugin: 'where-am-i', key: 'progress' } as const, null as TurnProgress | null)
// 工作期间每秒写一次，让已用时跟着走
const clockNow = atom({ plugin: 'where-am-i', key: 'clockNow' } as const, 0)
const isExpanded = atom({ plugin: 'where-am-i', key: 'isExpanded' } as const, false)
const isFolded = atom({ plugin: 'where-am-i', key: 'isFolded' } as const, false)
const detailView = atom({ plugin: 'where-am-i', key: 'detail' } as const, null as DetailView | null)

type Settings = {
  language: unknown
  model: string
  accentColor: string
  waitingColor: string
  idleColor: string
  borderStyle: string
  density: string
  showMeta: boolean
  retentionDays: number
}

function settingsFrom(options: PluginOptions): Settings {
  const text = (key: string, fallback: string) =>
    typeof options[key] === 'string' && (options[key] as string).trim() !== '' ? (options[key] as string).trim() : fallback
  return {
    language: options.language,
    model: text('model', 'haiku'),
    accentColor: text('accentColor', 'suggestion'),
    waitingColor: text('waitingColor', 'warning'),
    idleColor: text('idleColor', 'success'),
    borderStyle: text('borderStyle', 'round'),
    density: text('density', 'comfortable'),
    showMeta: options.showMeta !== false,
    retentionDays: typeof options.retentionDays === 'number' && options.retentionDays > 0 ? options.retentionDays : 30,
  }
}

async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  return Array.from(bytes.slice(0, 12), b => b.toString(16).padStart(2, '0')).join('')
}

// 续接或 fork 时 Claude Code 会换一个新的 session id，但对话内容原样带过去：
// 用工作目录和第一条消息认出同一个对话，算出来后记在 id:<session id> 下，压缩上下文后也能找到
async function conversationKey($: Engine): Promise<string | undefined> {
  if (convKey) return convKey
  const mapped = (await $.store.get(ID_PREFIX + (await $.session.id()))) as { conv?: string } | undefined
  if (mapped?.conv) return (convKey = mapped.conv)
  const first = (await $.session.messages()).find(m => m.role === 'user' && m.text.trim() !== '')
  if (!first) return undefined
  convKey = CONV_PREFIX + (await digest(`${await $.session.cwd()}\n${first.text.slice(0, 4000)}`))
  return convKey
}

async function loadRecord($: Engine): Promise<SessionRecord | undefined> {
  const key = await conversationKey($)
  const saved = key ? ((await $.store.get(key)) as SessionRecord | undefined) : undefined
  return saved ?? ((await $.store.get(LEGACY_PREFIX + (await $.session.id()))) as SessionRecord | undefined)
}

async function saveRecord($: Engine, record: SessionRecord): Promise<void> {
  await update($, recordAtom, () => record)
  const id = await $.session.id()
  const key = (await conversationKey($)) ?? LEGACY_PREFIX + id
  await $.store.set(key, record)
  if (key.startsWith(CONV_PREFIX)) await $.store.set(ID_PREFIX + id, { conv: key, updatedAt: record.updatedAt })
}

async function pruneOldRecords($: Engine, retentionDays: number): Promise<void> {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (![CONV_PREFIX, ID_PREFIX, LEGACY_PREFIX].some(prefix => key.startsWith(prefix))) continue
    const entry = (await $.store.get(key)) as { updatedAt?: number } | undefined
    if (!entry || now - (entry.updatedAt ?? 0) > retentionDays * DAY_MS) await $.store.delete(key)
  }
}

async function restoreRecord($: Engine): Promise<void> {
  const saved = await loadRecord($)
  if (!saved) return
  lang = saved.lang
  await update($, recordAtom, () => saved)
}

async function setFolded($: Engine, value: boolean): Promise<void> {
  await update($, isFolded, () => value)
  await $.store.set(FOLDED_KEY, value)
}

// 第二行行首：这一轮已完成时用 ✅，和第一行的 🎯、第三行的 ⏳ 一样；工作中仍是状态色的圆点
const DONE_MARK = '✅'

// 模块级状态：热重载后重置，需要跨重载的都在 atom 和 $.store 里
let settings = settingsFrom({})
let prompt = ''
let log: string[] = []
let lang: Lang = 'zh'
// 本机时区相对 UTC 的分钟数：mod 运行环境的时区不一定是本机的
let offsetMinutes = 0
let ticker: { cancel: () => void } | undefined
let convKey: string | undefined

async function writeIntent($: Engine, text: string): Promise<void> {
  try {
    const request = intentRequest({ lang, previous: await read($, recordAtom), prompt: text })
    const result = await $.model.complete({ model: settings.model, ...request })
    if (!result.isAnswered) return
    const intent = parseIntent(result.text)
    if (intent) await update($, progress, p => (p ? { ...p, intent } : p))
  } catch {
    // 拿不到一句话目标时显示你消息的开头
  }
}

async function tick($: Engine): Promise<void> {
  const now = await $.clock.now()
  await update($, clockNow, () => now)
}

async function summarize($: Engine, answer: string, stats: TurnStats | undefined): Promise<void> {
  const previous = await read($, recordAtom)
  const messages = await $.session.messages()
  const request = summaryRequest({ lang, previous, prompt, tools: log, answer, messages })
  const result = await $.model.complete({ model: settings.model, ...request })
  if (!result.isAnswered) return
  const parsed = parseSummary(result.text)
  if (!parsed) return
  const record: SessionRecord = {
    recap: parsed.recap,
    overall: parsed.overall || previous?.overall || '',
    // 上下文压缩后重启，session.messages() 只剩压缩后的消息，轮次不能因此倒退
    turn: Math.max(countTurns(messages), (previous?.turn ?? 0) + 1),
    lang,
    updatedAt: await $.clock.now(),
    detail: previous?.detail,
    stats: stats ?? previous?.stats,
  }
  await saveRecord($, record)
  // 详情展开着时跟着新的一轮刷新
  if (await read($, isExpanded)) await loadDetail($)
}

async function loadDetail($: Engine): Promise<void> {
  const record = await read($, recordAtom)
  if (!record) {
    await update($, detailView, () => ({ status: 'error', text: labels(lang).noRecap }))
    return
  }
  if (record.detail?.turn === record.turn && record.detail.kind === 'mainline') {
    const text = record.detail.text
    await update($, detailView, () => ({ status: 'ready', text }))
    return
  }
  await update($, detailView, () => ({ status: 'loading', text: '' }))
  const request = detailRequest({ lang: record.lang, record, messages: await $.session.messages() })
  const result = await $.model.complete({ model: settings.model, ...request })
  if (!result.isAnswered || result.text.trim() === '') {
    await update($, detailView, () => ({ status: 'error', text: labels(record.lang).failed }))
    return
  }
  const text = result.text.trim()
  const latest = (await read($, recordAtom)) ?? record
  await saveRecord($, { ...latest, detail: { text, turn: record.turn, kind: 'mainline' } })
  await update($, detailView, () => ({ status: 'ready', text }))
}

async function setExpanded($: Engine, value: boolean): Promise<void> {
  await update($, isExpanded, () => value)
  if (!value) return
  try {
    await loadDetail($)
  } catch {
    await update($, detailView, () => ({ status: 'error', text: labels(lang).failed }))
  }
}

async function summarizeQuietly($: Engine, answer: string, stats: TurnStats | undefined): Promise<void> {
  try {
    await summarize($, answer, stats)
  } catch {
    // 摘要是附加功能：失败就保留上一份
  }
}

export const register: Register = (on, options) => {
  settings = settingsFrom(options)

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    try {
      offsetMinutes = parseOffset((await $.process.run(['date', '+%z'])).stdout)
    } catch {
      offsetMinutes = 0
    }
    await pruneOldRecords($, settings.retentionDays)
    convKey = undefined
    await restoreRecord($)
    const folded = await $.store.get(FOLDED_KEY)
    if (typeof folded === 'boolean') await update($, isFolded, () => folded)
    return result
  })

  // /clear 之后是新会话，旧卡片不再适用
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear') {
      convKey = undefined
      await update($, recordAtom, () => null)
      await update($, detailView, () => null)
      await update($, isExpanded, () => false)
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    // 续接的会话在启动时可能还没载入对话内容，这里再找一次
    if (!(await read($, recordAtom))) await restoreRecord($)
    prompt = e.text
    log = []
    // 太短的消息（如"好""开始"）不足以判断语言，沿用上一次的
    if (Array.from(e.text.trim()).length >= 8 || settings.language === 'zh' || settings.language === 'en') {
      lang = resolveLang(settings.language, e.text)
    }
    const startedAt = await $.clock.now()
    await update($, clockNow, () => startedAt)
    await update($, progress, () => ({ intent: '', calls: 0, files: [], startedAt }))
    ticker?.cancel()
    ticker = $.clock.every(1000, () => void tick($))
    const text = e.text
    $.clock.after(0, () => void writeIntent($, text))
    return next(e)
  })

  // 只观察：记下在做什么，调用原样放行。其他 mod 在后台发起的调用不算
  on('tool.call', async ($, e, next) => {
    if (next.origin.plugin !== 'engine') return next(e)
    const input = e as unknown as Record<string, unknown>
    const line = describeTool(input, lang)
    log = [...log, e.agentId ? `(agent) ${line}` : line].slice(-MAX_LOG)
    const file = EDIT_TOOLS.has(String(input.tool)) && typeof input.file_path === 'string' ? input.file_path : ''
    await update($, progress, p =>
      p ? { ...p, calls: p.calls + 1, files: file && !p.files.includes(file) ? [...p.files, file] : p.files } : p,
    )
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      ticker?.cancel()
      ticker = undefined
      const finished = await read($, progress)
      const stats = finished
        ? { calls: finished.calls, files: finished.files.length, elapsedMs: (await $.clock.now()) - finished.startedAt }
        : undefined
      await update($, progress, () => null)
      // 统计先写进记录，摘要还在生成时第二行右侧就已经是这一轮的最终数字
      const record = await read($, recordAtom)
      if (record && stats) await saveRecord($, { ...record, stats })
      const answer = e.answer
      // 放到定时器里跑，不拖住这一轮的收尾
      $.clock.after(0, () => void summarizeQuietly($, answer, stats))
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // 其他 mod 和 Claude Code 自己画在这里的内容保留在卡片下方
    const record = await read($, recordAtom)
    if (e.props.hasSurvey || !record) return rest

    const { Box, Text, Button, Markdown } = $.ui.resolve(e)
    const L = labels(record.lang)
    const isWorking = e.props.isWorking
    const turnProgress = isWorking ? await read($, progress) : null
    const isWaiting = !isWorking && record.recap.waiting !== ''
    const stateColor = isWorking ? settings.accentColor : isWaiting ? settings.waitingColor : settings.idleColor
    const updatedAt = formatTime(record.updatedAt, await $.clock.now(), offsetMinutes)
    const meta = settings.showMeta ? `${L.turn(record.turn)} · ${updatedAt}` : ''

    const border = settings.borderStyle === 'none' ? {} : { borderStyle: settings.borderStyle, borderColor: stateColor }

    // 工作中显示这一轮的实时统计，结束后保留上一轮的最终统计
    const stats: TurnStats | undefined = turnProgress
      ? {
          calls: turnProgress.calls,
          files: turnProgress.files.length,
          elapsedMs: (await read($, clockNow)) - turnProgress.startedAt,
        }
      : record.stats
    const progressStats = stats ? formatStats(stats, record.lang) : ''
    // 第二行：工作中是「本轮：…」（重载后丢了这一轮的进度时退回上一份摘要），结束后是这一轮做了什么
    const nowText = turnProgress ? `${L.thisTurn}${L.sep}${turnProgress.intent || clip(prompt, 40)}` : record.recap.now

    if (await read($, isFolded)) {
      // 胶囊依次优先显示：工作中这一轮在做什么、等你处理的事、目标；放不下时截断这段文字，右侧的时间、用时和展开按钮保持完整
      const capsuleText = isWorking
        ? nowText
        : isWaiting
          ? `⏳ ${L.waiting}${L.sep}${record.recap.waiting}`
          : `🎯 ${record.recap.goal}`
      const capsuleMeta = [settings.showMeta ? updatedAt : '', stats ? formatElapsed(stats.elapsedMs, record.lang) : '']
        .filter(part => part !== '')
        .join(' · ')
      return (
        <Box flexDirection="column">
          {/* 外层整行，胶囊作为可收缩的子项：内容短时按内容宽，超出一行时收缩 */}
          <Box flexDirection="row">
            <Box flexDirection="row" flexShrink={1} minWidth={0} gap={1} paddingX={1} {...border}>
              {/* 行首：工作中是状态色圆点；等你时文字自带 ⏳，不加标记；空闲是 ✅ */}
              {isWorking ? <Text color={stateColor}>{'●'}</Text> : !isWaiting && <Text>{DONE_MARK}</Text>}
              <Box flexShrink={1} minWidth={0} overflow="hidden">
                {isWaiting
                  ? <Text color={settings.waitingColor} wrap="truncate-end">{capsuleText}</Text>
                  : <Text wrap="truncate-end">{capsuleText}</Text>}
              </Box>
              <Box flexDirection="row" flexShrink={0} gap={1}>
                {capsuleMeta !== '' && <Text dimColor>{capsuleMeta}</Text>}
                <Button key="unfold" plain label={L.unfold} onPress={() => setFolded($, false)} />
              </Box>
            </Box>
          </Box>
          {rest}
        </Box>
      )
    }

    const expanded = await read($, isExpanded)
    const detail = expanded ? await read($, detailView) : null
    // 第三行只在等你时有内容：工作中第二行已经说了在做什么，空闲时没有要你处理的事
    const actionLine = isWaiting
      ? <Text color={settings.waitingColor} wrap="truncate-end">{`⏳ ${L.waiting}${L.sep}${record.recap.waiting}`}</Text>
      : <Text>{' '}</Text>

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" paddingX={1} rowGap={settings.density === 'compact' ? 0 : 1} {...border}>
          <Box flexDirection="row" justifyContent="space-between" gap={2}>
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
              <Text bold wrap="truncate-end">{`🎯 ${record.recap.goal}`}</Text>
            </Box>
            {meta !== '' && (
              <Box flexShrink={0}>
                <Text dimColor>{meta}</Text>
              </Box>
            )}
          </Box>
          <Box flexDirection="row" justifyContent="space-between" gap={2}>
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">
              <Text wrap="truncate-end">
                {isWorking ? <Text color={stateColor}>{'● '}</Text> : `${DONE_MARK} `}
                {nowText}
              </Text>
            </Box>
            {progressStats !== '' && (
              <Box flexShrink={0}>
                <Text dimColor>{progressStats}</Text>
              </Box>
            )}
          </Box>
          <Box flexDirection="row" justifyContent="space-between" gap={2}>
            <Box flexGrow={1} flexShrink={1} minWidth={0} overflow="hidden">{actionLine}</Box>
            <Box flexDirection="row" flexShrink={0} gap={2}>
              <Button key="detail" plain onPress={() => setExpanded($, !expanded)}>
                {expanded ? L.collapse : L.expand}
              </Button>
              <Button key="fold" plain onPress={() => setFolded($, true)}>
                {L.fold}
              </Button>
            </Box>
          </Box>
          {detail?.status === 'ready' && <Markdown text={detail.text} />}
          {detail?.status === 'loading' && <Text dimColor>{L.loading}</Text>}
          {detail?.status === 'error' && <Text dimColor>{detail.text}</Text>}
        </Box>
        {rest}
      </Box>
    )
  })
}
