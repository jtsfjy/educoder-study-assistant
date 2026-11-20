/**
 * 消息来源判定：区分"扩展自身页面"与"网页里的 content script"。
 *
 * 不能用 sender.tab 判断——Chrome 对在标签页里打开的扩展页面（设置页就是）
 * 同样会带 sender.tab，上一版因此把设置页误判成 content script，保存被挡下。
 * 唯一可靠判据是 origin/url 是否落在本扩展的 chrome-extension:// 前缀里。
 */
export interface SenderLike {
  id?: string
  origin?: string
  url?: string
  tab?: unknown
}

export function isExtensionContext(sender: SenderLike, runtimeId: string, extensionPrefix: string): boolean {
  if (sender.id !== runtimeId) return false
  const origin = sender.origin ?? ''
  const url = sender.url ?? ''
  return origin.startsWith(extensionPrefix) || url.startsWith(extensionPrefix)
}
