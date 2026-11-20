import assert from 'node:assert/strict'
import test from 'node:test'
import { answerKey, isStale, makeRecord, trimAnswers, type AnswerMap } from '../src/shared/answers.ts'
import type { Problem } from '../src/shared/types.ts'

const baseProblem: Problem = {
  title: '两数之和',
  description: '给定两个整数，输出它们的和。',
  inputSpec: '一行两个整数',
  outputSpec: '一个整数',
  samples: [{ input: '1 2', output: '3' }],
  constraints: [],
  template: 'int main() { }',
  language: 'cpp',
  fingerprint: 'abc123',
  selectorVersion: '2026-11-20.1',
  sourceUrl: 'https://www.educoder.net/classrooms/x/shixun_homework/1',
  extractedAt: 0,
}

test('answerKey 由题目指纹与语言组成', () => {
  assert.equal(answerKey(baseProblem), 'abc123:cpp')
})

test('makeRecord 记录 passed 版本，hits 归零', () => {
  const record = makeRecord(baseProblem, 'int main(){}', 1000)
  assert.equal(record.key, 'abc123:cpp')
  assert.equal(record.fingerprint, 'abc123')
  assert.equal(record.verdict, 'passed')
  assert.equal(record.hits, 0)
  assert.equal(record.updatedAt, 1000)
})

test('trimAnswers 超容量时保留最近使用的前 N 条', () => {
  const map: AnswerMap = {}
  for (let index = 0; index < 5; index += 1) {
    const problem = { ...baseProblem, fingerprint: `f${index}` }
    map[answerKey(problem)] = makeRecord(problem, 'x', index * 10)
  }
  const trimmed = trimAnswers(map, 3)
  assert.deepEqual(Object.keys(trimmed).sort(), ['f2:cpp', 'f3:cpp', 'f4:cpp'])
})

test('未超容量时原样返回，不复制', () => {
  const map: AnswerMap = { 'abc123:cpp': makeRecord(baseProblem, 'x', 1) }
  assert.equal(trimAnswers(map, 3), map)
})

test('超过 30 天的记录判为过期', () => {
  const record = makeRecord(baseProblem, 'x', 0)
  assert.equal(isStale(record, 1000), false)
  assert.equal(isStale(record, 31 * 24 * 60 * 60 * 1000), true)
})
