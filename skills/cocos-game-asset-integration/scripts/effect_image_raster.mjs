import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { EFFECT_IMAGE_FONT_CELL_SIZE, EFFECT_IMAGE_FONT_DATA_BASE64, EFFECT_IMAGE_FONT_KEYS } from "./effect_image_font.mjs";
import { validateNineSliceContract } from "../../cocos-game-ui-layout/scripts/nine-slice-contract.mjs";

/** 判断值是否为普通对象，用于检查复用计划而不接受数组或空值。 */
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

/** PNG 文件签名，用于拒绝非栅格标注输入。 */
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** 预计算 CRC 表，保证 PNG 编解码在无外部依赖时仍保持确定性。 */
const CRC_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

/** 解析无损 PNG 并统一转换为 RGBA，标注器因此不依赖 SVG、浏览器或平台字体。 */
export function decodePngRgba(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("标注输入必须是 PNG");
  let offset = 8; let header = null; const idat = []; let palette = null; let transparency = null; let metadata = null; let sawIhdr = false; let sawIend = false; let sawIdat = false; let chunkCount = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("PNG chunk 不完整");
    const length = bytes.readUInt32BE(offset); const type = bytes.toString("ascii", offset + 4, offset + 8); const dataStart = offset + 8; const dataEnd = dataStart + length;
    if (dataEnd + 4 > bytes.length) throw new Error("PNG chunk 越界");
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error(`PNG chunk 类型无效：${type}`);
    if (chunkCount === 0 && type !== "IHDR") throw new Error("PNG 必须以 IHDR 开始");
    const data = bytes.subarray(dataStart, dataEnd); const expectedCrc = bytes.readUInt32BE(dataEnd); const actualCrc = crc32(Buffer.concat([Buffer.from(type), data]));
    if (expectedCrc !== actualCrc) throw new Error(`PNG ${type} CRC 无效`);
    if (type === "IHDR") {
      if (sawIhdr || length !== 13) throw new Error("PNG 必须只有一个合法 IHDR");
      header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], colorType: data[9], compression: data[10], filter: data[11], interlace: data[12] }; sawIhdr = true;
    } else if (!sawIhdr) throw new Error("PNG IHDR 顺序无效");
    if (type === "IDAT") { if (length === 0 || sawIend) throw new Error("PNG IDAT 顺序或长度无效"); idat.push(data); sawIdat = true; }
    else if (type === "PLTE") { if (sawIdat || palette) throw new Error("PNG PLTE 必须唯一且位于 IDAT 前"); palette = Buffer.from(data); }
    else if (type === "tRNS") { if (sawIdat || transparency) throw new Error("PNG tRNS 必须唯一且位于 IDAT 前"); transparency = Buffer.from(data); }
    else if (type === "iTXt") metadata = parseItxt(data, metadata);
    else if (type === "IEND") { if (sawIend || length !== 0 || !sawIdat) throw new Error("PNG 必须在 IDAT 后只有一个空 IEND"); sawIend = true; }
    offset = dataEnd + 4;
    chunkCount += 1;
    if (sawIend) break;
  }
  if (!header || !sawIhdr || !sawIdat || !sawIend || offset !== bytes.length || header.width <= 0 || header.height <= 0 || header.depth !== 8 || header.interlace !== 0 || header.compression !== 0 || header.filter !== 0) throw new Error("PNG 必须是完整的 8 位非隔行图像");
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[header.colorType];
  if (!channels || idat.length === 0) throw new Error("PNG 色彩类型或像素数据不受支持");
  if (header.colorType === 3 && (!palette || palette.length % 3 !== 0)) throw new Error("索引 PNG 缺少合法调色板");
  const rowBytes = header.width * channels; const decoded = inflateSync(Buffer.concat(idat)); const expectedLength = header.height * (rowBytes + 1);
  if (decoded.length !== expectedLength) throw new Error("PNG 解压长度与尺寸不一致");
  const rows = Buffer.alloc(header.height * rowBytes); let sourceOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filter = decoded[sourceOffset++]; const rowStart = y * rowBytes; const previousStart = (y - 1) * rowBytes;
    for (let x = 0; x < rowBytes; x += 1) {
      const raw = decoded[sourceOffset++]; const left = x >= channels ? rows[rowStart + x - channels] : 0; const up = y > 0 ? rows[previousStart + x] : 0; const upperLeft = y > 0 && x >= channels ? rows[previousStart + x - channels] : 0;
      rows[rowStart + x] = filter === 0 ? raw : filter === 1 ? raw + left : filter === 2 ? raw + up : filter === 3 ? raw + Math.floor((left + up) / 2) : filter === 4 ? raw + paeth(left, up, upperLeft) : (() => { throw new Error(`PNG filter 不受支持：${filter}`); })();
    }
  }
  // grayscale/truecolor 的 tRNS 都使用每个样本 16 位存储透明色；当前解码器只接受
  // 8 位 PNG，因此比较解压后的 8 位样本值，不能固定写入 255 伪造不透明边界。
  if (header.colorType === 0 && transparency && transparency.length !== 2) throw new Error("grayscale PNG 的 tRNS 必须包含 2 个字节");
  if (header.colorType === 2 && transparency && transparency.length !== 6) throw new Error("truecolor PNG 的 tRNS 必须包含 6 个字节");
  const grayscaleTransparency = header.colorType === 0 && transparency ? transparency.readUInt16BE(0) : null;
  const truecolorTransparency = header.colorType === 2 && transparency ? [transparency.readUInt16BE(0), transparency.readUInt16BE(2), transparency.readUInt16BE(4)] : null;
  const pixels = Buffer.alloc(header.width * header.height * 4);
  for (let index = 0; index < header.width * header.height; index += 1) {
    const source = index * channels; const target = index * 4;
    if (header.colorType === 6) rows.copy(pixels, target, source, source + 4);
    else if (header.colorType === 2) { pixels[target] = rows[source]; pixels[target + 1] = rows[source + 1]; pixels[target + 2] = rows[source + 2]; pixels[target + 3] = truecolorTransparency && rows[source] === truecolorTransparency[0] && rows[source + 1] === truecolorTransparency[1] && rows[source + 2] === truecolorTransparency[2] ? 0 : 255; }
    else if (header.colorType === 4) { pixels[target] = rows[source]; pixels[target + 1] = rows[source]; pixels[target + 2] = rows[source]; pixels[target + 3] = rows[source + 1]; }
    else if (header.colorType === 0) { const value = rows[source]; pixels.fill(value, target, target + 3); pixels[target + 3] = grayscaleTransparency !== null && value === grayscaleTransparency ? 0 : 255; }
    else { const paletteIndex = rows[source]; const paletteOffset = paletteIndex * 3; if (paletteOffset + 2 >= palette.length) throw new Error("PNG 调色板索引越界"); pixels[target] = palette[paletteOffset]; pixels[target + 1] = palette[paletteOffset + 1]; pixels[target + 2] = palette[paletteOffset + 2]; pixels[target + 3] = transparency?.[paletteIndex] ?? 255; }
  }
  return { width: header.width, height: header.height, pixels, metadata };
}

/** 生成稳定 RGBA PNG；iTXt 中的元数据让位图本身也能被机器复核。 */
export function encodePngRgba(width, height, pixels, metadata = null) {
  if (!(width > 0) || !(height > 0) || !Buffer.isBuffer(pixels) || pixels.length !== width * height * 4) throw new Error("RGBA 像素尺寸无效");
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) { raw[y * (width * 4 + 1)] = 0; pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const chunks = [pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(raw, { level: 9 }))];
  if (metadata !== null) chunks.push(pngChunk("iTXt", buildItxt("annotation-meta", JSON.stringify(metadata))));
  chunks.push(pngChunk("IEND", Buffer.alloc(0))); return Buffer.concat([PNG_SIGNATURE, ...chunks]);
}

/** 右栏单行的最大显示宽度；超长摘要按稳定的中英文宽度换行。 */
const MAX_VISIBLE_TEXT_UNITS = 48;

/** 返回右栏需要展示的全部行；先建模再绘制，避免小画布静默丢失状态或部件。 */
export function deriveVisibleAnnotationRows(regions = [], metadata = {}) {
  const rows = [];
  for (const region of regions.slice().sort((a, b) => a.annotation_number - b.annotation_number)) {
    const production = annotationProductionContract(region);
    // 右栏是给用户确认范围的简明说明；坐标、部件、状态和资产映射统一保存在 proposal 技术文件。
    rows.push({ kind: "summary", region_id: region.id, annotation_number: region.annotation_number, text: visibleSummaryText(region.implementation_plan?.summary, { annotation_number: region.annotation_number }) });
    // 标签只保留用户能直接理解的中文，不把 production_method 等合同字段暴露到图示。
    rows.push({ kind: "label", region_id: region.id, annotation_number: region.annotation_number, label: production.label, text: production.label });
    const elements = metadata.regions?.find((item) => item.region_id === region.id)?.decomposition_elements ?? [];
    for (const [index, element] of elements.entries()) {
      if (element.nine_slice === undefined) continue;
      const decision = validateNineSliceContract(element.nine_slice, "拆解部件 nine_slice");
      // 直接把适用决策放入阶段 A 人工确认图，不能只藏在技术 JSON 中留到 V4 实现时再试切片。
      const description = decision.mode === "stretch"
        ? `九宫格 源图${decision.source_size.width}×${decision.source_size.height} 边宽 左${decision.borders.left} 右${decision.borders.right} 上${decision.borders.top} 下${decision.borders.bottom}`
        : "九宫格不适用";
      rows.push({ kind: "nine-slice", region_id: region.id, annotation_number: region.annotation_number, element_id: element.element_id, text: `${region.annotation_number}.${index + 1} ${description}；${decision.reason}` });
    }
  }
  // 用户摘要和切片说明可换行；标签保持一行，便于人工快速扫描。
  return rows.flatMap((row) => row.kind !== "label" ? wrapVisibleAnnotationRow(row) : [row]);
}

/** 将稳定编号和中文摘要合成为右栏首要说明，不显示任何技术数量或 ID。 */
export function visibleSummaryText(value, context = {}) {
  const annotationNumber = Number.isInteger(context.annotation_number) ? String(context.annotation_number) : "?";
  const summary = String(value ?? "").trim() || "未提供摘要";
  return `${annotationNumber} ${summary}`;
}

/** 规范右栏用户标签；生产方法仍由正式合同校验，图示只展示中文结果。 */
export function annotationProductionContract(region = {}) {
  const nested = region.production_contract ?? region.productionContract ?? {};
  const read = (field, fallback) => nested?.[field] ?? region?.[field] ?? fallback;
  const production_method = String(read("production_method", region.implementation_plan?.mode === "reuse-existing" ? "reuse" : region.implementation_plan?.mode === "runtime-program" ? "runtime-program" : "") || "");
  const production_origin = String(read("production_origin", region.implementation_plan?.mode === "reuse-existing" ? "reused-existing" : "") || "");
  const delivery_kind = String(read("delivery_kind", region.implementation_plan?.mode === "runtime-program" ? "runtime-drawing" : region.implementation_plan?.mode === "reuse-existing" ? "existing-asset" : "raster-image") || "");
  // 只有明确的 reuse 方法、reuse-existing 计划和完整来源对象同时成立时，右栏才可显示“复用”。
  const reuseSnapshot = region.reuse_snapshot;
  const reuseBound = production_method === "reuse" && region.implementation_plan?.mode === "reuse-existing" && isObject(reuseSnapshot) && reuseSnapshot.schema === "asset-reuse-snapshot/1.0" && reuseSnapshot.source_status === "accepted";
  const nativeMethod = production_method === "runtime-program" || production_method === "cocos-graphics";
  const label = reuseBound ? "复用现有图片" : nativeMethod ? "程序绘制或动态逻辑" : "新建图片资产";
  return { production_method, production_origin, delivery_kind, label };
}

/** 按像素近似宽度换行；同一行的元数据保持不变，便于验证器逐行复核。 */
function wrapVisibleAnnotationRow(row) {
  const text = String(row.text ?? "");
  const chunks = [];
  let current = "";
  let units = 0;
  for (const character of [...text]) {
    const characterUnits = textVisualUnits(character);
    if (current && units + characterUnits > MAX_VISIBLE_TEXT_UNITS) {
      chunks.push(current);
      current = "";
      units = 0;
    }
    current += character;
    units += characterUnits;
  }
  if (current || chunks.length === 0) chunks.push(current);
  return chunks.map((chunk, index) => ({ ...row, text: chunk, continuation: index > 0 }));
}

/** 将冻结原图与原子框、编号和完整右侧说明栏合成为确定性 PNG。 */
export function renderRasterAnnotation(originalBytes, canvas, regions, metadata, planColors, planLabels) {
  const source = decodePngRgba(originalBytes); if (source.width !== canvas.width || source.height !== canvas.height) throw new Error("冻结原图尺寸与目标画布不一致");
  const rows = deriveVisibleAnnotationRows(regions, metadata); const fontSize = Math.max(1, Math.min(3, Math.floor(canvas.height / 28))); const lineHeight = Math.max(18, fontSize * 18); const headerLines = 3 + Object.keys(planColors).length; const maxTextWidth = Math.max(24 * 6 * fontSize, textVisualWidth("效果图拆解说明", fontSize), ...Object.entries(planColors).map(([mode]) => textVisualWidth(userPlanLabel(mode, planLabels), fontSize)), ...rows.map((row) => textVisualWidth(row.text, fontSize)));
  // 面板尺寸由完整行内容推导，换行后的每一行都能落在 PNG 内，不静默裁掉中文摘要。
  const panelWidth = Math.max(200, maxTextWidth + 24); const width = canvas.width + panelWidth; const height = Math.max(canvas.height, (headerLines + rows.length + 2) * lineHeight); const pixels = Buffer.alloc(width * height * 4, 255);
  for (let y = 0; y < canvas.height; y += 1) source.pixels.copy(pixels, y * width * 4, y * canvas.width * 4, (y + 1) * canvas.width * 4);
  fillRect(pixels, width, height, canvas.width, 0, panelWidth, height, [255, 255, 255, 255]); strokeRect(pixels, width, height, canvas.width, 0, panelWidth, height, [17, 24, 39, 255], 1);
  let line = 1; drawText(pixels, width, height, canvas.width + 8, line * lineHeight, "效果图拆解说明", [17, 24, 39, 255], fontSize); line += 2;
  for (const [mode, color] of Object.entries(planColors)) { const y = line * lineHeight; fillRect(pixels, width, height, canvas.width + 8, y - 5, 6, 6, parseColor(color)); drawText(pixels, width, height, canvas.width + 18, y, userPlanLabel(mode, planLabels), parseColor(color), fontSize); line += 1; }
  const markerRadius = Math.max(2, Math.min(12, Math.floor(canvas.width / 30), Math.floor(canvas.height / 16)));
  for (const region of regions.slice().sort((a, b) => a.annotation_number - b.annotation_number)) {
    const color = parseColor(planColors[region.implementation_plan?.mode] ?? "#111827"); const components = region.component_inventory?.components ?? []; const placements = components.flatMap((component) => component.placements ?? []); const markerX = clampInt((region.bounds?.x ?? 0) + markerRadius, markerRadius, canvas.width - markerRadius); const markerY = clampInt((region.bounds?.y ?? 0) + markerRadius, markerRadius, canvas.height - markerRadius);
    // 固定视觉一旦有 placement，只画可复用原子框；父框会误导为组合资产。
    if (!(region.owner_type === "fixed-production-visual" && placements.length > 0)) strokeRect(pixels, width, height, region.bounds.x, region.bounds.y, region.bounds.width, region.bounds.height, color, 2);
    fillCircle(pixels, width, height, markerX, markerY, markerRadius, color); drawTextCentered(pixels, width, height, markerX, markerY, String(region.annotation_number), [255, 255, 255, 255], fontSize);
    // 原子框只表达视觉范围；placement_id 等技术身份留在 PNG 元数据和 proposal 技术文件中。
    for (const placement of placements) { const bounds = placement.bounds ?? region.bounds; strokeRect(pixels, width, height, bounds.x, bounds.y, bounds.width, bounds.height, color, 1); }
  }
  rows.forEach((row, index) => { const region = regions.find((item) => item.id === row.region_id); const color = parseColor(planColors[region?.implementation_plan?.mode] ?? "#111827"); drawText(pixels, width, height, canvas.width + 8, (line + index) * lineHeight, row.text, color, fontSize); row.row_index = index; row.baseline = (line + index) * lineHeight; row.top = row.baseline - EFFECT_IMAGE_FONT_CELL_SIZE * fontSize; row.bottom = row.baseline; });
  const regionFrameModes = regions.map((region) => ({ region_id: region.id, parent_frame_drawn: !(region.owner_type === "fixed-production-visual" && (region.component_inventory?.components ?? []).some((component) => (component.placements ?? []).length > 0)) }));
  const outputMetadata = { schema: "effect-image-annotation/png/1", layout: "image-plus-right-panel", original_width: canvas.width, original_height: canvas.height, panel_width: panelWidth, panel_height: height, width, height, output_height: height, original_sha256: `sha256:${createHash("sha256").update(originalBytes).digest("hex")}`, plan_labels: planLabels, panel_content_complete: true, visible_row_count: rows.length, visible_rows: rows, panel_content_bounds: { x: canvas.width, y: 0, width: panelWidth, height }, region_frame_modes: regionFrameModes, regions: metadata?.regions ?? [] };
  return encodePngRgba(width, height, pixels, outputMetadata);
}

/** PNG CRC，避免依赖图像库并保证跨安装环境的字节稳定性。 */
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
/** 构造带长度和校验和的 PNG 数据块。 */
function pngChunk(type, data) { const body = Buffer.concat([Buffer.from(type, "ascii"), data]); const length = Buffer.alloc(4); length.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([length, body, crc]); }
/** 编码 annotation-meta iTXt 数据，供标注 PNG 携带可复核元数据。 */
function buildItxt(keyword, text) { return Buffer.concat([Buffer.from(keyword), Buffer.from([0, 0, 0]), Buffer.from([0]), Buffer.from([0]), Buffer.from(text, "utf8")]); }
/** 解析标注元数据块；非目标关键字保持已有元数据不变。 */
function parseItxt(data, current) { const keywordEnd = data.indexOf(0); if (keywordEnd < 0 || data[keywordEnd + 1] !== 0) return current; let cursor = keywordEnd + 3; const languageEnd = data.indexOf(0, cursor); if (languageEnd < 0) return current; cursor = languageEnd + 1; const translatedEnd = data.indexOf(0, cursor); if (translatedEnd < 0) return current; const keyword = data.toString("utf8", 0, keywordEnd); return keyword === "annotation-meta" ? JSON.parse(data.toString("utf8", translatedEnd + 1)) : current; }
/** 计算 PNG 过滤器所需的 Paeth 邻域预测值。 */
function paeth(a, b, c) { const p = a + b - c; const pa = Math.abs(p - a); const pb = Math.abs(p - b); const pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
/** 将十六进制颜色解析为不透明 RGBA；非法颜色回退到稳定深色。 */
function parseColor(value) { const match = String(value).match(/^#([0-9a-f]{6})$/i); if (!match) return [17, 24, 39, 255]; return [Number.parseInt(match[1].slice(0, 2), 16), Number.parseInt(match[1].slice(2, 4), 16), Number.parseInt(match[1].slice(4, 6), 16), 255]; }
/** 将坐标限制为可绘制的整数范围。 */
function clampInt(value, minimum, maximum) { return Math.round(Math.min(Math.max(value, minimum), Math.max(minimum, maximum))); }
/** 返回 RGBA 缓冲区中指定像素的起始偏移。 */
function pixelIndex(width, x, y) { return (y * width + x) * 4; }
/** 在画布边界内按 alpha 混合写入单个像素。 */
function setPixel(pixels, width, height, x, y, color) { if (x < 0 || y < 0 || x >= width || y >= height) return; const index = pixelIndex(width, x, y); const alpha = color[3] / 255; pixels[index] = Math.round(color[0] * alpha + pixels[index] * (1 - alpha)); pixels[index + 1] = Math.round(color[1] * alpha + pixels[index + 1] * (1 - alpha)); pixels[index + 2] = Math.round(color[2] * alpha + pixels[index + 2] * (1 - alpha)); pixels[index + 3] = 255; }
/** 填充裁剪到画布范围内的矩形。 */
function fillRect(pixels, width, height, x, y, rectWidth, rectHeight, color) { for (let yy = Math.max(0, Math.floor(y)); yy < Math.min(height, Math.ceil(y + rectHeight)); yy += 1) for (let xx = Math.max(0, Math.floor(x)); xx < Math.min(width, Math.ceil(x + rectWidth)); xx += 1) setPixel(pixels, width, height, xx, yy, color); }
/** 以固定厚度绘制矩形边框。 */
function strokeRect(pixels, width, height, x, y, rectWidth, rectHeight, color, thickness) { for (let i = 0; i < thickness; i += 1) { fillRect(pixels, width, height, x + i, y + i, rectWidth - i * 2, 1, color); fillRect(pixels, width, height, x + i, y + rectHeight - i - 1, rectWidth - i * 2, 1, color); fillRect(pixels, width, height, x + i, y + i, 1, rectHeight - i * 2, color); fillRect(pixels, width, height, x + rectWidth - i - 1, y + i, 1, rectHeight - i * 2, color); } }
/** 填充圆形编号标记，并由 setPixel 统一处理边界裁剪。 */
function fillCircle(pixels, width, height, cx, cy, radius, color) { for (let y = -radius; y <= radius; y += 1) for (let x = -radius; x <= radius; x += 1) if (x * x + y * y <= radius * radius) setPixel(pixels, width, height, cx + x, cy + y, color); }
/** 标准 5x7 ASCII 字模，确保右栏英文具有稳定且人工可读的字形。 */
const STANDARD_ASCII_GLYPHS = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"], "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"], "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"], "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"], "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"], "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"], "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"], "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"], B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"], C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"], D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"], E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"], F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"], H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"], I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"], J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"], K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"], L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"], N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"], O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"], P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"], Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"], R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"], T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"], U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"], V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"], W: ["10001", "10001", "10101", "10101", "10101", "11011", "10001"], X: ["10001", "01010", "00100", "00100", "00100", "01010", "10001"], Y: ["10001", "01010", "00100", "00100", "00100", "00100", "00100"], Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"], "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"], "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"], ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"], ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"], "/": ["00001", "00010", "00100", "01000", "10000", "00000", "00000"], "_": ["00000", "00000", "00000", "00000", "00000", "00000", "11111"], ",": ["00000", "00000", "00000", "00000", "00000", "01100", "00100"], "=": ["00000", "11111", "00000", "11111", "00000", "00000", "00000"], "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"], "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"], "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"]
};
/** 复制标准 ASCII 字模；中文则来自随包固定的 OFL 字库。 */
const FONT = { ...STANDARD_ASCII_GLYPHS };
/** 解压固定字库一次，避免重复解析并保持运行时不访问系统字体。 */
const EFFECT_IMAGE_FONT_BYTES = inflateSync(Buffer.from(EFFECT_IMAGE_FONT_DATA_BASE64, "base64"));
/** 建立字符到 16x16 位图偏移的索引，未知字符不允许回退成方框。 */
const EFFECT_IMAGE_FONT_INDEX = new Map([...EFFECT_IMAGE_FONT_KEYS].map((character, index) => [character, index]));
/** 从固定字库读取一个真实 16x16 字形；不支持的字符在生成阶段明确失败。 */
function effectImageGlyph(character) {
  const index = EFFECT_IMAGE_FONT_INDEX.get(character);
  if (index === undefined) throw new Error(`右栏文字包含未收录字符：${character}（U+${character.codePointAt(0).toString(16).toUpperCase()}）`);
  const rowBytes = EFFECT_IMAGE_FONT_CELL_SIZE / 8;
  const offset = index * EFFECT_IMAGE_FONT_CELL_SIZE * rowBytes;
  return Array.from({ length: EFFECT_IMAGE_FONT_CELL_SIZE }, (_, row) => {
    const value = EFFECT_IMAGE_FONT_BYTES[offset + row * rowBytes] * 256 + EFFECT_IMAGE_FONT_BYTES[offset + row * rowBytes + 1];
    return value.toString(2).padStart(EFFECT_IMAGE_FONT_CELL_SIZE, "0");
  });
}
/** 暴露固定字库字形快照，测试可验证不同汉字确实对应不同像素。 */
export function effectImageFontGlyph(character) { return effectImageGlyph(character); }

/** 返回单个字符的标准 5x7 字模，供绘制和像素回归共享。 */
function charGlyph(char) { return STANDARD_ASCII_GLYPHS[char] ?? STANDARD_ASCII_GLYPHS["?"]; }
/** 暴露稳定字模快照，测试可证明关键字母不会退化为伪随机线条。 */
export function asciiGlyph(value) { return [...asciiText(value)].slice(0, 1).map((char) => [...(FONT[char] ?? FONT["?"])]); }
/** 将结构字段规范为可绘制 ASCII；不再把非法字符静默替换成问号。 */
function asciiText(value) { const text = String(value ?? ""); if (/[^\x20-\x7e]/u.test(text)) throw new Error(`右栏结构字段包含非 ASCII 字符：${text}`); return text.toUpperCase(); }
/** 判断字符是否应使用随包 OFL 字库；所有非 ASCII 字符均需经过字库索引。 */
function isCjkCharacter(character) { return /[^\x00-\x7f]/u.test(character); }
/** 保留中文摘要，同时将英文结构字段规范为大写，确保字模选择稳定。 */
function mixedText(value) { return [...String(value ?? "")].map((character) => isCjkCharacter(character) ? character : character.toUpperCase()).join(""); }
/** 返回一字在右栏布局中的稳定宽度单位；全角中文按两个 ASCII 单位计算。 */
function textVisualUnits(value) { return [...String(value ?? "")].reduce((sum, character) => sum + (isCjkCharacter(character) ? 2 : 1), 0); }
/** 返回字符的实际绘制步进；完整 ASCII 由固定字库补齐，未知字符直接失败。 */
function glyphAdvance(character, scale) { if (isCjkCharacter(character) || (!FONT[character] && EFFECT_IMAGE_FONT_INDEX.has(character))) return (EFFECT_IMAGE_FONT_CELL_SIZE + 2) * scale; if (FONT[character]) return 6 * scale; throw new Error(`右栏文字包含未收录字符：${character}`); }
/** 按当前字号计算混合文本的像素宽度，供面板扩展和居中绘制共用。 */
function textVisualWidth(value, scale) { return [...mixedText(value)].reduce((sum, character) => sum + glyphAdvance(character, scale), 0); }
/** 将生产模式转换为右栏可读的稳定中文标签；未知模式仍保留可审计的 ASCII 值。 */
function userPlanLabel(mode, planLabels = {}) { return planLabels?.[mode] ?? { "generate-now": "新建图片资产", "reuse-existing": "复用现有图片", "runtime-program": "程序绘制或动态逻辑" }[mode] ?? asciiText(mode); }
/** 在确定性位图上绘制中英文混合文本；中文直接落入像素，不能只依赖 iTXt。 */
function drawText(pixels, width, height, x, baseline, value, color, scale) {
  let cursor = Math.round(x);
  for (const character of [...mixedText(value)]) {
    const cjk = isCjkCharacter(character);
    const glyph = cjk ? effectImageGlyph(character) : FONT[character] ?? effectImageGlyph(character);
    for (let y = 0; y < glyph.length; y += 1) for (let xx = 0; xx < glyph[y].length; xx += 1) if (glyph[y][xx] === "1") fillRect(pixels, width, height, cursor + xx * scale, baseline - (glyph.length - y) * scale, scale, scale, color);
    cursor += glyphAdvance(character, scale);
  }
}
/** 绘制编号圆点中的居中文本。 */
function drawTextCentered(pixels, width, height, cx, cy, value, color, scale) { drawText(pixels, width, height, cx - textVisualWidth(value, scale) / 2, cy + 3 * scale, value, color, scale); }
