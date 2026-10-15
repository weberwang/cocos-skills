#!/usr/bin/env node

/**
 * 工作流路径模式匹配器。
 *
 * ownedPaths/outputPaths/委派 ownership 使用同一套语义，避免控制面保护
 * 目录只实现了字面前缀而被 `**`、目录通配符或对象型路径绕过。
 */

/** 规范化路径模式，但保留通配符用于后续匹配。 */
export function normalizePathPattern(value) {
  return String(value ?? "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
}

/** 使用工作流完整 `*`/`**` 语义匹配仓库相对路径。 */
export function pathMatches(path, pattern) {
  const target = normalizePathPattern(path); const clean = normalizePathPattern(pattern);
  if (!target || !clean) return false;
  if (!clean.includes("*")) return target === clean || target.startsWith(`${clean}/`);
  const escaped = clean.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("**", "\u0000").replaceAll("*", "[^/]*").replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`).test(target);
}

/** 判断声明模式是否覆盖某个受保护目标。 */
export function pathPatternCoversTarget(pattern, target) { return pathMatches(target, pattern); }
