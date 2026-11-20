import type { ProviderId, Settings } from '../shared/types.ts'

export const SETTINGS_KEY = 'settings'

export const PROVIDER_DEFAULTS: Record<ProviderId, { baseUrl: string; model: string }> = {
  'openai-compatible': { baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  ollama: { baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5-coder:7b' },
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'openai-compatible',
  ...PROVIDER_DEFAULTS['openai-compatible'],
  apiKey: '',
  temperature: 0.2,
  maxTokens: 1600,
  requestGapMs: 3000,
  maxRetries: 2,
  autoInject: true,
  autoSubmit: true,
  useAnswerCache: true,
  useTrustedInput: true,
  useTerminalPrelude: true,
  terminalPrelude: 'mysql -h127.0.0.1 -uroot -p123123',
  useSqlPrelude: true,
  sqlPrelude: 'CREATE DATABASE IF NOT EXISTS MyDb;\nUSE MyDb;',
}

export interface PublicSettings extends Omit<Settings, 'apiKey'> {
  hasApiKey: boolean
}

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback

const booleanOf = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

function normalize(raw: Partial<Settings> | undefined): Settings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) }
  const provider: ProviderId = merged.provider === 'ollama' ? 'ollama' : 'openai-compatible'
  return {
    provider,
    baseUrl: typeof merged.baseUrl === 'string' ? merged.baseUrl.trim() : DEFAULT_SETTINGS.baseUrl,
    apiKey: typeof merged.apiKey === 'string' ? merged.apiKey.trim() : '',
    model: typeof merged.model === 'string' ? merged.model.trim() : '',
    temperature: clamp(Number(merged.temperature), 0, 2, DEFAULT_SETTINGS.temperature),
    maxTokens: Math.round(clamp(Number(merged.maxTokens), 128, 8192, DEFAULT_SETTINGS.maxTokens)),
    requestGapMs: Math.round(clamp(Number(merged.requestGapMs), 0, 60_000, DEFAULT_SETTINGS.requestGapMs)),
    maxRetries: Math.round(clamp(Number(merged.maxRetries), 0, 3, DEFAULT_SETTINGS.maxRetries)),
    autoInject: booleanOf(merged.autoInject, DEFAULT_SETTINGS.autoInject),
    autoSubmit: booleanOf(merged.autoSubmit, DEFAULT_SETTINGS.autoSubmit),
    useAnswerCache: booleanOf(merged.useAnswerCache, DEFAULT_SETTINGS.useAnswerCache),
    useTrustedInput: booleanOf(merged.useTrustedInput, DEFAULT_SETTINGS.useTrustedInput),
    useTerminalPrelude: booleanOf(merged.useTerminalPrelude, DEFAULT_SETTINGS.useTerminalPrelude),
    terminalPrelude:
      typeof merged.terminalPrelude === 'string' ? merged.terminalPrelude.trim() : DEFAULT_SETTINGS.terminalPrelude,
    useSqlPrelude: booleanOf(merged.useSqlPrelude, DEFAULT_SETTINGS.useSqlPrelude),
    sqlPrelude: typeof merged.sqlPrelude === 'string' ? merged.sqlPrelude.trim() : DEFAULT_SETTINGS.sqlPrelude,
  }
}

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY)
  return normalize(stored[SETTINGS_KEY] as Partial<Settings> | undefined)
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings()
  const next = normalize({ ...current, ...patch })
  await chrome.storage.local.set({ [SETTINGS_KEY]: next })
  return next
}

/** 发给页面侧（content script）的版本：永远不含明文 key。 */
export function sanitizeSettings(settings: Settings): PublicSettings {
  const { apiKey, ...rest } = settings
  return { ...rest, hasApiKey: apiKey.length > 0 }
}
