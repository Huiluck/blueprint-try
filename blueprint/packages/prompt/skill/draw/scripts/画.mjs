#!/usr/bin/env node
/**
 * 画一张图：按文字描述让硅基流动的画图模型画一张，存进项目。
 *
 *   node 画.mjs "<画面描述>" <存到哪，比如 "$BLUEPRINT_PROJECT_ROOT/素材/背景/夜色.png"> [--尺寸 1280x1280]
 *
 * 只吃文字：给不了参考图，也不能在上一张的基础上改 —— 那头的接口就只有描述和尺寸两格，改图＝重画一次。
 * 钥匙 SILICONFLOW_API_KEY、模型 SILICONFLOW_IMAGE_MODEL（不给＝Tongyi-MAI/Z-Image-Turbo）走环境变量；
 * 环境里没有钥匙，就去 ~/.zshrc 里捞那一行。0.1 元一张，五六秒。
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'

const 根 = process.env.SILICONFLOW_BASE_URL || 'https://api.siliconflow.cn/v1'
const 最多等 = 120_000
/** 撞上限流等几次、各等多久（毫秒）：免费那档真会撞，一次 429 不算错。 */
const 撞墙再试 = [1500, 4000]
const 图的后缀 = ['.png', '.jpg', '.jpeg', '.webp']

async function 钥匙() {
  let k = (process.env.SILICONFLOW_API_KEY || '').trim()
  if (!k) {
    try {
      const m = (await readFile(join(homedir(), '.zshrc'), 'utf8')).match(/^export SILICONFLOW_API_KEY=["']?([^"'\n]*)["']?\s*$/m)
      k = m ? m[1].trim() : ''
    } catch { /* 没有 .zshrc */ }
  }
  if (!k) throw new Error('这台机器上没有 SILICONFLOW_API_KEY —— 这是缺件，不是你写错了。告诉用户：在 ~/.zshrc 里加一行 export SILICONFLOW_API_KEY=他的key。')
  return k
}

/** 让那头画一张，拿回图的地址。连不上和被拒了分开说：一种等等能好，一种等多久都不会好。 */
async function 画一张(描述, 尺寸) {
  const k = await 钥匙()
  const 模型 = process.env.SILICONFLOW_IMAGE_MODEL || 'Tongyi-MAI/Z-Image-Turbo'
  for (let 第几次 = 0; ; 第几次++) {
    let r
    try {
      r = await fetch(`${根}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k}` },
        body: JSON.stringify({ model: 模型, prompt: 描述, image_size: 尺寸 }),
        signal: AbortSignal.timeout(最多等),
      })
    } catch (e) {
      throw new Error(`连不上硅基流动（${(e && e.message) || e}）—— 网络这一层的事，不是你写错了。`)
    }
    const 文 = await r.text()
    if (r.ok) {
      let 回
      try { 回 = JSON.parse(文) } catch { throw new Error(`硅基流动回的不是 JSON：${文.slice(0, 300)}`) }
      const 一张 = ((回 && (回.images || 回.data)) || [])[0]
      if (!一张 || !一张.url) throw new Error(`硅基流动收下了却没给回图：${文.slice(0, 300)}`)
      return 一张.url
    }
    if (r.status === 429 && 第几次 < 撞墙再试.length) {
      await new Promise((好) => setTimeout(好, 撞墙再试[第几次]))
      continue
    }
    throw new Error(r.status === 429
      ? `硅基流动那头挤（429），等了 ${撞墙再试.length} 回还是没排上 —— 过一会儿再来。原话：${文.slice(0, 300)}`
      : `硅基流动回了 ${r.status}：${文.slice(0, 500)}`)
  }
}

async function 主() {
  const 参 = process.argv.slice(2)
  let 尺寸 = '1280x1280'
  const 余 = []
  for (let i = 0; i < 参.length; i++) {
    if (参[i] === '--尺寸' || 参[i] === '--size') 尺寸 = String(参[++i] || 尺寸)
    else 余.push(参[i])
  }
  const [描述, 位置] = 余
  if (!描述 || !位置) throw new Error('用法：node 画.mjs "画面描述" "$BLUEPRINT_PROJECT_ROOT/素材/背景/夜色.png" [--尺寸 1280x1280]')
  if (!图的后缀.includes(extname(位置).toLowerCase())) throw new Error(`存的位置要以图片后缀结尾（${图的后缀.join('／')}），你给的是 ${位置}`)

  const 网址 = await 画一张(描述, 尺寸)
  /* 那条地址会过期：当场搬回来落地。 */
  let 图
  try {
    const 下 = await fetch(网址, { signal: AbortSignal.timeout(最多等) })
    if (!下.ok) throw new Error(`取图回了 ${下.status}`)
    图 = Buffer.from(await 下.arrayBuffer())
  } catch (e) {
    throw new Error(`画出来了但没搬回来（${(e && e.message) || e}）—— 那条地址会过期，重画一次。`)
  }
  const 绝对 = resolve(位置)
  await mkdir(dirname(绝对), { recursive: true })
  await writeFile(绝对, 图)
  console.log(`画好了 · ${位置} · ${尺寸}（${Math.round(图.length / 1024)} KB）\n用 read_image 按实际用途检查效果。每次重画都花用户的钱，按 draw skill 先想清楚修正，再调用。`)
}

主().catch((e) => { console.error(String((e && e.message) || e)); process.exit(1) })
