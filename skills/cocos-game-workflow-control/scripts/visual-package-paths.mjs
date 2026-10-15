import { canonicalStateId, normalizeComponentExpectedAsset, normalizeProjectRelativePath } from "./visual-component-contract.mjs";

/** 解析文件/路径输出声明；双字段或双 share 别名都属于歧义合同，不能静默择一。 */
export function declaredPathEntry(item) {
  if (typeof item === "string") return { path: item, shareId: null, valid: true };
  if (item === null || typeof item !== "object" || Array.isArray(item)) return { path: "", shareId: null, valid: false, reason: "必须是路径字符串或对象" };
  const hasFile = Object.hasOwn(item, "file");
  const hasPath = Object.hasOwn(item, "path");
  const hasShareId = Object.hasOwn(item, "share_id");
  const hasShareAlias = Object.hasOwn(item, "shareId");
  if (hasFile === hasPath) return { path: "", shareId: null, valid: false, reason: "必须且只能声明 file 或 path 之一" };
  if (hasShareId && hasShareAlias) return { path: "", shareId: null, valid: false, reason: "share_id 与 shareId 不得同时声明" };
  return { path: hasFile ? item.file : item.path, shareId: hasShareId ? item.share_id : (hasShareAlias ? item.shareId : null), valid: true };
}

/** 判断 expected asset 是否同时使用两个共享字段别名，避免比较和范围校验各取一边。 */
export function hasShareAliasConflict(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.hasOwn(value, "share_id") && Object.hasOwn(value, "shareId");
}

/** 检查区域/资产合同中的 expected_assets 是否混用 share_id 与 shareId。 */
export function reportExpectedAssetShareAliasConflicts(value, report = () => {}) {
  const nested = value?.production_contract ?? value?.productionContract;
  const lists = [value?.expected_assets, value?.expectedAssets, nested?.expected_assets, nested?.expectedAssets];
  lists.filter(Array.isArray).forEach((items) => items.forEach((item, index) => {
    if (hasShareAliasConflict(item)) report(`expected_assets[${index}] share_id 与 shareId 不得同时声明`, { missing: `expected_assets[${index}].share_id` });
  }));
}

/** 将部件资产归一化为 component×state 主键，防止执行包偷偷替换 asset_id 或文件。 */
export function componentAssetKey(value) {
  const asset = normalizeComponentExpectedAsset(value);
  return `${asset.component_id}\0${asset.canonical_state_id || canonicalStateId(asset.state_id)}`;
}

/** 判断一个项目内路径是否被文件或目录声明覆盖。 */
export function pathCoveredBy(path, declaredPaths = []) {
  const normalized = normalizeProjectRelativePath(path);
  if (!normalized || !Array.isArray(declaredPaths)) return false;
  return declaredPaths.some((item) => {
    const declared = declaredPathEntry(item);
    if (!declared.valid) return false;
    const value = normalizeProjectRelativePath(declared.path);
    return Boolean(value && (normalized === value || normalized.startsWith(`${value}/`)));
  });
}

/** 校验实施单元声明的路径，并应用 Implementation Package allowedPaths。 */
export function validateUnitPathDeclarations(paths, label, options = {}, report = () => {}) {
  const entries = Array.isArray(paths) ? paths : [];
  const normalized = [];
  for (const item of entries) {
    const declared = declaredPathEntry(item);
    if (!declared.valid) { report(`${label} ${declared.reason}`, { missing: label }); continue; }
    const raw = declared.path;
    const value = normalizeProjectRelativePath(raw);
    if (!value) { report(`${label} 必须是项目内相对路径，不能使用绝对路径或路径逃逸`, { missing: raw || label }); continue; }
    normalized.push(value);
    if (Array.isArray(options.allowedPaths) && options.allowedPaths.length && typeof options.pathMatches === "function") {
      // allowedPaths 也必须经过同一安全规范化；非法候选不能通过降级字符串比较绕过路径门。
      const allowed = options.allowedPaths.some((candidate) => {
        const normalizedCandidate = normalizeProjectRelativePath(candidate);
        return Boolean(normalizedCandidate && options.pathMatches(value, normalizedCandidate));
      });
      if (!allowed) report(`${label} 超出 allowedPaths：${raw}`, { missing: raw });
    }
  }
  return normalized;
}

/** 登记跨单元物理路径身份；非 图像生成 仅允许同 owner 同 share_id 共享，图像生成 永不共享。 */
export function registerCrossUnitPath(registry, path, kind, unit, shareId, report = () => {}) {
  const normalized = normalizeProjectRelativePath(path);
  if (!normalized) return;
  const isImageGeneration = unit?.image_generation_required === true || unit?.production_method === "image-generation";
  for (const [previousPath, previous] of registry.entries()) {
    const overlaps = previousPath === normalized || previousPath.startsWith(`${normalized}/`) || normalized.startsWith(`${previousPath}/`);
    if (!overlaps) continue;
    if (previous.unitId === unit.unitId) {
      // 同一单元允许目录覆盖自己的文件，但同一物理路径不能出现两个不同的共享身份。
      if (previousPath === normalized && previous.shareId !== shareId && (previous.shareId || shareId)) report(`${kind} 与同一单元既有声明的 share_id 不一致：${path}`);
      continue;
    }
    const previousImageGeneration = previous.imageGenerationRequired === true;
    const sharedAllowed = !isImageGeneration && !previousImageGeneration && shareId && previous.shareId === shareId && previous.owner === unit.owner;
    if (!sharedAllowed) report(`${kind} 路径与其他单元冲突：${path}`);
  }
  if (!registry.has(normalized)) registry.set(normalized, { unitId: unit.unitId, owner: unit.owner, shareId, kind, imageGenerationRequired: isImageGeneration });
}
