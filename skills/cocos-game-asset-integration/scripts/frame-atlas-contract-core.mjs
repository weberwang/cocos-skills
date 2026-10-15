import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

const SHA_PATTERN = /^sha256:[0-9a-f]{64}$/u;

/** 判断普通 JSON 对象，供视频与图片图集报告共同使用。 */
export function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断去除空白后仍有内容的字符串。 */
export function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 判断 SHA-256 是否使用项目统一的带算法前缀表示。 */
export function isSha256(value) {
  return nonEmptyString(value) && SHA_PATTERN.test(value);
}

/** 判断数值是否为正有限数。 */
export function finitePositive(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** 将项目内路径转换为比较用的正斜杠形式。 */
export function normalizedPath(value) {
  return nonEmptyString(value) ? value.replaceAll("\\", "/") : "";
}

/** 判断路径是否是项目内相对路径，防止合同把文件门引向项目外。 */
export function isProjectRelativePath(value) {
  const path = normalizedPath(value);
  if (!path || path.startsWith("/") || /^[A-Za-z]:\//u.test(path) || path.startsWith("//")) return false;
  return !path.split("/").some((segment) => segment === "..");
}

/** 校验相对 assets/resources 的无扩展资源路径，阻止绝对地址与编码目录逃逸。 */
export function isCreatorResourcePath(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0 || /\s/u.test(value)) return false;
  if (value.includes("\\") || value.startsWith("/") || /^[A-Za-z][A-Za-z\d+.-]*:/u.test(value) || /[?#]/u.test(value)) return false;
  let decoded = value;
  for (let round = 0; round < 3; round += 1) {
    if (decoded.includes("\\") || decoded.startsWith("/") || decoded.split("/").some((segment) => !segment || segment === "." || segment === "..")) return false;
    let next;
    try { next = decodeURIComponent(decoded); } catch { return false; }
    if (next === decoded) break;
    decoded = next;
  }
  if (decoded.includes("\\") || decoded.startsWith("/") || decoded.split("/").some((segment) => !segment || segment === "." || segment === "..")) return false;
  return !/\.[^/.]+$/u.test(decoded.split("/").at(-1));
}

/** 校验工件的项目内路径；摘要仅作为可选记录，不参与验收。 */
export function validateArtifactBinding(artifact, label, errors) {
  if (!isObject(artifact)) {
    errors.push(label + " 必须是包含 file 的对象");
    return;
  }
  if (!nonEmptyString(artifact.file)) errors.push(label + ".file 必须是非空项目内相对路径");
  else if (!isProjectRelativePath(artifact.file)) errors.push(label + ".file 必须是项目内相对路径：" + artifact.file);
}

/** 裁剪区域使用显示画布上的整数像素，禁止缺项或静默修正边界。 */
export function validateRegion(region, label, errors) {
  if (!isObject(region)) {
    errors.push(label + " 必须是包含 x、y、width、height 的区域对象");
    return false;
  }
  const valid = ["x", "y", "width", "height"].every((field) =>
    Number.isSafeInteger(region[field]) && region[field] >= (field === "x" || field === "y" ? 0 : 1));
  if (!valid) errors.push(label + " 的 x/y 必须是非负安全整数，width/height 必须是正安全整数");
  return valid;
}

/** 局部锚点允许半像素，但不允许隐式字符串转换或无效坐标。 */
export function validateAnchor(anchor, label, errors) {
  const valid = isObject(anchor) && ["x", "y"].every((field) => Number.isFinite(anchor[field]) && anchor[field] >= 0);
  if (!valid) errors.push(label + " 必须包含非负有限数值 x/y");
  return valid;
}

/** 校验图集参数，确保报告设置在 accepted 合同中有唯一的期望值。 */
export function validateSettings(settings, label, errors) {
  if (!isObject(settings)) {
    errors.push(label + ".settings 必须包含 fps、width、height 和 remove_background");
    return;
  }
  if (!finitePositive(settings.fps)) errors.push(label + ".settings.fps 必须是正有限数字");
  if (!Number.isInteger(settings.width) || settings.width <= 0) errors.push(label + ".settings.width 必须是正整数");
  if (!Number.isInteger(settings.height) || settings.height <= 0) errors.push(label + ".settings.height 必须是正整数");
  if (typeof settings.remove_background !== "boolean") errors.push(label + ".settings.remove_background 必须是布尔值");
  if (settings.region !== undefined) validateRegion(settings.region, label + ".settings.region", errors);
  if (settings.anchor !== undefined) {
    const valid = validateAnchor(settings.anchor, label + ".settings.anchor", errors);
    if (valid && isObject(settings.region) && (settings.anchor.x > settings.region.width || settings.anchor.y > settings.region.height)) {
      errors.push(label + ".settings.anchor 必须位于源区域内");
    }
  }
}

/** 视频与图片路线共用区域身份校验，区域必须同时对应清单和报告。 */
export function validateReportedRegion(report, settings, label, errors) {
  const regions = [settings?.region, report.input?.region, report.settings?.region];
  if (regions.every((region) => region === undefined)) return;
  const [expected, inputRegion, reportedRegion] = regions;
  const expectedValid = validateRegion(expected, label + " 对应的 frame_animation.settings.region", errors);
  const inputValid = validateRegion(inputRegion, label + ".input.region", errors);
  const reportedValid = validateRegion(reportedRegion, label + ".settings.region", errors);
  const fields = ["x", "y", "width", "height"];
  if (expectedValid && inputValid && fields.some((field) => expected[field] !== inputRegion[field])) {
    errors.push(label + ".input.region 必须等于 frame_animation.settings.region");
  }
  if (expectedValid && reportedValid && fields.some((field) => expected[field] !== reportedRegion[field])) {
    errors.push(label + ".settings.region 必须等于 frame_animation.settings.region");
  }
  const displayWidth = report.input?.display_width;
  const displayHeight = report.input?.display_height;
  if (!Number.isSafeInteger(displayWidth) || displayWidth <= 0 || !Number.isSafeInteger(displayHeight) || displayHeight <= 0) {
    errors.push(label + ".input.display_width/display_height 必须是区域所属显示画布的正安全整数尺寸");
  } else if (inputValid && (inputRegion.width > displayWidth - inputRegion.x || inputRegion.height > displayHeight - inputRegion.y)) {
    // 用减法比较避免坐标与宽高相加溢出，也防止编码前尺寸掩盖旋转后的越界。
    errors.push(label + ".input.region 必须完整位于实际显示画布内");
  }
}

/** 共用锚点绑定及真实缩放留白变换校验，防止 origin 落到无关空白边缘。 */
export function validateReportedAnchor(report, settings, label, errors) {
  const anchors = [settings?.anchor, report.input?.anchor, report.settings?.anchor];
  const explicit = anchors.some((anchor) => anchor !== undefined);
  let expectedAnchorValid = false;
  if (explicit) {
    const labels = [" 对应的 frame_animation.settings.anchor", ".input.anchor", ".settings.anchor"];
    const valid = anchors.map((anchor, index) => validateAnchor(anchor, label + labels[index], errors));
    expectedAnchorValid = valid[0];
    for (let index = 1; index < anchors.length; index += 1) {
      if (valid[0] && valid[index] && (anchors[index].x !== anchors[0].x || anchors[index].y !== anchors[0].y)) {
        errors.push(label + labels[index] + " 必须等于 frame_animation.settings.anchor");
      }
    }
  }

  const cell = report.cell;
  // 整画布和分区都必须提供真实布局，缺少字段不能绕过缩放留白校验。
  const sourceAnchor = cell?.source_anchor;
  const contentRect = cell?.content_rect;
  const sourceValid = validateAnchor(sourceAnchor, label + ".cell.source_anchor", errors);
  const rectValid = validateRegion(contentRect, label + ".cell.content_rect", errors);
  const sourceWidth = report.input?.region?.width ?? report.input?.display_width;
  const sourceHeight = report.input?.region?.height ?? report.input?.display_height;
  if (!Number.isSafeInteger(sourceWidth) || sourceWidth <= 0 || !Number.isSafeInteger(sourceHeight) || sourceHeight <= 0) {
    errors.push(label + ".cell.source_anchor 缺少有效源区域或显示画布尺寸");
    return;
  }
  if (sourceValid && (sourceAnchor.x > sourceWidth || sourceAnchor.y > sourceHeight)) {
    errors.push(label + ".cell.source_anchor 必须位于源区域内");
  }
  if (sourceValid && expectedAnchorValid
      && (sourceAnchor.x !== anchors[0].x || sourceAnchor.y !== anchors[0].y)) {
    errors.push(label + ".cell.source_anchor 必须等于 frame_animation.settings.anchor");
  }
  if (!explicit && sourceValid && (sourceAnchor.x !== sourceWidth / 2 || sourceAnchor.y !== sourceHeight - 1)) {
    errors.push(label + ".cell.source_anchor 必须等于默认底部中心锚点：源宽/2、源高-1");
  }
  if (!Number.isSafeInteger(cell?.width) || !Number.isSafeInteger(cell?.height) || cell.width <= 0 || cell.height <= 0) return;
  if (rectValid && (contentRect.width > cell.width - contentRect.x || contentRect.height > cell.height - contentRect.y)) {
    errors.push(label + ".cell.content_rect 必须完整位于输出 cell 内");
  }
  const target = cell.target_anchor;
  if (sourceValid && rectValid && isObject(target) && Number.isFinite(target.x) && Number.isFinite(target.y)) {
    // 使用报告记录的实际栅格尺寸，避免另行猜测缩放器的像素取整与留白量。
    const expectedX = contentRect.x + sourceAnchor.x * contentRect.width / sourceWidth;
    const expectedY = contentRect.y + sourceAnchor.y * contentRect.height / sourceHeight;
    if (Math.abs(target.x - expectedX) > 1e-6 || Math.abs(target.y - expectedY) > 1e-6) {
      errors.push(label + ".cell.target_anchor 必须等于局部锚点经缩放与留白后的变换结果");
    }
  }
}

/** 计算文件内容 SHA-256，保持与 visual manifest 文件门相同的表示。 */
export function sha256Bytes(bytes) {
  return "sha256:" + createHash("sha256").update(bytes).digest("hex");
}

/** 解析项目内路径；调用方可提供更严格的 symlink/junction 检查器。 */
function defaultResolvePath(projectRoot, file) {
  const root = resolve(projectRoot ?? ".");
  const candidate = resolve(root, file);
  const relativePath = relative(root, candidate);
  if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(".." + (process.platform === "win32" ? "\\" : "/"))) {
    throw new Error("路径逃逸项目根目录：" + file);
  }
  return candidate;
}

/** 读取一个绑定工件；文件路径和可读性参与验收，摘要不参与阻断。 */
export async function readBoundArtifact(artifact, label, context, errors) {
  if (!isObject(artifact) || !nonEmptyString(artifact.file)) return null;
  let resolvedFile;
  try {
    resolvedFile = (context.resolvePath ?? ((file) => defaultResolvePath(context.projectRoot, file)))(artifact.file);
    const exists = context.isFile ? await context.isFile(resolvedFile) : await stat(resolvedFile).then((item) => item.isFile()).catch(() => false);
    if (!exists) {
      errors.push(label + " 文件不存在：" + artifact.file);
      return null;
    }
    if (nonEmptyString(context.projectRoot)) {
      const projectRootReal = await realpath(resolve(context.projectRoot));
      const artifactReal = await realpath(resolvedFile);
      const relativeRealPath = relative(projectRootReal, artifactReal);
      // 词法路径仍在项目内也可能经 symlink/junction 指向外部，必须按真实位置二次约束。
      if (isAbsolute(relativeRealPath) || relativeRealPath === ".."
        || relativeRealPath.startsWith(".." + (process.platform === "win32" ? "\\" : "/"))) {
        throw new Error("文件真实位置逃逸项目根目录：" + artifact.file);
      }
    }
    const bytes = await readFile(resolvedFile);
    return { bytes, file: artifact.file, resolvedFile };
  } catch (error) {
    errors.push(label + "：" + error.message);
    return null;
  }
}

/** 从 PNG IHDR 读取图集尺寸；拒绝签名或正尺寸无效的文件。 */
export function readPngDimensions(bytes) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || !bytes.subarray(0, 8).equals(signature)) return null;
  if (bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** 以严格 UTF-8 读取文本工件，避免二进制内容被静默替换后通过检查。 */
export function decodeText(bytes, label, errors) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!nonEmptyString(text)) errors.push(label + " 文件内容不能为空");
    return text;
  } catch {
    errors.push(label + " 必须是有效 UTF-8 文本");
    return null;
  }
}

/** 网页预览仍需是可读 HTML；内嵌摘要不作为验收条件。 */
export function validatePreview(artifact, sheetArtifact, label, errors) {
  if (!artifact) return;
  const html = decodeText(artifact.bytes, label, errors);
  if (html === null) return;
  if (!/<html\b/iu.test(html)) errors.push(label + " 必须包含 HTML 根元素");
}

/** 比较报告中的相对工件路径；绝对路径仅作诊断信息，不参与文件身份绑定。 */
export function validateReportedArtifactPath(reportPath, binding, label, errors) {
  if (!nonEmptyString(reportPath) || !isObject(binding) || !nonEmptyString(binding.file)) return;
  const isAbsoluteReportPath = isAbsolute(reportPath) || /^[A-Za-z]:[\\/]/u.test(reportPath)
    || reportPath.startsWith("\\\\") || reportPath.startsWith("//");
  if (isAbsoluteReportPath) return;
  if (normalizedPath(reportPath) !== normalizedPath(binding.file)) {
    errors.push(label + " 必须与 manifest 工件路径一致");
  }
}

/** 按指定字段比较机器清单，避免 JSON 属性顺序影响坐标合同。 */
function sameFields(actual, expected, fields) {
  return isObject(actual) && fields.every((field) => actual[field] === expected[field]);
}

/** 校验 Creator SpriteFrame、AnimationClip 清单及其像素坐标变换。 */
export function validateCreatorContract(report, asset, sheetBinding, label, errors) {
  const animation = isObject(report.animation) ? report.animation : {};
  if (!nonEmptyString(animation.key)) errors.push(label + ".animation.key 必须是非空字符串");
  if (!nonEmptyString(animation.texture_key)) errors.push(label + ".animation.texture_key 必须是非空字符串");
  if (!finitePositive(animation.frame_rate)) errors.push(label + ".animation.frame_rate 必须是正有限数字");
  else if (finitePositive(report.input?.fps) && animation.frame_rate !== report.input.fps) {
    errors.push(label + ".animation.frame_rate 必须等于 input.fps");
  }
  if (typeof animation.loop !== "boolean") errors.push(label + ".animation.loop 必须是布尔值");
  if (!nonEmptyString(asset?.texture_key)) errors.push(label + " 对应 asset.texture_key 必须是非空字符串");
  else if (nonEmptyString(animation.texture_key) && asset.texture_key !== animation.texture_key) {
    errors.push(label + ".animation.texture_key 必须等于 asset.texture_key");
  }

  const creator = report.cc;
  if (!isObject(creator) || creator.schema !== "cocos-creator-frame-atlas/2") {
    errors.push(label + ".cc 必须提供 cocos-creator-frame-atlas/2 接入清单");
    return;
  }
  if (creator.integration_kind !== "descriptive_machine_manifest" || creator.creator_assets_materialized !== false) {
    errors.push(label + ".cc 必须明确标记为描述清单，不能声称已创建 Creator 资产");
  }
  const frames = Array.isArray(report.frames) ? report.frames : [];
  const cell = report.cell;
  if (creator.creator?.name !== "Cocos Creator" || creator.creator?.major_version !== 3) {
    errors.push(label + ".cc.creator 必须指向 Cocos Creator 3.x");
  }
  const texture = creator.texture;
  if (!isObject(texture) || texture.asset_name !== animation.texture_key || texture.layout !== "horizontal"
    || texture.frame_count !== frames.length || texture.width !== cell?.width * frames.length || texture.height !== cell?.height) {
    errors.push(label + ".cc.texture 必须绑定水平图集的真实尺寸、资源名和帧数");
  }
  if (!isCreatorResourcePath(texture?.creator_resource_path) || texture.creator_resource_path !== sheetBinding?.creator_resource_path) {
    errors.push(label + ".cc.texture.creator_resource_path 必须是相对 assets/resources 的无扩展资源名，且严格等于 spritesheet.creator_resource_path");
  }
  const conversion = creator.coordinate_conversion;
  if (!isObject(conversion) || conversion.sprite_frame_rect_origin !== "image-top-left"
    || conversion.sprite_frame_rect_y_formula !== "image_rect_y"
    || conversion.image_anchor_origin !== "top-left" || conversion.creator_anchor_origin !== "bottom-left"
    || conversion.creator_anchor_y_formula !== "1 - image_anchor_y / cell_height") {
    errors.push(label + ".cc.coordinate_conversion 必须保留 SpriteFrame 图像坐标并转换 UITransform 锚点");
  }
  const spriteFrames = creator.sprite_frames;
  if (!Array.isArray(spriteFrames) || spriteFrames.length !== frames.length) {
    errors.push(label + ".cc.sprite_frames 必须逐帧绑定实际图集 cell");
  } else {
    const names = new Set();
    for (const [index, spriteFrame] of spriteFrames.entries()) {
      const expectedRect = { x: index * cell.width, y: 0, width: cell.width, height: cell.height };
      // SpriteFrame.rect 沿用贴图裁切坐标；只有 UITransform 锚点转换到左下本地坐标。
      if (!isObject(spriteFrame) || spriteFrame.index !== index || !nonEmptyString(spriteFrame.name)
        || names.has(spriteFrame.name) || spriteFrame.asset_type !== "SpriteFrame"
        || spriteFrame.texture_asset_name !== animation.texture_key
        || !sameFields(spriteFrame.rect, expectedRect, ["x", "y", "width", "height"])
        || !sameFields(spriteFrame.original_size, { width: cell.width, height: cell.height }, ["width", "height"])) {
        errors.push(label + `.cc.sprite_frames[${index}] 必须与水平图集的像素矩形和 SpriteFrame 资产一致`);
      }
      if (nonEmptyString(spriteFrame?.name)) names.add(spriteFrame.name);
    }
  }
  const node = creator.node_ui_transform;
  const anchor = cell?.target_anchor;
  const expectedAnchor = { x: anchor?.x / cell?.width, y: 1 - anchor?.y / cell?.height };
  if (!isObject(node) || node.component_type !== "UITransform"
    || !sameFields(node.content_size, { width: cell?.width, height: cell?.height }, ["width", "height"])
    || node.image_anchor_top_left_pixels?.x !== anchor?.x || node.image_anchor_top_left_pixels?.y !== anchor?.y
    || node.anchor_point_normalized_bottom_left?.x !== expectedAnchor.x
    || node.anchor_point_normalized_bottom_left?.y !== expectedAnchor.y) {
    errors.push(label + ".cc.node_ui_transform 必须绑定 SpriteFrame 尺寸及从左上像素到左下归一化锚点的变换");
  }
  const clip = creator.animation_clip;
  if (!isObject(clip) || clip.asset_type !== "AnimationClip" || clip.name !== animation.key
    || clip.playback_component !== "Animation" || clip.sample !== animation.frame_rate
    || clip.wrap_mode !== (animation.loop === true ? "Loop" : "Normal")
    || !Number.isFinite(clip.duration_seconds)
    || Math.abs(clip.duration_seconds - frames.length / animation.frame_rate) > 1e-9
    || !Array.isArray(clip.sprite_frame_sequence)
    || JSON.stringify(clip.sprite_frame_sequence) !== JSON.stringify(spriteFrames?.map((item) => item?.name))) {
    errors.push(label + ".cc.animation_clip 必须用 AnimationClip 按报告 FPS/loop 顺序引用全部 SpriteFrame");
  }
  const mcpWorkflow = creator.mcp_asset_workflow;
  const forbiddenFiles = [".meta", ".scene", ".prefab"];
  if (!isObject(mcpWorkflow) || mcpWorkflow.protocol !== "MCP" || mcpWorkflow.tool_discovery_method !== "tools/list"
    || mcpWorkflow.asset_import_refresh_tool !== "assetAdvanced_refresh_assets_and_wait"
    || mcpWorkflow.asset_info_tool !== "project_get_asset_info" || mcpWorkflow.asset_uuid_tool !== "project_query_asset_uuid"
    || mcpWorkflow.tool_result_policy !== "inspect_each_subtool_and_require_success"
    || mcpWorkflow.sprite_frame_subasset_query?.required !== true
    || mcpWorkflow.sprite_frame_subasset_query?.discovery !== "Use a currently listed MCP tool and its inputSchema"
    || mcpWorkflow.sprite_frame_subasset_query?.asset_type !== "SpriteFrame"
    || mcpWorkflow.sprite_frame_subasset_query?.unavailable_action !== "stop_and_report"
    || !Array.isArray(mcpWorkflow.forbidden_manual_files)
    || forbiddenFiles.some((extension) => !mcpWorkflow.forbidden_manual_files.includes(extension))) {
    errors.push(label + ".cc.mcp_asset_workflow 必须要求经 MCP 导入刷新和 SpriteFrame 子资源查询，且禁止手写 .meta/.scene/.prefab");
  }

  const sheetFile = sheetBinding?.file;
  const runtimeOutputs = Array.isArray(asset?.runtime_outputs) ? asset.runtime_outputs.map(normalizedPath) : [];
  if (!runtimeOutputs.includes(normalizedPath(sheetFile))) errors.push(label + " spritesheet 必须位于 asset.runtime_outputs");
}
