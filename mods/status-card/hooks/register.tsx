// status-card：输入框上方的会话摘要卡片，摘要存进 $.store，重启或回看旧会话时恢复。
// 借鉴 hamzafer/claude-code-mods 中 where-am-i 的源码（MIT），改为卡片样式并加上持久化、滚动总结和语言跟随。
import { atom, read, update } from 'claude-code'
import type { EngineInterface, PluginOptions, Register } from 'claude-code'

import type { CacheState, DetailView, Lang, SessionRecord, TurnProgress, TurnStats } from '../types'
import {
  cacheHint,
  cacheTtlFromTranscript,
  clip,
  countTurns,
  describeTool,
  detailRequest,
  formatElapsed,
  formatStats,
  formatTime,
  intentRequest,
  isExpired,
  isTypedPrompt,
  labels,
  modelKey,
  nextCacheChange,
  parseIntent,
  parseOffset,
  parseSummary,
  resolveLang,
  retentionDaysFrom,
  summaryRequest,
} from './recap'

type Engine = EngineInterface

// store 是 ~/.claude/plugins/store/ 下本 plugin 的 JSON 文件
// rec:<session id> 是一个 session 的记录，cache:<session id> 是它的提示缓存状态。以下是旧格式，只读不写：
// conv:<指纹> 和 id:<session id>（指向它属于的 conv:）是 0.3.0–0.5.x 的，session:<id> 是 0.3.0 之前的
const REC_PREFIX = 'rec:'
const CACHE_PREFIX = 'cache:'
const CONV_PREFIX = 'conv:'
const ID_PREFIX = 'id:'
const LEGACY_PREFIX = 'session:'
const FOLDED_KEY = 'pref:folded'
const MAX_LOG = 20
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])

// 由宿主保管，热重载后仍在；跨进程的部分另存 $.store
const recordAtom = atom({ plugin: 'status-card', key: 'record' } as const, null as SessionRecord | null)
const progress = atom({ plugin: 'status-card', key: 'progress' } as const, null as TurnProgress | null)
// 工作期间每秒写一次，让已用时跟着走
const clockNow = atom({ plugin: 'status-card', key: 'clockNow' } as const, 0)
const isExpanded = atom({ plugin: 'status-card', key: 'isExpanded' } as const, false)
const isFolded = atom({ plugin: 'status-card', key: 'isFolded' } as const, false)
const detailView = atom({ plugin: 'status-card', key: 'detail' } as const, null as DetailView | null)
// classic.SessionStart 和 classic.UserPromptSubmit 给的 transcript 路径：fork 时靠它找到原 session，也从它读缓存时长
const transcriptPath = atom({ plugin: 'status-card', key: 'transcriptPath' } as const, '')
// 不放进 SessionRecord：摘要在后台慢慢生成，写回记录时会盖掉这期间更新的缓存状态
const cacheAtom = atom({ plugin: 'status-card', key: 'cache' } as const, null as CacheState | null)

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
    retentionDays: retentionDaysFrom(options.retentionDays),
  }
}

// 某个 session 自己的记录；旧格式的 conv: 记录只按这个 session 的 id: 映射认领，不按对话内容猜
async function recordOf($: Engine, id: string): Promise<SessionRecord | undefined> {
  const own = (await $.store.get(REC_PREFIX + id)) as SessionRecord | undefined
  if (own) return own
  const mapped = (await $.store.get(ID_PREFIX + id)) as { conv?: string } | undefined
  const migrated = mapped?.conv ? ((await $.store.get(mapped.conv)) as SessionRecord | undefined) : undefined
  return migrated ?? ((await $.store.get(LEGACY_PREFIX + id)) as SessionRecord | undefined)
}

// fork 出来的 transcript 开头是从原对话复制来的条目，仍带着原 session 的 id；
// 自己的条目之前出现的其他 id 就是祖先，按从近到远返回
async function ancestorIds($: Engine, id: string): Promise<string[]> {
  const path = await read($, transcriptPath)
  if (!path.endsWith(`/${id}.jsonl`)) return []
  const { stdout } = await $.process.run(['grep', '-o', '-E', '"sessionId":"[0-9a-f-]{36}"', path])
  const ids = stdout.split('\n').filter(line => line !== '').map(line => line.slice('"sessionId":"'.length, -1))
  const ownAt = ids.indexOf(id)
  const copied = ownAt === -1 ? ids : ids.slice(0, ownAt)
  return [...new Set(copied.reverse())].filter(other => other !== id)
}

async function saveRecord($: Engine, record: SessionRecord): Promise<void> {
  await update($, recordAtom, () => record)
  await $.store.set(REC_PREFIX + (await $.session.id()), record)
}

async function pruneOldRecords($: Engine, retentionDays: number): Promise<void> {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (![REC_PREFIX, CACHE_PREFIX, CONV_PREFIX, ID_PREFIX, LEGACY_PREFIX].some(prefix => key.startsWith(prefix))) continue
    const entry = (await $.store.get(key)) as { updatedAt?: number } | undefined
    if (!entry || isExpired(entry.updatedAt, now, retentionDays)) await $.store.delete(key)
  }
}

// 先找这个 session 自己的记录；没有时，fork 出来的 session 复制一份原 session 的，之后各自更新
async function restoreRecord($: Engine): Promise<void> {
  const id = await $.session.id()
  let saved = await recordOf($, id)
  if (!saved) {
    try {
      for (const ancestor of await ancestorIds($, id)) {
        saved = await recordOf($, ancestor)
        if (saved) break
      }
    } catch {
      // 读不到 transcript 时当作新会话
    }
  }
  if (!saved) return
  lang = saved.lang
  await update($, recordAtom, () => saved)
  if (!(await $.store.get(REC_PREFIX + id))) await $.store.set(REC_PREFIX + id, saved)
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
// 空闲时在缓存提示的分钟数变化那一刻刷新一次
let cacheTimer: { cancel: () => void } | undefined
// 主线程这一轮最后一次请求：哪个模型、什么时候发出；缓存从这一刻重新计时
let lastStep: { model: string; at: number } | undefined

// 占位卡片还没有摘要内容，不能当作上一份摘要
async function lastRecap($: Engine): Promise<SessionRecord | null> {
  const record = await read($, recordAtom)
  return record?.draft ? null : record
}

async function writeIntent($: Engine, text: string): Promise<void> {
  try {
    const request = intentRequest({ lang, previous: await lastRecap($), prompt: text })
    const result = await $.model.complete({ model: settings.model, ...request })
    if (!result.isAnswered) return
    const intent = parseIntent(result.text)
    if (intent) await update($, progress, p => (p ? { ...p, intent } : p))
  } catch {
    // 拿不到一句话目标时第二行一直显示 thinking ...
  }
}

async function tick($: Engine): Promise<void> {
  const now = await $.clock.now()
  await update($, clockNow, () => now)
}

async function saveCache($: Engine, state: CacheState | null): Promise<void> {
  await update($, cacheAtom, () => state)
  const key = CACHE_PREFIX + (await $.session.id())
  if (state) await $.store.set(key, state)
  else await $.store.delete(key)
}

async function restoreCache($: Engine): Promise<void> {
  const saved = (await $.store.get(CACHE_PREFIX + (await $.session.id()))) as CacheState | undefined
  await update($, cacheAtom, () => saved ?? null)
  await scheduleCacheTick($)
}

// TTL 只从 transcript 读；读不到时这个模型不记，卡片上就不显示
async function readCacheTtl($: Engine): Promise<number | undefined> {
  const path = await read($, transcriptPath)
  if (!path) return undefined
  try {
    const { stdout } = await $.process.run(['sh', '-c', 'grep -F \'"ephemeral_\' "$1" | tail -n 20', 'sh', path])
    return cacheTtlFromTranscript(stdout)
  } catch {
    return undefined
  }
}

async function recordCache($: Engine): Promise<void> {
  const step = lastStep
  lastStep = undefined
  if (!step) return
  const byModel = { ...(await read($, cacheAtom))?.byModel }
  const ttlMs = await readCacheTtl($)
  if (ttlMs) byModel[step.model] = { at: step.at, ttlMs }
  else delete byModel[step.model]
  await saveCache($, { model: step.model, byModel, updatedAt: step.at })
}

async function scheduleCacheTick($: Engine): Promise<void> {
  cacheTimer?.cancel()
  cacheTimer = undefined
  const delay = nextCacheChange(await read($, cacheAtom), await $.clock.now())
  if (delay === undefined) return
  cacheTimer = $.clock.after(delay, async () => {
    await tick($)
    await scheduleCacheTick($)
  })
}

async function summarize($: Engine, answer: string, stats: TurnStats | undefined, turn: number | undefined): Promise<void> {
  const previous = await lastRecap($)
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
    turn: Math.max(turn ?? 0, countTurns(messages), (previous?.turn ?? 0) + 1),
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
  const record = await lastRecap($)
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

async function summarizeQuietly($: Engine, answer: string, stats: TurnStats | undefined, turn: number | undefined): Promise<void> {
  try {
    await summarize($, answer, stats, turn)
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
    await restoreRecord($)
    await restoreCache($)
    const folded = await $.store.get(FOLDED_KEY)
    if (typeof folded === 'boolean') await update($, isFolded, () => folded)
    return result
  })

  // 只为拿 transcript 路径：fork 出来的 session 启动时还没有自己的记录，读到路径后再找一次
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    await update($, transcriptPath, () => e.transcript_path)
    if (!(await read($, recordAtom))) await restoreRecord($)
    if (!(await read($, cacheAtom))) await restoreCache($)
    return result
  })

  // 热重载或会话中途装上时不会再有 classic.SessionStart，每轮发消息时再记一次 transcript 路径
  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    await update($, transcriptPath, () => e.transcript_path)
    return result
  })

  // 切换模型后提示跟着换成新模型的缓存；切回来时原模型的缓存没过期就继续显示剩余时间
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    const state = await read($, cacheAtom)
    if (state) await saveCache($, { ...state, model: modelKey(e.to_model) })
    await scheduleCacheTick($)
    return result
  })

  // /clear 或 /resume 后进程换到另一个 session，旧卡片和旧 transcript 不再适用；新 session 的卡片由 classic.SessionStart 找回
  on('session.end', async ($, e, next) => {
    const result = await next(e)
    if (e.reason === 'clear' || e.reason === 'resume') {
      await update($, recordAtom, () => null)
      await update($, transcriptPath, () => '')
      await update($, cacheAtom, () => null)
      cacheTimer?.cancel()
      await update($, detailView, () => null)
      await update($, isExpanded, () => false)
    }
    return result
  })

  on('prompt.submit', async ($, e, next) => {
    // 续接的会话在启动时可能还没载入对话内容，这里再找一次
    if (!(await read($, recordAtom))) await restoreRecord($)
    const record = await read($, recordAtom)
    // 第几轮按对话里你发过的消息数，这一条还没进对话所以加一；压缩上下文后消息变少，不能比上一轮小
    const turn = Math.max(countTurns(await $.session.messages()) + 1, (record?.turn ?? 0) + 1)
    prompt = e.text
    log = []
    // 不是你打的字、或太短（如"好""开始"）不足以判断语言时，沿用上一次的
    const isLangSample = isTypedPrompt(e.origin, e.text) && Array.from(e.text.trim()).length >= 8
    if (isLangSample || settings.language === 'zh' || settings.language === 'en') {
      lang = resolveLang(settings.language, e.text)
    }
    const startedAt = await $.clock.now()
    await update($, clockNow, () => startedAt)
    await update($, progress, () => ({ intent: '', turn, calls: 0, files: [], startedAt }))
    // 第一份摘要出来前先画占位卡片，第一轮也有卡片
    if (!record || record.draft) {
      const recap = { goal: '', now: '', waiting: '', next: '' }
      await update($, recordAtom, () => ({ recap, overall: '', turn, lang, updatedAt: startedAt, draft: true }))
    }
    ticker?.cancel()
    ticker = $.clock.every(1000, () => void tick($))
    cacheTimer?.cancel()
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

  // 只记时间：主线程每次请求都会让缓存重新计时，子代理的请求不算
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) lastStep = { model: modelKey(e.model), at: await $.clock.now() }
    return yield* next(e)
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
      await recordCache($)
      await scheduleCacheTick($)
      // 统计先写进记录，摘要还在生成时第二行右侧就已经是这一轮的最终数字
      const record = await read($, recordAtom)
      if (record?.draft) {
        // 摘要出来前，占位卡片的第二行先写这一轮的意图
        const now = finished?.intent || clip(prompt)
        await update($, recordAtom, () => ({ ...record, recap: { ...record.recap, now }, stats: stats ?? record.stats }))
      } else if (record && stats) {
        await saveRecord($, { ...record, stats })
      }
      const answer = e.answer
      const turn = finished?.turn
      // 放到定时器里跑，不拖住这一轮的收尾
      $.clock.after(0, () => void summarizeQuietly($, answer, stats, turn))
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
    const now = await $.clock.now()
    // 读 clockNow 是为了让空闲时的定时刷新重画卡片；缓存提示只在轮到你时显示
    await read($, clockNow)
    const cache = isWorking ? undefined : cacheHint(await read($, cacheAtom), now, offsetMinutes, record.lang)
    // 右上角是轮次和时间，时间只在当天显示：工作中是正在进行的这一轮和你发出消息的时间，轮到你时是上一轮和摘要更新的时间
    const updatedAt = settings.showMeta ? formatTime(turnProgress?.startedAt ?? record.updatedAt, now, offsetMinutes) : ''
    const meta = settings.showMeta ? [L.turn(turnProgress?.turn ?? record.turn), updatedAt].filter(part => part !== '').join(' · ') : ''
    const goal = record.draft ? L.goalPending : record.recap.goal

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
    const nowText = turnProgress ? `${L.thisTurn}${L.sep}${turnProgress.intent || L.thinking}` : record.recap.now

    // 右上角的暗色文字，轮到你时后面跟缓存提示；缓存不到 10 分钟时这段提示用红色
    const metaText = (prefix: string) => {
      if (cache?.tone !== 'low') {
        const text = [prefix, cache?.text ?? ''].filter(part => part !== '').join(' · ')
        return text === '' ? undefined : <Text dimColor>{text}</Text>
      }
      const warning = <Text color="error">{cache.text}</Text>
      return prefix === '' ? warning : <Text><Text dimColor>{`${prefix} · `}</Text>{warning}</Text>
    }

    if (await read($, isFolded)) {
      // 胶囊依次优先显示：工作中这一轮在做什么、等你处理的事、目标；放不下时截断这段文字，右侧的时间、用时或缓存和展开按钮保持完整
      const capsuleText = isWorking
        ? nowText
        : isWaiting
          ? `⏳ ${L.waiting}${L.sep}${record.recap.waiting}`
          : `🎯 ${goal}`
      // 右侧不显示轮次：工作中是时间和实时用时，轮到你时是时间和缓存提示
      const capsuleMeta = [updatedAt, isWorking && stats ? formatElapsed(stats.elapsedMs, record.lang) : '']
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
                {metaText(capsuleMeta)}
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
              {record.draft
                ? <Text dimColor wrap="truncate-end">{`🎯 ${goal}`}</Text>
                : <Text bold wrap="truncate-end">{`🎯 ${goal}`}</Text>}
            </Box>
            {(meta !== '' || cache) && <Box flexShrink={0}>{metaText(meta)}</Box>}
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
