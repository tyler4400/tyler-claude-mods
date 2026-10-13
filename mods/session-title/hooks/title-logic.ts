import type { SessionMessage } from 'claude-code'

export const BANNED_PREFIXES = ['Rule', 'Test', '读票', '面试', '其它', '杂项', '综合']

const TITLE_PATTERN = /^(\S+)｜(\d{4})｜(.+)$/
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g
// 桌面 app fork 会话时给标题追加的后缀
const FORK_SUFFIX = /\s*[（(]fork[）)]\s*$/i

export type ParsedTitle = { prefix: string; date: string; subject: string }

export function parseTitle(title: string | undefined): ParsedTitle | undefined {
  const [, prefix, date, subject] = title?.trim().match(TITLE_PATTERN) ?? []
  if (!prefix || !date || !subject) return undefined
  return { prefix, date, subject: subject.trim() }
}

export function stripForkSuffix(text: string): string {
  return text.replace(FORK_SUFFIX, '')
}

/** 已格式化的标题取主体；其他标题（系统生成或手动起的）整体当主体。不含 fork 后缀 */
export function subjectOf(title: string): string {
  return stripForkSuffix(parseTitle(title)?.subject ?? title.trim())
}

export type ResolveContext = {
  today: string
  current: string | undefined
  /** 用户拒绝过改主体时，主体必须保持这个值 */
  lockedSubject?: string
}

/**
 * 把模型回复变成要写入的标题；返回 undefined 表示不改。
 * 模型偶尔会写半角分隔符、旧日期或改动锁定主体，这里统一兜底。
 */
export function resolveTitle(reply: string, ctx: ResolveContext): string | undefined {
  // 模型先写一行「主线：…」再给结论，取最后一行；只回一行时也兼容
  const lines = reply.trim().split('\n').map((l) => l.trim()).filter((l) => l !== '' && !/^主线[:：]/.test(l))
  const line = (lines.at(-1) ?? '').replace(/^[`"'「]+|[`"'」]+$/g, '')
  const current = parseTitle(ctx.current)

  if (line === 'KEEP' || line === '') {
    // 模型说保持，但日期过期或带着 fork 后缀时，只换日期、去后缀
    if (!current) return undefined
    const title = `${current.prefix}｜${ctx.today}｜${stripForkSuffix(current.subject)}`
    return title === ctx.current?.trim() ? undefined : title
  }

  const parsed = parseTitle(line.replace(/\s*[|｜]\s*/g, '｜'))
  if (!parsed || [...parsed.prefix].length !== 2 || BANNED_PREFIXES.includes(parsed.prefix)) return undefined

  const subject = stripForkSuffix(ctx.lockedSubject ?? parsed.subject)
  const title = `${parsed.prefix}｜${ctx.today}｜${subject}`
  return title === ctx.current?.trim() ? undefined : title
}

const USER_MESSAGE_CHARS = 400
// 最近几条用户消息多给一些篇幅：主线是否偏离主要看它们
const RECENT_USER_MESSAGES = 6
const RECENT_USER_MESSAGE_CHARS = 800
const ASSISTANT_MESSAGE_CHARS = 300
const RECENT_ASSISTANT_MESSAGES = 3
const DIGEST_CHARS = 8000

function clip(text: string, limit: number): string {
  const flat = text.replace(SYSTEM_REMINDER, '').replace(/\s+/g, ' ').trim()
  return flat.length > limit ? flat.slice(0, limit) + '…' : flat
}

/** 主线要看全部用户消息的走向，所以用户消息全收（各自截断，近期的多留一些），助手只留最近几条 */
export function buildDigest(messages: readonly SessionMessage[]): string {
  const userTexts = messages.filter((m) => m.role === 'user' && m.text.trim() !== '').map((m) => m.text)
  const userLines = userTexts
    .map((text, i) => {
      const isRecent = i >= userTexts.length - RECENT_USER_MESSAGES
      return { text: clip(text, isRecent ? RECENT_USER_MESSAGE_CHARS : USER_MESSAGE_CHARS), label: `用户 ${i + 1}${isRecent ? '（近期）' : ''}` }
    })
    .filter(({ text }) => text !== '')
    .map(({ text, label }) => `${label}：${text}`)

  const assistantLines = messages
    .filter((m) => m.role === 'assistant' && m.text.trim() !== '')
    .slice(-RECENT_ASSISTANT_MESSAGES)
    .map((m) => `助手（近期）：${clip(m.text, ASSISTANT_MESSAGE_CHARS)}`)

  // 超长时优先保留开头（定主线）和结尾（看偏移），丢中间
  let lines = userLines
  while (lines.join('\n').length > DIGEST_CHARS && lines.length > 3 + RECENT_USER_MESSAGES) {
    lines = [...lines.slice(0, 3), ...lines.slice(4)]
  }
  return [...lines, ...assistantLines].join('\n')
}
