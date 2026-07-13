# 实施计划契约

计划固定写入 `.cocos-workflow/artifacts/implementation-plan.yaml`。从 planning 到 production 的每个消费者都必须先验证 `status`、批准记录及全部冻结输入哈希。

```yaml
schema_version: 1
plan_version: 1
status: draft # draft | blocked | approved | stale
project_profile_hash: sha256:<当前 project-profile>
requirements_hash: sha256:<当前 requirements>
visual_direction:
  version: 1
  content_hash: sha256:<当前冻结视觉方向>
scene_design_tasks:
  - scene_id: menu
    pencil_draft_task_id: menu-pencil-draft
    visual_concept_task_id: menu-visual-concept
approval:
  status: pending # pending | approved
  approved_by: null
  approved_at: null
scenes: []
prefabs: []
scripts: []
module_decomposition:
  status: draft # draft | approved | stale
  modules: [] # id、responsibility、public_interfaces、owned_paths、depends_on、test_boundaries
dependency_graph: [] # from_module_id、to_module_id、reason；禁止循环依赖
global_scaffold:
  task_id: global-scaffold
  status: pending # pending | passed | stale
  allowed_paths: []
  provides: [app_bootstrap, scene_router, global_state, event_bus, config, resource_service, error_boundary]
  acceptance_checks: []
global_scaffold_task_id: global-scaffold
scene_loops:
  - id: scene-loop-menu
    scene_id: menu
    depends_on: [module-decomposition, global-scaffold]
    task_ids: [] # pencil-draft → visual-concept → asset-preparation → code → integration → verification → review
    exit_checks: [] # 每项含 id、kind、evidence_path
asset_dependencies: []
tasks: []
path_ownership:
  conflict_policy: reject-overlap
  production_writers: []
  cocos_writer: null
integration_batches: []
acceptance_mapping: []
unresolved_questions: []
content_hash: sha256:<规范化内容，不含 content_hash>
```

## 模块拆分任务

`module_decomposition` 是 `implementation-plan.yaml` 的必需工件：每个模块必须声明 `id`、责任、公开接口、拥有路径、依赖和测试边界。`dependency_graph` 只能指向已声明模块，禁止循环依赖。每个 `kind: code` 任务必须在 `depends_on` 中引用已批准的模块拆分任务，并声明非空 `module_ids`；未批准的模块拆分结果不得进入实现阶段。

## 全局骨架代码

`global_scaffold` 是唯一的 `kind: global_scaffold` 前置任务，必须在 `module_decomposition` 通过后、所有 `scene_loops` 前完成。它只拥有共享启动路径，并提供应用入口、场景路由、全局状态/事件、配置、资源服务、错误边界与可测试接口。`global_scaffold_task_id` 必须被每个场景循环引用；其 `acceptance_checks` 未通过时，禁止场景代码、集成和 Chrome 验证。

## 场景小循环

`scene_loops` 必须覆盖每个可交付 `scene_id`。每项包含稳定 `id`、`scene_id`、`depends_on`、按 `pencil-draft → visual-concept → asset-preparation → code → 串行 integration → Chrome verification → human-review` 排列的 `task_ids`，以及非空 `exit_checks`。`pencil-draft` 必须记录人工批准的草图哈希；`visual-concept` 必须依赖该草图，并逐项绑定全局视觉冻结的版本、内容哈希与两张参考效果图。没有这两项通过证据不得启动本场景的资源准备或代码任务。只有本循环 exit_checks 的项目内证据全部通过，才可启动下一场景循环；共享模块必须在首个消费者循环前完成。任何两个 scene_loop 不得并发拥有 Cocos MCP 写权。

## Capture manifest

规划阶段必须同时生成 `.cocos-workflow/artifacts/capture-manifest.yaml`。它固定 Chrome 验证的目标、基线和像素差阈值，不能由验证阶段临时删减：

```yaml
schema_version: 1
status: draft # draft | approved | stale
project_profile_hash: sha256:<当前 project-profile>
visual_direction: {version: 1, content_hash: sha256:<冻结视觉方向>}
baseline_revision: <build 或 git revision>
profiles:
  - profile_id: mobile-small
    viewport: {width: 375, height: 667}
    orientation: portrait
    checks:
      - id: home-start
        url: http://127.0.0.1:<port>/
        steps: [{action: open}, {action: tap, target: start-button}]
        screenshot_path: reports/chrome/mobile-small/home-start.png
        baseline_path: art/runtime-baselines/mobile-small/home-start.png
        mask_path: null
        pixel_diff: {max_changed_ratio: 0.005, pixel_threshold: 10}
approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<规范化内容，不含 content_hash>
```

- `profiles` 必须与 `project-profile.capture_profiles` 一一对应，且 `profile_id`、视口和方向完全相同；必须覆盖 `mobile-small`、`mobile-standard`、`mobile-large`。
- 每个必经场景和核心交互都必须在每个 profile 具有一个 check；每项均声明截图、基线、遮罩（可为 `null`）与像素差阈值。
- `status: approved` 时，`approval.subject_hash` 必须等于 `content_hash`。配置、需求、场景、视觉方向或基线修订变化时必须置为 `stale` 并重新审批。

## 必填结构

- `scenes` 每项含 `id`、`path`、`purpose`、`entry`、`exit`、`node_ids`、`prefab_ids`、`script_ids`、`asset_ids`、`acceptance_ids`。
- `prefabs` 每项含 `id`、`path`、`purpose`、`node_tree`、`component_bindings`、`asset_ids`、`acceptance_ids`。
- `scripts` 每项含 `id`、`path`、`class_name`、`responsibility`、`exports`、`depends_on`、`test_path`、`acceptance_ids`。脚本不包含编辑器写入步骤。
- `asset_dependencies` 每项含 `id`、`source_path`、`target_path`、`asset_type`、`license_status`、`consumers`、`depends_on`。未知许可证阻塞。
- `tasks` 每项遵守总控任务契约并额外含 `kind`（`module_decomposition | global_scaffold | pencil-draft | visual-concept | code | asset-preparation | integration`）。所有任务必须有唯一 `task_id`、非空 `depends_on`（模块拆分任务除外）和 `allowed_paths`。
- 每个 `pencil-draft`、`visual-concept`、`code` 与 `asset-preparation` 任务必须声明 `scene_id`。`visual-concept` 必须依赖同场景 `pencil-draft`，其通过结果必须包含 `scene_concept_artifact`；`code` 与 `asset-preparation` 必须依赖同场景 `visual-concept`，并在 `inputs` 中记录同一 Pencil/高保真批准哈希、全局视觉版本、内容哈希及两张参考效果图。每个 `code` 还必须依赖 `module_decomposition` 与 `global_scaffold`。`integration` 必须按 `batch_index` 串行。
- `path_ownership.production_writers` 中每个任务的可写路径不得重叠；`cocos_writer` 必须是非空单个任务 ID，且所有 integration 任务均引用它。
- `integration_batches` 每项含 `batch_index`、`task_ids`、`readback_checks`；批次序号连续，每批结束均要读回验证。

## 批准与哈希

只有无未决问题、所有依赖可解析、资源许可完整、路径不冲突、仅一个编辑器写者且人工明确批准时，才允许 `status: approved`。`content_hash` 对除自身外的规范化内容求 SHA-256；任何输入或计划内容变化都使批准失效。
