# 验证产物契约

## 前置输入

- `.cocos-workflow/project-profile.yaml`：`status: frozen`，并包含当前 `content_hash`、`orientation`、`design_resolution` 与全部 `capture_profiles`。
- `.cocos-workflow/artifacts/visual-direction.md`：front matter 中 `status: frozen`、非空 `version` 和 `sha256:` `content_hash`。
- `.cocos-workflow/artifacts/capture-manifest.yaml`：`status: approved`，且 `approval.subject_hash == content_hash`；`review.mode: human`，完整覆盖冻结的 `mobile-small`、`mobile-standard`、`mobile-large` profile、人工操作、预期观察、基线、遮罩与像素差阈值。
- 编排任务的 `baseline_revision`、视觉依赖版本/哈希、集成结果和需求验收项。
- `.cocos-workflow/artifacts/capture-manifest.yaml.review`：`mode` 固定为 `human`，并绑定冻结的初始场景与非空人工审核者。

输入版本或哈希不符时，旧结果写 `status: stale`，未开始的任务写 `status: blocked`，并列出重新验证的解除条件。

## 人工审核证据

每项 manifest check 必须记录：

```yaml
id: human-home-start-standard
profile_id: mobile-standard
viewport: {width: 390, height: 844}
orientation: portrait
execution: {mode: human-editor-preview, initial_scene: assets/scenes/menu.scene, reviewer: <human identity>}
steps:
  - action: human-open-preview
  - action: human-tap
    target: start-button
status: passed # passed | failed | blocked
screenshot: reports/human-review/mobile-standard/home-start.png
console_log: reports/human-review/mobile-standard/home-start-console.json
network_log: reports/human-review/mobile-standard/home-start-network.json
baseline_path: art/runtime-baselines/mobile-standard/home-start.png
mask_path: null
pixel_diff:
  changed_ratio: 0.001
  max_changed_ratio: 0.005
  pixel_threshold: 10
  status: passed
captured_at: <ISO-8601>
reviewer_decision: passed
reviewer_signature: <human explicit confirmation>
```

截图、控制台、网络日志、基线、遮罩声明、像素比较、人工操作记录和签署结论均为 `passed` 的必要证据。必须人工执行 capture manifest 的全部 profile 和必经路径；本 Skill 不得调用 Chrome、Cocos MCP 或任何运行时控制工具。构建产物、本地静态服务和自动化运行记录均不合法。

## 质量结论

```yaml
quality_summary:
  P0: {passed: 0, failed: 0, blocked: 0}
  P1: {passed: 0, failed: 0, blocked: 0, waived: 0}
  P2: {passed: 0, failed: 0, blocked: 0}
  visual_runtime: {color_tokens: pending, restraint_expression: pending, primary_action: pending, state_feedback: pending, text_readability: pending}
issues: []
```

- P0 不可豁免；任一失败停止当前及下游阶段。
- P1 默认阻塞；仅总控可接受含检查 ID、工件哈希和有效人工批准的豁免。
- P2 默认报告；仅按项目门禁升级规则阻塞。
- `visual_runtime` 五项必须依据人工截图和可重放操作记录填写。它验证冻结的色彩角色、克制/发散焦点预算、主操作、状态反馈与文本可读性在真实运行时仍然成立；任何 `failed` 必须以对应 P0/P1/P2 问题记录，不能被像素差通过掩盖。

## 阶段退出工件

最终验证通过时，写入 `.cocos-workflow/artifacts/verification.md`。它汇总人工审核报告，不替代每个 profile 的原始证据。

```yaml
schema_version: 1
status: passed # pending | blocked | passed | stale
stage: verification
project_profile_hash: sha256:<hash>
visual_direction: {version: 1, content_hash: sha256:<hash>}
requirements_hash: sha256:<hash>
implementation_plan_hash: sha256:<hash>
integration_result_hash: sha256:<hash>
capture_manifest_hash: sha256:<hash>
baseline_revision: <build or git revision>
review: {mode: human, initial_scene: assets/scenes/menu.scene, reviewer: <human identity>, review_record: reports/human-review/verification.yaml}
reports: [] # reports/human-review/ 下的实际相对路径
quality_summary: {P0: {passed: 0, failed: 0, blocked: 0}, P1: {passed: 0, failed: 0, blocked: 0, waived: 0}, P2: {passed: 0, failed: 0, blocked: 0}, visual_runtime: {color_tokens: passed, restraint_expression: passed, primary_action: passed, state_feedback: passed, text_readability: passed}}
approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash and approval.subject_hash>
```

- `status: passed` 时，全部必经 profile、路径、P0/P1 和 `visual_runtime` 检查必须由人工审核者明确确认通过；`review.mode` 必须为 `human`，`initial_scene` 必须等于冻结项目配置，审核记录、审核者身份和签署结论必须存在；`requirements_hash`、`implementation_plan_hash`、`integration_result_hash` 必须分别精确绑定当前已批准需求、实施计划与通过的 release 集成结果；`reports` 中每项必须存在。
- 人工批准后，`approval.subject_hash` 必须等于 `content_hash`，由总控记录同哈希的 `verification` 门禁。

报告放在分配的 `reports/` 路径，结果遵循总控 `results/<task_id>.yaml` 契约，并绑定 capture manifest、视觉方向、项目配置和基线的当前哈希。
