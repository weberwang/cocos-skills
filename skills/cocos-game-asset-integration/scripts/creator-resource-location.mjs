import { extname, posix } from "node:path";

/** 统一文件路径分隔符；资源存放策略不依赖当前执行平台。 */
function normalizedFile(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/") : "";
}

/** 校验 resources.load 使用的无扩展名相对标识，拒绝编码路径逃逸。 */
export function isCreatorResourcePath(value) {
  if (typeof value !== "string" || !value || value.trim() !== value) return false;
  let decoded = value;
  for (let round = 0; round < 4; round += 1) {
    if (/\s/u.test(decoded) || decoded.includes("\\") || decoded.startsWith("/")
      || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(decoded) || /[?#]/u.test(decoded)
      || decoded.split("/").some((segment) => !segment || segment === "." || segment === "..")) return false;
    let next;
    try { next = decodeURIComponent(decoded); } catch { return false; }
    if (next === decoded) return !extname(decoded.split("/").at(-1));
    decoded = next;
  }
  return false;
}

/** 读取真实 resources 目录内文件对应的加载键；普通资产不伪造动态加载标识。 */
export function creatorResourcePathForFile(file) {
  // 目录策略按实际落盘位置判断，不能用 a/../resources 等等价写法隐藏特殊目录。
  const segments = posix.normalize(normalizedFile(file)).split("/");
  const index = segments.findIndex((segment, position) => segment.toLowerCase() === "assets"
    && segments[position + 1]?.toLowerCase() === "resources");
  if (index < 0) return undefined;
  const relativePath = segments.slice(index + 2).join("/");
  const extension = extname(relativePath);
  return extension ? relativePath.slice(0, -extension.length) : relativePath;
}

/** 仅显式动态加载声明允许进入 resources，且加载键必须对应实际 PNG 导入位置。 */
export function validateCreatorResourcePlacement(file, resourcePath, errors = [], label = "spritesheet") {
  const expected = creatorResourcePathForFile(file);
  if (resourcePath === undefined) {
    if (expected !== undefined) errors.push(`${label}.file 只有显式动态加载的资源才可放入 assets/resources；请声明 creator_resource_path 或改用普通 assets 分类目录`);
    return errors;
  }
  if (!isCreatorResourcePath(resourcePath)) errors.push(`${label}.creator_resource_path 必须是相对 assets/resources 的无扩展资源名`);
  if (expected === undefined) errors.push(`${label}.creator_resource_path 仅用于 resources 动态加载，实际文件必须位于 assets/resources`);
  else if (resourcePath !== expected) errors.push(`${label}.creator_resource_path 必须与实际文件相对 assets/resources 的无扩展路径一致：${expected}`);
  return errors;
}
