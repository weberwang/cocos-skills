/**
 * V2 布局事实来源解析器。
 *
 * 场景合同只引用一份 layout-nodes.json；解析时校验文件边界和布局身份，
 * 并复用正式节点文档校验，避免下游从合同副本读取分组或布局策略。
 */
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve, sep, win32 } from "node:path";
import { validateLayoutNodesDocument } from "../../cocos-game-asset-integration/scripts/layout_review_bundle.mjs";

const LAYOUT_NODES_SCHEMA = "cocos-layout-nodes/1.0";

/** 判断普通对象。 */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 生成稳定 JSON，供 viewport 等结构化身份比较。 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  const encoded = JSON.stringify(value);
  return encoded === undefined ? "null" : encoded;
}

/** 在 Windows 与 POSIX 语义下共同限制项目相对路径，并返回规范斜杠路径。 */
function normalizeProjectRelativePath(value) {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("layout_source.nodes_file 必须是非空项目相对路径");
  const normalized = value.replaceAll("\\", "/");
  if (isAbsolute(value) || win32.isAbsolute(value) || normalized.startsWith("//")) throw new Error("layout_source.nodes_file 不得是绝对路径");
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) throw new Error("layout_source.nodes_file 不得包含父目录跳转");
  const clean = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
  if (!clean || clean.split("/").some((segment) => segment.includes(":"))) throw new Error("layout_source.nodes_file 不是合法的项目相对路径");
  return clean;
}

/** 判断规范化后的路径是否位于项目根目录之内。 */
function isWithin(root, candidate) {
  const child = relative(root, candidate);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

/** 读取真实布局源；测试注入仅在显式提供 Map 且未要求实盘校验时可用。 */
function readLayoutSourceDocument(relativePath, options) {
  const injected = options.layoutSourceDocuments;
  if (options.forceLayoutSourceFiles !== true && injected instanceof Map) {
    if (!injected.has(relativePath)) throw new Error(`layoutSourceDocuments 未包含 ${relativePath}`);
    return { document: injected.get(relativePath), file: options.projectRoot ? resolve(options.projectRoot, relativePath) : relativePath };
  }

  if (typeof options.projectRoot !== "string" || options.projectRoot.trim().length === 0) throw new Error("读取真实 V2 布局源必须提供 projectRoot");
  const root = resolve(options.projectRoot);
  const file = resolve(root, relativePath);
  if (!isWithin(root, file)) throw new Error("layout_source.nodes_file 词法路径越界");
  let realRoot;
  let realFile;
  try {
    realRoot = realpathSync(root);
    realFile = realpathSync(file);
  } catch (error) {
    throw new Error(`V2 布局源文件不存在或无法解析：${relativePath}（${error.message}）`);
  }
  if (!isWithin(realRoot, realFile)) throw new Error("layout_source.nodes_file 真实路径越界");
  if (!statSync(realFile).isFile()) throw new Error("V2 布局源必须是文件");
  let document;
  try {
    document = JSON.parse(readFileSync(realFile, "utf8"));
  } catch (error) {
    throw new Error(`V2 布局源 JSON 无效：${error.message}`);
  }
  return { document, file: realFile };
}

/** 解析 V2 唯一布局事实文件，并核对其与冻结场景和确认身份一致。 */
export function resolveV2LayoutSource(source, options = {}, expected = {}) {
  if (!isObject(source)) throw new Error("layout_decomposition.layout_source 必须是对象");
  const sourceFields = Object.keys(source);
  if (sourceFields.length !== 1 || sourceFields[0] !== "nodes_file") throw new Error("layout_source 只允许 nodes_file，禁止携带可覆盖布局事实的附加字段");

  const relativePath = normalizeProjectRelativePath(source.nodes_file);
  const { document, file } = readLayoutSourceDocument(relativePath, options);
  if (!isObject(document) || document.schema !== LAYOUT_NODES_SCHEMA) throw new Error(`V2 布局源 schema 必须为 ${LAYOUT_NODES_SCHEMA}`);

  const validationErrors = [];
  validateLayoutNodesDocument(document, {}, validationErrors, "V2 layout source");
  if (validationErrors.length > 0) throw new Error(validationErrors[0]);

  const expectedFields = [
    ["sceneId", "scene_id"],
    ["stateId", "state_id"],
    ["decompositionConfirmationId", "decomposition_confirmation_id"],
    ["layoutDecisionId", "layout_decision_id"],
  ];
  for (const [camel, snake] of expectedFields) {
    const expectedValue = expected[camel] ?? expected[snake];
    if (expectedValue !== undefined && document[snake] !== expectedValue) {
      throw new Error(`V2 layout source.${snake} 与冻结身份不一致`);
    }
  }
  const expectedViewport = expected.viewport ?? expected.targetViewport ?? expected.target_viewport;
  if (expectedViewport !== undefined && canonicalJson(document.viewport) !== canonicalJson(expectedViewport)) {
    throw new Error("V2 layout source.viewport 与冻结目标不一致");
  }

  return {
    document,
    nodes: document.layout_nodes,
    rootNodes: document.root_nodes,
    file,
  };
}
