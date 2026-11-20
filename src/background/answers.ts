import {
  ANSWERS_KEY,
  answerKey,
  isStale,
  makeRecord,
  trimAnswers,
  type AnswerMap,
  type AnswerRecord,
} from '../shared/answers.ts'
import type { Problem } from '../shared/types.ts'

/** 串行化读改写，避免并发 solve 把 Map 写丢。 */
let chain: Promise<unknown> = Promise.resolve()

function withLock<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task)
  chain = next.catch(() => undefined)
  return next
}

async function readMap(): Promise<AnswerMap> {
  const stored = await chrome.storage.local.get(ANSWERS_KEY)
  const value = stored[ANSWERS_KEY]
  return value && typeof value === 'object' ? (value as AnswerMap) : {}
}

export async function getAnswer(problem: Problem): Promise<AnswerRecord | null> {
  return withLock(async () => {
    const map = await readMap()
    const key = answerKey(problem)
    const record = map[key]
    if (!record || !record.code?.trim()) return null
    if (isStale(record, Date.now())) {
      delete map[key]
      await chrome.storage.local.set({ [ANSWERS_KEY]: map })
      return null
    }
    record.hits += 1
    record.updatedAt = Date.now()
    map[key] = record
    await chrome.storage.local.set({ [ANSWERS_KEY]: map })
    return record
  })
}

export async function putAnswer(problem: Problem, code: string): Promise<AnswerRecord> {
  return withLock(async () => {
    const map = await readMap()
    const record = makeRecord(problem, code)
    const previous = map[record.key]
    if (previous) record.hits = previous.hits
    map[record.key] = record
    await chrome.storage.local.set({ [ANSWERS_KEY]: trimAnswers(map) })
    return record
  })
}

export async function dropAnswer(problem: Problem): Promise<void> {
  await withLock(async () => {
    const map = await readMap()
    delete map[answerKey(problem)]
    await chrome.storage.local.set({ [ANSWERS_KEY]: map })
  })
}

export async function answerStats(): Promise<{ count: number }> {
  const map = await readMap()
  return { count: Object.keys(map).length }
}

export async function clearAnswers(): Promise<void> {
  await withLock(async () => {
    await chrome.storage.local.remove(ANSWERS_KEY)
  })
}
