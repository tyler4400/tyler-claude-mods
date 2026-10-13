import type { EngineInterface, Register } from 'claude-code'
import { buildDigest, resolveTitle, subjectOf } from './title-logic'

// 桌面 app 注入的会话管理 MCP server；终端里没有它，改走 UserPromptSubmit 的 sessionTitle
const DESKTOP_SERVER = 'ccd_session_mgmt'
const STORE_PREFIX = 'session:'
const RECORD_TTL_MS = 30 * 24 * 60 * 60 * 1000

type TitleRecord = {
  /** 终端里拿不到当前标题，用最近一次写入的值代替 */
  title?: string
  /** 用户拒绝过改主体：之后只补前缀和日期 */
  subjectLocked: boolean
  /** 连只补前缀和日期也被拒绝：本会话不再尝试 */
  gaveUp: boolean
  /** 终端路径：等下一次提交 prompt 时通过 hook 写入 */
  pendingHookTitle?: string
  /** 最近一次检查的时间和结果，排查用（store 是 ~/.claude/plugins/store/ 下的 JSON） */
  lastRun?: string
  updatedAt: number
}

type Engine = EngineInterface

let rules: string | undefined
let isRetitling = false

async function recordKey($: Engine): Promise<string> {
  return STORE_PREFIX + (await $.session.id())
}

async function loadRecord($: Engine): Promise<TitleRecord | undefined> {
  return (await $.store.get(await recordKey($))) as TitleRecord | undefined
}

async function saveRecord($: Engine, record: TitleRecord): Promise<void> {
  await $.store.set(await recordKey($), { ...record, updatedAt: await $.clock.now() })
}

async function todayMMDD($: Engine): Promise<string> {
  // mod 运行环境的时区不一定是本机时区，以本机 date 为准
  const { stdout } = await $.process.run(['date', '+%m%d'])
  return stdout.trim()
}

function textOf(result: { content: readonly { type: string }[] }): string {
  return result.content.map((block) => ('text' in block ? String(block.text) : '')).join('\n')
}

/** undefined 表示不在桌面 app 里；null 表示桌面会话还没有标题 */
async function readDesktopTitle($: Engine): Promise<string | null | undefined> {
  try {
    const result = await $.mcp.call(DESKTOP_SERVER, 'get_session', { session_id: 'self' })
    if (result.isError) return undefined
    const { title } = JSON.parse(textOf(result)) as { title?: unknown }
    return typeof title === 'string' && title.trim() !== '' ? title : null
  } catch {
    return undefined
  }
}

/** 用户手动起的标题会触发 app 的批准弹窗；读回标题判断是否被拒绝 */
async function applyDesktopTitle($: Engine, title: string): Promise<boolean> {
  try {
    await $.mcp.call(DESKTOP_SERVER, 'set_session_title', { session_id: 'self', title })
  } catch {
    return false
  }
  return (await readDesktopTitle($)) === title
}

async function askModel(
  $: Engine,
  ctx: { today: string; current?: string; lockedSubject?: string },
): Promise<{ text?: string; failure?: string }> {
  rules ??= String(await $.fs.read($.plugin.root + '/title-rules.md'))
  const digest = buildDigest(await $.session.messages())
  const prompt = [
    `今天：${ctx.today}`,
    `当前标题：${ctx.current ?? '（无）'}`,
    ctx.lockedSubject ? `主体已锁定：${ctx.lockedSubject}` : '',
    '',
    '对话（用户消息按顺序，助手只列最近几条）：',
    digest,
  ].join('\n')
  const reply = await $.model.complete({
    model: 'haiku',
    system: [{ text: rules, cache: true }],
    prompt,
    maxTokens: 160,
    effort: 'low',
    timeoutMs: 30_000,
  })
  return reply.isAnswered ? { text: reply.text } : { failure: reply.reason }
}

/**
 * 每轮都让 Haiku 判断一次；标题仍贴合主线时它回 KEEP，什么都不动。
 * 返回本次结果的简述，写进记录的 lastRun。
 */
async function retitle($: Engine, record: TitleRecord): Promise<string> {
  if (record.gaveUp) return 'skip: gave up'

  const [today, desktopTitle] = await Promise.all([todayMMDD($), readDesktopTitle($)])
  const isDesktop = desktopTitle !== undefined
  // claude -p、SDK 等既不在桌面 app、也没有界面的会话不需要标题
  if (!isDesktop && (await $.session.surfaces()).length === 0) return 'skip: headless'

  const current = (isDesktop ? desktopTitle : record.title) ?? undefined
  const lockedSubject = record.subjectLocked && current ? subjectOf(current) : undefined

  const reply = await askModel($, { today, current, lockedSubject })
  if (reply.text === undefined) return 'model failed: ' + reply.failure
  const nextTitle = resolveTitle(reply.text, { today, current, lockedSubject })
  if (!nextTitle) return 'keep'

  if (!isDesktop) {
    record.title = nextTitle
    record.pendingHookTitle = nextTitle
    return 'pending (terminal): ' + nextTitle
  }
  if (await applyDesktopTitle($, nextTitle)) {
    record.title = nextTitle
    return 'set: ' + nextTitle
  }
  if (current && subjectOf(nextTitle) !== subjectOf(current)) {
    record.subjectLocked = true
    $.ui.toast('session-title：已保留你的标题主体，之后只补前缀和日期')
    return 'rejected, subject locked: ' + nextTitle
  }
  record.gaveUp = true
  return 'rejected, gave up: ' + nextTitle
}

async function retitleOnce($: Engine): Promise<void> {
  if (isRetitling) return
  isRetitling = true
  const record: TitleRecord = { subjectLocked: false, gaveUp: false, ...(await loadRecord($)), updatedAt: 0 }
  let outcome: string
  try {
    outcome = await retitle($, record)
  } catch (err) {
    outcome = 'error: ' + String(err)
  } finally {
    isRetitling = false
  }
  record.lastRun = new Date(await $.clock.now()).toISOString() + ' ' + outcome
  await saveRecord($, record)
}

async function pruneOldRecords($: Engine): Promise<void> {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    const record = (await $.store.get(key)) as TitleRecord | undefined
    if (!record || now - record.updatedAt > RECORD_TTL_MS) await $.store.delete(key)
  }
}

// 改标题是附加功能：自己出错时让原事件照常进行
const passThrough = ($: Engine, e: any, next: any) => next(e)

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await pruneOldRecords($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // 只看主对话正常答完的轮次；放到定时器里跑，不拖住这一轮的收尾
    if (!e.agentId && e.reason === 'answer') $.clock.after(0, () => void retitleOnce($))
    return result
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const stored = await loadRecord($)
    if (!stored?.pendingHookTitle) return result
    await saveRecord($, { ...stored, pendingHookTitle: undefined })
    return { ...result, sessionTitle: stored.pendingHookTitle }
  }).catch(passThrough)
}
