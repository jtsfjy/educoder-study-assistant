import { ERROR_CODES, fail, type BackgroundRequest, type BackgroundResponse } from '../shared/messages.ts'
import { buildExplainPrompt, buildFixPrompt, buildReviewPrompt, buildSolvePrompt } from '../shared/prompt.ts'
import { isExtensionContext as isExtensionContextOf } from '../shared/sender.ts'
import type { Language } from '../shared/types.ts'
import { normalizeCode } from '../shared/verdict.ts'
import { chat, ProviderError } from './providers/openai.ts'
import { answerStats, clearAnswers, dropAnswer, getAnswer, putAnswer } from './answers.ts'
import { clickAt, insertTrustedText } from './trusted-input.ts'
import { SerialLimiter } from './limiter.ts'
import { DEFAULT_SETTINGS, getSettings, saveSettings, sanitizeSettings, SETTINGS_KEY } from './settings.ts'

let gapMs = DEFAULT_SETTINGS.requestGapMs
const limiter = new SerialLimiter(() => gapMs)

/**
 * 把 storage.local 的读取权限收紧到可信上下文：
 * content script 因此读不到 apiKey，页面里的任何脚本更读不到。
 */
async function hardenStorage(): Promise<void> {
  try {
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
  } catch {
    // 旧版 Chromium 没有该 API，忽略即可；此时密钥仍只在 background 内使用。
  }
}

async function ensureDefaults(): Promise<void> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  if (!stored[SETTINGS_KEY]) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: DEFAULT_SETTINGS })
  }
  const settings = await getSettings()
  gapMs = settings.requestGapMs
}

async function bootstrap(): Promise<void> {
  await hardenStorage()
  await ensureDefaults()
}

function toFailure(error: unknown): BackgroundResponse<never> {
  if (error instanceof ProviderError) return fail(error.code, error.message)
  if (error instanceof Error) return fail(ERROR_CODES.UNKNOWN, error.message)
  return fail(ERROR_CODES.UNKNOWN, String(error))
}

/**
 * 判定消息来自扩展自身页面（设置页 / service worker）还是网页里的 content script。
 * 判据在 shared/sender.ts：origin/url 落在本扩展前缀内才算可信上下文。
 */
function isExtensionContext(sender: chrome.runtime.MessageSender): boolean {
  return isExtensionContextOf(sender, chrome.runtime.id, chrome.runtime.getURL(''))
}

/** 代码题按语言给 token 预算：Python 短、C++/Java 长，避免截断成半份代码。 */
function tokenBudget(base: number, language: Language): number {
  if (language === 'python' || language === 'sql' || language === 'javascript') return Math.min(base, 2048)
  if (language === 'cpp' || language === 'c' || language === 'java') return Math.min(4096, Math.max(base, 2048))
  return base
}

async function handleRequest(
  request: BackgroundRequest,
  sender: chrome.runtime.MessageSender,
): Promise<BackgroundResponse<unknown>> {
  const fromPage = !isExtensionContext(sender)

  switch (request?.type) {
    case 'settings:get': {
      const settings = await getSettings()
      // 页面侧永远拿不到明文 key。
      return { ok: true, data: fromPage ? sanitizeSettings(settings) : settings }
    }

    case 'settings:save': {
      if (fromPage) return fail(ERROR_CODES.BAD_REQUEST, '设置只能在扩展设置页修改。')
      const settings = await saveSettings(request.settings)
      gapMs = settings.requestGapMs
      return { ok: true, data: settings }
    }

    case 'settings:clear-key': {
      if (fromPage) return fail(ERROR_CODES.BAD_REQUEST, '设置只能在扩展设置页修改。')
      const settings = await saveSettings({ apiKey: '' })
      return { ok: true, data: settings }
    }

    case 'open-options': {
      await chrome.runtime.openOptionsPage()
      return { ok: true, data: null }
    }

    case 'llm:ping': {
      const settings = await getSettings()
      gapMs = settings.requestGapMs
      const text = await limiter.run(() =>
        chat(
          settings,
          [{ role: 'user', content: '这是一次连通性测试。只回复两个字：可用。' }],
          { maxTokens: 16, timeoutMs: 30_000 },
        ),
      )
      return { ok: true, data: { text } }
    }

    case 'llm:explain': {
      const settings = await getSettings()
      gapMs = settings.requestGapMs
      const text = await limiter.run(() =>
        chat(settings, buildExplainPrompt(request.problem), {
          maxTokens: Math.min(settings.maxTokens, 1400),
          timeoutMs: 120_000,
        }),
      )
      return { ok: true, data: { text } }
    }

    case 'llm:review': {
      if (typeof request.code !== 'string' || !request.code.trim()) {
        return fail(ERROR_CODES.BAD_REQUEST, '没有读到编辑器内容。')
      }
      const settings = await getSettings()
      gapMs = settings.requestGapMs
      const text = await limiter.run(() =>
        chat(settings, buildReviewPrompt(request.problem, request.code), {
          maxTokens: Math.min(settings.maxTokens, 1800),
          timeoutMs: 120_000,
        }),
      )
      return { ok: true, data: { text } }
    }

    case 'llm:generate': {
      const settings = await getSettings()
      gapMs = settings.requestGapMs
      const messages = request.previous
        ? buildFixPrompt(request.problem, request.previous.code, request.previous.result)
        : buildSolvePrompt(request.problem)
      const text = await limiter.run(() =>
        chat(settings, messages, {
          maxTokens: tokenBudget(settings.maxTokens, request.problem.language),
          timeoutMs: 150_000,
        }),
      )
      const code = normalizeCode(text)
      if (!code.trim()) return fail(ERROR_CODES.PROVIDER_ERROR, '模型没有返回可用代码。')
      return { ok: true, data: { code } }
    }

    case 'answer:get':
      return { ok: true, data: await getAnswer(request.problem) }

    case 'answer:put': {
      if (typeof request.code !== 'string' || !request.code.trim()) {
        return fail(ERROR_CODES.BAD_REQUEST, '缓存代码为空。')
      }
      return { ok: true, data: await putAnswer(request.problem, request.code) }
    }

    case 'answer:drop':
      await dropAnswer(request.problem)
      return { ok: true, data: null }

    case 'answer:stats':
      return { ok: true, data: await answerStats() }

    case 'answer:clear':
      if (fromPage) return fail(ERROR_CODES.BAD_REQUEST, '答案库只能在扩展设置页清空。')
      await clearAnswers()
      return { ok: true, data: { count: 0 } }

    case 'inject:trusted': {
      const tabId = sender.tab?.id
      if (typeof tabId !== 'number') return fail(ERROR_CODES.BAD_REQUEST, '拿不到标签页 id，无法附加调试器。')
      if (typeof request.code !== 'string' || !request.code.trim()) {
        return fail(ERROR_CODES.BAD_REQUEST, '没有可写入的代码。')
      }
      return {
        ok: true,
        data: await insertTrustedText(tabId, request.code, {
          pressEnter: Boolean(request.pressEnter),
          mode: request.mode === 'keys' ? 'keys' : 'insertText',
          selectAll: Boolean(request.selectAll),
          clearFirst: Boolean(request.clearFirst),
        }),
      }
    }

    case 'inject:click': {
      const tabId = sender.tab?.id
      if (typeof tabId !== 'number') return fail(ERROR_CODES.BAD_REQUEST, '拿不到标签页 id，无法真实点击。')
      if (!Number.isFinite(request.x) || !Number.isFinite(request.y)) {
        return fail(ERROR_CODES.BAD_REQUEST, '点击坐标无效。')
      }
      return { ok: true, data: await clickAt(tabId, Math.round(request.x), Math.round(request.y)) }
    }

    default:
      return fail(ERROR_CODES.BAD_REQUEST, '未知的请求类型。')
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  void bootstrap()
  if (details.reason === 'install') void chrome.runtime.openOptionsPage()
})

chrome.runtime.onStartup.addListener(() => {
  void bootstrap()
})

chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage()
})

chrome.runtime.onMessage.addListener(
  (message: unknown, sender: chrome.runtime.MessageSender, sendResponse: (response: BackgroundResponse) => void) => {
    void handleRequest(message as BackgroundRequest, sender)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse(toFailure(error)))
    return true
  },
)

void bootstrap()
