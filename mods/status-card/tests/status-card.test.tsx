import { describe, expect, mock, test } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } }

const SUMMARY = '{"goal":"让摘要跨重启保留","now":"写完卡片","waiting":"你确认样式","next":"跑测试","overall":"fork 了 status-card"}'

// 测试里可以切换的 session：id、transcript 里 grep 出的 sessionId 行、模型返回的摘要、transcript 里含 ephemeral_ 的行
type Ctx = { sessionId: string; transcript: string[]; summary: string; cacheLines?: string }

// 代替 mod 下面的引擎
function engine(on: any, store: Map<string, unknown>, ctx: Ctx = { sessionId: 's1', transcript: [], summary: SUMMARY }) {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 13, 9, 0) })
  // 对话随提交的消息和每轮回复增长
  const messages: { role: string; text: string; toolUses: never[] }[] = []
  on('session.start', (_$: any, e: any) => ({ sessionId: 's1', cwd: e.cwd }))
  on('session.id', () => ({ value: ctx.sessionId }))
  on('session.cwd', () => ({ value: '/work' }))
  on('process.run', (_$: any, e: any) => {
    const stdout =
      e.argv[0] === 'grep'
        ? ctx.transcript.map(id => `"sessionId":"${id}"\n`).join('')
        : e.argv[0] === 'sh'
          ? (ctx.cacheLines ?? '')
          : '+0800\n'
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('classic.SessionStart', () => ({}))
  on('classic.PostModelSwitch', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('session.end', (_$: any, e: any) => ({ sessionId: e.sessionId }))
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_$: any, e: any) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('prompt.submit', (_$: any, e: any) => {
    messages.push({ role: 'user', text: e.text, toolUses: [] })
    return { text: e.text }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.complete', (_$: any, e: any) => {
    messages.push({ role: 'assistant', text: e.answer, toolUses: [] })
    return { text: '' }
  })
  on('model.complete', (_$: any, e: any) => ({
    value: { isAnswered: true, text: e.maxTokens === 150 ? '把详情上限改成 180 字' : ctx.summary, usage: { input_tokens: 1, output_tokens: 1 } },
  }))
  on('session.messages', () => ({ value: [...messages] }))
  on('ui.render', ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'band below' })
  })
  return clock
}

async function oneTurn($: any, clock: any) {
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
  await $.prompt.submit({ text: '帮我把摘要做成卡片，样式选 E' } as any)
  await $.tool.call({ tool: 'Write', file_path: '/work/mods/a.tsx', content: 'x' } as any)
  await $.turn.complete({ reason: 'answer', answer: '已完成', durationMs: 1 } as any)
  await clock.settle()
}

describe('status-card', () => {
  test('后台通知等不是你打的字，不会把中文会话切成英文', async ($, on) => {
    const store = new Map<string, unknown>()
    const clock = engine(on, store)
    await oneTurn($, clock)

    await $.prompt.submit({ text: '<task-notification>\nBackground agent finished the review</task-notification>' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'noted', durationMs: 1 } as any)
    await clock.settle()
    const convKey = 'rec:s1'
    expect((store.get(convKey) as any).lang).toBe('zh')

    await $.prompt.submit({ text: 'Please rename the mod to status-card' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1 } as any)
    await clock.settle()
    expect((store.get(convKey) as any).lang).toBe('en')
  })

  test('一轮结束后画出卡片，并写进 store', async ($, on) => {
    const store = new Map<string, unknown>()
    const clock = engine(on, store)
    await oneTurn($, clock)

    const ui = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /让摘要跨重启保留/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /等你：你确认样式/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^✅ 写完卡片$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^第 1 轮 · 17:00$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /band below/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /下一步/ })).toBeUndefined()
    await ui.unmount()

    expect([...store.keys()].filter(k => !k.startsWith('pref:'))).toEqual(['rec:s1'])
    const saved = store.get('rec:s1') as any
    expect(saved.recap.goal).toBe('让摘要跨重启保留')
    expect(saved.overall).toBe('fork 了 status-card')
    expect(saved.lang).toBe('zh')
  })

  test('0.3.0 之前按 session id 存的旧记录也能恢复', async ($, on) => {
    const store = new Map<string, unknown>([
      ['session:s1', { recap: { goal: '旧会话的目标', now: '做到一半', waiting: '', next: '继续' }, overall: '', turn: 7, lang: 'zh', updatedAt: Date.UTC(2026, 9, 13, 8, 0) }],
    ])
    const clock = engine(on, store)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /旧会话的目标/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /第 7 轮/ })).toBeDefined()
    // 没有等你处理的事时第三行不显示下一步
    expect(await ui.find({ type: 'Text', text: /下一步/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^✅ 做到一半$/ })).toBeDefined()
    // 空闲时胶囊是 ✅ 加目标
    await ui.press({ key: 'fold' })
    expect(await ui.find({ type: 'Text', text: /^✅$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^🎯 旧会话的目标$/ })).toBeDefined()
    await ui.press({ key: 'unfold' })
    await ui.unmount()
  })

  test('折叠成胶囊，状态写进 store', async ($, on) => {
    const store = new Map<string, unknown>()
    const clock = engine(on, store)
    await oneTurn($, clock)

    const ui = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await ui.find({ key: 'fold', text: '折叠' })).toBeDefined()
    await ui.press({ key: 'fold' })
    expect(store.get('pref:folded')).toBe(true)
    expect(await ui.find({ key: 'unfold' })).toBeDefined()
    // 胶囊优先显示等你处理的事；轮到你时右侧不再显示用时，没有缓存记录时只剩更新时间
    expect(await ui.find({ type: 'Text', text: /^⏳ 等你：你确认样式$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /让摘要跨重启保留/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^17:00$/ })).toBeDefined()
    // 等你时只有 ⏳，没有 ✅
    expect(await ui.find({ type: 'Text', text: /^✅$/ })).toBeUndefined()
    await ui.press({ key: 'unfold' })
    expect(store.get('pref:folded')).toBe(false)
    await ui.unmount()
  })

  test('展开详情并缓存到 store', async ($, on) => {
    const store = new Map<string, unknown>()
    const clock = engine(on, store)
    await oneTurn($, clock)

    const ui = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    await ui.press({ key: 'detail' })
    await clock.settle()
    const saved = store.get('rec:s1') as any
    expect(saved.detail.turn).toBe(1)
    expect(saved.detail.kind).toBe('mainline')
    await ui.unmount()
  })

  test('工作中第二行显示本轮目标和进度统计', async ($, on) => {
    const store = new Map<string, unknown>()
    const clock = engine(on, store)
    await oneTurn($, clock)

    // 上一轮 17:00 结束，过了 5 分钟才发下一条
    await clock.advance(5 * 60_000)
    await $.prompt.submit({ text: '详情改成最多 180 字' } as any)
    await clock.settle()
    await $.tool.call({ tool: 'Edit', file_path: '/work/mods/recap.ts', old_string: 'a', new_string: 'b' } as any)
    await $.tool.call({ tool: 'Read', file_path: '/work/mods/README.md' } as any)
    await clock.advance(92_000)

    const ui = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND, props: { ...BAND.props, isWorking: true } } as any)
    expect(await ui.find({ type: 'Text', text: /^● 本轮：把详情上限改成 180 字$/ })).toBeDefined()
    // 轮次是正在进行的这一轮，时间是你发出消息的时间
    expect(await ui.find({ type: 'Text', text: /^第 2 轮 · 17:05$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^1分32秒$/ })).toBeDefined()
    // 折叠后，工作中的胶囊显示这一轮在做什么和实时用时
    await ui.press({ key: 'fold' })
    expect(await ui.find({ type: 'Text', text: /^本轮：把详情上限改成 180 字$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^17:05 · 1分32秒$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^●$/ })).toBeDefined()
    await ui.press({ key: 'unfold' })
    await ui.unmount()

    await $.turn.complete({ reason: 'answer', answer: '改好了', durationMs: 1 } as any)
    await clock.settle()
    const idle = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await idle.find({ type: 'Text', text: /本轮/ })).toBeUndefined()
    expect(await idle.find({ type: 'Text', text: /^第 2 轮 · 17:06$/ })).toBeDefined()
    // 轮到你时保留这一轮的最终统计，并写进 store
    expect(await idle.find({ type: 'Text', text: /^1分32秒$/ })).toBeDefined()
    await idle.unmount()
    const saved = store.get('rec:s1') as any
    expect(saved.stats).toEqual({ calls: 2, files: 1, elapsedMs: 92_000 })
  })

  test('一句话目标还没回来时，工作中的第二行显示 thinking ...，回来后换成目标', async ($, on) => {
    const store = new Map<string, unknown>()
    const clock = engine(on, store)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await $.prompt.submit({ text: '帮我把摘要做成卡片，样式选 E' } as any)

    const working = { plugin: 'status-card', surface: 'desktop', ...BAND, props: { ...BAND.props, isWorking: true } } as any
    const pending = await $.ui.mount(working)
    expect(await pending.find({ type: 'Text', text: /^● 本轮：thinking \.\.\.$/ })).toBeDefined()
    expect(await pending.find({ type: 'Text', text: /帮我把摘要做成卡片/ })).toBeUndefined()
    await pending.unmount()

    await clock.settle()
    const answered = await $.ui.mount(working)
    expect(await answered.find({ type: 'Text', text: /^● 本轮：把详情上限改成 180 字$/ })).toBeDefined()
    await answered.unmount()
  })

  test('英文会话一句话目标还没回来时显示 This turn: thinking ...', async ($, on) => {
    const store = new Map<string, unknown>()
    engine(on, store)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await $.prompt.submit({ text: 'Please rename the mod to status-card' } as any)

    const pending = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND, props: { ...BAND.props, isWorking: true } } as any)
    expect(await pending.find({ type: 'Text', text: /^● This turn: thinking \.\.\.$/ })).toBeDefined()
    await pending.unmount()
  })

  test('第一轮工作中就画出占位卡片，摘要出来后换成正式卡片', async ($, on) => {
    const store = new Map<string, unknown>()
    const clock = engine(on, store)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await $.prompt.submit({ text: '帮我把摘要做成卡片，样式选 E' } as any)
    await clock.settle()

    const working = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND, props: { ...BAND.props, isWorking: true } } as any)
    expect(await working.find({ type: 'Text', text: /^🎯 目标会在这一轮结束后总结$/ })).toBeDefined()
    expect(await working.find({ type: 'Text', text: /^● 本轮：把详情上限改成 180 字$/ })).toBeDefined()
    expect(await working.find({ type: 'Text', text: /^第 1 轮 · 17:00$/ })).toBeDefined()
    await working.unmount()
    // 占位卡片不写进 store
    expect(store.has('rec:s1')).toBe(false)

    // 这一轮结束、摘要还没出来时，第二行是这一轮的意图
    await $.turn.complete({ reason: 'answer', answer: '已完成', durationMs: 1 } as any)
    const waiting = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await waiting.find({ type: 'Text', text: /^✅ 把详情上限改成 180 字$/ })).toBeDefined()
    await waiting.unmount()

    await clock.settle()
    const done = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await done.find({ type: 'Text', text: /^🎯 让摘要跨重启保留$/ })).toBeDefined()
    expect(await done.find({ type: 'Text', text: /^第 1 轮 · 17:00$/ })).toBeDefined()
    await done.unmount()
  })

  test('同一目录、开场白相同的两个新 session 不共用卡片', async ($, on) => {
    const store = new Map<string, unknown>()
    const ctx: Ctx = { sessionId: 's1', transcript: [], summary: SUMMARY }
    const clock = engine(on, store, ctx)
    await oneTurn($, clock)
    const first = structuredClone(store.get('rec:s1'))

    // 另一个新 session：新进程里没有上一个 session 的卡片，对话内容和 s1 一样
    await $.session.end({ reason: 'clear', sessionId: ctx.sessionId } as any)
    ctx.sessionId = 's2'
    ctx.summary = '{"goal":"另一件事","now":"刚开始","waiting":"","next":"","overall":"s2"}'
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()
    const before = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await before.find({ type: 'Text', text: /让摘要跨重启保留/ })).toBeUndefined()
    await before.unmount()

    await $.prompt.submit({ text: '帮我把摘要做成卡片，样式选 E' } as any)
    await $.turn.complete({ reason: 'answer', answer: '已完成', durationMs: 1 } as any)
    await clock.settle()
    expect((store.get('rec:s2') as any).recap.goal).toBe('另一件事')
    expect(store.get('rec:s1')).toEqual(first)
  })

  test('fork 出来的 session 复制一份原卡片，之后各自更新', async ($, on) => {
    const parent = '11111111-1111-4111-8111-111111111111'
    const child = '22222222-2222-4222-8222-222222222222'
    const store = new Map<string, unknown>()
    const ctx: Ctx = { sessionId: parent, transcript: [], summary: SUMMARY }
    const clock = engine(on, store, ctx)
    await oneTurn($, clock)

    // fork：新 id，transcript 开头是从原 session 复制来的条目
    await $.session.end({ reason: 'clear', sessionId: ctx.sessionId } as any)
    ctx.sessionId = child
    ctx.transcript = [parent, parent, parent]
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    // 别的 session 的 transcript 不读
    await $.classic.SessionStart({ source: 'fork', transcript_path: `/t/${parent}.jsonl` } as any)
    expect(store.has(`rec:${child}`)).toBe(false)
    await $.classic.SessionStart({ source: 'fork', transcript_path: `/t/${child}.jsonl` } as any)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /^🎯 让摘要跨重启保留$/ })).toBeDefined()
    await ui.unmount()
    expect((store.get(`rec:${child}`) as any).recap.goal).toBe('让摘要跨重启保留')

    ctx.transcript = [parent, parent, child]
    ctx.summary = '{"goal":"分叉后的目标","now":"改了别的","waiting":"","next":"","overall":"fork"}'
    await $.prompt.submit({ text: '换个方向试试' } as any)
    await $.turn.complete({ reason: 'answer', answer: '好', durationMs: 1 } as any)
    await clock.settle()
    expect((store.get(`rec:${child}`) as any).recap.goal).toBe('分叉后的目标')
    expect((store.get(`rec:${parent}`) as any).recap.goal).toBe('让摘要跨重启保留')
  })

  test('默认保留 180 天：更久没更新的记录在会话启动时清掉', async ($, on) => {
    const dayAgo = (days: number) => Date.UTC(2026, 9, 13, 9, 0) - days * 24 * 60 * 60 * 1000
    const store = new Map<string, unknown>([
      ['rec:recent', { updatedAt: dayAgo(179) }],
      ['rec:stale', { updatedAt: dayAgo(181) }],
      ['cache:stale', { updatedAt: dayAgo(181) }],
      ['pref:folded', true],
    ])
    const clock = engine(on, store)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()

    expect([...store.keys()].sort()).toEqual(['pref:folded', 'rec:recent'])
  })

  test('0.5.x 的 conv: 记录按 id: 映射迁移到 rec:', async ($, on) => {
    const record = { recap: { goal: '旧版记录', now: '做到一半', waiting: '', next: '' }, overall: '', turn: 3, lang: 'zh', updatedAt: Date.UTC(2026, 9, 13, 8, 0) }
    const store = new Map<string, unknown>([
      ['conv:abc', record],
      ['id:s1', { conv: 'conv:abc', updatedAt: record.updatedAt }],
    ])
    const clock = engine(on, store)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /^🎯 旧版记录$/ })).toBeDefined()
    await ui.unmount()
    expect(store.get('rec:s1')).toEqual(record)
  })

  test('轮到你时右上角显示缓存剩余时间，按模型分开记，跨天不显示', async ($, on) => {
    const store = new Map<string, unknown>()
    const usage = (m5: number, h1: number) =>
      JSON.stringify({ type: 'assistant', isSidechain: false, message: { usage: { cache_creation: { ephemeral_5m_input_tokens: m5, ephemeral_1h_input_tokens: h1 } } } })
    const ctx: Ctx = { sessionId: 's1', transcript: [], summary: SUMMARY, cacheLines: usage(0, 900) }
    const clock = engine(on, store, ctx)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await $.classic.SessionStart({ source: 'startup', transcript_path: '/t/s1.jsonl' } as any)
    await $.prompt.submit({ text: '帮我把摘要做成卡片，样式选 E' } as any)
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5[1m]', messageCount: 1 } as any)) {
      // 只需要跑完这一步
    }
    await clock.advance(30_000)

    // 工作中不显示缓存
    const working = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND, props: { ...BAND.props, isWorking: true } } as any)
    expect(await working.find({ type: 'Text', text: /缓存/ })).toBeUndefined()
    await working.unmount()

    await $.turn.complete({ reason: 'answer', answer: '已完成', durationMs: 1 } as any)
    await clock.settle()
    expect(store.get('cache:s1')).toEqual({
      model: 'claude-opus-5-5',
      byModel: { 'claude-opus-5-5': { at: Date.UTC(2026, 9, 13, 9, 0), ttlMs: 3_600_000 } },
      updatedAt: Date.UTC(2026, 9, 13, 9, 0),
    })

    const ui = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    // 缓存从请求发出时算起，还剩 59 分 30 秒，向上取整
    expect(await ui.find({ type: 'Text', text: /^第 1 轮 · 17:00 · 缓存 60 分$/ })).toBeDefined()
    // 折叠后右侧是时间和缓存，不再显示用时
    await ui.press({ key: 'fold' })
    expect(await ui.find({ type: 'Text', text: /^17:00 · 缓存 60 分$/ })).toBeDefined()
    await ui.press({ key: 'unfold' })
    await ui.unmount()

    // 切到这次还没用过的模型算过期，切回来继续显示原模型的剩余时间
    await $.classic.PostModelSwitch({ to_model: 'claude-sonnet-5-5' } as any)
    let view = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await view.find({ type: 'Text', text: /^第 1 轮 · 17:00 · 缓存过期$/ })).toBeDefined()
    await view.unmount()
    await $.classic.PostModelSwitch({ to_model: 'claude-opus-5-5[1m]' } as any)
    await clock.advance(50 * 60_000)
    view = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    // 10 分钟以内单独标红
    expect(await view.find({ type: 'Text', text: /^第 1 轮 · 17:00 · $/ })).toBeDefined()
    expect(await view.find({ type: 'Text', text: /^缓存 10 分$/ })).toBeDefined()
    await view.unmount()

    await clock.advance(10 * 60_000)
    view = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await view.find({ type: 'Text', text: /^第 1 轮 · 17:00 · 缓存过期$/ })).toBeDefined()
    await view.unmount()

    // 第二天（本机时间 00:10）缓存提示和更新时间都不再显示
    await clock.set(Date.UTC(2026, 9, 13, 16, 10))
    view = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await view.find({ type: 'Text', text: /缓存/ })).toBeUndefined()
    expect(await view.find({ type: 'Text', text: /^第 1 轮$/ })).toBeDefined()
    await view.unmount()
  })

  test('热重载后没有 classic.SessionStart，从发消息时的 transcript 路径读缓存时长', async ($, on) => {
    const store = new Map<string, unknown>()
    const line = JSON.stringify({ type: 'assistant', message: { usage: { cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 900 } } } })
    const clock = engine(on, store, { sessionId: 's1', transcript: [], summary: SUMMARY, cacheLines: line })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await $.classic.UserPromptSubmit({ prompt: '帮我把摘要做成卡片，样式选 E', transcript_path: '/t/s1.jsonl' } as any)
    await $.prompt.submit({ text: '帮我把摘要做成卡片，样式选 E' } as any)
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as any)) {
      // 只需要跑完这一步
    }
    await $.turn.complete({ reason: 'answer', answer: '已完成', durationMs: 1 } as any)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /^第 1 轮 · 17:00 · 缓存 60 分$/ })).toBeDefined()
    await ui.unmount()
  })

  test('transcript 里读不到 TTL 时不显示缓存', async ($, on) => {
    const store = new Map<string, unknown>()
    const clock = engine(on, store, { sessionId: 's1', transcript: [], summary: SUMMARY, cacheLines: 'not json\n' })
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await $.classic.SessionStart({ source: 'startup', transcript_path: '/t/s1.jsonl' } as any)
    await $.prompt.submit({ text: '帮我把摘要做成卡片，样式选 E' } as any)
    for await (const _ of $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 } as any)) {
      // 只需要跑完这一步
    }
    await $.turn.complete({ reason: 'answer', answer: '已完成', durationMs: 1 } as any)
    await clock.settle()
    const ui = await $.ui.mount({ plugin: 'status-card', surface: 'desktop', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /缓存/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^第 1 轮 · 17:00$/ })).toBeDefined()
    await ui.unmount()
  })
})
