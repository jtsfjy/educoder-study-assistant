import assert from 'node:assert/strict'
import test from 'node:test'
import { isExtensionContext } from '../src/shared/sender.ts'

const RUNTIME_ID = 'abcdefghijklmnop'
const PREFIX = `chrome-extension://${RUNTIME_ID}/`

test('设置页（标签页里打开的扩展页面）算扩展上下文', () => {
  const sender = {
    id: RUNTIME_ID,
    origin: `chrome-extension://${RUNTIME_ID}`,
    url: `${PREFIX}src/options/index.html`,
    tab: { id: 1 },
  }
  assert.equal(isExtensionContext(sender, RUNTIME_ID, PREFIX), true)
})

test('content script 不算扩展上下文，即使带 sender.tab', () => {
  const sender = {
    id: RUNTIME_ID,
    origin: 'https://www.educoder.net',
    url: 'https://www.educoder.net/classrooms/56wf72xh/shixun_homework/1685165',
    tab: { id: 1 },
  }
  assert.equal(isExtensionContext(sender, RUNTIME_ID, PREFIX), false)
})

test('别的扩展 id 一律不算', () => {
  const sender = {
    id: 'other-extension',
    origin: 'chrome-extension://other-extension',
    url: 'chrome-extension://other-extension/page.html',
  }
  assert.equal(isExtensionContext(sender, RUNTIME_ID, PREFIX), false)
})
