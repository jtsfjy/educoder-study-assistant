import { Orchestrator } from './orchestrator.ts'
import { Panel } from './panel.ts'

/**
 * 顶层页面入口：编排题面抽取、生成、注入与点评测。
 * 页面写入 / 点击只发生在实训区 iframe 内，由 src/content/frame/probe.ts（MAIN world）执行。
 */
function bootstrap(): void {
  if (window.top !== window) return
  if (document.getElementById('educoder-study-assistant-host')) return

  let orchestrator: Orchestrator | null = null

  const panel = new Panel({
    onSolve: () => void orchestrator?.solve(),
    onExplain: () => void orchestrator?.explain(),
    onReview: () => void orchestrator?.review(),
    onRefresh: () => void orchestrator?.refreshNow(),
    onSelfCheck: () => void orchestrator?.selfCheck(),
    onSettings: () => {
      void chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => undefined)
    },
  })

  panel.mount()
  orchestrator = new Orchestrator(panel)
  window.addEventListener('pagehide', () => orchestrator?.dispose(), { once: true })
  orchestrator.start()
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true })
} else {
  bootstrap()
}
