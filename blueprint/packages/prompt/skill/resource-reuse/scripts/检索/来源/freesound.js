/** Freesound 的声音分类来自站点，可能由算法标注；时长只用于筛选。 */
export default {
  站: 'Freesound',
  类型: ['sfx', 'music'],
  async 搜({ 词, 类型们, 最短, 最长, 取JSON }) {
    const key = process.env.FREESOUND_API_KEY
    if (!key) throw new Error('未配置 FREESOUND_API_KEY；申请：https://freesound.org/apiv2/apply/')
    const q = new URLSearchParams({
      query: 词, token: key, page_size: '40',
      fields: 'id,name,username,license,previews,duration,url,tags,category,subcategory,type,samplerate,channels',
    })
    const filters = []
    if (类型们.length === 1) filters.push(类型们[0] === 'music' ? 'category:Music' : '-category:Music')
    if (最短 !== undefined || 最长 !== undefined) filters.push(`duration:[${最短 ?? 0} TO ${最长 ?? '*'}]`)
    if (filters.length) q.set('filter', filters.join(' '))
    const 回 = await 取JSON(`https://freesound.org/apiv2/search/?${q}`)
    if (!Array.isArray(回.results)) throw new Error('接口没有返回声音列表')
    return 回.results.map(s => {
      const mp3 = s.previews?.['preview-hq-mp3']
      const ogg = s.previews?.['preview-hq-ogg']
      return {
        名字: s.name || String(s.id),
        类型: s.category === 'Music' ? 'music' : s.category ? 'sfx' : 'audio',
        版权: s.license || '未知',
        授权页: /^https?:/.test(s.license || '') ? s.license : '',
        作者: s.username || '',
        页面: s.url || `https://freesound.org/s/${s.id}/`,
        秒: s.duration ?? null,
        简介: [s.category, s.subcategory, (s.tags || []).slice(0, 8).join(', ')].filter(Boolean).join(' · '),
        试听: mp3 || ogg || '',
        文件: [],
        备注: `试听是转码 ${mp3 ? 'MP3' : 'OGG'}；原文件 ${s.type || '未知格式'} / ${s.samplerate || '?'} Hz / ${s.channels || '?'} 声道，下载需 OAuth 或去页面登录。类别由站点标注，需试听确认。`,
      }
    })
  },
}
