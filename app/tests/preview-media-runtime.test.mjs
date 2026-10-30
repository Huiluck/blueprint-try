import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {preparePreviewFFmpeg} from '../runtime/media-preview.mjs'
import {assertSystemLibraries,assertMinimumMacOS,previewMediaConfigure} from '../scripts/preview-media-assets.mjs'

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'Blueprint独立预览组件核验-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  await mkdir(join(root,'native-resources/media'),{recursive:true})
  return root
}
test('预览组件只允许系统动态库，不接受任何 Homebrew 或用户目录依赖',()=>{
  assert.doesNotThrow(()=>assertSystemLibraries('ffmpeg:\n\t/usr/lib/libSystem.B.dylib (compatibility version 1)\n\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 1)'))
  for(const path of ['/opt/homebrew/opt/x265/lib/libx265.215.dylib','/usr/local/lib/libx265.dylib','@rpath/libavcodec.dylib'])
    assert.throws(()=>assertSystemLibraries('ffmpeg:\n\t'+path+' (compatibility version 1)'),/非系统动态库/)
  assert.ok(previewMediaConfigure.includes('--disable-autodetect'))
  assert.ok(previewMediaConfigure.includes('--disable-network'))
  assert.ok(!previewMediaConfigure.some(x=>/enable-(gpl|nonfree|libx265)/.test(x)))
})
test('桌面预览在 Homebrew 不可用时仍使用自己的可执行文件，并验证实际启动结果',async t=>{
  const root=await fixture(t),exe=join(root,'native-resources/media/ffmpeg'),calls=[]
  await writeFile(join(root,'runtime-manifest.json'),JSON.stringify({previewMedia:{version:'9.0.2'}}))
  await writeFile(exe,'fixture')
  const value=await preparePreviewFFmpeg(root,{run:async(file,args)=>{calls.push({file,args});return{stdout:'ffmpeg version 9.0.2 Copyright\n'}}})
  assert.equal(value,exe);assert.deepEqual(calls,[{file:exe,args:['-hide_banner','-version']}])
  const warnings = [], warn = message => warnings.push(message)
  assert.equal(await preparePreviewFFmpeg(root,{warn,run:async()=>{throw new Error('动态库缺失')}}),exe)
  assert.match(warnings.at(-1),/组件无法启动.*动态库缺失/)
  assert.equal(await preparePreviewFFmpeg(root,{warn,run:async()=>({stdout:'ffmpeg version unknown'})}),exe)
  assert.match(warnings.at(-1),/版本不匹配/)
  await rm(exe)
  assert.equal(await preparePreviewFFmpeg(root,{warn}),exe,'组件异常不能阻断节点，也不回退到 Homebrew')
  assert.match(warnings.at(-1),/组件无法启动/)
})
test('未声明组件的旧运行包和开发目录不被新启动检查阻断',async t=>{
  const root=await fixture(t)
  assert.equal(await preparePreviewFFmpeg(root),null)
  await writeFile(join(root,'runtime-manifest.json'),'{}')
  assert.equal(await preparePreviewFFmpeg(root),null)
})


test('预览组件兼容 macOS 13，不把构建机器的系统版本带给用户',()=>{
  assert.doesNotThrow(()=>assertMinimumMacOS('platform MACOS\n    minos 13.0\n      sdk 26.2'))
  assert.throws(()=>assertMinimumMacOS('platform MACOS\n    minos 26.0\n      sdk 26.2'),/兼容 macOS 13/)
  assert.throws(()=>assertMinimumMacOS('未识别的构建结果'),/未识别/)
  assert.ok(previewMediaConfigure.includes('--extra-cflags=-mmacosx-version-min=13.0'))
  assert.ok(previewMediaConfigure.includes('--extra-ldflags=-mmacosx-version-min=13.0'))
})
