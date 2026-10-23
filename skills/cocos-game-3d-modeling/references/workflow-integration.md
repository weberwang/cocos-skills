# 工作流与 Cocos 资源接入

3D 模型接入沿用 `$cocos-game-workflow-control` 的现有 Work Item、Implementation Package、风险门与 V0-V4；本技能不新增状态、审批阶段或单独的资产状态机。可以提议、审查，并在当前任务、A 等级和允许路径范围内生产/接入；结论、实际修改和证据回到控制面。范围变化按现有 Change Request 与 `repair`/`revalidate`/`return` 规则处理。

## V0-V4 对齐

| 阶段 | 3D 模型工作 |
| --- | --- |
| V0 | 确认这是运行时 3D 模型还是仅用于烘焙背景的 3D 源；定位当前 Work Item、资产用途、许可、基线和负责人。 |
| V1 | 冻结模型用途、轮廓/结构、观看距离、玩法体积、单位/Pivot、预算、材质槽、UV、LOD/碰撞、实际目标项目与输出路径。 |
| V2 | 适用 V2 时仅确定建模规格、路线与必要的隔离 blockout；正式模型生产留在 V3，不增加额外阶段或确认。 |
| V3 | 通过 Blender 完成正式形体、拓扑/法线/UV、适用的 LOD/碰撞及导出，再完成源模型与导出文件的技术检查、Creator 资源级导入/身份核验、来源/许可/预算/技术报告，并满足当前 V3 验收要求。AssetDB 身份核验本身不证明几何技术通过或正式场景已消费；几何结论由独立 Blender 专项报告提供。 |
| V4 | 在正式 Creator 场景或当前 Work Item 指定的真实运行上下文中，证明模型资源实际加载并被消费；验证遮挡、碰撞/玩法边界、LOD 和显示组合等适用事实。截图由用户人工检查。 |

阶段不适用项按当前控制面和验收合同处理，不因一个模型资源另造推进门。`effect-image` 仅表示参考图被指定为正式画面目标，不决定区域生产路线；逐区按既有生产合同执行，可能使用原生实现或复用已有资源。只有冻结 `image_generation_required=true` 的区域禁止被 3D 替代。只有当该 Work Item 明确只需烘焙的装饰性满幅背景时，最终运行输出走现有 `decorative-full-bleed` 路线；Blender 工程是背景的可编辑源，不是场景运行时网格。世界空间玩法模型和环境登记为 `gameplay-environment`。

`effect-image` 的 `production_method`/`delivery_kind` 区域合同没有可供本技能直接声明的 3D 模型交付类型。若 Work Item 将参考图冻结为正式场景目标，仍执行既有区域合同；不得把模型伪装成位图/原生绘制资产，也不得取消或改写 effect-image。当前 Schema 和 Creator 工具若无法如实记录模型消费及验收事实，保持受影响门未验证或 `pending/blocked`，说明需要增加能表达并核验 3D 资源的能力；按现有范围变更规则处理后再继续。

## visual-assets 通用登记

按当前 [`cocos-game-asset-integration`](../../cocos-game-asset-integration/SKILL.md) 和其资源路线/校验器维护已有 `visual-assets` 清单。运行时 3D 模型使用现有 `gameplay-environment` route，不新增 route、Schema 或 3D 专用机器校验。条目使用唯一 `id` 与 `texture_key`、`route` 和 `status`，并且只能声明一个 `scene_id` 或 `shared: true`。状态为 `producing`、`review` 或 `accepted` 时，`visual_baseline_id`/`visual_baseline_version` 必须与清单根基线一致。状态为 `accepted` 时还必须提供 `source_file`/`source_files` 或真实 `generation_record`、非空 `runtime_outputs`、`license_record`、`cocos_evidence`、`gameplay_visual_evidence` 和非空路径列表 `consistency_evidence`。未完成资源保持实际的非 accepted 状态；不得伪填来源、许可、输出或验收证据。

`texture_key` 是现有清单要求的通用唯一登记键，可使用 `model.<asset-id>`；它不表示资源必须带贴图。不得为满足图片路线字段伪造 SpriteFrame、TextureImporter、图片宽高或 Alpha 数据，也不得将 `.blend` 源误写成运行时消费文件。若真实模型带贴图，应按项目已有真实图像资源各自登记其实际信息。

当前清单校验只能证明通用登记结构、路径和要求的来源/许可/运行证据字段存在；它不验证网格、拓扑、法线、UV、LOD、碰撞或导入后的模型质量。独立 Blender/Creator 技术报告应记录真实几何预算、拓扑/法线/UV、LOD/碰撞、导出回读、Creator 中实际导入器/资源类型、UUID/子资源（仅当工具实际提供）及资源加载事实，并以真实报告路径填入 `cocos_evidence`。`gameplay_visual_evidence` 保存实际玩法视觉证据与用户检查结果；不要将机器清单校验描述成模型几何通过。

## Creator MCP 操作约束

对 Creator、AssetDB、Scene、Node、Component、Prefab、资源 UUID 或构建的任何操作，先读取[Creator MCP 协议](../../cocos-game-workflow-control/references/cocos-mcp-protocol.md)并发现当前 `tools/list` 实时 Schema。协议文档中的工具名只作定位，调用参数和实际能力以本次发现为准。

- 核对项目身份和唯一活动写者；确认 AssetDB 就绪后按目标目录导入已批准的运行时模型，集中刷新并逐文件读取真实结果。
- 逐项回读资源类型/导入状态和 UUID。只有当当前导入格式实际暴露子资源时才核验相应子资源；不能假定模型必有特定子资源标识。刷新或 `.meta` 出现不等于导入成功、内容已加载或场景已消费。
- 如果当前工作项需要 Prefab/Scene 接入，使用实时 MCP 能力进行最小修改，写后读回节点、组件、属性和资产引用。同一 Creator 项目的编辑器写入保持单写者；不得并行改同一项目状态。
- V4 必须有目标运行上下文实际加载并消费模型的证据。Creator MCP 若只支持打开面板、不能提供运行预览或加载读回，相关结论保持 `pending/blocked`，不可用文件存在、AssetDB UUID 或构建面板替代运行证据。

显示截图与转台、线框、UV、LOD、碰撞等检查图附上给用户的检查要点，由用户人工检查。除非用户明确要求自动验证，不自动分析图像或代替用户判定视觉通过；未经明确要求不启动真机验收。破坏性操作以及外部写入/发布等操作仍按 Work Item 的真实副作用和现有 A4-A6 规则处理，不因技能文本或工具可用而自动获准。
