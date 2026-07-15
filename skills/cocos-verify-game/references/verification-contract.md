# 验证产物契约

## 前置输入

- `.cocos-workflow/project-profile.yaml`：`status: frozen`，并包含当前 `content_hash`、`orientation`、`design_resolution` 与全部 `capture_profiles`。
- `.cocos-workflow/artifacts/visual-direction.md`：front matter 中 `status: frozen`、非空 `version` 和 `sha256:` `content_hash`。
- `.cocos-workflow/artifacts/capture-manifest.yaml`：`status: approved`，且 `approval.subject_hash == content_hash`；完整覆盖冻结的 `mobile-small`、`mobile-standard`、`mobile-large` profile、基线、遮罩与像素差阈值。
- 编排任务的 `baseline_revision`、视觉依赖版本/哈希、集成结果和需求验收项。

输入版本或哈希不符时，旧结果写 `status: stale`，未开始的任务写 `status: blocked`，并列出重新验证的解除条件。

## Chrome 证据

每项 manifest check 必须记录：

```yaml
id: chrome-home-start-standard
profile_id: mobile-standard
viewport: {width: 390, height: 844}
orientation: portrait
url: http://127.0.0.1:<port>/
steps:
  - action: open
  - action: tap
    target: start-button
status: passed # passed | failed | blocked
screenshot: reports/chrome/mobile-standard/home-start.png
console_log: reports/chrome/mobile-standard/home-start-console.json
network_log: reports/chrome/mobile-standard/home-start-network.json
baseline_path: art/runtime-baselines/mobile-standard/home-start.png
mask_path: null
pixel_diff:
  changed_ratio: 0.001
  max_changed_ratio: 0.005
  pixel_threshold: 10
  status: passed
captured_at: <ISO-8601>
```

截图、控制台、网络日志、基线、遮罩声明和像素比较均为 `passed` 的必要证据。必须执行 capture manifest 的全部 profile 和必经路径，且 Chrome 交互必须使用 `chrome:control-chrome`。

## 质量结论

```yaml
quality_summary:
  P0: {passed: 0, failed: 0, blocked: 0}
  P1: {passed: 0, failed: 0, blocked: 0, waived: 0}
  P2: {passed: 0, failed: 0, blocked: 0}
issues: []
```

- P0 不可豁免；任一失败停止当前及下游阶段。
- P1 默认阻塞；仅总控可接受含检查 ID、工件哈希和有效人工批准的豁免。
- P2 默认报告；仅按项目门禁升级规则阻塞。

报告放在分配的 `reports/` 路径，结果遵循总控 `results/<task_id>.yaml` 契约，并绑定 capture manifest、视觉方向、项目配置和基线的当前哈希。
