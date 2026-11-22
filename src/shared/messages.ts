import type { Problem, Settings } from './types.ts'

export type BackgroundRequest =
  | { type: 'settings:get' }
  | { type: 'settings:save'; settings: Partial<Settings> }
  | { type: 'settings:clear-key' }
  | { type: 'llm:ping' }
  | { type: 'llm:explain'; problem: Problem }
  | { type: 'llm:review'; problem: Problem; code: string }
  | { type: 'llm:generate'; problem: Problem; previous?: { code: string; result: string } }
  | { type: 'answer:get'; problem: Problem }
  | { type: 'answer:put'; problem: Problem; code: string }
  | { type: 'answer:drop'; problem: Problem }
  | { type: 'answer:stats' }
  | { type: 'answer:clear' }
  | {
      type: 'inject:trusted'
      code: string
      pressEnter?: boolean
      mode?: 'insertText' | 'keys'
      /** 插入前 Ctrl+A：整篇替换，不吃编辑器里的残留代码。 */
      selectAll?: boolean
      /** 逐键模式前 Ctrl+A + Backspace 清空。 */
      clearFirst?: boolean
    }
  | { type: 'inject:click'; x: number; y: number }
  | { type: 'open-options' }

export type BackgroundResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export const ERROR_CODES = {
  NO_API_KEY: 'NO_API_KEY',
  NO_HOST_PERMISSION: 'NO_HOST_PERMISSION',
  NETWORK_ERROR: 'NETWORK_ERROR',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  BAD_REQUEST: 'BAD_REQUEST',
  UNKNOWN: 'UNKNOWN',
} as const

export function fail(code: string, message: string): BackgroundResponse<never> {
  return { ok: false, error: { code, message } }
}
