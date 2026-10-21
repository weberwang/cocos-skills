# 资产生产路线

`effect-image` 的 AI 合成栅格路线必须遵循[Effect-image 生成式位图忠实还原提示词合同](effect-image-prompt-contract.md)；本文件只负责路线选择、交付形态与阶段分工。资源文件的格式、Alpha、技术尺寸和切片合同仍按资源路线校验；显示层运行态默认使用 `visual_validation.mode=usability`，位置、尺寸、边距和换行允许合理偏差，只有明确 `exact` 需求才启用严格像素/全视口矩阵。

V3 为每个资源选择一条主路线，并在机器清单记录场景或 shared 归属、源文件、运行时输出、接入对象/图层、关键验收、预算，以及当前冻结全局视觉基线的 ID、版本和适用锚点；风格指纹仅作可选追踪。所有路线执行 [全局视觉控制约束](global-visual-control.md)。正式资源必须继承当前有效基线并保留可编辑源文件；纯生成资产必须保留足以重现和审计的生成记录。局部资源不得自行创造新材质、光源、描边、角色比例或图标语法。

| 路线 | 可编辑源文件 | 运行时输出 | 关键验收 | 预算 |
| --- | --- | --- | --- | --- |
| UI/图标与字体 `ui-icon-font` | Figma/SVG/矢量源、字体工程、九宫格源图 | SVG 或 PNG/WebP、字体子集、九宫格与布局配置 | 像素密度、透明边缘、图标语法、字体授权、文本安全区、停靠关系 | 纹理尺寸、九宫格数量、Draw Call |
| 像素美术 `pixel-art` | Aseprite/PSD 分层源、调色板 | PNG/WebP、图集与帧数据 | 整数缩放、最近邻采样、调色板、帧边界、像素抖动 | 图集、帧数、纹理内存、采样模式 |
| 通用逐帧动画 [`frame-animation`](../../cocos-frame-animation/SKILL.md) | 内部动作时间轴和尺寸/区域计划；真实视频或固定画布首尾/关键帧、双图补帧来源清单 | 独立 PNG 图集、JSON 报告、网页预览与 Cocos 合同 | V2 完成设计并说明目标感受，用户明确确认当前方案后才制作真实候选；V3 实际视频人工验收后抽帧，图片确认真实父图后制作依赖帧，最终序列人工验收；V4 接入 Cocos | 区域像素预算、FPS、帧数、生成调用数、图集尺寸、纹理内存 |
| 骨骼动画 `skeletal-animation` | Spine/DragonBones 等工程与依赖贴图 | 骨骼数据、atlas、纹理 | 骨骼层级、蒙皮、混合、事件、运行时版本与许可 | 骨骼/插槽数、贴图、采样、CPU/GPU 成本 |
| 场景/Tilemap `scene-tilemap` | Tiled/LDtk 工程、tileset 源图 | 地图 JSON、tileset、碰撞/对象层数据 | 接缝、碰撞语义、对象层、坐标系、分块加载 | 图块/图集、地图数据、可见层、Draw Call |
| VFX/粒子/Shader `vfx-particle-shader` | 粒子配置、shader 源码、噪声/遮罩源图 | 配置、GLSL、纹理 | 动态时序、混合模式、降级、遮挡、色觉差异、设备兼容 | 粒子峰值、过绘、纹理、Draw Call、GPU 时间 |
| 装饰满幅背景 `decorative-full-bleed` | 分层绘图/3D 工程或可重现生成记录 | PNG/WebP/AVIF 与 `cover-v1` 适配配置 | 屏幕空间、无交互、统一等比 cover、焦点安全区、裁切/延展、方向资源切换 | 最大纹理、内存、解码峰值 |
| 世界/玩法环境 `gameplay-environment` | 分层场景、Tilemap、tileset、模块化关卡源 | 独立地块/对象、地图、碰撞及层级数据 | 玩法空间、遮挡、碰撞、导航、交互、动态可读性 | 可见纹理、对象数、过绘、Draw Call、流式加载 |
| AI 合成栅格拆分 `ai-composite-raster` | 分层重绘文件，或固定全局提示前缀、资产段、状态段、负向段、实际生成器/版本、参数、种子、参考输入与后处理记录 | 独立透明位图及清单（生成式位图按 `individual` 交付；其他路线图集须另有显式切片合同） | 基线绑定、锚点、框选编号、边缘补绘、透明度、尺度、可复现性、跨资源一致性与授权 | 生成批次、输出数量、纹理内存、图集 |

通用帧动画按[分类入口](../../cocos-frame-animation/SKILL.md#分类入口)选择用途，默认视频抽帧，图片递归补帧须用户明确选择或确认切换。V2 内部分析行为、阶段、事件、衔接、时长、尺寸与 FPS，方案完成后先按[设计理念说明](../../cocos-frame-animation/references/intent-driven-design.md#方案完成后阐述设计理念)阐述目标感受与动作依据，等待用户明确确认当前动作方案后，才在已有授权内写提示词、制作真实候选和推进具体实现；关键玩法事实有决定性歧义时只询问受影响部分。分辨率、条数与预算选择见[区域规划](../../cocos-frame-animation/references/region-planning.md)，图片默认 768p，确需 2K 时在已有工具与预算授权内直接选择，新增费用或超出授权才询问。V3 人工验收实际最终抽帧视频后才抽帧；图片逐张确认首尾、关键帧及递归父图后继续，最终真实序列人工验收。来源、时间映射、修图成果和 schema 分派见[接入合同](../../cocos-frame-animation/references/workflow-integration.md)。上游静态图片 individual 禁图集合同不会自动变为帧动画合同，路线切换仍须明确决定；预览确认也不构成付费、外部写入或真机授权。

## 路线选择规则

### effect-image 全元素视觉路线

`effect-image` 的忠实还原以冻结参考中的可观察视觉事实为准，由 Cocos 装配、布局、交互和状态行为；它不把普通游戏 UI 一律图片化，也不改变非效果图工作流的默认路线。每个 `scene_reconstruction_contract.coverage_regions[]` 必须填写唯一的 `visual_route_analysis`，在 V1/V2/V3+ 逐阶段回对元素类别、观察到的材质/轮廓/光影/装饰特征、是否具有明显美术特征、动态要求、原生适用性证据、复用适用性证据、最终 owner、`implementation_plan.mode`、生产方式和交付类型。路线结论必须能从冻结图中的可观察事实和 Cocos 实际支持的绘制能力复核；“按钮”“面板”等语义名称，以及单独的静态/动态标记，均不能决定路线。

视觉来源与场景装配是两个独立决策。每个 coverage region 只能根据冻结参考图的可观察事实选择 `image-asset` 或 `cocos-native`，再用独立的 `assembly_analysis` 证明正式 Scene 采用原子装配且没有整屏捕获。文本交给 `text_decomposition` 判断运行时字体或固定字图。纯色矩形、基础几何、规则边框、可确定性表达的简单规则渐变、遮罩和进度填充，在 Cocos 原生 API 能精确表达冻结外观时可选 `cocos-native`，无论它们是静态还是动态；特色插画、复杂纹饰、不规则轮廓、复杂材质及明显具有美术特征的装饰继续使用独立图片路线。不得仅凭元素名称或静态/动态标记选择路线。`uses_full_screen_capture=false` 不得推导 `runtime-program`；原子 Sprite、NineSlice、独立背景块和其他图片部件仍是结构化实现。

`native_suitability` 必须记录实际 Cocos 绘制能力、可审计资格证据和冻结的 `render_contract`：`renderer`、逻辑尺寸 `dimensions.width/height`、`colors`、`line_width`、`corner_radius`、`gradient`、`opacity`、`applicable_states` 与 `unsupported_features`。颜色和渐变 stops 的 `color` 使用 `#RRGGBB`；`gradient.type=none` 时 `stops` 必须为空数组；线性渐变记录 `angle`（0–360）及按顺序排列的 stops。合同冻结参考中观察到的精确值；Cocos 不支持或不能确定性表达的视觉特征列入 `unsupported_features` 并阻断该原生路线，不能用近似替代后通过。特色视觉选择原生路线时仍须提交等价性证据，并绑定预先声明的容差或精确例外。

对应实施单元的 `runtime_implementation.render_contract` 必须逐值镜像已冻结的 `native_suitability.render_contract`，并进入区域确认记录；改参会使已有确认失效。V4 每个原生区域还须提供 `native_runtime_evidence`，记录实际 `observed_method`、`observed_delivery_kind`、镜像冻结参数的 `render_contract`、`status=passed`、指向消费报告 JSON 的 `evidence`；`evidence_sha256`、`candidate_sha256`、`target_sha256`、`baseline_sha256` 和 `diff_fingerprint` 仅作可选追踪。`projectRoot` 可用时必须读取该 JSON 并复核实际内容：报告须声明 `report_schema='native-render-consumption/1.0'`、`consumed=true`，`region_id`、`scene_id`、`state_id` 必须匹配当前区域；`observed_method`、`observed_delivery_kind`、`render_contract`必须与 `native_runtime_evidence` 逐值一致。缺失、不可读、格式错误、任务归属或业务字段不匹配均失败；无关 JSON 文件即使 SHA 已登记也不能证明实际消费。只有规划参数而没有实际渲染与运行消费证据，或实际方法/参数/身份不一致，均不能通过。

视觉外观来源和行为装配分开登记、分别绑定。一个按钮可由原生框体 region、独立图标 image-asset region 和 Creator `Label` 文本 region 构成；每项有各自 owner、生产合同、状态与布局/资源绑定，按钮交互行为再通过明确的组件/节点引用装配。不能把来源不同或承担不同职责的部分合并成 `composite` region 或 `composite_parts`，也不能用模糊的大区域覆盖这些归属。若同一视觉事实仍混合程序行为与独立美术资产，必须回到 V1/PROPOSAL 重新划分 coverage/annotation，分别进入各自生产、运行和验收合同。

全部区域都选择 `cocos-native` 时，场景合同必须提供绑定冻结目标文件、完整 region 集合和独立 JSON 工件 的 `all_native_justification`；文件门会读取实际文件并逐区核对资格事实，不能由同一拆解提案用“均为简单视觉”的自声明自行闭环。

| 来源路线 | 适用范围 | 必须满足的硬门 |
| --- | --- | --- |
| `image-asset` | 特色插画、复杂纹饰、不规则轮廓、复杂材质及其他 Cocos 原生能力不能确定性复现的明显美术特征 | `fixed-production-visual`；适用的 `image-generation`/`authored-raster`/`reuse` 合同及对应交付类型。Sprite、NineSlice、atlas slice 仍属于图片资产路线，因为视觉来源是纹理 |
| `cocos-native` | Cocos 原生能力可精确表达的文本、纯色矩形、基础几何、规则边框、简单规则渐变、遮罩、进度填充，以及运行时布局/交互逻辑、动态数据、粒子/Shader/程序特效；静态基础几何同样可选 | 文本必须委托 `text_decomposition`；非文本填写完整 `native_suitability`、原语和 `render_contract`；按真实用途记录 `runtime-data`/`runtime-rendered`/`runtime-program` 与 `cocos-graphics`/`runtime-program`。资格不由静态/动态声明单独成立。特色视觉仍须用等价性证据绑定预声明容差或精确例外 |
| 混合来源与行为装配 | 一个可交互组件由原生外观、独立图片和程序文本等不同来源构成 | 依照可观察边界拆成独立 coverage region，分别记录 owner、生产合同和布局/资源绑定；行为装配通过明确组件/节点引用接线，禁止单一区域 `composite` 闭环 |

复用不是“看起来相似”或“语义相同”：`reuse` 必须登记精确资产身份或通过既有 `asset-reuse-snapshot/1.0` 的 target/candidate 保真比较，并提供视觉和兼容性证据；缺失时直接回退方案阶段。整屏截图不得作为交互场景来源，必须交付原子部件并由正式 Scene 装配；这里禁止的是整屏捕获交付，不是独立图片资产。

### 功能与场景阶段的共享规划

确定功能、拆分场景和显示层时，就在现有 GDD/场景资源规划中总结共用需求，不必等正式图片生成后才开始。逐项记录资源用途、消费场景/显示层、适用状态、尺寸与变换要求、共同视觉要求、必须保留的差异，以及共享或保持独立的理由。可同时标出可共享的局部部件，例如同一货币图标可共用，而不同主题按钮只共用文字或图标，不因此共用完整按钮皮肤。

已明确多个位置需要同一个视觉部件且规格一致时，可提前确定共享设计，在 V2 的 component/placements 和生产清单中安排一次生产、多处引用；尚未确定外观或使用条件时，只登记为共享候选，不合并不同部件的生产任务，也不声称已有 accepted 资源。功能相同或视觉相似不能单独决定共享。早期规划交给后续场景 V1/V2 逐项核实，正式产物完成后再按下节复核实际适用性；不满足时保留独立资源并更新受影响的规划与证据。

### 正式图片生成后的共享与复用

每批正式图片完成生成、透明处理及尺寸归一化后，基于实际最终文件复核早期共享规划，并检查新发现的共用需求，将结论写回资源清单与适用证据。共享关系同时满足实际产物和消费需求，不在生成前仅凭功能名称或预期相似外观合并不同部件；V2 已确认同一原子部件的多个 placements 仍按既定计划生产一次。

- 逐一核对目标场景、显示层、状态和用途，以及轮廓、材质、光源、色彩、符号语义、装饰密度、逻辑显示尺寸、清晰度、透明边缘、切片/裁切、锚点和允许变换。实际资源能满足各消费位置的功能与视觉要求时才共用；功能相同、视觉相似、同类名称或相同提示词只能提示检查候选，均不能构成复用结论。不得通过强行拉伸、改色、裁切关键内容或弱化场景差异来迁就同一图片。
- 能共用时保留一个权威 `asset_id`、纹理键和正式输出，登记全部消费场景/显示层、状态、region、component/placement、用途、适用尺寸与变换限制，以及判断理由和实际验收证据。用现有 `scene_id`、`shared/shared_scene_ids`、`coverage_region_ids`、placements 和场景使用记录表达归属；理由与限制写入现有分析/证据工件，不另建无实际消费者的通用素材库。
- 同场景多个组件或显示层共用，仍保持该场景归属并分别登记实例；跨场景只有至少两个场景已确认需要使用时才声明 `shared: true` 与 `shared_scene_ids`，运行必需资源沿用既有例外。早期共享资产按实际进度保持 planned/producing/review，不能提前标为 accepted。共用资源不合并功能组件、布局节点、点击热区或状态所有权，消费方只引用同一视觉资源。
- 没有共用需求、无法证明适用或存在主题/状态/尺寸差异时，保留独立资源；尚待人工视觉检查的结果只能登记为待评估候选，不能标为已通过复用。提供正式资源及目标位置的对照与检查点，由用户检查显示效果，不以相似度分数或代理自评替代人工结论。
- 后续生产先查已登记且适用的正式资源，再逐目标核实使用条件；通过后按既有 `reuse-existing` 与不可变 `asset-reuse-snapshot/1.0` 合同绑定 accepted 来源、文件、许可、基线、适用状态及证据。已生成资源保留真实生成记录，不因后来共用而回写成复用来源；已冻结必须独立生成的区域不得因发现共享候选而跳过生成或静默换源，方法变更仍按现有 Change Request 规则处理。登记共享不授权删除独立产物或改写历史确认。

### 其他资产路线约束

- 装饰满幅背景只覆盖无交互的屏幕空间装饰；世界空间关卡、Tilemap、碰撞或玩法环境使用场景/Tilemap或世界/玩法环境路线。
- 非 `effect-image` 的普通 UI 仍可按项目约定使用矢量、字体工程、九宫格和布局配置；`effect-image` 则先依据上述路线分析，不因 UI 语义把特色材质默认降为原生绘制。
- 动画与 VFX 必须按动态时间采样验收，不能只检查某一静态帧。
- AI 合成栅格路线才读取 `effect-image-splitting.md`；它是可选子路线，不是其他资产类型的前置步骤。
- accepted 资源没有 `source_file/source_files` 时，任意路线的 `generation_record` 都必须提供公共可执行身份：`record_id`、生成器及版本、可解析时间、命令/配方、非空输入来源和非空参数对象；任意对象不能冒充来源。状态为 `producing`、`review` 或 `accepted` 的 `ai-composite-raster` 还强制其专用字段：非空全局前缀、资产段、状态段、负向段、模型、模型版本、种子、参考输入路径列表和后处理列表。
- 场景差异只能使用全局基线声明的允许变量；不得把不同场景做成同一模板或互不相容的美术体系。
- V4 必须用多资源联系表和同屏截图完成确定性一致性 F2；相同关键词、模型或调色板不能单独证明一致。

### 完整拆解与视觉显著性

在不影响功能的前提下，完整识别位图中的可独立部件，包括文字、图标、底板、色彩填充、边框和装饰；每项登记来源与实现路线，不因原图已合成就整块保留，也不因某项改用程序绘制就从拆解清单遗漏。拆分后的部件仍属于原功能组件，保持点击热区、状态联动、动态更新、本地化和布局关系；“完整”指职责与覆盖完整，不是逐字、逐颜色或逐装饰细节机械切碎。

路线先判断视觉作用和内容变化需求，再核对实现能力。明显承担主题、情绪或识别作用的字形、材质、轮廓和光影优先保留为独立位图；视觉特征不明显的操作文字优先考虑系统文本，简单色彩填充、规则边框等优先考虑原生绘制。系统文本使用 Creator `Label` 或 `RichText` 等项目确认的 UI 文本组件，沿用项目字体与多语言覆盖，不为每段普通文案生产字图。固定美术文字可用整段字图；需要更换文案或复用字形风格时评估位图字体及其字形覆盖。

默认 `usability` 下，低显著性文字的替代字体、简单填充的轻微装饰差异可以在拆解方案中明确说明，但不得改变文案、语义、可读性、视觉层级或状态识别。明显美术特征及明确要求保留的效果仍须保留；`exact` 或指定字体/效果时遵守对应精确要求。路线和替代依据写入现有分析、文字理由与字体方案，随拆解图一并人工确认，不增设确认步骤；实际显示效果仍由用户检查，技术检查不代替视觉验收。

### 色彩填充路线判定

色彩填充与文字使用同一判断顺序：先看视觉作用、特征显著性、状态变化与复用需求，再选择位图或原生绘制。颜色本身、静态/动态属性或程序能否画出渐变，都不能单独决定路线。

| 填充特点 | 拆分与实现 | 判断理由 |
| --- | --- | --- |
| 明显的金属、玻璃、纹理、立体光影、复杂辉光或不规则色面 | 将完整的材质表面作为独立位图；与边框、装饰可可靠分离时分别登记，否则保留完整原子部件 | 色彩与材质、光影共同承担主题和质感，单色或近似渐变无法保留主要视觉价值 |
| 有统一风格、需要多处复用的渐变或纹理填充 | 优先复用独立填充贴图，按需要使用已确认的九宫格、遮罩或分层装配；只有原生绘制能保留所需风格时才选择原生路线 | 类似位图字体复用字形，复用的是有风格的表面资产；填充仍按图片合同登记，缩放与裁切不得破坏材质特征 |
| 视觉特征不明显的纯色、透明色或简单规则渐变 | 独立登记为原生填充，记录形状、颜色、透明度和适用状态 | 主要承担分区、衬底、遮罩或数值/状态表达，原生绘制便于改变尺寸、颜色和填充比例 |

例如战斗失败弹窗：返回按钮的蓝色表面若包含明显高光、辉光与纹饰，应保留对应位图；只有可分离且视觉特征不明显的基础蓝色填充才单独交给原生绘制，金属边框、发光和装饰继续使用独立图片。不能只因为“是蓝色填充”就把整个按钮表面替换为纯色矩形。弹窗遮罩的简单半透明黑色可用原生填充，带裂纹和材质的深色面板则保留位图。

填充拆开后仍归属原组件，共用形状边界、圆角、裁切、布局及状态来源，避免接缝、重复叠色或透明度叠加。进度比例、选中/禁用颜色等功能状态保持运行时可变；位图负责风格表面，原生逻辑负责实际比例或状态，不能烘焙为单一固定结果。填充与光影无法可靠分离或分离会损伤功能、既定外观时，保留完整部件并记录原因，不为减少位图强行拆分。

### 程序还原资格与位图回退

拆解中标为 `runtime-program` 的视觉元素，必须能由当前选定 renderer 完整实现该区域要求保留的外观与适用状态。先列出实际字体/字形、填色、渐变、描边、阴影、发光、纹理、透明度及状态变化，再逐项对应可确定性实现的方法和已有可核验依据；元素叫“文字”“按钮”或方法名包含 Graphics/Text 都不能授予资格。不会实现、当前能力不支持或依据不足时，不得先标为程序元素，再用纯色、默认字体或简化效果近似交付。这里只决定生产路线，不新增自动截图或运行验收授权。

`runtime-program` 是实现分类，不能替代 `visual_route_analysis` 的视觉来源判断。程序能加载、排列或控制一张图片，不代表其纹理外观由程序还原：无法完整还原的固定外观进入独立 `image-asset` 区域，按实际来源选择位图拆解、独立生产或合规复用；程序区域只承担可以完整实现的绘制或行为。拆解提案中相应调整区域、标签、owner、生产合同和资源/布局绑定，不能用一个程序标签隐藏图片依赖。已确认方案的路线变化按现有 V2 变更与确认规则处理。

同一判断也适用于图片及其局部，不限于文字：图标、按钮表面、面板、装饰和背景中的元素，按已确认的功能语义、独立状态与可观察视觉边界拆解，逐项判断当前程序能力能否完整还原。可完整实现的几何、填色或效果可交给程序；不能完整实现的插画、纹理、渐变、光影、不规则轮廓或透明边缘保留为独立位图。不能因为原素材是一张图片就把全部内容强制图片化，也不能把复杂图形简化为近似几何。主体与阴影、发光等效果只有在分离后仍能完整还原且保持状态同步时才拆开；无法可靠分离时保留完整的原子视觉部件，不按每种颜色或每个装饰细节机械切碎。使用现有拆解提案、来源与透明合同，不改变 schema 或既有确认边界。

文字按[文字路线判定](../../cocos-game-ui-layout/references/layout-contract.md#文字路线判定)处理，先按上述视觉显著性确定需要保留的风格和适用路线；不能只因程序能绘制同样文案就把美术文字降为普通文本。渐变或其它效果本身不强制使用位图，但当前文字 renderer 必须完整复现方案要求保留的效果；不能复现的固定外观拆成字图或独立位图。效果与字形无法可靠分离时保留整段固定文字的视觉结果。动态或本地化内容仍须可变，不能烘焙为固定字图；可选位图字体或混合路线，但必须连同字形覆盖、排版和所需效果一起满足合同，能力不足时报告缺口，不自动降级外观。

## 生成式位图生产合同硬门禁

视觉清单 schema 1.5 的新合同字段必须显式填写：`production_origin`、`production_method`、`delivery_kind`、`image_generation_required`、`generation_record_required`、`substitution_policy` 和 `expected_assets`。`production_method` 使用 `image-generation` 表示生成式位图分类，也可使用 `authored-raster`、`authored-svg`、`cocos-graphics`、`runtime-program`、`reuse`；`delivery_kind` 仅允许 `raster-image`、`vector-image`、`runtime-drawing`、`runtime-program`、`existing-asset`。系统根据提示词、参考输入、主体材质、透明需求和可用能力决定是否进入 `image-generation`，不绑定供应商；`independent-production` 与 `generate-now` 都不能推断具体生成器；独立生产不等于图片生成，视觉相似不等于生产合同完成。

当 `image_generation_required=true` 时，唯一合格组合是 `production_method=image-generation` 与 `delivery_kind=raster-image`。必须保留独立源/运行时位图、实际生成器与版本、完整提示词、真实参考输入、MIME、宽高、alpha、实际输出文件，以及已被运行时实际消费的证据；`generator` 必须记录实际调用的工具；工具未暴露的版本、模型参数或种子明确记录 `not-provided`，不得编造。单图宽高由验证器按逻辑像素 `ceil(max placement width/height × intended_scale_range.max)` 自动计算，`expected_assets.width/height` 和实际输出必须精确等于最小值；`scene_asset_usage.max_dpr` 必须严格为数字 `1`，`padding_policy` 不是 `none` 均失败，尺寸计算合同不需要人工审阅。这里的 1 表示图片按最大约定逻辑显示尺寸 1:1 生产；运行时实际 DPR 仍按设备值动态取值并封顶为 2，不代表运行时固定使用 2。`authored-svg`、`cocos-graphics`、CanvasTexture 和 runtime drawing 均不能等价完成。生成记录禁止裁切冻结参考图，参考图只能作为输入约束；选择可用生成能力不自动新增外部调用授权。

当生成资产声明 `expected_assets.alpha=true` 时，必须冻结 `transparency_requirements.strategy` 与 `edge_profile`，并在生成记录中用 `edge_evidence` 说明从参考图观察到的边缘事实。路线按实际边缘与生产工具能力选择：`background-removal` 只适用于硬边主体与纯色背景明显分离的图像；`direct-alpha` 只在工具对该边缘类型已有验证、且输出 PNG 解码后确实含透明像素时使用；`mask-composition` 用于独立遮罩或人工创作。`semi-transparent`、`glow`、`soft-shadow`、`hair`、`glass`、`mixed` 禁止阈值去背。工具声明提供透明选项或提示词请求透明均不构成能力证明。复杂边缘没有可靠路线时，报告能力缺口，再选已验证的直接 Alpha、独立遮罩/人工创作、重新生成，或按明确变更流程调整为 Cocos 特效；不得提高颜色容差、硬抠轮廓、删除光效或伪造透明结果。

生成记录必须按实际路线记录生产工具和版本、参数、后处理、原始输入和最终归一化输出文件、`edge_profile` 和 `edge_evidence`。去背路线才记录 `source_background_color`、`color_separation_verified=true` 与 `background_removal_attempts`；其他路线禁止附带这些字段。已有真实透明图按 `origin=provided` 的复用合同接入，不伪造生成、遮罩或去背记录。透明生成输出必须是 PNG；V3/V4 均须解码像素证明存在真实透明度，不能只相信扩展名、提示词或工具声明。

当前可用工具的声明与真实像素验证边界见[生成式透明能力审计](transparency-capability-audit.md)。生成记录顶层使用实际 `generator/generator_version`；直接 Alpha 的 `capability.tool/tool_version` 必须与该生成器身份一致，并按 `edge_profile` 分别绑定可核验能力证据。没有对应实际 PNG 解码证据时，该能力仍标记未验证。

公共纯色背景脚本通过参数调用，不为每个任务改写脚本：

```bash
node skills/cocos-game-asset-integration/scripts/remove-background-local.mjs --source input.png --output output.png --background-color '#00FF00' --tolerance 24 --require-solid-background --edge-profile hard-edge --color-separation-verified --record record.json --preview-dir evidence/preview
```

上面的公共去背工具只服务 `hard-edge` 且主体与背景颜色明显区分的输入，并要求调用方显式声明 `--color-separation-verified`；不接受半透明、辉光、柔和阴影、毛发、玻璃或混合边缘。输出按统一归一化流程处理，真实 Alpha 和主体边界必须保留。

所有生成式位图单图均先保留真实原始输出，再按已冻结路线生产透明结果，最后执行尺寸归一化。`raw_source_file` 与 `raw_source_sha256` 绑定实际生成输入；`source_file` 和 `source_sha256` 绑定归一化后的运行时 PNG，并与 `runtime_file`、`runtime_outputs` 和 `normalization_record.output_file` 对齐。背景去除、直接 Alpha、遮罩合成三条路线都必须保留比例、Alpha 和主体边界；归一化禁止把棋盘格或网格预览烘焙进素材。首次输出比例不符时最多重生一次；第二次仍不符时，若 V1/V3 已冻结裁切焦点和安全事实，可用 `operation=crop-and-resize-to-contract`（CLI 使用 `--attempt-one`、`--attempt-two`、`--focus-x`、`--focus-y` 及每个 attempt 的身份元数据）：CLI/API 必须读取两个真实原始生成 attempt 的 `attempt_id`、`generation_record_id`、`generated_at`、文件、实际宽高，确认两者都与目标比例不符、实际来源路径互不相同；旧的仅路径数组结构拒绝，不要求两次尺寸相同但第二次实际宽高必须等于当前归一化输入。受控裁切按归一化输入的实际尺寸和约分目标比例计算最大整数 `crop_rect`，再等比 resize；若裁切会损伤主体、文字、透明轮廓或关键构图，则报告当前路线的能力缺口并重新制定输入或生产路线。`padding_policy=none`，禁止非等比拉伸、padding、contain、复制边缘或裁切冻结 `reference_target`；原图尺寸已经正确时记录 `operation=not-required`。透明素材归一化前后都必须解码检查 Alpha，并保持主体边界。归一化记录缺失、失败、实际路径或尺寸不满足要求先 `repair` 并重验当前门；只有冻结生产规格或上游事实真实变化时才 `return` 到最早受影响阶段。

所有透明路线都为同一候选生成浅底（`#F2E9DF`）和深底（`#16202E`）预览；预览记录 `candidate_sha256`、归一化 `source_file/source_sha256`、两张预览 SHA，以及检查项 `subject_integrity`、`background_residue`、`color_fringe`、`semi_transparency`。V3 可记录 `inspection.status=pending`；V4 必须由视觉检查将状态更新为 `passed` 并附证据，不能以 PNG 格式、机器 Alpha 检查或工具声明代替主体缺损、残留背景、色边和半透明区域检查。

拆解粒度补充：先完成状态分析，再建立唯一原子 `component_id/atomic_visual_key`；重复视觉实例通过 `placements` 表达，不重复生成资产。② 的六个顶部按钮分别是六个组件；⑧ 的三个相同底部表面可是一组件三 placements；⑨ 的三个动作图标按实际复用关系登记。生成式位图对每个唯一 component×required state 只接受独立位图，强制 `delivery_mode=individual` 与 `atlas_allowed=false`，编号组图、横向组图和图集均不等价；atlas 只适用于其他生产方法的显式切片合同。placement 热区有独立 `hotspot_id`，不计入视觉资产。

V3 按每个 `annotation_number/region_id` 写入上述合同和错误定位；Implementation Package 另写 `visualProductionUnits`，逐一绑定 coverage、所有者、ownedPaths、输出路径和格式。V4 必须提交 `production_contract_audit`，F2 只消费带 `validationMode=MACHINE` 的当前身份机器验证事实；V4 还必须绑定 V3、实施包、F2 机器验证事实、F3 runtime replay、freshness-bound fidelity cases、正式场景运行时消费和无未批准替换。

生产方式变化只能使用 `ACCEPTED` 的 Change Request，并绑定区域、工作项、候选版本、用户原文和决定时间。V4/F2/V4 发现缺少生成记录、输出文件、实际消费或未批准替换时必须拒绝，不得以补一张截图或相似度结论放行。

## 机器清单最低字段

根节点记录 `schema_version=1.5` 和 `effect_image_reconstruction`。普通资产使用 `not-applicable/not-applicable`，不得伪造目标、回对、coverage 或 fidelity；效果图还原使用 `effect-image/v2-ready`，V3 前要求冻结目标/候选、已通过回对和 coverage，V2/V3 可无 fidelity；V4 完成改为 `v4-complete` 并要求 case 非空且全部通过。coverage 每个区域必须有同 scene/state 唯一的正整数 `annotation_number`、非空 `ownership_evidence` 和 `implementation_plan`：`generate-now` 只允许 fixed-production-visual，`runtime-program` 只允许 runtime-data/runtime-rendered 且不得有 asset，`reuse-existing` 只允许 fixed-production-visual，并绑定已 `accepted`、当前 scene/state、基线、许可与兼容性证据的既有资源。

固定区域必须声明 `production_origin`：`bitmap-decomposition` 代表从冻结效果图拆解位图，必须先完成状态分析和唯一原子 component/placements 登记，再在冻结原图上生成绑定实际目标、region ID 和区域定义 的 PNG 提案并等待 USER_DECISION；`independent-production` 是独立生产，不得用 `effect-image-extraction` 原因伪装。对应 `confirmation` 必须记录 `proposal_id`、目标文件、`region_id`、实际区域定义、提案/决定记录文件、PNG 文件、MIME、版本和 `decision_id`；决定记录还要绑定 `decision_source=user-message`、thread/work item 和可解析时间；用户消息 SHA 仅作可选追踪。开始任何拆解生产前必须运行带 `--check-files --project-root .` 的资产校验；文件检查会核对实际 PNG 格式、尺寸、元数据和区域覆盖，正式流程不生成或接受 SVG 标注。`bitmap-decomposition` 映射资产必须使用 `ai-composite-raster`；独立生产的 source_file/source_files 不得指向冻结效果图 `original_file` 的真实路径；独立生产按实际内容判断，不比较内容 SHA。

`effect-image` 清单中只有被 fixed coverage 实际引用的资源必须声明 `ownership_type=fixed-production-visual` 并反向完整绑定 `coverage_region_ids`；同一清单中未被效果图引用的 Boot、Loading 或其他场景资产保持普通字段，且禁止伪造这两个还原专用字段。普通 `not-applicable` 清单也禁止还原专用字段。所有资源仍须声明具体 `scene_id` 或受控 `shared` 归属。处于 `producing`、`review` 或 `accepted` 的资源还必须绑定当前基线；`accepted` 必须保留来源或生成记录、适用的版权/许可信息、唯一输出、Cocos/玩法视觉与一致性证据。

`reuse-existing` 的 `reuse_source` 是可复核的精确身份，不是路径备注：必须同时记录 `source_asset_id`、`source_manifest`、`source_file`、`license_record`、`compatibility_evidence`、`visual_baseline_id/version` 及适用 scene/state。`source_manifest` 必须是独立的不可变 `asset-reuse-snapshot/1.0` JSON 快照，根节点为 `snapshot_schema`、`snapshot_id`、`asset`，禁止指向当前 `docs/visual-assets.json`；`asset` 记录 accepted 资源的基线、许可、scene/shared 归属、适用 scene/state、来源、runtime_outputs、Cocos/玩法/一致性证据，`source_manifest_sha256` 仅作可选追踪，验收按实际快照检查。`--check-files` 会解析快照并核对实际源文件及适用证据，不比较摘要；缺失、漂移、错误基线/许可/归属或 accepted 证据不全都不得通过。冻结 `reference_target.original_file` 默认必须是完整合法的 8 位非交错 RGB/RGBA PNG，且扫描行完整、IHDR 宽高必须与每个目标画布一致。

固定视觉区域的拆解粒度补充合同：状态分析必须先于组件清单，不能把 `annotation_number` 误当成资产数量。`state_analysis` 需要覆盖 default、selected、active、disabled、pressed、hover、victory、defeat、paused，并对每项写 `required` 或 `not-applicable+reason`。`component_inventory` 的 `component_count` 必须等于可复用部件清单；`image_generation` 的 `expected_assets` 必须逐 `component_id × required state_id` 映射。默认 individual 模式禁止一张横向组图满足多个 component；生成式位图必须 `delivery_mode=individual` 且 `atlas_allowed=false`；其他生产方法只有在显式合同下才能使用唯一 `atlas_slice` 元数据。交互热区不属于视觉资产。

方向或全局规则漂移退 V2；生产规格、基线绑定或生成包缺失退 V3；资源执行偏差退 V4；结构根因退 V1。冻结基线变更后标记失效证据，并重验全部受影响资源与同屏组合。

V3 结构设计运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V3`；V4 正式验收固定运行 `node scripts/validate_visual_manifest.mjs docs/visual-assets.json --stage V4 --check-files --project-root .`，V4 正式验收固定运行同命令但使用 `--stage V4`，不得只验证 JSON 字段。效果图清单必须以根 `workItemId`、`candidateVersion` 绑定当前工作项和候选版本，并与实施包的任务、版本和范围一致。
