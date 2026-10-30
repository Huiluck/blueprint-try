/**
 * 每次搜索的候选存成一份带编号的候选单，放进临时目录：挑定以后 `取得.mjs --pick` 照编号取文件，
 * 来源、作者、许可由它写进来源记录，模型不必再抄。声音候选另出一张试听页，不下载就能听。
 */
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const 声音 = ['music', 'sfx', 'audio']

const 转义 = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** 能直接放进播放器的地址：先站点试听，再声音文件本身。 */
function 试听地址(x) {
  if (/^https:\/\//.test(x.试听 || '')) return x.试听
  const 文件 = (x.文件 || []).find(f => /^https:\/\//.test(f.网址 || ''))
  return 文件 ? 文件.网址 : ''
}

function 试听页(词, 行) {
  const 条 = 行.map(x => {
    const 秒 = Number.isFinite(x.秒) ? ` · ${Number(x.秒.toFixed(2))} 秒` : ''
    return `<li><b>${x.编号}. ${转义(x.名字)}</b> <small>${转义(x.来源)}${秒} · ${转义(x.作者 || '作者未知')} · ${转义(x.版权 || '版权未提供')}</small><br>
<audio controls preload="none" src="${转义(x.地址)}"></audio> <a href="${转义(x.页面)}" target="_blank" rel="noreferrer">页面</a></li>`
  }).join('\n')
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>试听：${转义(词)}</title>
<style>body{font:15px/1.5 -apple-system,sans-serif;max-width:760px;margin:24px auto;padding:0 16px}li{margin:14px 0}audio{width:100%;max-width:520px;vertical-align:middle}small{color:#666}</style>
<h1>试听：${转义(词)}</h1><p>编号和搜索结果一致；播放的是站点上的试听或文件地址，没有存到本机。</p>
<ol style="list-style:none;padding:0">
${条}
</ol></html>
`
}

/**
 * @param {{词:string, 结果:object[]}} r 搜索结果，编号＝下标＋1
 * @returns {{候选单:string, 试听页:string|null, 无试听:number[]}}
 */
export async function 存候选单(r) {
  const 目录 = await mkdtemp(join(tmpdir(), '素材候选-'))
  const 结果 = r.结果.map((x, i) => ({ 编号: i + 1, ...x }))
  const 候选单 = join(目录, '候选.json')
  await writeFile(候选单, JSON.stringify({ 词: r.词, 搜索时间: new Date().toISOString(), 结果 }, null, 2) + '\n')
  const 声 = 结果.filter(x => 声音.includes(x.类型))
  const 可听 = 声.map(x => ({ ...x, 地址: 试听地址(x) })).filter(x => x.地址)
  const 无试听 = 声.filter(x => !试听地址(x)).map(x => x.编号)
  let 页 = null
  if (可听.length) {
    页 = join(目录, '试听.html')
    await writeFile(页, 试听页(r.词, 可听))
  }
  return { 候选单, 试听页: 页, 无试听 }
}
