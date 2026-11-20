import type { BackgroundRequest, BackgroundResponse } from '../../shared/messages.ts'
import type { FrameReply } from '../../shared/frame.ts'
import { clickElement, scanResultText, scanSubmitButton } from '../../shared/result-dom.ts'
import type { EditorInfo, Problem, Settings } from '../../shared/types.ts'
import { classifyVerdict, normalizeForCompare, verdictLabel, type Verdict } from '../../shared/verdict.ts'
import { clickSubmit, diagnose, focusEditor, readFrameResult, requestEditor, resetFramePin, writeEditor } from './bus.ts'
import { extractProblem } from './extract.ts'
import type { Panel } from './panel.ts'

const SUBMIT_TIMEOUT_MS = 120_000
const POLL_MS = 1100
const RESULT_FRAME_TIMEOUT_MS = 600

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type AutoSettings = Pick<
  Settings,
  | 'autoInject'
  | 'autoSubmit'
  | 'maxRetries'
  | 'useAnswerCache'
  | 'useTrustedInput'
  | 'useTerminalPrelude'
  | 'terminalPrelude'
  | 'useSqlPrelude'
  | 'sqlPrelude'
>

interface CachedAnswer {
  code: string
  updatedAt: number
}

async function send<T>(request: BackgroundRequest): Promise<T> {
  let response: BackgroundResponse<T> | undefined
  try {
    response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse<T> | undefined
  } catch (error) {
    throw new Error(
      `扩展后台不可用（${error instanceof Error ? error.message : String(error)}），请刷新页面后重试。`,
    )
  }
  if (!response) throw new Error('扩展后台没有返回结果，请刷新页面后重试。')
  if (!response.ok) throw new Error(response.error.message)
  return response.data
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 诊断类请求失败不该打断主流程，失败即 null。 */
async function safeSend<T>(request: BackgroundRequest): Promise<T | null> {
  try {
    return await send<T>(request)
  } catch {
    return null
  }
}

const onOff = (value: boolean): string => (value ? '开' : '关')

/** 顶栏与实训区都可能有结果区，取"已经识别出结论"或更长的那份。 */
function pickResultText(top: string, frame: string): string {
  const topVerdict = classifyVerdict(top)
  const frameVerdict = classifyVerdict(frame)
  if (topVerdict !== 'unknown' && frameVerdict === 'unknown') return top
  if (frameVerdict !== 'unknown' && topVerdict === 'unknown') return frame
  return frame.length > top.length ? frame : top
}

const TASK_PATH = /\/(tasks|shixun_homework)\//
const RETRY_LIMIT = 3
const RETRY_BASE_MS = 1500
const EDITOR_RETRY_LIMIT = 4

/** 只比较 origin + pathname：平台常在 query 上加追踪参数，比 href 会把同一道题误判成“跳转”并反复重读。 */
function urlSignature(): string {
  return `${location.origin}${location.pathname}`
}

/** 只在具体实训题页面自动读取；课程列表页只挂面板，不抽题。 */
function isTaskPage(): boolean {
  return TASK_PATH.test(location.pathname)
}

export class Orchestrator {
  private problem: Problem | null = null
  private editor: EditorInfo | null = null
  private timer: number | null = null
  private lastSignature = urlSignature()
  private attempts = 0
  private editorAttempts = 0
  private refreshing = false
  private observing = false
  private readonly observer: MutationObserver
  private readonly pollTimer: number

  constructor(private readonly panel: Panel) {
    this.panel.setStatus('等待页面加载…', 'busy')
    this.observer = new MutationObserver(() => {
      // 只在“还没读到题面 + 自动读取仍开启”时响应 DOM 变化；
      // 读成功后 observer 会被断开，重读走面板上的“重新抽取”。
      if (this.problem || !this.observing) return
      this.schedule(700)
    })

    this.pollTimer = window.setInterval(this.checkUrl, 800)
    window.addEventListener('popstate', this.checkUrl)
  }

  start(): void {
    this.beginAutoExtraction()
  }

  /** 进入实训题页才开始自动读取；列表页只提示、不动手。 */
  private beginAutoExtraction(): void {
    this.panel.ensureMounted()
    if (!isTaskPage()) {
      this.stopAutoExtraction()
      this.panel.setStatus('这里是列表页：进入具体实训题后会自动读取题面', 'idle')
      return
    }
    if (!this.observing) {
      this.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true })
      this.observing = true
    }
    this.schedule(200)
  }

  /** 读取成功即停：断开 observer、清掉待执行的读取，避免反复重跑。 */
  private stopAutoExtraction(): void {
    if (this.observing) {
      this.observer.disconnect()
      this.observing = false
    }
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
  }

  private readonly checkUrl = (): void => {
    const signature = urlSignature()
    if (signature === this.lastSignature) return
    this.lastSignature = signature
    this.attempts = 0
    this.editorAttempts = 0
    this.problem = null
    this.editor = null
    resetFramePin()
    this.stopAutoExtraction()
    this.panel.setStatus('页面已跳转，重新读取题面…', 'busy')
    this.beginAutoExtraction()
  }

  private schedule(delay: number): void {
    if (this.timer !== null) return
    this.timer = window.setTimeout(() => {
      this.timer = null
      void this.refresh()
    }, delay)
  }

  /** 手动重读：重置计数、重新挂 observer、立刻抽一次。 */
  async refreshNow(): Promise<void> {
    this.attempts = 0
    this.editorAttempts = 0
    this.problem = null
    this.editor = null
    resetFramePin()
    this.stopAutoExtraction()
    this.beginAutoExtraction()
    if (!this.observing) return
    if (this.timer !== null) {
      window.clearTimeout(this.timer)
      this.timer = null
    }
    await this.refresh()
  }

  private async refresh(): Promise<void> {
    if (this.refreshing || !isTaskPage()) return
    this.refreshing = true
    try {
      this.panel.ensureMounted()
      this.panel.setStatus('正在读取题面…', 'busy')

      const editor = await requestEditor(1200)
      const { problem, blockCount } = await extractProblem({ template: editor?.code })

      if (!problem || blockCount === 0) {
        this.panel.setStatus('未识别到题面', 'warn')
        this.retryLater()
        return
      }

      this.problem = problem
      this.editor = editor
      this.attempts = 0
      this.panel.renderProblem(problem, editor)
      this.stopAutoExtraction()
      void this.selfCheck(true)

      if (!editor) {
        this.panel.setStatus('题面已读取；实训区未连接，看诊断区「实训帧」行', 'warn')
        this.scheduleEditorProbe()
      }
    } catch (error) {
      this.panel.showError(messageOf(error))
    } finally {
      this.refreshing = false
    }
  }

  private retryLater(): void {
    if (this.attempts >= RETRY_LIMIT) {
      this.stopAutoExtraction()
      this.panel.setStatus('未识别到题面：已停止自动重试，点「重新抽取」手动再试', 'warn')
      return
    }
    this.attempts += 1
    this.schedule(RETRY_BASE_MS * this.attempts)
  }

  /** 题面已读到但编辑器没连上时，只重探编辑器，不重复抽题。 */
  private scheduleEditorProbe(): void {
    if (this.editorAttempts >= EDITOR_RETRY_LIMIT || !this.problem) return
    this.editorAttempts += 1
    window.setTimeout(() => {
      void (async () => {
        if (!this.problem) return
        const editor = await requestEditor(1500)
        if (!editor) {
          this.scheduleEditorProbe()
          return
        }
        this.editor = editor
        this.editorAttempts = 0
        this.panel.renderProblem(this.problem, editor)
        this.panel.setStatus('实训区已连接', 'ok')
        void this.selfCheck(true)
      })()
    }, 1600)
  }

  async explain(): Promise<void> {
    const problem = this.problem
    if (!problem) {
      this.panel.showError('还没有识别到题面，等页面加载完再试，或点"重新抽取"。')
      return
    }
    if (this.panel.isBusy) return

    this.panel.setBusy(true)
    this.panel.setStatus('正在请求分步讲解…', 'busy')
    try {
      const data = await send<{ text: string }>({ type: 'llm:explain', problem })
      this.panel.showResult('分步讲解', data.text)
      this.panel.setStatus('讲解完成', 'ok')
    } catch (error) {
      this.panel.showError(messageOf(error))
    } finally {
      this.panel.setBusy(false)
    }
  }

  async review(): Promise<void> {
    const problem = this.problem
    if (!problem) {
      this.panel.showError('还没有识别到题面，等页面加载完再试，或点"重新抽取"。')
      return
    }
    if (this.panel.isBusy) return

    this.panel.setBusy(true)
    this.panel.setStatus('正在读取当前代码…', 'busy')
    try {
      let editor = this.editor
      if (!editor?.code.trim()) editor = await requestEditor(1500)
      if (!editor?.code.trim()) {
        this.panel.showError('没有读到编辑器内容：请先在实训区打开代码编辑框，并确认代码不是空的。')
        return
      }
      this.editor = editor

      const lines = editor.code.split('\n').length
      this.panel.setStatus(`正在复盘 ${lines} 行代码…`, 'busy')
      const data = await send<{ text: string }>({ type: 'llm:review', problem, code: editor.code })
      this.panel.showResult('代码复盘', data.text)
      this.panel.setStatus('复盘完成', 'ok')
    } catch (error) {
      this.panel.showError(messageOf(error))
    } finally {
      this.panel.setBusy(false)
    }
  }

  /**
   * 只读自检：帧数、可写帧数、编辑器类型、评测按钮、结果区、答案库、开关状态。
   * 不写入、不点击；用来在按下"自动解题"之前就看清链路通不通。
   */
  async selfCheck(quiet = false): Promise<void> {
    if (this.panel.isBusy) return
    if (!quiet) {
      this.panel.setBusy(true)
      this.panel.setStatus('自检中…', 'busy')
    }

    try {
      const diag = await diagnose()
      const cache = await safeSend<{ count: number }>({ type: 'answer:stats' })
      const settings = await safeSend<AutoSettings>({ type: 'settings:get' })

      this.panel.renderDiagnostics([
        { label: '选择器', value: this.problem?.selectorVersion ?? '—' },
        { label: '实训帧', value: `${diag.iframes} 个 iframe · 回包 ${diag.frames} · 可写 ${diag.withEditor}` },
        {
          label: '编辑器',
          value:
            diag.editorKind === 'none'
              ? '未找到'
              : `${diag.editorKind}${diag.editorSelector ? ` · ${diag.editorSelector}` : ''}`,
        },
        { label: '评测按钮', value: diag.hasSubmit ? `已找到「${diag.submitLabel || '评测'}」` : '未找到' },
        { label: '候选', value: diag.candidates || '无' },
        { label: '结果区', value: diag.resultChars > 0 ? `已渲染 ${diag.resultChars} 字` : '空' },
        { label: '答案库', value: cache ? `${cache.count} 条` : '读取失败' },
        {
          label: '开关',
          value: settings
            ? `写入${onOff(settings.autoInject)} · 评测${onOff(settings.autoSubmit)} · 缓存${onOff(settings.useAnswerCache)}`
            : '读取失败',
        },
      ])

      if (!quiet) {
        this.panel.setStatus(
          diag.withEditor > 0 ? '自检完成：可以自动解题' : '自检完成：未连上编辑器',
          diag.withEditor > 0 ? 'ok' : 'warn',
        )
      }
    } catch (error) {
      if (!quiet) this.panel.showError(messageOf(error))
    } finally {
      if (!quiet) this.panel.setBusy(false)
    }
  }

  /**
   * 自动解题：生成 → 注入 → 回读校验 → 点评测 → 读结论 → 错误回灌重试。
   * 任何一步失败都停下并把原因码写进面板，不做"硬着头皮继续"。
   */
  async solve(): Promise<void> {
    const problem = this.problem
    if (!problem) {
      this.panel.showError('还没有识别到题面，等页面加载完再试，或点"重新抽取"。')
      return
    }
    if (this.panel.isBusy) return

    this.panel.setBusy(true)
    this.panel.setStatus('读取设置…', 'busy')
    try {
      const settings = await send<AutoSettings>({ type: 'settings:get' })
      if (!settings.autoInject) {
        this.panel.setStatus('自动写入已关闭：到设置页开启"自动写入编辑器"后再试', 'warn')
        return
      }

      const rounds = Math.max(1, 1 + (Number.isFinite(settings.maxRetries) ? settings.maxRetries : 0))
      let lastCode = ''
      let lastResult = ''

      // 终端环境（如 mysql 实验）已经由前置命令登录数据库，提示词里点明这一点，
      // 否则模型会把登录/连接命令也写进代码，评测必然不通过。
      const promptProblem =
        this.editor?.kind === 'terminal' && settings.useTerminalPrelude && settings.terminalPrelude.trim()
          ? {
              ...problem,
              constraints: [
                ...problem.constraints,
                `当前终端已登录数据库（前置命令：${settings.terminalPrelude.trim()}）。只输出 SQL 语句，不要包含登录或连接命令。`,
              ],
            }
          : problem

      // 命中答案库：先注入再评测，省掉一次模型调用；缓存失效则删掉重新生成。
      if (settings.useAnswerCache) {
        const cached = await send<CachedAnswer | null>({ type: 'answer:get', problem })
        if (cached?.code) {
          this.panel.setStatus('答案库命中：注入缓存代码…', 'busy')
          this.panel.showResult('答案库命中（不消耗 token）', cached.code)
          lastCode = cached.code
          await this.inject(cached.code, settings)

          if (!settings.autoSubmit) {
            this.panel.setStatus('缓存代码已注入；自动评测已关闭', 'ok')
            return
          }

          const cachedOutcome = await this.submitAndWait()
          lastResult = cachedOutcome.text
          if (cachedOutcome.verdict === 'passed') {
            this.panel.showResult(
              '答案库命中并通过',
              `${cachedOutcome.text}\n\n—— 缓存代码（${cached.code.split('\n').length} 行），未请求模型 ——`,
            )
            this.panel.setStatus('缓存代码评测通过（零 token）', 'ok')
            return
          }

          await send<null>({ type: 'answer:drop', problem })
          this.panel.setStatus('缓存代码未通过，已失效；改为现场生成…', 'warn')
        }
      }

      for (let round = 1; round <= rounds; round += 1) {
        this.panel.setStatus(`第 ${round}/${rounds} 轮：生成代码…`, 'busy')
        const generated = await send<{ code: string }>({
          type: 'llm:generate',
          problem: promptProblem,
          previous: round > 1 ? { code: lastCode, result: lastResult } : undefined,
        })
        const code = generated.code
        if (!code.trim()) throw new Error('模型没有返回可用代码。')
        lastCode = code
        this.panel.showResult('生成代码', code)

        await this.inject(code, settings)

        if (!settings.autoSubmit) {
          this.panel.setStatus('代码已注入；自动评测已关闭', 'ok')
          return
        }

        const outcome = await this.submitAndWait()
        lastResult = outcome.text

        if (outcome.verdict === 'passed') {
          // 通过即入库；写缓存失败不影响本次结论。
          void send<unknown>({ type: 'answer:put', problem, code }).catch(() => undefined)
          this.panel.showResult(
            verdictLabel('passed'),
            `${outcome.text}\n\n—— 第 ${round} 轮代码（${code.split('\n').length} 行）已注入并提交，已写入答案库 ——`,
          )
          this.panel.setStatus(`评测通过（第 ${round} 轮）`, 'ok')
          return
        }

        if (outcome.verdict === 'rate_limited') {
          throw new Error(`平台限制评测频率，本轮中止：\n${outcome.text}`)
        }

        this.panel.showResult(`第 ${round} 轮 ${verdictLabel(outcome.verdict)}`, outcome.text, 'error')
        this.panel.setStatus(`第 ${round} 轮未通过（${verdictLabel(outcome.verdict)}），准备重试…`, 'warn')
      }

      this.panel.showResult(
        '自动解题未通过',
        `${lastResult || '没有读到评测结论'}\n\n—— 最后一版代码 ——\n${lastCode}`,
        'error',
      )
      this.panel.setStatus(`${rounds} 轮仍未通过，已停止`, 'error')
    } catch (error) {
      this.panel.showError(messageOf(error))
    } finally {
      this.panel.setBusy(false)
    }
  }

  /**
   * 写入三级：
   * 1) 常规：实例 API / execCommand，回读校验；
   * 2) 普通编辑器：CDP Input.insertText（isTrusted=true），回读校验；
   * 3) 终端：先跑前置命令（数据库登录），再逐键键入 + 回车；屏幕多为 canvas 渲染，
   *    回读不可靠，写入是否成功交给"评测结果"判定。
   */
  private async inject(code: string, settings: AutoSettings): Promise<void> {
    this.panel.setStatus('写入编辑器…', 'busy')
    const reply = await writeEditor(code)

    if (reply?.wrote) {
      this.editor = { kind: reply.kind, code: reply.code || code, selector: reply.selector }
      this.panel.setStatus(
        `已写入 ${code.split('\n').length} 行（${reply.kind} · ${reply.strategy ?? 'API'}）`,
        'ok',
      )
      return
    }

    const failure = this.injectError(reply, code)
    if (!settings.useTrustedInput) throw new Error(failure)

    const focused = await focusEditor()
    if (!focused) throw new Error(`${failure}\n编辑器拿不到焦点，受信任输入也无法执行。`)

    const target = await requestEditor(1200)
    if (target?.kind === 'terminal') {
      await this.typeIntoTerminal(code, settings, failure)
      return
    }

    const trusted = await send<{ ok: boolean; error?: string }>({ type: 'inject:trusted', code })
    if (!trusted.ok) throw new Error(`${failure}\n受信任输入失败：${trusted.error ?? '未知原因'}`)

    await sleep(500)
    const after = await requestEditor(1500)
    if (!after || normalizeForCompare(after.code) !== normalizeForCompare(code)) {
      throw new Error(`${failure}\n受信任输入后回读仍不一致：页面可能在回滚，或读到的不是同一份编辑器内容。`)
    }

    this.editor = after
    this.panel.setStatus(`已写入 ${code.split('\n').length} 行（受信任输入 · ${after.kind}）`, 'ok')
  }

  /**
   * 终端：先执行前置命令（如 mysql 登录），再逐键键入代码并回车。
   * xterm 用 canvas 渲染时 DOM 里读不到文本，所以不做"屏幕内容"校验，结果以评测为准。
   */
  private async typeIntoTerminal(code: string, settings: AutoSettings, failure: string): Promise<void> {
    const prelude = settings.useTerminalPrelude ? settings.terminalPrelude.trim() : ''
    const sqlPrelude = settings.useSqlPrelude ? settings.sqlPrelude.trim() : ''
    const payload = sqlPrelude ? `${sqlPrelude}\n${code}` : code

    if (prelude) {
      this.panel.setStatus('终端：执行前置命令（数据库登录）…', 'busy')
      const pre = await send<{ ok: boolean; error?: string }>({
        type: 'inject:trusted',
        code: prelude,
        pressEnter: true,
        mode: 'keys',
      })
      if (!pre.ok) throw new Error(`${failure}\n前置命令失败：${pre.error ?? '未知原因'}`)
      await sleep(1500)
    }

    this.panel.setStatus('终端：逐键键入代码…', 'busy')
    const typed = await send<{ ok: boolean; error?: string }>({
      type: 'inject:trusted',
      code: payload,
      pressEnter: true,
      mode: 'keys',
    })
    if (!typed.ok) throw new Error(`${failure}\n逐键键入失败：${typed.error ?? '未知原因'}`)

    await sleep(900)
    const after = await requestEditor(1500)
    if (after) this.editor = after
    this.panel.setStatus(
      `已键入 ${code.split('\n').length} 行${sqlPrelude ? '（含建库语句）' : ''}` +
        `${prelude ? '，前置登录已执行' : ''}；终端结果以评测为准`,
      'ok',
    )
  }

  private injectError(reply: FrameReply | null, code: string): string {
    if (!reply) return '实训区没有响应：未连接编辑器（NO_EDITOR）。'
    const afterLines = (reply.code ?? '').split('\n').length
    return (
      `写入校验失败（INJECT_MISMATCH）：回读 ${afterLines} 行，期望 ${code.split('\n').length} 行。` +
      `\n策略 ${reply.strategy ?? '未知'} · 编辑器 ${reply.kind}` +
      (reply.error ? `\n${reply.error}` : '')
    )
  }

  private async submitAndWait(): Promise<{ verdict: Verdict; text: string }> {
    const baseline = await this.resultText()
    this.panel.setStatus('点击「评测」…', 'busy')

    const frameReply = await clickSubmit()
    let clicked = Boolean(frameReply?.clicked)
    let label = frameReply?.buttonText ?? ''

    if (!clicked) {
      const topButton = scanSubmitButton(document)
      if (topButton) {
        clickElement(topButton.element)
        clicked = true
        label = topButton.label
      }
    }

    if (!clicked) throw new Error('没有找到「评测/提交」按钮：确认实训区已展开、按钮可见。')

    this.panel.setStatus(`已点击「${label || '评测'}」，等待评测结果…`, 'busy')
    return this.waitVerdict(baseline)
  }

  private async resultText(): Promise<string> {
    const frame = await readFrameResult(RESULT_FRAME_TIMEOUT_MS)
    const top = scanResultText(document)
    return pickResultText(top, frame.text)
  }

  private async waitVerdict(baseline: string): Promise<{ verdict: Verdict; text: string }> {
    const deadline = Date.now() + SUBMIT_TIMEOUT_MS
    let last = baseline
    let stable = 0

    while (Date.now() < deadline) {
      await sleep(POLL_MS)
      const current = await this.resultText()
      if (!current) continue

      if (current !== last) {
        last = current
        stable = 0
        continue
      }

      stable += 1
      const verdict = classifyVerdict(last)
      if (verdict === 'passed') return { verdict, text: last }
      if (verdict !== 'unknown' && verdict !== 'running' && stable >= 1) return { verdict, text: last }
      // 结果区一直没变化，且和点评测之前一模一样：判定为"没读到结果"，不无谓等待。
      if (last === baseline && stable >= 4) return { verdict: 'unknown', text: last }
    }

    return { verdict: classifyVerdict(last), text: last }
  }

  dispose(): void {
    this.observer.disconnect()
    window.clearInterval(this.pollTimer)
    if (this.timer !== null) window.clearTimeout(this.timer)
    window.removeEventListener('popstate', this.checkUrl)
  }
}
