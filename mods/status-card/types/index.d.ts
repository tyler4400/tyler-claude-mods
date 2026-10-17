export type Lang = 'zh' | 'en'

/** 卡片上的四个字段：每轮由模型重写 */
export type Recap = { goal: string; now: string; waiting: string; next: string }

/** 展开的详情：按生成时的轮次缓存，轮次没变就不重新生成；kind 区分旧版格式，旧的缓存作废重写 */
export type Detail = { text: string; turn: number; kind?: 'mainline' }

/** 上一轮的统计：一轮结束后继续显示在第二行右侧 */
export type TurnStats = { calls: number; files: number; elapsedMs: number }

/** 每个会话在 $.store 里的一条记录，回看旧会话时靠它恢复卡片 */
export type SessionRecord = {
  recap: Recap
  /** 整个会话的滚动总结，每轮在上一份基础上更新 */
  overall: string
  turn: number
  lang: Lang
  updatedAt: number
  detail?: Detail
  stats?: TurnStats
  /** 第一份摘要出来前的占位卡片：只在内存里，不写进 store */
  draft?: true
}

/** 进行中这一轮的进度：一句话目标由模型写，turn 是这一轮在对话里的序号，其余在本地统计 */
export type TurnProgress = { intent: string; turn: number; calls: number; files: string[]; startedAt: number }

export type DetailView = { status: 'loading' | 'ready' | 'error'; text: string }

declare module 'claude-code' {
  interface PluginState {
    'status-card': {
      record: SessionRecord | null
      progress: TurnProgress | null
      clockNow: number
      isExpanded: boolean
      isFolded: boolean
      detail: DetailView | null
      transcriptPath: string
    }
  }
}
