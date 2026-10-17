import { describe, expect, test } from 'claude-code/testing'

import { cacheHint, cacheTtlFromTranscript, clip, countTurns, detectLang, formatElapsed, formatTime, headTail, isTypedPrompt, modelKey, nextCacheChange, parseIntent, parseOffset, parseSummary, summaryRequest, userTrail } from '../hooks/recap'

describe('detectLang', () => {
  test('中文为主判为 zh，夹杂英文标识符也算', async () => {
    expect(detectLang('帮我安装 status-card 并看看 $.store 存在哪里')).toBe('zh')
  })
  test('纯英文判为 en', async () => {
    expect(detectLang('install status-card and check the store')).toBe('en')
  })
})

describe('isTypedPrompt', () => {
  test('输入框、desktop 和以你名义代发的消息算你打的字', async () => {
    expect(isTypedPrompt({ kind: 'composer' }, '帮我改个名')).toBe(true)
    expect(isTypedPrompt({ kind: 'sdk' }, '帮我改个名')).toBe(true)
    expect(isTypedPrompt({ kind: 'plugin', name: 'x', asUser: true }, '帮我改个名')).toBe(true)
  })
  test('后台通知、其他会话、定时任务和 plugin 自己发的不算', async () => {
    expect(isTypedPrompt({ kind: 'task-notification' }, 'Background task finished')).toBe(false)
    expect(isTypedPrompt({ kind: 'peer' }, 'Another Claude session sent a message')).toBe(false)
    expect(isTypedPrompt({ kind: 'scheduled-trigger' }, 'Run the daily check')).toBe(false)
    expect(isTypedPrompt({ kind: 'plugin', name: 'x' }, 'The x plugin says hi')).toBe(false)
  })
  test('引擎包装过的文本即使来自 desktop 也不算', async () => {
    expect(isTypedPrompt({ kind: 'sdk' }, '<task-notification>\nAgent finished</task-notification>')).toBe(false)
    expect(isTypedPrompt({ kind: 'composer' }, '<command-name>/clear</command-name>')).toBe(false)
  })
})

describe('headTail', () => {
  test('短文本原样返回', async () => {
    expect(headTail('abc', 2, 2)).toBe('abc')
  })
  test('长文本保留头尾并注明省略字数', async () => {
    const out = headTail('一二三四五六七八九十', 2, 3)
    expect(out.startsWith('一二\n')).toBe(true)
    expect(out.endsWith('\n八九十')).toBe(true)
    expect(out).toContain('省略 5 字')
  })
})

describe('clip', () => {
  test('中文超长时直接截断并加省略号', async () => {
    const out = clip('确'.repeat(100), 10)
    expect(Array.from(out).length).toBe(10)
    expect(out.endsWith('…')).toBe(true)
  })
  test('只取第一句', async () => {
    expect(clip('先做这个。再做那个。')).toBe('先做这个')
    expect(clip('升到 0.3.3，测试通过. Next step')).toBe('升到 0.3.3，测试通过')
  })
  test('英文在词边界截断', async () => {
    expect(clip('alpha beta gamma delta epsilon', 20)).toBe('alpha beta gamma…')
  })
})

describe('parseSummary', () => {
  test('容忍代码块，去掉破折号', async () => {
    const parsed = parseSummary('```json\n{"goal":"跨重启保留摘要","now":"写完卡片 — 待测试","waiting":"","next":"跑测试","overall":"决定 fork status-card"}\n```')
    expect(parsed?.recap).toEqual({ goal: '跨重启保留摘要', now: '写完卡片, 待测试', waiting: '', next: '跑测试' })
    expect(parsed?.overall).toBe('决定 fork status-card')
  })
  test('没有 goal 视为无效', async () => {
    expect(parseSummary('{"now":"x"}')).toBeNull()
  })
})

describe('summaryRequest', () => {
  test('带上上一份摘要和总体总结，并指定语言', async () => {
    const req = summaryRequest({
      lang: 'zh',
      previous: { recap: { goal: 'g', now: 'n', waiting: '', next: 'x' }, overall: '之前的总结', turn: 3, lang: 'zh', updatedAt: 0 },
      prompt: '开始',
      tools: ['编辑 a.ts'],
      answer: '好'.repeat(5000),
      messages: [{ role: 'user', text: '做一组 mods 并发布' }, { role: 'user', text: '开始' }],
    })
    expect(req.prompt).toContain('"goal":"g"')
    expect(req.prompt).toContain('之前的总结')
    expect(req.prompt).toContain('省略 2000 字')
    expect(req.system).toContain('简体中文')
    expect(req.prompt).toContain('1. 做一组 mods 并发布')
  })
})

describe('userTrail', () => {
  test('去掉 system-reminder，太多时保留最早和最近的消息', async () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({ role: 'user' as const, text: `消息${i + 1}<system-reminder>x</system-reminder>` }))
    const trail = userTrail([...messages, { role: 'assistant', text: '回复' }])
    expect(trail).toContain('1. 消息1')
    expect(trail).toContain('20. 消息20')
    expect(trail).toContain('省略 5 条')
    expect(trail).not.toContain('消息5\n')
    expect(trail).not.toContain('system-reminder')
    expect(trail).not.toContain('回复')
  })
})

describe('countTurns / formatTime / parseOffset', () => {
  test('只数有文字的 user 行', async () => {
    expect(countTurns([
      { role: 'user', text: '你好' },
      { role: 'assistant', text: '好' },
      { role: 'user', text: '' },
      { role: 'user', text: '继续' },
    ])).toBe(2)
  })
  test('当天只显示时间，其他日子带 MMDD，按本机时区', async () => {
    const offset = parseOffset('+0800')
    expect(offset).toBe(480)
    const at = Date.UTC(2026, 9, 13, 9, 5) // 本地 1013 17:05
    expect(formatTime(at, at + 60_000, offset)).toBe('17:05')
    expect(formatTime(at, at + 86_400_000, offset)).toBe('1013 17:05')
    // UTC 还是同一天，本地已经是第二天
    expect(formatTime(at, Date.UTC(2026, 9, 13, 17, 0), offset)).toBe('1013 17:05')
  })
})

describe('formatElapsed / parseIntent', () => {
  test('按时长选单位', async () => {
    expect(formatElapsed(45_000, 'zh')).toBe('45秒')
    expect(formatElapsed(92_000, 'zh')).toBe('1分32秒')
    expect(formatElapsed(3_900_000, 'en')).toBe('1h05m')
  })
  test('去掉引号，只取第一行', async () => {
    expect(parseIntent('「改卡片布局」\n多余的解释')).toBe('改卡片布局')
  })
})

describe('cacheTtlFromTranscript / cacheHint / nextCacheChange', () => {
  const row = (m5: number, h1: number, extra: object = {}) =>
    JSON.stringify({ type: 'assistant', ...extra, message: { usage: { cache_creation: { ephemeral_5m_input_tokens: m5, ephemeral_1h_input_tokens: h1 } } } })
  const at = Date.UTC(2026, 9, 13, 9, 0)
  const state = (ttlMs: number) => ({ model: 'opus', byModel: { opus: { at, ttlMs } }, updatedAt: at })

  test('取主线程最近一次写入缓存的 TTL，两种都写时按 5 分钟', async () => {
    expect(cacheTtlFromTranscript([row(0, 10), row(0, 0)].join('\n'))).toBe(3_600_000)
    expect(cacheTtlFromTranscript([row(0, 10), row(5, 0)].join('\n'))).toBe(300_000)
    expect(cacheTtlFromTranscript(row(3, 10))).toBe(300_000)
    expect(cacheTtlFromTranscript([row(0, 10), row(5, 0, { isSidechain: true }), 'oops'].join('\n'))).toBe(3_600_000)
    expect(cacheTtlFromTranscript('{"type":"user","message":{"content":"ephemeral_"}}')).toBeUndefined()
  })

  test('10 分钟以上是 fresh，以内是 low，过期是 expired；不是今天的不显示', async () => {
    expect(cacheHint(state(3_600_000), at + 30_000, 480, 'zh')).toEqual({ text: '缓存 60 分', tone: 'fresh' })
    expect(cacheHint(state(3_600_000), at + 50 * 60_000, 480, 'zh')).toEqual({ text: '缓存 10 分', tone: 'low' })
    expect(cacheHint(state(300_000), at + 10_000, 480, 'en')).toEqual({ text: 'cache 5m', tone: 'low' })
    expect(cacheHint(state(300_000), at + 300_000, 480, 'zh')).toEqual({ text: '缓存已失效', tone: 'expired' })
    expect(cacheHint({ ...state(3_600_000), model: 'sonnet' }, at, 480, 'en')).toEqual({ text: 'cache expired', tone: 'expired' })
    // 本机时间 17:00 用的缓存，到第二天 00:10 不再显示
    expect(cacheHint(state(3_600_000), Date.UTC(2026, 9, 13, 16, 10), 480, 'zh')).toBeUndefined()
    expect(cacheHint(null, at, 480, 'zh')).toBeUndefined()
  })

  test('在分钟数变化那一刻刷新，过期后不再刷新', async () => {
    expect(nextCacheChange(state(3_600_000), at + 30_000)).toBe(30_000)
    expect(nextCacheChange(state(3_600_000), at)).toBe(60_000)
    expect(nextCacheChange(state(300_000), at + 300_000)).toBeUndefined()
    expect(modelKey('claude-opus-5-5[1m]')).toBe('claude-opus-5-5')
  })
})
