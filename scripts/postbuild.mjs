/**
 * 构建后处理：把 crxjs 输出的 src/ 镜像目录拍平。
 *
 * 原因：manifest 里的资源路径是相对源码目录的（src/options/index.html、src/icons/*.png、
 * src/content/frame/probe.iife.js），打包进发布 zip 后会出现一个"第二个 src"，看起来像源码被重复打包。
 * 这里把这三处移到 dist 根下的语义目录，并同步改写 manifest，zip 里就只剩构建产物。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const dist = join(process.cwd(), 'dist')
if (!existsSync(dist)) {
  console.error('[postbuild] 找不到 dist，请先执行 vite build')
  process.exit(1)
}

function move(from, to) {
  if (!existsSync(from)) return
  mkdirSync(dirname(to), { recursive: true })
  rmSync(to, { recursive: true, force: true })
  renameSync(from, to)
  console.log(`[postbuild] ${from.replace(dist, 'dist')} -> ${to.replace(dist, 'dist')}`)
}

move(join(dist, 'src', 'icons'), join(dist, 'icons'))
move(join(dist, 'src', 'options'), join(dist, 'options'))
move(join(dist, 'src', 'content', 'frame', 'probe.iife.js'), join(dist, 'probe.iife.js'))
rmSync(join(dist, 'src'), { recursive: true, force: true })

const manifestPath = join(dist, 'manifest.json')
const raw = readFileSync(manifestPath, 'utf8')
const patched = raw
  .replaceAll('"src/icons/', '"icons/')
  .replaceAll('"src/options/', '"options/')
  .replaceAll('"src/content/frame/probe.iife.js"', '"probe.iife.js"')

if (patched === raw) {
  console.log('[postbuild] manifest 无需改写')
} else {
  writeFileSync(manifestPath, patched, 'utf8')
  console.log('[postbuild] manifest 路径已改写')
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const required = [
  manifest.options_ui?.page,
  ...(manifest.icons ? Object.values(manifest.icons) : []),
  ...(manifest.content_scripts ?? []).flatMap((script) => script.js ?? []),
].filter((value) => typeof value === 'string')

const missing = required.filter((path) => !existsSync(join(dist, path)))
if (missing.length > 0) {
  console.error(`[postbuild] manifest 引用的文件不存在：${missing.join(', ')}`)
  process.exit(1)
}
console.log(`[postbuild] 结构校验通过（${required.length} 项引用）`)
