import { describe, expect, test } from 'claude-code/testing'
import { buildDigest, parseTitle, resolveTitle, subjectOf } from './title-logic'

describe('parseTitle / subjectOf', () => {
  test('解析格式正确的标题', async () => {
    expect(parseTitle('探索｜1008｜ClaudeCode近期更新')).toEqual({ prefix: '探索', date: '1008', subject: 'ClaudeCode近期更新' })
  })
  test('手动标题整体当主体', async () => {
    expect(parseTitle('我的手动标题')).toBeUndefined()
    expect(subjectOf('我的手动标题')).toBe('我的手动标题')
  })
})

describe('resolveTitle', () => {
  const ctx = { today: '1008', current: '探索｜1008｜Mods调研' }

  test('KEEP 且日期是今天：不改', async () => {
    expect(resolveTitle('KEEP', ctx)).toBeUndefined()
  })
  test('KEEP 但日期过期：只换日期', async () => {
    expect(resolveTitle('KEEP', { ...ctx, current: '探索｜1007｜Mods调研' })).toBe('探索｜1008｜Mods调研')
  })
  test('半角分隔符和旧日期被纠正', async () => {
    expect(resolveTitle('实现 | 1001 | 会话标题mod', ctx)).toBe('实现｜1008｜会话标题mod')
  })
  test('禁用前缀和非两字前缀被丢弃', async () => {
    expect(resolveTitle('杂项｜1008｜随便', ctx)).toBeUndefined()
    expect(resolveTitle('Feature｜1008｜随便', ctx)).toBeUndefined()
  })
  test('主体锁定时只换前缀', async () => {
    expect(resolveTitle('实现｜1008｜别的主体', { ...ctx, lockedSubject: 'Mods调研' })).toBe('实现｜1008｜Mods调研')
  })
  test('KEEP 但带 fork 后缀：去掉后缀', async () => {
    expect(resolveTitle('KEEP', { ...ctx, current: '设置｜1008｜会话标题mod (fork)' })).toBe('设置｜1008｜会话标题mod')
  })
  test('新标题和锁定主体里的 fork 后缀都去掉', async () => {
    expect(resolveTitle('实现｜1008｜会话标题mod（fork）', ctx)).toBe('实现｜1008｜会话标题mod')
    expect(subjectOf('问题｜0929｜文件面板打不开rules文件 (fork)')).toBe('文件面板打不开rules文件')
  })
  test('先写主线再给结论：取最后一行', async () => {
    expect(resolveTitle('主线：改写并发布 where-am-i\n实现｜1008｜where-am-i改写与发布', ctx)).toBe('实现｜1008｜where-am-i改写与发布')
    expect(resolveTitle('主线：还在调研 mods\nKEEP', ctx)).toBeUndefined()
  })
  test('与当前标题相同：不改', async () => {
    expect(resolveTitle('探索｜1008｜Mods调研', ctx)).toBeUndefined()
  })
})

describe('buildDigest', () => {
  test('去掉 system-reminder，只留最近 3 条助手消息', async () => {
    const digest = buildDigest([
      { role: 'user', text: '问题一<system-reminder>内部提示</system-reminder>', toolUses: [] },
      ...['a', 'b', 'c', 'd'].map((text) => ({ role: 'assistant' as const, text, toolUses: [] })),
      { role: 'user', text: '', toolUses: [] },
    ])
    expect(digest).toBe('用户 1（近期）：问题一\n助手（近期）：b\n助手（近期）：c\n助手（近期）：d')
  })
})
