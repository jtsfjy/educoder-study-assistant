import { isFrameRequest, makeReply, type FrameReply, type FrameRequest } from '../../shared/frame.ts'
import { clickElement, scanResultText, scanSubmitButton } from '../../shared/result-dom.ts'
import { normalizeForCompare } from '../../shared/verdict.ts'
import type { EditorInfo, EditorKind } from '../../shared/types.ts'

/**
 * 实训区探针（MAIN world，所有帧都跑）。
 *
 * 能力：读编辑器、写入并回读校验、点评测、读结果、只读自检。
 * 写入不只依赖实例 API——平台可能给编辑器套 contenteditable 或拦截 paste，
 * 所以这里按"实例 API → execCommand 输入管线 → 原生 setter"三级降级，每级都回读校验。
 */
type DomNode = Element & Record<string, any>

const CM5_SELECTOR = '.CodeMirror'
const CM6_SELECTORS = ['.cm-editor', '.cm-content'] as const
const ACE_SELECTOR = '.ace_editor'
const MONACO_SELECTOR = '.monaco-editor'
const EDITABLE_SELECTOR = '[contenteditable="true"], [contenteditable=""]'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 深度查询：穿透 open shadow root。
 * 平台把编辑器塞进 Web Component 时，document.querySelector 看不到，只能往下钻。
 */
function deepQuery(selector: string, root: ParentNode = document, depth = 0): Element | null {
  const direct = root.querySelector(selector)
  if (direct) return direct
  if (depth >= 3) return null

  const all = root.querySelectorAll('*')
  const limit = Math.min(all.length, 1500)
  for (let index = 0; index < limit; index += 1) {
    const element = all[index]
    if (!element) continue
    const shadow = (element as DomNode).shadowRoot as ShadowRoot | null
    if (!shadow) continue
    const hit = deepQuery(selector, shadow, depth + 1)
    if (hit) return hit
  }
  return null
}

function cm5(): any {
  const element = deepQuery(CM5_SELECTOR) as DomNode | null
  return element?.CodeMirror ?? null
}

function cm6View(): any {
  for (const selector of CM6_SELECTORS) {
    const holder = (deepQuery(selector) as DomNode | null)?.cmView
    if (!holder) continue
    const view = holder.view ?? holder.rootView?.view ?? (holder.state ? holder : null)
    if (view?.state?.doc) return view
  }
  return null
}

function aceEditor(): any {
  const element = deepQuery(ACE_SELECTOR) as DomNode | null
  return element?.env?.editor ?? null
}

function monacoApi(): any {
  return (window as unknown as Record<string, any>).monaco ?? null
}

function textareaElement(): HTMLTextAreaElement | null {
  return deepQuery('textarea') as HTMLTextAreaElement | null
}

function editableElement(): HTMLElement | null {
  const element = deepQuery(EDITABLE_SELECTOR) as HTMLElement | null
  return element && element.isContentEditable ? element : null
}

/** xterm 之类的终端：可见文本在 .xterm-rows 里，键盘输入走一个隐藏的 helper textarea。 */
function terminalRoot(): Element | null {
  return deepQuery('.xterm, .xterm-screen, [class*="terminal"], [class*="console"]')
}

function terminalText(root: Element): string {
  const rows = root.querySelector('.xterm-rows') ?? root.querySelector('.xterm-screen') ?? root
  const text = (rows as HTMLElement).innerText ?? rows.textContent ?? ''
  return text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000)
}

function rectOf(element: Element): { width: number; height: number; bottom: number; right: number } {
  const rect = element.getBoundingClientRect()
  return { width: rect.width, height: rect.height, bottom: rect.bottom, right: rect.right }
}

function describeElement(element: Element): string {
  const className =
    typeof element.className === 'string' ? element.className.trim().split(/\s+/).slice(0, 2).join('.') : ''
  const rect = rectOf(element)
  return `${element.tagName.toLowerCase()}${className ? `.${className}` : ''} ${Math.round(rect.width)}×${Math.round(rect.height)}`
}

/**
 * 真编辑器必须是有面积、可见、在视口坐标系里占位的控件。
 * 隐藏 textarea（xterm 之类的辅助输入框常是 1×1 或 0×0）如果被当成编辑器，
 * 写入会"成功"但页面毫无反应——这正是"已连接但注入无反应"最像的一种。
 */
function isPlausibleControl(element: Element): boolean {
  const rect = rectOf(element)
  if (rect.width < 80 || rect.height < 18) return false
  if (rect.bottom <= 0 || rect.right <= 0) return false
  const view = element.ownerDocument.defaultView
  if (!view) return false
  const style = view.getComputedStyle(element)
  return style.display !== 'none' && style.visibility !== 'hidden'
}

/** 候选摘要：面板直接显示，一眼看出选中的是不是"隐藏输入框"。 */
function candidateSummary(): string {
  const parts: string[] = []
  const textarea = textareaElement()
  if (textarea) parts.push(`textarea:${describeElement(textarea)}`)
  const editable = editableElement()
  if (editable) parts.push(`editable:${describeElement(editable)}`)
  const cm5Element = deepQuery(CM5_SELECTOR)
  if (cm5Element) parts.push(`cm5:${describeElement(cm5Element)}`)
  const cm6Element = deepQuery(CM6_SELECTORS[0])
  if (cm6Element) parts.push(`cm6:${describeElement(cm6Element)}`)
  const aceElement = deepQuery(ACE_SELECTOR)
  if (aceElement) parts.push(`ace:${describeElement(aceElement)}`)
  const monacoElement = deepQuery(MONACO_SELECTOR)
  if (monacoElement) parts.push(`monaco:${describeElement(monacoElement)}`)
  const terminal = deepQuery('.xterm, .xterm-screen, [class*="terminal"], [class*="console"]')
  if (terminal) parts.push(`term:${describeElement(terminal)}`)
  return parts.join(' | ')
}

function readEditor(): EditorInfo {
  const v5 = cm5()?.getValue?.()
  if (typeof v5 === 'string') return { kind: 'codemirror5', code: v5, selector: CM5_SELECTOR }

  const v6 = cm6View()?.state?.doc?.toString?.()
  if (typeof v6 === 'string') return { kind: 'codemirror6', code: v6, selector: CM6_SELECTORS[0] }

  const va = aceEditor()?.getValue?.()
  if (typeof va === 'string') return { kind: 'ace', code: va, selector: ACE_SELECTOR }

  const monaco = monacoApi()
  const editors = monaco?.editor?.getEditors?.() ?? []
  const vm = editors[0]?.getValue?.() ?? monaco?.editor?.getModels?.()?.[0]?.getValue?.()
  if (typeof vm === 'string') return { kind: 'monaco', code: vm, selector: MONACO_SELECTOR }

  const textarea = textareaElement()
  if (textarea && isPlausibleControl(textarea)) {
    return { kind: 'textarea', code: textarea.value, selector: 'textarea' }
  }

  const editable = editableElement()
  if (editable && isPlausibleControl(editable)) {
    return { kind: 'contenteditable', code: editable.innerText ?? '', selector: EDITABLE_SELECTOR }
  }

  const terminal = terminalRoot()
  if (terminal) return { kind: 'terminal', code: terminalText(terminal), selector: '.xterm' }

  return { kind: 'none', code: '', selector: '' }
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
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

function setEditableValue(element: HTMLElement, code: string): void {
  element.innerText = code
  try {
    element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: code }))
  } catch {
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

interface WriteResult {
  ok: boolean
  kind: EditorKind
  wrote: boolean
  code: string
  selector: string
  strategy: string
  error?: string
}

function writeEditor(rawCode: string): WriteResult {
  const code = rawCode.replace(/\r\n/g, '\n')
  let kind: EditorKind = 'none'
  let strategy = ''
  let error: string | undefined

  const instance5 = cm5()
  const view6 = cm6View()
  const instanceAce = aceEditor()
  const monaco = monacoApi()
  const textarea = textareaElement()
  const editable = editableElement()
  const terminal = terminalRoot()

  if (typeof instance5?.setValue === 'function') {
    instance5.setValue(code)
    instance5.focus?.()
    instance5.refresh?.()
    pulse(deepQuery(CM5_SELECTOR))
    kind = 'codemirror5'
    strategy = 'codemirror5.setValue'
  } else if (view6?.dispatch && view6.state?.doc) {
    view6.dispatch({
      changes: { from: 0, to: view6.state.doc.length, insert: code },
      selection: { anchor: code.length },
      scrollIntoView: true,
    })
    pulse(deepQuery(CM6_SELECTORS[0]))
    kind = 'codemirror6'
    strategy = 'codemirror6.dispatch'
  } else if (typeof instanceAce?.setValue === 'function') {
    instanceAce.setValue(code, -1)
    instanceAce.clearSelection?.()
    instanceAce.navigateFileStart?.()
    pulse(deepQuery(ACE_SELECTOR))
    kind = 'ace'
    strategy = 'ace.setValue'
  } else if (monaco?.editor) {
    const editors = monaco.editor.getEditors?.() ?? []
    const target = editors[0] ?? monaco.editor.getModels?.()?.[0]
    if (typeof target?.setValue === 'function') {
      target.setValue(code)
      pulse(deepQuery(MONACO_SELECTOR))
      kind = 'monaco'
      strategy = 'monaco.setValue'
    } else {
      error = '检测到 Monaco 全局对象，但拿不到可写入的 editor/model。'
    }
  } else if (terminal) {
    // 终端没有"文档"可写：必须走真实键入（受信任输入），这里只标记类型让上层降级。
    kind = 'terminal'
    strategy = 'terminal.trusted'
    error = '终端编辑器（xterm）：常规写入跳过，改用受信任键入 + 回车执行。'
  } else if (textarea && isPlausibleControl(textarea)) {
    textarea.focus()
    textarea.select()
    const inserted = insertViaExecCommand(textarea, code)
    if (!inserted) setTextareaValue(textarea, code)
    kind = 'textarea'
    strategy = inserted ? 'textarea.execCommand' : 'textarea.setter'
  } else if (editable && isPlausibleControl(editable)) {
    editable.focus()
    selectAllIn(editable)
    const inserted = insertViaExecCommand(editable, code)
    if (!inserted) setEditableValue(editable, code)
    kind = 'contenteditable'
    strategy = inserted ? 'contenteditable.execCommand' : 'contenteditable.innerText'
  } else {
    error =
      `未找到可写入的编辑器（CM5=${Boolean(instance5)} CM6=${Boolean(view6)} ACE=${Boolean(instanceAce)} ` +
      `Monaco=${Boolean(monaco)} textarea=${Boolean(textarea)} contenteditable=${Boolean(editable)}）` +
      `\n候选：${candidateSummary() || '无'}`
  }

  if (kind === 'none') {
    return { ok: false, kind, wrote: false, code: '', selector: '', strategy: 'none', error }
  }

  const after = readEditor()
  const wrote = normalizeForCompare(after.code) === normalizeForCompare(code)
  return {
    ok: wrote,
    kind,
    wrote,
    code: after.code.slice(0, 4000),
    selector: after.selector,
    strategy,
    error: wrote ? undefined : (error ?? '回读内容与写入内容不一致（编辑器可能拦截了写入或随后被页面回滚）。'),
  }
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
 * 让编辑器获得焦点并全选，为"受信任输入"做准备。
 * CDP 的 Input.insertText 走浏览器输入管线，产生的 input 事件 isTrusted=true，
 * 页面就算校验 isTrusted 也拦不住——这是绕过"只认真实键入"的最后一道。
 */
function focusEditor(): { focused: boolean; kind: EditorKind } {
  const terminal = terminalRoot()
  if (terminal) {
    const helper = (terminal.querySelector('textarea') ?? textareaElement()) as HTMLTextAreaElement | null
    const target = helper ?? (terminal as HTMLElement)
    target.focus()
    return { focused: true, kind: 'terminal' }
  }

  const instance5 = cm5()
  if (typeof instance5?.focus === 'function') {
    instance5.focus()
    instance5.execCommand?.('selectAll')
    return { focused: true, kind: 'codemirror5' }
  }

  const view6 = cm6View()
  if (view6?.focus && view6.state?.doc) {
    view6.focus()
    view6.dispatch({ selection: { anchor: 0, head: view6.state.doc.length } })
    return { focused: true, kind: 'codemirror6' }
  }

  const instanceAce = aceEditor()
  if (typeof instanceAce?.focus === 'function') {
    instanceAce.focus()
    instanceAce.selectAll?.()
    return { focused: true, kind: 'ace' }
  }

  const monaco = monacoApi()
  const editors = monaco?.editor?.getEditors?.() ?? []
  const monacoEditor = editors[0]
  if (typeof monacoEditor?.focus === 'function') {
    monacoEditor.focus()
    monacoEditor.trigger?.('keyboard', 'editor.action.selectAll', null)
    return { focused: true, kind: 'monaco' }
  }

  const textarea = textareaElement()
  if (textarea) {
    textarea.focus()
    textarea.select()
    return { focused: true, kind: 'textarea' }
  }

  const editable = editableElement()
  if (editable) {
    editable.focus()
    selectAllIn(editable)
    return { focused: true, kind: 'contenteditable' }
  }

  return { focused: false, kind: 'none' }
}

async function handle(request: FrameRequest): Promise<FrameReply> {
  switch (request.op) {
    case 'editor':
      return makeReply(request.id, 'editor', readEditor())
    case 'write': {
      const result = writeEditor(request.code)
      // 等一会儿再回读一次：有的页面会先接受写入、随后被受控状态回滚。
      await sleep(120)
      const stable = readEditor()
      const wrote = result.wrote && normalizeForCompare(stable.code) === normalizeForCompare(request.code)
      return makeReply(request.id, 'write', {
        ok: wrote,
        kind: result.kind,
        wrote,
        code: stable.code.slice(0, 4000),
        selector: result.selector || stable.selector,
        strategy: result.strategy,
        error: wrote
          ? undefined
          : (result.error ?? '写入 120ms 后回读不一致：内容被页面回滚了。'),
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
      // 只读自检：编辑器类型、评测按钮是否找得到、结果区是否有内容。不写入、不点击。
      const info = readEditor()
      const button = scanSubmitButton(document)
      const text = scanResultText(document)
      return makeReply(request.id, 'diagnose', {
        ok: info.kind !== 'none',
        kind: info.kind,
        code: info.code.slice(0, 2000),
        selector: info.selector,
        hasSubmit: Boolean(button),
        buttonText: button?.label ?? '',
        resultLength: text.length,
        candidates: candidateSummary(),
        error: button ? undefined : '本帧内没有找到"评测/提交"按钮。',
      })
    }
    case 'focus': {
      const result = focusEditor()
      return makeReply(request.id, 'focus', { ok: result.focused, focused: result.focused, kind: result.kind })
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
  // 只接受祖先窗口的请求：直接父帧、顶帧，或顶层帧自己（顶层帧 window.parent === window）。
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
