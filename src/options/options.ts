import type { BackgroundRequest, BackgroundResponse } from '../shared/messages.ts'
import type { ProviderId, Settings } from '../shared/types.ts'

const PROVIDER_DEFAULTS: Record<ProviderId, { baseUrl: string; model: string }> = {
  'openai-compatible': { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' },
}

function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id)
  if (!element) throw new Error(`页面缺少元素 #${id}`)
  return element as T
}

const providerSelect = el<HTMLSelectElement>('provider')
const baseUrlInput = el<HTMLInputElement>('baseUrl')
const apiKeyInput = el<HTMLInputElement>('apiKey')
const modelInput = el<HTMLInputElement>('model')
const temperatureInput = el<HTMLInputElement>('temperature')
const maxTokensInput = el<HTMLInputElement>('maxTokens')
const gapInput = el<HTMLInputElement>('requestGapMs')
const retriesInput = el<HTMLInputElement>('maxRetries')
const autoInjectInput = el<HTMLInputElement>('autoInject')
const autoSubmitInput = el<HTMLInputElement>('autoSubmit')
const useAnswerCacheInput = el<HTMLInputElement>('useAnswerCache')
const useTrustedInputInput = el<HTMLInputElement>('useTrustedInput')
const useTerminalPreludeInput = el<HTMLInputElement>('useTerminalPrelude')
const terminalPreludeInput = el<HTMLTextAreaElement>('terminalPrelude')
const useSqlPreludeInput = el<HTMLInputElement>('useSqlPrelude')
const sqlPreludeInput = el<HTMLTextAreaElement>('sqlPrelude')
const cacheCountEl = el<HTMLSpanElement>('cacheCount')
const clearCacheBtn = el<HTMLButtonElement>('clearCache')
const statusEl = el<HTMLSpanElement>('status')
const saveBtn = el<HTMLButtonElement>('save')
const testBtn = el<HTMLButtonElement>('test')
const clearBtn = el<HTMLButtonElement>('clearKey')

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function setStatus(text: string, tone: 'idle' | 'ok' | 'error' = 'idle'): void {
  statusEl.textContent = text
  statusEl.className = tone === 'idle' ? 'status' : `status ${tone}`
}

function setBusy(busy: boolean): void {
  saveBtn.disabled = busy
  testBtn.disabled = busy
  clearBtn.disabled = busy
}

async function send<T>(request: BackgroundRequest): Promise<T> {
  let response: BackgroundResponse<T> | undefined
  try {
    response = (await chrome.runtime.sendMessage(request)) as BackgroundResponse<T> | undefined
  } catch (error) {
    throw new Error(`扩展后台不可用：${messageOf(error)}`)
  }
  if (!response) throw new Error('扩展后台没有响应，请重新加载扩展。')
  if (!response.ok) throw new Error(response.error.message)
  return response.data
}

function fill(settings: Settings): void {
  providerSelect.value = settings.provider
  baseUrlInput.value = settings.baseUrl
  apiKeyInput.value = settings.apiKey
  modelInput.value = settings.model
  temperatureInput.value = String(settings.temperature)
  maxTokensInput.value = String(settings.maxTokens)
  gapInput.value = String(settings.requestGapMs)
  retriesInput.value = String(settings.maxRetries)
  autoInjectInput.checked = settings.autoInject
  autoSubmitInput.checked = settings.autoSubmit
  useAnswerCacheInput.checked = settings.useAnswerCache
  useTrustedInputInput.checked = settings.useTrustedInput
  useTerminalPreludeInput.checked = settings.useTerminalPrelude
  terminalPreludeInput.value = settings.terminalPrelude
  useSqlPreludeInput.checked = settings.useSqlPrelude
  sqlPreludeInput.value = settings.sqlPrelude
}

function numberInput(input: HTMLInputElement, fallback: number): number {
  const value = Number(input.value)
  return Number.isFinite(value) ? value : fallback
}

/**
 * 自定义网关需要运行时授权：manifest 只列了常见厂商域名，
 * 用户填别家地址时必须在按钮点击的手势里请求 host 权限，否则 SW 的 fetch 只会得到 Failed to fetch。
 */
async function ensureOriginPermission(): Promise<{ ok: boolean; origin: string }> {
  const raw = baseUrlInput.value.trim()
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: true, origin: '' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: true, origin: url.origin }

  const origin = url.origin
  const pattern = `${origin}/*`
  try {
    if (await chrome.permissions.contains({ origins: [pattern] })) return { ok: true, origin }
    const granted = await chrome.permissions.request({ origins: [pattern] })
    return { ok: granted, origin }
  } catch (error) {
    throw new Error(`请求域名授权失败：${messageOf(error)}`)
  }
}

function readForm(): Partial<Settings> {
  return {
    provider: (providerSelect.value as ProviderId) ?? 'openai-compatible',
    baseUrl: baseUrlInput.value.trim(),
    apiKey: apiKeyInput.value.trim(),
    model: modelInput.value.trim(),
    temperature: numberInput(temperatureInput, 0.2),
    maxTokens: Math.round(numberInput(maxTokensInput, 1600)),
    requestGapMs: Math.round(numberInput(gapInput, 3000)),
    maxRetries: Math.round(numberInput(retriesInput, 2)),
    autoInject: autoInjectInput.checked,
    autoSubmit: autoSubmitInput.checked,
    useAnswerCache: useAnswerCacheInput.checked,
    useTrustedInput: useTrustedInputInput.checked,
    useTerminalPrelude: useTerminalPreludeInput.checked,
    terminalPrelude: terminalPreludeInput.value.trim(),
    useSqlPrelude: useSqlPreludeInput.checked,
    sqlPrelude: sqlPreludeInput.value.trim(),
  }
}

async function save(): Promise<void> {
  setBusy(true)
  setStatus('保存中…')
  try {
    const permission = await ensureOriginPermission()
    const saved = await send<Settings>({ type: 'settings:save', settings: readForm() })
    fill(saved)
    setStatus(
      permission.ok ? '已保存' : `已保存，但未授权 ${permission.origin}：模型请求会被浏览器拦截（Failed to fetch）`,
      permission.ok ? 'ok' : 'error',
    )
  } catch (error) {
    setStatus(messageOf(error), 'error')
  } finally {
    setBusy(false)
  }
}

async function testConnection(): Promise<void> {
  setBusy(true)
  setStatus('正在测试连接…')
  try {
    const permission = await ensureOriginPermission()
    if (!permission.ok) {
      setStatus(
        `未授权 ${permission.origin}：浏览器会拦截请求并返回 Failed to fetch。重新点"测试连接"，在弹窗里选"允许"。`,
        'error',
      )
      return
    }
    const data = await send<{ text: string }>({ type: 'llm:ping' })
    setStatus(`连接成功：${data.text.slice(0, 40)}`, 'ok')
  } catch (error) {
    setStatus(messageOf(error), 'error')
  } finally {
    setBusy(false)
  }
}

async function clearKey(): Promise<void> {
  if (!window.confirm('确定清空已保存的 API Key？')) return
  setBusy(true)
  try {
    await send<Settings>({ type: 'settings:clear-key' })
    apiKeyInput.value = ''
    setStatus('已清空密钥', 'ok')
  } catch (error) {
    setStatus(messageOf(error), 'error')
  } finally {
    setBusy(false)
  }
}

async function loadCacheStats(): Promise<void> {
  try {
    const data = await send<{ count: number }>({ type: 'answer:stats' })
    cacheCountEl.textContent = `已缓存 ${data.count} 道题`
  } catch (error) {
    cacheCountEl.textContent = messageOf(error)
  }
}

async function clearCache(): Promise<void> {
  if (!window.confirm('清空本地答案库？已通过的缓存代码会被删除。')) return
  clearCacheBtn.disabled = true
  try {
    await send<{ count: number }>({ type: 'answer:clear' })
    cacheCountEl.textContent = '已缓存 0 道题'
    setStatus('答案库已清空', 'ok')
  } catch (error) {
    setStatus(messageOf(error), 'error')
  } finally {
    clearCacheBtn.disabled = false
  }
}

async function load(): Promise<void> {
  setBusy(true)
  setStatus('读取设置…')
  try {
    const settings = await send<Settings>({ type: 'settings:get' })
    fill(settings)
    setStatus('')
    void loadCacheStats()
  } catch (error) {
    setStatus(messageOf(error), 'error')
  } finally {
    setBusy(false)
  }
}

providerSelect.addEventListener('change', () => {
  const provider: ProviderId = providerSelect.value === 'ollama' ? 'ollama' : 'openai-compatible'
  const defaults = provider === 'ollama' ? PROVIDER_DEFAULTS.ollama : PROVIDER_DEFAULTS['openai-compatible']
  baseUrlInput.placeholder = defaults.baseUrl
  modelInput.placeholder = defaults.model

  const knownBaseUrls = Object.values(PROVIDER_DEFAULTS).map((item) => item.baseUrl)
  const knownModels = Object.values(PROVIDER_DEFAULTS).map((item) => item.model)
  if (!baseUrlInput.value.trim() || knownBaseUrls.includes(baseUrlInput.value.trim())) {
    baseUrlInput.value = defaults.baseUrl
  }
  if (!modelInput.value.trim() || knownModels.includes(modelInput.value.trim())) {
    modelInput.value = defaults.model
  }
})

saveBtn.addEventListener('click', () => void save())
testBtn.addEventListener('click', () => void testConnection())
clearBtn.addEventListener('click', () => void clearKey())
clearCacheBtn.addEventListener('click', () => void clearCache())

void load()
