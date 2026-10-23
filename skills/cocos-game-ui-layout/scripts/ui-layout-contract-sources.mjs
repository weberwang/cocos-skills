import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { resolveSceneV2LayoutSource } from "../../cocos-game-workflow-control/scripts/scene-layout-decomposition-contract.mjs";

export { resolveSceneV2LayoutSource };

const REFERENCE_FIELDS = ["project_policy_file", "scene_contract_file"];

/** 判断是否为普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 把合同引用规范为项目相对路径，并拒绝绝对路径和父目录跳转。 */
function normalizeProjectPath(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${label} 必须是非空项目相对路径`);
  const normalized = value.replaceAll("\\", "/");
  if (isAbsolute(value) || win32.isAbsolute(value) || normalized.startsWith("//")) throw new Error(`${label} 不得使用绝对路径`);
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) throw new Error(`${label} 不得包含父目录跳转`);
  const clean = segments.filter((segment) => segment && segment !== ".").join("/");
  if (!clean || clean.split("/").some((segment) => segment.includes(":"))) throw new Error(`${label} 不是合法的项目相对路径`);
  return clean;
}

/** 验证真实文件也位于项目根目录，避免通过符号链接越界读取。 */
function isWithin(root, candidate) {
  const child = relative(root, candidate);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

/** 从显式 Map 注入读取纯结构测试所需的合同源。 */
export function getUiLayoutSourceFromMap(document, options = {}) {
  const sources = options.layoutSourceDocuments;
  if (!(sources instanceof Map)) throw new Error("纯结构验证必须通过 options.layoutSourceDocuments 显式提供 Map");
  const resolved = new Map();
  for (const field of REFERENCE_FIELDS) {
    const relativePath = normalizeProjectPath(document?.[field], field);
    if (!sources.has(relativePath)) throw new Error(`layoutSourceDocuments 未包含 ${relativePath}`);
    resolved.set(relativePath, sources.get(relativePath));
  }
  return resolved;
}

/** 按合同引用路径读取规范化后的 Map 文档。 */
export function getUiLayoutSourceDocument(sources, reference, field) {
  if (!(sources instanceof Map)) return undefined;
  try { return sources.get(normalizeProjectPath(reference, field)); }
  catch { return undefined; }
}

/** 从项目内 JSON 文件读取公共策略与场景合同，并校验词法和真实路径边界。 */
export async function loadUiLayoutSourceDocuments(document, projectRoot) {
  if (typeof projectRoot !== "string" || projectRoot.trim().length === 0) throw new Error("读取 UI 布局合同源必须提供 projectRoot");
  const root = resolve(projectRoot);
  let realRoot;
  try {
    realRoot = await realpath(root);
    if (!(await stat(realRoot)).isDirectory()) throw new Error("projectRoot 不是目录");
  } catch (error) {
    throw new Error(`projectRoot 不存在或无法解析：${error.message}`);
  }

  const sources = new Map();
  for (const field of REFERENCE_FIELDS) {
    const relativePath = normalizeProjectPath(document?.[field], field);
    const file = resolve(root, relativePath);
    if (!isWithin(root, file)) throw new Error(`${field} 词法路径越界`);
    let realFile;
    try {
      realFile = await realpath(file);
    } catch (error) {
      throw new Error(`${field} 文件不存在或无法解析：${relativePath}（${error.message}）`);
    }
    if (!isWithin(realRoot, realFile)) throw new Error(`${field} 真实路径越界`);
    if (!(await stat(realFile)).isFile()) throw new Error(`${field} 必须指向文件`);
    let source;
    try {
      source = JSON.parse(await readFile(realFile, "utf8"));
    } catch (error) {
      throw new Error(`${field} JSON 无效：${error.message}`);
    }
    sources.set(relativePath, source);
  }
  return sources;
}
