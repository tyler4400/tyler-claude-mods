// 不依赖引擎的纯逻辑：语言判断、截断、提示词、解析和时间格式，单独测试
import type { Lang, Recap, SessionRecord, TurnStats } from '../types'

const FIELD_MAX = 70
const OVERALL_MAX = 400

const LABELS = {
  zh: {
    turn: (n: number) => `第 ${n} 轮`,
    sep: '：',
    thisTurn: '本轮',
    calls: (n: number) => `${n} 次调用`,
    files: (n: number) => `改 ${n} 个文件`,
    next: '下一步',
    waiting: '等你',
    expand: '详情',
    collapse: '收起',
    fold: '折叠',
    loading: '正在生成详情…',
    failed: '详情生成失败，稍后再试。',
    expandedByCommand: '已在 where-am-i 卡片里展开详情。',
    noRecap: '还没有摘要，等这一轮结束后再试。',
  },
  en: {
    turn: (n: number) => `turn ${n}`,
    sep: ': ',
    thisTurn: 'This turn',
    calls: (n: number) => `${n} ${n === 1 ? 'call' : 'calls'}`,
    files: (n: number) => `${n} ${n === 1 ? 'file' : 'files'} edited`,
    next: 'next',
    waiting: 'waiting on you',
    expand: 'Details',
    collapse: 'Hide',
    fold: 'Fold',
    loading: 'Writing the details…',
    failed: 'Could not write the details. Try again later.',
    expandedByCommand: 'Opened the details in the where-am-i card.',
    noRecap: 'No recap yet. Try again after this turn ends.',
  },
}

export function labels(lang: Lang) {
  return LABELS[lang]
}

/** 中日韩文字占字母类字符三成以上视为中文会话 */
export function detectLang(text: string): Lang {
  const cjk = text.match(/[㐀-鿿豈-﫿]/g)?.length ?? 0
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0
  if (cjk === 0) return 'en'
  // 一个汉字的信息量约等于一个英文单词，按 1:4 折算字母
  return cjk / (cjk + latin / 4) >= 0.3 ? 'zh' : 'en'
}

export function resolveLang(option: unknown, sample: string): Lang {
  if (option === 'zh' || option === 'en') return option
  return detectLang(sample)
}

/** 保留开头和结尾（结论通常在末尾），中间注明省略了多少字，避免模型以为信息不全 */
export function headTail(text: string, head: number, tail: number): string {
  const chars = Array.from(text)
  if (chars.length <= head + tail) return text
  const omitted = chars.length - head - tail
  return `${chars.slice(0, head).join('')}\n[…中间省略 ${omitted} 字 / ${omitted} chars omitted…]\n${chars.slice(-tail).join('')}`
}

/** 一句话、最多 max 个字符；英文在词边界截断，中文直接截断 */
export function clip(text: string, max = FIELD_MAX): string {
  const first = text.trim().split(/(?<=[.!?。！？])\s*/)[0] ?? ''
  const chars = Array.from(first)
  if (chars.length <= max) return first.replace(/[.。]$/, '')
  const cut = chars.slice(0, max - 1).join('')
  const space = cut.lastIndexOf(' ')
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`
}

const LANG_RULE: Record<Lang, string> = {
  zh: '所有字段都用简体中文书写；代码标识符、文件路径、命令和专有名词保留原文。',
  en: 'Write every field in English.',
}

const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g
const TRAIL_ITEM_MAX = 150
const TRAIL_HEAD = 3
const TRAIL_TAIL = 12

type Message = { role: 'user' | 'assistant'; text: string }

/**
 * 你发过的全部消息各取开头一句，太多时保留最早几条和最近十几条。
 * 摘要只看这一轮时容易被眼前的小问题带偏，这条轨迹让模型认得出整个会话的主线。
 */
export function userTrail(messages: readonly Message[]): string {
  const items = messages
    .filter(m => m.role === 'user')
    .map(m => m.text.replace(SYSTEM_REMINDER, '').replace(/\s+/g, ' ').trim())
    .filter(text => text !== '')
    .map((text, i) => {
      const chars = Array.from(text)
      return `${i + 1}. ${chars.length > TRAIL_ITEM_MAX ? chars.slice(0, TRAIL_ITEM_MAX).join('') + '…' : text}`
    })
  if (items.length <= TRAIL_HEAD + TRAIL_TAIL) return items.join('\n')
  const omitted = items.length - TRAIL_HEAD - TRAIL_TAIL
  return [...items.slice(0, TRAIL_HEAD), `[…省略 ${omitted} 条 / ${omitted} messages omitted…]`, ...items.slice(-TRAIL_TAIL)].join('\n')
}

const MAINLINE_RULE = [
  'The mainline is what the whole session is working towards, judged from all of the person\'s messages, for example "build and publish a set of mods".',
  'A bug, question or detour that comes up on the way is a sub-problem of the mainline, not a new mainline, even if it takes several turns.',
  'The mainline changes only when the person moves on to a different piece of work for good.',
].join(' ')

export function summaryRequest(input: {
  lang: Lang
  previous: SessionRecord | null
  prompt: string
  tools: string[]
  answer: string
  messages: readonly Message[]
}) {
  const { lang, previous } = input
  const system = [
    'You keep a one-glance recap of a coding session. Plain words, no em dashes.',
    'Reply with JSON only: {"goal","now","waiting","next","overall"}.',
    `"goal", "now", "waiting", "next": one sentence each, at most ${FIELD_MAX} characters.`,
    MAINLINE_RULE,
    '"goal": the mainline. Keep the previous goal unless the mainline changed; never replace it with the current sub-problem.',
    '"now": what was just done. "waiting": what the assistant is waiting on from the person, or "". "next": the next step.',
    `"overall": a running summary of the whole session, at most ${OVERALL_MAX} characters, in this order: the mainline and why; milestones reached; the current sub-problem, if any; to-dos agreed but not done yet.`,
    'Update the previous overall summary with this turn. Keep the mainline and open to-dos until they are done; shorten finished sub-problems to their outcome; drop details that no longer matter.',
    'Text marked as omitted was cut for length on purpose: summarize from what is shown and do not treat the reply as incomplete.',
    LANG_RULE[lang],
  ].join('\n')
  const prompt = [
    `Previous recap: ${previous ? JSON.stringify(previous.recap) : 'none'}`,
    `Previous overall summary: ${previous?.overall || 'none'}`,
    `<all_messages_from_the_person>\n${userTrail(input.messages)}\n</all_messages_from_the_person>`,
    `The person's latest message:\n${headTail(input.prompt, 1000, 500)}`,
    `Tools used this turn: ${input.tools.join('; ') || 'none'}`,
    `The assistant's reply:\n${headTail(input.answer, 1500, 1500)}`,
  ].join('\n\n')
  return { system, prompt, maxTokens: 700 }
}

export function detailRequest(input: { lang: Lang; record: SessionRecord; messages: readonly Message[] }) {
  const recent = input.messages
    .filter(m => m.text.trim() !== '')
    .slice(-6)
    .map(m => `[${m.role === 'user' ? 'person' : 'assistant'}] ${headTail(m.text, 600, 600)}`)
    .join('\n\n')
  const system = [
    'The person has been away from this coding session long enough to forget it. Help them pick it up again.',
    MAINLINE_RULE,
    'Write one paragraph of 2 or 3 short sentences, in this order: the mainline and why; how far it got (the milestones that matter, and the current sub-problem only if one is open); what to do next to move the mainline forward, including to-dos agreed but not done yet.',
    'Start from the mainline, not from the latest sub-problem. End with the next steps.',
    'At most 180 Chinese characters or 90 English words. No bullets, headings or preamble.',
    'Plain words, no em dashes. Text marked as omitted was cut for length on purpose: do not treat it as incomplete.',
    LANG_RULE[input.lang],
  ].join('\n')
  const prompt = [
    `Overall summary so far: ${input.record.overall || 'none'}`,
    `Latest recap card: ${JSON.stringify(input.record.recap)}`,
    `<all_messages_from_the_person>\n${userTrail(input.messages)}\n</all_messages_from_the_person>`,
    `<recent_messages>\n${recent}\n</recent_messages>`,
    'Write the paragraph now, not a reply to the messages.',
  ].join('\n\n')
  return { system, prompt, maxTokens: 400 }
}

/** 这一轮要做什么：你发消息时生成，工作期间固定显示，不随工具调用跳动 */
export function intentRequest(input: { lang: Lang; previous: SessionRecord | null; prompt: string }) {
  const system = [
    'Say in one short phrase what the assistant is about to do in this turn of a coding session, based on the person\'s message.',
    'If the message is short (like "ok", "start", "go on"), infer it from the previous recap\'s next step and what was waiting on the person.',
    'At most 40 Chinese characters or 20 English words. Reply with the phrase only: no quotes, no trailing period.',
    LANG_RULE[input.lang],
  ].join('\n')
  const prompt = [
    `Previous recap: ${input.previous ? JSON.stringify(input.previous.recap) : 'none'}`,
    `The person's message:\n${headTail(input.prompt, 1000, 500)}`,
  ].join('\n\n')
  return { system, prompt, maxTokens: 80 }
}

export function parseIntent(text: string): string {
  const line = text.trim().split('\n')[0] ?? ''
  return clip(line.replace(/^["'“”「」]+|["'“”「」]+$/g, ''), 40)
}

/** 已用时：45s、1m32s、1h05m；中文用 秒/分/时 */
export function formatElapsed(ms: number, lang: Lang): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  if (lang === 'zh') return h > 0 ? `${h}时${pad(m)}分` : m > 0 ? `${m}分${pad(sec)}秒` : `${sec}秒`
  return h > 0 ? `${h}h${pad(m)}m` : m > 0 ? `${m}m${pad(sec)}s` : `${sec}s`
}

/** 解析模型返回的 JSON，容忍外面包了代码块 */
export function parseSummary(text: string): { recap: Recap; overall: string } | null {
  const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    const o = JSON.parse(body) as Record<string, unknown>
    const raw = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).replace(/\s*—\s*/g, ', ').trim() : '')
    const goal = clip(raw('goal'))
    if (!goal) return null
    const recap = { goal, now: clip(raw('now')), waiting: clip(raw('waiting')), next: clip(raw('next')) }
    return { recap, overall: Array.from(raw('overall')).slice(0, OVERALL_MAX * 2).join('') }
  } catch {
    return null
  }
}

/** 一个人会怎么描述这次工具调用 */
export function describeTool(e: Record<string, unknown>, lang: Lang): string {
  const tool = String(e.tool)
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const file = (p: string) => p.split('/').slice(-2).join('/')
  const zh = lang === 'zh'
  if (tool === 'Bash') return `${zh ? '运行' : 'running'} ${s('description') || s('command').slice(0, 60)}`
  if (tool === 'Edit' || tool === 'Write') return `${zh ? '编辑' : 'editing'} ${file(s('file_path'))}`
  if (tool === 'Read') return `${zh ? '读取' : 'reading'} ${file(s('file_path'))}`
  if (tool === 'Grep' || tool === 'Glob') return `${zh ? '搜索' : 'searching for'} ${s('pattern').slice(0, 40)}`
  if (tool === 'Agent') return `${zh ? '启动子代理：' : 'starting an agent: '}${s('description')}`
  if (tool === 'AskUserQuestion') return zh ? '向你提问' : 'asking you a question'
  if (tool.startsWith('mcp__')) return `${zh ? '使用' : 'using'} ${tool.split('__').slice(1).join(' ')}`
  return `${zh ? '使用' : 'using'} ${tool}`
}

/** 你发出的消息数，即轮次；工具结果的 user 行没有文字，不计入 */
export function countTurns(messages: readonly { role: string; text: string }[]): number {
  return messages.filter(m => m.role === 'user' && m.text.trim() !== '').length
}

/** 当天显示 HH:mm，其他日子显示 MM/DD HH:mm；offsetMinutes 是本机时区相对 UTC 的分钟数 */
export function formatTime(at: number, now: number, offsetMinutes: number): string {
  const local = (ms: number) => new Date(ms + offsetMinutes * 60_000)
  const a = local(at)
  const b = local(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  const time = `${pad(a.getUTCHours())}:${pad(a.getUTCMinutes())}`
  const sameDay = a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate()
  return sameDay ? time : `${pad(a.getUTCMonth() + 1)}/${pad(a.getUTCDate())} ${time}`
}

/** `date +%z` 的输出（+0800）转成分钟 */
export function parseOffset(z: string): number {
  const m = z.trim().match(/^([+-])(\d{2})(\d{2})$/)
  if (!m) return 0
  const minutes = Number(m[2]) * 60 + Number(m[3])
  return m[1] === '-' ? -minutes : minutes
}

/** 第二行右侧：调用次数 · 改了几个文件 · 用时 */
export function formatStats(stats: TurnStats, lang: Lang): string {
  const L = labels(lang)
  return [L.calls(stats.calls), ...(stats.files > 0 ? [L.files(stats.files)] : []), formatElapsed(stats.elapsedMs, lang)].join(' · ')
}
