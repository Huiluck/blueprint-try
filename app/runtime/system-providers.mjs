// 只读导入系统 DSH profile 的模型 provider 行与凭据文件路径；导入失败只给 warning，不阻断启动。
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parse } from 'yaml'

export const SYSTEM_PROVIDER_ROW_IDS = ['agent-default-model', 'llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account']

// 系统 DSH 的 cordis.patch.yml 可能含 !!js 表达式；标签形状与 composition.mjs 的 yamlOptions 保持一致，
// 不能退化成普通字符串（会被当成字面量表达式），也不能因为未知标签把带表达式的 provider 行判成损坏。
const yamlOptions = { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }] }
// profile 名会拼进文件路径：只允许单段安全字符，且禁止 .. 与路径分隔符。
const profileNamePattern = /^[A-Za-z0-9._-]+$/

function environmentValue(environment, name) {
  const value = environment?.[name]
  return typeof value === 'string' ? value : undefined
}

export function systemDshHome(environment = process.env) {
  return environmentValue(environment, 'BLUEPRINT_SYSTEM_DSH_HOME') ?? join(homedir(), '.dsh')
}

export function systemDshProfile(environment = process.env) {
  return environmentValue(environment, 'BLUEPRINT_SYSTEM_DSH_PROFILE') ?? 'desktop'
}

function profileProblem(profile) {
  if (!profileNamePattern.test(profile) || profile.includes('..')) {
    return `系统 DSH profile 名不合法：${JSON.stringify(profile)}；只允许字母、数字、点、下划线与连字符，且不能包含路径分隔符或 ..`
  }
  return ''
}

async function isFile(path) {
  try { return (await stat(path)).isFile() } catch { return false }
}

function isProviderRow(row) {
  return !!row && typeof row === 'object' && !Array.isArray(row) && SYSTEM_PROVIDER_ROW_IDS.includes(row.id)
}

export async function readSystemProviderRows({ environment = process.env } = {}) {
  const home = systemDshHome(environment)
  const profile = systemDshProfile(environment)
  const result = { found: false, home, profile, patchPath: '', rows: [], credentialsPath: '', warning: '' }
  const invalidProfile = profileProblem(profile)
  if (invalidProfile) {
    result.warning = invalidProfile
    return result
  }
  // 显式设为空串时不回退到 ~/.dsh，也不让 resolve('') 把当前工作目录当成系统配置目录。
  if (!home) {
    result.warning = '系统 DSH 配置目录为空：请设置 BLUEPRINT_SYSTEM_DSH_HOME，或先在 DSH 中配置模型'
    return result
  }
  const homePath = resolve(home)
  result.home = homePath
  const patchPath = join(homePath, 'profiles', profile, 'cordis.patch.yml')
  result.patchPath = patchPath
  let homeStat
  try { homeStat = await stat(homePath) }
  catch (error) {
    result.warning = error?.code === 'ENOENT' ? `系统 DSH 配置目录不存在：${homePath}；请先在 DSH 中配置模型`
      : `系统 DSH 配置目录无法读取：${homePath}（${error?.message}）`
    return result
  }
  if (!homeStat.isDirectory()) {
    result.warning = `系统 DSH 配置目录不是目录：${homePath}`
    return result
  }
  // 凭据路径只接受真实文件；同名目录不能当成凭据文件塞给引擎。
  const credentialsCandidate = join(homePath, '.credentials.yaml')
  if (await isFile(credentialsCandidate)) result.credentialsPath = credentialsCandidate
  let text
  try { text = await readFile(patchPath, 'utf8') }
  catch (error) {
    result.warning = error?.code === 'ENOENT' ? `系统 DSH profile 配置不存在：${patchPath}；请先在 DSH 中配置模型`
      : error?.code === 'EISDIR' ? `系统 DSH profile 配置不是文件：${patchPath}`
      : `系统 DSH profile 配置无法读取：${patchPath}（${error?.message}）`
    return result
  }
  let parsed
  try { parsed = parse(text, yamlOptions) }
  catch (error) {
    result.warning = `系统 DSH profile 配置 YAML 损坏：${patchPath}（${error?.message}）`
    return result
  }
  if (!Array.isArray(parsed)) {
    result.warning = `系统 DSH profile 配置须为补丁行列表：${patchPath}`
    return result
  }
  result.rows = parsed.filter(isProviderRow)
  result.found = true
  return result
}

export function providerPatchRows({ rows = [], credentialsPath } = {}) {
  const selected = Array.isArray(rows) ? rows.filter(isProviderRow) : []
  return credentialsPath ? [...selected, { id: 'credentials', config: { path: credentialsPath } }] : selected
}
