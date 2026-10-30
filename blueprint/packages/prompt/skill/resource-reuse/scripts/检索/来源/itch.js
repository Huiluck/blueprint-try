/**
 * itch.io —— 独立作者的游戏素材包最多的地方：2D 素材包、3D、图标，也有音效包和音乐包。
 *
 * 没有搜索接口，但免费素材的每个标签页都有一份 RSS（`/game-assets/free/tag-xxx.xml`），按热度排。
 * 所以这里是**按标签找**，不是按关键词。依次试，哪种先有东西用哪种：
 *   ① 把词切成几个标签取交集，相邻的词可以连成一个（`pixel art cat` → `pixel-art` ＋ `cat`），标签少的切法先试
 *   ② 只用一个词，从最后一个往前（英文名词在后头，`cat` 比 `pixel` 更是要找的东西）
 * 2026-09-15 真跑撞的：原来只试「整句」「全拆开」「从第一个词起单个」，`pixel art cat` 一路试到只剩 `pixel`，回来一堆像素字体。
 * 要哪一类就再叠一个类型标签（3d → `tag-3d`，音效 → `tag-sound-effects`……）。
 *
 * 拿不到的两样：**版权**（写在各自页面上）、**直接下载地址**（免费包原件由 `scripts/取得.mjs --pick … --filename` 取，内部走 `取得素材.py itch-free-package`）。
 */

/** 每一类叠哪个标签。2d 不叠：素材区默认就是它。 */
const 类型标签 = { '2d': null, '3d': 'tag-3d', icon: 'tag-icons', sfx: 'tag-sound-effects', music: 'tag-music' }

const 实体 = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'" }

/** 剥 CDATA、标签、实体。 */
function 去壳(s) {
  return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|apos);/g, m => 实体[m])
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ').trim()
}

/** @param {string} xml */
function 解(xml) {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, 块]) => {
    const 取 = k => { const m = 块.match(new RegExp(`<${k}>([\\s\\S]*?)</${k}>`)); return m ? 去壳(m[1]) : '' }
    const 链 = 取('link')
    let 作者 = ''
    try { 作者 = new URL(链).hostname.split('.')[0] } catch { /* 留空 */ }
    return { 名字: 取('plainTitle') || 取('title'), 页面: 链, 缩略图: 取('imageurl'), 简介: 取('description').slice(0, 120), 作者 }
  })
}

/** 最多看几个词。四个词有八种切法，再多请求就太多了。 */
const 最多几个词 = 4

/**
 * 把词切成标签的所有切法：相邻的词可以连成一个标签。标签少的在前。
 * @param {string[]} 词们
 * @returns {string[][]} 每一种切法是一组 `tag-xxx`
 */
function 切法(词们) {
  const 词 = 词们.slice(0, 最多几个词)
  const 出 = []
  for (let 掩 = 0; 掩 < 1 << (词.length - 1); 掩++) {
    const 标签们 = []
    let 当前 = [词[0]]
    for (let i = 1; i < 词.length; i++) {
      if (掩 & (1 << (i - 1))) { 标签们.push(当前.join('-')); 当前 = [词[i]] } else 当前.push(词[i])
    }
    标签们.push(当前.join('-'))
    出.push(标签们.map(w => `tag-${w}`))
  }
  return 出.sort((a, b) => a.length - b.length)
}

/** 按一类找：依次试几种标签组合，第一种有东西的就是它。 */
async function 找一类(词们, 类型, 取文本) {
  const 附 = 类型标签[类型] ? [类型标签[类型]] : []
  const 试法 = [
    ...切法(词们),
    ...词们.slice(0, 最多几个词).reverse().map(w => [`tag-${w}`]),
  ]
  const 试过 = new Set()
  for (const 标签们 of 试法) {
    const 路 = [...标签们, ...附].join('/')
    if (试过.has(路)) continue
    试过.add(路)
    let xml
    try {
      xml = await 取文本(`https://itch.io/game-assets/free/${路}.xml`)
    } catch (e) {
      if (e && e.status === 404) continue // 没有这个标签
      throw e
    }
    if (!/<rss\b/i.test(xml)) throw new Error('返回的不是 RSS 素材目录')
    const 条 = 解(xml)
    if (!条.length) continue
    const 按 = 标签们.map(t => t.slice(4)).join(' ＋ ')
    return 条.map(x => ({
      ...x,
      类型,
      版权: '未知',
      可商用: null,
      文件: [],
      备注: `按标签「${按}」找的。版权写在页面上；免费包原件用 取得.mjs --pick 取，--filename 填页面列出的完整文件名`,
    }))
  }
  return []
}

export default {
  站: 'itch.io',
  类型: ['2d', '3d', 'icon', 'sfx', 'music'],

  async 搜({ 词, 类型们, 取文本 }) {
    const 词们 = 词.toLowerCase().split(/[\s,，、]+/).map(w => w.replace(/[^a-z0-9-]/g, '')).filter(Boolean)
    if (!词们.length) return []
    /* 菜单里有 2d 就只查一次不叠标签（游戏素材那一把不指定 kind 时，跟以前一样）；
       否则每一类各查一次（声音那一把不指定 kind 时，音效、音乐各查一次）。 */
    const 查 = 类型们.includes('2d') ? ['2d'] : 类型们
    const 批 = await Promise.all(查.map(t => 找一类(词们, t, 取文本)))
    return 批.flat()
  },
}
