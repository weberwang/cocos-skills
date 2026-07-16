# 实施计划契约

计划固定写入 `.cocos-workflow/artifacts/implementation-plan.md`。文件以 YAML front matter 保存可校验计划字段，以 Markdown 正文说明执行顺序与取舍；从 planning 到 production 的每个消费者都必须先验证 `status`、批准记录及全部冻结输入哈希。

```yaml
schema_version: 1
plan_version: 1
status: draft # draft | blocked | approved | stale
project_profile_hash: sha256:<当前 project-profile>
requirements_hash: sha256:<当前 requirements>
systems_design_hash: sha256:<当前已批准 systems design>
technical_design_hash: sha256:<当前已批准 technical design>
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
# production 唯一实现顺序：
# 1) core gameplay prototype（vertical_slice）→ 人工确认
# 2) module_decomposition → global_scaffold
# 3) business_flow_levels 从低到高的正式 scene_loops
# 4) 推进到核心玩法场景时，按正式版本（pencil → visual → assets → code）实现
vertical_slice:
  status: pending # pending | passed | stale
  implementation_mode: prototype # 核心玩法优先以原型可玩确认；正式版走后续 scene_loops
  scene_ids: [] # 覆盖最小 start → challenge → resolution 的核心玩法场景
  formal_scene_loop_ids: [] # 同批场景在业务流等级中的正式 scene_loop id
  task_ids: [] # 原型路径：core-gameplay-code → integration → Chrome → vertical-slice-review
  required_profiles: [mobile-small, mobile-standard, mobile-large]
  approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
module_decomposition:
  status: draft # draft | approved | stale
  depends_on_vertical_slice: true # 必须在核心玩法确认后才可执行
  modules: [] # id、business_flow_level、responsibility、public_interfaces、owned_paths、depends_on、test_boundaries
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
    business_flow_level: 1
    is_core_gameplay: false # true 表示该循环是已确认核心玩法的正式版本实现
    depends_on: [vertical-slice-review, module-decomposition, global-scaffold]
    task_ids: [] # pencil-draft → visual-concept（原画候选、精确 UI、精修与质量门槛）→ asset-preparation → code → integration → verification → review
    exit_checks: [] # 每项含 id、kind、evidence_path
business_flow_levels:
  - level: 1
    name: 进入与基础能力
    module_ids: []
    page_ids: [menu]
    completion_task_ids: [] # 本等级全部完成后才能启动下一等级
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

## 实现顺序（硬约束）

production 必须严格按以下顺序推进，不得并行跨越阶段：

1. **核心玩法原型优先**：先实现 `vertical_slice` 覆盖的最小核心玩法场景，使玩家可完成 `start → challenge → resolution`，并获得人工确认。
2. **确认后才进入模块划分**：`module_decomposition` 与 `global_scaffold` 必须依赖已通过的垂直切片（核心玩法确认）门禁；未确认前禁止模块拆分、全局骨架与正式场景循环。
3. **再按业务流等级逐步推进**：从 `business_flow_levels` 等级 1 起串行推进正式 `scene_loops`。
4. **推进到玩法场景时按正式版本实现**：若 `scene_loop.is_core_gameplay: true`（或其 `scene_id` 属于 `vertical_slice.scene_ids`），必须走完整正式小循环 `pencil-draft → visual-concept → asset-preparation → code → integration → Chrome verification → human-review`，用正式版替换原型，不得直接把原型当作交付物。

## 核心玩法原型门禁（vertical_slice）

`vertical_slice` 是 production 的首个门禁，必须覆盖可从开始到挑战再到解决的最小核心玩法路径，且 `scene_ids`、`formal_scene_loop_ids`、`task_ids` 均非空。`implementation_mode` 固定为 `prototype`。

原型任务路径（轻量、可玩优先）：

- 允许 `kind: core-gameplay-code`、对应 `integration`、Chrome 验证与 `vertical-slice-review`。
- **不要求** Pencil 草图、高保真效果图、已批准模块拆分或全局骨架。
- 可使用占位/最小资源；真实美术与正式交互以后续正式 `scene_loops` 为准。
- 必须覆盖全部冻结 mobile profile 的可重放试玩证据，并获得哈希绑定的人工批准。

规则：

- `approval.subject_hash` 必须绑定 `.cocos-workflow/artifacts/vertical-slice.md` 的 `content_hash`，而不是实施计划自身哈希。
- 未获得 `passed` 垂直切片工件及人工批准前，禁止启动 `module_decomposition`、`global_scaffold`，以及任何正式 `scene_loops`（含草图、效果图、资源准备、正式代码、Cocos 写入或验证）。
- `formal_scene_loop_ids` 必须指向计划中 `is_core_gameplay: true` 的正式循环，且其 `scene_id` 集合等于 `scene_ids`。
- 垂直切片失败、过期或上游哈希变化时，状态为 `stale`，模块划分与正式循环维持 `blocked`；`review_mode` 不得豁免此规则。

## 模块拆分任务

`module_decomposition` 是 `implementation-plan.md` 的必需内容，但**仅在核心玩法确认之后**执行。每个模块必须声明 `id`、责任、公开接口、拥有路径、依赖和测试边界。`dependency_graph` 只能指向已声明模块，禁止循环依赖。

- 模块拆分任务的 `depends_on` 必须包含垂直切片审阅任务（`kind: vertical-slice-review`）。
- 每个正式 `kind: code` 任务必须在 `depends_on` 中引用已批准的模块拆分任务，并声明非空 `module_ids`。
- `kind: core-gameplay-code` 原型任务不得依赖、也不得冒充已批准的模块拆分结果。
- 未批准的模块拆分结果不得进入正式实现阶段。

## 业务流等级与实现顺序

`business_flow_levels` 是核心玩法确认**之后**唯一的模块和页面正式实现顺序。等级必须从 `1` 连续递增；同一等级内可按不重叠路径并行，等级之间必须严格串行。每级必须声明非空 `name`、`module_ids`、`page_ids` 与 `completion_task_ids`：模块和页面各只能归属一个等级，`completion_task_ids` 必须是本级任务，用作下一等级的完成门禁。

每个 `module_decomposition.modules` 项、正式 `scene_loops` 项与正式计划任务都必须声明 `business_flow_level`。场景循环的 `scene_id` 必须出现在同等级的 `page_ids`，正式代码任务的 `module_ids` 只能引用同等级或更低等级模块。等级大于 `1` 的每个任务都必须直接依赖前一等级的全部 `completion_task_ids`；任务不得依赖更高等级任务。只有前一等级的所有完成门禁通过，才可派发下一等级的模块、页面、资源、代码、集成或验证任务。

原型阶段任务（`vertical_slice.task_ids`）不参与 `business_flow_levels` 串行门禁，但必须在任何等级任务之前全部完成。

## 全局骨架代码

`global_scaffold` 是唯一的 `kind: global_scaffold` 前置任务，必须在核心玩法确认与 `module_decomposition` 通过后、所有正式 `scene_loops` 前完成。它只拥有共享启动路径，并提供应用入口、场景路由、全局状态/事件、配置、资源服务、错误边界与可测试接口。`global_scaffold_task_id` 必须被每个正式场景循环引用；其 `acceptance_checks` 未通过时，禁止正式场景代码、集成和 Chrome 验证。

## 正式场景小循环

`scene_loops` 必须覆盖每个可交付 `scene_id`，且全部为正式版本实现。每项包含稳定 `id`、`scene_id`、`business_flow_level`、`is_core_gameplay`、`depends_on`、按 `pencil-draft → visual-concept → asset-preparation → code → 串行 integration → Chrome verification → human-review` 排列的 `task_ids`，以及非空 `exit_checks`。

- 每个正式循环的 `depends_on` 必须包含垂直切片审阅任务、`module_decomposition` 与 `global_scaffold`。
- `is_core_gameplay: true` 的循环对应已确认的核心玩法场景；推进到这些循环时必须按正式版本完整执行，不得跳过 Pencil/高保真/真实资源。
- `pencil-draft` 必须记录人工批准的草图哈希；`visual-concept` 必须依赖该草图，并逐项绑定全局视觉冻结的版本、内容哈希与两张参考效果图。没有这两项通过证据不得启动本场景的资源准备或正式代码任务。
- `visual-concept` 的 `acceptance_checks` 必须覆盖至少三个原画候选及评审、可编辑 UI 源、真实文案清单、至少一轮精修、十项质量评分、全部捕获视口可读性和最终图哈希绑定人工批准。任一质量项低于 4/5 或平均分低于 4.5/5 时循环不得退出。
- 每个 `visual-concept` 任务只能声明一个 `scene_id` 和一个最终图输出路径，并包含 `single-scene-scope` 检查。效果图任务按 `scene_loops` 声明顺序串行：除首个场景外，每个场景的 `visual-concept` 必须直接依赖前一个场景的 `human-review`；不得在同一级并行生成多个页面效果图。
- 只有本循环 exit_checks 的项目内证据全部通过，才可启动下一场景循环；共享模块必须在首个消费者循环前完成。任何两个 scene_loop 不得并发拥有 Cocos MCP 写权。

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
- `tasks` 每项遵守总控任务契约并额外含 `kind`（`core-gameplay-code | module_decomposition | global_scaffold | pencil-draft | visual-concept | code | asset-preparation | integration | vertical-slice-review`）与可选正整数 `business_flow_level`。所有任务必须有唯一 `task_id`、非空 `depends_on`（核心玩法代码与垂直切片审阅的首个任务除外）和 `allowed_paths`。
- 原型任务：`core-gameplay-code` 与其集成/验证任务必须声明 `scene_id` 且属于 `vertical_slice.scene_ids`；不得声明正式 `module_ids` 依赖。
- 正式任务：每个 `pencil-draft`、`visual-concept`、`code` 与 `asset-preparation` 必须声明 `scene_id` 与 `business_flow_level`。`visual-concept` 必须依赖同场景 `pencil-draft`；`code` 与 `asset-preparation` 必须依赖同场景 `visual-concept`，并在 `inputs` 中记录同一 Pencil/高保真批准哈希、全局视觉版本、内容哈希及两张参考效果图。每个正式 `code` 还必须依赖 `module_decomposition` 与 `global_scaffold`。`integration` 必须按 `batch_index` 串行。
- `path_ownership.production_writers` 中每个任务的可写路径不得重叠；`cocos_writer` 必须是非空单个任务 ID，且所有 integration 任务均引用它。
- `integration_batches` 每项含 `batch_index`、`task_ids`、`readback_checks`；批次序号连续，每批结束均要读回验证。

## 批准与哈希

只有无未决问题、核心玩法原型定义完整、业务流等级连续且依赖顺序有效、所有依赖可解析、资源许可完整、路径不冲突、仅一个编辑器写者、正式玩法场景映射完整且人工明确批准时，才允许 `status: approved`。`content_hash` 对除自身外的规范化内容求 SHA-256；任何输入或计划内容变化都使批准失效。
