// 安装窗口背景：用随 App 准备的无头浏览器把 installer/dmg-background.html 截成 1x 和 2x 两张 PNG。
// electron-builder 见到同名 @2x 会合成高清背景；窗口大小取 1x 图的像素。改了背景文字后手动跑一次，产物随源码提交。
import { execFileSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const browserRoot = join(appRoot, '.build/native-resources/browser')
const shell = (await readdir(browserRoot).catch(() => [])).filter(name => name.startsWith('chromium_headless_shell-'))
  .map(name => join(browserRoot, name, `chrome-headless-shell-mac-${process.arch}`, 'chrome-headless-shell'))[0]
if (!shell) throw new Error('没有找到无头浏览器，请先运行 npm --prefix app run prepare:runtime。')
const page = pathToFileURL(join(appRoot, 'installer/dmg-background.html')).href
for (const [scale, name] of [[1, 'dmg-background.png'], [2, 'dmg-background@2x.png']]) {
  execFileSync(shell, ['--headless', '--hide-scrollbars', '--window-size=680,500', `--force-device-scale-factor=${scale}`,
    `--screenshot=${join(appRoot, 'installer', name)}`, page], { stdio: 'pipe' })
  console.log(`已生成 installer/${name}`)
}
