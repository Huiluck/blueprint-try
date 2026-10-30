/**
 * 克利夫兰艺术博物馆开放库 —— 几万件藏品的数字化图片，只取 CC0 的。
 *
 * 名画、版画、器物、织物：当画风参考，或者直接用（CC0 不用署名）。
 * 不用 key。每件优先给 print 图片直链，web 图片用于缩略图。
 */

export default {
  站: 'Cleveland Museum of Art',
  类型: ['artwork'],

  async 搜({ 词, 条数, 取JSON }) {
    const q = new URLSearchParams({ q: 词, has_image: '1', cc0: '1', limit: String(条数) })
    const 回 = await 取JSON(`https://openaccess-api.clevelandart.org/api/artworks/?${q}`)
    return (回.data || []).map(a => {
      const 图 = a.images && (a.images.print || a.images.web)
      return {
        名字: a.title || '（没有标题）',
        类型: 'artwork',
        版权: 'CC0',
        可商用: true,
        作者: (a.creators || []).map(c => c.description).filter(Boolean).join('、') || (a.culture || []).join('、'),
        页面: a.url || '',
        缩略图: a.images?.web?.url || 图?.url || '',
        简介: [a.type, a.creation_date].filter(Boolean).join(' · '),
        文件: 图 ? [{ 名: 图.filename || 图.url.split('/').pop(), 网址: 图.url, 字节: Number(图.filesize) || 0 }] : [],
        备注: a.images?.print ? 'print 印刷尺寸 JPEG；实际解码后确认大小，元数据 filesize 可能偏差' : 图 ? '此条仅有 web 图片' : '',
      }
    })
  },
}
