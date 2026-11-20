import { ERROR_CODES } from '../../shared/messages.ts'
import type { ChatMessage } from '../../shared/prompt.ts'
import type { Settings } from '../../shared/types.ts'

export class ProviderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

const isLocalBase = (url: string): boolean =>
  /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url.trim())

/** 兼容 OpenAI 协议：baseUrl 可以是 https://host/v1，也可以直接写到 /chat/completions。 */
export function chatEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) throw new ProviderError(ERROR_CODES.BAD_REQUEST, '尚未配置模型 endpoint（baseUrl）。')
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`
}

/** 自定义网关必须由用户授权，否则 service worker 的 fetch 会被浏览器拦成 Failed to fetch。 */
async function assertHostPermission(endpoint: string): Promise<void> {
  let origin: string
  try {
    origin = new URL(endpoint).origin
  } catch {
    throw new ProviderError(ERROR_CODES.BAD_REQUEST, `接口地址不是合法 URL：${endpoint}`)
  }
  try {
    if (await chrome.permissions.contains({ origins: [`${origin}/*`] })) return
  } catch {
    return
  }
  throw new ProviderError(
    ERROR_CODES.NO_HOST_PERMISSION,
    `扩展没有被授权访问 ${origin}。到设置页点"测试连接"，在弹窗里允许该域名后重试；未授权时浏览器只会返回 Failed to fetch。`,
  )
}

interface ChatOptions {
  maxTokens?: number
  timeoutMs?: number
}

export async function chat(settings: Settings, messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
  const endpoint = chatEndpoint(settings.baseUrl)
  await assertHostPermission(endpoint)
  if (!settings.apiKey && !isLocalBase(settings.baseUrl)) {
    throw new ProviderError(ERROR_CODES.NO_API_KEY, '尚未配置 API Key：点扩展图标打开设置页填写后再试。')
  }
  if (!settings.model) {
    throw new ProviderError(ERROR_CODES.BAD_REQUEST, '尚未配置模型名（model）。')
  }

  const attempts = Math.max(1, Math.min(3, settings.maxRetries + 1))
  let lastError: ProviderError | undefined

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestOnce(endpoint, settings, messages, options)
    } catch (error) {
      const failure =
        error instanceof ProviderError
          ? error
          : new ProviderError(ERROR_CODES.UNKNOWN, error instanceof Error ? error.message : String(error))
      lastError = failure
      const retryable =
        failure.status === 429 || (failure.status ?? 0) >= 500 || failure.code === ERROR_CODES.TIMEOUT
      if (!retryable || attempt === attempts) throw failure
      await sleep(700 * attempt)
    }
  }
  throw lastError ?? new ProviderError(ERROR_CODES.UNKNOWN, '模型请求失败。')
}

async function requestOnce(
  endpoint: string,
  settings: Settings,
  messages: ChatMessage[],
  options: ChatOptions,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 90_000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: settings.temperature,
        max_tokens: options.maxTokens ?? settings.maxTokens,
        stream: false,
      }),
    })

    const raw = await response.text()
    if (!response.ok) {
      const details = raw.slice(0, 500)
      if (response.status === 401 || response.status === 403) {
        throw new ProviderError(
          ERROR_CODES.NO_API_KEY,
          `鉴权失败（${response.status}）：请求 ${endpoint}，模型 ${settings.model}。` +
            `请确认 Key 与接口地址属于同一家提供商（把 OpenAI 兼容网关的 Key 填到别家地址上就会 401）。${details}`,
          response.status,
        )
      }
      if (response.status === 429) {
        throw new ProviderError(ERROR_CODES.RATE_LIMITED, `请求被限流（429）：稍后再试。${details}`, response.status)
      }
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, `模型接口返回 ${response.status}：${details}`, response.status)
    }

    let data: unknown
    try {
      data = JSON.parse(raw)
    } catch {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, '模型接口返回的不是 JSON。', response.status)
    }

    const content = (data as { choices?: { message?: { content?: unknown } }[] }).choices?.[0]?.message?.content
    if (typeof content !== 'string' || !content.trim()) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, '模型返回了空内容。', response.status)
    }
    return content.trim()
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new ProviderError(ERROR_CODES.TIMEOUT, `模型请求超过 ${Math.round(timeoutMs / 1000)} 秒未返回，已中断。`)
    }
    // fetch 抛 TypeError 基本都是"域名没授权 / 网络不可达 / URL 不完整"这一族。
    if (error instanceof TypeError) {
      throw new ProviderError(
        ERROR_CODES.NETWORK_ERROR,
        `请求 ${endpoint} 失败（${error.message}）：域名未授权、网络不可达，或接口地址不是完整 URL。`,
      )
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}
