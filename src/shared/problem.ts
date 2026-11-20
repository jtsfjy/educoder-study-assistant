import type { Language, Problem, ProblemSample, SectionKey, TextBlock } from './types.ts'
import { parseAnchor, SELECTOR_VERSION } from './selectors.ts'

const MAX_DESCRIPTION = 4000
const MAX_SPEC = 1200
const MAX_SAMPLES = 4
const MAX_CONSTRAINTS = 8

/** 归一化：统一换行、去零宽字符、压缩空行，避免同一道题每次抽取结果抖动。 */
export function normalizeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 语言识别：模板代码优先，没有模板时再用题面正文做启发式判断。 */
export function detectLanguage(template: string, hintText = ''): Language {
  const text = template.trim() || hintText
  if (!text.trim()) return 'unknown'
  const has = (re: RegExp) => re.test(text)

  if (has(/#include\s*</)) {
    return has(/\bstd::|\bcout\b|\bcin\b|#include\s*<(iostream|string|vector|map|algorithm|queue|stack)>/)
      ? 'cpp'
      : 'c'
  }
  if (
    has(/^\s*def\s+\w+\s*\([^)]*\)\s*(->\s*[^:]+)?:/m) ||
    has(/^\s*import\s+(sys|os|math|collections|itertools)\b/m) ||
    has(/^\s*from\s+\w+\s+import\s+/m)
  ) {
    return 'python'
  }
  if (has(/\bpublic\s+(static\s+)?(class|void|int|String)|System\.out\.print|\bclass\s+\w+\s*\{/)) {
    return 'java'
  }
  if (has(/\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,80}\b(FROM|INTO|SET|WHERE)\b/i)) {
    return 'sql'
  }
  if (has(/\b(function\s+\w+|const\s+\w+\s*=|let\s+\w+\s*=|=>|console\.log)\b/)) {
    return 'javascript'
  }
  return 'unknown'
}

export interface GroupedSections {
  intro: TextBlock[]
  sections: Partial<Record<SectionKey, TextBlock[]>>
}

/**
 * 按语义锚点把文本块切段。第一个锚点之前的内容视为题面正文；
 * 同一锚点重复出现时归入同一段，兼容"输入格式"分散在多处的情况。
 */
export function groupSections(blocks: TextBlock[]): GroupedSections {
  const intro: TextBlock[] = []
  const sections: Partial<Record<SectionKey, TextBlock[]>> = {}
  let current: SectionKey | null = null

  for (const block of blocks) {
    const anchor = parseAnchor(block.text)
    if (anchor) {
      current = anchor.key
      const list = (sections[current] ??= [])
      const rest = anchor.rest.trim()
      if (rest) list.push({ tag: block.tag, text: rest })
      continue
    }
    if (current) {
      (sections[current] ??= []).push(block)
    } else {
      intro.push(block)
    }
  }
  return { intro, sections }
}

function joinText(blocks: TextBlock[] | undefined): string {
  if (!blocks) return ''
  return normalizeText(blocks.map((block) => block.text.trim()).filter(Boolean).join('\n\n'))
}

function codeBlocks(blocks: TextBlock[] | undefined): string[] {
  if (!blocks) return []
  const code = blocks.filter((block) => block.tag === 'pre' || block.tag === 'code')
  const chosen = code.length > 0 ? code : blocks
  return chosen
    .map((block) => normalizeText(block.text))
    .filter(Boolean)
    .slice(0, MAX_SAMPLES)
}

/** 样例配对：按出现顺序把"样例输入"第 i 块与"样例输出"第 i 块配成一组。 */
export function extractSamples(sections: Partial<Record<SectionKey, TextBlock[]>>): ProblemSample[] {
  const inputs = codeBlocks(sections.sampleInput)
  const outputs = codeBlocks(sections.sampleOutput)
  const count = Math.min(MAX_SAMPLES, Math.max(inputs.length, outputs.length))
  const samples: ProblemSample[] = []
  for (let index = 0; index < count; index += 1) {
    samples.push({ input: inputs[index] ?? '', output: outputs[index] ?? '' })
  }
  return samples.filter((sample) => sample.input || sample.output)
}

export function extractConstraints(blocks: TextBlock[] | undefined): string[] {
  if (!blocks) return []
  const lines = blocks
    .flatMap((block) => block.text.split(/\n+/))
    .map((line) => line.replace(/^[\s•·\-*]+/, '').replace(/^\d+[.、)]\s*/, '').trim())
    .filter((line) => line.length > 0 && line.length <= 400)
  return [...new Set(lines)].slice(0, MAX_CONSTRAINTS)
}

function firstHeadingText(blocks: TextBlock[]): string {
  const heading = blocks.find((block) => /^h[1-3]$/.test(block.tag) && block.text.trim().length > 0)
  return heading ? normalizeText(heading.text) : ''
}

function plainTextFallback(blocks: TextBlock[]): string {
  return normalizeText(
    blocks
      .filter((block) => block.tag !== 'pre' && block.tag !== 'code')
      .map((block) => block.text)
      .join('\n'),
  )
}

/** 结构指纹：题目内容的稳定摘要，用于本地缓存和"同一道题"判断。 */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function normalizeFingerprint(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim()
}

export async function fingerprintProblem(
  problem: Pick<Problem, 'title' | 'description' | 'language' | 'template'>,
): Promise<string> {
  const raw = [problem.title, problem.description, problem.language, problem.template].join('\u0001')
  return sha256Hex(normalizeFingerprint(raw))
}

export interface BuildProblemInput {
  title?: string
  url: string
  blocks: TextBlock[]
  template?: string
  now?: number
}

export async function buildProblem(input: BuildProblemInput): Promise<Problem> {
  const template = input.template?.trim() ?? ''
  const { intro, sections } = groupSections(input.blocks)
  const title =
    (input.title ?? '').trim() || firstHeadingText(input.blocks) || '未命名题目'
  const hint = intro.map((block) => block.text).join('\n')
  const language = detectLanguage(template, hint)

  const description =
    joinText(intro).slice(0, MAX_DESCRIPTION) ||
    plainTextFallback(input.blocks).slice(0, MAX_DESCRIPTION)

  const inputSpec = joinText(sections.inputSpec).slice(0, MAX_SPEC)
  const outputSpec = joinText(sections.outputSpec).slice(0, MAX_SPEC)
  const samples = extractSamples(sections)
  const constraints = extractConstraints(sections.constraints)

  const problem: Problem = {
    title,
    description,
    inputSpec,
    outputSpec,
    samples,
    constraints,
    template,
    language,
    fingerprint: '',
    selectorVersion: SELECTOR_VERSION,
    sourceUrl: input.url,
    extractedAt: input.now ?? Date.now(),
  }
  problem.fingerprint = await fingerprintProblem(problem)
  return problem
}

export const LANGUAGE_LABELS: Record<Language, string> = {
  cpp: 'C++',
  c: 'C',
  python: 'Python',
  java: 'Java',
  javascript: 'JavaScript',
  sql: 'SQL',
  unknown: '未识别',
}
