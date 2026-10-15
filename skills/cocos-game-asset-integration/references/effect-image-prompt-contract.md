# Effect-image 生成式位图忠实还原提示词合同

本文件是 `effect-image` 模式的唯一提示词模板与机器合同来源。它定义“非像素复制的高保真忠实重建”，即允许重新绘制全部像素，但不得重新设计任何可观察视觉事实。工作流路由见 [`visual-reconstruction.md`](visual-reconstruction.md)、[`asset-production-routes.md`](asset-production-routes.md) 和 [`visual-production-pipeline.md`](visual-production-pipeline.md)；代码门禁由 [`effect-image-prompt-contract.mjs`](../../cocos-game-workflow-control/scripts/effect-image-prompt-contract.mjs) 执行。

本提示词只适用于 V2 已冻结为 `selected_route=image-asset` 且 `image_generation_required=true` 的区域；它负责生成合同，不负责选择生产路线。文本、纯色框体和基础几何等区域不能因为静态或“像 UI 资产”而自动进入图片提示词。已冻结 `image_generation_required=true` 的合同也不能被提示词生成器改成 Cocos 原生实现；生产方式变化须有明确接受的 Change Request。

场景主图、全局候选与宿主上下文图先按[效果图文案约束](../../cocos-game-ui-layout/references/game-copy.md#效果图生成)生成玩家可见表达，再冻结为本合同的上游目标。本模板仅用于冻结后的原子资源：不从策划说明添加文字，也不追加要求删改冻结文字的指令；`asset_prompt` 按区域继承文字与动态数值所有权。

效果图成为正式目标前按[游戏美术体验与质量契约](art-quality-contract.md)检查主题、受众、可读性、静态舒适与完成度。以下忠实还原模板会继承目标的高光与材质，不能修复目标自身的美术问题；若目标与质量要求冲突，先调整受影响上游目标并重新确认，再生产部件。负向段中的风格改变词限制未经确认的迁移，不代表所有项目禁止卡通、扁平或霓虹风格。

## 全局提示词

`global_prompt_prefix` 必须逐字使用下面的 canonical 内容：

```text
任务类型：对冻结效果图执行“非像素复制的高保真忠实重建”，不是重新设计、概念探索或风格改编。

提供的完整冻结效果图是唯一视觉真值，也是本次生成的实际参考输入。只重绘当前指定的 atomic component。严格保持该部件在参考图中的视觉类别、外轮廓、长宽比例、相对尺寸、朝向、透视、结构分区、颜色分布、材质、明暗关系、光源方向、能量辉光、线条粗细、装饰密度、透明边界及可见裁切关系。

不得进行审美优化，不得补充参考图中不存在的结构，不得替换符号语义，不得改变角色姿态、镜头角度、框体轮廓、字体结构或图标含义。

允许重新绘制全部像素，但禁止把参考图裁切、抠图或复制后直接作为交付结果。

输出单个独立位图资产。背景按本次实际请求中的源图背景要求绘制；主体必须完整落入指定画布。不得生成组合图、atlas、sprite sheet、展示板、说明文字、无关 UI、数字、标签、水印或其他组件。
```

当生成资产的 `expected_assets.alpha=true` 时，提示词按已冻结的 `transparency_requirements.strategy` 和 `edge_profile` 选择透明生产要求。只有 `strategy=background-removal` 且 `edge_profile=hard-edge` 时才追加下面的纯色背景段；调用前选择与主体明显区分的 HEX，并使提示词、记录颜色和脚本参数一致：

```text
背景要求：将参考图或 asset_prompt 中用于描述最终透明边界的区域，在本次原图中统一填充为不透明、无纹理的纯色平涂背景；指定颜色为 #00FF00（RGB 0, 255, 0）。
主体必须完整落入画布并与画布边缘保持间隔；保持主体颜色、材质、光影和边缘形状不变，不把背景或背景阴影烘焙进主体。调用方应在发送提示词前选择与主体明显区分的指定纯色。
背景必须整片均匀不透明；禁止棋盘格、网格、渐变、纹理、背景阴影、环境景物、边框、说明文字或色值文字。
```

生成记录按实际路线记录 `generator`/`generator_version`、工具参数、输入/输出路径及 SHA、`edge_profile`、`edge_evidence` 和后处理；未暴露的版本、参数或种子记录 `not-provided`，不得编造。背景去除路线必须限定 `hard-edge`，显式记录 `source_background_mode=opaque`、`source_background_color`、`color_separation_verified=true` 及真实 `background_removal_attempts`，并复用 `remove-background-local.mjs`；每次尝试按实际情况记录状态、源/输出路径、Alpha、背景颜色、时间、失败原因和证据。不得为半透明、辉光、柔和阴影、毛发、玻璃或混合边缘使用颜色阈值去背。

直接 Alpha 路线只有在当前工具对声明的 `edge_profile` 有可核对能力证据时才可使用。generation record 顶层记录 `generator/generator_version`，嵌套 `capability.tool/tool_version` 必须与其一致；同时记录真实透明输出格式和能力证据，原始输出 SHA 仅作可选追踪。V3/V4 必须解码 PNG 的像素证明存在真实透明值，不能只依据扩展名、提示词或工具参数声明。遮罩合成路线记录原始输入、独立 mask、合成输出各自路径、mask 处理工具/版本、参数与证据。工具无法可靠保留所需的半透明、辉光、柔和阴影、毛发、玻璃或混合边缘时，报告能力缺口，改用已验证的直接 Alpha、独立遮罩/人工创作、重新生成或有明确合同的 Cocos 特效；不得提高容差、硬抠轮廓、删除光效或伪造透明结果。已有真实透明图按资源复用合同接入，不伪造生成或去背记录。

`transparency_strategy` 只允许 `background-removal`、`direct-alpha`、`mask-composition`。只有背景移除路线允许记录背景颜色和 `background_removal_attempts`；直接 Alpha 与遮罩路线不得伪造去背记录。`postprocess` 必须是字符串数组。

`negative_prompt` 必须逐字使用下面的 canonical 内容：

```text
重新设计，二次创作，概念探索，风格迁移，风格改编，审美优化，专业修复，提升游戏感，自由发挥，改变轮廓，改变比例，改变朝向，改变透视，改变姿态，改变构图，替换符号语义，新增参考中不存在的结构，新增装甲，新增武器，新增翅膀，新增徽章，遗漏参考结构，通用科幻图标，过度发光，霓虹泛滥，卡通化，扁平化，低细节，模糊边缘，组图，atlas，sprite sheet，整屏 UI，设计展示板，说明文字，水印，棋盘格烘焙背景，直接裁切参考图，直接抠取参考图，直接复制参考像素。
```

## 禁止与必须

禁止把完整冻结效果图直接裁切、抠取、复制像素后当作输出，也禁止用整屏截图覆盖结构化 Scene。必须将完整冻结效果图作为实际参考输入，严格继承轮廓、比例、朝向、透视、结构、颜色、材质、光影、装饰密度、透明边界和裁切关系，并重新绘制像素。

未经明确 Change Request 或用户例外决定，不得重新设计、风格改编、审美优化、提升游戏感、专业修复、替换图标语义，或改变角色姿态、镜头、构图、字体结构和图标含义。负向提示词中的“重新设计”等词只表达禁止项，不得被正向指令门误报。

## asset_prompt 继承规则

每个 `effect-image` 的 `asset_prompt` 必须来自当前 `scene_reconstruction_contract.coverage_regions` 的冻结 region（按 `region_id` 绑定），不能只写“科幻按钮”“机甲角色”“未来卡框”等通用品类，也不能根据资产名称自行推断参考图中不存在的语义。提示词生成器会将 region 事实序列化为以下字段，并把 `annotation_number/region_id/component_id/state_id` 写入实际提示词：

- 视觉类别和图形语义；
- 外轮廓及关键内部结构；
- 长宽比例和相对尺寸；
- 朝向、视角和透视；
- 颜色分布和材质；
- 光源、高光、阴影及辉光；
- 线条粗细和装饰密度；
- 透明区域、可见裁切及留白；
- 不应烘焙进该资产的其他对象；
- 文字、数值、热区、运行时前景和状态等所有权。

字段允许使用 scene contract 的 snake_case/camelCase 别名或 `visual_facts`/`fidelity_facts` 容器，但必须保留原始值。region 缺少事实时，生成器不得用资产名补全；校验器先输出 `repair` 并阻断当前门，只有冻结方案事实真实失效时才建议 `return`。

## 结构化生成记录

已在 V2 确认的九宫格皮肤按[九宫格合同](nine-slice-ui.md)生产：调用 `buildEffectImageFullPrompt` 时传入完整 `expectedAsset`，构建器把最终小图 `source_size`、四边切片值与固定角边要求加入实际提示词。保留完整参考图作为视觉输入；皮肤源图的切片生产比例与最终显示框比例分别记录，最终外形由冻结显示框和九宫格规则还原。生成记录缺少实际切片段会阻断；正式场景实现须消费冻结参数，不临时改写九宫格。

九宫格尺寸归一化传入已冻结的 `nine_slice`；CLI 使用 `--nine-slice-json` 传递同一 JSON，`--width/--height` 使用 `source_size`。只允许保持源帧比例的整图尺寸归一化，不适用普通图片两次比例失败后的受控裁切；比例仍不符时报告源图问题，不能裁掉角边或补边后用正确尺寸冒充合格皮肤。

仅对 `effect-image` 的生成式位图强制：

```json
{
  "reconstruction_mode": "reference-faithful",
  "reference_input_mode": "full-reference-guidance",
  "pixel_reuse_policy": "forbid-output-reuse"
}
```

`generation_record.reference_inputs` 必须包含 `reference_target.original_file` 指向的完整冻结效果图；`style_reference_inputs` 只能补充，不能替代它。`source_file`、`runtime_file`、`output_file` 和实际输出路径/文件身份不得等于冻结图。`crop_reference=true`、`reference_crop=true`、裁切/抠图参考图或复用参考像素作为输出都必须失败。

完整效果图中的小部件往往只占少量像素。生产时应同时提供从同一冻结原图按已确认 region bounds 导出的局部细节参考，作为额外的 `reference_inputs`；完整原图仍须同时发送，以保留构图、尺度和相邻关系。细节参考只供模型观察，不能当作资产输出或可复用素材。记录裁取范围、冻结原图 SHA、细节图路径与 SHA，以及实际发送的输入顺序；不得放大裁图后声称获得了原图中不存在的细节。原图分辨率不足以辨认轮廓或纹饰时，先标记该视觉事实不确定并修正 V1/V2 目标或取得更清晰的参考，不能让模型自由补画。

每个原子部件的 `asset_prompt` 还应明确“完整原图用于全局关系、局部细节图用于当前部件形态”，并把 region bounds、部件在整屏中的相对尺度、相邻对象的排除边界写进实际提示词。禁止把局部裁图单独作为唯一参考；禁止把局部裁图、抠图或原图像素直接交付为生成结果。

记录必须保存实际发送的完整提示词（`full_prompt` 或 `actual_prompt`）和真实 `reference_inputs`，不能在生成后拼一份未实际使用的文本。完整提示词至少可复核地包含 canonical 全局段、当前 region 事实资产段、状态段和 canonical 负向段；透明资产的提示词段按冻结策略生成：纯色背景段只用于符合条件的 `background-removal + hard-edge`，直接 Alpha 需表达透明输出与边缘保留，遮罩合成需分别说明主体和 mask 输入。记录绑定实际目标文件、`region_id`、候选版本与实际 `record_id`；`target_sha256`、`candidate_sha256`、`diff_fingerprint` 仅作可选追踪。`generator`/`generator_version` 必须记录系统按提示词、参考输入、材质、透明需求和已验证能力实际选择的工具身份；未暴露时写 `not-provided`。

普通非 `effect-image` 生成式位图不要求以上三个重建字段，也不要求冻结效果图作为参考输入；仍须记录实际生成器、版本、提示词、输入、输出和后处理。

透明单图按冻结的 `transparency_strategy` 生成或合成，再执行 Sharp 尺寸归一化、V3/final/runtime。归一化记录绑定处理输入；`source_file` 指向最终归一化 PNG，摘要可选且不参与验收，实际输出、`runtime_file` 与 `normalization_record.output_file` 身份一致。归一化须保持 Alpha、比例和主体边界，不得把棋盘格烘焙背景当作透明。生成失败或路线处理失败时保留实际失败记录；能力不足就报告缺口，不以更高容差、硬抠边缘或删除光效重试。

每条透明路线为同一候选制作浅底（`#F2E9DF`）和深底（`#16202E`）预览，记录实际候选、归一化 PNG 和两张预览路径，SHA 仅作可选追踪。V3 可记录 `inspection.status=pending`；V4 必须人工检查主体缺损、残留背景、色边和半透明区域，状态改为 `passed` 并附证据。机器格式或 Alpha 检查不能替代视觉检查。

所有生成式位图首次输出比例不符时最多重生一次；第二次仍不符时，若冻结裁切焦点和安全事实允许，使用 `crop-and-resize-to-contract`，记录 `aspect_ratio_correction` 中两次真实原始生成 attempt、SHA、尺寸、focus 和最大目标比例 `crop_rect`；若裁切会损伤主体、文字、透明轮廓或关键构图，则报告能力缺口或重新制定路线，不得把棋盘格烘焙背景当作真实透明。`padding_policy=none`，禁止非等比拉伸、padding、contain、复制边缘或裁切冻结 `reference_target`；透明目标归一化前后都必须保留真实 Alpha。

## 全局视觉基线绑定

effect-image 生成必须在生成前绑定已完成三候选人工选择且由 `globalVisualBaselineSelectionRef` 支持的当前 `visual_baseline`，而不是只绑定局部冻结效果图。基线只能处于 `global-static-baseline-frozen`，身份必须包含 `id`、`version`、`document=docs/visual-baseline.md` 和全部 `anchor_evidence`。原子资产的 `reference_inputs` 仍必须包含完整冻结效果图；`style_reference_inputs` 逐项继承全部全局锚点并记录实际文件，SHA 仅作可选追踪，不能用锚点替代完整冻结图。

实际生成记录至少包含 `origin=generated`、四个基线身份字段、`global_visual_consistency_prompt`、`style_drift_policy=forbid`、实际发送的 `full_prompt`、`consistency_status=passed` 与实际文件路径的 `consistency_evidence`；`target_sha256`、`output_sha256` 及证据 SHA 仅作可选追踪。`full_prompt` 必须同时含本文件既有的忠实重建 canonical 段、全局一致性段、asset/state/negative 段；缺少实际发送证明、漏传/多传锚点、允许风格迁移或身份漂移均失败。用户/外部提供图使用 `origin=provided`，不得补写伪生成记录。共享常量和合同位于 `global-visual-consistency-contract.mjs`。

## V4 同屏组合

V4 不得只凭文件存在、MIME、尺寸、Alpha、component×state 齐全、运行时登记或 `missing=0` 判定视觉通过。`combination_preacceptance` 必须绑定 V4 正式运行画面所使用的当前资产与布局结构，并以机器可复核事实检查轮廓、比例、姿态、图标语义和整屏构图与冻结目标的关系；还必须记录无未经批准的重新设计。提示词合同/实际 generation record 的绑定必须同时覆盖当前目标文件、region ID 和候选标识。提示词合同失败属于执行问题，先在 V3/V4 原地修复或重验当前门；只有冻结 target/方向/候选身份真实变化时才进入必要回退。
