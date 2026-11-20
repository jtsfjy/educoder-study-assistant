import { LANGUAGE_LABELS } from './problem.ts'
import type { Problem } from './types.ts'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const MAX_PROBLEM_IN_PROMPT = 7000
const MAX_CODE_IN_PROMPT = 8000

export const SYSTEM_EXPLAIN = `你是高校程序设计课程的教学助教，帮助学生在实训题上自己动手完成作业。

规则：
1. 只讲思路、算法选择、边界条件和常见错误，不要给出可以整段提交的完整答案。
2. 允许给出不超过 5 行的关键片段或伪代码来说明语法和接口，但它不能构成完整解法。
3. 学生明确索要完整代码时，说明你不代做，并把问题拆成更小的步骤继续引导。
4. 用中文回答：先用一句话概括思路，再列 2-4 个步骤，最后列易错点，总长度控制在 600 字以内。`

export const SYSTEM_REVIEW = `你是代码审查助教，负责根据题目和学生自己写的代码指出问题，帮助学生自己改对。

规则：
1. 先判断代码是否完成了题目要求的关键步骤，给出总体结论。
2. 按位置列出问题，每条写清：现象 → 原因 → 修改方向；不要重写整份代码，最多给出需要替换的那几行。
3. 代码方向正确时，指出可以优化的地方和时间/空间复杂度。
4. 用中文回答，总长度控制在 800 字以内。`

export const SYSTEM_SOLVE = `你是竞赛级程序设计解题器，任务是给出可以直接提交并判题的完整代码。

硬性规则：
1. 只输出代码本身。不要 markdown 围栏，不要解释，不要"以下是代码"这类开场白。
2. 平台模板里的函数签名、类名、main 入口、已包含的头文件/包名，一律原样保留，只填充需要你写的部分。
3. 语言以题目指定为准；题目没写清楚时按模板语言。
4. 输入输出严格按题面格式：注意空行、行尾空格、多组数据、读到 EOF 为止这些细节。
5. 不要打印交互提示语（如"请输入"），不要输出调试信息，不要用中文标点。
6. 代码必须能直接编译/运行，不要留 TODO、省略号或"此处补全"。`

export const SYSTEM_FIX = `你是竞赛级程序设计解题器，这次提交没有通过评测。

硬性规则：
1. 只输出修复后的完整代码，不要解释错误原因，不要 diff，不要 markdown 围栏。
2. 保留平台模板里的函数签名、类名和 main 入口。
3. 针对评测信息里给出的错误（编译错误 / 答案错误 / 运行错误 / 超时）做修改，不要改掉本来正确的部分。
4. 全部改完再输出，不要留 TODO 或省略号。`

export function problemToText(problem: Problem): string {
  const parts: string[] = []
  parts.push(`【标题】${problem.title}`)
  parts.push(`【语言】${LANGUAGE_LABELS[problem.language]}`)
  if (problem.description) parts.push(`【题面】\n${problem.description}`)
  if (problem.inputSpec) parts.push(`【输入格式】\n${problem.inputSpec}`)
  if (problem.outputSpec) parts.push(`【输出格式】\n${problem.outputSpec}`)

  problem.samples.slice(0, 4).forEach((sample, index) => {
    const lines = [`【样例 ${index + 1}】`]
    if (sample.input) lines.push(`输入：\n${sample.input}`)
    if (sample.output) lines.push(`输出：\n${sample.output}`)
    parts.push(lines.join('\n'))
  })

  if (problem.constraints.length > 0) {
    parts.push(`【约束与说明】\n${problem.constraints.map((line) => `- ${line}`).join('\n')}`)
  }
  if (problem.template) {
    parts.push(`【平台提供的代码模板】\n${problem.template}`)
  }

  const text = parts.join('\n\n')
  return text.length > MAX_PROBLEM_IN_PROMPT ? `${text.slice(0, MAX_PROBLEM_IN_PROMPT)}\n…（已截断）` : text
}

export function buildExplainPrompt(problem: Problem): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_EXPLAIN },
    {
      role: 'user',
      content: [
        '这是我正在做的实训题（平台已给出语言与代码模板）：',
        '',
        problemToText(problem),
        '',
        '请按规则给出分步思路和易错点。不要给完整代码。',
      ].join('\n'),
    },
  ]
}

export function buildSolvePrompt(problem: Problem): ChatMessage[] {
  return [
    { role: 'system', content: SYSTEM_SOLVE },
    {
      role: 'user',
      content: [
        '题目如下（含平台给定的语言与代码模板）：',
        '',
        problemToText(problem),
        '',
        '请输出完整可提交代码，只输出代码。',
      ].join('\n'),
    },
  ]
}

export function buildFixPrompt(problem: Problem, code: string, result: string): ChatMessage[] {
  const trimmedCode = code.length > MAX_CODE_IN_PROMPT ? `${code.slice(0, MAX_CODE_IN_PROMPT)}\n…（已截断）` : code
  const trimmedResult = result.length > 3000 ? `${result.slice(0, 3000)}\n…（已截断）` : result
  return [
    { role: 'system', content: SYSTEM_FIX },
    {
      role: 'user',
      content: [
        '题目：',
        '',
        problemToText(problem),
        '',
        '我上一次提交的代码：',
        trimmedCode,
        '',
        '平台返回的评测信息：',
        trimmedResult || '（没有读到具体错误信息，只有"未通过"）',
        '',
        '请只输出修复后的完整代码。',
      ].join('\n'),
    },
  ]
}

export function buildReviewPrompt(problem: Problem, code: string): ChatMessage[] {
  const trimmed = code.length > MAX_CODE_IN_PROMPT ? `${code.slice(0, MAX_CODE_IN_PROMPT)}\n…（已截断）` : code
  return [
    { role: 'system', content: SYSTEM_REVIEW },
    {
      role: 'user',
      content: [
        '题目：',
        '',
        problemToText(problem),
        '',
        '这是我目前写的代码：',
        '```',
        trimmed,
        '```',
        '',
        '请指出问题、原因和修改方向，不要整份重写。',
      ].join('\n'),
    },
  ]
}
