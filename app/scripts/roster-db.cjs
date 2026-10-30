// 名册在项目的 `系统文档/任务.db`（SQLite，任务表，2026-10-18 起是唯一出处）。
// 冒烟脚本从这里读，读到的和程序一样：`{ rows, seats? }`。只读打开，读完就关；库被程序占着时最多等 5 秒。
const { DatabaseSync } = require('node:sqlite')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

/** 项目根 → 任务库路径。 */
const rosterPath = root => join(root, '系统文档', '任务.db')

/** 读一本名册；库还不在 → null。参数可以是项目根，也可以直接是 `任务.db` 的路径。 */
function readRoster(rootOrDb) {
  const path = String(rootOrDb).endsWith('.db') ? String(rootOrDb) : rosterPath(rootOrDb)
  if (!existsSync(path)) return null
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    db.exec('PRAGMA busy_timeout = 5000')
    const rows = db.prepare('SELECT "全行" FROM "任务" ORDER BY "排序", "编号"').all().map(r => JSON.parse(r.全行))
    const seats = db.prepare('SELECT "全行" FROM "座位" ORDER BY "排序", "名字"').all().map(r => JSON.parse(r.全行))
    return { rows, ...(seats.length ? { seats } : {}) }
  } finally { db.close() }
}

/** 整本名册的文字快照：比较前后有没有变、找里面有没有某个字。库不在 → null。 */
function rosterText(rootOrDb) {
  const roster = readRoster(rootOrDb)
  return roster && JSON.stringify(roster)
}

module.exports = { rosterPath, readRoster, rosterText }
