/**
 * Iconify —— 二十多万个 SVG 图标，一百多套（含 game-icons 那套四千多个技能／道具图标）。
 *
 * 搜索一次就带回每一套的版权。每个图标一份 SVG 直链。
 * 版权里带 NC 的算不可商用，其余（MIT、Apache、CC-BY、OFL……）算可以；CC-BY 要署名，版权那一栏写着。
 */

export default {
  站: 'Iconify',
  类型: ['icon'],

  async 搜({ 词, 取JSON }) {
    /* 这个接口 limit 最小 32。 */
    const 回 = await 取JSON(`https://api.iconify.design/search?${new URLSearchParams({ query: 词, limit: '64' })}`)
    const 套们 = 回.collections || {}
    return (回.icons || []).map(全名 => {
      const [套, 名] = 全名.split(':')
      const c = 套们[套] || {}
      const 版 = (c.license && (c.license.title || c.license.spdx)) || ''
      const 网址 = `https://api.iconify.design/${套}/${名}.svg?height=64`
      return {
        名字: 全名,
        类型: 'icon',
        版权: 版 || '未知',
        可商用: 版 ? !/\bNC\b|NonCommercial/i.test(版) : null,
        作者: (c.author && c.author.name) || '',
        页面: `https://icon-sets.iconify.design/${套}/${名}/`,
        缩略图: 网址,
        简介: c.name ? `出自「${c.name}」` : '',
        文件: [{ 名: `${套}-${名}.svg`, 网址, 字节: 0 }],
        备注: 'SVG 明确 height=64；按作品需要调整数值尺寸',
      }
    })
  },
}
