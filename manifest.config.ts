import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: '头歌学习助手',
  version: '0.3.2',
  /** Chrome 清单只接受数字版本；展示用 beta 标签走 version_name（扩展页与面板都会显示它）。 */
  version_name: 'beta 0.3.2',
  description: '头歌（Educoder）实训题面抽取、代码生成、写入编辑器与自动评测闭环。',
  icons: {
    16: 'src/icons/icon16.png',
    32: 'src/icons/icon32.png',
    48: 'src/icons/icon48.png',
    128: 'src/icons/icon128.png',
  },
  action: {
    default_title: '头歌学习助手 · 打开设置',
    default_icon: {
      16: 'src/icons/icon16.png',
      32: 'src/icons/icon32.png',
    },
  },
  options_ui: {
    page: 'src/options/index.html',
    open_in_tab: true,
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  permissions: ['storage', 'debugger'],
  /**
   * 自定义模型网关：用户可以在设置页点击授权任意 https/http 域名。
   * 没有这一步，service worker 的 fetch 只会得到 Failed to fetch。
   */
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  // 只放模型网关地址；换供应商时在选项页改 baseUrl，并把域名加到这里。
  host_permissions: [
    'https://api.openai.com/*',
    'https://api.deepseek.com/*',
    'https://api.moonshot.cn/*',
    'https://open.bigmodel.cn/*',
    'https://openrouter.ai/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ],
  content_scripts: [
    {
      matches: [
        'https://*.educoder.net/classrooms/*',
        'https://*.educoder.net/tasks/*',
        'https://*.educoder.com/classrooms/*',
        'https://*.educoder.com/tasks/*',
      ],
      js: ['src/content/top/index.ts'],
      run_at: 'document_idle',
    },
    {
      matches: ['https://*.educoder.net/*', 'https://*.educoder.com/*'],
      js: ['src/content/frame/probe.iife.ts'],
      all_frames: true,
      match_about_blank: true,
      run_at: 'document_idle',
      // 编辑器实例挂在页面主世界的 DOM expando 上（.CodeMirror / .cmView），
      // 隔离世界读写不到，所以探针必须跑在 MAIN world；它不使用任何 chrome.* API。
      // 文件名带 .iife 是 crxjs 的约定：打成自包含 IIFE，避免 MAIN world 里
      // 再走 ESM 动态 import（页面 CSP 可能拦掉 chrome-extension: 的模块加载）。
      world: 'MAIN',
    },
  ],
  minimum_chrome_version: '114',
})
