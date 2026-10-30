/** 只精简模型收到的说明；执行函数、参数约束和未知字段原样保留。 */
import { 原生工具文案 } from '../../prompt/src/index.js'

export function 精简工具文案(tool, 文案 = 原生工具文案()) {
  const 配置 = 文案[tool?.name]
  if (!配置 || !tool.parameters || typeof tool.parameters !== 'object') return tool
  const 字段 = 配置.parameters || {}
  const 根字段 = tool.parameters.properties || tool.parameters
  if (Object.keys(字段).length && !Object.keys(字段).some(path => Object.hasOwn(根字段, path.split(/[.\[]/)[0]))) return tool
  const 换字段 = (schema, path) => {
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
    let out = schema
    if (Object.hasOwn(字段, path) && (字段[path] === null
      ? Object.hasOwn(schema, 'description') : schema.description !== 字段[path])) {
      out = { ...schema }
      if (字段[path] === null) delete out.description
      else out.description = 字段[path]
    }
    if (schema.properties) {
      const entries = Object.entries(schema.properties)
        .map(([name, value]) => [name, 换字段(value, path ? `${path}.${name}` : name)])
      if (entries.some(([name, value]) => value !== schema.properties[name])) {
        out = { ...out, properties: Object.fromEntries(entries) }
      }
    }
    if (schema.items) {
      const items = 换字段(schema.items, `${path}[]`)
      if (items !== schema.items) out = { ...out, items }
    }
    return out
  }
  const parameters = tool.parameters.properties
    ? 换字段(tool.parameters, '')
    : Object.fromEntries(Object.entries(tool.parameters).map(([name, schema]) => [name, 换字段(schema, name)]))
  return { ...tool, description: 配置.description, parameters }
}

/** 用法已在对应工具说明中，系统正文不再重复；没换工具时保留原生辅助段。 */
export function 重复工具段(section, tools, 文案 = 原生工具文案()) {
  const name = section?.name?.startsWith('tool:') && section.name.slice(5)
  return ['bash', 'read', 'write', 'edit', 'glob', 'grep'].includes(name)
    && tools?.some(tool => tool?.name === name && tool.description === 文案[name]?.description)
}
