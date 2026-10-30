import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 画树用的瘦账落盘（2026-10-15）：重启后第一次打开项目，不再把每个节点的账本整份解开。
    钥匙是原生 persistence 给的账本版本号（文件身份＋大小＋修改时刻）：版本号一字不差才用，差一点就当没有。
    `格式` 是瘦账长相的指纹，`瘦一条()`／`瘦身()` 一改，旧摘要自动作废。
    账本永远是准的那一份；这里丢了、坏了、写不进去，都只是回到现读。 */
export function 创建树摘要盘(目录, 格式) {
  const 文件 = id => /^[A-Za-z0-9_-]+$/.test(id) ? join(目录, id + '.json') : null
  let 报过 = false
  return {
    async 读(id, 版) {
      const f = 文件(String(id))
      if (!f || 版 == null) return null
      let x
      try { x = JSON.parse(await readFile(f, 'utf8')) } catch { return null }
      if (x?.格式 !== 格式 || x.版 !== String(版) || !Array.isArray(x.瘦) || !Number.isInteger(x.总数)) return null
      const 瘦 = x.瘦
      瘦.总数 = x.总数
      return { 瘦, 继承: x.继承 }
    },
    async 写(id, 版, 继承, 瘦) {
      const f = 文件(String(id))
      if (!f || 版 == null) return
      const 临时 = `${f}.${process.pid}.${Date.now()}.tmp`
      try {
        const 文 = JSON.stringify({ 格式, 版: String(版), 继承, 总数: 瘦.总数, 瘦 })   // 先定下这一刻的样子，再等盘
        await mkdir(目录, { recursive: true })
        await writeFile(临时, 文)
        await rename(临时, f)
      } catch (error) {
        await rm(临时, { force: true }).catch(() => {})
        if (!报过) { 报过 = true; console.log(`Blueprint studio: 画树摘要存不进 ${目录} —— ${error?.message || error}（照常现读）`) }
      }
    },
  }
}
