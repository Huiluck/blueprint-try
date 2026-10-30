/** 媒体连接使用原生 Loader 配置，沿 blueprint-media 的 profile patch 保存。 */
import z from '@deepseek-ai/schemastery'
import { normalizeMedia } from '../../node/src/媒体服务.js'

export const Config = z.object({
  connections: z.transform(z.dict(z.any()).default({}), connections => {
    for (const [id, profile] of Object.entries(connections)) normalizeMedia({ ...profile, id })
    return connections
  }).volatile(),
})

export function apply() {}
