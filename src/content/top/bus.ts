import { FRAME_CHANNEL, makeRequest, type FrameOp, type FrameReply } from '../../shared/frame.ts'
import type { EditorInfo, EditorKind } from '../../shared/types.ts'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** 回包最长的那个 frame 视为真正的编辑器所在帧，后续写入/提交只发给它。 */
let pinned: Window | null = null

interface ReplyEntry {
  reply: FrameReply
  source: Window | null
}

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 收集所有 iframe，同源时向下钻两层；顶层窗口自己也算一个目标（编辑器可能内嵌在顶层文档）。 */
function frameWindows(root: Document = document, depth = 0): Window[] {
  const found: Window[] = depth === 0 ? [window] : []
  let frames: HTMLIFrameElement[]
  try {
    frames = Array.from(root.querySelectorAll('iframe'))
  } catch {
    return found
  }

  for (const frame of frames) {
    const win = frame.contentWindow
    if (!win) continue
    found.push(win)
    if (depth >= 2) continue
    try {
      const nested = win.document
      if (nested) found.push(...frameWindows(nested, depth + 1))
    } catch {
      // 跨源帧读不到 document，它自己会在直接收到 postMessage 时回包。
    }
  }
  return found
}

async function collect(
  op: FrameOp,
  code: string | undefined,
  timeoutMs: number,
  target: Window | null,
): Promise<ReplyEntry[]> {
  const id = nextId()
  const entries: ReplyEntry[] = []

  const listener = (event: MessageEvent): void => {
    const data = event.data as FrameReply | null
    if (!data || data.channel !== FRAME_CHANNEL || data.dir !== 'res' || data.id !== id) return
    entries.push({ reply: data, source: (event.source as Window | null) ?? null })
  }

  window.addEventListener('message', listener)
  const targets = target ? [target] : frameWindows()
  try {
    for (const win of targets) {
      try {
        win.postMessage(makeRequest(id, op, code), '*')
      } catch {
        // 帧已销毁或跨源被拒，跳过。
      }
    }
    await sleep(timeoutMs)
  } finally {
    window.removeEventListener('message', listener)
  }

  return entries
}

/**
 * 挑选"真编辑器"所在帧。
 * 之前只按回读代码的长度排序——OJ 型页面里题面搜索框、隐藏模板 textarea 都可能更长，
 * 结果写到了搜索框上。现在先比探针候选打分（可见性/面积/渲染/离评测按钮的距离），
 * 打分相同才退回代码长度。
 */
function compareEditorReplies(a: ReplyEntry, b: ReplyEntry): number {
  const scoreDiff = (b.reply.score ?? 0) - (a.reply.score ?? 0)
  if (scoreDiff !== 0) return scoreDiff
  return (b.reply.code ?? '').length - (a.reply.code ?? '').length
}

export async function requestEditor(timeoutMs = 1500): Promise<EditorInfo | null> {
  const entries = await collect('editor', undefined, timeoutMs, null)
  const usable = entries
    .filter((entry) => entry.reply.kind !== 'none' && typeof entry.reply.code === 'string')
    .sort(compareEditorReplies)

  const best = usable[0]
  if (!best) return null

  pinned = best.source
  return {
    kind: best.reply.kind,
    code: best.reply.code,
    selector: best.reply.selector,
    score: best.reply.score,
    docKnown: best.reply.docKnown,
    renderText: best.reply.renderText,
  }
}

/** 广播写入时可能多个帧都报成功；按候选打分取最高的那个，避免写到别帧的可见文本框上。 */
function bestWriteEntry(entries: ReplyEntry[]): ReplyEntry | undefined {
  const hits = entries.filter((entry) => entry.reply.wrote)
  hits.sort((a, b) => (b.reply.score ?? 0) - (a.reply.score ?? 0))
  return hits[0]
}

export async function writeEditor(code: string, timeoutMs = 2500): Promise<FrameReply | null> {
  const entries = await collect('write', code, timeoutMs, pinned)
  const pinnedReply = pinned ? entries[0]?.reply : undefined
  const hit = bestWriteEntry(entries)
  if (hit) {
    if (hit.source) pinned = hit.source
    return hit.reply
  }

  // 固定帧没报成功时广播一次：别的帧可能有真编辑器。
  if (pinned) {
    pinned = null
    const broadcast = await collect('write', code, timeoutMs, null)
    const broadcastHit = bestWriteEntry(broadcast)
    if (broadcastHit) {
      if (broadcastHit.source) pinned = broadcastHit.source
      return broadcastHit.reply
    }
    // 广播也没成功：优先返回"确实找到了编辑器、只是判定失败"的那份回包，便于定位。
    if (pinnedReply && pinnedReply.kind !== 'none') {
      // 保留一次指向：后续 focus / active 必须发给同一个编辑器所在的帧。
      const sourceEntry = entries[0]
      if (sourceEntry?.source) pinned = sourceEntry.source
      return pinnedReply
    }
    const failure = broadcast.find((entry) => entry.reply.error) ?? broadcast[0]
    if (failure) {
      if (failure.source) pinned = failure.source
      return failure.reply
    }
    return pinnedReply ?? null
  }

  const only = entries.find((entry) => entry.reply.error) ?? entries[0]
  if (only?.source) pinned = only.source
  return only?.reply ?? null
}

export async function clickSubmit(timeoutMs = 2000): Promise<FrameReply | null> {  let entries = await collect('submit', undefined, timeoutMs, pinned)
  let hit = entries.find((entry) => entry.reply.clicked)?.reply

  if (!hit) {
    entries = await collect('submit', undefined, timeoutMs, null)
    hit = entries.find((entry) => entry.reply.clicked)?.reply
  }

  return hit ?? entries.find((entry) => entry.reply.error)?.reply ?? entries[0]?.reply ?? null
}

export async function readFrameResult(timeoutMs = 600): Promise<{ text: string; running: boolean }> {
  const entries = await collect('result', undefined, timeoutMs, pinned)
  for (const entry of entries) {
    const text = entry.reply.resultText?.trim()
    if (text) return { text, running: Boolean(entry.reply.running) }
  }
  return { text: '', running: false }
}

export function resetFramePin(): void {
  pinned = null
}

export interface FocusReport {
  /** document.activeElement 真的落在编辑器内部。 */
  focused: boolean
  /** 活动元素摘要（没进编辑器时是 body / 题面容器之类）。 */
  detail: string
  /** CDP 真实点击用的视口坐标。 */
  clickX: number
  clickY: number
  /** 回包帧是否顶层文档：只有顶层的坐标才等于标签页视口坐标。 */
  isTop: boolean
}

/** 让编辑器拿到焦点并全选，为 CDP 受信任输入做准备；返回的是**验证过**的焦点状态。 */
export async function focusEditor(timeoutMs = 1500): Promise<FocusReport> {
  const entries = await collect('focus', undefined, timeoutMs, pinned)
  const chosen =
    entries.find((entry) => entry.reply.focused) ?? entries.find((entry) => entry.reply.kind !== 'none')
  // 焦点落在哪一帧，后续的按键就该发给哪一帧。
  if (chosen?.source) pinned = chosen.source
  const reply = chosen?.reply ?? entries[0]?.reply

  return {
    focused: Boolean(reply?.focused),
    detail: reply?.focusDetail ?? (reply ? '未返回焦点信息' : '没有回包'),
    clickX: reply?.clickX ?? 0,
    clickY: reply?.clickY ?? 0,
    isTop: Boolean(reply?.isTop),
  }
}

/** 只读检查：焦点现在在不在编辑器里。按 Ctrl+A 前后各查一次。 */
export async function probeActive(
  timeoutMs = 900,
): Promise<{ insideEditor: boolean; detail: string; kind: EditorKind }> {
  const entries = await collect('active', undefined, timeoutMs, pinned)
  const chosen = entries.find((entry) => entry.reply.kind !== 'none') ?? entries[0]
  if (chosen?.source) pinned = chosen.source
  const reply = chosen?.reply
  return {
    insideEditor: Boolean(reply?.insideEditor),
    detail: reply?.focusDetail ?? (reply ? '未返回焦点信息' : '没有回包'),
    kind: reply?.kind ?? 'none',
  }
}

export interface FrameDiagnostics {
  iframes: number
  frames: number
  withEditor: number
  editorKind: EditorKind
  editorSelector: string
  hasSubmit: boolean
  submitLabel: string
  resultChars: number
  candidates: string
}

/** 只读自检：有多少 iframe、几个帧回包、能写的有几个、评测按钮找不找得到、结果区有没有内容。 */
export async function diagnose(timeoutMs = 1200): Promise<FrameDiagnostics> {
  const entries = await collect('diagnose', undefined, timeoutMs, null)
  const writers = entries.filter((entry) => entry.reply.kind !== 'none')
  const best = [...writers].sort(compareEditorReplies)[0]
  const submitEntry =
    writers.find((entry) => entry.reply.hasSubmit) ?? entries.find((entry) => entry.reply.hasSubmit)

  let iframes = 0
  try {
    iframes = document.querySelectorAll('iframe').length
  } catch {
    iframes = 0
  }

  return {
    iframes,
    frames: entries.length,
    withEditor: writers.length,
    editorKind: best?.reply.kind ?? 'none',
    editorSelector: best?.reply.selector ?? '',
    hasSubmit: Boolean(submitEntry),
    submitLabel: submitEntry?.reply.buttonText ?? '',
    resultChars: Math.max(0, ...entries.map((entry) => entry.reply.resultLength ?? 0)),
    candidates: entries.find((entry) => entry.reply.candidates)?.reply.candidates ?? '',
  }
}
