# UI 布局证据矩阵

所有快照、运行轨迹和关系测试必须绑定同一候选 ID、合同版本、视口配置、语言、状态、随机种子和稳定帧。缺证据时报告“未验证”，不以用户确认或旧候选替代。

布局审阅页属于 V2 可读展示产物：必须与冻结参考图、拆解 proposal、布局决策、节点 JSON 和标准布局 PNG 关联同批实际文件；它帮助人工检查关系，但不替代 PNG、F2 机器验收或 V4 运行证据。产物目录、坐标映射、审阅页身份和确认字段详见[离线布局审阅产物](layout-review-artifacts.md)。

默认 `visual_validation.mode=usability` 使用代表性视口和关键状态的实际证据，核对关键内容可见、可读、可交互。只有 `exact` 才强制完整 parity case、目标/候选精确测量、预定义容差和全视口/全状态矩阵。已提供的案例保留目标 SHA、当前候选 SHA、scene/state、实际 DPR、视觉基线与证据身份，不能用旧结果冒充当前结果；仅重验受影响部分。

## 默认高分屏运行矩阵

`representativeViewports` 按 `orientationPolicy.allowed` 决定方向类别：支持竖屏时至少包含窄/标准竖屏，支持横屏时至少包含横屏/桌面宽屏；单方向项目不得把另一方向列为必测项，但仍要覆盖该方向下窄/宽尺寸。矩阵继续覆盖有效 DPR 1、1.25 或 1.5、2，以及 raw DPR 大于 2 且 effective DPR 封顶为 2 的样本。视口标签和宽高实测方向/尺寸必须一致。每个正式 Scene 和独立 `DISPLAY_LAYER` 都必须独立完成该矩阵，不能借用其他单元的样本。`requiredRuntimeEvidence` 必须记录真实测量而非命令行声明：`viewportRect`、`canvasRect`、`designTransform`（方向、设计尺寸、适配轴、比例、可见逻辑区域和偏移）、`logicalSize`、`backingSize`、`cssDisplaySize`、raw/effective DPR、`logicalToCssScale`、`cssToPhysicalScale`、Camera viewport/zoom/origin、safe area、edge gaps、背景覆盖、关键 UI 边界、输入命中、截图和候选/合同/基线身份。

同一页面必须执行连续 resize、DPR 降至 1、DPR 不变时再次 resize，并证明 CSS 尺寸与 backing 尺寸同步更新且页面未 reload。缺少真实运行测量时标记 `unverified`；源码存在 DPR 计算、Canvas 存在、Canvas 未溢出、构建/类型/单测通过、单张截图或 AI 审查都不能单独驱动 V4 PASS。

独立 `DISPLAY_LAYER` 必须另有打开→交互→resize→关闭→宿主恢复轨迹，记录宿主 scene/state；它继承宿主 CSS 逻辑视口和有效 DPR，使用同一 Camera/输入合同或声明独立 Camera。宿主场景通过不等于显示层通过，显示层证据不得混入宿主证据冒充验收。

effect-image 的 parity case 不能退化为 `structured-layout-and-independent-review`：默认 `usability` 必须提供代表性 viewport reference/candidate、关键 coverage region 的关系事实、可读性和交互证据；`exact` 或明确精确需求时才提供完整 viewport、side-by-side、overlay/diff 及全部 coverage region 的 target/candidate fact、delta、tolerance、result、evidence。关键证据缺失、明显越界/裁切/遮挡或交互失效使 V4/F2 失败；小幅位置和尺寸差异在 `usability` 下不单独阻断。

`specified` 只冻结目标测量与测试合同，不要求尚未产生的运行证据；`verified` 才要求运行测量、实际证据以及非空且全部通过的 parity cases。普通布局为 `not-applicable`，不创建伪造冻结目标。

## 最小轴

默认 `usability` 的最小轴由项目选择代表性覆盖：基准与窄/宽视口、项目支持双方向时的方向变化、关键字号/文案、零/非零安全区、关键动作状态和宿主生命周期；单方向项目在同一方向验证窄宽尺寸与连续 resize。每项都检查边界、遮挡、可读性、可操作性和关系不变量。

`exact` 或项目明确的全覆盖需求才必须声明并执行完整轴：`breakpoint-neighbors`、`width`、`height`、`text-scale`、`localization`、`safe-area`、`action-state`、`dpr`、`dynamic-values`、`scene-lifecycle`、`overlay-keyboard-scroll`，包括每个断点三点、完整宽高/字号/文案/安全区/状态和组合。项目同时支持竖屏与横屏时，另必须包含 `orientation` 轴，并覆盖 `orientationPolicy.allowed` 中的方向；单方向项目无需声明该轴，也不能扩展到不支持方向。

## 证据类型

- 自动化：纯布局计算和关系不变量测试，断言中心、间距、边界、唯一滚动轴、遮挡和断点结构；默认允许合同声明的合理偏差。
- QA 运行：操作轨迹证明可达、滚动、键盘和触控；记录设备/视口、运行时实际有效 DPR（设备值动态封顶 2）、语言、状态和稳定帧。
- 视觉：记录 ROI、容差、断点前后结构、相对中心、底部距离、层级与遮挡。Golden 只在 `exact` 或明确精确需求下于冻结目标视口验证精确视觉。

组合过大时可按等价类削减，但必须写出削减依据、未覆盖组合和风险。布局计算与 Cocos Node/UITransform 测试不得把绝对屏幕坐标当作所有视口的验收标准。
