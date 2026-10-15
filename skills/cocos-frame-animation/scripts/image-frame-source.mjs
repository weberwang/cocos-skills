import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
/** 图片帧来源清单的稳定 schema 标识。 */
export const IMAGE_FRAME_SOURCE_SCHEMA = "cocos-image-frame-source/1";
/** 与规划器一致的槽位上限，避免不可信 duration/fps 诱发超长完整性扫描。 */
const MAX_FRAME_COUNT = 100_000;
/** 限制解码像素总量，防止畸形来源通过压缩图片消耗过量内存。 */
const MAX_IMAGE_PIXELS = 100_000_000;

/** 判断输入是否为非数组普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 判断字符串是否含有非空白内容。 */
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** 文件来源链按实际项目路径关联；声明摘要仅作可选记录。 */
function sameFileIdentity(first, second) {
  return isObject(first)
    && isObject(second)
    && first.file === second.file;
}

/** 验证清单中的相对路径可移植且不含目录跳转或 Windows 特殊设备名。 */
function relativeFilePathError(value) {
  if (!nonEmptyString(value) || value.trim() !== value) return "必须是非空且无首尾空白的相对路径";
  if (value.includes("\\") || value.includes("\u0000") || value.startsWith("/") || /^[A-Za-z]:/u.test(value)) {
    return "必须使用项目根目录内的正斜杠相对路径";
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    return "不得包含空路径段、当前目录段或目录跳转段";
  }
  if (segments.some((segment) => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment))) {
    return "不得引用 Windows 设备名";
  }
  return null;
}

/** 校验文件引用对象的真实项目相对路径；摘要不参与验收。 */
function validateFileReference(value, field, errors) {
  if (!isObject(value)) {
    errors.push(`${field} 必须是包含 file 的对象`);
    return false;
  }
  const pathError = relativeFilePathError(value.file);
  if (pathError) errors.push(`${field}.file ${pathError}`);
  return !pathError;
}

/** 统一来源和报告的时间比较，允许毫秒保留六位小数，拒绝负数和实际时间漂移。 */
export function imageFrameTimeMatches(actual, expected) {
  return typeof actual === "number"
    && Number.isFinite(actual)
    && actual >= 0
    && typeof expected === "number"
    && Number.isFinite(expected)
    && expected >= 0
    && Math.abs(actual - expected) <= Math.max(1e-6, Math.abs(expected) * 1e-10);
}

/** 返回帧原图、最终图和修图前后快照组成的真实身份集合。 */
function frameSnapshots(frame) {
  const snapshots = [];
  if (isObject(frame.source_image)) snapshots.push(frame.source_image);
  if (isObject(frame.image)) snapshots.push(frame.image);
  if (Array.isArray(frame.repairs)) {
    for (const repair of frame.repairs) {
      if (isObject(repair?.before)) snapshots.push(repair.before);
      if (isObject(repair?.after)) snapshots.push(repair.after);
    }
  }
  return snapshots;
}

/** 检查父帧图是否绑定父帧保留的原图、最终图或修图快照。 */
function parentMatchesSnapshot(parent, parentFrame) {
  return frameSnapshots(parentFrame).some((snapshot) => sameFileIdentity(parent, snapshot));
}

/** 验证来源结构、完整时间槽位、依赖关系和修图链，返回所有可定位错误。 */
export function validateImageFrameSource(source) {
  const errors = [];
  if (!isObject(source)) return ["图片来源必须是对象"];
  if (source.schema !== IMAGE_FRAME_SOURCE_SCHEMA) errors.push(`schema 必须是 ${IMAGE_FRAME_SOURCE_SCHEMA}`);

  const canvas = source.canvas;
  if (!isObject(canvas)) {
    errors.push("canvas 必须包含 width 和 height");
  } else {
    for (const dimension of ["width", "height"]) {
      if (!Number.isSafeInteger(canvas[dimension]) || canvas[dimension] <= 0) {
        errors.push(`canvas.${dimension} 必须是正安全整数`);
      }
    }
  }
  if (typeof source.duration_ms !== "number" || !Number.isFinite(source.duration_ms) || source.duration_ms <= 0) {
    errors.push("duration_ms 必须是大于 0 的有限数字");
  }
  if (typeof source.fps !== "number" || !Number.isFinite(source.fps) || source.fps <= 0) {
    errors.push("fps 必须是大于 0 的有限数字");
  }
  if (typeof source.loop !== "boolean") errors.push("loop 必须是布尔值");
  if (!Array.isArray(source.frames)) {
    errors.push("frames 必须是帧条目数组");
    return errors;
  }

  const rawFrameCount = source.duration_ms * source.fps / 1000;
  const frameCount = Math.round(rawFrameCount);
  if (!Number.isSafeInteger(frameCount) || frameCount < 2 || frameCount > MAX_FRAME_COUNT) {
    errors.push(`duration_ms 与 fps 量化后必须包含 2..${MAX_FRAME_COUNT} 个帧槽位`);
    return errors;
  }
  const playbackDurationMs = frameCount * 1000 / source.fps;
  // 无穷时间与无穷容差比较会放行错误来源，先挡住量化结果溢出。
  if (!Number.isFinite(playbackDurationMs)) {
    errors.push("量化播放时长必须是有限数字");
    return errors;
  }
  const halfFrameMs = 500 / source.fps;
  if (Math.abs(playbackDurationMs - source.duration_ms) > halfFrameMs + Number.EPSILON * Math.max(source.duration_ms, playbackDurationMs)) {
    errors.push("时长量化误差不得超过半帧");
  }
  const loop = source.loop === true;
  const tailIndex = loop ? frameCount : frameCount - 1;
  const expectedEntryCount = frameCount + (loop ? 1 : 0);
  if (source.frames.length !== expectedEntryCount) {
    errors.push(`frames 必须完整覆盖 ${expectedEntryCount} 个槽位（播放帧 0..${frameCount - 1}${loop ? "，另含闭合参考 N" : ""}）`);
  }

  const byIndex = new Map();
  for (let position = 0; position < source.frames.length; position += 1) {
    const frame = source.frames[position];
    const label = `frames[${position}]`;
    if (!isObject(frame)) {
      errors.push(`${label} 必须是帧对象`);
      continue;
    }
    if (!Number.isSafeInteger(frame.index) || frame.index < 0 || frame.index > tailIndex) {
      errors.push(`${label}.index 必须是 0..${tailIndex} 的安全整数`);
    } else if (byIndex.has(frame.index)) {
      errors.push(`帧索引重复：${frame.index}`);
    } else {
      byIndex.set(frame.index, frame);
    }
    if (typeof frame.index === "number" && Number.isSafeInteger(frame.index) && frame.index >= 0 && frame.index <= tailIndex) {
      if (!imageFrameTimeMatches(frame.game_time_ms, frame.index * 1000 / source.fps)) {
        errors.push(`${label}.game_time_ms 与 index=${frame.index} 的量化游戏时间不一致`);
      }
    }
    if (!["endpoint", "keyframe", "inbetween"].includes(frame.kind)) {
      errors.push(`${label}.kind 必须是 endpoint、keyframe 或 inbetween`);
    }
    if (!Array.isArray(frame.parents)) errors.push(`${label}.parents 必须是父图引用数组`);
    validateFileReference(frame.source_image, `${label}.source_image`, errors);
    validateFileReference(frame.image, `${label}.image`, errors);
    validateFileReference(frame.generation_record, `${label}.generation_record`, errors);

    if (frame.index === 0 || frame.index === tailIndex) {
      if (frame.kind !== "endpoint") errors.push(`${label} 的端点槽位 kind 必须是 endpoint`);
    } else if (frame.kind === "endpoint") {
      errors.push(`${label} 仅首尾端点可以使用 endpoint`);
    }

    const parents = Array.isArray(frame.parents) ? frame.parents : [];
    const parentIndexes = new Set();
    for (let parentPosition = 0; parentPosition < parents.length; parentPosition += 1) {
      const parent = parents[parentPosition];
      const parentLabel = `${label}.parents[${parentPosition}]`;
      if (!isObject(parent) || !Number.isSafeInteger(parent.index) || parent.index < 0 || parent.index > tailIndex) {
        errors.push(`${parentLabel} 必须包含有效父帧 index 和 file`);
      } else if (parentIndexes.has(parent.index)) {
        errors.push(`${label}.parents 不得重复引用 index=${parent.index}`);
      } else {
        parentIndexes.add(parent.index);
      }
      validateFileReference(parent, parentLabel, errors);
    }

    if (frame.index === 0 && parents.length !== 0) errors.push("首 endpoint index=0 必须无父图");
    if (frame.index === tailIndex && (parents.length !== 1 || parents[0]?.index !== 0)) {
      errors.push(`尾 endpoint index=${tailIndex} 必须且只引用 index=0 的实际快照`);
    }
    if (frame.kind === "inbetween") {
      if (parents.length !== 2) errors.push(`${label} 的 inbetween 必须恰有两个父图`);
      else if (!(parents[0]?.index < frame.index && parents[1]?.index > frame.index)
        && !(parents[1]?.index < frame.index && parents[0]?.index > frame.index)) {
        errors.push(`${label} 的两个父索引必须位于目标槽位两侧`);
      }
    }
    if (frame.kind === "keyframe") {
      if (parents.length > 2) errors.push(`${label} 的 keyframe 最多引用两张已制作图`);
    }

    if (!sameFileIdentity(frame.source_image, frame.image) && (!Array.isArray(frame.repairs) || frame.repairs.length === 0)) {
      errors.push(`${label}.source_image 与 image 不同时必须提供完整 repairs 修图链`);
    }
    if (frame.repairs !== undefined) {
      if (!Array.isArray(frame.repairs) || frame.repairs.length === 0) {
        errors.push(`${label}.repairs 必须是非空修图链`);
      } else {
        let previous = frame.source_image;
        for (let repairPosition = 0; repairPosition < frame.repairs.length; repairPosition += 1) {
          const repair = frame.repairs[repairPosition];
          const repairLabel = `${label}.repairs[${repairPosition}]`;
          if (!isObject(repair)) {
            errors.push(`${repairLabel} 必须包含 before、after 和 record`);
            continue;
          }
          validateFileReference(repair.before, `${repairLabel}.before`, errors);
          validateFileReference(repair.after, `${repairLabel}.after`, errors);
          validateFileReference(repair.record, `${repairLabel}.record`, errors);
          if (!sameFileIdentity(repair.before, previous)) errors.push(`${repairLabel}.before 未连接到上一张修图快照`);
          if (sameFileIdentity(repair.before, repair.after)) errors.push(`${repairLabel} 的修图前后身份必须不同`);
          previous = repair.after;
        }
        if (!sameFileIdentity(previous, frame.image)) errors.push(`${label}.repairs 未连接到最终 image`);
      }
    }
  }

  if (byIndex.size !== expectedEntryCount) {
    const orderedIndexes = [...byIndex.keys()].sort((first, second) => first - second);
    let expected = 0;
    for (const index of orderedIndexes) {
      if (index > expected) break;
      if (index === expected) expected += 1;
    }
    if (expected <= tailIndex) errors.push(`缺少帧槽位 index=${expected}`);
    else errors.push("帧槽位存在重复或超出范围的条目");
  }

  for (const [index, frame] of byIndex) {
    if (!Array.isArray(frame.parents)) continue;
    for (const parent of frame.parents) {
      if (!Number.isSafeInteger(parent?.index) || !byIndex.has(parent.index)) {
        errors.push(`index=${index} 的父帧 index=${String(parent?.index)} 不存在`);
        continue;
      }
      if (isObject(parent) && !parentMatchesSnapshot(parent, byIndex.get(parent.index))) {
        errors.push(`index=${index} 的父图未匹配 index=${parent.index} 的真实原图、最终图或修图快照`);
      }
      if (frame.kind === "keyframe" && byIndex.get(parent.index)?.kind === "inbetween") {
        errors.push(`index=${index} 的 keyframe 不能依赖尚未进入中间帧阶段的 inbetween`);
      }
    }
  }

  // 依赖图独立于清单排列顺序遍历；即使另有结构错误，也报告真实循环依赖。
  const visitState = new Map();
  let hasDependencyCycle = false;
  for (const rootIndex of byIndex.keys()) {
    if (hasDependencyCycle) break;
    if (visitState.get(rootIndex) === 2) continue;
    const stack = [{ index: rootIndex, nextParent: 0 }];
    visitState.set(rootIndex, 1);
    while (stack.length > 0 && !hasDependencyCycle) {
      const current = stack.at(-1);
      const parents = byIndex.get(current.index)?.parents;
      if (!Array.isArray(parents) || current.nextParent >= parents.length) {
        visitState.set(current.index, 2);
        stack.pop();
        continue;
      }
      const parentIndex = parents[current.nextParent]?.index;
      current.nextParent += 1;
      if (!byIndex.has(parentIndex)) continue;
      if (visitState.get(parentIndex) === 1) {
        hasDependencyCycle = true;
        break;
      }
      if (visitState.get(parentIndex) !== 2) {
        visitState.set(parentIndex, 1);
        stack.push({ index: parentIndex, nextParent: 0 });
      }
    }
  }
  if (hasDependencyCycle) errors.push("图片帧父图依赖存在循环依赖");

  return errors;
}

/** 图片来源读取、文件身份、路径安全或图像尺寸校验失败时抛出。 */
export class ImageFrameSourceError extends Error {
  /** 创建可供 CLI 与调用方消费的错误，并保留结构化诊断。 */
  constructor(message, { errors = [], manifestPath } = {}) {
    super(message);
    this.name = "ImageFrameSourceError";
    this.errors = errors;
    if (manifestPath !== undefined) this.manifestPath = manifestPath;
  }
}

/** 将结构错误汇总为稳定的中文异常，便于调用方展示所有问题。 */
function throwSourceErrors(errors, options = {}) {
  if (errors.length === 0) return;
  throw new ImageFrameSourceError(`图片来源校验失败：\n${errors.map((error) => `- ${error}`).join("\n")}`, {
    errors,
    ...options,
  });
}

/** 计算字节的 sha256:<hex> 身份。 */
function sha256Bytes(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

let sharpImport;

/** 首次需要解码真实图片时才加载 Sharp，使静态合同校验无需图像依赖。 */
async function loadSharp() {
  if (!sharpImport) {
    sharpImport = import("../../cocos-game-workflow-control/scripts/runtime/image-runtime.mjs")
      .then((module) => module.default)
      .catch((error) => {
        sharpImport = undefined;
        throw new ImageFrameSourceError(`读取真实图片需要 Sharp：${error.message}`);
      });
  }
  return sharpImport;
}

/** 判断规范路径是否仍位于项目根目录，兼容 Windows 分隔符和大小写规则。 */
function isWithinRoot(rootPath, targetPath) {
  const childPath = relative(rootPath, targetPath);
  if (childPath === "") return true;
  if (isAbsolute(childPath) || childPath === ".." || childPath.startsWith(`..${sep}`)) return false;
  if (process.platform === "win32") {
    return !childPath.toLowerCase().startsWith(`..${sep}`.toLowerCase());
  }
  return true;
}

/** 解析真实路径并拒绝 symlink/junction 将清单或资源带出项目根目录。 */
async function resolveInsideRoot(rootPath, candidatePath, field) {
  let canonicalPath;
  try {
    canonicalPath = await realpath(candidatePath);
  } catch (error) {
    throw new ImageFrameSourceError(`${field} 无法读取：${candidatePath}（${error.message}）`);
  }
  if (!isWithinRoot(rootPath, canonicalPath)) {
    throw new ImageFrameSourceError(`${field} 经 symlink/junction 解析后逃逸 projectRoot：${candidatePath}`);
  }
  return canonicalPath;
}

/** 读取严格 UTF-8 文件文本，拒绝无效字节而不静默替换文件身份内容。 */
function decodeUtf8(bytes, field) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ImageFrameSourceError(`${field} 不是有效 UTF-8：${error.message}`);
  }
}

/** 解析 JSON 文件并将编码与语法错误转换为图片来源错误。 */
function parseJsonBytes(bytes, field) {
  const text = decodeUtf8(bytes, field);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ImageFrameSourceError(`${field} 不是有效 JSON：${error.message}`);
  }
}

/** 校验并登记来源链引用的项目文件路径；SHA 只保留为可选说明。 */
function registerFileDeclaration(declarations, reference, field) {
  const pathError = relativeFilePathError(reference?.file);
  if (pathError) throw new ImageFrameSourceError(`${field}.file ${pathError}`);
  declarations.set(reference.file, true);
}

/** 读取项目内指定相对文件并返回可复用字节记录。 */
async function readProjectFile(rootPath, relativePath, files) {
  if (files.has(relativePath)) return files.get(relativePath);
  const candidatePath = resolve(rootPath, ...relativePath.split("/"));
  if (!isWithinRoot(rootPath, candidatePath)) throw new ImageFrameSourceError(`文件路径逃逸 projectRoot：${relativePath}`);
  const absolutePath = await resolveInsideRoot(rootPath, candidatePath, "来源文件");
  let fileStat;
  try {
    fileStat = await stat(absolutePath);
  } catch (error) {
    throw new ImageFrameSourceError(`来源文件无法读取：${relativePath}（${error.message}）`);
  }
  if (!fileStat.isFile()) throw new ImageFrameSourceError(`来源文件必须是普通文件：${relativePath}`);
  let bytes;
  try {
    bytes = await readFile(absolutePath);
  } catch (error) {
    throw new ImageFrameSourceError(`来源文件无法读取：${relativePath}（${error.message}）`);
  }
  const file = { bytes, absolutePath };
  files.set(relativePath, file);
  return file;
}

/** 完整解码图片并返回画布尺寸，拒绝损坏文件、超大像素图与多页动画。 */
async function inspectImage(bytes, field) {
  let metadata;
  try {
    const sharp = await loadSharp();
    const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS });
    metadata = await image.metadata();
    await image.stats();
  } catch (error) {
    throw new ImageFrameSourceError(`${field} 不是可完整解码的图片：${error.message}`);
  }
  if (!Number.isSafeInteger(metadata.width) || metadata.width <= 0 || !Number.isSafeInteger(metadata.height) || metadata.height <= 0) {
    throw new ImageFrameSourceError(`${field} 缺少有效像素尺寸`);
  }
  if (Number.isSafeInteger(metadata.pages) && metadata.pages > 1) {
    throw new ImageFrameSourceError(`${field} 必须是单帧图片`);
  }
  return { width: metadata.width, height: metadata.height };
}

/** 检查生成记录绑定真实输出，并完整声明当前帧实际引用的父图身份。 */
function validateGenerationRecord(record, frame, frameIndex, files) {
  if (!isObject(record)) throw new ImageFrameSourceError(`index=${frameIndex} generation_record 必须是 JSON 对象`);
  if (!nonEmptyString(record.prompt)) throw new ImageFrameSourceError(`index=${frameIndex} generation_record.prompt 必须非空`);
  if (!Array.isArray(record.reference_images)) {
    throw new ImageFrameSourceError(`index=${frameIndex} generation_record.reference_images 必须是数组`);
  }
  if (!isObject(record.output_image) || !sameFileIdentity(record.output_image, frame.source_image)) {
    throw new ImageFrameSourceError(`index=${frameIndex} generation_record.output_image 必须绑定 source_image 的文件路径`);
  }
  for (let index = 0; index < record.reference_images.length; index += 1) {
    const reference = record.reference_images[index];
    registerFileDeclaration(new Map(), reference, `index=${frameIndex} generation_record.reference_images[${index}]`);
  }
  for (const parent of frame.parents) {
    if (!record.reference_images.some((reference) => sameFileIdentity(reference, parent))) {
      throw new ImageFrameSourceError(`index=${frameIndex} generation_record.reference_images 缺少父图 index=${parent.index}`);
    }
  }
  for (const reference of record.reference_images) {
    const file = files.get(reference.file);
    if (!file) throw new ImageFrameSourceError(`index=${frameIndex} generation_record 引用的文件未加载：${reference.file}`);
  }
}

/**
 * 加载来源清单并校验它引用的真实图像、生成记录、父图与修图快照。
 * 返回已验证字节，供后续图集工具直接使用，避免再次读取文件产生来源变化。
 */
export async function readImageFrameSource(manifestFile, { projectRoot } = {}) {
  if (!nonEmptyString(projectRoot)) throw new ImageFrameSourceError("projectRoot 必须是已存在的目录");
  if (!nonEmptyString(manifestFile)) throw new ImageFrameSourceError("manifestFile 必须是非空路径");
  let rootPath;
  try {
    rootPath = await realpath(resolve(projectRoot));
    if (!(await stat(rootPath)).isDirectory()) throw new Error("不是目录");
  } catch (error) {
    throw new ImageFrameSourceError(`projectRoot 无法读取：${projectRoot}（${error.message}）`);
  }
  const manifestCandidate = isAbsolute(manifestFile) ? resolve(manifestFile) : resolve(rootPath, manifestFile);
  const manifestPath = await resolveInsideRoot(rootPath, manifestCandidate, "来源清单");
  if (!(await stat(manifestPath)).isFile()) throw new ImageFrameSourceError(`来源清单必须是普通文件：${manifestPath}`);
  let manifestBytes;
  try {
    manifestBytes = await readFile(manifestPath);
  } catch (error) {
    throw new ImageFrameSourceError(`来源清单无法读取：${manifestPath}（${error.message}）`);
  }
  const source = parseJsonBytes(manifestBytes, "图片来源清单");
  const structuralErrors = validateImageFrameSource(source);
  throwSourceErrors(structuralErrors, { manifestPath });

  const declarations = new Map();
  for (const frame of source.frames) {
    registerFileDeclaration(declarations, frame.source_image, `index=${frame.index}.source_image`);
    registerFileDeclaration(declarations, frame.image, `index=${frame.index}.image`);
    registerFileDeclaration(declarations, frame.generation_record, `index=${frame.index}.generation_record`);
    for (const parent of frame.parents) registerFileDeclaration(declarations, parent, `index=${frame.index}.parents`);
    for (const [repairIndex, repair] of (frame.repairs ?? []).entries()) {
      registerFileDeclaration(declarations, repair.before, `index=${frame.index}.repairs[${repairIndex}].before`);
      registerFileDeclaration(declarations, repair.after, `index=${frame.index}.repairs[${repairIndex}].after`);
      registerFileDeclaration(declarations, repair.record, `index=${frame.index}.repairs[${repairIndex}].record`);
    }
  }

  const files = new Map();
  for (const relativePath of declarations.keys()) {
    await readProjectFile(rootPath, relativePath, files);
  }

  // 先读取所有生成记录，再登记它们引用的路径，确保后续图片解码覆盖完整来源链。
  const generationRecords = new Map();
  for (const frame of source.frames) {
    const recordFile = files.get(frame.generation_record.file);
    const record = parseJsonBytes(recordFile.bytes, `index=${frame.index} generation_record`);
    if (!isObject(record) || !Array.isArray(record.reference_images)) {
      throw new ImageFrameSourceError(`index=${frame.index} generation_record 缺少 reference_images 数组`);
    }
    for (const [referenceIndex, reference] of record.reference_images.entries()) {
      registerFileDeclaration(declarations, reference, `index=${frame.index} generation_record.reference_images[${referenceIndex}]`);
    }
    generationRecords.set(frame.index, record);
  }
  for (const relativePath of declarations.keys()) {
    await readProjectFile(rootPath, relativePath, files);
  }

  const frameByIndex = new Map(source.frames.map((frame) => [frame.index, frame]));
  for (const frame of source.frames) {
    validateGenerationRecord(generationRecords.get(frame.index), frame, frame.index, files);
    await inspectImage(files.get(frame.source_image.file).bytes, `index=${frame.index} source_image`);
    const finalImage = await inspectImage(files.get(frame.image.file).bytes, `index=${frame.index} image`);
    for (const reference of generationRecords.get(frame.index).reference_images) {
      await inspectImage(files.get(reference.file).bytes, `index=${frame.index} generation_record.reference_images`);
    }
    if (finalImage.width !== source.canvas.width || finalImage.height !== source.canvas.height) {
      throw new ImageFrameSourceError(`index=${frame.index} 最终 image 尺寸 ${finalImage.width}x${finalImage.height} 与固定画布 ${source.canvas.width}x${source.canvas.height} 不一致`);
    }
    for (const [repairIndex, repair] of (frame.repairs ?? []).entries()) {
      const beforeFile = files.get(repair.before.file);
      const afterFile = files.get(repair.after.file);
      const recordFile = files.get(repair.record.file);
      if (!beforeFile || !afterFile || !recordFile) {
        throw new ImageFrameSourceError(`index=${frame.index} repairs[${repairIndex}] 引用了未加载的快照`);
      }
      await inspectImage(beforeFile.bytes, `index=${frame.index} repairs[${repairIndex}].before`);
      await inspectImage(afterFile.bytes, `index=${frame.index} repairs[${repairIndex}].after`);
      const note = decodeUtf8(recordFile.bytes, `index=${frame.index} repairs[${repairIndex}].record`);
      if (!note.trim()) throw new ImageFrameSourceError(`index=${frame.index} repairs[${repairIndex}].record 不能为空`);
      for (const identity of [repair.before, repair.after]) {
        if (!note.includes(identity.file)) {
          throw new ImageFrameSourceError(`index=${frame.index} repairs[${repairIndex}].record 必须写明前后文件路径`);
        }
      }
    }
    for (const parent of frame.parents) {
      const parentFrame = frameByIndex.get(parent.index);
      if (!parentFrame || !parentMatchesSnapshot(parent, parentFrame)) {
        throw new ImageFrameSourceError(`index=${frame.index} 父图 index=${parent.index} 与实际快照身份不一致`);
      }
      const parentFile = files.get(parent.file);
      if (!parentFile) throw new ImageFrameSourceError(`index=${frame.index} 父图文件未加载：${parent.file}`);
      await inspectImage(parentFile.bytes, `index=${frame.index} parents[index=${parent.index}]`);
    }
    // source_image 允许保留任意生成尺寸；规范化过程由 repairs 快照及人工检查记录。
  }

  return {
    source,
    manifestPath,
    manifestSha256: sha256Bytes(manifestBytes),
    files,
  };
}
