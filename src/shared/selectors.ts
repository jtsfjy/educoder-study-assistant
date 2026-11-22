import type { SectionKey } from './types.ts'

/**
 * 选择器集中维护处。
 *
 * 平台改版时只改这个文件：候选组按"命中可能性"排序，任何一组命中即可，
 * 全部落空时抽取层会退回语义锚点（见 parseAnchor）继续工作。
 * 每次调整选择器都把 SELECTOR_VERSION 往上加，面板会显示当前版本，
 * 命中率下降时方便判断是不是平台改版。
 */
export const SELECTOR_VERSION = '2026-11-22.2'

export const PROBLEM_CANDIDATES = {
  title: [
    '[class*="question-title"]',
    '[class*="problem-title"]',
    '[class*="title"] h1',
    '[class*="title"]',
    'h1',
    'h2',
  ],
  body: [
    '.question-desc',
    '[class*="question-desc"]',
    '[class*="problem-detail"]',
    '[class*="problem"]',
    '[class*="task"]',
    '[class*="shixun"]',
    '[data-testid*="task"]',
    'main',
    'article',
    '#app',
    'body',
  ],
  /** 顶层页面里的编辑器容器；实训区在 iframe 里时这里通常为空，由 frame 探针补齐。 */
  editorContainer: ['.CodeMirror', '.cm-editor', '.ace_editor', '.monaco-editor', 'textarea'],
} as const

/** 评测结果容器候选；扫到多个时按"类名像结果区 + 正文含结论"打分，取最高分。 */
export const RESULT_CANDIDATES = [
  '[class*="result"]',
  '[class*="Result"]',
  '[class*="judge"]',
  '[class*="output"]',
  '[class*="Output"]',
  '[class*="console"]',
  '[class*="terminal"]',
  '[class*="compile"]',
  '[class*="answer"]',
  '[class*="score"]',
  '[id*="result"]',
  '[id*="output"]',
  'pre',
  'code',
  '.markdown-body',
] as const

/**
 * "评测/提交"按钮的文本打分。精确命中优先，包含命中减 15 分。
 * 平台文案会变（评测 / 提交 / 运行 / 自测），分值决定点哪个。
 */
export const SUBMIT_TEXTS = [
  { label: '保存并评测', score: 105 },
  { label: '评测', score: 100 },
  { label: '提交', score: 90 },
  { label: '运行', score: 80 },
  { label: '自测', score: 70 },
  { label: '执行', score: 60 },
  { label: '测试', score: 55 },
] as const

export const SKIPPED_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'SVG',
  'IFRAME',
  'CANVAS',
  'NAV',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'TEMPLATE',
])

/** 标题锚点与结构化字段的对应关系；顺序无所谓，长标签优先匹配。 */
export const ANCHOR_LABELS: Record<string, SectionKey> = {
  输入格式: 'inputSpec',
  输入说明: 'inputSpec',
  输入描述: 'inputSpec',
  输出格式: 'outputSpec',
  输出说明: 'outputSpec',
  输出描述: 'outputSpec',
  样例输入: 'sampleInput',
  输入样例: 'sampleInput',
  数据输入: 'sampleInput',
  样例输出: 'sampleOutput',
  输出样例: 'sampleOutput',
  数据输出: 'sampleOutput',
  输入输出样例: 'sample',
  样例: 'sample',
  示例: 'sample',
  要求: 'constraints',
  说明: 'constraints',
  提示: 'constraints',
  约束: 'constraints',
  数据范围: 'constraints',
  注意事项: 'constraints',
}

const LONG_LABELS = Object.keys(ANCHOR_LABELS)
  .filter((label) => label.length > 1)
  .sort((a, b) => b.length - a.length)

const SHORT_LABELS: Record<string, SectionKey> = {
  输入: 'sampleInput',
  输出: 'sampleOutput',
}

export interface ParsedAnchor {
  key: SectionKey
  rest: string
}

/**
 * 判断一个文本块是不是"输入格式 / 样例输出 / 要求："这类小节标题。
 * 长标签直接前缀匹配；"输入""输出"这类短标签必须带冒号，避免把正文首行误判成标题。
 */
export function parseAnchor(input: string): ParsedAnchor | null {
  const text = input.trimStart()
  for (const label of LONG_LABELS) {
    if (!text.startsWith(label)) continue
    const rest = text.slice(label.length).replace(/^\s*[:：]?\s*/, '')
    return { key: ANCHOR_LABELS[label]!, rest }
  }
  const short = /^(输入|输出)\s*[:：]\s*/.exec(text)
  if (short) {
    return { key: SHORT_LABELS[short[1]!]!, rest: text.slice(short[0].length) }
  }
  return null
}
