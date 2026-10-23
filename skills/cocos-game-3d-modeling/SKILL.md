---
name: cocos-game-3d-modeling
description: 使用 Blender MCP 为 Cocos Creator 游戏制作可追溯的正式 3D 模型，覆盖结构、拓扑、法线、UV、LOD、碰撞代理和版本化导出，并按现有 V0-V4 工作项完成资源导入与运行接入证据。适用于运行时模型和玩法环境；不负责 PBR 贴图生产、绑定动画实现或最终 QA 放行。
---

# Cocos 游戏 3D 建模

把已确定的视觉与玩法规格制作成可编辑、可复查并能由目标 Cocos Creator 项目实际导入的 3D 模型。正式模型在 Blender MCP 中生产，Creator 用于资源导入核验和既有 Work Item 要求的场景接入。开始前按需阅读[Blender MCP 建模流程](references/mcp-modeling-workflow.md)、[模型交接](references/model-handoff.md)和[工作流接入](references/workflow-integration.md)。

控制面边界：可提议、可审查、可在当前用户任务的 Work Item 范围内修改，且必须回到 `$cocos-game-workflow-control` 风险门。Implementation Package、风险等级和允许路径仍约束实际生产/接入；任务内范围、方案或资源变化同步回控制面。V0-V4 是既有阶段，不在本技能中新增生命周期或审批阶段。

## 输入与边界

- 输入应明确模型用途、目标视角与观看距离、视觉基线、玩法交互体积、单位与坐标约定、Pivot、拓扑/面数预算、材质槽、LOD、碰撞、实际可用导入格式、许可、源与输出路径及目标 Creator 项目。
- 缺少关键规格、可用 Blender MCP、明确的 `.blend` 来源/写入范围、唯一 Creator 项目或当前工作项授权时，可提供带假设的只读规格建议；受影响写入保持 `BLOCKED`。没有可用 Blender MCP 时阻断正式建模，不能用体块拼搭或其他工具冒充正式交付。
- Blockout 可用于比例、轮廓和玩法空间检查，但不能作为正式模型交付。若目标本身是简单几何形状，按该设计完成必要结构与技术检查即可，不为增加复杂度堆砌无关细节。
- 本技能拥有几何、拓扑、法线、UV、材质槽结构、LOD、碰撞代理和静态模型导出。它不生产 PBR 贴图，不实现骨架/权重/动作，不代替 Cocos 玩法场景装配或独立 QA；接口约定见[模型交接](references/model-handoff.md)。
- 只按目标项目当前 Creator、Importer 和 MCP 能力选择导入格式。不得假定某种格式、导入器、网格子资源或自动转换能力必然可用。

## 执行底线

1. 用 Blender MCP 的实时工具能力检查并制作模型，保存版本化 `.blend` 源、可复现操作记录和正式导出；导出后回读模型，核对实际对象、网格、UV、材质槽、变换与预算。
2. 正式网格按规格完成轮廓和结构、拓扑清理、法线/切线策略、UV 检查，以及适用的 LOD 与碰撞代理。基础体仅能作起始网格、过程 blockout 或碰撞代理；不以贴图、光照、高面数或渲染掩盖未完成的几何。
3. 源资产只读；在授权路径内创建版本化派生文件。按实际授权处理覆盖、删除、重建 UV、改变顶点顺序或绑定数据等破坏性修改。Blender 脚本遵循当前工作项授权和 DCC 脚本限制；已授权的精确脚本范围可复用，不为每个本地脚本重复增加确认。
4. Creator 的 AssetDB、资源 UUID、子资源、Scene、Node、Component、Prefab 和构建操作严格遵循[Creator MCP 协议](../cocos-game-workflow-control/references/cocos-mcp-protocol.md)，每次读取实时 `tools/list` Schema。禁止手写 `.scene`、`.prefab`、`.meta` 或伪造 UUID/子资源绑定；同一项目编辑器状态保持单写者，保存后读回。
5. 截图只提供给用户人工检查并附检查要点；未经用户明确要求，不自动分析截图或判断视觉通过。技术证据、玩法视觉证据和用户显示确认分别记录。

## 交付

交付版本化 `.blend`、运行时模型文件、拓扑/法线/实际 UV 位置报告、材质槽与 LOD/碰撞指标、导出回读记录、来源与许可、Creator 资源导入及实际加载证据，以及模型交接资料。只有真实模型满足当前工作项验收条件并补齐相应阶段证据，才可报告就绪。
