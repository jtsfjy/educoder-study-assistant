import { decideInject } from '../../shared/inject-check.ts'
import { isFrameRequest, makeReply, type FrameReply, type FrameRequest } from '../../shared/frame.ts'
import { clickElement, scanResultText, scanSubmitButton } from '../../shared/result-dom.ts'
import type { EditorInfo, EditorKind } from '../../shared/types.ts'

/**
 * 实训区探针（MAIN world，所有帧都跑）。
 *
 * 两类实训区：
 *  - 终端型（xterm）：可见文本在 .xterm-rows，键盘输入走隐藏的 helper textarea；
 *  - OJ 型：普通代码编辑器，但可能拦复制、且编辑器里带着上一题的残留代码。
 *
 * 这轮的关键修正——**目标选取**与**写入判据**：
 *  1) 所有编辑器类型都过可见性闸门。之前 CM5/CM6/ACE/Monaco 完全没有闸门，
 *     命中的可能是上一道题遗留的隐藏实例：写进去"成功"、回读一致，屏幕毫无变化。
 *  2) 候选打分选出唯一的写入目标，并在后续读/写里固定它，避免"写到 A、读到 B"。
 *  3) 写入结果由两个独立视角判定：文档值（实例/value）+ 屏幕渲染文本。
 *     文档变了但渲染没变 = 写进了看不见的实例，判失败，交给上层升级为受信任键入。
 */
type DomNode = Element & Record<string, any>

type TerminalTag = 'codemirror5' | 'codemirror6' | 'ace' | 'monaco' | 'textarea' | 'contenteditable' | 'terminal'

const CM5_SELECTOR = '.CodeMirror'
const CM6_SELECTOR = '.cm-editor'
const ACE_SELECTOR = '.ace_editor'
const MONACO_SELECTOR = '.monaco-editor'
const EDITABLE_SELECTOR = '[contenteditable="true"], [contenteditable=""]'

const KIND_SELECTOR: Record<EditorKind, string> = {
  codemirror5: CM5_SELECTOR,
  codemirror6: CM6_SELECTOR,
  ace: ACE_SELECTOR,
  monaco: MONACO_SELECTOR,
  textarea: 'textarea',
  contenteditable: EDITABLE_SELECTOR,
  terminal: '.xterm',
  none: '',
}

/** 同分时的偏好：真编辑器实例 > 普通文本控件 > 终端。 */
const KIND_BONUS: Record<TerminalTag, number> = {
  codemirror5: 30,
  codemirror6: 30,
  ace: 30,
  monaco: 30,
  textarea: 20,
  contenteditable: 10,
  terminal: 25,
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 深度查询：穿透 open shadow root，返回全部命中。
 * 平台把编辑器塞进 Web Component 时，document.querySelector 看不到，只能往下钻。
 */
function deepQueryAll(
  selector: string,
  root: ParentNode = document,
  depth = 0,
  out: Element[] = [],
): Element[] {
  let direct: Element[] = []
  try {
    direct = Array.from(root.querySelectorAll(selector))
  } catch {
    direct = []
  }
  for (const element of direct) out.push(element)
  if (depth >= 3) return out

  let all: Element[] = []
  try {
    all = Array.from(root.querySelectorAll('*'))
  } catch {
    return out
  }
  const limit = Math.min(all.length, 1500)
  for (let index = 0; index < limit; index += 1) {
    const element = all[index]
    if (!element) continue
    const shadow = (element as DomNode).shadowRoot as ShadowRoot | null
    if (!shadow) continue
    deepQueryAll(selector, shadow, depth + 1, out)
  }
  return out
}

function rectOf(element: Element): { width: number; height: number; top: number; left: number } {
  const rect = element.getBoundingClientRect()
  return { width: rect.width, height: rect.height, top: rect.top, left: rect.left }
}

function describeElement(element: Element): string {
  const className =
    typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
  const rect = rectOf(element)
  return `${element.tagName.toLowerCase()}${className ? `.${className}` : ''} ${Math.round(rect.width)}×${Math.round(rect.height)}`
}

/**
 * 可见性闸门：所有编辑器类型共用。
 * 隐藏实例（display:none、被折叠的标签页、上一道题留下的 DOM）宽高会掉到 0，
 * 或者 checkVisibility 直接给 false——这类目标写进去页面不会有任何反应。
 */
function isVisibleControl(element: Element): boolean {
  if (!element.isConnected) return false
  const rect = rectOf(element)
  if (rect.width < 80 || rect.height < 18) return false

  const view = element.ownerDocument.defaultView
  if (!view) return false
  const style = view.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  if (Number.parseFloat(style.opacity || '1') <= 0.05) return false

  const checker = (element as DomNode).checkVisibility
  if (typeof checker === 'function') {
    try {
      return Boolean(checker.call(element, { checkOpacity: true, checkVisibilityCSS: true }))
    } catch {
      return true
    }
  }
  return true
}

function innerTextOf(host: Element, selectors: string[]): string {
  for (const selector of selectors) {
    let node: Element | null = null
    try {
      node = host.querySelector(selector)
    } catch {
      node = null
    }
    if (!node) continue
    const text = (node as HTMLElement).innerText ?? node.textContent ?? ''
    if (text.trim()) return text.replace(/\r\n/g, '\n')
  }
  return ''
}

/** xterm 之类的终端：可见文本在 .xterm-rows 里，键盘输入走一个隐藏的 helper textarea。 */
function terminalText(root: Element): string {
  const rows = root.querySelector('.xterm-rows') ?? root.querySelector('.xterm-screen') ?? root
  const text = (rows as HTMLElement).innerText ?? rows.textContent ?? ''
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000)
}

interface Candidate {
  kind: TerminalTag
  host: Element
  instance: any
  doc: string
  render: string
  hidden: boolean
  score: number
  /** 是否读得到完整的文档值。false = 只有渲染文本可看（没有全局实例的 Monaco）。 */
  docKnown: boolean
}

function makeCandidate(
  kind: TerminalTag,
  host: Element,
  instance: any,
  doc: string,
  render: string,
  submitCenter: { x: number; y: number } | null,
  docKnown = true,
): Candidate {
  const hidden = !isVisibleControl(host)
  const rect = rectOf(host)

  let score = hidden ? 0 : 1000
  score += Math.min((rect.width * rect.height) / 2000, 300)
  if (render.trim()) score += 120
  if (submitCenter && !hidden) {
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const distance = Math.hypot(centerX - submitCenter.x, centerY - submitCenter.y)
    score += Math.max(0, 260 - distance / 3)
  }
  score += Math.min(doc.length / 80, 120)
  score += KIND_BONUS[kind]

  return { kind, host, instance, doc, render, hidden, score, docKnown }
}

function submitCenter(): { x: number; y: number } | null {
  const button = scanSubmitButton(document)
  if (!button) return null
  const rect = button.element.getBoundingClientRect()
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
}

/** Monaco 渲染后才会出现的结构标记；不依赖任何全局对象。 */
const MONACO_MARKERS = '.view-lines, .margin-view-overlays, .monaco-scrollable-element'

/** 编辑器根节点：判断"焦点是不是在这一个编辑器里"用。 */
const EDITOR_ROOT_SELECTOR = '.monaco-editor, .CodeMirror, .cm-editor, .ace_editor'

function editorRootOf(element: Element | null): Element | null {
  if (!element) return null
  try {
    return element.closest(EDITOR_ROOT_SELECTOR)
  } catch {
    return null
  }
}

/**
 * 从编辑器内部元素往上找"真正的容器"。
 * Monaco 的输入 textarea 天生是 1×1、光标定位用，可见面积在祖先节点上；
 * 只按 textarea 的尺寸过可见性闸门，会把整个编辑器判成隐藏。
 */
function walkUpSized(element: Element, minWidth = 200, minHeight = 80, limit = 8): Element | null {
  let current: Element | null = element.parentElement
  for (let depth = 0; depth < limit && current; depth += 1) {
    const rect = rectOf(current)
    if (rect.width >= minWidth && rect.height >= minHeight) return current
    current = current.parentElement
  }
  return null
}

/**
 * Monaco 容器。
 *
 * 注意不能写 `closest('[class*="monaco"]')`：`.view-lines` 自己的 class 里就带 monaco
 * （`view-lines monaco-mouse-cursor-text`），自匹配会把容器选成 `.view-lines`，
 * 而 Monaco 的输入 textarea 是它的兄弟节点——之后"焦点在不在编辑器里"就永远判 false。
 * 这里按"同时含有 view-lines 与 inputarea 的最近祖先"来找。
 */
function monacoRoot(element: Element): Element | null {
  const exact = element.closest('.monaco-editor, [class*="monaco-editor"]')
  if (exact) return exact

  let current: Element | null = element
  for (let depth = 0; depth < 12 && current; depth += 1) {
    const hasMarker = Boolean(current.querySelector('.view-lines, .margin-view-overlays'))
    const hasInput = Boolean(current.querySelector('textarea.inputarea, textarea.monaco-mouse-cursor-text'))
    if (hasMarker && hasInput) return current
    current = current.parentElement
  }
  return walkUpSized(element)
}

function monacoHosts(): Element[] {
  const hosts = new Set<Element>()

  for (const element of deepQueryAll('.monaco-editor, [class*="monaco-editor"]')) hosts.add(element)

  for (const element of deepQueryAll(MONACO_MARKERS)) {
    const container = monacoRoot(element) ?? walkUpSized(element)
    if (!container) continue
    // 标记元素可见、但它选出来的祖先没面积（平台多包了一层 0×0 的壳）：从标记元素自己往上找。
    if (!isVisibleControl(container) && isVisibleControl(element)) {
      hosts.add(walkUpSized(element) ?? container)
      continue
    }
    hosts.add(container)
  }

  // 容器类名被平台改过：靠"Monaco 的输入框 + 旁边有 view-lines"反推容器。
  if (hosts.size === 0) {
    for (const area of deepQueryAll('textarea.inputarea, textarea.monaco-mouse-cursor-text')) {
      const container = walkUpSized(area)
      if (container && container.querySelector(MONACO_MARKERS)) hosts.add(container)
    }
  }

  return [...hosts]
}

function monacoCandidates(center: { x: number; y: number } | null): Candidate[] {
  const out: Candidate[] = []
  const api = (window as unknown as Record<string, any>).monaco

  let editors: any[] = []
  try {
    editors = api?.editor?.getEditors?.() ?? []
  } catch {
    editors = []
  }

  for (const host of monacoHosts()) {
    let instance: any = null
    for (const editor of editors) {
      try {
        const node = editor.getDomNode?.() ?? null
        if (node && (host.contains(node) || node.contains(host))) {
          instance = editor
          break
        }
      } catch {
        // 单个 editor 取 DOM 失败不影响其它候选。
      }
    }

    let doc = ''
    let docKnown = false
    if (typeof instance?.getValue === 'function') {
      try {
        doc = String(instance.getValue() ?? '')
        docKnown = true
      } catch {
        docKnown = false
      }
    }

    const render = innerTextOf(host, ['.view-lines', '.monaco-scrollable-element'])
    out.push(makeCandidate('monaco', host, instance, doc, render, center, docKnown))
  }

  return out
}

/** 把页面上所有像编辑器的元素都摊开，带可见性、文档长度、渲染长度，供打分与诊断。 */
function collectCandidates(): Candidate[] {
  const center = submitCenter()
  const list: Candidate[] = []

  for (const host of deepQueryAll(CM5_SELECTOR)) {
    const instance = (host as DomNode).CodeMirror
    if (typeof instance?.getValue !== 'function') continue
    let doc = ''
    try {
      doc = String(instance.getValue() ?? '')
    } catch {
      continue
    }
    list.push(makeCandidate('codemirror5', host, instance, doc, innerTextOf(host, ['.CodeMirror-code', '.CodeMirror-lines']), center))
  }

  for (const host of deepQueryAll(CM6_SELECTOR)) {
    const holder = (host as DomNode).cmView
    const view = holder?.view ?? holder?.rootView?.view ?? (holder?.state ? holder : null)
    if (!view?.state?.doc) continue
    let doc = ''
    try {
      doc = String(view.state.doc.toString())
    } catch {
      continue
    }
    list.push(makeCandidate('codemirror6', host, view, doc, innerTextOf(host, ['.cm-content']), center))
  }

  for (const host of deepQueryAll(ACE_SELECTOR)) {
    const instance = (host as DomNode).env?.editor
    if (typeof instance?.getValue !== 'function') continue
    let doc = ''
    try {
      doc = String(instance.getValue() ?? '')
    } catch {
      continue
    }
    list.push(makeCandidate('ace', host, instance, doc, innerTextOf(host, ['.ace_text-layer', '.ace_content']), center))
  }

  // Monaco：**不能只看 window.monaco**。平台把 Monaco 打包成模块时全局不存在，
  // 但 DOM 里照样有 .monaco-editor / .view-lines / textarea.inputarea。
  // 只按全局找，OJ 型实训区就会"编辑器 未找到"——本轮真机反馈就是这么来的。
  list.push(...monacoCandidates(center))

  for (const host of deepQueryAll('textarea')) {
    const textarea = host as HTMLTextAreaElement
    list.push(makeCandidate('textarea', host, textarea, textarea.value ?? '', textarea.value ?? '', center))
  }

  for (const host of deepQueryAll(EDITABLE_SELECTOR)) {
    const editable = host as HTMLElement
    if (!editable.isContentEditable) continue
    const text = editable.innerText ?? ''
    list.push(makeCandidate('contenteditable', host, editable, text, text, center))
  }

  // 终端只认真正的 xterm 结构（.xterm-rows / .xterm-helper-textarea / .xterm-screen）。
  // 光凭类名里带 terminal/console 会把评测结果面板误判成终端——那玩意一"写入"就是往结果区打字。
  const terminals = deepQueryAll('.xterm').concat(
    deepQueryAll('[class*="terminal"], [class*="console"]').filter((element) =>
      Boolean(element.querySelector('.xterm-rows, .xterm-screen, .xterm-helper-textarea')),
    ),
  )
  const seenTerminal = new Set<Element>()
  for (const host of terminals) {
    if (seenTerminal.has(host)) continue
    seenTerminal.add(host)
    const text = terminalText(host)
    list.push(makeCandidate('terminal', host, null, text, text, center))
  }

  return list
}

/** 固定下来的写入目标。页面重渲染后元素会失联，下次选取自动重挑。 */
let pinnedHost: Element | null = null

function pickTarget(): Candidate | null {
  const visible = collectCandidates()
    .filter((candidate) => !candidate.hidden)
    .sort((a, b) => b.score - a.score)

  if (visible.length === 0) {
    pinnedHost = null
    return null
  }

  const pinned = pinnedHost ? visible.find((candidate) => candidate.host === pinnedHost) : null
  const chosen = pinned ?? visible[0]!
  pinnedHost = chosen.host
  return chosen
}

function snapshotOf(target: Candidate): Candidate | null {
  const list = collectCandidates()
  return list.find((candidate) => candidate.host === target.host) ?? null
}

function candidateSummary(chosen: Element | null = pinnedHost): string {
  const list = collectCandidates().sort((a, b) => b.score - a.score)
  const picked = list.some((candidate) => !candidate.hidden)
  const parts = list.slice(0, 6).map((candidate) => {
    const mark = candidate.host === chosen ? '*' : ''
    const hidden = candidate.hidden ? '[隐藏]' : ''
    const known = candidate.docKnown ? '' : ' doc=?'
    return `${mark}${candidate.kind}:${describeElement(candidate.host)}${hidden} doc=${candidate.doc.length} ren=${candidate.render.length}${known}`
  })

  // 一个可见候选都没有时，把"长得像编辑器但没认出来"的元素摊出来，下一轮不用瞎猜。
  if (!picked) {
    const extras = deepQueryAll('[class*="editor"], [class*="code"], [class*="monaco"], [class*="view-line"]')
      .filter((element) => isVisibleControl(element))
      .slice(0, 4)
      .map((element) => describeElement(element))
    if (extras.length > 0) parts.push(`未识别:${extras.join(' ')}`)
  }

  return parts.join(' | ')
}

function readEditor(): EditorInfo {
  const target = pickTarget()
  if (!target) return { kind: 'none', code: '', selector: '', docKnown: false, renderText: '' }
  return {
    kind: target.kind,
    code: target.doc || target.render,
    selector: KIND_SELECTOR[target.kind],
    score: Math.round(target.score),
    docKnown: target.docKnown,
    renderText: target.render.slice(0, 1500),
  }
}

/** 通知框架：部分封装组件订阅容器上的 input/change，而不是编辑器实例。 */
function pulse(element: Element | null): void {
  if (!element) return
  for (const type of ['input', 'change']) {
    element.dispatchEvent(new Event(type, { bubbles: true }))
  }
}

function selectAllIn(element: HTMLElement): void {
  const selection = element.ownerDocument.getSelection()
  if (!selection) return
  const range = element.ownerDocument.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
}

/** 走浏览器自己的输入管线：会触发 beforeinput/input，受控组件能吃下。不是 paste，绕开 paste 拦截。 */
function insertViaExecCommand(element: HTMLElement, code: string): boolean {
  element.focus()
  try {
    return element.ownerDocument.execCommand('insertText', false, code)
  } catch {
    return false
  }
}

function setTextareaValue(textarea: HTMLTextAreaElement, code: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
  if (setter) setter.call(textarea, code)
  else textarea.value = code
  pulse(textarea)
}

function setEditableValue(element: HTMLElement, code: string): void {
  element.innerText = code
  try {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: code }))
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

/**
 * 滚到第一行。渲染视角采样前必须做，否则"滚动"本身会被当成"内容变了"，
 * 把一次没生效的写入判成成功。
 */
function scrollToTop(target: Candidate): void {
  try {
    switch (target.kind) {
      case 'codemirror5':
        target.instance.scrollTo?.(null, 0)
        break
      case 'codemirror6': {
        const dom = target.instance.scrollDOM as HTMLElement | undefined
        if (dom) dom.scrollTop = 0
        break
      }
      case 'ace':
        target.instance.renderer?.scrollToY?.(0)
        target.instance.scrollToLine?.(0)
        break
      case 'monaco':
        target.instance.setScrollPosition?.({ scrollTop: 0 })
        target.instance.revealLine?.(1)
        break
      default:
        if (target.host instanceof HTMLElement) target.host.scrollTop = 0
    }
  } catch {
    // 滚动失败不影响后续判定，忽略。
  }
}

interface WriteOutcome {
  strategy: string
  /** true 表示这条路径没把代码写进文档，调用方不要再指望校验通过。 */
  skipped?: boolean
  error?: string
}

function writeInto(target: Candidate, code: string): WriteOutcome {
  try {
    switch (target.kind) {
      case 'codemirror5': {
        target.instance.setValue(code)
        target.instance.focus?.()
        target.instance.clearHistory?.()
        target.instance.refresh?.()
        pulse(target.host)
        return { strategy: 'codemirror5.setValue' }
      }
      case 'codemirror6': {
        const view = target.instance
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: code },
          selection: { anchor: code.length },
          scrollIntoView: true,
        })
        pulse(target.host)
        return { strategy: 'codemirror6.dispatch' }
      }
      case 'ace': {
        target.instance.setValue(code, -1)
        target.instance.clearSelection?.()
        target.instance.gotoLine?.(1, 0, false)
        target.instance.scrollToLine?.(0)
        pulse(target.host)
        return { strategy: 'ace.setValue' }
      }
      case 'monaco': {
        if (typeof target.instance?.setValue !== 'function') {
          // 没有全局实例 = 拿不到 model。别硬写一个空壳，交给受信任键入整篇替换。
          return {
            strategy: 'monaco.trusted',
            skipped: true,
            error: '这个 Monaco 编辑器没有可用的全局实例，改用受信任键入（Ctrl+A + 插入）整篇替换。',
          }
        }
        target.instance.setValue?.(code)
        target.instance.setScrollPosition?.({ scrollTop: 0 })
        target.instance.revealLine?.(1)
        pulse(target.host)
        return { strategy: 'monaco.setValue' }
      }
      case 'textarea': {
        const textarea = target.instance as HTMLTextAreaElement
        textarea.focus()
        textarea.select()
        const inserted = insertViaExecCommand(textarea, code)
        if (!inserted) setTextareaValue(textarea, code)
        return { strategy: inserted ? 'textarea.execCommand' : 'textarea.setter' }
      }
      case 'contenteditable': {
        const editable = target.host as HTMLElement
        editable.focus()
        selectAllIn(editable)
        const inserted = insertViaExecCommand(editable, code)
        if (!inserted) setEditableValue(editable, code)
        return { strategy: inserted ? 'contenteditable.execCommand' : 'contenteditable.innerText' }
      }
      case 'terminal':
        // 终端没有"文档"可写：必须走真实键入（受信任输入），这里只标记类型让上层降级。
        return {
          strategy: 'terminal.trusted',
          skipped: true,
          error: '终端编辑器（xterm）：常规写入跳过，改用受信任键入 + 回车执行。',
        }
    }
  } catch (error) {
    return {
      strategy: `${target.kind}.error`,
      skipped: true,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  return { strategy: 'none', skipped: true, error: '未识别的编辑器类型。' }
}

interface SubmitResult {
  clicked: boolean
  buttonText?: string
  error?: string
}

function submitEditor(): SubmitResult {
  const target = scanSubmitButton(document)
  if (!target) return { clicked: false, error: '未找到"评测/提交"按钮。' }
  clickElement(target.element)
  return { clicked: true, buttonText: target.label }
}

function readResult(): { text: string; running: boolean } {
  const text = scanResultText(document)
  const running = /(评测|判题|运行|提交)中/.test(text)
  return { text: text.slice(0, 6000), running }
}

/**
 * 焦点是否真的在编辑器内部——这是"Ctrl+A 会不会选到页面"的唯一判据。
 *
 * 三层比较，任何一层成立就算在编辑器里：
 *  1) activeElement 就是容器，或被容器包含（textarea / contenteditable 这类）；
 *  2) 容器所在的"编辑器根"（.monaco-editor / .CodeMirror / .cm-editor / .ace_editor）包含它
 *     —— Monaco 的 inputarea 是 .view-lines 的兄弟节点，只按容器包含判会漏；
 *  3) 焦点元素自己的编辑器根与容器的编辑器根是同一个。
 */
function hasEditorFocus(target: Candidate | null): boolean {
  if (!target) return false
  const active = target.host.ownerDocument.activeElement
  if (!active) return false
  if (active === target.host || target.host.contains(active)) return true

  const root = editorRootOf(target.host)
  if (root && root.contains(active)) return true

  const activeRoot = editorRootOf(active)
  if (activeRoot && root && activeRoot === root) return true
  if (activeRoot && target.host.contains(activeRoot)) return true
  return false
}

function describeActive(target: Candidate | null): string {
  const doc = target?.host.ownerDocument ?? document
  const active = doc.activeElement
  if (!active || active === doc.body || active === doc.documentElement) return '页面主体（body）'
  return describeElement(active)
}

/** 编辑器正文的点击坐标：CDP 用它做一次真实点击，把焦点真正放进编辑器。 */
function clickPointOf(target: Candidate): { x: number; y: number } {
  const inner = target.host.querySelector(
    '.view-lines, .CodeMirror-code, .cm-content, .ace_content, textarea',
  ) as HTMLElement | null
  const element = inner ?? (target.host as HTMLElement)
  const rect = element.getBoundingClientRect()
  const x = rect.left + Math.min(Math.max(rect.width / 2, 12), Math.max(rect.width - 12, 12))
  const y = rect.top + Math.min(Math.max(rect.height / 2, 12), Math.max(rect.height - 12, 12))
  return { x: Math.round(x), y: Math.round(y) }
}

/** 合成点击（不可信事件）：Monaco / CM 的鼠标处理器不校验 isTrusted，能设光标。 */
function clickInside(target: Candidate, point: { x: number; y: number }): void {
  const element = target.host as HTMLElement
  const view = element.ownerDocument.defaultView ?? window
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view,
    button: 0,
    clientX: point.x,
    clientY: point.y,
  }
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    try {
      element.dispatchEvent(new MouseEvent(type, init))
    } catch {
      // 极老的浏览器不认合成事件，忽略这一发。
    }
  }
}

interface FocusOutcome {
  focused: boolean
  kind: EditorKind
  detail: string
  x: number
  y: number
}

/**
 * 让编辑器获得焦点并全选，为"受信任输入"做准备。
 *
 * 关键修正：**焦点必须验证**。以前调完 `textarea.focus()` 就返回 focused=true，
 * 但 Monaco 的 1×1 输入框可能没接住焦点，CDP 的 Ctrl+A 就落到文档上，
 * 选中题面而不是编辑器——于是"全选"变成了"全选网页"。
 * 现在：实例/元素 focus → 检查 `document.activeElement` → 不在编辑器里就合成点击再查一次。
 */
function focusEditor(): FocusOutcome {
  const target = pickTarget()
  if (!target) return { focused: false, kind: 'none', detail: '没有可见编辑器', x: 0, y: 0 }

  const point = clickPointOf(target)

  const attempt = (): void => {
    try {
      switch (target.kind) {
        case 'codemirror5':
          target.instance.focus?.()
          target.instance.execCommand?.('selectAll')
          break
        case 'codemirror6': {
          const view = target.instance
          view.focus?.()
          view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } })
          break
        }
        case 'ace':
          target.instance.focus?.()
          target.instance.selectAll?.()
          break
        case 'monaco': {
          if (typeof target.instance?.focus === 'function') {
            target.instance.focus?.()
            target.instance.trigger?.('keyboard', 'editor.action.selectAll', null)
            break
          }
          // 没有实例：Monaco 的键盘输入入口是那个 1×1 的 inputarea textarea。
          // 它可能是容器的兄弟节点（不是子节点），所以先在编辑器根范围内找。
          const root = editorRootOf(target.host) ?? target.host
          const area = (root.querySelector('textarea.inputarea, textarea.monaco-mouse-cursor-text, textarea') ??
            target.host.querySelector('textarea')) as HTMLElement | null
          if (area) {
            area.focus()
            break
          }
          const viewLine = target.host.querySelector('.view-lines') as HTMLElement | null
          if (viewLine) viewLine.click()
          break
        }
        case 'terminal': {
          const helper = (target.host.querySelector('textarea') as HTMLTextAreaElement | null) ?? null
          ;(helper ?? (target.host as HTMLElement)).focus()
          break
        }
        case 'textarea': {
          const textarea = target.instance as HTMLTextAreaElement
          textarea.focus()
          textarea.select()
          break
        }
        case 'contenteditable': {
          const editable = target.host as HTMLElement
          editable.focus()
          selectAllIn(editable)
          break
        }
      }
    } catch {
      // 单条路径失败不影响后面的合成点击与复查。
    }
  }

  attempt()
  if (!hasEditorFocus(target)) {
    clickInside(target, point)
    attempt()
  }

  return {
    focused: hasEditorFocus(target),
    kind: target.kind,
    detail: describeActive(target),
    x: point.x,
    y: point.y,
  }
}

async function handle(request: FrameRequest): Promise<FrameReply> {
  switch (request.op) {
    case 'editor': {
      const info = readEditor()
      return makeReply(request.id, 'editor', {
        ok: info.kind !== 'none',
        kind: info.kind,
        code: info.code,
        selector: info.selector,
        score: info.score,
        docKnown: info.docKnown,
        renderText: info.renderText,
      })
    }

    case 'write': {
      const target = pickTarget()
      if (!target) {
        return makeReply(request.id, 'write', {
          ok: false,
          wrote: false,
          kind: 'none',
          error: `没有可见的编辑器可写。候选：${candidateSummary() || '无'}`,
          candidates: candidateSummary(),
        })
      }

      // 采样前先滚到顶部：渲染视角的"变化"只应来自内容，不应来自滚动。
      scrollToTop(target)
      const before = { doc: target.doc, render: target.render }

      const outcome = writeInto(target, request.code)
      await sleep(160)

      const after = snapshotOf(target)
      const visible = after ? !after.hidden : false
      const decision = outcome.skipped
        ? { ok: false, reason: 'api-unavailable' as const, detail: outcome.error ?? '这条路径不写文档。' }
        : decideInject(request.code, {
            kind: target.kind,
            visible,
            docText: after?.doc ?? '',
            docKnown: target.docKnown,
            renderText: after?.render ?? '',
            beforeDoc: before.doc,
            beforeRender: before.render,
          })

      const error = decision.ok
        ? undefined
        : decision.reason === 'api-unavailable'
          ? decision.detail
          : [outcome.error, decision.detail].filter(Boolean).join('\n')

      return makeReply(request.id, 'write', {
        ok: decision.ok,
        wrote: decision.ok,
        kind: target.kind,
        code: (after?.doc ?? '').slice(0, 4000),
        selector: KIND_SELECTOR[target.kind],
        strategy: outcome.strategy,
        reason: decision.reason,
        detail: decision.detail,
        docText: (after?.doc ?? '').slice(0, 1200),
        renderText: (after?.render ?? '').slice(0, 800),
        docKnown: target.docKnown,
        visible,
        candidates: candidateSummary(target.host),
        score: Math.round(target.score),
        error,
      })
    }

    case 'submit': {
      const result = submitEditor()
      return makeReply(request.id, 'submit', {
        ok: result.clicked,
        clicked: result.clicked,
        buttonText: result.buttonText,
        kind: readEditor().kind,
        error: result.error,
      })
    }

    case 'diagnose': {
      // 只读自检：编辑器类型与可见性、评测按钮是否找得到、结果区是否有内容。不写入、不点击。
      const target = pickTarget()
      const button = scanSubmitButton(document)
      const text = scanResultText(document)
      return makeReply(request.id, 'diagnose', {
        ok: Boolean(target),
        kind: target?.kind ?? 'none',
        code: (target?.doc ?? '').slice(0, 2000),
        selector: target ? KIND_SELECTOR[target.kind] : '',
        hasSubmit: Boolean(button),
        buttonText: button?.label ?? '',
        resultLength: text.length,
        candidates: candidateSummary(target?.host ?? null),
        visible: Boolean(target),
        docKnown: target?.docKnown ?? false,
        docText: (target?.doc ?? '').slice(0, 600),
        renderText: (target?.render ?? '').slice(0, 600),
        error: target
          ? button
            ? undefined
            : '本帧内没有找到"评测/提交"按钮。'
          : `本帧没有可见的编辑器（隐藏实例不算）。候选：${candidateSummary() || '无'}`,
      })
    }

    case 'focus': {
      const result = focusEditor()
      return makeReply(request.id, 'focus', {
        ok: result.focused,
        focused: result.focused,
        kind: result.kind,
        insideEditor: result.focused,
        focusDetail: result.detail,
        clickX: result.x,
        clickY: result.y,
        isTop: window === window.top,
      })
    }

    case 'active': {
      // 只回答"现在焦点在哪、在不在编辑器里"，不改任何状态。
      const target = pickTarget()
      const inside = hasEditorFocus(target)
      return makeReply(request.id, 'active', {
        ok: Boolean(target),
        kind: target?.kind ?? 'none',
        insideEditor: inside,
        focusDetail: describeActive(target),
        isTop: window === window.top,
        selector: target ? KIND_SELECTOR[target.kind] : '',
      })
    }

    case 'result': {
      const result = readResult()
      return makeReply(request.id, 'result', {
        ok: true,
        resultText: result.text,
        running: result.running,
        kind: readEditor().kind,
      })
    }
  }
}

async function onMessage(event: MessageEvent): Promise<void> {
  // 只接受祖先窗口的请求：直接父帧、顶帧，或顶层帧自己（顶层 frame window.parent === window）。
  if (event.source !== window.parent && event.source !== window.top) return
  if (!isFrameRequest(event.data)) return

  const source = event.source as Window | null
  if (!source) return

  const request = event.data
  try {
    source.postMessage(await handle(request), '*')
  } catch (error) {
    source.postMessage(
      makeReply(request.id, request.op, {
        ok: false,
        kind: 'none',
        error: error instanceof Error ? error.message : String(error),
      }),
      '*',
    )
  }
}

// 每一帧都监听：编辑器可能内嵌在顶层文档，也可能在 iframe 里。
window.addEventListener('message', (event) => {
  void onMessage(event)
})
