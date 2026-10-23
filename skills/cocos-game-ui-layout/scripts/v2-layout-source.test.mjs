import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deriveAutomaticLayoutFacts } from "../../cocos-game-asset-integration/scripts/layout_annotation_contract.mjs";
import { buildLayoutNodesDocument } from "../../cocos-game-asset-integration/scripts/layout_review_bundle.mjs";
import { resolveV2LayoutSource } from "./v2-layout-source.mjs";

const VIEWPORT = { width: 96, height: 80 };

/** 构造通过正式节点、父子、执行计划与根节点校验的布局源文件。 */
function layoutDocument(overrides = {}) {
  const nodes = [{
    layout_node_id: "panel",
    element_id: "panel",
    parent_layout_node_id: "viewport",
    layout_role: "container",
    ui_layout: { grouping_basis: ["LAYOUT"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" },
    axis_alignment: { horizontal: "center", vertical: "center" },
    target_bounds: { x: 18, y: 14, width: 60, height: 52 },
  }];
  const facts = deriveAutomaticLayoutFacts(nodes, VIEWPORT, { sceneId: "main", stateId: "default" });
  return buildLayoutNodesDocument(facts, {
    viewport: VIEWPORT,
    sceneId: "main",
    stateId: "default",
    decompositionConfirmationId: "decomposition-1",
    layoutDecisionId: "layout-decision-1",
    ...overrides,
  });
}

const SOURCE = { nodes_file: "evidence/v2/layout-nodes.json" };
const EXPECTED = {
  sceneId: "main",
  stateId: "default",
  viewport: VIEWPORT,
  decompositionConfirmationId: "decomposition-1",
  layoutDecisionId: "layout-decision-1",
};

test("V2 布局源返回同一份业务节点与显式根节点", () => {
  const document = layoutDocument();
  const resolved = resolveV2LayoutSource(SOURCE, { layoutSourceDocuments: new Map([[SOURCE.nodes_file, document]]) }, EXPECTED);

  assert.equal(resolved.document, document);
  assert.deepEqual(resolved.nodes, document.layout_nodes);
  assert.deepEqual(resolved.rootNodes, document.root_nodes);
  assert.equal(resolved.file, SOURCE.nodes_file);
});

test("布局源仅接受 nodes_file，拒绝附加布局事实和内联覆盖字段", () => {
  const document = layoutDocument();
  const options = { layoutSourceDocuments: new Map([[SOURCE.nodes_file, document]]) };

  assert.throws(() => resolveV2LayoutSource({ ...SOURCE, layout_nodes: [] }, options), /只允许 nodes_file/);
  assert.throws(() => resolveV2LayoutSource({ ...SOURCE, parent_map: {} }, options), /只允许 nodes_file/);
  assert.throws(() => resolveV2LayoutSource({ layoutNodesFile: SOURCE.nodes_file }, options), /只允许 nodes_file/);
});

test("布局源路径与冻结 scene、state、viewport、确认及 decision 身份必须一致", () => {
  const document = layoutDocument();
  const options = { layoutSourceDocuments: new Map([[SOURCE.nodes_file, document]]) };

  for (const mismatch of [
    { sceneId: "other" },
    { stateId: "other" },
    { viewport: { width: 95, height: 80 } },
    { decompositionConfirmationId: "other" },
    { layoutDecisionId: "other" },
  ]) assert.throws(() => resolveV2LayoutSource(SOURCE, options, { ...EXPECTED, ...mismatch }), /冻结身份不一致|冻结目标不一致/);
});

test("布局源拒绝缺失映射、非法 schema、损坏布局节点和 traversal 路径", () => {
  const document = layoutDocument();
  assert.throws(() => resolveV2LayoutSource(SOURCE, { layoutSourceDocuments: new Map() }), /未包含/);
  assert.throws(() => resolveV2LayoutSource(SOURCE, { layoutSourceDocuments: new Map([[SOURCE.nodes_file, { ...document, schema: "other" }]]) }), /schema 必须/);
  assert.throws(() => resolveV2LayoutSource(SOURCE, { layoutSourceDocuments: new Map([[SOURCE.nodes_file, { ...document, root_nodes: [] }]]) }), /root_nodes/);
  assert.throws(() => resolveV2LayoutSource({ nodes_file: "../layout-nodes.json" }, { layoutSourceDocuments: new Map() }), /父目录跳转/);
});

test("forceLayoutSourceFiles 强制读取项目内真实文件并忽略测试注入", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "v2-layout-source-"));
  const file = join(projectRoot, SOURCE.nodes_file);
  mkdirSync(join(projectRoot, "evidence", "v2"), { recursive: true });
  const document = layoutDocument();
  writeFileSync(file, JSON.stringify(document));

  const resolved = resolveV2LayoutSource(SOURCE, {
    projectRoot,
    forceLayoutSourceFiles: true,
    layoutSourceDocuments: new Map([[SOURCE.nodes_file, { schema: "wrong" }]]),
  }, EXPECTED);

  assert.deepEqual(resolved.document, document);
  assert.equal(resolved.file, file);
});
