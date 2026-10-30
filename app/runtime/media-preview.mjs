// 安装包的预览工具只从自己的资源中取得；Homebrew 变化不影响它。
import {execFile} from 'node:child_process'
import {readFile, stat} from 'node:fs/promises'
import {join} from 'node:path'
import {promisify} from 'node:util'
const execute = promisify(execFile)
export async function preparePreviewFFmpeg(resourceRoot, {run = execute, warn = message => console.error(message)} = {}) {
  let manifest
  try {manifest = JSON.parse(await readFile(join(resourceRoot,'runtime-manifest.json'),'utf8'))}
  catch(error) {if(error.code === 'ENOENT') return null;throw error}
  // 开发目录与旧运行包未声明组件时保留原有来源。
  if(!manifest.previewMedia) return null
  const executable = join(resourceRoot,'native-resources/media/ffmpeg')
  try {
    if(!(await stat(executable)).isFile()) throw new Error('缺少可执行文件')
    const {stdout} = await run(executable,['-hide_banner','-version'],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024})
    if(!stdout.startsWith('ffmpeg version '+manifest.previewMedia.version+' ')) throw new Error('版本不匹配')
  } catch(error) {
    // 媒体组件异常只影响预览，不阻断 App 和节点；也不悄悄回退到用户的 Homebrew。
    warn('应用内置的音视频预览组件无法启动，请重新安装 Blueprint：'+error.message)
  }
  return executable
}
