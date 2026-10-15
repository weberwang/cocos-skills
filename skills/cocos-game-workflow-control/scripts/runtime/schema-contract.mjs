import { readFileSync } from 'node:fs';

/** Schema 校验错误；调用方可通过 errors 获取全部结构性失败原因。 */
export class SchemaContractError extends Error {
  constructor(message, errors = []) {
    super(message);
    this.name = 'SchemaContractError';
    this.errors = errors;
  }
}

const schemaCache = new Map();

/** 读取 references 中的 JSON Schema，并在进程内缓存不可变解析结果。 */
export function loadSchema(schemaFile) {
  const key = String(schemaFile);
  if (!schemaCache.has(key)) {
    const url = new URL(`../../references/${key}`, import.meta.url);
    schemaCache.set(key, JSON.parse(readFileSync(url, 'utf8')));
  }
  return schemaCache.get(key);
}

/** 按 JSON Pointer 风格路径解析 Schema 节点，并解析本文件内的 $ref。 */
export function schemaNode(schemaFile, path = []) {
  const root = loadSchema(schemaFile);
  let node = root;
  for (const segment of path) {
    node = node?.[segment];
    if (node === undefined) throw new SchemaContractError(`Schema ${schemaFile} 缺少节点：${path.join('.')}`);
  }
  return resolveSchemaRef(root, node);
}

/** 解析当前 Schema 的内部引用；外部引用不属于本项目合同的支持范围。 */
function resolveSchemaRef(root, node) {
  let current = node;
  const seen = new Set();
  while (current && typeof current === 'object' && typeof current.$ref === 'string' && current.$ref.startsWith('#/')) {
    if (seen.has(current.$ref)) throw new SchemaContractError(`Schema 循环引用：${current.$ref}`);
    seen.add(current.$ref);
    current = current.$ref.slice(2).split('/').map((part) => part.replaceAll('~1', '/').replaceAll('~0', '~')).reduce((value, part) => value?.[part], root);
    if (current === undefined) throw new SchemaContractError(`Schema 引用不存在：${[...seen].at(-1)}`);
  }
  return current;
}

/** 返回 Schema 节点的必填字段；运行时不再维护平行 required 数组。 */
export function schemaRequired(schemaFile, path = []) {
  return Object.freeze([...(schemaNode(schemaFile, path).required ?? [])]);
}

/** 返回 Schema 节点直接声明的字段；additionalProperties=false 时用于统一拒绝未知字段。 */
export function schemaFields(schemaFile, path = []) {
  return Object.freeze(Object.keys(schemaNode(schemaFile, path).properties ?? {}));
}

/** 返回 Schema 节点枚举；动作、状态和门集合只从 references Schema 派生。 */
export function schemaEnum(schemaFile, path = []) {
  return Object.freeze([...(schemaNode(schemaFile, path).enum ?? [])]);
}

/** 返回可复用的结构合同摘要，供记录校验器共享。 */
export function schemaContract(schemaFile, path = []) {
  const node = schemaNode(schemaFile, path);
  return Object.freeze({
    schemaFile,
    path: Object.freeze([...path]),
    required: schemaRequired(schemaFile, path),
    fields: schemaFields(schemaFile, path),
    additionalProperties: node.additionalProperties !== false,
  });
}
