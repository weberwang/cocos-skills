import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { ReskinError } from "./spine_atlas.mjs";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/** 递归列出资源目录中的文件，顺序固定以保证发现结果可复现。 */
async function listFiles(root, cursor = root) {
  const entries = (await readdir(cursor, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const path = join(cursor, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(root, path));
    else if (entry.isFile()) files.push(path);
  }
  return files.sort((left, right) => relative(root, left).localeCompare(relative(root, right)));
}

/** 尝试解析 JSON；普通独立 Skeleton 之外的 JSON 作为 Cocos 容器候选。 */
async function readJson(path) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

/** 在 Cocos sp.SkeletonData 数组容器中寻找 _atlasText/_skeletonJson 对。 */
function findCocosContainer(value, path = []) {
  if (Array.isArray(value)) for (let index = 0; index < value.length; index += 1) { const found = findCocosContainer(value[index], [...path, index]); if (found) return found; }
  else if (value && typeof value === "object") {
    if (typeof value._atlasText === "string" && value._skeletonJson != null) return { value, path };
    for (const [key, child] of Object.entries(value)) { const found = findCocosContainer(child, [...path, key]); if (found) return found; }
  }
  return null;
}

/** 从 Atlas 文本读取 Page Header，不依赖图片截图或人工测量。 */
function pageNames(atlasText) {
  const lines = atlasText.replaceAll("\r\n", "\n").split("\n");
  const names = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    const next = lines[index + 1]?.trim() ?? "";
    if (line && !line.includes(":") && next.toLowerCase().startsWith("size:")) names.push(line);
  }
  return [...new Set(names)];
}

/** 收集 Cocos 容器中显式纹理映射的文件名，不把 Atlas 文本当成纹理。 */
function textureCandidates(value, key = "") {
  const result = [];
  if (typeof value === "string") {
    const extension = extname(value).toLowerCase();
    if (IMAGE_EXTENSIONS.has(extension) && /(texture|page|atlas|image|file|path)/i.test(key)) result.push(value);
  } else if (Array.isArray(value)) for (const child of value) result.push(...textureCandidates(child, key));
  else if (value && typeof value === "object") for (const [childKey, child] of Object.entries(value)) result.push(...textureCandidates(child, `${key}.${childKey}`));
  return result;
}

/** 选择标准独立 Skeleton+Atlas 对，多个不明确候选直接失败。 */
async function selectIndependent(files) {
  const atlases = files.filter((path) => extname(path).toLowerCase() === ".atlas");
  if (atlases.length !== 1) throw new ReskinError(`资源目录必须有且只有一个独立 Atlas：找到 ${atlases.length} 个`);
  const atlasPath = atlases[0];
  const jsonFiles = files.filter((path) => extname(path).toLowerCase() === ".json");
  const matching = jsonFiles.filter((path) => basename(path, ".json") === basename(atlasPath, ".atlas"));
  const skeletonCandidates = (matching.length ? matching : jsonFiles).filter((path) => path !== atlasPath);
  let skeletonPath = null;
  for (const path of skeletonCandidates) {
    const value = await readJson(path);
    if (value && value.skeleton && typeof value.skeleton === "object") { skeletonPath = path; break; }
  }
  if (!skeletonPath) throw new ReskinError("资源目录未找到包含 skeleton 元数据的独立 Skeleton JSON");
  return { format: "independent", source_dir: resolve(dirname(atlasPath)), atlas_path: atlasPath, skeleton_path: skeletonPath, container_path: null };
}

/** 发现独立导出或 Cocos 容器，发现阶段只读源目录。 */
export async function discoverSpineAsset(sourceDir) {
  const root = resolve(sourceDir);
  if (!(await stat(root)).isDirectory()) throw new ReskinError(`原版资源目录不存在：${root}`);
  const files = await listFiles(root);
  for (const path of files.filter((item) => extname(item).toLowerCase() === ".json")) {
    const value = await readJson(path);
    const container = findCocosContainer(value);
    if (container) return { format: "cocos-skeleton-data", source_dir: root, container_path: path, container: container.value };
  }
  return selectIndependent(files);
}

/** 将 Cocos 容器确定性导出为独立 JSON/Atlas/Page 候选，绝不改写源目录。 */
export async function prepareSpineAsset(sourceDir, outputDir) {
  const discovered = await discoverSpineAsset(sourceDir);
  if (discovered.format === "independent") return discovered;
  const output = resolve(outputDir ?? join(resolve(sourceDir), ".spine-normalized"));
  await mkdir(output, { recursive: true });
  const container = discovered.container;
  let skeletonValue = container._skeletonJson;
  if (typeof skeletonValue === "string") { try { skeletonValue = JSON.parse(skeletonValue); } catch (error) { throw new ReskinError(`Cocos _skeletonJson 不是 JSON：${error.message}`); } }
  if (!skeletonValue || typeof skeletonValue !== "object" || Array.isArray(skeletonValue)) throw new ReskinError("Cocos _skeletonJson 必须导出为 Skeleton JSON 对象");
  const atlasText = container._atlasText;
  const pages = pageNames(atlasText);
  if (!pages.length) throw new ReskinError("Cocos _atlasText 未发现 Atlas Page Header");
  const candidates = textureCandidates(container);
  const sourceRoot = resolve(sourceDir);
  const pagePaths = [];
  for (let index = 0; index < pages.length; index += 1) {
    const pageName = pages[index];
    const exact = candidates.find((candidate) => basename(candidate) === basename(pageName));
    const candidate = exact ?? candidates[index] ?? pageName;
    const sourcePath = resolve(sourceRoot, candidate);
    if (!(await stat(sourcePath).catch(() => null))?.isFile()) throw new ReskinError(`Cocos Atlas Page 映射缺失：${pageName}`);
    const outputPath = resolve(output, pageName);
    if (!outputPath.startsWith(`${output}${process.platform === "win32" ? "\\" : "/"}`)) throw new ReskinError(`Cocos Page 名越出规范化目录：${pageName}`);
    await mkdir(dirname(outputPath), { recursive: true });
    await copyFile(sourcePath, outputPath);
    pagePaths.push({ name: pageName, source_path: outputPath, source_sha256: createHash("sha256").update(await readFile(sourcePath)).digest("hex") });
  }
  const stem = "normalized-spine";
  const skeletonPath = join(output, `${stem}.json`);
  const atlasPath = join(output, `${stem}.atlas`);
  await writeFile(skeletonPath, `${JSON.stringify(skeletonValue, null, 2)}\n`, "utf8");
  await writeFile(atlasPath, atlasText.endsWith("\n") ? atlasText : `${atlasText}\n`, "utf8");
  return { format: discovered.format, source_dir: sourceRoot, container_path: discovered.container_path, atlas_path: atlasPath, skeleton_path: skeletonPath, page_paths: pagePaths, exported_dir: output, source_container_sha256: createHash("sha256").update(await readFile(discovered.container_path)).digest("hex") };
}
