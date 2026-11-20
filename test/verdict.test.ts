import assert from 'node:assert/strict'
import test from 'node:test'
import { classifyVerdict, normalizeCode, normalizeForCompare } from '../src/shared/verdict.ts'

test('classifyVerdict 识别通过、错误、编译、运行、限流、进行中', () => {
  assert.equal(classifyVerdict('恭喜，全部测试点通过'), 'passed')
  assert.equal(classifyVerdict('答案错误：期望 3，得到 4'), 'wrong_answer')
  assert.equal(classifyVerdict('编译错误：expected ; before }'), 'compile_error')
  assert.equal(classifyVerdict('运行错误：Segmentation fault'), 'runtime_error')
  assert.equal(classifyVerdict('评测过于频繁，请稍后再试'), 'rate_limited')
  assert.equal(classifyVerdict('评测中，请稍候'), 'running')
  assert.equal(classifyVerdict(''), 'unknown')
  assert.equal(classifyVerdict('这是一段没有结论的文本'), 'unknown')
})

test('"未通过/部分通过"不能被当成通过', () => {
  assert.equal(classifyVerdict('未通过（1/3 个测试点）'), 'wrong_answer')
  assert.equal(classifyVerdict('部分通过：2/5'), 'wrong_answer')
  assert.equal(classifyVerdict('Wrong Answer on test 3'), 'wrong_answer')
})

test('normalizeCode 去掉 markdown 围栏，保留正文', () => {
  assert.equal(normalizeCode('```cpp\nint main() { return 0; }\n```'), 'int main() { return 0; }')
  assert.equal(normalizeCode('```python\nprint(1)\n'), 'print(1)')
  assert.equal(normalizeCode('int main(){}'), 'int main(){}')
  assert.equal(normalizeCode('\uFEFFint x;  \n'), 'int x;')
})

test('normalizeForCompare 忽略 CRLF 与行尾空白', () => {
  assert.equal(normalizeForCompare('a\r\nb  \r\n'), normalizeForCompare('a\nb\n'))
  assert.notEqual(normalizeForCompare('a\nb'), normalizeForCompare('a\nc'))
})
