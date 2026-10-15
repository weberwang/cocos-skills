import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const schemaNames = ["evidence-manifest", "implementation-package", "work-item"];
const schemaDocuments = Object.fromEntries(schemaNames.map((name) => [
  name,
  JSON.parse(readFileSync(new URL(`../references/${name}.schema.json`, import.meta.url), "utf8")),
]));
const expectedStrategies = ["background-removal", "direct-alpha", "mask-composition"];
const expectedEdgeProfiles = ["hard-edge", "semi-transparent", "glow", "soft-shadow", "hair", "glass", "mixed"];

test("三份工作流 Schema 共享透明策略和边缘事实合同", () => {
  // 防止 Evidence、Implementation 和 Work Item 对同一透明资产采用不同字段或枚举。
  for (const [name, schema] of Object.entries(schemaDocuments)) {
    const defs = schema.$defs;
    const record = defs.transparentBackgroundProductionRecord;
    assert.ok(record, `${name} 缺少透明生产记录定义`);
    assert.deepEqual(record.properties.transparency_strategy.enum, expectedStrategies);
    assert.deepEqual(defs.transparencyEdgeProfile.enum, expectedEdgeProfiles);
    assert.deepEqual(defs.transparencyRequirements.required, ["strategy", "edge_profile"]);
    assert.deepEqual(defs.transparencyRequirements.properties.strategy.enum, expectedStrategies);
    assert.ok(record.required.includes("edge_evidence"), `${name} 未要求可审计的边缘事实`);
    assert.equal(record.required.includes("raw_source_sha256"), false, `${name} 不应以原始输入摘要作为透明生产验收门`);
    assert.equal(record.required.includes("source_sha256"), false, `${name} 不应以归一化输出摘要作为透明生产验收门`);
    assert.ok(record.required.includes("generator") && record.required.includes("generator_version"), `${name} 未记录实际生成工具身份`);
    assert.ok(!record.required.includes("tool") && !record.required.includes("tool_version"), `${name} 不应要求 generation 顶层重复记录处理工具身份`);
    assert.equal(record.properties.tool, undefined, `${name} generation 不应定义重复工具身份字段`);
    assert.equal(record.properties.tool_version, undefined, `${name} generation 不应定义重复工具版本字段`);
    assert.ok(record.required.includes("parameters") && record.required.includes("postprocess"), `${name} 未记录参数和后处理`);
    assert.ok(record.required.includes("transparency_preview"), `${name} 未绑定透明预览`);
    assert.equal(defs.transparentImageProductionRecord, undefined, `${name} 不应保留旧透明记录类型分支`);
  }
});

test("纯色去背 Schema 仅允许已确认颜色分离的硬边输入", () => {
  // 复杂边缘必须被路由到其他策略，不能靠颜色阈值削掉半透明细节。
  for (const [name, schema] of Object.entries(schemaDocuments)) {
    const route = schema.$defs.transparentBackgroundProductionRecord.allOf.find((branch) => branch.if?.properties?.transparency_strategy?.const === "background-removal");
    assert.ok(route, `${name} 缺少去背景条件分支`);
    assert.deepEqual(route.then.properties.edge_profile, { const: "hard-edge" });
    assert.deepEqual(route.then.properties.color_separation_verified, { const: true });
    assert.deepEqual(route.then.properties.source_background_mode, { const: "opaque" });
    assert.equal(route.then.properties.raw_source_has_alpha, undefined, `${name} 不应把 Alpha 通道事实误当作透明像素事实`);
    assert.equal(schema.$defs.transparentBackgroundProductionRecord.allOf.some((branch) => branch.if?.properties?.source_background_mode?.const === "opaque" && branch.then?.properties?.raw_source_has_alpha?.const === false), false, `${name} 不应由 opaque 模式推断原图没有 Alpha 通道`);
    assert.ok(route.then.required.includes("source_background_color"));
    assert.ok(route.then.required.includes("background_removal_attempts"));
    assert.ok(route.then.not.anyOf.some((item) => item.required.includes("capability")));
    assert.ok(route.then.not.anyOf.some((item) => item.required.includes("mask_record")));
  }
});

test("直接 Alpha 和遮罩路线要求可追溯能力或独立素材身份", () => {
  // 参数声明不能替代工具/版本、边缘能力与实际 PNG 的像素级验证证据。
  for (const [name, schema] of Object.entries(schemaDocuments)) {
    const defs = schema.$defs;
    const direct = defs.transparentBackgroundProductionRecord.allOf.find((branch) => branch.if?.properties?.transparency_strategy?.const === "direct-alpha");
    assert.ok(direct, `${name} 缺少直接 Alpha 路线`);
    assert.ok(direct.then.required.includes("capability"));
    assert.deepEqual(direct.then.properties.source_background_mode, { const: "transparent" });
    assert.deepEqual(direct.then.properties.raw_source_has_alpha, { const: true });
    assert.deepEqual(defs.transparentBackgroundProductionRecord.properties.capability, { $ref: "#/$defs/transparencyGenerationCapability" });
    assert.ok(defs.transparencyGenerationCapability.required.includes("tool") && defs.transparencyGenerationCapability.required.includes("tool_version"));
    assert.deepEqual(defs.transparencyGenerationCapability.properties.supports_true_alpha, { const: true });
    assert.deepEqual(defs.transparencyGenerationCapability.properties.output_format, { const: "png" });
    assert.ok(defs.transparencyGenerationCapability.required.includes("verified_edge_profiles"));
    assert.ok(direct.then.not.anyOf.some((item) => item.required.includes("background_removal_attempts")));

    const mask = defs.transparentBackgroundProductionRecord.allOf.find((branch) => branch.if?.properties?.transparency_strategy?.const === "mask-composition");
    assert.ok(mask, `${name} 缺少遮罩合成路线`);
    assert.ok(mask.then.required.includes("mask_record"));
    assert.deepEqual(Object.keys(defs.transparencyMaskRecord.properties).sort(), [
      "evidence", "mask_file", "mask_sha256", "output_file", "output_sha256", "parameters", "source_file", "source_sha256", "tool", "tool_version",
    ]);
  }
});

test("透明生成预览按候选与归一化 PNG 绑定，并保留 V4 检查项", () => {
  // 机器格式检查只负责身份和 Alpha，V4 仍须完成四项视觉检查。
  for (const [name, schema] of Object.entries(schemaDocuments)) {
    const defs = schema.$defs;
    assert.deepEqual(defs.transparencyPreview.required, ["source_file", "light", "dark", "inspection"]);
    const previewText = JSON.stringify(defs.transparencyPreview);
    assert.ok(previewText.includes("#F2E9DF"), `${name} 浅底颜色缺失`);
    assert.ok(previewText.includes("#16202E"), `${name} 深底颜色缺失`);
    assert.deepEqual(defs.transparencyPreviewInspection.properties.status.enum, ["pending", "passed"]);
    assert.deepEqual(Object.keys(defs.transparencyPreviewInspection.properties.checks.properties).sort(), [
      "background_residue", "color_fringe", "semi_transparency", "subject_integrity",
    ]);
    assert.ok(defs.transparencyPreviewInspection.allOf.some((rule) => rule.if?.properties?.status?.const === "passed" && rule.then?.required?.includes("evidence")));
  }
});

test("生成式透明 Expected Asset 冻结策略，provided 资源不强制生成记录", () => {
  // 冻结生成合同后要求透明路线元数据，既有提供资源继续沿 provided/reuse 接入。
  for (const [name, schema] of Object.entries(schemaDocuments)) {
    const expected = schema.$defs.imageGenerationExpectedAsset;
    const alphaRoute = expected.allOf.find((branch) => branch.if?.required?.includes("alpha"));
    assert.ok(alphaRoute.then.required.includes("transparency_requirements"), `${name} 的 alpha=true 生成合同未冻结策略`);
    assert.equal(alphaRoute.then.properties.generation_record.$ref, "#/$defs/transparentBackgroundProductionRecord");
    const visualExpected = schema.$defs.visualExpectedAsset;
    const providedRule = visualExpected.allOf.find((branch) => branch.if?.properties?.origin?.const === "provided");
    assert.ok(providedRule.then.not.required.includes("generation_record"), `${name} 不应为 provided 素材补造生成记录`);
  }
});
