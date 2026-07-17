# 游戏系统设计契约

工件固定为 `.cocos-workflow/artifacts/systems-design.md`，以 YAML front matter 保存结构化字段，并用 Markdown 正文说明设计支柱、系统边界和验收映射。

```yaml
schema_version: 1
systems_design_version: 1
status: draft # draft | blocked | approved | stale
project_profile_hash: sha256:<frozen project profile>
requirements_hash: sha256:<approved requirements>
design_pillars:
  - id: readable-risk
    statement: <玩家体验承诺>
    decision_test: <可证伪的设计取舍问题>
systems:
  - id: core-input
    name: <系统名称>
    tier: mvp # mvp | alpha | full-vision
    purpose: <系统目的>
    player_input: []
    state_changes: []
    feedback: []
    failure_and_recovery: []
    depends_on: []
    acceptance_ids: []
out_of_scope: []
unresolved_questions: []
approval: {status: pending, approved_by: null, approved_at: null, subject_hash: null}
content_hash: sha256:<normalized content excluding content_hash and approval.subject_hash>
```

- `design_pillars` 必须有 3 至 5 项，`id` 唯一，且 `statement` 与 `decision_test` 均非空。
- `systems` 至少包含覆盖 `requirements.game.core_loop` 全部步骤的一个 `mvp` 系统；`mvp` 系统的 `id` 唯一、依赖只能指向已声明系统、禁止循环依赖，并且 `acceptance_ids` 不得为空。
- `unresolved_questions` 非空、存在循环依赖或缺少核心循环映射时不得批准。
- `status: approved` 时，人工批准主题哈希必须等于 `content_hash`。任一输入哈希变化均使工件 `stale`。
