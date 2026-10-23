import assert from "node:assert/strict";
import test from "node:test";
import { creatorResourcePathForFile, isCreatorResourcePath, validateCreatorResourcePlacement } from "./creator-resource-location.mjs";
import { validateAssetResourceLocations } from "./asset-resource-locations.mjs";
import { validateManifest } from "./validate_visual_manifest.mjs";
import { validOrdinaryManifest } from "./visual-manifest-test-fixtures.mjs";

test("普通分类目录和Bundle资源默认不产生resources加载键", () => {
  for (const file of ["assets/textures/icon.png", "assets/animations/hero.png", "assets/bundles/hud/icon.png", "assets/textures/resources/icon.png", "assets-source/resources/icon.png"]) {
    assert.equal(creatorResourcePathForFile(file), undefined);
    assert.deepEqual(validateCreatorResourcePlacement(file, undefined), []);
    assert.deepEqual(validateAssetResourceLocations({ runtime_outputs: [file] }), []);
  }
});

test("resources目录必须有明确动态用途，加载键精确绑定实际文件", () => {
  const file = "assets/resources/animations/hero.png";
  assert.equal(creatorResourcePathForFile(file), "animations/hero");
  assert.equal(creatorResourcePathForFile("C:\\project\\assets\\resources\\animations\\hero.png"), "animations/hero");
  assert.deepEqual(validateCreatorResourcePlacement(file, "animations/hero"), []);
  assert(validateCreatorResourcePlacement(file, undefined).some((message) => message.includes("只有显式动态加载")));
  assert(validateCreatorResourcePlacement(file, "animations/other").some((message) => message.includes("一致")));
  assert(validateCreatorResourcePlacement("assets/animations/hero.png", "animations/hero").some((message) => message.includes("实际文件必须位于")));
  assert(validateCreatorResourcePlacement("assets/animations/../resources/hero.png", undefined).some((message) => message.includes("只有显式动态加载")));
  assert(validateCreatorResourcePlacement("assets/resources/../animations/hero.png", "animations/hero").some((message) => message.includes("实际文件必须位于")));
});

test("动态加载键拒绝绝对路径、扩展名、空值和多重编码逃逸", () => {
  for (const key of [null, "", "../hero", "hero.png", "https://example.com/hero", "C:/hero", "icons\\hero", "%252e%252e/hero", "%2568%2574%2574%2570%2573%253a/hero", "a/%252fhero", "a/%20hero"]) {
    assert.equal(isCreatorResourcePath(key), false, String(key));
  }
  assert.equal(isCreatorResourcePath("animations/hero"), true);
});

test("普通资产必须显式声明resources.load或loadDir才能进入resources", () => {
  const asset = { runtime_outputs: ["assets/resources/ui/icon.png", "assets/prefabs/button.prefab"] };
  assert(validateAssetResourceLocations(asset).length > 0);
  for (const method of ["resources.load", "resources.loadDir"]) {
    assert.deepEqual(validateAssetResourceLocations({ ...asset, resource_loading: { method } }), []);
  }
  for (const resource_loading of [null, "dynamic", {}, { method: "assetManager.loadBundle" }, { method: "resources.load", extra: true }]) {
    assert(validateAssetResourceLocations({ ...asset, resource_loading }).some((message) => message.includes("resource_loading")));
  }
  assert(validateAssetResourceLocations({ runtime_outputs: ["assets/textures/icon.png"], resource_loading: { method: "resources.load" } }).some((message) => message.includes("未绑定")));
});

test("帧图集的显式resources加载键只授权对应输出，不授权整批资源", () => {
  const file = "assets/resources/animations/hero.png";
  const asset = { runtime_outputs: [file], frame_animation: { spritesheet: { file, creator_resource_path: "animations/hero" } } };
  assert.deepEqual(validateAssetResourceLocations(asset), []);
  asset.runtime_outputs.push("assets/resources/ui/unrelated.png");
  assert(validateAssetResourceLocations(asset).some((message) => message.includes("只有显式动态加载")));
  asset.runtime_outputs.pop();
  asset.frame_animation.spritesheet.creator_resource_path = "animations/other";
  assert(validateAssetResourceLocations(asset).some((message) => message.includes("一致")));
});

test("通用清单入口拒绝默认resources输出，声明动态用途后可以通过", () => {
  const manifest = validOrdinaryManifest();
  assert.deepEqual(validateManifest(manifest), []);
  manifest.assets[0].runtime_outputs = ["assets/resources/hero.png"];
  assert(validateManifest(manifest).some((message) => message.includes("只有显式动态加载")));
  manifest.assets[0].resource_loading = { method: "resources.load" };
  assert.deepEqual(validateManifest(manifest), []);
});

test("生产前声明的正式输出路径也不能绕过resources动态用途检查", () => {
  for (const planned of [
    { output_file: "assets/resources/icon.png" },
    { output: { file: "assets/resources/icon.png" } },
    { output: { path: "assets/resources/icon.png" } },
    { output_metadata: { file: "assets/resources/icon.png" } },
    { runtime_output_file: "assets/resources/icon.png" },
    { runtime_file: "assets/resources/icon.png" },
    { runtimeOutputs: ["assets/resources/icon.png"] },
    { expected_assets: [{ runtime_file: "assets/resources/icon.png" }] },
    { production_contract: { expected_assets: [{ runtimeFile: "assets/resources/icon.png" }] } },
  ]) {
    assert(validateAssetResourceLocations(planned).some((message) => message.includes("只有显式动态加载")));
    assert.deepEqual(validateAssetResourceLocations({ ...planned, resource_loading: { method: "resources.load" } }), []);
  }
  assert.deepEqual(validateAssetResourceLocations({ source_file: "assets/resources/existing.png" }), []);
});

test("生产路径规范化不改变动态图集真实加载键的大小写", () => {
  const file = "assets/resources/Animations/Hero.png";
  const sheet = { file, creator_resource_path: "Animations/Hero" };
  const asset = { runtime_outputs: [file], expected_assets: [{ runtime_file: file }], frame_animation: { spritesheet: sheet } };
  assert.deepEqual(validateAssetResourceLocations(asset), []);
  assert.deepEqual(validateAssetResourceLocations({ expected_assets: [{ runtime_file: file }], frame_animation: { spritesheet: sheet } }), []);
  assert(validateAssetResourceLocations({ ...asset, frame_animation: { spritesheet: { ...sheet, creator_resource_path: "animations/hero" } } }).some((message) => message.includes("一致")));
});
