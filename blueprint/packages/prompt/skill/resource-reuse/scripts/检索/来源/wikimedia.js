/**
 * Wikimedia Commons —— 维基共享资源：上亿份照片、图、录音。
 *
 * 版权每份不同，但这个站本来就不收不可商用的，所以几乎都能用；CC BY／BY-SA 要署名，版权那一栏写着。
 * 搜的是文件命名空间，一次把直链、缩略图、版权、作者一起带回。
 *
 * **认中文**：不少文件有中文描述，所以英文词、中文词各查一遍，轮流排，同一个文件只留一次。
 *
 * 类型分不细，是按文件猜的：svg 算插画，别的图算照片；声音统一标 audio（待试听分类），不按时长猜。
 */

/** 每一类对应的搜索过滤词。音效和音乐是同一种文件，只查一次，保留未分类状态。 */
const 过滤词 = { photo: 'filetype:bitmap', illustration: 'filetype:drawing', sfx: 'filetype:audio', music: 'filetype:audio' }

const 去标签 = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const 去尾巴 = u => String(u || '').split('?')[0]

export default {
  站: 'Wikimedia Commons',
  类型: ['photo', 'illustration', 'sfx', 'music'],
  认中文: true,

  async 搜({ 词, 中文词, 类型们, 条数, 取JSON }) {
    const 过滤们 = [...new Set(类型们.map(t => 过滤词[t]))]
    const 查们 = [词, 中文词].filter(Boolean)
    const 批 = await Promise.all(过滤们.flatMap(过滤 => 查们.map(async 查 => {
      const 是声 = 过滤 === 'filetype:audio'
      const q = new URLSearchParams({
        action: 'query', format: 'json',
        generator: 'search', gsrnamespace: '6', gsrsearch: `${查} ${过滤}`, gsrlimit: String(条数 * 2),
        prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime',
        iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ImageDescription',
        /* 原图动辄一二十 MB。要一份 1280 宽的当文件，原图放备注里。 */
        ...(是声 ? {} : { iiurlwidth: '1280' }),
      })
      const 回 = await 取JSON(`https://commons.wikimedia.org/w/api.php?${q}`)
      if (回.error) throw new Error(`Commons API 错误：${回.error.code || '未知'}`)
      return Object.values((回.query && 回.query.pages) || {})
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .map(p => {
          const i = p.imageinfo && p.imageinfo[0]
          /* MIDI 也算 audio，但它是乐谱不是录音，放进游戏里出不了声。 */
          if (!i || /midi/i.test(i.mime || '')) return null
          const m = i.extmetadata || {}
          const 版 = 去标签(m.LicenseShortName && m.LicenseShortName.value)
          const 原图 = 去尾巴(i.url)
          const 小图 = 去尾巴(i.thumburl)
          const 用小图 = !是声 && 小图 && 小图 !== 原图
          const 网址 = 用小图 ? 小图 : 原图
          const 秒 = Number(i.duration) || 0
          const 类型 = 是声 ? 'audio' : (/svg/.test(i.mime || '') ? 'illustration' : 'photo')
          const 描述 = 去标签(m.ImageDescription && m.ImageDescription.value).slice(0, 100)
          // 实搜音效会混入同名词语的词典读音；非发音查询时去掉这类明确不符的条目。
          if (是声 && !/pronunciation|lingua libre|发音/i.test(`${词} ${中文词}`)
            && /pronunciation|lingua libre|发音/i.test(`${p.title} ${去标签(m.ImageDescription?.value)}`)) return null
          return {
            名字: p.title.replace(/^File:/, ''),
            类型,
            版权: 版 || '未知',
            授权页: m.LicenseUrl?.value || '',
            秒: 秒 || null,
            可商用: 版 ? !/\bNC\b|non-?commercial/i.test(版) : null,
            作者: 去标签(m.Artist && m.Artist.value).slice(0, 60),
            页面: i.descriptionurl || '',
            缩略图: 小图,
            简介: [是声 && 秒 ? `${Math.round(秒)} 秒` : '', 描述].filter(Boolean).join(' · '),
            文件: [{ 名: decodeURIComponent(网址.split('/').pop()), 网址, 字节: 用小图 ? 0 : i.size || 0, 变体: 用小图 ? '1280宽缩图' : '原文件' }],
            ...(用小图 ? { 原文件: [{ 名: decodeURIComponent(原图.split('/').pop()), 网址: 原图, 字节: i.size || 0 }] } : {}),
            备注: 是声 ? '音频候选，音乐或音效需试听确认；文件为站点提供的录音'
              : 用小图 ? `这是 1280 宽的一份；原图 ${Math.round((i.size || 0) / 1024 / 1024 * 10) / 10}MB：${原图}` : '',
          }
        })
        .filter(Boolean)
    })))
    /* 几批轮流排，同一个文件只留一次。 */
    const 出 = []
    const 见 = new Set()
    const 最长 = Math.max(0, ...批.map(b => b.length))
    for (let i = 0; i < 最长; i++) {
      for (const b of 批) {
        const x = b[i]
        if (x && !见.has(x.页面)) { 见.add(x.页面); 出.push(x) }
      }
    }
    return 出
  },
}
