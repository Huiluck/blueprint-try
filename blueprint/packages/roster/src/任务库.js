/**
 * 任务库：项目的任务表存在 `系统文档/任务.db`，一个 SQLite 文件，是任务的唯一出处（要求账 任 1–4，2026-10-18）。
 * 一个节点就是一件任务：helm 是用户交给的那件，总 dock 是 helm 一个阶段交给它的，下面的 dock 和 run 是上级派给它们的。
 *
 * 读出来的样子和原来的名册一样（`{ rows }`），所以 `读名册`、`改名册` 这些入口照旧，调用方不用改。
 *
 * - 任务：一行一个节点。常看的几格单独成列，方便任何 SQLite 查看器直接看；整行原样存在「全行」里，读只认全行。
 *   「座位」那一列是旧表留下的（第三版 10-24 座位撤了），不再写；旧库里的「座位」表也不再读写。
 * - 转手记录：任务每换一次状态记一笔，只追加，不改不删。
 * - 项目信息：表的版本这类零碎。
 *
 * 几行一起改放在一个事务里：要么全成，要么一行不改。日志模式用 DELETE：每次提交都改主文件，
 * 按文件签盯着它的地方（studio 的读缓存和图纸实时刷新）照旧看得到变化。
 * 同一个库文件在进程里只开一个连接；别的连接（另一个进程）改过，靠 `PRAGMA data_version` 认出来。
 */
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const 任务库版本 = 1

const 建表 = `
CREATE TABLE IF NOT EXISTS "项目信息" ("键" TEXT PRIMARY KEY, "值" TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS "任务" (
  "编号" TEXT PRIMARY KEY,
  "派出者" TEXT,
  "座位" TEXT,
  "名字" TEXT NOT NULL,
  "状态" TEXT NOT NULL,
  "执行者" TEXT,
  "会话" TEXT,
  "目的" TEXT,
  "交回结论" TEXT,
  "交回" TEXT,
  "要你定" TEXT,
  "验了" TEXT,
  "没验" TEXT,
  "排序" INTEGER NOT NULL,
  "全行" TEXT NOT NULL,
  "改于" TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS "转手记录" (
  "序号" INTEGER PRIMARY KEY AUTOINCREMENT,
  "编号" TEXT NOT NULL,
  "时间" TEXT NOT NULL,
  "从" TEXT,
  "到" TEXT NOT NULL,
  "一句" TEXT
);
CREATE INDEX IF NOT EXISTS "转手记录_编号" ON "转手记录" ("编号");
`

/** 路径 → 这个进程里唯一的连接，记着开它时那个文件的身份（设备号＋inode）。 */
const 连接们 = new Map()

/** 文件此刻的身份；不在 → null。文件被整个换掉（拷回、原子替换），身份就变了。 */
function 身份Of(路径) {
  try { const s = statSync(路径); return `${s.dev}:${s.ino}` } catch (e) { if (e.code === 'ENOENT') return null; throw e }
}

const 键Of = 路径 => resolve(String(路径))

function 开连接(路径) {
  const db = new DatabaseSync(路径)
  db.exec('PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  db.exec(建表)
  const 版 = db.prepare('SELECT "值" FROM "项目信息" WHERE "键" = ?').get('版本')
  if (!版) db.prepare('INSERT INTO "项目信息" ("键", "值") VALUES (?, ?)').run('版本', String(任务库版本))
  else if (Number(版.值) !== 任务库版本) { db.close(); throw new Error(`${路径} 的表版本是 ${版.值}，这一版程序认的是 ${任务库版本}`) }
  return db
}

/**
 * 打开项目的任务库。文件不在 → null（这还不是一个项目）；`新建` 为真时文件已在就抛，绝不覆盖。
 * 文件被删了（删项目），旧连接关掉、不再用。
 */
export function 开任务库(路径, { 新建 = false } = {}) {
  const 键 = 键Of(路径), 旧 = 连接们.get(键), 身份 = 身份Of(键)
  const 丢旧 = () => { if (旧) { try { 旧.db.close() } catch {} 连接们.delete(键) } }
  if (新建) {
    if (身份) throw Object.assign(new Error(`${键} 已经存在 —— 不覆盖`), { code: 'EEXIST' })
    丢旧()
    mkdirSync(dirname(键), { recursive: true })
    const db = 开连接(键)
    连接们.set(键, { db, 身份: 身份Of(键) })
    return db
  }
  if (!身份) { 丢旧(); return null }
  // 文件还是开连接时那一个就接着用；被删了重建、被整个换掉，旧连接读的是旧文件，关掉重开。
  if (旧 && 旧.身份 === 身份) return 旧.db
  丢旧()
  const db = 开连接(键)
  连接们.set(键, { db, 身份 })
  return db
}

/** 关掉这个库的连接（删项目、测试收尾）。没开过也不出错。 */
export function 关任务库(路径) {
  const 键 = 键Of(路径), 旧 = 连接们.get(键)
  if (!旧) return
  连接们.delete(键)
  try { 旧.db.close() } catch {}
}

/** 别的连接提交过就会变；自己这个连接的提交不变（自己写完自己更新快照）。 */
export const 数据版本 = db => Number(db.prepare('PRAGMA data_version').get().data_version)

/** 整张表读出来：`{ rows }`，按排序。 */
export function 读任务库(db) {
  return { rows: db.prepare('SELECT "全行" FROM "任务" ORDER BY "排序", "编号"').all().map(r => JSON.parse(r.全行)) }
}

const 文或空 = v => v === undefined || v === null || v === '' ? null : String(v)
const 摘一句 = (文, n = 120) => { const s = String(文 || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s }

/** 状态换了，这一笔怎么写：交回带结论和交回一句，别的只记从哪到哪。 */
function 转手一句(新) {
  if (新.status === '完成') {
    const 结论 = 新.result === 'achieved' ? '达成' : 新.result === 'unmet' ? '没达成' : ''
    return [结论, 新.handoffQuestion ? `要你定：${摘一句(新.handoffQuestion, 60)}` : '', 摘一句(新.handoff)].filter(Boolean).join('；') || null
  }
  return null
}

/**
 * 把新的一整张表写进去，只动变了的行；状态变了的记一笔转手。整件事在一个事务里。
 * `旧` 是改之前读到的那张（新建时为 null）。
 */
export function 写任务库(db, 旧, 新, 现在 = new Date().toISOString()) {
  const 旧行们 = new Map((旧?.rows || []).map((r, i) => [r.id, { r, i, 文: JSON.stringify(r) }]))
  const 写行 = db.prepare(`INSERT INTO "任务" ("编号", "派出者", "座位", "名字", "状态", "执行者", "会话", "目的", "交回结论", "交回", "要你定", "验了", "没验", "排序", "全行", "改于")
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT ("编号") DO UPDATE SET "派出者" = excluded."派出者", "座位" = excluded."座位", "名字" = excluded."名字", "状态" = excluded."状态",
      "执行者" = excluded."执行者", "会话" = excluded."会话", "目的" = excluded."目的", "交回结论" = excluded."交回结论", "交回" = excluded."交回",
      "要你定" = excluded."要你定", "验了" = excluded."验了", "没验" = excluded."没验", "排序" = excluded."排序", "全行" = excluded."全行", "改于" = excluded."改于"`)
  const 删行 = db.prepare('DELETE FROM "任务" WHERE "编号" = ?')
  const 记转手 = db.prepare('INSERT INTO "转手记录" ("编号", "时间", "从", "到", "一句") VALUES (?, ?, ?, ?, ?)')
  db.exec('BEGIN IMMEDIATE')
  try {
    const 见过 = new Set()
    新.rows.forEach((r, i) => {
      见过.add(r.id)
      const 文 = JSON.stringify(r), o = 旧行们.get(r.id)
      if (o && o.文 === 文 && o.i === i) return
      写行.run(r.id, 文或空(r.parent), null, String(r.name), String(r.status), 文或空(r.executor), 文或空(r.session), 文或空(r.goal),
        文或空(r.result), 文或空(r.handoff), 文或空(r.handoffQuestion), 文或空(r.checked), 文或空(r.unchecked), i, 文, 现在)
      if (!o || o.r.status !== r.status) 记转手.run(r.id, 现在, o ? String(o.r.status) : null, String(r.status), 转手一句(r))
    })
    for (const [id, o] of 旧行们) if (!见过.has(id)) { 删行.run(id); 记转手.run(id, 现在, String(o.r.status), '删掉', null) }
    db.exec('COMMIT')
  } catch (e) {
    try { db.exec('ROLLBACK') } catch {}
    throw e
  }
}

/** 一件任务的转手记录，按时间先后。 */
export function 读转手记录(db, 编号) {
  return db.prepare('SELECT "时间", "从", "到", "一句" FROM "转手记录" WHERE "编号" = ? ORDER BY "序号"').all(String(编号))
    .map(r => ({ 时间: r.时间, 从: r.从, 到: r.到, ...(r.一句 ? { 一句: r.一句 } : {}) }))
}
