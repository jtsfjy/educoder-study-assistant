import type { Problem } from './types.ts'

/**
 * 答案库：按题目指纹缓存"已经评测通过"的代码。
 * 纯数据结构 + 纯函数，读写落在 background（content script 读不到 storage.local）。
 */
export interface AnswerRecord {
  key: string
  fingerprint: string
  language: string
  code: string
  verdict: 'passed'
  updatedAt: number
  hits: number
}

export type AnswerMap = Record<string, AnswerRecord>

export const ANSWERS_KEY = 'answers'
export const MAX_ANSWERS = 200

export function answerKey(problem: Pick<Problem, 'fingerprint' | 'language'>): string {
  return `${problem.fingerprint}:${problem.language}`
}

export function makeRecord(problem: Problem, code: string, now: number = Date.now()): AnswerRecord {
  return {
    key: answerKey(problem),
    fingerprint: problem.fingerprint,
    language: problem.language,
    code,
    verdict: 'passed',
    updatedAt: now,
    hits: 0,
  }
}

/** 超出容量时按最近使用时间裁掉最旧的，纯函数便于单测。 */
export function trimAnswers(map: AnswerMap, max: number = MAX_ANSWERS): AnswerMap {
  const entries = Object.entries(map)
  if (entries.length <= max) return map
  const sorted = entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt)
  return Object.fromEntries(sorted.slice(0, max))
}

/** 题面变化会让指纹变，旧记录自然失效；这里给一个显式的过期判断（默认 30 天）。 */
export function isStale(record: AnswerRecord, now: number, ttlMs = 30 * 24 * 60 * 60 * 1000): boolean {
  return now - record.updatedAt > ttlMs
}
