# AI 合成栅格效果图拆分

本文件只在 V3 明确选择 `ai-composite-raster` 路线后按需读取。框选拆图是把合成栅格输入转换为独立资源的一种办法，不是 UI、动画、Tilemap、VFX 或全部视觉任务的默认管线。

## 输入

- 当前仍适用的 V1/V2 `AUTO` 或 `USER_DECISION` 记录，以及已通过的关键画面、拆解图确认、全局基线和适用范围。
- V3 schema 1.5 资源清单、ownership-first 覆盖区域、稳定 `annotation_number`、`implementation_plan`（`generate-now`、`reuse-existing`、`runtime-program`）、`production_origin`、来源版本、目标尺寸、透明要求、锚点、九宫格、纹理键和预算。
- 可重现生成记录，或后续可编辑的分层重绘源文件。

## 状态先行与拆解粒度

在任何框选、裁切或生成式位图生产之前，必须先为每个固定视觉 region 写完 `state_analysis`：`phase=before-component-splitting`、`status=complete`，并逐项记录 `default`、`selected`、`active`、`disabled`、`pressed`、`hover`、`victory`、`defeat`、`paused`。实际存在的状态写 `requirement=required`；确实不适用的状态写 `requirement=not-applicable` 和具体 `reason`，不能只写 `default`。分析记录还必须记录 `evidence`、实际目标文件、`analysis_id` 和 `completed_at`，且 `completed_at` 必须严格早于 `component_inventory.created_at`（相等也失败）；文件校验核对实际分析证据和目标内容，摘要缺失或变化不使拆解合同失效。

状态分析完成后再写 `component_inventory`。`component_count` 是唯一原子部件数量，`visible_instance_count` 是全部可见实例数量；`annotation_number` 只是效果图审阅区域编号。相同视觉部件只登记一个 `component_id/atomic_visual_key`，通过多个 `placements` 表达重复出现，不能复制多份组件或资产。举例：② 顶部 6 个按钮必须是 6 个 component、每个状态各一张；⑧ 的 3 个底部表面若视觉完全相同则是 1 个 component+3 个 placements，⑨ 的 3 个动作图标按实际复用关系登记，不得生成横向组图；③、④、⑦ 只有在清单明确单部件且其余状态写明不适用时才保持单图。每个 placement 必须显式 `interaction_required`；交互 placement 必须且只能绑定一个包含 `hotspot_id`、`component_id`、`placement_id` 和合法 `bounds` 的 `interaction_hotspots`，非交互 placement 不得绑定热区。热区不携带 `asset_id`，单独登记且永远不计入视觉资产数量。

默认 `component_inventory.delivery_mode=individual`，共享一张横向组图会被拒绝。生成式位图统一要求 `delivery_mode=individual` 且 `atlas_allowed=false`，不能使用图集。只有其他生产方法，才可在显式声明 `delivery_mode=atlas`、`atlas_allowed=true` 后使用图集，并为每个部件×状态填写唯一 `atlas_slice`（图集资产 ID、切片 ID、`atlas_size.width/height`、x/y/width/height）；x/y 必须不小于 0，切片右/下边界不得越过 `atlas_size`，V4 还要与正式 atlas 资产真实尺寸一致。没有切片元数据的组图不具备合同效力。

图片及其局部与文字使用相同的[程序还原资格与位图回退](asset-production-routes.md#程序还原资格与位图回退)：按功能语义、独立状态与可观察视觉边界拆分，程序标签须证明当前 renderer 能完整实现要求保留的视觉事实。无法还原的图形、渐变、纹理、光影或其它效果拆为独立位图区域，不以程序标签省略；不能可靠分离的主体与效果保留为完整原子部件。交互或动态数据仍归程序区域。文字的固定/动态分流按[文字路线判定](../../cocos-game-ui-layout/references/layout-contract.md#文字路线判定)处理。标注图中的“程序绘制或动态逻辑”只说明执行分类，不证明视觉来源已具备程序还原资格。

## 生产

1. 用内容哈希、来源版本和框选编号形成稳定拆分 ID；先查询机器清单避免重复生产。
2. 不直接裁出带背景、相邻对象、光晕或阴影污染的区域。需要时重绘边缘、补全遮挡部分并在深浅底检查透明度。
3. 记录生成工具/模型、提示词或编辑摘要、参数、种子、输入版本、日期和人工编辑步骤；外部素材的来源或版权/许可无法确认时不得进入 `accepted`。
4. 按“ownership/F2 事实与实现分类（region 绑定 `ownership_evidence`）→ 先完成状态分析 → 按唯一原子部件登记 placements → 生成左原图+右说明栏 PNG → 等待 `bitmap-decomposition` 的 `generate-now` 区域一次精确确认 → 完整文件校验 → 生产”的顺序执行。用无新增依赖的确定性栅格脚本生成 PNG：
   `node scripts/generate_effect_image_annotation.mjs docs/visual-assets.json --project-root . --scene-id <scene> --state-id <state> --output evidence/coverage/<scene>-<state>-annotation.png --proposal evidence/coverage/<scene>-<state>-proposal.json`。正式生成必须带 `--proposal <file>.json`；省略该参数直接失败，不生成只有用户图示的成功产物。
   标注图必须同时可见三类用户标签：`generate-now`（新建图片资产）、`reuse-existing`（复用现有图片）和 `runtime-program`（程序绘制或动态逻辑）；后两者不触发位图拆解确认，但不能从标注图中省略。PNG 右侧每个编号只显示用户摘要和上述中文标签，左侧只画区域/原子框与稳定编号，不显示 placement ID、坐标尺寸、组件/实例/状态/资产 ID 或英文结构字段。`--proposal` 输出的是拆解分析技术 JSON，必须完整保存画布尺寸、区域和 component/placement bounds、状态分析、生产合同、atomic requirements 与资源映射；它与 PNG 元数据、实际区域定义及 confirmation 的任务归属共同构成技术审计链；SHA 仅作可选追踪。`reuse-existing` 必须指向不可变 `asset-reuse-snapshot/1.0` 中的 `accepted` 资源、当前 scene/state、视觉基线、许可记录和兼容性证据，并填写精确的 `source_file`（连同对应路径字段）；禁止把当前 `visual-assets.json` 自引为快照，文件检查会解析快照并复核实际来源与业务归属，不比较 SHA。
5. `bitmap-decomposition` 确认必须把 `proposal_id`、实际目标文件、`region_id`、区域定义、提案/决定记录文件、PNG 文件/MIME/版本 和决定 ID 写入对应覆盖区域；决定记录还必须绑定 `decision_source=user-message`、实际用户原文、`thread_id`、`work_item_id`，且决定时间不早于冻结时间和提案 `created_at`。这些实际用户消息/任务身份由编排器写入，验证器只核验完整性与绑定，不宣称能密码学证明来源。
6. 在开始任何裁切、抠图、分层、AI 分割/补全或生产派生位图前，必须运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V3 --check-files --project-root .`；只有结构校验和文件证据均通过才可执行。bitmap-decomposition 确认只接受生成器产出的标准 PNG，必须包含正式 PNG 魔数/MIME/尺寸和实际原图记录；冻结原图必须是完整合法 PNG，且 PNG IHDR 宽高与选定 scene/state 画布一致。标注图逐区域复核编号、分类、中文摘要、bounds、placements、生产方式和实际区域定义；编号对应的“编号 + 中文摘要”及“新生成/复用”必须真实绘制在 PNG 右侧说明栏，并分别绑定 `production_method`、`production_origin`、`delivery_kind`，不能只藏在 iTXt；正式流程不生成或接受 SVG 标注。右栏中文使用随包的 OFL 点阵字库，覆盖 GB2312、ASCII 和中文标点；未知字符必须在生成阶段报错，不得绘制缺字框继续通过。非拆解 USER_DECISION 的普通图片证据仍按普通路径检查。确认前禁止上述生产操作；提案、冻结目标或区域变化会使确认失效并重新请求；确认只授权位图拆解范围，不授权改变玩法、布局或视觉事实。效果图清单根节点还必须绑定 `workItemId`、`candidateVersion`，不得使用旧 snake_case 根字段。
7. 生成式位图输出独立位图；只有其他生产方法在合同允许时才输出图集。核对尺寸、锚点、九宫格、采样和纹理预算，再写入唯一权威 `visual-assets.json`。不得把 `runtime-data` 或 `runtime-rendered` 区域裁成位图。owner_type 是合同与确定性 F2 的机器事实，验证器不从像素臆测；必须先绑定既有 coverage/ownership 证据再生成提案。

## V4 验收

逐项检查文件存在、透明边缘、完整轮廓、目标缩放、Cocos 加载、运行时路径和纹理键；用动态玩法证据确认拆分没有破坏识别、反馈或遮挡。框选图和单图清单发生变化时返回 V3；资源质量失败留在 V4。
