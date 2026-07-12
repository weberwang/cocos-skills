# cocos-define-game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创建 `cocos-define-game`，将已初始化的 Cocos Web Mobile 项目的文字需求与参考图转化为可审批、可追溯的 `.cocos-workflow/requirements.yaml`。

**Architecture:** Skill 本体只规定需求分析、澄清、产物和人工门禁，不写 Cocos Editor 或 `workflow.yaml`。详细 YAML 契约放在单独参考文件；测试验证 Skill 的边界、必填产物和阻塞/审批规则，并用独立子代理对一份模糊移动游戏需求进行前向验证。

**Tech Stack:** Markdown、YAML 契约、Skill Creator 校验脚本、Python `unittest`。

## Global Constraints

- 必须以 `cocos-orchestrate-web-workflow` 的任务契约和状态机为背景；只有总控能修改 `workflow.yaml`。
- 仅允许写入 `.cocos-workflow/requirements.yaml` 及分配任务的结果/报告路径；禁止 Cocos MCP 写操作、场景/资源/脚本写入。
- 屏幕方向、设计分辨率与适配策略必须读取已冻结的 `project-profile.yaml`，不得在需求 Skill 中覆盖。
- 需求未明确、范围冲突或人工批准缺失时必须阻塞并列出解除问题，不得猜测或标记为已批准。
- 只有显式人工批准后才可令 `requirements.yaml.status: approved` 并写入批准者、时间和 `sha256:` 内容哈希。
- 新增函数、类或不直观逻辑使用简体中文注释；单文件不超过 1000 行；不引入第三方依赖。
- 本任务的 Git 提交与推送须在全部待办完成后按用户选择执行。

---

## 文件结构

- 新建 `skills/cocos-define-game/SKILL.md`：阶段执行规则、写入边界、阻塞与审批流程。
- 新建 `skills/cocos-define-game/agents/openai.yaml`：Skill 列表元数据。
- 新建 `skills/cocos-define-game/references/requirements-contract.md`：`requirements.yaml` 的字段、校验和验收规则。
- 新建 `tests/define_game/test_skill_contract.py`：静态契约测试。
- 新建 `tests/scenarios/define-game/ambiguous-mobile-brief.md`：前向验证输入。

### Task 1: 建立失败测试与需求场景

**Files:**
- Create: `tests/define_game/test_skill_contract.py`
- Create: `tests/scenarios/define-game/ambiguous-mobile-brief.md`

**Interfaces:**
- Consumes: 后续任务提供的 `skills/cocos-define-game/SKILL.md` 与 `references/requirements-contract.md`。
- Produces: `test_skill_has_required_boundaries()`、`test_contract_defines_approved_requirements()`、`test_ambiguous_brief_requires_questions()`。

- [ ] **Step 1: 写入失败测试**

测试读取 Skill 和契约文件，并要求下列不可缺少的字面契约：

```python
assert "cocos-orchestrate-web-workflow" in skill
assert ".cocos-workflow/requirements.yaml" in skill
assert "workflow.yaml" in skill and "禁止" in skill
assert "Cocos MCP" in skill and "禁止" in skill
assert "人工批准" in skill

for field in (
    "schema_version", "requirements_version", "status", "project_profile_hash",
    "source_inputs", "game", "scope", "pages", "acceptance_criteria",
    "unresolved_questions", "approval", "content_hash",
):
    assert field in contract
```

场景需求必须故意遗漏玩法胜负条件、受众和核心页面；测试断言场景包含 `未决问题` 与 `不得假设`，保证前向验证能观察到阻塞行为。

- [ ] **Step 2: 运行测试，确认失败**

Run: `rtk python -m unittest discover -s tests/define_game -p "test_*.py" -v`

Expected: FAIL，提示 `skills/cocos-define-game/SKILL.md` 不存在。

### Task 2: 创建需求定义 Skill 与契约

**Files:**
- Create: `skills/cocos-define-game/SKILL.md`
- Create: `skills/cocos-define-game/agents/openai.yaml`
- Create: `skills/cocos-define-game/references/requirements-contract.md`
- Modify: `tests/define_game/test_skill_contract.py`

**Interfaces:**
- Consumes: `.cocos-workflow/project-profile.yaml`、需求文本、参考图路径、总控分配任务。
- Produces: `.cocos-workflow/requirements.yaml` 和符合总控结果契约的交接信息；不改变 `workflow.yaml`。

- [ ] **Step 1: 用 Skill Creator 初始化目录**

运行 Skill Creator 的初始化脚本，目标为仓库 `skills/`，并生成以下界面字段：

```text
display_name=Cocos 定义游戏
short_description=把移动游戏需求整理为可审批范围与验收条件
default_prompt=根据已初始化 Cocos 项目和需求输入，创建待审批的 requirements.yaml。
```

删除初始化模板中的占位文本；只保留 `SKILL.md`、`agents/openai.yaml` 与 `references/`。

- [ ] **Step 2: 编写 requirements 契约**

在 `requirements-contract.md` 定义产物位置和以下 YAML 字段及规则：

```yaml
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
content_hash: sha256:<不含 content_hash 自身的规范化内容哈希>
```

规定 `pages` 至少提供 `id`、目的、入口、退出、主要 UI 和玩家动作；每条 `acceptance_criteria` 至少提供稳定 `id`、优先级、`given`、`when`、`then` 和 `evidence_type`。要求空 `unresolved_questions`、完整范围、至少一个可玩核心循环和显式人工批准，才可将状态设为 `approved`。

- [ ] **Step 3: 编写 Skill 的阶段流程与边界**

Skill 必须按顺序要求：读取总控三份公共参考和 `project-profile.yaml`；提取输入与参考图来源；先列范围、核心循环、页面流、移动端操作和验收条件；对影响范围/可玩性/版权的缺失信息生成问题；写入 `draft` 或 `blocked`；等待人工批准；批准后计算哈希并交给总控验收。明确禁止修改 `workflow.yaml`、调用任何 Cocos MCP 写操作、初始化/改写方向与分辨率、或在问题未解决时虚构功能。

- [ ] **Step 4: 补全静态测试并运行**

补充断言，确保契约中的状态集合、页面字段、验收字段、批准与哈希规则均存在，且 Skill 要求读取 `project-profile.yaml` 并明确不写 `workflow.yaml`。

Run: `rtk python -m unittest discover -s tests/define_game -p "test_*.py" -v`

Expected: PASS。

### Task 3: 结构校验与独立前向验证

**Files:**
- Modify: `tests/define_game/test_skill_contract.py`
- Modify: `tests/scenarios/define-game/ambiguous-mobile-brief.md`

**Interfaces:**
- Consumes: 完整 Skill、契约和模糊需求场景。
- Produces: 可复现的结构校验与前向验证结论。

- [ ] **Step 1: 运行 Skill 结构校验**

Run: `rtk python C:\Users\forjs\.codex\skills\.system\skill-creator\scripts\quick_validate.py skills\cocos-define-game`

Expected: `Skill is valid!`。

- [ ] **Step 2: 执行无 Skill 基线**

让独立子代理只读取 `tests/scenarios/define-game/ambiguous-mobile-brief.md`，要求其产出可交付的需求 YAML。记录其是否会自行补全缺失玩法/受众/页面信息；不得向该代理透露 Skill 规则或预期结论。

- [ ] **Step 3: 执行有 Skill 前向验证**

让新的独立子代理使用 `$cocos-define-game` 和同一场景。验收其输出：不擅自批准、显式列出缺失问题、没有 Cocos 写入建议、产物字段覆盖契约、并把状态保持为 `blocked` 或 `draft`。将原始输出与简短判定记录到 `tests/results/define-game/`，不伪造代理结论。

- [ ] **Step 4: 运行完整回归**

Run: `rtk python -m unittest discover -s tests -p "test_*.py" -v`

Expected: PASS，既有总控 37 项和新增需求 Skill 测试均通过。

## 计划自检

- 规格覆盖：需求范围、玩法、页面和验收条件（Task 2）；方向冻结读取与禁止覆盖（Task 2）；人工门禁和阻塞（Task 2、3）；总控单写者与 MCP 禁止（Task 2）；无 Skill 基线和有 Skill 前向验证（Task 3）。
- 占位符检查：无待填充实现步骤；示例字段、命令和验收条件均已明确。
- 接口一致性：Task 1 所测的 Skill 与契约文件均在 Task 2 创建，Task 3 使用同一文件和场景执行验证。
