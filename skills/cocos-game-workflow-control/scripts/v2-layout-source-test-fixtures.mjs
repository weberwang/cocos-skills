import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { deriveAutomaticLayoutFacts } from "../../cocos-game-asset-integration/scripts/layout_annotation_contract.mjs";
import { buildLayoutNodesDocument } from "../../cocos-game-asset-integration/scripts/layout_review_bundle.mjs";
import { deriveLayoutExecutionPlans } from "../../cocos-game-ui-layout/scripts/widget-layout.mjs";
import { computeLayoutAnnotationConfirmationSha256 } from "./layout_annotation_confirmation.mjs";

/** 所有结构测试共用显式注入表；正式 file gate 必须设置 forceLayoutSourceFiles。 */
export const layoutSourceDocuments = new Map();
let fixtureSequence = 0;

/** 统一读取测试 fixture 的字段别名。 */
function field(value, ...names) {
  for (const name of names) if (value?.[name] !== undefined && value?.[name] !== null) return value[name];
  return undefined;
}

/** 为场景测试注册唯一布局源，并从唯一节点输入派生完整文档。 */
export function registerFixtureV2Layout(contract, nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) throw new Error("测试 V2 布局源需要非空节点数组");
  const decomposition = contract?.layout_decomposition;
  const annotation = decomposition?.layout_annotation;
  const confirmation = decomposition?.layout_annotation_confirmation;
  const target = contract?.target_conditions;
  if (!decomposition || !annotation || !confirmation || !target?.viewport) throw new Error("测试 V2 布局源缺少场景合同身份");

  const sceneId = target.scene_id ?? target.sceneId;
  const stateId = target.state_id ?? target.stateId;
  const decompositionConfirmationId = field(annotation, "decomposition_confirmation_id", "decompositionConfirmationId");
  const layoutDecisionId = field(annotation, "layout_decision_id", "layoutDecisionId");
  const normalizedNodes = nodes.map((node) => {
    const parentId = field(node, "parent_layout_node_id", "parentLayoutNodeId");
    return {
      ...node,
      layout_node_id: field(node, "layout_node_id", "layoutNodeId"),
      parent_layout_node_id: parentId,
      reference_id: field(node, "reference_id", "referenceId") ?? parentId,
      region_id: field(node, "region_id", "regionId"),
      target_bounds: field(node, "target_bounds", "targetBounds", "bounds"),
      axis_alignment: field(node, "axis_alignment", "axisAlignment") ?? { horizontal: "left", vertical: "top" },
      ui_layout: node?.ui_layout ?? { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FLEX", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" },
    };
  });
  const nodesWithExecution = deriveLayoutExecutionPlans(normalizedNodes);
  const derivedFacts = deriveAutomaticLayoutFacts(nodesWithExecution, target.viewport, { sceneId, stateId });
  const sourceById = new Map(nodesWithExecution.map((node) => [node.layout_node_id, node]));
  // 自动派生掌握父子、几何、定位和执行策略；其他已确认身份字段从原拆解节点继承。
  const facts = derivedFacts.map((fact) => ({
    ...sourceById.get(fact.layout_node_id),
    ...fact,
  }));
  const document = buildLayoutNodesDocument(facts, {
    viewport: target.viewport,
    sceneId,
    stateId,
    decompositionConfirmationId,
    layoutDecisionId,
    targetSha256: target.target_sha256 ?? target.targetSha256,
  });

  const nodesFile = `evidence/v2/layout-nodes-fixture-${++fixtureSequence}.json`;
  decomposition.layout_source = { nodes_file: nodesFile };
  delete decomposition.layout_nodes;
  delete decomposition.layoutNodes;
  annotation.layout_nodes_file = nodesFile;
  annotation.layout_node_ids = document.layout_nodes.map((node) => node.layout_node_id);
  confirmation.layout_nodes_file = nodesFile;
  if (Object.hasOwn(confirmation, "confirmation_sha256")) {
    confirmation.confirmation_sha256 = computeLayoutAnnotationConfirmationSha256(confirmation);
  }
  layoutSourceDocuments.set(nodesFile, document);
  return nodesFile;
}

/** 获取测试映射中的业务节点；clone 场景合同仍通过 nodes_file 指向同一文档。 */
export function fixtureLayoutNodes(contract) {
  const nodesFile = contract?.layout_decomposition?.layout_source?.nodes_file;
  const document = layoutSourceDocuments.get(nodesFile);
  if (!document) throw new Error(`测试 fixture 未注册布局源：${nodesFile ?? "missing"}`);
  return document.layout_nodes;
}

/** 获取完整测试布局源文档，供需要修改根事实或文件快照的测试使用。 */
export function fixtureLayoutDocument(contract) {
  const nodesFile = contract?.layout_decomposition?.layout_source?.nodes_file;
  const document = layoutSourceDocuments.get(nodesFile);
  if (!document) throw new Error(`测试 fixture 未注册布局源：${nodesFile ?? "missing"}`);
  return document;
}

/** 在临时项目中写入符合真实 schema 的布局源，供文件门测试强制读取。 */
export function writeFixtureV2Layout(projectRoot, contract, nodes) {
  const decomposition = contract.layout_decomposition ??= {};
  const annotation = decomposition.layout_annotation ??= {};
  annotation.decomposition_confirmation_id ??= "fixture-decomposition-confirmation";
  annotation.layout_decision_id ??= "fixture-layout-decision";
  decomposition.layout_annotation_confirmation ??= {};
  registerFixtureV2Layout(contract, nodes);
  const document = fixtureLayoutDocument(contract);
  const nodesFile = decomposition.layout_source.nodes_file;
  const absolutePath = resolve(projectRoot, nodesFile);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const bytes = `${JSON.stringify(document, null, 2)}\n`;
  writeFileSync(absolutePath, bytes, "utf8");
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  annotation.layout_nodes_sha256 = sha256;
  decomposition.layout_annotation_confirmation.layout_nodes_sha256 = sha256;
  if (Object.hasOwn(decomposition.layout_annotation_confirmation, "confirmation_sha256")) {
    decomposition.layout_annotation_confirmation.confirmation_sha256 = computeLayoutAnnotationConfirmationSha256(decomposition.layout_annotation_confirmation);
  }
  return { file: nodesFile, sha256, document };
}

/** 为被测克隆合同分配独立布局源，防止节点变更串到原测试合同。 */
export function isolateFixtureV2Layout(contract) {
  const decomposition = contract?.layout_decomposition;
  const previousFile = decomposition?.layout_source?.nodes_file;
  const previous = layoutSourceDocuments.get(previousFile);
  if (!previous) throw new Error(`测试 fixture 未注册布局源：${previousFile ?? "missing"}`);
  const nodesFile = `evidence/v2/layout-nodes-fixture-${++fixtureSequence}.json`;
  decomposition.layout_source = { nodes_file: nodesFile };
  decomposition.layout_annotation.layout_nodes_file = nodesFile;
  decomposition.layout_annotation_confirmation.layout_nodes_file = nodesFile;
  const document = structuredClone(previous);
  layoutSourceDocuments.set(nodesFile, document);
  if (Object.hasOwn(decomposition.layout_annotation_confirmation, "confirmation_sha256")) {
    decomposition.layout_annotation_confirmation.confirmation_sha256 = computeLayoutAnnotationConfirmationSha256(decomposition.layout_annotation_confirmation);
  }
  return document.layout_nodes;
}

/** 为结构验证器显式注入测试文档，同时保留调用方的其他选项。 */
export function fixtureLayoutSourceOptions(options = {}) {
  return { ...options, layoutSourceDocuments };
}
