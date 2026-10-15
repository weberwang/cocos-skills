#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "../../cocos-game-workflow-control/scripts/runtime/image-runtime.mjs";
import { atlasText, parseAtlas, ReskinError } from "./spine_atlas.mjs";
import { blankRgba, cropRgba, decodeRgba, encodePng, extractReferences, hasVisibleAlpha, normalizeCellImage, outputPageName, pasteRgba, prepareCellImage, validateCellImageDimensions } from "./spine_images.mjs";
import { auditSkeleton, COCOS_SPINE_RUNTIME_DEFAULT } from "./spine_skeleton.mjs";
import { acceptanceFingerprint, assertCurrentBatch, batchCells, validateEffectSequence } from "./spine_batch.mjs";
import { buildRuntimeBinding, readRuntimeReport, validateRuntimeReport, validateVerification, writeFinalReport } from "./spine_runtime.mjs";
import { assertProductionReady, createBatchCommands } from "./spine_batch_commands.mjs";
import { prepareSpineAsset } from "./spine_assets.mjs";
import { assertSpineControlBinding, readSpineControlBinding } from "./spine_control.mjs";
import { createSkeletonAuditIntegrity } from "./spine_integrity.mjs";
import { createAlphaContract } from "./spine_alpha.mjs";
import { validatePackedContent } from "./spine_build_validation.mjs";

const SCHEMA_VERSION = 3;
const LOCK_TIMEOUT_MS = 30_000;
const LOCK_STALE_MS = 120_000;
export const MODES = ["palette-refresh", "mesh-safe", "constrained-redraw"];
/** 受约束换皮的 alpha 结构合同阈值，所有阈值都在同一正向裁剪坐标系中计算。 */
export const ALPHA_CONTRACT_THRESHOLDS = Object.freeze({
  palette_refresh_max_mask_mismatch: 0,
  mesh_safe_min_iou: 0.85,
  mesh_safe_max_bbox_drift: 0.1,
  constrained_redraw_min_iou: 0.45,
  constrained_redraw_max_centroid_drift: 0.35,
});
export const STATUSES = ["pending", "generating", "generated", "validating", "packing", "packed", "runtime_validating", "completed", "failed"];
const MARKABLE_STATUSES = new Set(["pending", "generating", "generated", "failed"]);
const ALLOWED_TRANSITIONS = {
  pending: new Set(["pending", "generating", "generated", "failed"]),
  generating: new Set(["pending", "generating", "generated", "failed"]),
  generated: new Set(["pending", "generated", "validating", "failed"]),
  validating: new Set(["pending", "validating", "packing", "failed"]),
  packing: new Set(["pending", "validating", "packing", "packed", "failed"]),
  packed: new Set(["packed", "runtime_validating", "failed"]),
  runtime_validating: new Set(["pending", "packed", "runtime_validating", "completed", "failed"]),
  completed: new Set(["completed"]),
  failed: new Set(["failed", "pending", "generating"]),
};

/** 返回带 UTC 时区的秒级 ISO 时间戳。 */
function now() { return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString().replace(".000Z", "+00:00"); }

/** 检查路径是否为普通文件。 */
async function isFile(path) { try { return (await stat(path)).isFile(); } catch { return false; } }

/** 检查路径是否存在。 */
async function exists(path) { try { await access(path, constants.F_OK); return true; } catch { return false; } }

/** 计算文件 SHA-256，所有审计记录都基于文件字节而非图片解码结果。 */
export async function sha256(path) { return createHash("sha256").update(await readFile(path)).digest("hex"); }

/** 原子写入 JSON 清单，随机临时名避免并行进程碰撞。 */
async function writeJsonAtomic(path, document) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${path.split(/[\\/]/).at(-1)}.tmp-${process.pid}-${randomUUID()}`);
  try {
    await writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/** 等待短时间，不使用长阻塞等待，给持有锁的进程留下恢复机会。 */
function wait(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }

/** 判断进程是否仍存活；EPERM 代表进程存在但当前用户无权探查。 */
export function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === "EPERM"; }
}

/** 只有锁过期且记录的持有进程已退出时才允许回收。 */
export function shouldReclaimLock(lockRecord, mtimeMs, currentTime = Date.now()) {
  return currentTime - mtimeMs > LOCK_STALE_MS && !isProcessAlive(lockRecord?.pid);
}

/** 使用 wx 创建跨进程锁，并自动回收超过陈旧阈值的锁。 */
async function acquireManifestLock(manifestPath) {
  const lockPath = `${manifestPath}.lock`;
  const started = Date.now();
  while (Date.now() - started < LOCK_TIMEOUT_MS) {
    let handle;
    const token = randomUUID();
    try {
      handle = await open(lockPath, "wx");
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, created_at: new Date().toISOString() }), "utf8");
      await handle.close();
      return async () => {
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8"));
          if (current.token === token) await rm(lockPath, { force: true });
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      };
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      if (error.code !== "EEXIST") throw error;
      try {
        const lockStat = await stat(lockPath);
        let lockRecord;
        try { lockRecord = JSON.parse(await readFile(lockPath, "utf8")); } catch { lockRecord = null; }
        if (shouldReclaimLock(lockRecord, lockStat.mtimeMs)) await rm(lockPath, { force: true });
      } catch (statError) {
        if (statError.code !== "ENOENT") throw statError;
      }
      await wait(50);
    }
  }
  throw new ReskinError(`无法获得清单锁（超过 ${LOCK_TIMEOUT_MS}ms）：${lockPath}`);
}

/** 在独占清单锁内执行所有会修改进度的命令。 */
async function withManifestLock(manifestPath, action) {
  const release = await acquireManifestLock(manifestPath);
  try { return await action(); } finally { await release(); }
}

/** 读取并检查 schema v3 清单根结构；旧版清单不提供兼容路径。 */
export async function readManifest(path) {
  let document;
  try { document = JSON.parse(await readFile(path, "utf8")); } catch (error) { throw new ReskinError(`无法读取进度清单 ${path}：${error.message}`); }
  if (!document || typeof document !== "object" || document.schema_version !== SCHEMA_VERSION) throw new ReskinError(`进度清单必须使用 schema_version=${SCHEMA_VERSION}`);
  if (!Array.isArray(document.cells) || !document.atlas || typeof document.atlas !== "object") throw new ReskinError("进度清单缺少 atlas 或 cells");
  if (!Array.isArray(document.skeletons) || document.skeletons.length < 1) throw new ReskinError("进度清单至少需要一个实际 Skeleton 记录");
  if (!document.target_runtime || typeof document.target_runtime !== "string") throw new ReskinError("进度清单缺少 target_runtime");
  if (!document.skeleton_audit || typeof document.skeleton_audit !== "object") throw new ReskinError("进度清单缺少 skeleton_audit");
  if (!document.visual_contract || typeof document.visual_contract !== "object") throw new ReskinError("进度清单缺少 visual_contract");
  if (!document.control_binding || typeof document.control_binding !== "object") throw new ReskinError("进度清单缺少 control_binding");
  if (!Array.isArray(document.batches)) throw new ReskinError("进度清单缺少 batches 数组");
  if (![
    "independent-validation-candidate",
    "integrated-main-game",
  ].includes(document.delivery_mode ?? "independent-validation-candidate")) throw new ReskinError("delivery_mode 必须是 independent-validation-candidate 或 integrated-main-game");
  return document;
}

/** 优先保存相对候选目录的路径，跨目录时保留绝对路径以便审计。 */
function relativePath(path, base) {
  const rel = relative(resolve(base), resolve(path));
  return !rel.startsWith("..") && !isAbsolute(rel) ? rel.replaceAll("\\", "/") : resolve(path);
}

/** 将清单内相对路径解析到清单目录。 */
export function resolveArtifact(manifestPath, value) { if (!value) return null; return isAbsolute(value) ? value : resolve(dirname(manifestPath), value); }

/** 判断路径是否位于目录内（包含目录自身），Windows 下不区分盘符大小写。 */
function isWithin(root, target) {
  const rootValue = resolve(root);
  const targetValue = resolve(target);
  const rootForCompare = process.platform === "win32" ? rootValue.toLowerCase() : rootValue;
  const targetForCompare = process.platform === "win32" ? targetValue.toLowerCase() : targetValue;
  const rel = relative(rootForCompare, targetForCompare);
  return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`));
}

/** 返回路径的真实位置，用于防止通过符号链接或符号链接父目录绕过路径保护。 */
async function realOrResolved(path) {
  const resolved = resolve(path);
  try { return await realpath(resolved); } catch {
    const tail = [];
    let cursor = resolved;
    while (!(await exists(cursor)) && resolve(cursor) !== dirname(cursor)) {
      tail.unshift(cursor.split(/[\\/]/).at(-1));
      cursor = dirname(cursor);
    }
    try { return resolve(await realpath(cursor), ...tail); } catch { return resolved; }
  }
}

/** 更新清单根时间。 */
function touch(document) { document.updated_at = now(); }

/** 按稳定 ID 查找 Cell。 */
function getCell(document, id) { const cell = document.cells.find((item) => item.id === id); if (!cell) throw new ReskinError(`找不到 Cell：${id}`); return cell; }

/** 追加不可变状态或审计事件。 */
function record(document, cell, event, extra = {}) { (cell.history ??= []).push({ event, at: now(), ...extra }); touch(document); }

/** 执行状态机转移；命令层另行限制可由 mark 手动触发的状态。 */
function transition(document, cell, status, error = null) {
  if (!STATUSES.includes(status)) throw new ReskinError(`未知状态：${status}`);
  const old = cell.status ?? "pending";
  if (!ALLOWED_TRANSITIONS[old]?.has(status)) throw new ReskinError(`Cell ${cell.id} 不允许从 ${old} 转为 ${status}`);
  if (status === "generating" && old !== "generating") cell.attempts = Number(cell.attempts ?? 0) + 1;
  cell.status = status;
  cell.last_error = error;
  record(document, cell, "status", { status, error });
}

/** 规范化路径并拒绝同一 Page 的输出名碰撞。 */
function assignOutputNames(pages) {
  const names = new Map();
  for (const page of pages) {
    const name = outputPageName(page);
    const key = name.toLowerCase();
    if (names.has(key)) throw new ReskinError(`不同 Page 映射到同一输出名：${names.get(key)} 与 ${page.name} -> ${name}`);
    page.output_name = name;
    names.set(key, page.name);
  }
}

/** 读取源文件记录，确保 init 不接受缺失的 Skeleton 或风格参考。 */
async function sourceRecord(path, label) {
  const resolved = resolve(path);
  if (!await isFile(resolved)) throw new ReskinError(`${label} 文件不存在：${resolved}`);
  return { path: resolved, sha256: await sha256(resolved) };
}

/** 从 Atlas 建立完整初始 schema v3 清单，并核对 Skeleton、Page 与视觉合同输入。 */
export async function buildManifest(atlasPath, outputPath, styleReferences = [], skeletonPaths = [], options = {}) {
  if (!Array.isArray(skeletonPaths) || skeletonPaths.length < 1) throw new ReskinError("init 必须提供一个或多个 --skeleton");
  const parsed = await parseAtlas(atlasPath);
  if (!parsed.cells.length) throw new ReskinError("Atlas 没有可换皮的 Region");
  const pages = [];
  for (const page of parsed.pages) {
    const source = resolve(dirname(atlasPath), page.name);
    if (!await isFile(source)) throw new ReskinError(`Atlas Page 文件不存在：${source}`);
    let metadata;
    try { metadata = await sharp(source).metadata(); } catch (error) { throw new ReskinError(`无法读取 Page ${page.name}：${error.message}`); }
    if (metadata.width !== page.width || metadata.height !== page.height) throw new ReskinError(`Page ${page.name} 声明尺寸 ${page.width},${page.height} 与实际图片 ${metadata.width ?? 0},${metadata.height ?? 0} 不一致`);
    pages.push({ ...page, source_path: source, sha256: await sha256(source) });
  }
  assignOutputNames(pages);
  const skeletons = [];
  const seenSkeletons = new Set();
  for (const skeleton of skeletonPaths) {
    const recordValue = await sourceRecord(skeleton, "Skeleton");
    if (seenSkeletons.has(recordValue.path)) throw new ReskinError(`重复 Skeleton：${recordValue.path}`);
    seenSkeletons.add(recordValue.path);
    skeletons.push(recordValue);
  }
  const style = [];
  const seenStyles = new Set();
  for (const reference of styleReferences) {
    const recordValue = await sourceRecord(reference, "style reference");
    if (seenStyles.has(recordValue.path)) continue;
    seenStyles.add(recordValue.path);
    style.push(recordValue);
  }
  const targetRuntime = String(options.targetRuntime ?? COCOS_SPINE_RUNTIME_DEFAULT);
  const skeletonAudit = await auditSkeleton(skeletons[0].path, parsed, targetRuntime);
  if (skeletonAudit.missing_atlas_regions.length || skeletonAudit.unused_atlas_regions.length || skeletonAudit.duplicate_atlas_regions.length) throw new ReskinError(`Skeleton/Atlas Region 映射不完整：missing=${skeletonAudit.missing_atlas_regions.join(",") || "none"}；unused=${skeletonAudit.unused_atlas_regions.join(",") || "none"}；duplicate=${skeletonAudit.duplicate_atlas_regions.join(",") || "none"}`);
  const attachmentByPath = new Map();
  for (const attachment of skeletonAudit.attachments) attachmentByPath.set(attachment.path, { ...(attachmentByPath.get(attachment.path) ?? attachment), is_mesh: Boolean(attachmentByPath.get(attachment.path)?.is_mesh || attachment.is_mesh), mesh_sha256: attachment.mesh_sha256 ?? attachmentByPath.get(attachment.path)?.mesh_sha256 ?? null });
  const timestamp = now();
  const visualContract = {
    character: options.character ?? null,
    direction: options.visualDirection ?? "dark",
    palette: {
      primary_armor: options.primaryArmor ?? null,
      secondary_structure: options.secondaryStructure ?? null,
      dark_mechanical: options.darkMechanical ?? null,
      glow: options.glow ?? null,
      accent: options.accent ?? null,
      effects: options.effects ?? null,
    },
    material_language: options.materialLanguage ?? null,
    light_direction: options.lightDirection ?? null,
    strict_alpha: options.strictAlpha !== false,
    frozen: Boolean(options.visualContractFrozen),
    frozen_at: options.visualContractFrozen ? timestamp : null,
  };
  const cells = parsed.cells.map((cell) => {
    const attachment = attachmentByPath.get(cell.name);
    return { ...cell, attachment_type: attachment?.is_mesh ? "mesh" : "region", mesh_sha256: attachment?.mesh_sha256 ?? null, alpha_lock: visualContract.strict_alpha || attachment?.is_mesh === true, status: "pending", mode: attachment?.is_mesh ? "mesh-safe" : "palette-refresh", batch_id: null, generated_image: null, result_sha256: null, attempts: 0, history: [], last_error: null, source_reference: null, source_reference_sha256: null, validation_evidence: [] };
  });
  return {
    schema_version: SCHEMA_VERSION,
    created_at: timestamp,
    updated_at: timestamp,
    character: visualContract.character,
    target_runtime: targetRuntime,
    visual_contract: visualContract,
    atlas: { path: resolve(atlasPath), sha256: await sha256(atlasPath), pages },
    asset_input: options.assetInput ? { ...options.assetInput, source_dir: resolve(options.assetInput.source_dir ?? dirname(atlasPath)) } : { format: "independent", source_dir: dirname(resolve(atlasPath)), atlas_path: resolve(atlasPath), skeleton_path: skeletons[0].path },
    control_binding: options.controlBinding ?? null,
    skeletons,
    skeleton_audit: skeletonAudit,
    source_audit: skeletonAudit,
    skeleton_upgrade: { status: skeletonAudit.requires_upgrade ? "REQUIRED" : "NOT_REQUIRED", source_sha256: skeletons[0].sha256, target_runtime: targetRuntime, candidate_path: null, candidate_sha256: null, comparison: null, runtime_parse_evidence: !skeletonAudit.requires_upgrade },
    style_references: style,
    packing: { padding: 0, extrusion: 0 },
    build: null,
    runtime_evidence: [],
    runtime_validation: null,
    batches: [],
    current_batch_id: null,
    cells,
    candidate_dir: resolve(dirname(outputPath)),
    delivery_mode: "independent-validation-candidate",
  };
}

/** 收集所有源文件、参考图和证据路径，供输出目录保护使用。 */
function protectedArtifactPaths(document, manifestPath) {
  const paths = [manifestPath, document.control_binding?.control_manifest_path, document.asset_input?.container_path, document.atlas?.path, ...(document.atlas?.pages ?? []).map((page) => page.source_path), ...(document.skeletons ?? []).map((item) => item.path), ...(document.style_references ?? []).map((item) => typeof item === "string" ? item : item.path)];
  for (const cell of document.cells ?? []) {
    paths.push(resolveArtifact(manifestPath, cell.generated_image), resolveArtifact(manifestPath, cell.source_reference));
    for (const evidence of cell.validation_evidence ?? []) paths.push(resolveArtifact(manifestPath, typeof evidence === "string" ? evidence : evidence.path));
  }
  for (const evidence of document.runtime_evidence ?? []) paths.push(resolveArtifact(manifestPath, typeof evidence === "string" ? evidence : evidence.path));
  if (document.build) {
    paths.push(resolveArtifact(manifestPath, document.build.output_atlas));
    const outputDir = resolveArtifact(manifestPath, document.build.output_dir);
    for (const page of document.atlas.pages ?? []) paths.push(outputDir && join(outputDir, page.output_name ?? outputPageName(page)));
  }
  return paths.filter(Boolean).map((path) => resolve(path));
}

/** 返回不可作为生成结果来源的源纹理与结构参考路径（不含其他候选生成图）。 */
function sourceArtifactPaths(document, manifestPath) {
  const paths = [document.control_binding?.control_manifest_path, document.asset_input?.container_path, document.atlas?.path, ...(document.atlas?.pages ?? []).map((page) => page.source_path), ...(document.skeletons ?? []).map((item) => item.path), ...(document.style_references ?? []).map((item) => typeof item === "string" ? item : item.path)];
  for (const cell of document.cells ?? []) paths.push(resolveArtifact(manifestPath, cell.source_reference));
  return paths.filter(Boolean).map((path) => resolve(path));
}

/** 返回不允许充当审阅/运行证据的当前候选产物路径。 */
function evidenceProtectedPaths(document, manifestPath) {
  const paths = [...sourceArtifactPaths(document, manifestPath)];
  for (const cell of document.cells ?? []) paths.push(resolveArtifact(manifestPath, cell.generated_image));
  if (document.build) {
    paths.push(resolveArtifact(manifestPath, document.build.output_atlas));
    const outputDir = resolveArtifact(manifestPath, document.build.output_dir);
    for (const page of document.atlas?.pages ?? []) if (outputDir) paths.push(join(outputDir, page.output_name ?? outputPageName(page)));
  }
  return paths.filter(Boolean).map((path) => resolve(path));
}

/** 校验证据不是源文件、生成图或重建输出的别名。 */
async function isEvidencePathAllowed(document, manifestPath, path) {
  const actual = await realOrResolved(path);
  for (const protectedPath of evidenceProtectedPaths(document, manifestPath)) if (actual === await realOrResolved(protectedPath)) return false;
  return true;
}

/** 确保候选目录内的工件不是源数据或已有证据的别名。 */
async function validateGeneratedPath(document, manifestPath, imagePath, allowPath = null) {
  const candidateDir = resolve(dirname(manifestPath));
  const image = resolve(imagePath);
  if (!isWithin(candidateDir, image) || image === candidateDir) throw new ReskinError(`生成图必须位于候选目录内：${image}`);
  if (!await isFile(image)) throw new ReskinError(`生成图不存在：${image}`);
  const actual = await realOrResolved(image);
  if (!isWithin(await realOrResolved(candidateDir), actual)) throw new ReskinError(`生成图不能通过符号链接逃出候选目录：${image}`);
  const allowed = allowPath ? await realOrResolved(allowPath) : null;
  for (const protectedPath of sourceArtifactPaths(document, manifestPath)) if (actual !== allowed && actual === await realOrResolved(protectedPath)) throw new ReskinError(`生成图不能引用源文件、源 Cell 参考或受保护证据：${image}`);
  return image;
}

/** 核对源 Atlas、Page、Skeleton 和风格参考可读取，不以摘要漂移阻断验收。 */
export async function sourceIntegrityErrors(document, manifestPath) {
  const errors = [];
  const sources = [{ label: "控制面 manifest", path: document.control_binding?.control_manifest_path, expected: document.control_binding?.control_manifest_sha256 }, ...(document.asset_input?.container_path ? [{ label: "原版资源容器", path: document.asset_input.container_path, expected: document.asset_input.source_container_sha256 }] : []), { label: "源 Atlas", path: document.atlas?.path, expected: document.atlas?.sha256 }, ...(document.atlas?.pages ?? []).map((page) => ({ label: `源 Page ${page.name}`, path: page.source_path, expected: page.sha256 })), ...(document.skeletons ?? []).map((item, index) => ({ label: `Skeleton ${index + 1}`, path: item.path, expected: item.sha256 })), ...(document.style_references ?? []).map((item, index) => ({ label: `style reference ${index + 1}`, path: typeof item === "string" ? item : item.path, expected: typeof item === "string" ? null : item.sha256 }))];
  for (const source of sources) {
    if (!source.path || !await isFile(resolve(source.path))) { errors.push(`${source.label} 不存在：${source.path ?? ""}`); continue; }
  }
  for (const cell of document.cells ?? []) {
    const reference = resolveArtifact(manifestPath, cell.source_reference);
    if (!reference || !await isFile(reference)) errors.push(`${cell.id} 源 Cell 参考不存在`);
  }
  return errors;
}

/** 把源完整性错误转换为命令失败。 */
async function assertSourceIntegrity(document, manifestPath) {
  await assertSpineControlBinding(document);
  const errors = await sourceIntegrityErrors(document, manifestPath);
  if (errors.length) throw new ReskinError(errors.join("；"));
}

/** 初始化清单并默认导出候选目录下的源 Cell 结构参考。 */
async function commandInit(args) {
  if ((!args.atlas && !args.assetDir) || !args.output) throw new ReskinError("init 需要 --atlas 或 --asset-dir，以及 --output");
  if (!args.controlManifest) throw new ReskinError("init 需要 --control-manifest，以绑定 Work Item、production contract 和 V2 approval");
  const output = resolve(args.output);
  const assetInput = args.assetDir ? await prepareSpineAsset(args.assetDir, args.normalizedDir ?? join(dirname(output), "normalized-source")) : { format: "independent", source_dir: dirname(resolve(args.atlas)), atlas_path: resolve(args.atlas), skeleton_path: resolve(args.skeleton?.[0] ?? "") };
  const atlas = resolve(assetInput.atlas_path);
  const skeletonPaths = args.skeleton?.length ? args.skeleton : [assetInput.skeleton_path];
  const controlBinding = await readSpineControlBinding(args.controlManifest);
  if (!await isFile(atlas)) throw new ReskinError(`找不到 Atlas：${atlas}`);
  await mkdir(dirname(output), { recursive: true });
  return withManifestLock(output, async () => {
    if (await exists(output) && !args.force) throw new ReskinError(`进度清单已存在，默认不覆盖：${output}（需要 --force）`);
    const manifest = await buildManifest(atlas, output, args.styleReference ?? [], skeletonPaths, {
      targetRuntime: args.targetRuntime,
      character: args.character,
      visualDirection: args.visualDirection,
      primaryArmor: args.primaryArmor,
      secondaryStructure: args.secondaryStructure,
      darkMechanical: args.darkMechanical,
      glow: args.glow,
      accent: args.accent,
      effects: args.effects,
      materialLanguage: args.materialLanguage,
      lightDirection: args.lightDirection,
      strictAlpha: args.strictAlpha,
      visualContractFrozen: args.freezeVisualContract,
      controlBinding,
      assetInput,
    });
    const referenceDir = resolve(args.referenceDir ?? join(dirname(output), "source-cells"));
    const protectedSources = [manifest.atlas.path, ...manifest.atlas.pages.map((page) => page.source_path), ...manifest.skeletons.map((item) => item.path), manifest.asset_input?.container_path, controlBinding.control_manifest_path].filter(Boolean);
    if (protectedSources.some((source) => isWithin(referenceDir, source) || resolve(source) === referenceDir)) throw new ReskinError(`reference-dir 不能覆盖源文件：${referenceDir}`);
    await extractReferences(manifest, output, referenceDir, sha256);
    await writeJsonAtomic(output, manifest);
    console.log(`已初始化 ${manifest.cells.length} 个 Cell、${manifest.atlas.pages.length} 个 Page：${output}`);
    return 0;
  });
}

const assertSkeletonAuditIntegrity = createSkeletonAuditIntegrity({ isFile });

const batchCommands = createBatchCommands({ withManifestLock, readManifest, writeJsonAtomic, sha256, now, touch, resolveArtifact, relativePath, isFile, isWithin, validateCellArtifact, transition, record, assertSkeletonAuditIntegrity, assertControlBinding: assertSpineControlBinding });
const { commandUpgradeCheck, commandFreezeContract, commandPlanBatches, commandBatchPrepare, commandBatchReview, commandBatchAccept, commandBatchReopen } = batchCommands;

/** 汇总状态数量。 */
async function commandStatus(args) {
  const document = await readManifest(resolve(args.manifest));
  const counts = Object.fromEntries(STATUSES.map((status) => [status, 0]));
  for (const cell of document.cells) counts[cell.status ?? "pending"] = (counts[cell.status ?? "pending"] ?? 0) + 1;
  console.log(JSON.stringify({ total: document.cells.length, by_status: counts }, null, 2));
  return 0;
}

/** 原样打印清单。 */
async function commandRead(args) { console.log(JSON.stringify(await readManifest(resolve(args.manifest)), null, 2)); return 0; }

/** 恢复中断时的处理中状态，保留历史并回到可重试的 pending。 */
async function commandRecover(args) {
  const path = resolve(args.manifest);
  return withManifestLock(path, async () => {
    const document = await readManifest(path);
    await assertSpineControlBinding(document);
    let recovered = 0;
    for (const cell of document.cells) if (["generating", "validating", "packing", "runtime_validating"].includes(cell.status)) {
      const old = cell.status;
      const batch = document.batches?.find((item) => item.id === cell.batch_id);
      if (old === "validating" && batch?.status === "ACCEPTED" && batch.locked === true) {
        // 已确认批次的 validating 是正式锁定回执的一部分，不能被恢复命令降级。
        record(document, cell, "recovered_preserved", { from_status: old, batch_id: batch.id });
        continue;
      }
      const target = old === "packing" ? "validating" : old === "runtime_validating" ? "packed" : "pending";
      transition(document, cell, target, `从 ${old} 恢复`);
      record(document, cell, "recovered", { from_status: old, to_status: target });
      recovered += 1;
    }
    if (document.build?.status === "runtime_validating") document.build.status = "packed";
    if (document.build?.status === "packing") document.build = null;
    await writeJsonAtomic(path, document);
    console.log(`已恢复 ${recovered} 个处理中 Cell`);
    return 0;
  });
}

/** 标记单个 Cell 的生成状态；验证及完成状态只能由正式命令推进。 */
async function commandMark(args) {
  const path = resolve(args.manifest);
  return withManifestLock(path, async () => {
    const document = await readManifest(path);
    await assertSpineControlBinding(document);
    const cell = getCell(document, args.cell);
    if (document.batches?.length && ["generating", "generated"].includes(args.status)) {
      const batch = assertCurrentBatch(document, cell.batch_id);
      if (batch.status !== "PREPARED") throw new ReskinError(`批次 ${batch.id} 必须先执行当前 revision 的 batch prepare，当前为 ${batch.status}`);
    } else if (["generating", "generated"].includes(args.status)) throw new ReskinError("必须先导入批次计划并执行 batch prepare，才能生成 Cell");
    if (!MARKABLE_STATUSES.has(args.status)) throw new ReskinError("mark 只能设置 pending、generating、generated 或 failed；validating/completed 必须使用正式命令");
    const requestedImage = args.image ? resolve(args.image) : null;
    const currentImage = cell.generated_image ? resolveArtifact(path, cell.generated_image) : null;
    const image = requestedImage ? await validateGeneratedPath(document, path, requestedImage, currentImage && resolve(currentImage) === requestedImage ? requestedImage : null) : null;
    if (args.status === "generated") {
      if (!image) throw new ReskinError("标记 generated 必须传入存在且位于候选目录内的 --image");
      cell.generated_image = relativePath(image, dirname(path));
      cell.result_sha256 = await sha256(image);
    } else if (args.image) throw new ReskinError("只有 generated 状态可以传入 --image");
    if (args.status === "failed" && !args.error) throw new ReskinError("failed 状态必须提供 --error");
    transition(document, cell, args.status, args.error ?? null);
    if (["pending", "generating"].includes(args.status)) cell.last_error = null;
    await writeJsonAtomic(path, document);
    console.log(`${cell.id} -> ${cell.status}`);
    return 0;
  });
}

/** 配置 Cell 的受约束换皮模式，禁止在验证后改变结构合同。 */
async function commandConfigure(args) {
  const path = resolve(args.manifest);
  return withManifestLock(path, async () => {
    const document = await readManifest(path);
    await assertSpineControlBinding(document);
    const cell = getCell(document, args.cell);
    if (document.batches?.length) throw new ReskinError("导入批次计划后禁止 configure；请在计划中固定 mode 与 alpha_lock");
    if (!MODES.includes(args.mode)) throw new ReskinError(`mode 必须是 ${MODES.join("、")}`);
    if (cell.attachment_type === "mesh" && args.mode !== "mesh-safe") throw new ReskinError(`Mesh Cell ${cell.id} 必须使用 mesh-safe`);
    const alphaLock = args.alphaLock == null ? cell.alpha_lock !== false : args.alphaLock === "true";
    if (args.mode === "constrained-redraw" && alphaLock !== false) throw new ReskinError("constrained-redraw 只有显式 alpha_lock=false 才可使用");
    if (!["pending", "generating", "generated"].includes(cell.status)) throw new ReskinError(`Cell ${cell.id} 已进入 ${cell.status}，不能再修改换皮模式`);
    cell.mode = args.mode;
    cell.alpha_lock = alphaLock;
    record(document, cell, "mode", { mode: args.mode, alpha_lock: alphaLock });
    await writeJsonAtomic(path, document);
    console.log(`${cell.id} mode -> ${args.mode}`);
    return 0;
  });
}

/** 校验证据位于候选目录、可读取且不冒充生成图或源工件。 */
async function evidenceRecord(document, manifestPath, evidencePath, generatedPaths = []) {
  const candidateDir = resolve(dirname(manifestPath));
  const path = resolve(evidencePath);
  if (!isWithin(candidateDir, path) || !await isFile(path)) throw new ReskinError(`证据必须是候选目录内存在的文件：${path}`);
  const actual = await realOrResolved(path);
  if (!isWithin(await realOrResolved(candidateDir), actual)) throw new ReskinError(`证据不能通过符号链接逃出候选目录：${path}`);
  if (!await isEvidencePathAllowed(document, manifestPath, path)) throw new ReskinError(`证据不能引用源文件、生成图或已有受保护文件：${path}`);
  for (const generatedPath of generatedPaths) if (actual === await realOrResolved(generatedPath)) throw new ReskinError(`证据不能与生成图相同：${path}`);
  return { path: relativePath(path, dirname(manifestPath)), sha256: await sha256(path) };
}

const assertAlphaContract = createAlphaContract(ALPHA_CONTRACT_THRESHOLDS);

/** 校验单个 Cell 的尺寸、alpha、源参考、模式和生成哈希。 */
async function validateCellArtifact(document, manifestPath, cell, padding) {
  if (!MODES.includes(cell.mode)) throw new ReskinError(`Cell ${cell.id} 缺少有效换皮模式`);
  if (cell.mode === "constrained-redraw" && cell.alpha_lock !== false) throw new ReskinError(`Cell ${cell.id} constrained-redraw 必须显式 alpha_lock=false`);
  if (cell.attachment_type === "mesh" && (cell.mode !== "mesh-safe" || cell.alpha_lock !== true)) throw new ReskinError(`Mesh Cell ${cell.id} 必须使用 mesh-safe 且 alpha_lock=true`);
  const imagePath = await validateGeneratedPath(document, manifestPath, resolveArtifact(manifestPath, cell.generated_image), resolveArtifact(manifestPath, cell.generated_image));
  // 验收直接检查图片格式、尺寸和透明约束，摘要核对交给最终人工验收后处理。
  let metadata;
  try { metadata = await sharp(imagePath).metadata(); } catch (error) { throw new ReskinError(`Cell ${cell.id} 生成图无法读取：${error.message}`); }
  if (metadata.format !== "png") throw new ReskinError(`Cell ${cell.id} 生成图必须是实际 PNG`);
  if (!(metadata.hasAlpha === true || Number(metadata.channels ?? 0) >= 4)) throw new ReskinError(`Cell ${cell.id} 生成图必须包含 alpha 通道`);
  const image = await decodeRgba(imagePath);
  const expectedWidth = [90, 270].includes(cell.rotate_degrees) ? cell.size[1] : cell.size[0];
  const expectedHeight = [90, 270].includes(cell.rotate_degrees) ? cell.size[0] : cell.size[1];
  if (image.width !== expectedWidth || image.height !== expectedHeight) throw new ReskinError(`Cell ${cell.id} 正式生成图尺寸 ${image.width},${image.height} 必须等于正向 Region ${expectedWidth},${expectedHeight}`);
  validateCellImageDimensions(cell, image, 0);
  if (!hasVisibleAlpha(image)) throw new ReskinError(`Cell ${cell.id} 生成图 alpha 为空`);
  const reference = resolveArtifact(manifestPath, cell.source_reference);
  if (!reference || !await isFile(reference)) throw new ReskinError(`Cell ${cell.id} 源结构参考缺失`);
  const referenceImage = await decodeRgba(reference);
  const normalized = normalizeCellImage(cell, image, 0, 0);
  // padding 核心图只与源 Region 的对应内框比较，避免把工具预留的透明边框误判成轮廓变化。
  const referenceForContract = normalized.kind === "core" ? cropRgba(referenceImage, padding, padding, normalized.coreImage.width, normalized.coreImage.height) : referenceImage;
  assertAlphaContract(cell, referenceForContract, normalized.coreImage);
  if (!Array.isArray(cell.validation_evidence) || cell.validation_evidence.length < 1) throw new ReskinError(`Cell ${cell.id} 至少需要一个审阅证据文件`);
  for (const evidence of cell.validation_evidence) {
    const path = resolveArtifact(manifestPath, typeof evidence === "string" ? evidence : evidence.path);
    if (!path || !await isFile(path) || !await isEvidencePathAllowed(document, manifestPath, path) || typeof evidence === "string") throw new ReskinError(`Cell ${cell.id} 审阅证据缺失`);
  }
  return imagePath;
}

/** 正式验证单个 Cell，并将 generated 推进到 validating。 */
async function commandValidate(args) {
  const path = resolve(args.manifest);
  return withManifestLock(path, async () => {
    const document = await readManifest(path);
    const cell = getCell(document, args.cell);
    if (!["generated", "validating"].includes(cell.status)) throw new ReskinError(`Cell ${cell.id} 必须处于 generated 才能 validate，当前为 ${cell.status}`);
    if (args.padding != null) document.packing.padding = args.padding;
    const generatedPath = resolveArtifact(path, cell.generated_image);
    try {
      const generated = await validateGeneratedPath(document, path, generatedPath, generatedPath);
      const evidence = [];
      for (const item of args.evidence ?? []) evidence.push(await evidenceRecord(document, path, item, [generated]));
      if (evidence.length) cell.validation_evidence = evidence;
      await validateCellArtifact(document, path, cell, Number(document.packing.padding ?? 0));
    } catch (error) {
      if (cell.status !== "failed") transition(document, cell, "failed", error.message);
      await writeJsonAtomic(path, document);
      throw error;
    }
    transition(document, cell, "validating");
    await writeJsonAtomic(path, document);
    console.log(`${cell.id} -> validating`);
    return 0;
  });
}

/** 解析 Page 输出路径并拒绝目录逃逸或 Atlas/Page 同名覆盖。 */
function safeOutputPage(stage, name) {
  const candidate = resolve(stage, name);
  const rel = relative(resolve(stage), candidate);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) throw new ReskinError(`Page 名称越出候选目录：${name}`);
  return candidate;
}

/** 检查输出目录不能成为任何受保护文件的祖先。 */
async function assertOutputDirectorySafe(outputDir, protectedPaths) {
  const output = resolve(outputDir);
  if (await exists(output) && (await stat(output)).isFile()) throw new ReskinError(`输出路径不是目录：${output}`);
  const outputReal = await realOrResolved(output);
  for (const protectedPath of protectedPaths) {
    const protectedReal = await realOrResolved(protectedPath);
    if (isWithin(outputReal, protectedReal)) throw new ReskinError(`输出目录不能等于或成为受保护文件的祖先：${output} -> ${protectedPath}`);
  }
}

/** 用目录原子重命名提交候选，失败时恢复原目录并保留可恢复备份。 */
async function commitStage(stage, target, force, protectedPaths) {
  const normalized = resolve(target);
  await assertOutputDirectorySafe(normalized, protectedPaths);
  let backup = null;
  try {
    if (await exists(normalized)) {
      if (!force) throw new ReskinError(`输出目录已存在，默认不覆盖：${normalized}（需要 --force）`);
      backup = `${normalized}.backup-${process.pid}-${randomUUID()}`;
      await rename(normalized, backup);
    }
    await rename(stage, normalized);
  } catch (error) {
    if (backup && await exists(backup) && !await exists(normalized)) await rename(backup, normalized).catch(() => {});
    throw error;
  }
  // 提交已成功；备份删除失败时保留备份，方便人工恢复而不破坏新候选。
  if (backup) await rm(backup, { recursive: true, force: true }).catch(() => {});
}

/** 验证已打包 Atlas、Skeleton 和 Page 的实际文件。 */
async function buildArtifactErrors(document, manifestPath) {
  const errors = [];
  const build = document.build;
  if (!build || typeof build !== "object" || Array.isArray(build)) return ["缺少 build，未记录可验证的重建工件"];
  const atlas = resolveArtifact(manifestPath, build.output_atlas);
  if (!atlas || !await isFile(atlas)) errors.push("已记录的重建 Atlas 不存在");
  const outputDir = resolveArtifact(manifestPath, build.output_dir);
  const skeleton = resolveArtifact(manifestPath, build.output_skeleton);
  if (!skeleton || !await isFile(skeleton)) errors.push("已记录的升级后 Skeleton 不存在");
  for (const page of document.atlas.pages ?? []) {
    const name = page.output_name ?? outputPageName(page);
    const output = outputDir ? join(outputDir, name) : null;
    if (!output || !await isFile(output)) errors.push(`重建 Page 不存在：${name}`);
    else if (extname(output).toLowerCase() !== ".png") errors.push(`Page 不是 PNG：${name}`);
  }
  if (!errors.length) errors.push(...await validatePackedContent(document, manifestPath, resolveArtifact));
  return errors;
}

/** 从透明空白 Page 重建全部纹理并阶段提交到 packed。 */
async function commandPack(args) {
  if (!args.manifest || !args.outputDir) throw new ReskinError("pack 需要 --manifest 与 --output-dir");
  const manifestPath = resolve(args.manifest);
  return withManifestLock(manifestPath, async () => {
    const document = await readManifest(manifestPath);
    await assertSourceIntegrity(document, manifestPath);
    await assertSkeletonAuditIntegrity(document);
    assertProductionReady(document);
    if (!document.batches.length || document.batches.some((batch) => batch.status !== "ACCEPTED" || batch.locked !== true)) throw new ReskinError("pack 要求全部批次 ACCEPTED+locked");
    for (const batch of document.batches) {
      validateEffectSequence(batch, false);
      if (batch.acceptance?.decision !== "ACCEPTED" || !batch.review_board) throw new ReskinError(`批次 ${batch.id} 缺少正式接受回执`);
      await acceptanceFingerprint(document, manifestPath, batch, batchCells(document, batch), batch.review_board, sha256, resolveArtifact);
    }
    const outputDir = resolve(args.outputDir);
    const protectedPaths = protectedArtifactPaths(document, manifestPath);
    await assertOutputDirectorySafe(outputDir, protectedPaths);
    for (const cell of document.cells) {
      if (cell.status !== "validating") throw new ReskinError(`Cell ${cell.id} 必须先通过 validate 进入 validating，不能从 ${cell.status} 打包`);
      await validateCellArtifact(document, manifestPath, cell, Number(args.padding ?? document.packing?.padding ?? 0));
    }
    const padding = args.padding ?? Number(document.packing?.padding ?? 0);
    const extrusion = args.extrusion ?? Number(document.packing?.extrusion ?? 0);
    if (!Number.isInteger(padding) || !Number.isInteger(extrusion) || padding < 0 || extrusion < 0 || extrusion > padding) throw new ReskinError("padding 与 extrusion 必须为非负整数，且 extrusion <= padding");
    if (padding !== 0 || extrusion !== 0) throw new ReskinError("正式 Spine 换皮固定使用 padding=0、extrusion=0");
    document.packing = { padding, extrusion };
    for (const cell of document.cells) transition(document, cell, "packing");
    await writeJsonAtomic(manifestPath, document);
    let stage = null;
    const hashes = {};
    try {
      await mkdir(dirname(outputDir), { recursive: true });
      stage = await mkdtemp(join(dirname(outputDir), `.${outputDir.split(/[\\/]/).at(-1)}.stage-`));
      const outputNames = new Set();
      for (const page of document.atlas.pages) {
        const pageImage = blankRgba(page.width, page.height);
        for (const cell of document.cells.filter((item) => item.page_index === page.index)) {
          const [x, y] = cell.xy;
          const [regionWidth, regionHeight] = cell.size;
          if (x < 0 || y < 0 || x + regionWidth > page.width || y + regionHeight > page.height) throw new ReskinError(`Cell ${cell.id} 超出 Page ${page.name} 边界`);
          const generated = resolveArtifact(manifestPath, cell.generated_image);
          const packed = prepareCellImage(cell, await decodeRgba(generated), padding, extrusion, page);
          if (packed.width !== regionWidth || packed.height !== regionHeight) throw new ReskinError(`Cell ${cell.id} 旋转后尺寸 ${packed.width},${packed.height} 不等于原 size ${regionWidth},${regionHeight}`);
          pasteRgba(pageImage, packed, x, y);
        }
        const name = page.output_name ?? outputPageName(page);
        const key = name.toLowerCase();
        if (outputNames.has(key)) throw new ReskinError(`Page 输出名碰撞：${name}`);
        outputNames.add(key);
        page.output_name = name;
        const output = safeOutputPage(stage, name);
        await encodePng(pageImage, output);
        hashes[name] = await sha256(output);
      }
      const atlasBase = sourceAtlasBase(document.atlas.path);
      const atlasName = (args.atlasName ?? `${atlasBase}.atlas`).replaceAll("\\", "/");
      if (outputNames.has(atlasName.toLowerCase())) throw new ReskinError(`Atlas 输出名与 Page 冲突：${atlasName}`);
      const atlasOutput = safeOutputPage(stage, atlasName);
      await mkdir(dirname(atlasOutput), { recursive: true });
      await writeFile(atlasOutput, atlasText(document), "utf8");
      const skeletonPath = document.skeleton_upgrade?.status === "PASSED" ? document.skeleton_upgrade.candidate_path : document.skeletons[0].path;
      const skeletonName = basename(skeletonPath);
      if (outputNames.has(skeletonName.toLowerCase()) || skeletonName.toLowerCase() === atlasName.toLowerCase()) throw new ReskinError(`Skeleton 输出名与 Atlas/Page 冲突：${skeletonName}`);
      const stagedSkeleton = safeOutputPage(stage, skeletonName);
      await writeFile(stagedSkeleton, await readFile(skeletonPath));
      await assertSourceIntegrity(document, manifestPath);
      await commitStage(stage, outputDir, args.force, protectedPaths);
      stage = null;
      const finalAtlas = join(outputDir, atlasName);
      const skeletonOutput = join(outputDir, skeletonName);
      document.build = { status: "packed", output_dir: relativePath(outputDir, dirname(manifestPath)), output_atlas: relativePath(finalAtlas, dirname(manifestPath)), output_skeleton: relativePath(skeletonOutput, dirname(manifestPath)), atlas_sha256: await sha256(finalAtlas), page_sha256: hashes, skeleton_sha256: await sha256(skeletonOutput), batch_acceptance_fingerprints: document.batches.map((batch) => ({ id: batch.id, fingerprint: batch.acceptance.candidate_fingerprint })), packed_at: now() };
      document.build.runtime_binding = buildRuntimeBinding(document.build);
      for (const cell of document.cells) transition(document, cell, "packed");
      await writeJsonAtomic(manifestPath, document);
      console.log(`已重建 ${document.atlas.pages.length} 个 Page，状态为 packed：${finalAtlas}`);
      return 0;
    } catch (error) {
      if (stage) await rm(stage, { recursive: true, force: true });
      // pack 是事务边界：阶段目录失败时保留 ACCEPTED+locked，并把 Cell 退回 validating 便于重试。
      for (const cell of document.cells) if (cell.status === "packing") transition(document, cell, "validating", error.message);
      document.build = null;
      await writeJsonAtomic(manifestPath, document);
      if (error instanceof ReskinError) throw error;
      throw new ReskinError(`重建失败：${error.message}`);
    }
  });
}

/** 返回源 Atlas 的无扩展基名。 */
function sourceAtlasBase(path) { const name = path.split(/[\\/]/).at(-1); return name.slice(0, -extname(name).length); }

/** 正式结束运行态验证，要求至少一个当前候选的运行证据。 */
async function commandRuntimeValidate(args) {
  if (!args.manifest || !args.runtimeReport) throw new ReskinError("runtime-validate 需要 --manifest 与 --runtime-report");
  const manifestPath = resolve(args.manifest);
  return withManifestLock(manifestPath, async () => {
    const document = await readManifest(manifestPath);
    if (!document.cells.length || document.cells.some((cell) => cell.status !== "packed")) throw new ReskinError("runtime-validate 要求所有 Cell 处于 packed");
    await assertSourceIntegrity(document, manifestPath);
    await assertSkeletonAuditIntegrity(document);
    const buildErrors = await buildArtifactErrors(document, manifestPath);
    if (buildErrors.length) throw new ReskinError(buildErrors.join("；"));
    const reportPath = resolve(args.runtimeReport);
    const report = await readRuntimeReport(reportPath);
    if (document.runtime_validation?.validation_run_id && document.runtime_validation.validation_run_id === report.validation_run_id) throw new ReskinError("runtime 报告复用了已经验证过的 validation_run_id");
    await validateRuntimeReport(document, manifestPath, report, resolveArtifact);
    if (!await isWithin(dirname(manifestPath), reportPath) || !await isFile(reportPath)) throw new ReskinError("runtime 报告必须位于候选目录且为文件");
    const runtimeEvidence = [{ path: relativePath(reportPath, dirname(manifestPath)), sha256: await sha256(reportPath), kind: "structured-runtime-report", validation_run_id: report.validation_run_id }];
    for (const evidence of [report.screenshots.desktop, report.screenshots.mobile_390, report.browser_log, { path: report.target_runtime_parse.log_path, sha256: report.target_runtime_parse.log_sha256 }]) {
      const evidencePath = resolveArtifact(manifestPath, evidence.path);
      runtimeEvidence.push({ path: relativePath(evidencePath, dirname(manifestPath)), sha256: await sha256(evidencePath), kind: "runtime-evidence", validation_run_id: report.validation_run_id });
    }
    document.runtime_validation = { status: "PASS", report_path: relativePath(reportPath, dirname(manifestPath)), report_sha256: await sha256(reportPath), validation_run_id: report.validation_run_id, checked_at: now(), url: report.url, animation_count: report.animations.length };
    document.runtime_evidence = runtimeEvidence;
    document.build.runtime_validation = document.runtime_validation;
    touch(document);
    await writeJsonAtomic(manifestPath, document);
    console.log(`runtime validation PASS：${report.animations.length} 个动画`);
    return 0;
  });
}

/** 正式结束运行态验证；未执行结构化 runtime-validate 时 fail closed。 */
async function commandFinalize(args) {
  const manifestPath = resolve(args.manifest);
  return withManifestLock(manifestPath, async () => {
    const document = await readManifest(manifestPath);
    if (!document.cells.length || document.cells.some((cell) => cell.status !== "packed")) throw new ReskinError("finalize 要求所有 Cell 都处于 packed，pack 后不能直接 completed");
    await assertSourceIntegrity(document, manifestPath);
    await assertSkeletonAuditIntegrity(document);
    const buildErrors = await buildArtifactErrors(document, manifestPath);
    if (buildErrors.length) throw new ReskinError(buildErrors.join("；"));
    if (document.runtime_validation?.status !== "PASS" || !document.runtime_validation.report_path) throw new ReskinError("finalize 必须先执行通过的 runtime-validate 结构化运行验证");
    const reportPath = resolveArtifact(manifestPath, document.runtime_validation.report_path);
    const report = await readRuntimeReport(reportPath);
    await validateRuntimeReport(document, manifestPath, report, resolveArtifact);
    for (const cell of document.cells) transition(document, cell, "runtime_validating");
    document.build.status = "runtime_validating";
    await writeJsonAtomic(manifestPath, document);
    for (const cell of document.cells) transition(document, cell, "completed");
    document.build.status = "completed";
    document.build.completed_at = now();
    const deliveryMode = args.deliveryMode ?? document.delivery_mode ?? "independent-validation-candidate";
    if (!["independent-validation-candidate", "integrated-main-game"].includes(deliveryMode)) throw new ReskinError("delivery_mode 必须是 independent-validation-candidate 或 integrated-main-game");
    document.delivery_mode = deliveryMode;
    await writeJsonAtomic(manifestPath, document);
    console.log(`已完成运行态验证：${document.cells.length} 个 Cell`);
    return 0;
  });
}

/** 生成包含批次、完整性、升级、哈希、运行证据和交付模式的最终结构化报告。 */
async function commandReport(args) {
  if (!args.manifest || !args.output || !args.verification) throw new ReskinError("report 需要 --manifest、--output 与 --verification");
  const manifestPath = resolve(args.manifest);
  return withManifestLock(manifestPath, async () => {
    const document = await readManifest(manifestPath);
    if (document.build?.status !== "completed" || document.runtime_validation?.status !== "PASS") throw new ReskinError("report 要求完成 finalize 和 runtime validation");
    await assertSourceIntegrity(document, manifestPath);
    await assertSkeletonAuditIntegrity(document);
    const reportPath = resolveArtifact(manifestPath, document.runtime_validation.report_path);
    if (!reportPath || !await isFile(reportPath)) throw new ReskinError("runtime validation 报告缺失");
    const runtimeReport = await readRuntimeReport(reportPath);
    await validateRuntimeReport(document, manifestPath, runtimeReport, resolveArtifact);
    const outputPath = resolve(args.output);
    if (!isWithin(dirname(manifestPath), outputPath)) throw new ReskinError("最终报告必须位于候选目录内");
    const verificationPath = resolve(args.verification);
    if (!isWithin(dirname(manifestPath), verificationPath) || !await isFile(verificationPath)) throw new ReskinError("verification 必须是候选目录内的 JSON 文件");
    let verification;
    try { verification = JSON.parse(await readFile(verificationPath, "utf8")); } catch (error) { throw new ReskinError(`无法读取 verification：${error.message}`); }
    const verificationErrors = validateVerification(verification);
    if (verificationErrors.length) throw new ReskinError(`verification 未通过：${verificationErrors.join("；")}`);
    document.verification = verification;
    const result = await writeFinalReport(outputPath, document, manifestPath, runtimeReport, sha256);
    document.final_report = result;
    touch(document);
    await writeJsonAtomic(manifestPath, document);
    console.log(`最终报告已生成：${outputPath}`);
    return 0;
  });
}

/** 验证全部 Cell、证据、源文件和重建工件。 */
export async function verifyDocument(document, manifestPath) {
  const errors = [];
  if (!document.cells.length) errors.push("Atlas 没有可验证的 Cell");
  try { assertProductionReady(document); } catch (error) { errors.push(error.message); }
  if (!document.batches?.length || document.batches.some((batch) => batch.status !== "ACCEPTED" || batch.locked !== true)) errors.push("存在未 ACCEPTED+locked 的批次");
  for (const batch of document.batches ?? []) {
    try {
      validateEffectSequence(batch, false);
      if (batch.acceptance?.decision !== "ACCEPTED" || !batch.review_board) throw new ReskinError(`批次 ${batch.id} 缺少正式接受回执`);
      await acceptanceFingerprint(document, manifestPath, batch, batchCells(document, batch), batch.review_board, sha256, resolveArtifact);
    } catch (error) { errors.push(error.message); }
  }
  errors.push(...await sourceIntegrityErrors(document, manifestPath));
  try { await assertSkeletonAuditIntegrity(document); } catch (error) { errors.push(error.message); }
  if (!Array.isArray(document.runtime_evidence) || document.runtime_evidence.length < 1) errors.push("缺少运行态验证证据");
  else for (const evidence of document.runtime_evidence) {
    const path = resolveArtifact(manifestPath, typeof evidence === "string" ? evidence : evidence.path);
    if (typeof evidence === "string" || !path || !await isFile(path) || !await isEvidencePathAllowed(document, manifestPath, path) || evidence.validation_run_id !== document.runtime_validation?.validation_run_id) errors.push("运行态证据缺失或未绑定当前 validation_run_id");
  }
  if (document.runtime_validation?.status !== "PASS" || !document.runtime_validation.report_path) errors.push("缺少结构化 runtime validation PASS");
  else {
    try {
      const reportPath = resolveArtifact(manifestPath, document.runtime_validation.report_path);
      await validateRuntimeReport(document, manifestPath, await readRuntimeReport(reportPath), resolveArtifact);
    } catch (error) { errors.push(error.message); }
  }
  for (const cell of document.cells) {
    if (cell.status !== "completed") { errors.push(`${cell.id} 状态为 ${cell.status}，未完成`); continue; }
    if (!MODES.includes(cell.mode)) errors.push(`${cell.id} 缺少有效换皮模式`);
    const image = resolveArtifact(manifestPath, cell.generated_image);
    if (!image || !await isFile(image)) errors.push(`${cell.id} 缺少生成图`);
    if (!Array.isArray(cell.validation_evidence) || cell.validation_evidence.length < 1) errors.push(`${cell.id} 缺少审阅证据`);
    else for (const evidence of cell.validation_evidence) {
      const evidencePath = resolveArtifact(manifestPath, typeof evidence === "string" ? evidence : evidence.path);
      if (typeof evidence === "string" || !evidencePath || !await isFile(evidencePath) || !await isEvidencePathAllowed(document, manifestPath, evidencePath)) errors.push(`${cell.id} 审阅证据缺失`);
    }
    try { await validateCellArtifact(document, manifestPath, cell, Number(document.packing?.padding ?? 0)); } catch (error) { errors.push(error.message); }
  }
  errors.push(...await buildArtifactErrors(document, manifestPath));
  if (document.build?.status !== "completed") errors.push("build 尚未完成 runtime_validating -> completed 闭环");
  const verificationErrors = validateVerification(document.verification);
  errors.push(...verificationErrors);
  if (!document.final_report?.path) errors.push("缺少最终报告文件");
  else {
    const finalReportPath = resolveArtifact(manifestPath, document.final_report.path);
    if (!finalReportPath || !isWithin(dirname(manifestPath), finalReportPath) || !await isFile(finalReportPath)) errors.push("最终报告缺失或越出候选目录");
  }
  return errors;
}

/** 验证命令。 */
async function commandVerify(args) {
  const path = resolve(args.manifest);
  const document = await readManifest(path);
  const errors = await verifyDocument(document, path);
  if (errors.length) { for (const error of errors) console.error(`错误：${error}`); return 1; }
  console.log(`验证通过：${document.cells.length} 个 Cell`);
  return 0;
}

/** 独立执行原版资产审计，输出 Skeleton/Atlas 统计和 Mesh 结构哈希。 */
async function commandInspect(args) {
  let atlasPath = args.atlas;
  let skeletonPath = args.skeleton?.[0] ?? args.skeleton;
  if (args.assetDir) {
    const normalizedDir = args.normalizedDir ?? join(dirname(resolve(args.assetDir)), `${basename(resolve(args.assetDir))}-normalized`);
    const asset = await prepareSpineAsset(args.assetDir, normalizedDir);
    atlasPath = asset.atlas_path;
    skeletonPath = asset.skeleton_path;
  }
  if (!atlasPath || !skeletonPath) throw new ReskinError("inspect 需要 --atlas/--skeleton 或 --asset-dir");
  const atlas = await parseAtlas(resolve(atlasPath));
  const audit = await auditSkeleton(resolve(skeletonPath), atlas, args.targetRuntime ?? COCOS_SPINE_RUNTIME_DEFAULT);
  console.log(JSON.stringify({ atlas: { page_count: atlas.pages.length, region_count: atlas.cells.length }, skeleton: audit }, null, 2));
  return audit.runtime_compatible || audit.requires_upgrade ? 0 : 2;
}

const COMMANDS = { init: commandInit, inspect: commandInspect, "upgrade-check": commandUpgradeCheck, "freeze-contract": commandFreezeContract, "plan-batches": commandPlanBatches, "batch-prepare": commandBatchPrepare, "batch-review": commandBatchReview, "batch-accept": commandBatchAccept, "batch-reopen": commandBatchReopen, status: commandStatus, read: commandRead, recover: commandRecover, mark: commandMark, configure: commandConfigure, "set-mode": commandConfigure, validate: commandValidate, "cell-validate": commandValidate, verify: commandVerify, pack: commandPack, "runtime-validate": commandRuntimeValidate, finalize: commandFinalize, report: commandReport };
const FLAG_MAP = { "--atlas": "atlas", "--asset-dir": "assetDir", "--normalized-dir": "normalizedDir", "--output": "output", "--reference-dir": "referenceDir", "--style-reference": "styleReference", "--skeleton": "skeleton", "--control-manifest": "controlManifest", "--manifest": "manifest", "--cell": "cell", "--status": "status", "--image": "image", "--error": "error", "--evidence": "evidence", "--output-dir": "outputDir", "--atlas-name": "atlasName", "--padding": "padding", "--extrusion": "extrusion", "--mode": "mode", "--alpha-lock": "alphaLock", "--target-runtime": "targetRuntime", "--character": "character", "--visual-direction": "visualDirection", "--primary-armor": "primaryArmor", "--secondary-structure": "secondaryStructure", "--dark-mechanical": "darkMechanical", "--glow": "glow", "--accent": "accent", "--effects": "effects", "--material-language": "materialLanguage", "--light-direction": "lightDirection", "--candidate-skeleton": "candidateSkeleton", "--runtime-evidence": "runtimeEvidence", "--contract": "contract", "--plan": "plan", "--batch": "batch", "--effect-report": "effectReport", "--user-text": "userText", "--review-sha": "reviewSha", "--fingerprint": "fingerprint", "--runtime-report": "runtimeReport", "--verification": "verification", "--delivery-mode": "deliveryMode" };

/** 解析子命令参数，支持可重复的 Skeleton、style reference 和 evidence。 */
function parseArgs(argv) {
  if (!argv.length || argv.includes("--help") || argv.includes("-h")) return { help: true };
  const nestedCellValidate = argv[0] === "cell" && argv[1] === "validate";
  const nestedBatch = argv[0] === "batch" && ["prepare", "review", "accept", "reopen"].includes(argv[1]);
  const command = nestedCellValidate ? "validate" : nestedBatch ? `batch-${argv[1]}` : argv[0];
  if (!(command in COMMANDS)) throw new ReskinError(`未知命令：${command}`);
  const args = { command, styleReference: [], skeleton: [], evidence: [] };
  for (let index = nestedCellValidate || nestedBatch ? 2 : 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (["--force"].includes(token)) { args.force = true; continue; }
    const key = FLAG_MAP[token];
    if (!key || index + 1 >= argv.length) throw new ReskinError(`不支持或缺少值的参数：${token}`);
    const value = argv[++index];
    if (["styleReference", "skeleton", "evidence"].includes(key)) args[key].push(value);
    else if (["padding", "extrusion"].includes(key)) {
      if (!/^-?\d+$/.test(value)) throw new ReskinError(`${token} 必须是整数`);
      args[key] = Number(value);
    } else args[key] = value;
  }
  return args;
}

/** 打印简洁帮助。 */
function printHelp() { console.log("用法：node spine_reskin_progress.mjs <init|inspect|upgrade-check|freeze-contract|plan-batches|batch prepare|batch review|batch accept|batch reopen|status|read|recover|mark|configure|validate|pack|runtime-validate|finalize|report|verify> [参数]"); }

/** 运行 CLI，并把预期失败转换为非零返回码。 */
export async function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    if (args.help) { printHelp(); return 0; }
    return await COMMANDS[args.command](args);
  } catch (error) {
    console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
}

export { parseAtlas } from "./spine_atlas.mjs";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) process.exitCode = await main();
