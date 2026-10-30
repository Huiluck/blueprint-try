// 源码 profile 的链接只负责发现 bundle；原生注册从 canonical 的真实文件解析。
import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse } from 'yaml'

export const name = 'blueprint-preset'
export const inject = ['agentPresets']

export async function apply(ctx) {
  const entry = pathToFileURL(await realpath(fileURLToPath(import.meta.url)))
  const metadata = parse(await readFile(new URL('./preset.yml', entry), 'utf8'))
  const canonical = pathToFileURL(await realpath(fileURLToPath(new URL('./agent.cordis.yml', entry))))
  const plugins = parse(await readFile(canonical, 'utf8'), {
    customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }],
  })
  // Blueprint 的 profile 直链不进入原生 linked-root 包表；按该 profile 的安装位置加载。
  const profileRequire = createRequire(join(ctx.profileContext.dir, 'package.json'))
  function sourceEntries(rows) {
    for (const row of rows) {
      if (row.name.startsWith('@blueprint/')) row.name = pathToFileURL(profileRequire.resolve(row.name)).href
      if (row.group && Array.isArray(row.config)) sourceEntries(row.config)
    }
  }
  sourceEntries(plugins)
  await ctx.effect(() => ctx.extend({ baseUrl: canonical.href }).agentPresets.register({ ...metadata, plugins }),
    'Blueprint canonical preset')
}
