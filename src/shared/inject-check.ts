import type { EditorKind } from './types.ts'
import { normalizeForCompare } from './verdict.ts'

/**
 * 写入判据：写入是否真的生效，必须是"两个独立视角"同时成立。
 *
 * 之前只有一个视角——写入走实例 API，回读也走同一个实例。写成功了、回读一致，
 * 但页面上的可见编辑器可能是另一个（上一道题留下的隐藏实例、模板框、被替换掉的旧节点），
 * 于是"写入无反应"被报成"写入完成"。
 *
 * 两个视角：
 *   1) 文档视角：实例/元素的 value（写入走的通道）；
 *   2) 渲染视角：编辑器真正画在屏幕上的文本（.CodeMirror-code / .cm-content / .view-lines …）。
 * 文档一致但渲染没变 = 写进了一个看不见的实例，判失败，交给上层升级到受信任键入。
 *
 * 第三类编辑器（没有全局实例的 Monaco）：model 在模块作用域里，文档视角根本不存在，
 * 只能用渲染视角判——见 docKnown。
 */

export type InjectReason =
  | 'verified'
  | 'noop'
  | 'no-editor'
  | 'editor-hidden'
  | 'doc-mismatch'
  | 'render-stale'
  | 'render-blind'
  | 'api-unavailable'

export interface InjectObservation {
  kind: EditorKind
  /** 编辑器容器是否在可见区域（可见性闸门的结果）。 */
  visible: boolean
  /** 文档视角：写入后从实例/元素读到的内容。docKnown=false 时通常是空的。 */
  docText: string
  /** 渲染视角：编辑器画出来的文本（虚拟化时可能只有视口内的几行）。 */
  renderText: string
  /** 是否读得到完整文档值。false = 只有渲染文本（没有全局实例的 Monaco）。 */
  docKnown?: boolean
  /** 写入前的文档内容；缺省表示调用方没有采样。 */
  beforeDoc?: string
  /** 写入前的渲染内容（必须是在"滚到顶部之后"采样，否则滚动本身会被误当成内容变化）。 */
  beforeRender?: string
}

export interface InjectDecision {
  ok: boolean
  reason: InjectReason
  detail: string
}

const MIN_DISTINCTIVE_CHARS = 12
const SIGNATURE_LIMIT = 3
/** 命中判定用的上限：长代码也尽量多取几行，虚拟化视口里才有机会命中。 */
const SIGNATURE_SCAN_LIMIT = 40

export function countLines(text: string): number {
  if (!text) return 0
  return text.replace(/\r\n/g, '\n').split('\n').length
}

/** 比较用的紧凑形式：渲染文本的缩进和换行跟文档视角不一定一致，全部摈掉。 */
function compact(text: string): string {
  return text.replace(/\s+/g, '')
}

/**
 * 从目标代码里挑"特征行"：默认首、中、末三行；给命中判定用时可放宽到 40 行。
 *
 * 阈值取 12 个非空白字符：`int main() {`（10）这类模板里到处都有的短行不参与判定，
 * 否则上一题的残留模板会命中新代码的特征行，把"没写进去"判成"写进去了"。
 */
export function signatureLines(target: string, limit = SIGNATURE_LIMIT): string[] {
  const lines = target
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) return []

  const distinctive = lines.filter((line) => compact(line).length >= MIN_DISTINCTIVE_CHARS)
  const pool = distinctive.length > 0 ? distinctive : lines

  const seen = new Set<string>()
  const unique: string[] = []
  for (const line of pool) {
    const key = compact(line)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(line)
  }

  if (unique.length <= limit) return unique
  if (limit <= 1) return [unique[0]!]

  const picks: string[] = []
  for (let index = 0; index < limit; index += 1) {
    const position = Math.round((index * (unique.length - 1)) / (limit - 1))
    picks.push(unique[position]!)
  }
  return [...new Set(picks)]
}

const RENDER_UNAVAILABLE_FOR: ReadonlySet<EditorKind> = new Set(['terminal', 'none'])

/** 只有代码复读类控件才要求"渲染文本本身就等于文档"；其余控件允许虚拟化。 */
const RENDER_IS_DOCUMENT_FOR: ReadonlySet<EditorKind> = new Set(['textarea', 'contenteditable'])

/** 渲染文本里是否出现目标代码的特征行（虚拟化/滚动导致的截断不影响判定）。 */
export function renderContains(renderText: string, target: string): boolean {
  const compactRender = compact(renderText ?? '')
  if (!compactRender) return false
  return signatureLines(target, SIGNATURE_SCAN_LIMIT).some((line) => compactRender.includes(compact(line)))
}

export function decideInject(target: string, observation: InjectObservation): InjectDecision {
  const { kind } = observation

  if (kind === 'none') {
    return { ok: false, reason: 'no-editor', detail: '本帧没有可写入的编辑器。' }
  }

  if (!observation.visible) {
    return {
      ok: false,
      reason: 'editor-hidden',
      detail: '命中的编辑器不在可见区域：很可能是上一道题遗留的隐藏实例，写它页面不会有任何变化。',
    }
  }

  // 终端没有"文档"可写：内容通过真实键入进入 shell，结论以平台评测为准。
  if (RENDER_UNAVAILABLE_FOR.has(kind)) {
    return { ok: true, reason: 'verified', detail: '终端编辑器：写入结果以平台评测为准。' }
  }

  const render = observation.renderText ?? ''
  const compactRender = compact(render)
  const hits = signatureLines(target, SIGNATURE_SCAN_LIMIT).filter((line) =>
    compactRender.includes(compact(line)),
  )

  /**
   * 没有全局实例的 Monaco：读不到文档值（model 在模块作用域里），只剩渲染文本。
   * 这种编辑器不按"文档相等"判，按"屏幕上是不是这份代码"判——特征行命中即通过。
   */
  if (observation.docKnown === false) {
    if (hits.length > 0) {
      return { ok: true, reason: 'verified', detail: `渲染命中 ${hits.length} 行特征代码（该编辑器无文档视角）。` }
    }
    if (compactRender.length === 0) {
      return {
        ok: false,
        reason: 'render-blind',
        detail: '既读不到文档值，也读不到渲染文本：无法确认写入，按失败处理。',
      }
    }
    return {
      ok: false,
      reason: 'doc-mismatch',
      detail: '读不到该编辑器的文档值，渲染文本里也没有写入的代码：写入没有落到屏幕上。',
    }
  }

  const targetNorm = normalizeForCompare(target)
  const docNorm = normalizeForCompare(observation.docText)
  if (targetNorm !== docNorm) {
    return {
      ok: false,
      reason: 'doc-mismatch',
      detail: `文档回读 ${countLines(observation.docText)} 行，期望 ${countLines(target)} 行：编辑器没有接受这次写入，或随后被页面回滚。`,
    }
  }

  const docChanged =
    observation.beforeDoc !== undefined && normalizeForCompare(observation.beforeDoc) !== docNorm
  const renderChanged =
    observation.beforeRender !== undefined && compact(observation.beforeRender) !== compactRender

  if (hits.length > 0) {
    return { ok: true, reason: 'verified', detail: `渲染命中 ${hits.length} 行特征代码。` }
  }

  // 渲染文本读不到（canvas 自绘、虚拟化到空白）：这类编辑器没有可比的屏幕文本，
  // 只能退到"可见性闸门 + 文档视角 + 上层独立复核"三重条件，判通过但标注不可渲染校验。
  if (compactRender.length === 0) {
    if (RENDER_IS_DOCUMENT_FOR.has(kind)) {
      return {
        ok: false,
        reason: 'render-blind',
        detail: '文档读到了新内容，但控件渲染文本为空：写入可能只落在影子状态上。',
      }
    }
    return {
      ok: true,
      reason: 'render-blind',
      detail: '该编辑器读不到渲染文本（canvas/虚拟化），按可见性 + 文档视角判定，写入后再做一次独立复核。',
    }
  }

  // 内容本来就是目标：没有"变化"可言，文档一致即通过。
  if (!docChanged) {
    return { ok: true, reason: 'noop', detail: '写入前后内容一致（编辑器里已经是这份代码）。' }
  }

  // 文档变了、渲染也变了：视口里没命中特征行通常只是虚拟化/滚动位置，认可。
  if (renderChanged) {
    return { ok: true, reason: 'verified', detail: '渲染已随文档更新（特征行在视口之外）。' }
  }

  return {
    ok: false,
    reason: 'render-stale',
    detail: '文档值已更新但屏幕渲染没变：写的是隐藏/陈旧实例，页面上看到的仍是旧代码。',
  }
}
