/**
 * ambientCG —— PBR 材质、HDRI、少量模型，全部 CC0。
 *
 * 接口有关键词搜索，一次就把下载包和缩略图一起给回来。
 * 每条挑一个 1K 的压缩包，取得后由调用者解压并检查。
 */

const 查的type = { texture: 'Material', hdri: 'HDRI', '3d': '3DModel' }
const 回类型 = { Material: 'texture', HDRI: 'hdri', '3DModel': '3d' }

export default {
  站: 'ambientCG',
  类型: ['texture', 'hdri', '3d'],

  async 搜({ 词, 类型们, 条数, 取JSON }) {
    const q = new URLSearchParams({
      q: 词,
      limit: String(条数),
      type: 类型们.map(t => 查的type[t]).join(','),
      include: 'downloadData,imageData',
      sort: 'Popular',
    })
    const 回 = await 取JSON(`https://ambientcg.com/api/v2/full_json?${q}`)
    return (回.foundAssets || []).map(a => {
      const 包们 = Object.values((a.downloadFolders && a.downloadFolders.default
        && a.downloadFolders.default.downloadFiletypeCategories) || {}).flatMap(c => c.downloads || [])
      const 挑 = 包们.find(d => /^1K-JPG$/i.test(d.attribute))
        || 包们.find(d => /^1K/i.test(d.attribute))
        || [...包们].sort((x, y) => (x.size || 0) - (y.size || 0))[0]
      return {
        名字: a.displayName || a.assetId,
        类型: 回类型[a.dataType] || 'texture',
        版权: 'CC0',
        可商用: true,
        作者: 'ambientCG',
        页面: a.shortLink || `https://ambientcg.com/view?id=${a.assetId}`,
        缩略图: (a.previewImage && a.previewImage['256-PNG']) || '',
        简介: (a.tags || []).slice(0, 8).join(', '),
        文件: 挑 ? [{ 名: 挑.fileName, 网址: 挑.downloadLink || 挑.fullDownloadPath, 字节: 挑.size || 0 }] : [],
        备注: 挑 ? `${挑.attribute} 压缩包，尚未下载或解压` : '没有可下的包，去页面看',
      }
    })
  },
}
