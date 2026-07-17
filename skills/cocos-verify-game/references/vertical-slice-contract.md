# 垂直切片验证契约

垂直切片工件固定为 `.cocos-workflow/artifacts/vertical-slice.md`，以 YAML front matter 保存门禁元数据，并用 Markdown 正文说明核心玩法可玩路径与验证证据；由 `cocos-verify-game` 在 `verification_mode: vertical-slice` 时生成。它是 production 的**首个**子门禁（核心玩法原型确认），通过后才允许模块拆分与正式场景循环；不替代最终 `verification.md`，也不替代核心玩法场景的正式版本实现。

```yaml
schema_version: 1
status: pending # pending | blocked | passed | stale
implementation_mode: prototype
implementation_plan_hash: sha256:<approved implementation plan>
requirements_hash: sha256:<approved requirements>
systems_design_hash: sha256:<approved systems design>
technical_design_hash: sha256:<approved technical design>
scene_ids: []
formal_scene_loop_ids: [] # 后续正式版本实现对应的 scene_loop id
core_loop_evidence:
  start: reports/chrome/mobile-standard/slice-start.png
  challenge: reports/chrome/mobile-standard/slice-challenge.png
  resolution: reports/chrome/mobile-standard/slice-resolution.png
profiles: []
playtest_evidence: []
approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash and approval.subject_hash>
```

- 所有冻结 mobile profile 都必须有可重放的核心循环证据；`start`、`challenge`、`resolution` 均须存在于项目内路径。
- 必须同时通过 P0/P1、像素差阈值和人工审阅，才可写入 `status: passed`；批准主题哈希必须等于 `content_hash`。
- 原型可玩确认通过后，总控才可调度 `module_decomposition`、`global_scaffold` 与正式 `scene_loops`；推进到 `formal_scene_loop_ids` 时必须按正式版本实现。
- 需求、系统设计、技术设计、计划、代码或切片资源变化时必须置为 `stale`，总控阻止模块划分与正式场景循环。
