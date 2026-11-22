import assert from 'node:assert/strict'
import test from 'node:test'
import { countLines, decideInject, renderContains, signatureLines } from '../src/shared/inject-check.ts'

const CODE = [
  '#include <stdio.h>',
  'int main() {',
  '  int a, b;',
  '  scanf("%d%d", &a, &b);',
  '  printf("%d\\n", a + b);',
  '  return 0;',
  '}',
].join('\n')

const OLD = ['int main() {', '  puts("old template");', '}'].join('\n')

test('隐藏实例：文档视角一致也不算写入成功', () => {
  const decision = decideInject(CODE, {
    kind: 'codemirror5',
    visible: false,
    docText: CODE,
    renderText: CODE,
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'editor-hidden')
})

test('没有编辑器', () => {
  const decision = decideInject(CODE, { kind: 'none', visible: true, docText: '', renderText: '' })
  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'no-editor')
})

test('文档不一致 = 编辑器没接受写入', () => {
  const decision = decideInject(CODE, {
    kind: 'codemirror5',
    visible: true,
    docText: 'int main() {}',
    renderText: 'int main() {}',
    beforeDoc: OLD,
    beforeRender: 'puts("old template")',
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'doc-mismatch')
})

test('文档一致 + 渲染命中特征行 = 通过', () => {
  const decision = decideInject(CODE, {
    kind: 'codemirror5',
    visible: true,
    docText: CODE,
    renderText: '#include <stdio.h>\nint main() {\n  int a, b;',
    beforeDoc: OLD,
    beforeRender: 'int main() {\n  puts("old template");',
  })
  assert.equal(decision.ok, true)
  assert.equal(decision.reason, 'verified')
})

test('文档变了但渲染没变 = 写进了看不见的实例', () => {
  const decision = decideInject(CODE, {
    kind: 'codemirror5',
    visible: true,
    docText: CODE,
    renderText: 'int main() {\nputs("old template");\n}',
    beforeDoc: OLD,
    beforeRender: 'int main() {\nputs("old template");\n}',
  })
  assert.equal(decision.ok, false)
  assert.equal(decision.reason, 'render-stale')
})

test('渲染随文档变化（特征行滚出视口）= 通过', () => {
  const decision = decideInject(CODE, {
    kind: 'monaco',
    visible: true,
    docText: CODE,
    renderText: '  printf("%d\\n", a + b);',
    beforeDoc: OLD,
    beforeRender: '  puts("old template");',
  })
  assert.equal(decision.ok, true)
  assert.equal(decision.reason, 'verified')
})

test('渲染文本读不到：代码控件判失败，终端以评测为准', () => {
  const blind = decideInject(CODE, { kind: 'ace', visible: true, docText: CODE, renderText: '' })
  assert.equal(blind.reason, 'render-blind')
  assert.equal(blind.ok, true, 'canvas 型编辑器只能靠可见性 + 文档视角')

  const textarea = decideInject(CODE, { kind: 'textarea', visible: true, docText: CODE, renderText: '' })
  assert.equal(textarea.ok, false, 'textarea 的渲染就是 value，读不到说明状态不一致')

  const terminal = decideInject(CODE, { kind: 'terminal', visible: true, docText: 'root@host:~#', renderText: '' })
  assert.equal(terminal.ok, true)
})

test('编辑库里本来就是这份代码 = noop 通过', () => {
  const decision = decideInject(CODE, {
    kind: 'contenteditable',
    visible: true,
    docText: CODE,
    renderText: 'int main() {\n  puts("old template");\n}',
    beforeDoc: CODE,
    beforeRender: 'int main() {\n  puts("old template");\n}',
  })
  assert.equal(decision.ok, true)
  assert.equal(decision.reason, 'noop')
})

test('读不到文档值的编辑器（模块化 Monaco）：按渲染文本判', () => {
  const verified = decideInject(CODE, {
    kind: 'monaco',
    visible: true,
    docText: '',
    docKnown: false,
    renderText: '  printf("%d\\n", a + b);',
  })
  assert.equal(verified.ok, true)
  assert.equal(verified.reason, 'verified')

  const stale = decideInject(CODE, {
    kind: 'monaco',
    visible: true,
    docText: '',
    docKnown: false,
    renderText: 'int main() {\n  puts("old template");\n}',
  })
  assert.equal(stale.ok, false)
  assert.equal(stale.reason, 'doc-mismatch')

  const blind = decideInject(CODE, {
    kind: 'monaco',
    visible: true,
    docText: '',
    docKnown: false,
    renderText: '',
  })
  assert.equal(blind.ok, false)
  assert.equal(blind.reason, 'render-blind')
})

test('renderContains 容忍缩进/换行差异与虚拟化截断', () => {
  assert.equal(renderContains('int main() {\n  scanf("%d%d", &a, &b);', CODE), true)
  assert.equal(renderContains('    printf("%d\\n",a+b);', CODE), true)
  assert.equal(renderContains('', CODE), false)
  assert.equal(renderContains('完全无关的屏幕文本', CODE), false)
})

test('signatureLines 取首、中、末行，且跳过没有辨识度的短行', () => {
  const lines = signatureLines(CODE)
  assert.equal(lines.length, 3)
  assert.equal(lines[0], '#include <stdio.h>')
  assert.ok(lines.includes('}') || lines.length > 0)
  assert.equal(signatureLines('')[0], undefined)
  assert.deepEqual(signatureLines('a\nb'), ['a', 'b'])
})

test('countLines 处理空串与 CRLF', () => {
  assert.equal(countLines(''), 0)
  assert.equal(countLines('a\r\nb\r\n'), 3)
  assert.equal(countLines(CODE), 7)
})
