import { resolveOutputMetadata } from "../../cocos-game-workflow-control/scripts/visual-raster-contract.mjs";
import { normalizeProjectRelativePath, resolveProductionContract } from "../../cocos-game-workflow-control/scripts/visual-production-contract.mjs";
import { creatorResourcePathForFile, validateCreatorResourcePlacement } from "./creator-resource-location.mjs";

/** 统一已有输出合同使用的文件路径分隔符。 */
function normalizedFile(value) {
  return typeof value === "string" ? value.replaceAll("\\", "/") : "";
}

/** 文件身份沿用项目路径比较规则，加载键自身仍保留真实文件的大小写。 */
function fileIdentity(value) {
  return normalizeProjectRelativePath(value) ?? normalizedFile(value);
}

/** 按现有权威解析器收集正式输出，不把只读生产源文件误当成新交付目标。 */
function formalOutputs(asset) {
  const contract = resolveProductionContract(asset);
  const output = resolveOutputMetadata({ ...asset, source_file: undefined });
  const paths = [
    ...(Array.isArray(asset.runtime_outputs) ? asset.runtime_outputs : []),
    ...(Array.isArray(asset.runtimeOutputs) ? asset.runtimeOutputs : []),
    asset.runtime_file, output.file,
    ...(Array.isArray(contract.expected_assets) ? contract.expected_assets.map((item) => item?.runtime_file) : []),
  ].filter((file) => typeof file === "string" && file.length > 0).map(normalizedFile);
  const identities = new Map();
  // 规范化生产合同会折叠大小写；保留优先级更高的真实输出拼写，避免重复误判。
  for (const file of paths) if (!identities.has(fileIdentity(file))) identities.set(fileIdentity(file), file);
  return [...identities.values()];
}

/** 校验普通资产的目录用途；Scene 引用和 Asset Bundle 不需要 resources 声明。 */
export function validateAssetResourceLocations(asset, errors = [], label = "asset") {
  let outputs;
  try { outputs = formalOutputs(asset); }
  catch (error) { errors.push(`${label} 无法解析正式资源目录：${error.message}`); return errors; }
  const resourcesFiles = outputs.filter((file) => creatorResourcePathForFile(file) !== undefined);
  const loading = asset.resource_loading;
  const validDeclaration = loading !== null && typeof loading === "object" && !Array.isArray(loading)
    && Object.keys(loading).length === 1 && ["resources.load", "resources.loadDir"].includes(loading.method);
  if (loading !== undefined && !validDeclaration) errors.push(`${label}.resource_loading 必须只声明 method=resources.load 或 resources.loadDir`);
  if (validDeclaration && resourcesFiles.length === 0) errors.push(`${label}.resource_loading 未绑定任何 assets/resources 运行资源`);
  const sheet = asset.frame_animation?.spritesheet;
  for (const file of resourcesFiles) {
    // 图集显式加载键仅授权对应文件；通用声明不会自动生成工具或报告的加载键。
    const matchesSheet = sheet && fileIdentity(sheet.file) === fileIdentity(file);
    const explicitKey = matchesSheet ? sheet.creator_resource_path : undefined;
    const key = explicitKey ?? (validDeclaration ? creatorResourcePathForFile(file) : undefined);
    validateCreatorResourcePlacement(explicitKey !== undefined ? sheet.file : file, key, errors, `${label}.runtime_outputs`);
  }
  return errors;
}
