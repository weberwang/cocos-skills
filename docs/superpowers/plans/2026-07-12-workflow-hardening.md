# Cocos 工作流闭环加固 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or executing-plans task-by-task.

**Goal:** 使十阶段工作流的工件、人工门禁、失效恢复、手机验证与安装行为可机器验证。

**Architecture:** 扩展总控契约/验证器和失效脚本；同步阶段 Skill 引用；用 Python/Node 回归测试固定安全边界。

**Tech Stack:** Python unittest、Node.js、YAML、Cocos Skills。

## Task 1: 统一工件和强制门禁

**Files:** `workflow-contracts.md`、`validate_workflow.py`、阶段 Skill/契约、`test_validate_workflow.py`

- [ ] 统一视觉方向路径为 `artifacts/visual-direction.yaml`。
- [ ] 定义 requirements、visual-direction、scene-concepts、implementation-plan、game-assets、verification、delivery 的门禁与工件哈希绑定。
- [ ] 校验 evidence/changed_paths/output_paths 为存在的安全相对路径，校验阶段必需工件和批准字段。
- [ ] 增加伪造门禁、缺失证据、路径穿越和路径不存在回归测试。

## Task 2: 失效回退和生产依赖

**Files:** `state-machine.md`、`invalidate_artifacts.py`、`init_workflow.py`、`test_invalidate_artifacts.py`、`test_init_workflow.py`

- [ ] 支持 stale 到最早失效阶段的 canonical rewind，更新 invalidated、任务、结果、门禁。
- [ ] 允许非终态失效；增加回退链和原子更新测试。
- [ ] 初始化前验证方向与自定义分辨率关系。
- [ ] 加入 game-assets 汇合门禁，代码绑定只接受已批准资产。

## Task 3: Capture manifest 与阶段契约同步

**Files:** `cocos-plan-project`、`cocos-verify-game`、`cocos-generate-game-assets`、`cocos-implement-game` 及其 references。

- [ ] 规划契约生成 `artifacts/capture-manifest.yaml`，覆盖冻结 small/standard/large 手机档位。
- [ ] 验证契约强制 Chrome 截图/交互、基线/遮罩/像素差和全 profile 证据。
- [ ] 将资源许可批准与代码/资源生产依赖明确为总控可校验输入。

## Task 4: 原子 npx 安装与回归

**Files:** `scripts/install-skills.mjs`、`tests/install-skills.test.mjs`

- [ ] 复制到同卷临时目录，验证 `SKILL.md` 与无链接内容后原子替换同名目录。
- [ ] 失败时还原原目录，写入安装清单；测试复制失败与恢复。

## Task 5: 全量验证与独立审查

- [ ] `npm test`、`python -m unittest discover -s tests -p "test_*.py" -v`、全部 Skill `quick_validate`。
- [ ] 让独立子代理审查全部 diff 的契约闭环与安全边界。
