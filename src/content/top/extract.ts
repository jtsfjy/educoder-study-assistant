import { ANCHOR_LABELS, PROBLEM_CANDIDATES, SKIPPED_TAGS } from '../../shared/selectors.ts'
import { buildProblem, normalizeText } from '../../shared/problem.ts'
import type { Problem, TextBlock } from '../../shared/types.ts'

const BLOCK_TAGS = new Set([
  'DIV',
  'P',
  'LI',
  'PRE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'TD',
  'TH',
  'BLOCKQUOTE',
  'SECTION',
  'ARTICLE',
  'UL',
  'OL',
  'TABLE',
  'TR',
  'TBODY',
  'FORM',
  'FIELDSET',
  'DETAILS',
  'SUMMARY',
  'MAIN',
  'FIGURE',
  'FIGCAPTION',
  'DL',
  'DT',
  'DD',
  'CODE',
])

const MAX_BLOCKS = 800
const MAX_TITLE_LENGTH = 120
const SHELL_TITLE = '头歌实践教学平台'

function visibleText(element: Element): string {
  const text = (element as HTMLElement).innerText
  return typeof text === 'string' ? text : (element.textContent ?? '')
}

function isBlockElement(element: Element): boolean {
  return BLOCK_TAGS.has(element.tagName)
}

/**
 * 把一棵子树拆成按阅读顺序排列的文本块。
 * 只下钻到"块级 + 有文本"的子元素，行内元素（span/strong/a）自动合并进父块；
 * pre / code 保留原始换行与缩进。
 */
export function collectBlocks(root: Element): TextBlock[] {
  const blocks: TextBlock[] = []

  const visit = (element: Element): void => {
    if (blocks.length >= MAX_BLOCKS || SKIPPED_TAGS.has(element.tagName)) return

    const blockChildren = Array.from(element.children).filter(
      (child) =>
        !SKIPPED_TAGS.has(child.tagName) &&
        isBlockElement(child) &&
        visibleText(child).trim().length > 0,
    )

    if (blockChildren.length === 0) {
      const text =
        element.tagName === 'PRE' || element.tagName === 'CODE'
          ? normalizeText(element.textContent ?? '')
          : normalizeText(visibleText(element))
      if (text) blocks.push({ tag: element.tagName.toLowerCase(), text })
      return
    }

    for (const child of blockChildren) visit(child)
  }

  visit(root)
  return blocks
}

function scoreRoot(element: Element): number {
  const text = visibleText(element)
  if (text.length < 80) return Number.NEGATIVE_INFINITY
  let score = Math.min(text.length, 9000)
  for (const label of Object.keys(ANCHOR_LABELS)) {
    if (text.includes(label)) score += 150
  }
  if (element === document.body) score -= 2500
  return score
}

/** 候选组打分：文本量 + 语义锚点命中数；全部落空时退回 main / #app / body。 */
export function findProblemRoot(): Element | null {
  const candidates = new Set<Element>()
  for (const selector of PROBLEM_CANDIDATES.body) {
    for (const element of document.querySelectorAll(selector)) candidates.add(element)
  }

  let best: Element | null = null
  let bestScore = Number.NEGATIVE_INFINITY
  for (const element of candidates) {
    const score = scoreRoot(element)
    if (score > bestScore) {
      best = element
      bestScore = score
    }
  }

  return best ?? document.querySelector('main') ?? document.querySelector('#app') ?? document.body
}

export function extractTitle(root: Element): string {
  for (const selector of PROBLEM_CANDIDATES.title) {
    const element = root.querySelector(selector) ?? document.querySelector(selector)
    if (!element) continue
    const text = normalizeText(visibleText(element))
    if (text && text.length <= MAX_TITLE_LENGTH && !text.includes('\n') && text !== SHELL_TITLE) {
      return text
    }
  }

  const documentTitle = normalizeText(document.title)
  if (documentTitle && documentTitle !== SHELL_TITLE) return documentTitle.slice(0, MAX_TITLE_LENGTH)
  return ''
}

export interface ExtractOptions {
  template?: string
  now?: number
}

export interface ExtractOutput {
  problem: Problem | null
  blockCount: number
  rootTag: string
}

export async function extractProblem(options: ExtractOptions = {}): Promise<ExtractOutput> {
  const root = findProblemRoot()
  if (!root) return { problem: null, blockCount: 0, rootTag: '' }

  const blocks = collectBlocks(root)
  const rootTag = root.tagName.toLowerCase()
  if (blocks.length === 0) return { problem: null, blockCount: 0, rootTag }

  const problem = await buildProblem({
    title: extractTitle(root),
    url: location.href,
    blocks,
    template: options.template,
    now: options.now,
  })
  return { problem, blockCount: blocks.length, rootTag }
}
