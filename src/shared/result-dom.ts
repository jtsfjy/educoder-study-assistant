import { RESULT_CANDIDATES, SUBMIT_TEXTS } from './selectors.ts'
import { classifyVerdict } from './verdict.ts'

/**
 * 评测结果与"评测/提交"按钮的通用扫描器。
 * top（隔离世界）与实训 iframe（MAIN world）共用同一份逻辑，避免两边判据漂移。
 */

const MAX_RESULT_CHARS = 6000
const MAX_NODES = 400

export interface SubmitTarget {
  element: HTMLElement
  label: string
}

function isVisible(element: Element): boolean {
  const view = element.ownerDocument.defaultView
  if (!view) return false
  const rect = element.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return false
  const style = view.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  return Number.parseFloat(style.opacity || '1') > 0.05
}

function isDisabled(element: Element): boolean {
  if (element.matches(':disabled')) return true
  return element.getAttribute('aria-disabled') === 'true'
}

function labelOf(element: Element): string {
  if (element.tagName === 'INPUT') {
    const input = element as HTMLInputElement
    return (input.value ?? '').trim()
  }
  return (element.textContent ?? '').replace(/\s+/g, '')
}

function insideOwnPanel(element: Element): boolean {
  return Boolean(element.closest('#educoder-study-assistant-host'))
}

function markerOf(element: Element): string {
  const className = typeof element.className === 'string' ? element.className : ''
  return `${className} ${element.id}`.toLowerCase()
}

/** 结果容器打分：类名/id 像结果区，或正文已经带评测结论的，才有资格入选。 */
function scoreResult(element: Element, text: string): number {
  const marker = markerOf(element)
  const containerHit = /result|judge|output|console|terminal|answer|score|message|结果/.test(marker)
  const verdict = classifyVerdict(text)
  if (!containerHit && verdict === 'unknown') return 0
  const base = (containerHit ? 10 : 0) + (verdict === 'unknown' ? 0 : 20)
  return base + Math.min(text.length, 2000) / 1000
}

export function scanResultText(root: ParentNode): string {
  const seen = new Set<Element>()
  let best = ''
  let bestScore = 0

  for (const selector of RESULT_CANDIDATES) {
    let nodes: Element[]
    try {
      nodes = Array.from(root.querySelectorAll(selector))
    } catch {
      continue
    }
    for (const element of nodes) {
      if (seen.has(element) || seen.size >= MAX_NODES) continue
      seen.add(element)
      if (insideOwnPanel(element) || !isVisible(element)) continue
      const text = (element.textContent ?? '').replace(/\r\n/g, '\n').trim()
      if (text.length < 4 || text.length > MAX_RESULT_CHARS) continue
      const score = scoreResult(element, text)
      if (score > bestScore) {
        bestScore = score
        best = text
      }
    }
  }

  return best
}

function scoreSubmitLabel(label: string): number {
  for (const item of SUBMIT_TEXTS) {
    if (label === item.label) return item.score
    if (label.includes(item.label)) return item.score - 15
  }
  return 0
}

export function scanSubmitButton(root: ParentNode): SubmitTarget | null {
  let nodes: Element[]
  try {
    nodes = Array.from(root.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"], [class*="btn"]'))
  } catch {
    return null
  }

  let best: SubmitTarget | null = null
  let bestScore = 0

  for (const element of nodes.slice(0, MAX_NODES)) {
    if (!isVisible(element) || isDisabled(element) || insideOwnPanel(element)) continue
    const label = labelOf(element)
    if (!label || label.length > 12) continue
    const score = scoreSubmitLabel(label)
    if (score > bestScore) {
      bestScore = score
      best = { element: element as HTMLElement, label }
    }
  }

  return bestScore >= 50 ? best : null
}

/**
 * 点击按钮。平台的按钮常常绑在 mousedown / pointerdown 上，
 * 只发 click 会漏；按真实指针序列补全，最后补 click 给 React 的 onClick。
 */
export function clickElement(element: HTMLElement): void {
  const view = element.ownerDocument.defaultView ?? window
  const rect = element.getBoundingClientRect()
  const init: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    view,
    button: 0,
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2,
  }
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    try {
      element.dispatchEvent(new MouseEvent(type, init))
    } catch {
      // 极老的浏览器不认合成事件，忽略这一发即可。
    }
  }
}
