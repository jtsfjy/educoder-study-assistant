export type Language = 'cpp' | 'c' | 'python' | 'java' | 'javascript' | 'sql' | 'unknown'

export type EditorKind =
  | 'codemirror5'
  | 'codemirror6'
  | 'ace'
  | 'monaco'
  | 'textarea'
  | 'contenteditable'
  | 'terminal'
  | 'none'

export type SectionKey =
  | 'inputSpec'
  | 'outputSpec'
  | 'sampleInput'
  | 'sampleOutput'
  | 'sample'
  | 'constraints'
  | 'note'

/** 页面抽取出来的最小文本块，tag 用于区分正文与 pre/code。 */
export interface TextBlock {
  tag: string
  text: string
}

export interface ProblemSample {
  input: string
  output: string
}

export interface Problem {
  title: string
  description: string
  inputSpec: string
  outputSpec: string
  samples: ProblemSample[]
  constraints: string[]
  template: string
  language: Language
  fingerprint: string
  selectorVersion: string
  sourceUrl: string
  extractedAt: number
}

export interface EditorInfo {
  kind: EditorKind
  code: string
  selector: string
}

export type ProviderId = 'openai-compatible' | 'ollama'

export interface Settings {
  provider: ProviderId
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  requestGapMs: number
  maxRetries: number
  /** 生成后自动写入编辑器（实例 API + 回读校验）。 */
  autoInject: boolean
  /** 写入后自动点击"评测"并回灌错误重试。 */
  autoSubmit: boolean
  /** 命中本地答案库时先注入缓存代码，不再请求模型。 */
  useAnswerCache: boolean
  /** 常规写入被页面忽略时，用 CDP Input.insertText 走受信任输入（会短暂附加调试器）。 */
  useTrustedInput: boolean
  /** 终端型编辑器：键入代码前先执行的前置命令（例如 mysql 登录）。 */
  useTerminalPrelude: boolean
  terminalPrelude: string
  /** 终端型编辑器：键入 SQL 前先执行的 SQL（建库、切库）。 */
  useSqlPrelude: boolean
  sqlPrelude: string
}

/** 发给 background 的题目载荷：Problem 去掉纯展示用的页面元信息，保证消息可序列化。 */
export type ProblemPayload = Problem
