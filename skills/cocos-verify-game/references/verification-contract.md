# 验证产物契约

## 前置输入

在开始前确认以下文件存在且与任务绑定值完全一致：

- `.cocos-workflow/project-profile.yaml`：`status: frozen`、`content_hash`、`orientation`、`design_resolution` 和 `capture_profiles`。
- `.cocos-workflow/art/visual-direction.yaml`：`status: frozen`、非空 `version`、`sha256:` `content_hash`。
- 编排任务的 `baseline_revision`、视觉依赖版本与哈希、集成结果和需求验收项。

输入版本或哈希不符时写入 `status: stale`（旧结果）或 `status: blocked`（尚未开始），并列出重新验证的解除条件。

## Chrome 证据

每项浏览器检查必须记录：

```yaml
id: chrome-start-standard
profile: standard
viewport: {width: 390, height: 844}
orientation: portrait
url: http://127.0.0.1:<port>/
steps:
  - action: open
  - action: tap
    target: start-button
expected: 首场景加载并进入核心玩法
actual: <观察结果>
status: passed # passed | failed | blocked
screenshot: reports/chrome/chrome-start-standard.png
console_log: reports/chrome/chrome-start-standard-console.json
network_log: reports/chrome/chrome-start-standard-network.json
captured_at: <ISO-8601>
```

截图文件、控制台和网络记录均为证据；任何缺失都不能支撑 `passed`。至少使用标准档位，并覆盖需求指定的必经路径。Chrome 交互必须使用 `chrome:control-chrome`；不得以代码推断、静态文件检查或桌面截图代替。

## 质量结论

```yaml
quality_summary:
  P0: {passed: 0, failed: 0, blocked: 0}
  P1: {passed: 0, failed: 0, blocked: 0, waived: 0}
  P2: {passed: 0, failed: 0, blocked: 0}
issues:
  - id: UI-SAFE-001
    severity: P1
    status: open
    description: <问题描述>
    evidence: [reports/chrome/example.png]
    disposition: fix-required
    unblock_condition: <可验证的解除条件>
```

- P0：不可豁免；任一失败停止当前及下游阶段。
- P1：默认阻断；仅总控接受包含具体检查 ID、工件哈希和有效人工批准的豁免。
- P2：默认报告；项目门禁升级时按升级规则阻断。

## 报告与结果

验证报告放在分配的 `reports/` 路径，包含输入版本/哈希、浏览器环境、视口、步骤、质量汇总、问题和全部相对证据路径。任务结果遵循总控 `results/<task_id>.yaml` 契约；结果中的视觉方向版本/哈希、项目配置哈希和基线必须与输入一致。
