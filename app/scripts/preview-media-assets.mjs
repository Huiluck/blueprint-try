// 预览专用 FFmpeg：从校验过的源码构建，不链接 Homebrew，不改用户安装的工具。
import {createHash, randomUUID} from 'node:crypto'
import {execFile} from 'node:child_process'
import {chmod, copyFile, mkdir, readFile, rename, rm, stat, writeFile} from 'node:fs/promises'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {promisify} from 'node:util'
const execute = promisify(execFile)
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const previewMediaSource = Object.freeze({
  version:'9.0.2', url:'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',
  sha256:'8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e',
})
export const previewMediaConfigure = Object.freeze([
  '--disable-autodetect','--disable-everything','--disable-network','--disable-avdevice',
  '--disable-doc','--disable-debug','--disable-programs','--enable-ffmpeg','--disable-shared','--enable-static','--enable-zlib',
  '--enable-protocol=file,pipe', '--enable-demuxer=mov,matroska,avi,mp3,wav,ogg,flac,aac,aiff,mpegps,mpegts',
  '--enable-parser=h264,hevc,mpeg4video,mpegvideo,vp8,vp9,aac,aac_latm,mpegaudio,flac,opus,vorbis',
  '--enable-decoder=h264,hevc,vp8,vp9,mpeg1video,mpeg2video,mpeg4,msmpeg4v2,msmpeg4v3,wmv1,wmv2,vc1,prores,mjpeg,png,rawvideo,aac,aac_fixed,aac_latm,mp3,mp3float,flac,vorbis,opus,alac,pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_s32be,pcm_f32le,pcm_f32be,pcm_f64le,pcm_f64be,pcm_u8,pcm_s8,pcm_mulaw,pcm_alaw,adpcm_ima_wav,adpcm_ms',
  '--enable-filter=buffer,buffersink,abuffer,abuffersink,format,aformat,thumbnail,scale,crop,setsar,atrim,showspectrumpic,aresample',
  '--enable-encoder=png','--enable-muxer=image2pipe',
  '--extra-cflags=-mmacosx-version-min=13.0','--extra-ldflags=-mmacosx-version-min=13.0',
])
const hash = value => createHash('sha256').update(value).digest('hex')
const recipeHash = hash(JSON.stringify(previewMediaConfigure))
export function assertSystemLibraries(output) {
  const libraries = output.split('\n').slice(1).map(line => line.trim().split(' (')[0]).filter(Boolean)
  if (libraries.some(path => !path.startsWith('/usr/lib/') && !path.startsWith('/System/Library/')))
    throw new Error('预览 FFmpeg 链接了非系统动态库，不能打包：' + libraries.join(', '))
}
export function assertMinimumMacOS(output) {
  const version = /\bminos\s+(\d+(?:\.\d+){0,2})/.exec(output)?.[1]
  if(!version || Number(version.split('.')[0]) > 13 || (Number(version.split('.')[0]) === 13 && Number(version.split('.')[1] || 0) > 0))
    throw new Error('预览 FFmpeg 的最低系统版本必须兼容 macOS 13：' + (version || '未识别'))
}
export async function inspectPreviewMedia(directory, {run = execute} = {}) {
  const manifest = JSON.parse(await readFile(join(directory,'media-assets-manifest.json'),'utf8'))
  if(manifest.version !== previewMediaSource.version || manifest.sourceSha256 !== previewMediaSource.sha256 || manifest.recipeSha256 !== recipeHash)
    throw new Error('预览 FFmpeg 的版本或构建参数不匹配')
  const executable = join(directory,'ffmpeg')
  if(hash(await readFile(executable)) !== manifest.binarySha256) throw new Error('预览 FFmpeg 校验失败')
  if(hash(await readFile(join(directory,'ffmpeg-source.tar.xz'))) !== previewMediaSource.sha256) throw new Error('预览 FFmpeg 源码校验失败')
  const options = {encoding:'utf8',timeout:10000,maxBuffer:4*1024*1024}
  const version = await run(executable,['-hide_banner','-version'],options)
  if(!version.stdout.startsWith('ffmpeg version '+previewMediaSource.version+' ')) throw new Error('预览 FFmpeg 无法确认版本')
  const filters = await run(executable,['-hide_banner','-filters'],options)
  for(const name of ['thumbnail','scale','crop','setsar','atrim','showspectrumpic'])
    if(!new RegExp('\\b'+name+'\\s').test(filters.stdout)) throw new Error('预览 FFmpeg 缺少滤镜：'+name)
  const deps = await run('/usr/bin/otool',['-L',executable],options)
  assertSystemLibraries(deps.stdout)
  const build = await run('/usr/bin/vtool',['-show-build',executable],options)
  assertMinimumMacOS(build.stdout)
  return {directory,executable,manifest}
}
async function downloadSource(url) {
  // curl 沿用开发机的标准代理设置；不要求 Node 的 fetch 自己读取 HTTPS_PROXY。
  const {stdout} = await execute('/usr/bin/curl',['--fail','--location','--silent','--show-error','--proto','=https','--max-time','120','--',url],
    {encoding:'buffer',timeout:125000,maxBuffer:64*1024*1024})
  return {ok:true,status:200,arrayBuffer:async()=>stdout}
}
export async function preparePreviewMedia({directory = join(appRoot,'.build/native-resources/media'), run = execute, download = downloadSource, log = console.log} = {}) {
  if(process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('预览 FFmpeg 构建仅支持 macOS Apple Silicon')
  const target = join(directory,`ffmpeg-${previewMediaSource.version}-arm64-${recipeHash.slice(0,12)}`)
  try {return await inspectPreviewMedia(target,{run})} catch {}
  await mkdir(directory,{recursive:true})
  const archive = join(directory,`ffmpeg-${previewMediaSource.version}.tar.xz`)
  let body = await readFile(archive).catch(()=>null)
  if(!body || hash(body) !== previewMediaSource.sha256) {
    log('下载固定版本的预览 FFmpeg 源码')
    const response = await download(previewMediaSource.url,{signal:AbortSignal.timeout(120000)})
    if(!response.ok) throw new Error('FFmpeg 源码下载失败：HTTP '+response.status)
    body = Buffer.from(await response.arrayBuffer())
    if(hash(body) !== previewMediaSource.sha256) throw new Error('FFmpeg 源码校验失败，不执行构建')
    await writeFile(archive,body)
  }
  const temporary = join(directory,`.预览FFmpeg构建-${randomUUID()}`), source = join(temporary,'source'), output = join(temporary,'output')
  try {
    await mkdir(source,{recursive:true}); await mkdir(output)
    await run('/usr/bin/tar',['-xJf',archive,'-C',source,'--strip-components=1'],{timeout:30000})
    log('配置独立预览 FFmpeg（只启用解码、抽帧和频谱）')
    await run(join(source,'configure'),previewMediaConfigure,{cwd:source,timeout:120000,maxBuffer:16*1024*1024})
    log('编译独立预览 FFmpeg（两个编译进程）')
    await run('/usr/bin/make',['-j2','ffmpeg'],{cwd:source,timeout:900000,maxBuffer:32*1024*1024})
    await copyFile(join(source,'ffmpeg'),join(output,'ffmpeg')); await chmod(join(output,'ffmpeg'),0o755)
    await run('/usr/bin/strip',['-x',join(output,'ffmpeg')],{timeout:30000})
    await run('/usr/bin/codesign',['--force','--sign','-',join(output,'ffmpeg')],{timeout:30000})
    await copyFile(archive,join(output,'ffmpeg-source.tar.xz'))
    await copyFile(join(source,'COPYING.LGPLv2.1'),join(output,'COPYING.LGPLv2.1'))
    await copyFile(join(source,'LICENSE.md'),join(output,'FFmpeg-LICENSE.md'))
    const manifest = {version:previewMediaSource.version,sourceUrl:previewMediaSource.url,sourceSha256:previewMediaSource.sha256,
      recipeSha256:recipeHash,configure:[...previewMediaConfigure],platform:process.platform,arch:process.arch,
      minimumMacOS:'13.0',license:'LGPL-2.1-or-later',binarySha256:hash(await readFile(join(output,'ffmpeg')))}
    await writeFile(join(output,'media-assets-manifest.json'),JSON.stringify(manifest,null,2)+'\n')
    await inspectPreviewMedia(output,{run})
    // 旧资源只在新构建完整且验证通过以后替换；不触碰正在使用的 runtime。
    const backup = target+'-上次资源-'+randomUUID()
    const existed = await stat(target).then(()=>true,()=>false)
    if(existed) await rename(target,backup)
    try {await rename(output,target)} catch(error) {if(existed) await rename(backup,target);throw error}
    if(existed) await rm(backup,{recursive:true,force:true})
    return {directory:target,executable:join(target,'ffmpeg'),manifest}
  } finally {await rm(temporary,{recursive:true,force:true})}
}
if(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  preparePreviewMedia().then(value=>console.log(JSON.stringify({executable:value.executable,version:value.manifest.version})))
    .catch(error=>{console.error(error.message);process.exitCode=1})
}
