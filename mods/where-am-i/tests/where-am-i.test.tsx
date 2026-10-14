import { describe, expect, mock, test } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } }

const SUMMARY = '{"goal":"让摘要跨重启保留","now":"写完卡片","waiting":"你确认样式","next":"跑测试","overall":"fork 了 where-am-i"}'

// 代替 mod 下面的引擎
function engine(on: any, store: Map<string, unknown>, sessionId = 's1') {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 13, 9, 0) })
  on('session.start', (_$: any, e: any) => ({ sessionId: 's1', cwd: e.cwd }))
  on('session.id', () => ({ value: sessionId }))
  on('session.cwd', () => ({ value: '/work' }))
  on('process.run', () => ({ value: { stdout: '+0800\n', stderr: '', code: 0 } }))
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
  on('prompt.submit', () => ({ text: '' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('model.complete', (_$: any, e: any) => ({
    value: { isAnswered: true, text: e.maxTokens === 80 ? '把详情上限改成 180 字' : SUMMARY, usage: { input_tokens: 1, output_tokens: 1 } },
  }))
  on('session.messages', () => ({ value: [{ role: 'user', text: '帮我把摘要做成卡片', toolUses: [] }, { role: 'assistant', text: '好', toolUses: [] }] }))
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

describe('where-am-i', () => {
  test('一轮结束后画出卡片，并写进 store', async ($, on) => {
    const store = new Map<string, unknown>()
    const clock = engine(on, store)
    await oneTurn($, clock)

    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'desktop', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /让摘要跨重启保留/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /等你：你确认样式/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^✅ 写完卡片$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^第 1 轮 · 17:00$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /band below/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /下一步/ })).toBeUndefined()
    await ui.unmount()

    const convKey = [...store.keys()].find(k => k.startsWith('conv:'))!
    expect((store.get('id:s1') as any).conv).toBe(convKey)
    const saved = store.get(convKey) as any
    expect(saved.recap.goal).toBe('让摘要跨重启保留')
    expect(saved.overall).toBe('fork 了 where-am-i')
    expect(saved.lang).toBe('zh')
  })

  test('0.3.0 之前按 session id 存的旧记录也能恢复', async ($, on) => {
    const store = new Map<string, unknown>([
      ['session:s1', { recap: { goal: '旧会话的目标', now: '做到一半', waiting: '', next: '继续' }, overall: '', turn: 7, lang: 'zh', updatedAt: Date.UTC(2026, 9, 13, 8, 0) }],
    ])
    const clock = engine(on, store)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'desktop', ...BAND } as any)
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

    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'desktop', ...BAND } as any)
    expect(await ui.find({ key: 'fold', text: '折叠' })).toBeDefined()
    await ui.press({ key: 'fold' })
    expect(store.get('pref:folded')).toBe(true)
    expect(await ui.find({ key: 'unfold' })).toBeDefined()
    // 胶囊优先显示等你处理的事，右侧只有更新时间和用时
    expect(await ui.find({ type: 'Text', text: /^⏳ 等你：你确认样式$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /让摘要跨重启保留/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^17:00 · 0秒$/ })).toBeDefined()
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

    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'desktop', ...BAND } as any)
    await ui.press({ key: 'detail' })
    await clock.settle()
    const saved = store.get([...store.keys()].find(k => k.startsWith('conv:'))!) as any
    expect(saved.detail.turn).toBe(1)
    expect(saved.detail.kind).toBe('mainline')
    await ui.unmount()
  })

  test('工作中第二行显示本轮目标和进度统计', async ($, on) => {
    const store = new Map<string, unknown>()
    const clock = engine(on, store)
    await oneTurn($, clock)

    await $.prompt.submit({ text: '详情改成最多 180 字' } as any)
    await clock.settle()
    await $.tool.call({ tool: 'Edit', file_path: '/work/mods/recap.ts', old_string: 'a', new_string: 'b' } as any)
    await $.tool.call({ tool: 'Read', file_path: '/work/mods/README.md' } as any)
    await clock.advance(92_000)

    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'desktop', ...BAND, props: { ...BAND.props, isWorking: true } } as any)
    expect(await ui.find({ type: 'Text', text: /^● 本轮：把详情上限改成 180 字$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2 次调用 · 改 1 个文件 · 1分32秒$/ })).toBeDefined()
    // 折叠后，工作中的胶囊显示这一轮在做什么和实时用时
    await ui.press({ key: 'fold' })
    expect(await ui.find({ type: 'Text', text: /^本轮：把详情上限改成 180 字$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^17:00 · 1分32秒$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^●$/ })).toBeDefined()
    await ui.press({ key: 'unfold' })
    await ui.unmount()

    await $.turn.complete({ reason: 'answer', answer: '改好了', durationMs: 1 } as any)
    await clock.settle()
    const idle = await $.ui.mount({ plugin: 'where-am-i', surface: 'desktop', ...BAND } as any)
    expect(await idle.find({ type: 'Text', text: /本轮/ })).toBeUndefined()
    // 轮到你时保留这一轮的最终统计，并写进 store
    expect(await idle.find({ type: 'Text', text: /^2 次调用 · 改 1 个文件 · 1分32秒$/ })).toBeDefined()
    await idle.unmount()
    const saved = store.get([...store.keys()].find(k => k.startsWith('conv:'))!) as any
    expect(saved.stats).toEqual({ calls: 2, files: 1, elapsedMs: 92_000 })
  })

  test('续接到新的 session id 后按对话内容找回卡片', async ($, on) => {
    const store = new Map<string, unknown>()
    const clock = engine(on, store, 's1')
    await oneTurn($, clock)
    const before = new Map(store)

    // 换一个 session id、同样的对话内容，模拟 app 重启后续接
    const resumed = new Map(before)
    resumed.delete('id:s1')
    store.clear()
    for (const [k, v] of resumed) store.set(k, v)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await clock.settle()

    const ui = await $.ui.mount({ plugin: 'where-am-i', surface: 'desktop', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /让摘要跨重启保留/ })).toBeDefined()
    await ui.unmount()
  })
})
