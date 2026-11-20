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

export async function requestEditor(timeoutMs = 1500): Promise<EditorInfo | null> {
  const entries = await collect('editor', undefined, timeoutMs, null)
  const usable = entries
    .filter((entry) => entry.reply.kind !== 'none' && typeof entry.reply.code === 'string')
    .sort((a, b) => b.reply.code.length - a.reply.code.length)

  const best = usable[0]
  if (!best) return null

  pinned = best.source
  return { kind: best.reply.kind, code: best.reply.code, selector: best.reply.selector }
}

export async function writeEditor(code: string, timeoutMs = 2500): Promise<FrameReply | null> {
  let entries = await collect('write', code, timeoutMs, pinned)
  let hit = entries.find((entry) => entry.reply.wrote)?.reply

  if (!hit && pinned) {
    pinned = null
    entries = await collect('write', code, timeoutMs, null)
    hit = entries.find((entry) => entry.reply.wrote)?.reply
  }

  if (hit) return hit
  return entries.find((entry) => entry.reply.error)?.reply ?? entries[0]?.reply ?? null
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

/** 让编辑器拿到焦点并全选，为 CDP 受信任输入做准备。 */
export async function focusEditor(timeoutMs = 1500): Promise<boolean> {
  const entries = await collect('focus', undefined, timeoutMs, pinned)
  return entries.some((entry) => entry.reply.focused)
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
  const best = [...writers].sort((a, b) => b.reply.code.length - a.reply.code.length)[0]
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
