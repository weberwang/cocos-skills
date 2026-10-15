import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

const PAGE_MARKERS = new Set(["format", "filter", "repeat", "pma", "scale", "minfilter", "magfilter", "anisotropic"]);
const REGION_MARKERS = new Set(["rotate", "xy", "bounds", "orig", "offset", "offsets", "index", "split", "pad"]);

/** 表示清单、Atlas 或候选产物不满足换皮约束。 */
export class ReskinError extends Error {}

/** 解析 Atlas 键值行，保留字段名称的原始大小写。 */
export function fieldParts(line) {
  if (!line.includes(":")) return null;
  const index = line.trim().indexOf(":");
  const key = line.trim().slice(0, index).trim();
  return key ? [key, line.trim().slice(index + 1).trim()] : null;
}

/** 按不区分大小写查找字段。 */
export function field(fields, name, fallback = null) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(fields)) if (key.toLowerCase() === target) return value;
  return fallback;
}

/** 解析固定数量的 Atlas 整数，并拒绝小数或空字段。 */
function numbers(value, count, label) {
  if (value == null) throw new ReskinError(`Atlas 字段 ${label} 缺失`);
  const tokens = value.trim().split(/[,\s]+/).filter(Boolean);
  if (tokens.length !== count || tokens.some((token) => !/^-?\d+$/.test(token))) throw new ReskinError(`Atlas 字段 ${label} 需要 ${count} 个整数：${value}`);
  return tokens.map(Number);
}

/** 标准化 Spine rotate 字段为 0/90/180/270 度。 */
function rotateDegrees(value) {
  if (value == null || ["false", "0", "none"].includes(value.trim().toLowerCase())) return 0;
  if (["true", "yes"].includes(value.trim().toLowerCase())) return 90;
  if (!/^-?\d+$/.test(value.trim()) || Number(value) % 90 !== 0) throw new ReskinError(`rotate 必须是 90 度倍数：${value}`);
  return ((Number(value) % 360) + 360) % 360;
}

/** 返回旋转后写入 Page 的矩形尺寸对应的正向尺寸。 */
function uprightSize(size, degrees) { return [90, 270].includes(degrees) ? [size[1], size[0]] : [...size]; }

/** 校验 Region 的尺寸、裁剪偏移和 Page 内矩形边界。 */
function validateCellGeometry(cell, page) {
  const [x, y] = cell.xy;
  const [width, height] = cell.size;
  if (![x, y, width, height, ...cell.orig, ...cell.offset].every(Number.isInteger)) throw new ReskinError(`Region ${cell.name} 的几何字段必须是整数`);
  if (width <= 0 || height <= 0) throw new ReskinError(`Region ${cell.name} 的 size 必须为正数`);
  if (x < 0 || y < 0 || x + width > page.width || y + height > page.height) throw new ReskinError(`Region ${cell.name} 越出 Page ${page.name} 边界`);
  const [uprightWidth, uprightHeight] = uprightSize(cell.size, cell.rotate_degrees);
  if (cell.orig[0] <= 0 || cell.orig[1] <= 0) throw new ReskinError(`Region ${cell.name} 的 orig 必须为正数`);
  if (cell.offset[0] < 0 || cell.offset[1] < 0 || cell.offset[0] + uprightWidth > cell.orig[0] || cell.offset[1] + uprightHeight > cell.orig[1]) throw new ReskinError(`Region ${cell.name} 的 offset/orig 不合法`);
}

/** 拒绝同一 Page 内有面积交集的 Region，避免重建时静默覆盖。 */
function rejectOverlaps(cells, page) {
  const pageCells = cells.filter((cell) => cell.page_index === page.index);
  for (let left = 0; left < pageCells.length; left += 1) for (let right = left + 1; right < pageCells.length; right += 1) {
    const first = pageCells[left];
    const second = pageCells[right];
    const overlaps = first.xy[0] < second.xy[0] + second.size[0] && first.xy[0] + first.size[0] > second.xy[0] && first.xy[1] < second.xy[1] + second.size[1] && first.xy[1] + first.size[1] > second.xy[1];
    if (overlaps) throw new ReskinError(`Page ${page.name} 的 Region ${first.name} 与 ${second.name} 矩形重叠`);
  }
}

/** 按空行或字段块后的名称分割 Atlas 块。 */
function splitBlocks(text) {
  const blocks = [];
  let current = [];
  let hasFields = false;
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) {
      if (current.length) blocks.push(current);
      current = [];
      hasFields = false;
      continue;
    }
    if (current.length && hasFields && !line.includes(":")) {
      blocks.push(current);
      current = [];
      hasFields = false;
    }
    current.push(raw.trimEnd());
    hasFields ||= line.includes(":");
  }
  if (current.length) blocks.push(current);
  return blocks;
}

/** 解析块字段和原始字段顺序，未知字段会随清单保留。 */
function blockFields(lines) {
  const fields = {};
  const order = [];
  for (const line of lines.slice(1)) {
    const parts = fieldParts(line);
    if (parts) {
      fields[parts[0]] = parts[1];
      order.push(parts[0]);
    }
  }
  return [fields, order];
}

/** 根据专有字段区分 Page 和 Region。 */
function looksLikePage(fields, first) {
  if (first) return true;
  const keys = new Set(Object.keys(fields).map((key) => key.toLowerCase()));
  if ([...keys].some((key) => PAGE_MARKERS.has(key))) return true;
  return keys.has("size") && ![...keys].some((key) => REGION_MARKERS.has(key));
}

/** 校验 Page 名称只能是 Atlas 所在目录下的相对文件名。 */
function validatePageName(name) {
  const normalized = name.replaceAll("\\", "/");
  if (!name || !name.trim() || isAbsolute(name) || /^(?:[A-Za-z]:\/|\/)/.test(normalized) || normalized.split("/").includes("..")) throw new ReskinError(`Page 名称必须是非空相对路径且不能包含 ..：${name}`);
}

/** 解析全部 Atlas Page 与 Region，并执行输入几何审计。 */
export async function parseAtlas(path) {
  let text;
  try {
    text = (await readFile(path, "utf8")).replace(/^\uFEFF/, "");
  } catch (error) {
    throw new ReskinError(`无法读取 Atlas ${path}（需要 UTF-8）：${error.message}`);
  }
  const blocks = splitBlocks(text);
  if (!blocks.length) throw new ReskinError("Atlas 为空");
  const pages = [];
  const cells = [];
  const pageNames = new Set();
  const regionNames = new Map();
  let currentPage = -1;
  blocks.forEach((lines, blockIndex) => {
    const [fields, fieldOrder] = blockFields(lines);
    if (looksLikePage(fields, blockIndex === 0)) {
      const name = lines[0].trim();
      validatePageName(name);
      if (pageNames.has(name)) throw new ReskinError(`Atlas 重复 Page：${name}`);
      const size = numbers(field(fields, "size"), 2, "size");
      if (size[0] <= 0 || size[1] <= 0) throw new ReskinError(`Page ${name} 尺寸必须为正数：${size.join(", ")}`);
      pageNames.add(name);
      pages.push({ index: pages.length, name, width: size[0], height: size[1], fields, field_order: fieldOrder });
      regionNames.set(pages.length - 1, new Set());
      currentPage = pages.length - 1;
      return;
    }
    if (currentPage < 0) throw new ReskinError(`Region ${lines[0]} 没有所属 Page`);
    const name = lines[0].trim();
    if (regionNames.get(currentPage).has(name)) throw new ReskinError(`Page ${pages[currentPage].name} 内重复 Region：${name}`);
    regionNames.get(currentPage).add(name);
    let xy;
    let size;
    const bounds = field(fields, "bounds");
    if (bounds != null) {
      const values = numbers(bounds, 4, "bounds");
      xy = values.slice(0, 2);
      size = values.slice(2);
    } else {
      xy = numbers(field(fields, "xy"), 2, "xy");
      size = numbers(field(fields, "size"), 2, "size");
    }
    const parsedRotate = rotateDegrees(field(fields, "rotate"));
    let offset;
    let orig;
    const offsets = field(fields, "offsets");
    if (offsets != null) {
      const values = numbers(offsets, 4, "offsets");
      offset = values.slice(0, 2);
      orig = values.slice(2);
    } else {
      orig = numbers(field(fields, "orig", uprightSize(size, parsedRotate).join(",")), 2, "orig");
      offset = numbers(field(fields, "offset", "0, 0"), 2, "offset");
    }
    const indexValue = field(fields, "index", "-1");
    if (!/^-?\d+$/.test(indexValue)) throw new ReskinError(`Region ${name} 的 index 不是整数：${indexValue}`);
    const cell = { id: `p${currentPage}:${name}`, name, page_index: currentPage, page: pages[currentPage].name, xy, size, orig, offset, rotate: field(fields, "rotate", "false"), rotate_degrees: parsedRotate, index: Number(indexValue), fields, field_order: fieldOrder };
    validateCellGeometry(cell, pages[currentPage]);
    cells.push(cell);
  });
  if (!pages.length) throw new ReskinError("Atlas 没有 Page");
  for (const page of pages) rejectOverlaps(cells, page);
  return { pages, cells };
}

/** 返回输出 Atlas 文本，不复制源 Page 像素。 */
export function atlasText(document) {
  const lines = [];
  for (const page of document.atlas.pages) {
    lines.push(page.output_name ?? page.name);
    const order = [...(page.field_order ?? [])];
    if (!order.some((key) => key.toLowerCase() === "size")) order.unshift("size");
    for (const key of order) lines.push(`${key}: ${key.toLowerCase() === "size" ? pair([page.width, page.height]) : field(page.fields ?? {}, key, "") ?? ""}`);
    // Atlas 运行时允许 Page 与 Region 之间紧邻；空行只用于分隔不同 Page。
    for (const cell of document.cells.filter((item) => item.page_index === page.index)) {
      lines.push(cell.name);
      const order2 = [...(cell.field_order ?? [])];
      const lowered = new Set(order2.map((key) => key.toLowerCase()));
      if (!lowered.has("rotate")) order2.push("rotate");
      if (!lowered.has("xy") && !lowered.has("bounds")) order2.push("xy");
      if (!lowered.has("size")) order2.push("size");
      if (!lowered.has("orig") && !lowered.has("offsets")) order2.push("orig", "offset");
      if (!lowered.has("index")) order2.push("index");
      for (const key of order2) {
        const lower = key.toLowerCase();
        let value = field(cell.fields ?? {}, key, "") ?? "";
        if (lower === "rotate") value = cell.rotate ?? "false";
        else if (lower === "xy") value = pair(cell.xy);
        else if (lower === "bounds") value = quad([...cell.xy, ...cell.size]);
        else if (lower === "size") value = pair(cell.size);
        else if (lower === "orig") value = pair(cell.orig);
        else if (lower === "offset") value = pair(cell.offset);
        else if (lower === "offsets") value = quad([...cell.offset, ...cell.orig]);
        else if (lower === "index") value = String(cell.index);
        lines.push(`  ${key}: ${value}`);
      }
    }
    if (page !== document.atlas.pages.at(-1)) lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

/** 格式化二元坐标。 */
function pair(values) { return `${values[0]}, ${values[1]}`; }

/** 格式化四元坐标。 */
function quad(values) { return values.join(", "); }
