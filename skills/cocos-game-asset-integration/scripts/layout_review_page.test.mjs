import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { encodePngRgba } from "./effect_image_raster.mjs";
import { readLayoutReviewPayload, renderLayoutReviewPage } from "./layout_review_page.mjs";

/** 计算测试夹具使用的稳定 SHA-256。 */
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 创建最小合法 PNG，保持测试不依赖文件系统或外部服务。 */
function png(width, height, value = 230) {
  const pixels = Buffer.alloc(width * height * 4, value);
  for (let index = 3; index < pixels.length; index += 4) pixels[index] = 255;
  return encodePngRgba(width, height, pixels);
}

/** 创建包含深层父子关系的通用布局审阅输入。 */
function fixture({ longName = false } = {}) {
  const viewport = { width: 120, height: 80 };
  const originalBytes = png(120, 80);
  const annotationBytes = png(4, 4, 180);
  const targetSha = sha256(originalBytes);
  const parent = { x: 10, y: 10, width: 90, height: 60 };
  const child = { x: 22, y: 24, width: 30, height: 20 };
  const nodesDocument = {
    schema: "cocos-layout-nodes/1.0",
    status: "candidate-awaiting-layout-confirmation",
    scene_id: "ExampleScene",
    state_id: "dialog-open",
    viewport,
    target_sha256: targetSha,
    decomposition_confirmation_id: "decomposition-1",
    decomposition_confirmation_sha256: `sha256:${"1".repeat(64)}`,
    proposal_sha256: `sha256:${"2".repeat(64)}`,
    layout_decision_id: "layout-decision-1",
    layout_decision_sha256: "pending",
    layout_nodes: [
      {
        layout_node_id: "container:dialog",
        element_id: "container:dialog",
        display_name: longName ? "这是一个用于验证长中文名称换行的布局节点名称" : null,
        layout_role: "container",
        semantic_grouping: { kind: "component", rationale: "对话框内部功能组件需要共同停靠" },
        ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" },
        parent_layout_node_id: "viewport",
        parent_target_bounds: { x: 0, y: 0, width: 120, height: 80 },
        target_bounds: parent,
        axis_alignment: { horizontal: "center", vertical: "center" },
        offset: { x: -5, y: 0 },
        child_layout_node_ids: ["visual:title"],
        marker_id: "L01",
        parent_marker_id: "R01",
        depth: 1,
        scene_id: "ExampleScene",
        state_id: "dialog-open"
      },
      {
        layout_node_id: "visual:title",
        element_id: "visual:title",
        display_name: null,
        layout_role: "visual-component",
        semantic_grouping: { kind: "part", rationale: "标题文字属于对话框功能组件并保持相对位置" },
        ui_layout: { grouping_basis: ["LAYOUT"], layout_owner: "PARENT", size_policy: "CONTENT", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" },
        parent_layout_node_id: "container:dialog",
        parent_target_bounds: parent,
        target_bounds: child,
        axis_alignment: { horizontal: "left", vertical: "top" },
        offset: { x: 12, y: 14 },
        child_layout_node_ids: [],
        marker_id: "L02",
        parent_marker_id: "L01",
        depth: 2,
        scene_id: "ExampleScene",
        state_id: "dialog-open"
      }
    ],
    root_nodes: [{ layout_node_id: "viewport", parent_layout_node_id: null, target_bounds: { x: 0, y: 0, width: 120, height: 80 }, marker_id: "R01", is_root_container: true }]
  };
  const decisionWithoutSha = { decision_id: "layout-decision-1", scene_id: "ExampleScene", state_id: "dialog-open", target_sha256: targetSha };
  const decisionBytes = Buffer.from(JSON.stringify(decisionWithoutSha));
  nodesDocument.layout_decision_sha256 = sha256(decisionBytes);
  const nodesBytes = Buffer.from(JSON.stringify(nodesDocument));
  const bindings = {
    schema: "cocos-layout-review/1.0",
    status: "candidate-awaiting-layout-confirmation",
    scene_id: "ExampleScene",
    state_id: "dialog-open",
    viewport,
    decomposition_confirmation_id: "decomposition-1",
    decomposition_confirmation_sha256: nodesDocument.decomposition_confirmation_sha256,
    layout_decision_id: nodesDocument.layout_decision_id,
    reference: { file: "reference.png", sha256: targetSha },
    proposal: { file: "proposal.json", sha256: nodesDocument.proposal_sha256 },
    decision: { file: "layout-decision.json", sha256: nodesDocument.layout_decision_sha256 },
    nodes: { file: "layout-nodes.json", sha256: sha256(nodesBytes) },
    annotation: { file: "layout-annotation.png", sha256: sha256(annotationBytes) }
  };
  return { nodesDocument, bindings, originalBytes, annotationBytes, nodesBytes, decisionBytes };
}

test("通用页面内嵌离线产物、保持两栏和同 viewport 映射", () => {
  const value = fixture();
  const html = renderLayoutReviewPage(value);
  const payload = readLayoutReviewPayload(html);
  assert.deepEqual(payload, { nodesDocument: value.nodesDocument, bindings: value.bindings });
  assert.match(html, /grid-template-columns/);
  assert.match(html, /object-fit: contain/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /data:application\/json;base64,/);
  assert.match(html, /当前节点（蓝色实线）/);
  assert.match(html, /父节点（橙色虚线）/);
  assert.match(html, /功能分组/);
  assert.match(html, /对话框内部功能组件需要共同停靠/);
  assert.doesNotMatch(html, /fetch\s*\(/i);
  assert.doesNotMatch(html, /localStorage|sessionStorage/);
});

test("输出确定且动态名称在 JSON script 中安全转义", () => {
  const value = fixture({ longName: true });
  value.nodesDocument.layout_nodes[1].display_name = "__NAME_RULES__ $& $` $' </script><img src=x onerror=alert(1)>\u2028";
  value.nodesDocument.layout_nodes[1].semantic_grouping.rationale = "分组理由 </script><img src=x onerror=alert(1)>";
  value.nodesBytes = Buffer.from(JSON.stringify(value.nodesDocument));
  value.bindings.nodes.sha256 = sha256(value.nodesBytes);
  const first = renderLayoutReviewPage(value);
  const second = renderLayoutReviewPage(value);
  assert.equal(first, second);
  assert.doesNotMatch(first, /<\/script><img/i);
  assert.equal(readLayoutReviewPayload(first).nodesDocument.layout_nodes[1].display_name, "__NAME_RULES__ $& $` $' </script><img src=x onerror=alert(1)>\u2028");
  assert.equal(readLayoutReviewPayload(first).nodesDocument.layout_nodes[1].semantic_grouping.rationale, "分组理由 </script><img src=x onerror=alert(1)>");
  assert.equal((first.match(/id="layout-review-data"/g) || []).length, 1);
  assert.match(first, /overflow-wrap: anywhere/);
});

test("缺父节点、循环关系和越界事实明确失败", () => {
  const missingParent = fixture();
  missingParent.nodesDocument.layout_nodes[1].parent_layout_node_id = "missing-parent";
  missingParent.nodesBytes = Buffer.from(JSON.stringify(missingParent.nodesDocument));
  missingParent.bindings.nodes.sha256 = sha256(missingParent.nodesBytes);
  assert.throws(() => renderLayoutReviewPage(missingParent), /未确认的父(?:节点|容器)/);

  const cycle = fixture();
  cycle.nodesDocument.layout_nodes[1].parent_layout_node_id = "visual:title";
  cycle.nodesDocument.layout_nodes[1].parent_target_bounds = cycle.nodesDocument.layout_nodes[1].target_bounds;
  cycle.nodesBytes = Buffer.from(JSON.stringify(cycle.nodesDocument));
  cycle.bindings.nodes.sha256 = sha256(cycle.nodesBytes);
  assert.throws(() => renderLayoutReviewPage(cycle), /循环/);

  const outside = fixture();
  outside.nodesDocument.layout_nodes[1].target_bounds.x = 110;
  outside.nodesBytes = Buffer.from(JSON.stringify(outside.nodesDocument));
  outside.bindings.nodes.sha256 = sha256(outside.nodesBytes);
  assert.throws(() => renderLayoutReviewPage(outside), /父容器 bounds|viewport/);
});

test("冻结参考图物理尺寸必须与 viewport 精确一致", () => {
  const wrongSize = fixture();
  wrongSize.originalBytes = png(60, 80);
  assert.throws(() => renderLayoutReviewPage(wrongSize), /尺寸必须与 nodesDocument\.viewport 完全一致/);
});

test("数据块读取只接受唯一、合法的 application/json 块", () => {
  const value = fixture();
  const html = renderLayoutReviewPage(value);
  assert.throws(() => readLayoutReviewPayload(html.replace("</body>", '<script type="application/json" id="layout-review-data">{}</script></body>')), /只能包含一个/);
  assert.throws(() => readLayoutReviewPayload(html.replace(/<script type="application\/json" id="layout-review-data">[\s\S]*?<\/script>/, "")), /缺少/);
  const brokenJson = html.replace(/(<script[^>]*id="layout-review-data"[^>]*>)[\s\S]*?(<\/script>)/, "$1{$2");
  assert.throws(() => readLayoutReviewPayload(brokenJson), /JSON/);
  assert.throws(() => readLayoutReviewPayload('<script id="layout-review-data" type="text/plain">{}</script>'), /application\/json/);
});
