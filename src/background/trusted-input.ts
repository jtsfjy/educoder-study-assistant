/**
 * 受信任输入：通过 CDP 往页面里打字。
 *
 * 为什么要这条路径：部分平台只认 isTrusted=true 的 input 事件
 * （粘贴被拦、execCommand 被视为不可信），实例 API 写进去也会被框架忽略。
 * Input.insertText 由浏览器输入管线产生，isTrusted=true，等同于真实键入。
 *
 * 这轮补的两件事：
 *  - selectAll：插入前先 Ctrl+A。OJ 型实训区里常带上一题的残留代码，
 *    不全选就插入会变成"旧代码 + 新代码"的拼接，评测读到的还是旧首行。
 *  - clearFirst：逐键模式先 Ctrl+A + Backspace 清空，再逐字符键入。
 *
 * 代价：附加调试器时 Chrome/Edge 顶部会出现"正在调试此浏览器"提示条，用完即 detach。
 */
export interface TrustedInputResult {
  ok: boolean
  error?: string
}

export interface TrustedInputOptions {
  pressEnter?: boolean
  mode?: 'insertText' | 'keys'
  /** insertText 前先 Ctrl+A：整篇替换，不吃残留代码。 */
  selectAll?: boolean
  /** keys 模式前先 Ctrl+A + Backspace：清空再逐键键入。 */
  clearFirst?: boolean
}

interface KeySpec {
  key: string
  code: string
  vk: number
  text?: string
}

function keySpec(char: string): KeySpec {
  if (char === '\n' || char === '\r') return { key: 'Enter', code: 'Enter', vk: 13, text: '\r' }
  if (char === ' ') return { key: ' ', code: 'Space', vk: 32, text: ' ' }
  if (/^[A-Za-z]$/.test(char)) {
    const upper = char.toUpperCase()
    return { key: char, code: `Key${upper}`, vk: upper.charCodeAt(0), text: char }
  }
  if (/^[0-9]$/.test(char)) return { key: char, code: `Digit${char}`, vk: char.charCodeAt(0), text: char }
  return { key: char, code: '', vk: 0, text: char }
}

function send(tabId: number, params: Record<string, unknown>): Promise<unknown> {
  return chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', params)
}

/** 逐键键入：部分终端只认 keydown，不认 insertText。 */
async function typeByKeys(tabId: number, code: string): Promise<void> {
  for (const char of code.replace(/\r\n/g, '\n')) {
    const spec = keySpec(char)
    await send(tabId, {
      type: 'keyDown',
      key: spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.vk,
      nativeVirtualKeyCode: spec.vk,
      ...(spec.text ? { text: spec.text, unmodifiedText: spec.text } : {}),
    })
    await send(tabId, {
      type: 'keyUp',
      key: spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.vk,
      nativeVirtualKeyCode: spec.vk,
    })
  }
}

async function pressEnter(tabId: number): Promise<void> {
  await send(tabId, {
    type: 'keyDown',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    key: 'Enter',
    code: 'Enter',
    text: '\r',
  })
  await send(tabId, {
    type: 'keyUp',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    key: 'Enter',
    code: 'Enter',
  })
}

/** Ctrl+A：浏览器级别全选，编辑器自己处理，不受 CSS user-select:none 影响。 */
async function selectAll(tabId: number): Promise<void> {
  const control = {
    key: 'Control',
    code: 'ControlLeft',
    windowsVirtualKeyCode: 17,
    nativeVirtualKeyCode: 17,
    modifiers: 2,
  }
  const aKey = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 }
  await send(tabId, { type: 'rawKeyDown', ...control })
  await send(tabId, { type: 'rawKeyDown', ...aKey })
  await send(tabId, { type: 'keyUp', ...aKey })
  await send(tabId, { type: 'keyUp', ...control, modifiers: 0 })
}

async function pressBackspace(tabId: number): Promise<void> {
  const spec = { key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8 }
  await send(tabId, { type: 'keyDown', ...spec })
  await send(tabId, { type: 'keyUp', ...spec })
}

/**
 * 真实鼠标点击（CDP，isTrusted=true）。
 *
 * 用途是把焦点真正放进编辑器：Monaco 的 1×1 输入框经常接不住 `focus()`，
 * 焦点留在 body 上时按 Ctrl+A 会选中整页，而不是编辑器内容。
 */
export async function clickAt(tabId: number, x: number, y: number): Promise<TrustedInputResult> {
  try {
    await chrome.debugger.attach({ tabId }, '1.3')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `无法附加调试器（${message}）：可能已有其它调试器连接，或扩展没有 debugger 权限。` }
  }

  try {
    const point = { x, y, button: 'left' as const, clickCount: 1 }
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...point })
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...point })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `真实点击失败（${message}）` }
  } finally {
    try {
      await chrome.debugger.detach({ tabId })
    } catch {
      // 已经断开，忽略。
    }
  }
}

export async function insertTrustedText(
  tabId: number,
  code: string,
  options: TrustedInputOptions = {},
): Promise<TrustedInputResult> {
  try {
    await chrome.debugger.attach({ tabId }, '1.3')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      error: `无法附加调试器（${message}）：可能已有其它调试器连接，或扩展没有 debugger 权限。`,
    }
  }

  try {
    if (options.mode === 'keys') {
      if (options.clearFirst) {
        await selectAll(tabId)
        await pressBackspace(tabId)
      }
      await typeByKeys(tabId, code)
    } else {
      // 光标已由 content 侧的 focus 操作置为"全选"，这里直接插入即整篇替换；
      // selectAll 再用浏览器级 Ctrl+A 兜一次，防止 content 侧的选区被页面清掉。
      if (options.selectAll) await selectAll(tabId)
      await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: code })
    }
    if (options.pressEnter) await pressEnter(tabId)
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `受信任输入失败（${message}）` }
  } finally {
    try {
      await chrome.debugger.detach({ tabId })
    } catch {
      // 已经断开，忽略。
    }
  }
}
