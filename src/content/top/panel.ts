import { LANGUAGE_LABELS } from '../../shared/problem.ts'
import type { EditorInfo, Problem } from '../../shared/types.ts'

export type StatusTone = 'idle' | 'busy' | 'ok' | 'warn' | 'error'

export interface PanelCallbacks {
  onSolve: () => void
  onExplain: () => void
  onReview: () => void
  onRefresh: () => void
  onSelfCheck: () => void
  onSettings: () => void
}

const HOST_ID = 'educoder-study-assistant-host'

const EDITOR_LABELS: Record<string, string> = {
  codemirror5: 'CodeMirror 5',
  codemirror6: 'CodeMirror 6',
  ace: 'ACE',
  monaco: 'Monaco',
  textarea: '文本框',
  contenteditable: '可编辑区',
  terminal: '终端（xterm）',
  none: '未识别',
}

const STYLE = `
  :host {
    --es-bg: #0f172a;
    --es-bg-soft: #0b1324;
    --es-border: #22304a;
    --es-text: #e2e8f0;
    --es-muted: #94a3b8;
    --es-accent: #6366f1;
    all: initial;
  }
  * { box-sizing: border-box; }
  .panel {
    background: var(--es-bg);
    border: 1px solid var(--es-border);
    border-radius: 14px;
    box-shadow: 0 18px 44px rgba(2, 6, 23, 0.5);
    color: var(--es-text);
    font: 13px/1.55 "Segoe UI", "Microsoft YaHei", system-ui, sans-serif;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: linear-gradient(180deg, #17233a, #101a2e);
    border-bottom: 1px solid #1d2a42;
    cursor: move;
    user-select: none;
  }
  .brand { font-weight: 600; font-size: 13px; letter-spacing: 0.3px; }
  .spacer { flex: 1; }
  .icon-btn {
    background: transparent;
    border: 1px solid transparent;
    color: var(--es-muted);
    border-radius: 6px;
    width: 24px;
    height: 24px;
    line-height: 1;
    cursor: pointer;
    font-size: 14px;
  }
  .icon-btn:hover { background: #1b2740; color: #dbe6ff; border-color: #2b3a5c; }
  .body { max-height: 60vh; overflow-y: auto; padding: 10px 12px; }
  .status { display: flex; align-items: center; gap: 6px; color: var(--es-muted); font-size: 12px; margin-bottom: 8px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: #64748b; flex: none; }
  .dot[data-tone="busy"] { background: #f59e0b; animation: es-pulse 1.2s ease-in-out infinite; }
  .dot[data-tone="ok"] { background: #22c55e; }
  .dot[data-tone="warn"] { background: #f97316; }
  .dot[data-tone="error"] { background: #ef4444; }
  @keyframes es-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
  .chip {
    background: #16223a;
    border: 1px solid #24334f;
    border-radius: 999px;
    padding: 1px 8px;
    font-size: 11px;
    color: #b8c7e0;
  }
  .section { margin-bottom: 10px; }
  .label { font-size: 11px; color: #8ea3c5; letter-spacing: 0.4px; margin-bottom: 3px; }
  .text, .pre {
    background: var(--es-bg-soft);
    border: 1px solid #1f2b44;
    border-radius: 8px;
    padding: 7px 9px;
    color: #d5e0f2;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 150px;
    overflow: auto;
  }
  .pre {
    font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
    font-size: 12px;
    max-height: 180px;
  }
  .sample { display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px; }
  .diag-row {
    display: flex;
    gap: 8px;
    justify-content: space-between;
    font-size: 11.5px;
    line-height: 1.6;
    color: #b8c7e0;
    border-bottom: 1px dashed #1c2740;
    padding: 2px 0;
  }
  .diag-row:last-child { border-bottom: none; }
  .diag-key { color: #8ea3c5; flex: none; }
  .diag-val { text-align: right; word-break: break-all; }
  .sample-name { font-size: 11px; color: #8ea3c5; }
  .result { display: none; margin-top: 8px; border-top: 1px dashed #26334d; padding-top: 8px; }
  .result.visible { display: block; }
  .result-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  .result-title { font-weight: 600; font-size: 12px; color: #c7d6ef; flex: 1; }
  .result-title.error { color: #fca5a5; }
  .result-body {
    background: var(--es-bg-soft);
    border: 1px solid #1f2b44;
    border-radius: 8px;
    padding: 8px 10px;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 40vh;
    overflow: auto;
    font-size: 12.5px;
    color: #e2e8f0;
  }
  .result-body.error { border-color: #7f1d1d; color: #fecaca; }
  .footer {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px 12px;
    border-top: 1px solid #1d2a42;
    background: #0d1526;
  }
  .btn {
    flex: 1 1 calc(33.333% - 6px);
    min-width: 88px;
    background: #1b2740;
    color: #dbe6ff;
    border: 1px solid #2b3a5c;
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .btn:hover:not(:disabled) { background: #24345a; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn.primary { background: linear-gradient(135deg, #3b82f6, #6366f1); border-color: #4f6ef7; color: #fff; }
  .btn.primary:hover:not(:disabled) { filter: brightness(1.08); }
  :host(.collapsed) .body, :host(.collapsed) .footer { display: none; }
`

/** 面板标题带版本号：一眼确认当前跑的是不是刚构建的那一版。 */
function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version
  } catch {
    return 'dev'
  }
}

function h<K extends keyof HTMLElementTagNameMap>(  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

export class Panel {
  readonly host: HTMLDivElement
  private readonly shadow: ShadowRoot
  private readonly dot: HTMLSpanElement
  private readonly statusText: HTMLSpanElement
  private readonly meta: HTMLDivElement
  private readonly sections: HTMLDivElement
  private readonly result: HTMLDivElement
  private readonly resultTitle: HTMLDivElement
  private readonly resultBody: HTMLDivElement
  private readonly solveBtn: HTMLButtonElement
  private readonly explainBtn: HTMLButtonElement
  private readonly selfCheckBtn: HTMLButtonElement
  private readonly diagnostics: HTMLDivElement
  private readonly reviewBtn: HTMLButtonElement
  private readonly refreshBtn: HTMLButtonElement
  private readonly collapseBtn: HTMLButtonElement
  private collapsed = false
  private busy = false
  private drag: { pointerX: number; pointerY: number; left: number; top: number } | null = null

  constructor(private readonly callbacks: PanelCallbacks) {
    this.host = document.createElement('div')
    this.host.id = HOST_ID
    this.host.style.cssText =
      'all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483000; width: 384px;'

    this.shadow = this.host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = STYLE
    this.shadow.appendChild(style)

    const panel = h('div', 'panel')

    const header = h('div', 'header')
    header.appendChild(h('span', 'brand', `头歌学习助手 v${extensionVersion()}`))
    header.appendChild(h('span', 'spacer'))
    this.collapseBtn = h('button', 'icon-btn', '–')
    this.collapseBtn.type = 'button'
    this.collapseBtn.title = '收起 / 展开'
    this.collapseBtn.setAttribute('aria-label', '收起或展开面板')
    this.collapseBtn.addEventListener('click', () => this.toggleCollapsed())
    header.appendChild(this.collapseBtn)

    const settingsBtn = h('button', 'icon-btn', '⚙')
    settingsBtn.type = 'button'
    settingsBtn.title = '打开设置'
    settingsBtn.setAttribute('aria-label', '打开设置')
    settingsBtn.addEventListener('click', () => this.callbacks.onSettings())
    header.appendChild(settingsBtn)
    header.addEventListener('pointerdown', (event) => this.beginDrag(event))
    panel.appendChild(header)

    const body = h('div', 'body')
    const status = h('div', 'status')
    this.dot = h('span', 'dot')
    this.dot.dataset.tone = 'idle'
    this.statusText = h('span', '', '等待题面…')
    status.append(this.dot, this.statusText)
    body.appendChild(status)

    this.meta = h('div', 'meta')
    body.appendChild(this.meta)

    this.sections = h('div', 'sections')
    body.appendChild(this.sections)

    this.diagnostics = h('div', 'diagnostics')
    body.appendChild(this.diagnostics)

    this.result = h('div', 'result')
    const resultHead = h('div', 'result-head')
    this.resultTitle = h('div', 'result-title')
    const copyBtn = h('button', 'icon-btn', '复制')
    copyBtn.type = 'button'
    copyBtn.title = '复制结果'
    copyBtn.style.width = 'auto'
    copyBtn.style.padding = '0 6px'
    copyBtn.addEventListener('click', () => void this.copyResult())
    resultHead.append(this.resultTitle, copyBtn)
    this.resultBody = h('div', 'result-body')
    this.result.append(resultHead, this.resultBody)
    body.appendChild(this.result)
    panel.appendChild(body)

    const footer = h('div', 'footer')
    this.solveBtn = this.button('自动解题', 'primary', () => this.callbacks.onSolve())
    this.explainBtn = this.button('讲解思路', '', () => this.callbacks.onExplain())
    this.reviewBtn = this.button('复盘代码', '', () => this.callbacks.onReview())
    this.refreshBtn = this.button('重新抽取', '', () => this.callbacks.onRefresh())
    this.selfCheckBtn = this.button('自检', '', () => this.callbacks.onSelfCheck())
    footer.append(this.solveBtn, this.explainBtn, this.reviewBtn, this.refreshBtn, this.selfCheckBtn)
    panel.appendChild(footer)

    this.shadow.appendChild(panel)
  }

  private button(label: string, className: string, onClick: () => void): HTMLButtonElement {
    const button = h('button', className ? `btn ${className}` : 'btn', label)
    button.type = 'button'
    button.addEventListener('click', onClick)
    return button
  }

  mount(): void {
    if (!this.host.isConnected) document.documentElement.appendChild(this.host)
  }

  ensureMounted(): void {
    this.mount()
  }

  destroy(): void {
    this.host.remove()
  }

  setStatus(text: string, tone: StatusTone = 'idle'): void {
    this.statusText.textContent = text
    this.dot.dataset.tone = tone
  }

  setBusy(busy: boolean): void {
    this.busy = busy
    this.solveBtn.disabled = busy
    this.explainBtn.disabled = busy
    this.reviewBtn.disabled = busy
    this.refreshBtn.disabled = busy
    this.selfCheckBtn.disabled = busy
    this.solveBtn.textContent = busy ? '执行中…' : '自动解题'
    this.explainBtn.textContent = busy ? '请求中…' : '讲解思路'
  }

  renderProblem(problem: Problem, editor: EditorInfo | null): void {
    this.sections.replaceChildren()
    this.meta.replaceChildren()
    this.hideResult()

    const language = LANGUAGE_LABELS[problem.language] ?? '未识别'
    this.meta.append(
      h('span', 'chip', `语言 ${language}`),
      h('span', 'chip', problem.samples.length > 0 ? `样例 ${problem.samples.length} 组` : '无样例'),
      h('span', 'chip', editor ? this.editorLabel(editor) : '未连接实训区'),
      h('span', 'chip', `题目 #${problem.fingerprint.slice(0, 8)}`),
    )

    this.addSection('题面', problem.description || '（未抽取到题面正文，平台可能改版）')
    if (problem.inputSpec) this.addSection('输入格式', problem.inputSpec)
    if (problem.outputSpec) this.addSection('输出格式', problem.outputSpec)

    if (problem.samples.length > 0) {
      const wrap = h('div', 'section')
      wrap.appendChild(h('div', 'label', '样例'))
      problem.samples.slice(0, 2).forEach((sample, index) => {
        const item = h('div', 'sample')
        item.appendChild(h('div', 'sample-name', `样例 ${index + 1}`))
        if (sample.input) item.appendChild(h('div', 'pre', `输入：\n${sample.input}`))
        if (sample.output) item.appendChild(h('div', 'pre', `输出：\n${sample.output}`))
        wrap.appendChild(item)
      })
      if (problem.samples.length > 2) {
        wrap.appendChild(h('div', 'sample-name', `其余 ${problem.samples.length - 2} 组未展示`))
      }
      this.sections.appendChild(wrap)
    }

    if (problem.constraints.length > 0) {
      this.addSection('约束与说明', problem.constraints.map((line) => `• ${line}`).join('\n'))
    }

    if (editor?.code) {
      const lines = editor.code.split('\n')
      const preview = lines.slice(0, 6).join('\n')
      this.addSection(
        `代码模板（${lines.length} 行${lines.length > 6 ? '，仅显示前 6 行' : ''}）`,
        preview,
      )
    }

    this.addSection(
      '调试信息',
      `选择器版本 ${problem.selectorVersion} · 帧编辑器 ${editor ? EDITOR_LABELS[editor.kind] ?? editor.kind : '未连接'}`,
    )
    this.diagnostics.replaceChildren()
    this.setStatus('题面已就绪：可自动解题、讲解或复盘', 'ok')
  }

  /** 自检结果：键值行平铺，一眼看出"到没到编辑器、找不找得到评测按钮"。 */
  renderDiagnostics(rows: { label: string; value: string }[]): void {
    this.diagnostics.replaceChildren()
    if (rows.length === 0) return

    const wrap = h('div', 'section')
    wrap.appendChild(h('div', 'label', '诊断'))
    for (const row of rows) {
      const line = h('div', 'diag-row')
      line.append(h('span', 'diag-key', row.label), h('span', 'diag-val', row.value))
      wrap.appendChild(line)
    }
    this.diagnostics.appendChild(wrap)
  }

  private editorLabel(editor: EditorInfo): string {
    const label = EDITOR_LABELS[editor.kind] ?? editor.kind
    const lines = editor.code ? editor.code.split('\n').length : 0
    return `${label} · ${lines} 行`
  }

  private addSection(label: string, text: string): void {
    const wrap = h('div', 'section')
    wrap.appendChild(h('div', 'label', label))
    wrap.appendChild(h('div', 'text', text))
    this.sections.appendChild(wrap)
  }

  showResult(title: string, text: string, tone: 'ok' | 'error' = 'ok'): void {
    this.result.classList.add('visible')
    this.resultTitle.textContent = title
    this.resultTitle.className = tone === 'error' ? 'result-title error' : 'result-title'
    this.resultBody.className = tone === 'error' ? 'result-body error' : 'result-body'
    this.resultBody.textContent = text
    this.resultBody.scrollTop = 0
  }

  showError(message: string): void {
    this.showResult('出错了', message, 'error')
    this.setStatus('请求失败', 'error')
  }

  private hideResult(): void {
    this.result.classList.remove('visible')
    this.resultBody.textContent = ''
  }

  private async copyResult(): Promise<void> {
    const text = this.resultBody.textContent ?? ''
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      this.setStatus('已复制到剪贴板', 'ok')
    } catch {
      this.setStatus('复制失败，请手动选择文本', 'warn')
    }
  }

  private toggleCollapsed(): void {
    this.collapsed = !this.collapsed
    this.host.classList.toggle('collapsed', this.collapsed)
    this.host.style.width = this.collapsed ? 'auto' : '384px'
    this.collapseBtn.textContent = this.collapsed ? '+' : '–'
  }

  private beginDrag(event: PointerEvent): void {
    if (event.button !== 0) return
    if ((event.target as Element | null)?.closest('button')) return

    const rect = this.host.getBoundingClientRect()
    this.host.style.right = 'auto'
    this.host.style.left = `${rect.left}px`
    this.host.style.top = `${rect.top}px`
    this.drag = { pointerX: event.clientX, pointerY: event.clientY, left: rect.left, top: rect.top }

    window.addEventListener('pointermove', this.onDragMove)
    window.addEventListener('pointerup', this.endDrag, { once: true })
  }

  private readonly onDragMove = (event: PointerEvent): void => {
    if (!this.drag) return
    const nextLeft = this.drag.left + (event.clientX - this.drag.pointerX)
    const nextTop = this.drag.top + (event.clientY - this.drag.pointerY)
    const maxLeft = Math.max(0, window.innerWidth - 140)
    const maxTop = Math.max(0, window.innerHeight - 60)
    this.host.style.left = `${Math.min(Math.max(0, nextLeft), maxLeft)}px`
    this.host.style.top = `${Math.min(Math.max(0, nextTop), maxTop)}px`
  }

  private readonly endDrag = (): void => {
    this.drag = null
    window.removeEventListener('pointermove', this.onDragMove)
  }

  get isBusy(): boolean {
    return this.busy
  }
}
