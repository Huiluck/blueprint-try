/** 整曲音乐搜索；试听和允许下载的文件是两种不同字段。 */
export default {
  站: 'Jamendo',
  类型: ['music'],
  async 搜({ 词, 最短, 最长, 取JSON }) {
    const key = process.env.JAMENDO_CLIENT_ID
    if (!key) throw new Error('未配置 JAMENDO_CLIENT_ID；申请：https://devportal.jamendo.com/')
    const q = new URLSearchParams({
      client_id: key, format: 'json', limit: '40', search: 词,
      type: 'single albumtrack', order: 'relevance', include: 'musicinfo',
      audioformat: 'mp32', audiodlformat: 'mp32',
    })
    if (最短 !== undefined && 最长 !== undefined) q.set('durationbetween', `${Math.floor(最短)}_${Math.ceil(最长)}`)
    const r = await 取JSON(`https://api.jamendo.com/v3.0/tracks/?${q}`)
    if (r.headers?.status !== 'success' || !Array.isArray(r.results)) throw new Error('Jamendo 未成功返回曲目（检查凭据、额度与参数）')
    return r.results.map(s => ({
      名字: s.name, 类型: 'music', 秒: s.duration ?? null,
      作者: s.artist_name || '', 页面: s.shareurl || `https://www.jamendo.com/track/${s.id}`,
      版权: s.license_ccurl || '未知', 授权页: s.license_ccurl || '',
      简介: Object.values(s.musicinfo?.tags || {}).flat().join(', '),
      试听: s.audio || '',
      文件: s.audiodownload_allowed === true && s.audiodownload
        ? [{ 名: `${s.id}.mp3`, 网址: s.audiodownload, 字节: 0 }] : [],
      备注: s.audiodownload_allowed === true ? '下载为站点提供的 MP3。' : '作者未开放下载；试听地址不作为下载文件。',
    }))
  },
}
