/** 继续一个节点时补送它的事：它这一支的组织推进、给它排着的纸条、它欠的求助提醒、条件等待复查。别的节点不动。
 *  按停继续（index.js）和回话里用 next 交接（工具.js，选 46）共用。 */
import { 推进组织 } from './会话.js'
import { 送未送纸条, 提醒欠求助 } from './纸条.js'
import { 复查项目等待 } from './条件等待.js'

const 喊 = (话, e) => console.log(`Blueprint node: ${话} —— ${e?.message || e}`)

export async function 继续补送(ctx, 根, id) {
  await 推进组织(ctx, 根, null, { scope: id }).catch(e => 喊(`继续 ${id} 时组织没推进`, e))
  await 送未送纸条(ctx, 根, id, { 恢复: true }).catch(e => 喊(`继续时 ${id} 的纸条没送`, e))
  await 提醒欠求助(ctx, 根, id, `resume-${Date.now()}`).catch(e => 喊(`继续时 ${id} 的欠求助没提醒`, e))
  await 复查项目等待(ctx, 根)
}
