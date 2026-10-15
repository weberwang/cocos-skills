import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const schemaFiles = [
  "skills/cocos-game-workflow-control/references/evidence-manifest.schema.json",
  "skills/cocos-game-workflow-control/references/implementation-package.schema.json",
  "skills/cocos-game-workflow-control/references/work-item.schema.json",
];

const schemas = schemaFiles.map((file) => JSON.parse(fs.readFileSync(file, "utf8")));

// 三种合同都必须引用同一视觉路线和冻结渲染参数，避免生产、实施、验收各自漂移。
test("三份合同的视觉路线和原生渲染定义保持一致", () => {
  const route = schemas[0].$defs.sceneVisualRouteAnalysis;
  const renderContract = schemas[0].$defs.nativeRenderContract;
  const runtimeEvidence = schemas[0].$defs.nativeRuntimeEvidence;

  assert.deepEqual(schemas[1].$defs.sceneVisualRouteAnalysis, route);
  assert.deepEqual(schemas[2].$defs.sceneVisualRouteAnalysis, route);
  assert.deepEqual(schemas[1].$defs.nativeRenderContract, renderContract);
  assert.deepEqual(schemas[2].$defs.nativeRenderContract, renderContract);
  assert.deepEqual(schemas[1].$defs.nativeRuntimeEvidence, runtimeEvidence);
  assert.deepEqual(schemas[2].$defs.nativeRuntimeEvidence, runtimeEvidence);
});

// 检查原生路线可冻结静态基础几何参数，同时让复杂特色外观保留等价证据和容差门。
test("原生路线参数完整且不能绕过特色外观门", () => {
  const route = schemas[0].$defs.sceneVisualRouteAnalysis;
  const render = schemas[0].$defs.nativeRenderContract;
  const requiredFields = [
    "renderer",
    "dimensions",
    "colors",
    "line_width",
    "corner_radius",
    "gradient",
    "opacity",
    "applicable_states",
    "unsupported_features",
  ];

  assert.deepEqual(render.required, requiredFields);
  assert.equal(render.properties.renderer.minLength, 1);
  assert.equal(render.properties.dimensions.properties.width.exclusiveMinimum, 0);
  assert.equal(render.properties.dimensions.properties.height.exclusiveMinimum, 0);
  assert.equal(render.properties.colors.minItems, 1);
  assert.equal(render.properties.colors.items.pattern, "^#[0-9A-Fa-f]{6}$");
  assert.equal(render.properties.line_width.minimum, 0);
  assert.equal(render.properties.corner_radius.minimum, 0);
  assert.equal(render.properties.opacity.minimum, 0);
  assert.equal(render.properties.opacity.maximum, 1);
  assert.equal(render.properties.applicable_states.minItems, 1);
  assert.equal(render.properties.unsupported_features.maxItems, 0);

  const gradient = render.properties.gradient;
  assert.deepEqual(gradient.properties.type.enum, ["none", "linear"]);
  assert.equal(gradient.properties.angle.minimum, 0);
  assert.equal(gradient.properties.angle.maximum, 360);
  assert.equal(gradient.properties.stops.items.properties.offset.minimum, 0);
  assert.equal(gradient.properties.stops.items.properties.offset.maximum, 1);
  assert.equal(gradient.properties.stops.items.properties.color.pattern, "^#[0-9A-Fa-f]{6}$");
  assert.equal(gradient.allOf[0].then.properties.stops.maxItems, 0);
  assert.equal(gradient.allOf[1].then.properties.stops.minItems, 2);
  assert.equal(gradient.allOf[1].then.required.includes("angle"), true);

  const nativeRoute = route.allOf.find(
    (condition) => condition.if?.properties?.selected_route?.const === "cocos-native",
  );
  assert.equal(nativeRoute.then.properties.native_suitability.properties.eligible.const, true);
  assert.equal(nativeRoute.then.properties.native_suitability.required.includes("render_contract"), true);
  assert.equal(Object.hasOwn(nativeRoute.then.properties, "dynamic_requirements"), false);

  const distinctiveNativeRoute = route.allOf.find(
    (condition) => condition.if?.properties?.distinctive_visual?.const === true,
  );
  assert.equal(
    distinctiveNativeRoute.then.properties.native_suitability.required.includes("equivalence_evidence"),
    true,
  );
  assert.deepEqual(
    distinctiveNativeRoute.then.properties.native_suitability.anyOf,
    [{ required: ["tolerance_reference"] }, { required: ["approved_exception_id"] }],
  );
});

// 原生运行证据在普通阶段保持可选，生成式图片的冻结替换限制则继续由原合同约束。
test("运行消费证据可选且生成图片冻结合同仍在", () => {
  for (const schema of schemas) {
    const region = schema.$defs.sceneCoverageRegion;
    assert.equal(region.properties.native_runtime_evidence.$ref, "#/$defs/nativeRuntimeEvidence");
    assert.equal(region.required.includes("native_runtime_evidence"), false);
  }

  const digestFields = ["candidate_sha256", "target_sha256", "evidence_sha256", "baseline_sha256", "diff_fingerprint"];
  for (const schema of schemas) {
    const runtimeEvidence = schema.$defs.nativeRuntimeEvidence;
    assert.deepEqual(runtimeEvidence.required, ["observed_method", "observed_delivery_kind", "render_contract", "status", "evidence"]);
    for (const field of digestFields) {
      assert.equal(runtimeEvidence.required.includes(field), false);
      assert.deepEqual(runtimeEvidence.properties[field], { description: "仅作为可选摘要记录，不参与验收或放行。" });
    }
  }
  const runtimeEvidence = schemas[0].$defs.nativeRuntimeEvidence;
  assert.equal(runtimeEvidence.properties.status.const, "passed");
  assert.equal(runtimeEvidence.properties.evidence.type, "string");
  assert.equal(runtimeEvidence.properties.evidence.minLength, 1);

  for (const schema of [schemas[0], schemas[2]]) {
    const imageGenerationGate = schema.$defs.sceneCoverageRegion.allOf.find(
      (condition) => condition.if?.anyOf?.some((branch) => branch.properties?.image_generation_required?.const === true),
    );
    assert.equal(imageGenerationGate.then.required.includes("scene_asset_usage"), true);
    assert.deepEqual(imageGenerationGate.then.properties.expected_assets.items, {
      $ref: "#/$defs/imageGenerationExpectedAsset",
    });
  }

  const implementationPackage = schemas[1];
  const runtimeImplementation = implementationPackage.$defs.runtimeImplementation;
  assert.equal(runtimeImplementation.properties.render_contract.$ref, "#/$defs/nativeRenderContract");
  assert.equal(runtimeImplementation.required.includes("render_contract"), false);

  const pending = [implementationPackage];
  let frozenSubstitutionPolicyFound = false;
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== "object") continue;
    if (
      value.properties?.image_generation_required?.const === true &&
      value.properties?.substitution_policy?.const === "user-change-request-only"
    ) {
      frozenSubstitutionPolicyFound = true;
    }
    pending.push(...Object.values(value));
  }
  assert.equal(frozenSubstitutionPolicyFound, true);
});
