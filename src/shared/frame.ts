import type { EditorKind, EditorInfo } from './types.ts'

/**
 * 跨 frame 协议 v2：读编辑器、写编辑器、点评测、读结果。
 * top 与实训 iframe 不同源，唯一通道是 postMessage；探针跑在 MAIN world（见 manifest）。
 */
export const FRAME_CHANNEL = 'educoder-study/frame'

export type FrameOp = 'editor' | 'write' | 'submit' | 'result' | 'diagnose' | 'focus'

interface BaseRequest {
  channel: string
  dir: 'req'
  id: string
}

export type FrameRequest =
  | (BaseRequest & { op: 'editor' })
  | (BaseRequest & { op: 'write'; code: string })
  | (BaseRequest & { op: 'submit' })
  | (BaseRequest & { op: 'result' })
  | (BaseRequest & { op: 'diagnose' })
  | (BaseRequest & { op: 'focus' })

export interface FrameReply {
  channel: string
  dir: 'res'
  id: string
  op: FrameOp
  ok: boolean
  kind: EditorKind
  code: string
  selector: string
  error?: string
  wrote?: boolean
  clicked?: boolean
  buttonText?: string
  resultText?: string
  running?: boolean
  hasSubmit?: boolean
  resultLength?: number
  /** 写入策略：codemirror5.setValue / textarea.execCommand / contenteditable.innerText … */
  strategy?: string
  /** focus 结果：编辑器已获得焦点且全文被选中，可直接走受信任输入。 */
  focused?: boolean
  /** 候选编辑器摘要：textarea:/editable:/cm5:/term: 各自的标签.类名 宽×高，用来判断选中的是不是真编辑器。 */
  candidates?: string
}

export function makeRequest(id: string, op: FrameOp, code?: string): FrameRequest {
  switch (op) {
    case 'editor':
      return { channel: FRAME_CHANNEL, dir: 'req', id, op: 'editor' }
    case 'write':
      return { channel: FRAME_CHANNEL, dir: 'req', id, op: 'write', code: code ?? '' }
    case 'submit':
      return { channel: FRAME_CHANNEL, dir: 'req', id, op: 'submit' }
    case 'result':
      return { channel: FRAME_CHANNEL, dir: 'req', id, op: 'result' }
    case 'diagnose':
      return { channel: FRAME_CHANNEL, dir: 'req', id, op: 'diagnose' }
    case 'focus':
      return { channel: FRAME_CHANNEL, dir: 'req', id, op: 'focus' }
  }
}

export function isFrameRequest(data: unknown): data is FrameRequest {
  if (!data || typeof data !== 'object') return false
  const value = data as Record<string, unknown>
  if (value.channel !== FRAME_CHANNEL || value.dir !== 'req' || typeof value.id !== 'string') return false
  if (value.op === 'write') return typeof value.code === 'string'
  return (
    value.op === 'editor' ||
    value.op === 'submit' ||
    value.op === 'result' ||
    value.op === 'diagnose' ||
    value.op === 'focus'
  )
}

export function makeReply(id: string, op: FrameOp, patch: Partial<FrameReply> = {}): FrameReply {
  return {
    channel: FRAME_CHANNEL,
    dir: 'res',
    id,
    op,
    ok: true,
    kind: 'none',
    code: '',
    selector: '',
    ...patch,
  }
}

export function toReply(id: string, info: EditorInfo): FrameReply {
  return makeReply(id, 'editor', { kind: info.kind, code: info.code, selector: info.selector })
}
