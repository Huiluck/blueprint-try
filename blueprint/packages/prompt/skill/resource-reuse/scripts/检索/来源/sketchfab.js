/**
 * Sketchfab —— 最大的 3D 模型库。这里只查「可下载」的。
 *
 * 搜索不用登录；**下载要登录令牌**，所以这里没有直链，只给页面和版权。
 * 版权每个模型不同：NonCommercial 和 Editorial 算不可商用，其余（CC0、CC-BY 系、Standard）算可以。
 * 一次多要几条，滤掉不可商用的之后还剩得够。
 */

/** @param {string} 标 */
const 可商用Of = 标 => (/NonCommercial|Editorial/i.test(标) ? false : 标 ? true : null)

export default {
  站: 'Sketchfab',
  类型: ['3d'],

  async 搜({ 词, 取JSON }) {
    const q = new URLSearchParams({ type: 'models', downloadable: 'true', q: 词, count: '24' })
    const 回 = await 取JSON(`https://api.sketchfab.com/v3/search?${q}`)
    return (回.results || []).map(m => {
      const 标 = (m.license && m.license.label) || ''
      const 图们 = (m.thumbnails && m.thumbnails.images) || []
      const 图 = 图们.find(i => i.width === 256) || 图们[图们.length - 1]
      return {
        名字: m.name,
        类型: '3d',
        版权: 标 || '未知',
        可商用: 可商用Of(标),
        作者: (m.user && m.user.username) || '',
        页面: m.viewerUrl,
        缩略图: (图 && 图.url) || '',
        简介: m.faceCount ? `${m.faceCount} 面` : '',
        文件: [],
        备注: 'Sketchfab 下载要登录，这里没有直链',
      }
    })
  },
}
