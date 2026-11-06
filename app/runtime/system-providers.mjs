// 只读导入系统 DSH profile 的模型 provider 行与凭据文件路径；导入失败只给 warning，不阻断启动。
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse } from 'yaml'

export const SYSTEM_PROVIDER_ROW_IDS = ['agent-default-model', 'llm-pi-ai', 'llm-deepseek', 'llm-deepseek-account']

function environmentValue(environment, name) {
  const value = environment?.[name]
  return typeof value === 'string' ? value : ''
}

export function systemDshHome(environment = process.env) {
  return environmentValue(environment, 'BLUEPRINT_SYSTEM_DSH_HOME') || join(homedir(), '.dsh')
}

export function systemDshProfile(environment = process.env) {
  return environmentValue(environment, 'BLUEPRINT_SYSTEM_DSH_PROFILE') || 'desktop'
}

function isProviderRow(row) {
  return !!row && typeof row === 'object' && !Array.isArray(row) && SYSTEM_PROVIDER_ROW_IDS.includes(row.id)
}

export async function readSystemProviderRows({ environment = process.env } = {}) {
  const home = systemDshHome(environment)
  const profile = systemDshProfile(environment)
  const patchPath = join(home, 'profiles', profile, 'cordis.patch.yml')
  const credentialsCandidate = join(home, '.credentials.yaml')
  const credentialsPath = existsSync(credentialsCandidate) ? credentialsCandidate : ''
  const result = { found: false, home, profile, patchPath, rows: [], credentialsPath, warning: '' }
  if (!existsSync(home)) {
    result.warning = `系统 DSH 配置目录不存在：${home}；请先在 DSH 中配置模型`
    return result
  }
  let text
  try { text = await readFile(patchPath, 'utf8') }
  catch (error) {
    result.warning = error?.code === 'ENOENT' ? `系统 DSH profile 配置不存在：${patchPath}；请先在 DSH 中配置模型`
      : `系统 DSH profile 配置无法读取：${patchPath}（${error?.message}）`
    return result
  }
  let parsed
  try { parsed = parse(text) }
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
