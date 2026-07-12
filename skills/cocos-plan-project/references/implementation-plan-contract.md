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
scene_concepts:
  - scene_id: menu
    content_hash: sha256:<已批准效果图>
approval:
  status: pending # pending | approved
  approved_by: null
  approved_at: null
scenes: []
prefabs: []
scripts: []
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
- `tasks` 每项遵守总控任务契约并额外含 `kind`（`code | asset-preparation | integration`）。`integration` 必须按 `batch_index` 串行。
- `path_ownership.production_writers` 中每个任务的可写路径不得重叠；`cocos_writer` 必须是非空单个任务 ID，且所有 integration 任务均引用它。
- `integration_batches` 每项含 `batch_index`、`task_ids`、`readback_checks`；批次序号连续，每批结束均要读回验证。

## 批准与哈希

只有无未决问题、所有依赖可解析、资源许可完整、路径不冲突、仅一个编辑器写者且人工明确批准时，才允许 `status: approved`。`content_hash` 对除自身外的规范化内容求 SHA-256；任何输入或计划内容变化都使批准失效。
