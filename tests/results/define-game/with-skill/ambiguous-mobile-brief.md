# agent: /root/define_game_task3_fix/skill_forward_rerun | utc: 2026-07-12T09:54:05Z

```yaml
schema_version: 1
requirements_version: 1
status: blocked
project_profile_hash: null
source_inputs:
  text: |-
    # 模糊移动游戏需求

    请为一个 Cocos Web Mobile 游戏整理可交付的需求文档。游戏暂定名为「云端小岛」，玩家会在漂浮岛屿间移动，并收集发光碎片；视觉希望明亮、轻松，参考图将在后续提供。

    当前没有说明玩家如何获胜或失败、面向哪类受众，也没有列出必须实现的核心页面。

    ## 未决问题

    - 胜负条件和单局结束条件分别是什么？
    - 目标受众及其适用年龄段是什么？
    - 首发版本必须包含哪些核心页面？
  reference_images: []
game:
  title: 云端小岛
  genre: null
  audience: null
  core_loop: null
  player_goal: 在漂浮岛屿间移动并收集发光碎片；收集目标及完成条件尚未定义。
  controls: null
scope:
  in:
    - 玩家在漂浮岛屿间移动。
    - 玩家收集发光碎片。
    - 视觉基调为明亮、轻松。
  out:
    - 未确认的胜负规则、单局结束机制、目标受众、页面及移动端操作方案。
    - 尚未提供的参考图相关视觉实现。
  assumptions: []
pages: []
acceptance_criteria: []
unresolved_questions:
  - 冻结项目配置及其内容哈希尚未提供，无法绑定 project_profile_hash。
  - 游戏类型是什么？
  - 目标受众及其适用年龄段是什么？
  - 玩家如何移动，以及移动端使用何种操作方式？
  - 单局的开始条件、胜利条件、失败条件和结束条件分别是什么？
  - 发光碎片的收集目标、数量及其对单局结果的影响是什么？
  - 首发版本必须包含哪些核心页面，以及各页面的进入、退出和交互行为是什么？
  - 后续参考图的文件路径、用途和授权状态是什么？
approval:
  status: pending
  approved_by: null
  approved_at: null
content_hash: null
```
