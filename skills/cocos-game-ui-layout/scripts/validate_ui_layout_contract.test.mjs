import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildLayoutNodesDocument } from "../../cocos-game-asset-integration/scripts/layout_review_bundle.mjs";
import { deriveAutomaticLayoutFacts } from "../../cocos-game-asset-integration/scripts/layout_annotation_contract.mjs";
import { checkContractFiles, main, validateContract } from "./validate_ui_layout_contract.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const UI_TEMPLATE = JSON.parse(await readFile(resolve(HERE, "../assets/ui-layout-contract-template.yaml"), "utf8"));
const ORDINARY_TEMPLATE = JSON.parse(await readFile(resolve(HERE, "../assets/ordinary-ui-layout-contract-template.yaml"), "utf8"));
const POLICY_TEMPLATE = JSON.parse(await readFile(resolve(HERE, "../assets/project-ui-layout-policy-template.yaml"), "utf8"));
const REFERENCE_PATHS = {
  policy: "config/project-ui-layout-policy.json",
  scene: "evidence/v2/scene-reconstruction-contract.json",
  nodes: "evidence/v2/layout-nodes.json",
};
const VIEWPORT = { width: 390, height: 844 };
const TARGET_SHA = `sha256:${"a".repeat(64)}`;

/** 构造符合正式布局节点源结构的文档，供引用链验证使用。 */
function layoutNodesDocument(viewport = VIEWPORT) {
  const nodes = [{
    layout_node_id: "button-base",
    element_id: "button-base",
    parent_layout_node_id: "viewport",
    element_type: "image",
    layout_role: "leaf",
    role: "icon",
    owner_type: "fixed-production-visual",
    render_kind: "sprite",
    sprite_geometry: { type: "SIMPLE", size_mode: "RAW", content_size: null },
    ui_layout: { grouping_basis: ["POSITION"], layout_owner: "SELF", size_policy: "FIXED", overflow_policy: "KEEP_VISIBLE", safe_area_policy: "INSIDE_SAFE_AREA", interaction_policy: "NONE" },
    axis_alignment: { horizontal: "center", vertical: "center" },
    target_bounds: { x: (viewport.width - 120) / 2, y: (viewport.height - 56) / 2, width: 120, height: 56 },
  }];
  const facts = deriveAutomaticLayoutFacts(nodes, viewport, { sceneId: "main-menu", stateId: "default" });
  return buildLayoutNodesDocument(facts, {
    viewport,
    sceneId: "main-menu",
    stateId: "default",
    decompositionConfirmationId: "decomposition-1",
    layoutDecisionId: "layout-decision-1",
    targetSha256: TARGET_SHA,
  });
}

/** 构造引用唯一 layout-nodes 文件的场景合同最小外壳。 */
function sceneContract(viewport = VIEWPORT) {
  return {
    contract_version: "1.0.0",
    effect_image_reconstruction: { applicability: "effect-image" },
    reference_target: { original_file: "evidence/target.png", target_sha256: TARGET_SHA },
    target_conditions: {
      scene_id: "main-menu",
      state_id: "default",
      viewport: structuredClone(viewport),
      target_sha256: TARGET_SHA,
      visual_baseline_version: "1.0.0",
      layout_decomposition_version: "layout-decomposition-1",
    },
    layout_decomposition: {
      layout_source: { nodes_file: REFERENCE_PATHS.nodes },
      layout_annotation: { layout_nodes_file: REFERENCE_PATHS.nodes, decomposition_confirmation_id: "decomposition-1", layout_decision_id: "layout-decision-1" },
      layout_annotation_confirmation: { layout_nodes_file: REFERENCE_PATHS.nodes, decomposition_confirmation_id: "decomposition-1" },
      layout_binding: {
        target_sha256: TARGET_SHA,
        scene_id: "main-menu",
        state_id: "default",
        viewport: structuredClone(viewport),
        visual_baseline_version: "1.0.0",
        layout_contract_version: "1.0.0",
        layout_contract_sha256: TARGET_SHA,
        layout_decomposition_version: "layout-decomposition-1",
      },
    },
  };
}

/** 构造只引用策略和场景合同的 V2 UI 合同及显式结构来源 Map。 */
function referenceFixture(overrides = {}) {
  const contract = { ...structuredClone(UI_TEMPLATE), ...overrides };
  const policy = structuredClone(POLICY_TEMPLATE);
  const scene = sceneContract();
  const sources = new Map([
    [REFERENCE_PATHS.policy, policy],
    [REFERENCE_PATHS.scene, scene],
    [REFERENCE_PATHS.nodes, layoutNodesDocument()],
  ]);
  return { contract, policy, scene, sources };
}

/** 根据错误关键词断言合同被拒绝。 */
function assertFailed(document, expected, options) {
  const result = validateContract(document, options);
  assert.equal(result.status, "failed", JSON.stringify(result));
  assert(result.errors.some((item) => item.includes(expected)), JSON.stringify(result.errors));
}

test("普通 UI 继续使用独立 1.2 合同，不携带 effect-image 语义", () => {
  assert.equal(ORDINARY_TEMPLATE.schema_version, "1.2.0");
  assert.equal(validateContract(ORDINARY_TEMPLATE).status, "passed");
  assert.equal(UI_TEMPLATE.schema_version, "2.0.0");
  assert.deepEqual(Object.keys(UI_TEMPLATE).sort(), ["contract_id", "contract_version", "project_policy_file", "scene_contract_file", "schema_version"].sort());
});

test("旧 frozen-target 或 effect-image 内联合同明确要求迁移到引用式合同", () => {
  for (const marker of [
    { fidelity: { applicability: "frozen-target", status: "specified" } },
    { effect_image_reconstruction: { applicability: "effect-image" } },
  ]) {
    const legacy = { ...structuredClone(ORDINARY_TEMPLATE), ...marker };
    assertFailed(legacy, "旧 frozen-target/effect-image 内联合同已停用");
  }
});

test("V2 根对象拒绝复制分组、父子、定位、fidelity 和运行证据", () => {
  for (const field of ["scope", "fidelity", "regions", "layout_nodes", "critical_alignments", "component_snapshots"]) {
    const { contract, sources } = referenceFixture({ [field]: [] });
    const result = validateContract(contract, { stage: "V2", layoutSourceDocuments: sources });
    assert(result.errors.some((item) => item.includes(`禁止重复布局事实或未定义字段：${field}`)), field);
  }
});

test("V2 引用合同要求显式 Map，并拒绝缺失的策略、场景或唯一布局源", () => {
  const { contract, sources, scene } = referenceFixture();
  assertFailed(contract, "显式提供 Map");
  assertFailed(contract, "未包含 config/project-ui-layout-policy.json", { layoutSourceDocuments: new Map() });

  const withoutNodes = new Map(sources);
  withoutNodes.delete(REFERENCE_PATHS.nodes);
  assertFailed(contract, "未包含 evidence/v2/layout-nodes.json", { stage: "V2", layoutSourceDocuments: withoutNodes });

  const noSceneSource = structuredClone(scene);
  delete noSceneSource.layout_decomposition.layout_source;
  const missingSourceMap = new Map(sources);
  missingSourceMap.set(REFERENCE_PATHS.scene, noSceneSource);
  const result = validateContract(contract, { stage: "V2", layoutSourceDocuments: missingSourceMap });
  assert(result.errors.some((item) => item.includes("layout_source")), JSON.stringify(result.errors));
});

test("V2 指定阶段校验冻结布局，但不提前要求 V4 运行观测", () => {
  const { contract, sources } = referenceFixture();
  const result = validateContract(contract, { stage: "V2", layoutSourceDocuments: sources });
  assert(result.errors.length > 0, "最小场景外壳仍需通过完整场景合同校验");
  assert(!result.errors.some((item) => /component_snapshots|V4.*运行观测|运行快照/.test(item)), JSON.stringify(result.errors));
  assert(!result.errors.some((item) => item.startsWith("project policy")), JSON.stringify(result.errors));
});

test("唯一 layout-nodes 来源仍执行严格居中与 RAW 尺寸约束", () => {
  const { contract, sources } = referenceFixture();
  const nodesFile = sources.get(REFERENCE_PATHS.nodes);
  const offCenter = structuredClone(nodesFile);
  offCenter.layout_nodes[0].target_bounds.x += 1;
  const centerSources = new Map(sources);
  centerSources.set(REFERENCE_PATHS.nodes, offCenter);
  const centerResult = validateContract(contract, { stage: "V2", layoutSourceDocuments: centerSources });
  assert(centerResult.errors.some((item) => item.includes("必须严格居中")), JSON.stringify(centerResult.errors));

  const resizedRaw = structuredClone(nodesFile);
  resizedRaw.layout_nodes[0].ui_layout.size_policy = "FLEX";
  const rawSources = new Map(sources);
  rawSources.set(REFERENCE_PATHS.nodes, resizedRaw);
  const rawResult = validateContract(contract, { stage: "V2", layoutSourceDocuments: rawSources });
  assert(rawResult.errors.some((item) => /RAW.*STRETCH\/FLEX|普通图片必须保持 RAW 原尺寸/.test(item)), JSON.stringify(rawResult.errors));
});

test("V2 场景冻结方向或目标视口超出项目公共策略时失败", () => {
  const wideViewport = { width: 1600, height: 900 };
  const { contract, policy, scene, sources } = referenceFixture();
  scene.target_conditions.viewport = wideViewport;
  scene.layout_decomposition.layout_binding.viewport = wideViewport;
  sources.set(REFERENCE_PATHS.nodes, layoutNodesDocument(wideViewport));
  policy.orientationPolicy.allowed = ["portrait"];
  policy.targets.orientations = ["portrait"];
  delete policy.designResolutionPolicy.landscape;
  policy.targets.max = { width: 1024, height: 1366, orientation: "portrait" };
  policy.representativeViewports = policy.representativeViewports.filter((item) => item.orientation === "portrait");
  policy.representativeViewports.push(
    { id: "portrait-dpr-two", kind: "standard-portrait", width: 390, height: 844, orientation: "portrait", rawDpr: 2, effectiveDpr: 2 },
    { id: "portrait-dpr-cap", kind: "standard-portrait", width: 430, height: 932, orientation: "portrait", rawDpr: 3, effectiveDpr: 2 },
  );
  for (const item of [policy.canvasBackingPolicy, policy.runtimeDprPolicy, policy.safeAreaPolicy, policy.resizePolicy, policy.textResolutionPolicy]) {
    for (const key of ["updatesOn", "refreshOn", "events", "reflowOn"]) if (Array.isArray(item[key])) item[key] = item[key].filter((event) => event !== "orientation-change");
  }
  const result = validateContract(contract, { stage: "V2", layoutSourceDocuments: sources });
  assert(result.errors.some((item) => item.includes("冻结目标方向 landscape 不在 project policy 支持范围内")), JSON.stringify(result.errors));
  assert(!result.errors.some((item) => item.startsWith("project policy: ")), JSON.stringify(result.errors));
});

test("Map 结构校验与 CLI 实盘读取得到相同源事实和诊断", async () => {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "ui-layout-source-")));
  const { contract, policy, scene, sources } = referenceFixture();
  const nodesFile = join(root, REFERENCE_PATHS.nodes);
  await mkdir(dirname(nodesFile), { recursive: true });
  await mkdir(dirname(join(root, REFERENCE_PATHS.policy)), { recursive: true });
  await mkdir(dirname(join(root, REFERENCE_PATHS.scene)), { recursive: true });
  await writeFile(join(root, REFERENCE_PATHS.policy), JSON.stringify(policy));
  await writeFile(join(root, REFERENCE_PATHS.scene), JSON.stringify(scene));
  await writeFile(nodesFile, JSON.stringify(sources.get(REFERENCE_PATHS.nodes)));
  const contractFile = join(root, "ui-layout-contract.json");
  await writeFile(contractFile, JSON.stringify(contract));

  const structural = validateContract(contract, { stage: "V2", projectRoot: root, layoutSourceDocuments: sources });
  let output = "";
  const originalLog = console.log;
  console.log = (value) => { output += `${value}\n`; };
  let exitCode;
  try { exitCode = await main([contractFile, "--project-root", root, "--stage", "V2", "--json"]); }
  finally { console.log = originalLog; }
  const fileResult = JSON.parse(output);
  assert.equal(exitCode, 1, "最小场景外壳应由场景合同校验拒绝");
  assert.deepEqual(fileResult.errors, structural.errors);
});

test("file gate 忽略注入数据并强制读取真实策略、场景和布局源", async () => {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "ui-layout-files-")));
  const { contract, policy, scene, sources } = referenceFixture();
  await mkdir(dirname(join(root, REFERENCE_PATHS.nodes)), { recursive: true });
  await mkdir(dirname(join(root, REFERENCE_PATHS.policy)), { recursive: true });
  await mkdir(dirname(join(root, REFERENCE_PATHS.scene)), { recursive: true });
  await writeFile(join(root, REFERENCE_PATHS.policy), JSON.stringify(policy));
  await writeFile(join(root, REFERENCE_PATHS.scene), JSON.stringify(scene));
  const forgedNodes = { schema: "wrong" };
  await writeFile(join(root, REFERENCE_PATHS.nodes), JSON.stringify(forgedNodes));
  assert((await checkContractFiles(contract, root)).some((item) => item.includes("schema 必须")));
  assert(sources.has(REFERENCE_PATHS.nodes), "测试 Map 中应包含合法的布局源作为对照");
});

test("CLI --check-files 进入场景正式确认文件门", async () => {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "ui-layout-confirmation-gate-")));
  const { contract, policy, scene, sources } = referenceFixture();
  for (const relativePath of [REFERENCE_PATHS.policy, REFERENCE_PATHS.scene, REFERENCE_PATHS.nodes]) await mkdir(dirname(join(root, relativePath)), { recursive: true });
  await writeFile(join(root, REFERENCE_PATHS.policy), JSON.stringify(policy));
  await writeFile(join(root, REFERENCE_PATHS.scene), JSON.stringify(scene));
  await writeFile(join(root, REFERENCE_PATHS.nodes), JSON.stringify(sources.get(REFERENCE_PATHS.nodes)));
  const contractFile = join(root, "ui-layout-contract.json");
  await writeFile(contractFile, JSON.stringify(contract));

  let output = "";
  const originalLog = console.log;
  console.log = (value) => { output += `${value}\n`; };
  try { await main([contractFile, "--project-root", root, "--stage", "V2", "--check-files", "--json"]); }
  finally { console.log = originalLog; }
  const result = JSON.parse(output);
  for (const artifact of ["layout_annotation", "layout_review", "layout_decision", "decision_record", "user_decision_receipt"]) {
    assert(result.errors.some((item) => item.includes(`layout_annotation_confirmation.${artifact}`) && item.includes("文件不存在或路径越界")), `${artifact}: ${JSON.stringify(result.errors)}`);
  }
});

test("V4 check-files 使用官方证据校验器拒绝缺失的组合与节点测量文件", async () => {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "ui-layout-v4-evidence-gate-")));
  const { contract, policy, scene, sources } = referenceFixture();
  scene.combination_preacceptance = {
    status: "passed",
    formal_scene_structure: "MainScene/ContainerGraph",
    layout_calculation_identity: "layout:main:1",
    evidence: "evidence/v4/combined-scene.png",
    layout_geometry: {
      node_measurements: [
        { layout_node_id: "button-base", evidence: ["evidence/v4/button-base-measurement.json"] },
        { layout_node_id: "button-base-file-object", evidence: { file: "evidence/v4/button-base-file-object.json" } },
        { layout_node_id: "button-base-unknown-object", evidence: { description: "evidence/v4/hidden-bypass.json" } },
      ],
      component_snapshots: [],
    },
  };
  for (const relativePath of [REFERENCE_PATHS.policy, REFERENCE_PATHS.scene, REFERENCE_PATHS.nodes]) await mkdir(dirname(join(root, relativePath)), { recursive: true });
  await writeFile(join(root, REFERENCE_PATHS.policy), JSON.stringify(policy));
  await writeFile(join(root, REFERENCE_PATHS.scene), JSON.stringify(scene));
  await writeFile(join(root, REFERENCE_PATHS.nodes), JSON.stringify(sources.get(REFERENCE_PATHS.nodes)));
  const contractFile = join(root, "ui-layout-contract.json");
  await writeFile(contractFile, JSON.stringify(contract));

  let output = "";
  const originalLog = console.log;
  console.log = (value) => { output += `${value}\n`; };
  try { await main([contractFile, "--project-root", root, "--stage", "V4", "--check-files", "--json"]); }
  finally { console.log = originalLog; }
  const result = JSON.parse(output);
  assert(result.errors.some((item) => item.includes("combination_preacceptance.evidence") && item.includes("证据文件不存在")), JSON.stringify(result.errors));
  assert(result.errors.some((item) => item.includes("node_measurements[0].evidence") && item.includes("证据文件不存在")), JSON.stringify(result.errors));
  assert(result.errors.some((item) => item.includes("node_measurements[1].evidence.file") && item.includes("证据文件不存在")), JSON.stringify(result.errors));
  assert(result.errors.some((item) => item.includes("node_measurements[2].evidence") && item.includes("无法解析")), JSON.stringify(result.errors));
});

test("V2 文件引用拒绝路径逃逸和缺失的策略或场景文件", async () => {
  const root = await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "ui-layout-paths-")));
  const { contract } = referenceFixture();
  const escaped = { ...contract, project_policy_file: "../outside.json" };
  assertFailed(escaped, "不得包含父目录跳转", { layoutSourceDocuments: new Map() });
  assert((await checkContractFiles(contract, root)).some((item) => item.includes("project_policy_file 文件不存在")));
});
