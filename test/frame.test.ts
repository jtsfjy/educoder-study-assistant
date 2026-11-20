import assert from 'node:assert/strict'
import test from 'node:test'
import { FRAME_CHANNEL, isFrameRequest, makeReply, makeRequest } from '../src/shared/frame.ts'

test('write 请求必须带字符串 code', () => {
  assert.equal(isFrameRequest(makeRequest('id1', 'write', 'int main(){}')), true)
  assert.equal(isFrameRequest({ channel: FRAME_CHANNEL, dir: 'req', id: 'id1', op: 'write' }), false)
  assert.equal(isFrameRequest({ channel: FRAME_CHANNEL, dir: 'req', id: 'id1', op: 'write', code: 1 }), false)
})

test('四种 op 互不串味', () => {
  for (const op of ['editor', 'submit', 'result', 'diagnose'] as const) {
    assert.equal(isFrameRequest(makeRequest('id1', op)), true)
  }
  assert.equal(isFrameRequest({ channel: FRAME_CHANNEL, dir: 'req', id: 'id1', op: 'delete' }), false)
  assert.equal(isFrameRequest({ channel: FRAME_CHANNEL, dir: 'res', id: 'id1', op: 'editor' }), false)
  assert.equal(isFrameRequest(null), false)
})

test('回包默认值为安全空态', () => {
  const reply = makeReply('id1', 'write')
  assert.equal(reply.ok, true)
  assert.equal(reply.kind, 'none')
  assert.equal(reply.code, '')
  assert.equal(reply.channel, FRAME_CHANNEL)
  assert.equal(reply.dir, 'res')
})
