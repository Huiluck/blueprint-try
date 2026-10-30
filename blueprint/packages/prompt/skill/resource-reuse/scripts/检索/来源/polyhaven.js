/**
 * Poly Haven —— 高质量 3D 模型、PBR 贴图、HDRI 环境光，全部 CC0。
 *
 * 接口没有关键词搜索，只给全表（`/assets?t=...`，全站两千多条、两 MB 多）。
 * 所以这里拿全表，在名字、标签、分类里数命中几个词，命中多的在前，同分看下载量。
 * 挑中的几条再各查一次 `/files/<id>`，拿 1K 的直链：
 *   模型 → gltf ＋ 它连着的 bin 和贴图（几份文件，按相对路径摆）
 *   贴图 → 颜色、法线、粗糙度等几张 jpg
 *   HDRI → 一份 .hdr
 */

const 号类型 = ['hdri', 'texture', '3d']
const 查的t = { hdri: 'hdris', texture: 'textures', '3d': 'models' }

const 名Of = 网址 => 网址.split('/').pop()

/** 从 `/files/<id>` 的回复里挑 1K 的直链。 */
function 挑文件(类, f) {
  if (类 === 'hdri') {
    const h = f.hdri && f.hdri['1k'] && f.hdri['1k'].hdr
    return h
      ? { 文件: [{ 名: 名Of(h.url), 网址: h.url, 字节: h.size || 0 }], 备注: '1K 的 .hdr；要更清楚的去页面' }
      : { 文件: [], 备注: '没找到 1K 的 .hdr，去页面下' }
  }
  if (类 === '3d') {
    const g = f.gltf && f.gltf['1k'] && f.gltf['1k'].gltf
    if (!g) return { 文件: [], 备注: '没找到 1K 的 gltf，去页面下' }
    return {
      文件: [
        { 名: 名Of(g.url), 网址: g.url, 字节: g.size || 0 },
        ...Object.entries(g.include || {}).map(([名, x]) => ({ 名, 网址: x.url, 字节: x.size || 0 })),
      ],
      备注: 'gltf 连着几份文件：放进同一个文件夹，按「名」里的相对路径摆，贴图才连得上',
    }
  }
  const 图 = ['Diffuse', 'nor_gl', 'Rough', 'arm', 'AO', 'Displacement'].map(k => {
    const r = f[k] && f[k]['1k']
    const x = r && (r.jpg || r.png)
    return x ? { 名: 名Of(x.url), 网址: x.url, 字节: x.size || 0 } : null
  }).filter(Boolean)
  return { 文件: 图, 备注: 图.length ? '1K 的几张贴图（颜色、法线、粗糙度……）；要更清楚的去页面' : '没找到 1K 的贴图，去页面下' }
}

export default {
  站: 'Poly Haven',
  类型: ['3d', 'texture', 'hdri'],

  async 搜({ 词, 类型们, 条数, 取JSON }) {
    const 全 = await 取JSON(`https://api.polyhaven.com/assets?t=${类型们.length === 1 ? 查的t[类型们[0]] : 'all'}`)
    const 词们 = 词.toLowerCase().split(/[\s,，、]+/).filter(Boolean)
    const 中 = Object.entries(全 || {})
      .map(([id, a]) => {
        const 面 = [id, a.name, ...(a.tags || []), ...(a.categories || [])].join(' ').toLowerCase()
        return { id, a, 分: 词们.filter(w => 面.includes(w)).length }
      })
      .filter(x => x.分 > 0)
      .sort((x, y) => y.分 - x.分 || (y.a.download_count || 0) - (x.a.download_count || 0))
      .slice(0, 条数)

    return Promise.all(中.map(async ({ id, a }) => {
      const 类 = 号类型[a.type] || '3d'
      let 挑 = { 文件: [], 备注: '' }
      try {
        挑 = 挑文件(类, await 取JSON(`https://api.polyhaven.com/files/${encodeURIComponent(id)}`))
      } catch (e) {
        挑 = { 文件: [], 备注: `文件清单没拿到（${e.message}），去页面下` }
      }
      return {
        名字: a.name || id,
        类型: 类,
        版权: 'CC0',
        可商用: true,
        作者: Object.keys(a.authors || {}).join('、'),
        页面: `https://polyhaven.com/a/${id}`,
        缩略图: a.thumbnail_url || '',
        简介: (a.description || '').slice(0, 120),
        ...挑,
      }
    }))
  },
}
