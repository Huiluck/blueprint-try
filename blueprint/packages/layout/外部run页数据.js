import { 译 } from '../../../viewer/界面语言.js'
// 外部 run 的任务、执行过程与状态文案；只组织已经发生的事实。

const 两位 = n => String(n).padStart(2, '0')
/** 第几秒 → 「分:秒」；超过一小时写「时:分:秒」。 */
export function 时刻文(秒) {
  if (typeof 秒 !== 'number' || !Number.isFinite(秒)) return ''
  const s = Math.max(0, Math.round(秒)), 时 = Math.floor(s / 3600), 分 = Math.floor((s % 3600) / 60)
  return 时 ? `${时}:${两位(分)}:${两位(s % 60)}` : `${两位(分)}:${两位(s % 60)}`
}
/** 用时：「3 分 12 秒」「1 小时 5 分」。 */
export function 时长文(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return ''
  if (ms >= 3_600_000) return 译('{h} 小时 {m} 分', { h: Math.floor(ms / 3_600_000), m: Math.round((ms % 3_600_000) / 60_000) })
  if (ms >= 60_000) return 译('{m} 分 {s} 秒', { m: Math.floor(ms / 60_000), s: Math.round((ms % 60_000) / 1000) })
  return 译('{s} 秒', { s: Math.round(ms / 1000) })
}

/** 头一行：模型 · 思考程度 · 第几次 · 已多久／用时多久（执行者是前面那枚角标，角标的字见 外部run角标字）。 */
export function 外部run头(d) {
  if (!d) return ''
  const 时 = d.在跑 && typeof d.用时 === 'number' ? 译('已 {n} 分钟', { n: Math.max(0, Math.floor(d.用时 / 60_000)) })
    : typeof d.用时 === 'number' && !d.在跑 && d.状态 === '完成' ? 译('用时 {time}', { time: 时长文(d.用时) }) : ''
  return [d.model || (d.执行者 === 'Claude Code' ? 译('跟随账号默认') : ''), d.effort, d.次 ? 译('第 {n} 次', { n: d.次 }) : '', 时].filter(Boolean).join(' · ')
}
/** 角标上的字：CODEX／CLAUDE（跟图纸上砖的角标一样）。 */
export const 外部run角标字 = d => String(d?.短名 || d?.执行者 || '').toUpperCase()

/** 一步怎么显示：命令带退出码，没成功的加粗，正在跑的那一步垫浅灰。 */
export function 步显示(步) {
  const 命令 = 步.类 === '命令'
  const 在跑 = 命令 && 步.在跑 === true
  const 失败 = (命令 && !在跑 && 步.码 !== 0 && 步.码 !== null && 步.码 !== undefined) || 步.类 === '出错'
  const 尾 = 步.中断 ? 译('未完成') : 在跑 ? 译('在跑') : 命令 && 失败 ? 译('失败（{code}）', { code: 步.码 }) : ''
  return { 时: 时刻文(步.t), 类: 步.类, 文: 步.文, 尾, 命令, 失败, 在跑 }
}

/** 停着那一条：等用户处理的原因，或被按停、重起切断。没停着 → null。 */
export function 外部run停着(d) {
  if (!d || d.状态 === '完成' || d.在跑 || d.收尾) return null
  if (d.state === 'blocked') return { 文: 译('停着：{reason}', { reason: d.原因 || 译('要你处理') }), 去子Agent: /Agent 选择|子 Agent|Agent choice/i.test(d.原因 || '') }
  if (d.state === 'running') return { 文: 译('停下了：{reason}。点「全部启动」，它从停下的地方重新开一次。', { reason: d.停因 || 译('Blueprint 重起了') }), 去子Agent: false }
  return null
}

/** Claude Code 自己报的额度（G3）；Codex 不报，返回空。 */
export function 额度文(额度) {
  if (!额度) return ''
  const 段 = [['five_hour', 译('5 小时窗口')], ['seven_day', 译('7 天窗口')]]
    .filter(([k]) => typeof 额度[k]?.used === 'number').map(([k, 名]) => 译('{window}已用 {n}%', { window: 名, n: Math.round(额度[k].used * 100) }))
  return 段.length ? 译('Claude 额度：{parts}（和你自己用 Claude Code 是同一份）', { parts: 段.join(' · ') }) : ''
}

/** 底下那一行：它此刻能不能收话、交回给了谁。 */
export function 外部run底(d) {
  if (!d) return ''
  const 爹 = d.母节点 ? `${d.母节点.号} · ${d.母节点.名字}` : 译('派它的节点')
  if (d.状态 === '完成') return 译('结果已交回 {parent}。需要调整，可在那里补充要求。', { parent: 爹 })
  if (d.state === 'blocked') return 译('派出节点已收到异常信息。')
  return 译('这块由 {who} 在做，中途收不到话。有话对派它的节点说。', { who: d.执行者 })
}

/** 还在变的时候才接着读：在做、收尾（进程退出到交回落进名册那几秒）、等自动再试、还没开工。 */
export const 外部run要轮询 = d => !!d && d.状态 === '开工' && (d.在跑 || d.收尾 || d.state === 'retrying' || !d.state)

/** 连续工具动作收为一个过程组，Agent 的说明按原顺序保留全文。 */
export function 外部run段落(steps, active = false) {
  const paragraphs = []
  for (const [index, original] of (steps || []).entries()) {
    const step = original.在跑 && !active ? { ...original, 在跑: false, 中断: true } : original
    if (['命令', '改文件'].includes(step.类)) {
      let group = paragraphs.at(-1)
      if (group?.type !== 'tools') { group = { type: 'tools', key: index, steps: [] }; paragraphs.push(group) }
      group.steps.push(step)
    } else paragraphs.push({ type: step.类 === '说' ? 'message' : 'notice', key: index, step })
  }
  return paragraphs
}

export function 外部run概况(data) {
  if (data.状态 === '完成') return { state: 'done', label: data.result === 'achieved' ? 译('已达成') : data.result === 'unmet' ? 译('未达成') : 译('已交回') }
  if (data.在跑) return { state: 'run', label: 译('正在执行') }
  if (data.state === 'retrying') return { state: 'wait', label: 译('等待自动重试') }
  if (data.state === 'blocked') return { state: 'stop', label: 译('需要处理') }
  if (data.state === 'running' && data.endedAt && !data.停因) return { state: 'wait', label: 译('正在整理交回') }
  if (data.state === 'running') return { state: 'stop', label: 译('已停止') }
  return { state: 'wait', label: 译('等待开工') }
}

export function 外部run轮次(data) {
  const attempts = data.历次 || (data.次 ? [data] : [])
  const current = attempts.find(attempt => attempt.次 === data.次) || [...attempts].sort((a, b) => b.次 - a.次)[0] || null
  return { current, earlier: attempts.filter(attempt => attempt !== current).sort((a, b) => b.次 - a.次) }
}
