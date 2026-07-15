# Requirements 契约

产物固定为目标项目的 `.cocos-workflow/requirements.md`。文件以 YAML front matter 保存下列元数据，正文使用 Markdown 说明游戏、范围、页面、验收和未决问题。开始前必须读取 `.cocos-workflow/project-profile.yaml`；它的冻结内容哈希写入 `project_profile_hash`，本阶段不得改写该配置。

```markdown
---
schema_version: 1
requirements_version: 1
status: draft # 仅可为 draft、blocked、approved
project_profile_hash: sha256:<已冻结 project-profile 内容哈希>
source_inputs:
  text: <原始文字需求>
  reference_images: [] # 每项含 path、purpose、license_status
game:
  title: <名称>
  genre: <类型>
  audience: <目标人群>
  core_loop: <可验证的循环>
  player_goal: <玩家目标>
  controls: <移动端控制>
scope:
  in: []
  out: []
  assumptions: []
pages: []
acceptance_criteria: []
unresolved_questions: []
approval:
  status: pending
  approved_by: null
  approved_at: null
content_hash: sha256:<front matter 与正文的规范化内容哈希>
---

# <游戏标题>

## 核心循环

## 范围

## 页面与流程

## 验收标准

## 未决问题
```

## 字段规则

- `schema_version` 必须为 `1`；`requirements_version` 是单调递增的需求版本。
- `status` 仅可为 `draft`、`blocked` 或 `approved`。存在缺失、冲突或未决问题时使用 `draft` 或 `blocked`；不得设为 `approved`。
- `project_profile_hash` 必须是当前 `.cocos-workflow/project-profile.yaml` 的 `sha256:` 内容哈希。哈希缺失或不匹配时阻塞。
- `source_inputs.text` 保留原始文字需求；每个 `reference_images` 项都必须含 `path`、`purpose`、`license_status`。授权未知时阻塞审批。
- `game` 必须完整描述 `title`、`genre`、`audience`、`core_loop`、`player_goal`、`controls`。`core_loop` 必须可由验收条件验证。
- `scope.in`、`scope.out` 和 `scope.assumptions` 必须明确，不能用未确认假设填补玩法或范围空缺。
- `pages` 每项至少含稳定的 `id`、`purpose`、`entry`、`exit`、`primary_ui` 和 `player_actions`，用于描述页面目的、进入/退出条件、主要 UI 与玩家动作。
- `acceptance_criteria` 每项至少含稳定 `id`、`priority`、`given`、`when`、`then` 和 `evidence_type`，并能对应范围内的可玩核心循环或页面行为。
- `unresolved_questions` 必须列出所有影响范围、可玩性或版权的问题。只有其为空且范围完整、存在至少一个可玩核心循环后，才可申请审批。
- `approval.status` 在未批准时为 `pending`；仅在显式人工批准后写入 `approved_by`、`approved_at` 并将 `status` 设为 `approved`。不得填造批准信息。
- `content_hash` 是不含自身及 `approval.subject_hash` 的 front matter 与完整 Markdown 正文共同计算的 `sha256:` 哈希。任何元数据或正文变化都必须重新计算，并使旧批准失效。

## 审批前检查

只有以下条件同时满足时，才允许人工批准：冻结配置哈希匹配；输入来源和授权状态完整；游戏与范围字段完整；至少一个可玩核心循环；页面与验收条目符合最小字段；`unresolved_questions` 为空；并且批准人已明确表达同意。否则保留 `draft` 或 `blocked` 并说明解除条件。
