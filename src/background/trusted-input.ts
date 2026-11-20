/**
 * 受信任输入：通过 CDP 的 Input.insertText 往页面里打字。
 *
 * 为什么要这条路径：部分平台只认 isTrusted=true 的 input 事件
 * （粘贴被拦、execCommand 被视为不可信），实例 API 写进去也会被框架忽略。
 * Input.insertText 由浏览器输入管线产生，isTrusted=true，等同于真实键入。
 *
 * 代价：附加调试器时 Chrome/Edge 顶部会出现"正在调试此浏览器"提示条，用完即 detach。
 */
export interface TrustedInputResult {
  ok: boolean
  error?: string
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

/** 逐键键入：部分终端只认 keydown，不认 insertText。 */
async function typeByKeys(tabId: number, code: string): Promise<void> {
  for (const char of code.replace(/\r\n/g, '\n')) {
    const spec = keySpec(char)
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.vk,
      nativeVirtualKeyCode: spec.vk,
      ...(spec.text ? { text: spec.text, unmodifiedText: spec.text } : {}),
    })
    await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: spec.key,
      code: spec.code,
      windowsVirtualKeyCode: spec.vk,
      nativeVirtualKeyCode: spec.vk,
    })
  }
}

async function pressEnter(tabId: number): Promise<void> {
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    key: 'Enter',
    code: 'Enter',
    text: '\r',
  })
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    windowsVirtualKeyCode: 13,
    nativeVirtualKeyCode: 13,
    key: 'Enter',
    code: 'Enter',
  })
}

export async function insertTrustedText(
  tabId: number,
  code: string,
  pressEnterAfter = false,
  mode: 'insertText' | 'keys' = 'insertText',
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
    if (mode === 'keys') {
      await typeByKeys(tabId, code)
    } else {
      // 光标位置已由 content 侧的 focus 操作置为"全选"，这里直接插入即整篇替换。
      await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: code })
    }
    if (pressEnterAfter) await pressEnter(tabId)
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
