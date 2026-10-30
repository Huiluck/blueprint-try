import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
/** 冒烟脚本明确选用自己的临时项目根，绝不扫描或写入真实用户的文稿目录。 */
export async function prepareIsolatedProjectStorage(dataHome) {
  const root = join(dataHome, '项目')
  try { await writeFile(join(dataHome, '项目存储.json'), JSON.stringify({ version: 1, revision: 0, defaultRoot: root, roots: [root] }) + '\n', { flag: 'wx' }) }
  catch (error) { if (error.code !== 'EEXIST') throw error }
}
