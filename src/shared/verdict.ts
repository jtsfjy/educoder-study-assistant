/** 评测结论分类与生成结果清洗：纯函数，可在 node --test 下直接跑。 */

export type Verdict =
  | 'passed'
  | 'wrong_answer'
  | 'compile_error'
  | 'runtime_error'
  | 'rate_limited'
  | 'running'
  | 'unknown'

interface Rule {
  verdict: Verdict
  pattern: RegExp
}

/**
 * 顺序即优先级：负面结论先于"通过"。
 * 平台结果文案里"未通过""部分通过"含"通过"二字，必须先被 wrong_answer 吃掉。
 */
const RULES: Rule[] = [
  {
    verdict: 'rate_limited',
    pattern: /评测(过于|太)?频繁|请求过于频繁|提交过于频繁|操作太频繁|频率限制|稍后再试|too many requests/i,
  },
  {
    verdict: 'compile_error',
    pattern:
      /编译(错误|失败|未通过)|compil(e|ation)\s*(error|failed)|syntax error|undefined reference|fatal error|error: expected/i,
  },
  {
    verdict: 'runtime_error',
    pattern:
      /运行(错误|失败|超时)|运行时错误|runtime error|time limit|内存超限|memory limit|段错误|segmentation fault|stack overflow|terminate called/i,
  },
  {
    verdict: 'wrong_answer',
    pattern:
      /答案(错误|不正确|不一致)|输出(错误|不正确|不一致|格式错误)|结果(错误|不正确|不一致)|未通过|不通过|没有通过|部分通过|wrong answer|presentation error|测试点.*未通过/i,
  },
  { verdict: 'passed', pattern: /全部通过|恭喜.*通过|通过|正确|accepted|\bAC\b/i },
  { verdict: 'running', pattern: /(评测|判题|运行|提交)中|等待(评测|结果)|judging|pending|queued/i },
]

const LABELS: Record<Verdict, string> = {
  passed: '评测通过',
  wrong_answer: '答案错误',
  compile_error: '编译错误',
  runtime_error: '运行错误',
  rate_limited: '触发评测频率限制',
  running: '评测进行中',
  unknown: '未识别到评测结论',
}

export function classifyVerdict(text: string): Verdict {
  const value = text.trim()
  if (!value) return 'unknown'
  for (const rule of RULES) {
    if (rule.pattern.test(value)) return rule.verdict
  }
  return 'unknown'
}

export function verdictLabel(verdict: Verdict): string {
  return LABELS[verdict]
}

/** 模型偶尔无视"不要围栏"的约束，这里兜一刀；正文里的 ``` 不动。 */
export function normalizeCode(raw: string): string {
  let text = raw.replace(/^\uFEFF/, '').trim()
  const fence = /^```[a-zA-Z0-9+#._-]*\s*\n([\s\S]*?)\n?```$/.exec(text)
  if (fence?.[1] !== undefined) {
    text = fence[1]
  } else if (text.startsWith('```')) {
    text = text
      .replace(/^```[a-zA-Z0-9+#._-]*\s*\n?/, '')
      .replace(/\n?```\s*$/, '')
  }
  return text.replace(/\r\n/g, '\n').replace(/\s+$/, '')
}

/** 回读校验用：忽略行尾空白与 CRLF，避免编辑器自动格式化造成假失败。 */
export function normalizeForCompare(code: string): string {
  return code
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
}
