/** 机器改写意图也走原生单文件锁，只编辑意图块，不覆盖运行中的过程。 */
import { 意图改写补丁, 编辑工作文档 } from '../../roster/src/index.js'

export async function 改写意图文件(ctx, 根, 行, 改意图) {
  await 编辑工作文档(根, 行, ctx.get('fs'), 文 => {
    if (文 === null) throw new Error('工作文档缺失，不能安全改写意图')
    const 意图 = typeof 改意图 === 'function' ? 改意图(文) : 改意图
    return { 补丁: 意图改写补丁(文, 意图) }
  })
}
