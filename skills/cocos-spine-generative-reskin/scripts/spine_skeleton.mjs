import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { ReskinError } from "./spine_atlas.mjs";

/** 3.8 仅是默认审计目标；实际 Spine 分支必须由当前 Creator Runtime 证据确认。 */
export const COCOS_SPINE_RUNTIME_DEFAULT = "3.8";

/** 将 JSON 值按稳定键顺序编码，保证结构指纹不受导出器字段顺序影响。 */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

/** 对 Mesh 的拓扑和 UV 数据生成独立指纹，升级审计不会只依赖总数量。 */
export function meshSignature(mesh) {
  const projection = { vertices: mesh.vertices ?? [], triangles: mesh.triangles ?? [], uvs: mesh.uvs ?? [] };
  return createHash("sha256").update(stableJson(projection)).digest("hex");
}

/** 解析 Spine skeleton 字段中的版本字符串，未知格式保持未知而不是猜测。 */
export function parseSpineVersion(value) {
  const raw = typeof value === "string" ? value : value && typeof value === "object" ? [value.major, value.minor, value.patch].filter((part) => part != null).join(".") : "";
  const match = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(raw);
  if (!match) return { raw: raw || null, major: null, minor: null, patch: null };
  return { raw: raw || null, major: Number(match[1]), minor: Number(match[2] ?? 0), patch: Number(match[3] ?? 0) };
}

/** 将任意 Spine attachment 节点投影为稳定的审计记录。 */
function attachmentRecord(name, attachment, slotName, skinName) {
  const type = String(attachment?.type ?? "region").toLowerCase();
  const path = typeof attachment?.path === "string" && attachment.path ? attachment.path : name;
  const isMesh = ["mesh", "linkedmesh", "skinnedmesh", "weightedmesh"].includes(type) || Array.isArray(attachment?.triangles) || Array.isArray(attachment?.uvs);
  // 保留所有 Attachment 字段，尤其是 sequence、parent、deform、region 尺寸和 Mesh 锚点。
  const data = { ...(attachment ?? {}), type, path };
  return { name, path, type, skin: skinName, slot: slotName, is_mesh: isMesh, mesh_sha256: isMesh ? meshSignature(data) : null, data };
}

/** 兼容 3.x 对象 skins 与 4.x 数组 skins，仅做结构读取，不转换 Spine 数据。 */
function collectSkins(skins) {
  const records = [];
  if (Array.isArray(skins)) {
    for (const skin of skins) {
      const skinName = skin?.name ?? "default";
      if (Array.isArray(skin?.attachments)) for (const attachment of skin.attachments) records.push(attachmentRecord(attachment.name, attachment, attachment.slot ?? "", skinName));
      else for (const [slotName, attachments] of Object.entries(skin?.attachments ?? {})) for (const [name, attachment] of Object.entries(attachments ?? {})) records.push(attachmentRecord(name, attachment, slotName, skinName));
    }
  } else if (skins && typeof skins === "object") {
    for (const [skinName, slots] of Object.entries(skins)) for (const [slotName, attachments] of Object.entries(slots ?? {})) for (const [name, attachment] of Object.entries(attachments ?? {})) records.push(attachmentRecord(name, attachment, slotName, skinName));
  }
  return records;
}

/** 保留 Spine 约束/皮肤元数据，避免升级比较只覆盖常见骨骼和 Slot。 */
function collectSkinMetadata(skins) {
  if (Array.isArray(skins)) return skins.map((skin) => ({ name: skin?.name ?? "default", bones: skin?.bones ?? [], constraints: skin?.constraints ?? [], metadata: Object.fromEntries(Object.entries(skin ?? {}).filter(([key]) => !["name", "attachments", "bones", "constraints"].includes(key))) }));
  return Object.keys(skins ?? {}).map((name) => ({ name, bones: [], constraints: [], metadata: {} }));
}

/** 统一补齐不写出的 Spine 默认变换值，同时保留未知字段以便 fail closed。 */
function normalizeBone(bone) {
  return { ...(bone ?? {}), parent: bone?.parent ?? null, x: bone?.x ?? 0, y: bone?.y ?? 0, rotation: bone?.rotation ?? 0, scaleX: bone?.scaleX ?? 1, scaleY: bone?.scaleY ?? 1, shearX: bone?.shearX ?? 0, shearY: bone?.shearY ?? 0, length: bone?.length ?? 0 };
}

/** 保留 Slot 的 bone、颜色、暗色、默认 Attachment、blend 和其它导出字段。 */
function normalizeSlot(slot) {
  return { ...(slot ?? {}), color: slot?.color ?? null, dark: slot?.dark ?? null, attachment: slot?.attachment ?? null, blend: slot?.blend ?? null };
}

/** 从 JSON 文本读取并验证 Spine Skeleton 的基本结构。 */
export async function readSkeleton(path) {
  let value;
  try { value = JSON.parse(await readFile(path, "utf8")); } catch (error) { throw new ReskinError(`无法读取 Skeleton JSON ${path}：${error.message}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ReskinError(`Skeleton 必须是 JSON 对象：${path}`);
  if (!value.skeleton || typeof value.skeleton !== "object") throw new ReskinError(`Skeleton 缺少 skeleton 元数据：${path}`);
  return value;
}

/** 生成可比较的 Skeleton 结构投影，排除导出时间等不影响运行语义的字段。 */
export function skeletonProjection(value) {
  // JSON 对象与 4.x 数组导出顺序可能不同；按语义键排序，避免把纯格式迁移误判成结构漂移。
  const attachments = collectSkins(value.skins).sort((left, right) => stableJson([left.skin, left.slot, left.name]).localeCompare(stableJson([right.skin, right.slot, right.name])));
  const meshes = attachments.filter((attachment) => attachment.is_mesh).map(({ name, path, type, skin, slot, mesh_sha256, data }) => ({ name, path, type, skin, slot, mesh_sha256, data }));
  return {
    version: parseSpineVersion(value.skeleton?.spine),
    skeleton_metadata: Object.fromEntries(Object.entries(value.skeleton ?? {}).filter(([key]) => key !== "spine")),
    bones: (value.bones ?? []).map(normalizeBone),
    slots: (value.slots ?? []).map(normalizeSlot),
    constraints: { ik: value.ik ?? [], transform: value.transform ?? [], path: value.path ?? [], physics: value.physics ?? [] },
    skins: (Array.isArray(value.skins) ? value.skins.map((skin) => skin.name ?? "default") : Object.keys(value.skins ?? {})).sort(),
    skin_metadata: collectSkinMetadata(value.skins),
    attachments,
    meshes,
    animations: Object.keys(value.animations ?? {}).sort(),
    animation_semantics: value.animations ?? {},
    animations_sha256: createHash("sha256").update(stableJson(value.animations ?? {})).digest("hex"),
  };
}

/** 审计 Skeleton、附件纹理路径与 Mesh 数组，并返回稳定统计和结构哈希。 */
export async function auditSkeleton(path, atlas = null, targetRuntime = COCOS_SPINE_RUNTIME_DEFAULT) {
  const value = await readSkeleton(path);
  const projection = skeletonProjection(value);
  const attachmentPaths = [...new Set(projection.attachments.map((attachment) => attachment.path))].sort();
  const atlasRegionCounts = new Map();
  for (const cell of atlas?.cells ?? []) atlasRegionCounts.set(cell.name, (atlasRegionCounts.get(cell.name) ?? 0) + 1);
  const atlasNames = new Set(atlasRegionCounts.keys());
  const atlasRegionMapping = attachmentPaths.map((attachmentPath) => ({ attachment_path: attachmentPath, region: atlasNames.has(attachmentPath) ? attachmentPath : null, matches: atlasRegionCounts.get(attachmentPath) ?? 0 }));
  const missingAtlasRegions = atlasRegionMapping.filter((item) => !item.region).map((item) => item.attachment_path);
  const unusedAtlasRegions = (atlas?.cells ?? []).map((cell) => cell.name).filter((name) => !attachmentPaths.includes(name));
  const duplicateAtlasRegions = [...atlasRegionCounts.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  const version = projection.version;
  const target = parseSpineVersion(targetRuntime);
  if (!/^\d+\.\d+$/u.test(targetRuntime)) throw new ReskinError("target_runtime 必须与 sp.SPINE_VERSION 一致，仅写 major.minor，例如 3.8");
  const versionKnown = Number.isInteger(version.major);
  const targetKnown = Number.isInteger(target.major);
  const versionAtLeastTarget = versionKnown && targetKnown && (version.major > target.major || (version.major === target.major && (version.minor > target.minor || (version.minor === target.minor && version.patch >= target.patch))));
  // 仅当目标明确选用 Spine 3.8 分支时应用该分支的 3.8.99 上界；其它分支以实际解析证据为准。
  const belowCreator38Limit = !(target.major === 3 && target.minor === 8 && version.patch >= 99);
  const runtimeCompatible = versionAtLeastTarget && version.major === target.major && version.minor === target.minor && belowCreator38Limit;
  const stats = {
    bone_count: projection.bones.length,
    slot_count: projection.slots.length,
    skin_count: projection.skins.length,
    attachment_count: projection.attachments.length,
    region_attachment_count: projection.attachments.filter((attachment) => !attachment.is_mesh).length,
    mesh_count: projection.meshes.length,
    animation_count: projection.animations.length,
    animation_names: projection.animations,
  };
  const structureSha256 = createHash("sha256").update(stableJson(projection)).digest("hex");
  return {
    path,
    version,
    target_runtime: targetRuntime,
    target_version: target,
    runtime_compatible: runtimeCompatible,
    requires_upgrade: !runtimeCompatible,
    version_known: versionKnown,
    stats,
    bones: projection.bones,
    slots: projection.slots,
    skeleton_metadata: projection.skeleton_metadata,
    constraints: projection.constraints,
    skin_metadata: projection.skin_metadata,
    animation_semantics: projection.animation_semantics,
    skins: projection.skins,
    attachments: projection.attachments,
    mesh_signatures: projection.meshes,
    animations_sha256: projection.animations_sha256,
    atlas_region_mapping: atlasRegionMapping,
    missing_atlas_regions: missingAtlasRegions,
    unused_atlas_regions: unusedAtlasRegions,
    duplicate_atlas_regions: duplicateAtlasRegions,
    structure_sha256: structureSha256,
  };
}

/** 比较升级前后的允许运行格式变化，任何骨骼语义漂移都归入 unknown_changes。 */
export function compareUpgrade(before, after) {
  const allowed = [];
  const unknown = [];
  if (before.version.raw !== after.version.raw) allowed.push({ field: "skeleton.spine", from: before.version.raw, to: after.version.raw });
  const beforeNames = before.attachments.map((item) => `${item.skin}/${item.slot}/${item.name}`).sort();
  const afterNames = after.attachments.map((item) => `${item.skin}/${item.slot}/${item.name}`).sort();
  if (stableJson(beforeNames) !== stableJson(afterNames)) unknown.push("attachment_names");
  if (stableJson(before.skeleton_metadata) !== stableJson(after.skeleton_metadata)) unknown.push("skeleton_metadata");
  if (stableJson(before.bones) !== stableJson(after.bones)) unknown.push("bone_parent_length_transform_inherit");
  if (stableJson(before.slots) !== stableJson(after.slots)) unknown.push("slot_semantics");
  if (stableJson(before.constraints) !== stableJson(after.constraints)) unknown.push("ik_transform_path_physics_constraints");
  if (stableJson(before.skins) !== stableJson(after.skins)) unknown.push("skin_names");
  if (stableJson(before.skin_metadata) !== stableJson(after.skin_metadata)) unknown.push("skin_bones_constraints");
  // 升级仍必须保留实际附件和关键帧语义；比较业务数据，不把追踪摘要作为验收条件。
  const attachmentData = (items) => items.map(({ mesh_sha256, ...item }) => item);
  if (stableJson(attachmentData(before.attachments)) !== stableJson(attachmentData(after.attachments))) unknown.push("attachment_path_or_type");
  if (stableJson(attachmentData(before.mesh_signatures)) !== stableJson(attachmentData(after.mesh_signatures))) unknown.push("mesh_vertices_triangles_uvs");
  if (stableJson(before.stats.animation_names) !== stableJson(after.stats.animation_names)) unknown.push("animation_names_or_semantics");
  if (stableJson(before.animation_semantics) !== stableJson(after.animation_semantics)) unknown.push("animation_keyframes_values_interpolation_semantics");
  return { allowed_changes: allowed, unknown_changes: [...new Set(unknown)], passed: unknown.length === 0 };
}

/** 仅验证外部工具生成的升级候选；不在本工具内改写 Spine 数据。 */
export async function verifyUpgradeCandidate(beforePath, afterPath, atlas, targetRuntime) {
  const before = await auditSkeleton(beforePath, atlas, targetRuntime);
  const after = await auditSkeleton(afterPath, atlas, targetRuntime);
  const comparison = compareUpgrade(before, after);
  const targetParsed = parseSpineVersion(targetRuntime);
  const runtimeParsed = after.version;
  // target_runtime 是 sp.SPINE_VERSION 的 major.minor；导出补丁版本由兼容性上界单独判断。
  const runtimeParseEvidence = after.runtime_compatible === true && runtimeParsed.major === targetParsed.major && runtimeParsed.minor === targetParsed.minor;
  return { before, after, comparison, runtime_parse_evidence: runtimeParseEvidence, passed: comparison.passed && runtimeParseEvidence };
}
