# 离线布局审阅产物

本参考定义布局生成器的通用审阅页和同批产物。它服务于 V2 的“拆解图确认 → 内部生成显式布局决策 → 布局图及审阅页 → 独立布局图确认”顺序，不创建新的阶段、Work Item、审批账本或业务状态。用户直接查看 PNG/`review.html` 并确认图片；`layout-decision.json`、节点数据和其他技术记录由代理维护，不要求先行阅读或文字确认。布局图中的 bounds、父子关系和对齐用于保证 V2 方案内部一致性，不自动升级运行态的像素验收。运行态默认使用 `visual_validation.mode=usability`，允许合理的位置、尺寸和换行偏差；只有明确的 `exact` 需求才启用严格视觉差异门。需要实现或校验离线审阅页时读取本文件；字段的全局状态语义仍以控制面 Schema 为准。

## 生成目录与产物

继续使用 `scripts/generate_layout_annotation.mjs` 及其现有参数。标准调用把 `--output` 指向一个新的候选目录，例如 `--output .workflow-control/evidence/<work-item>/<layout-version>/layout.png`。生成器以该 PNG 所在目录为本次候选目录，在同一批同步写入以下五份产物：

| 文件 | 用途与最低内容 |
| --- | --- |
| `layout.png` | `layout-annotation/png/1` 标准布局标注图，继续作为机器验收和可下载的静态证据；在冻结参考图上叠加父子框、编号和右栏说明。 |
| `layout-nodes.json` | 本批实际节点快照，按已确认 `decomposition_elements` 原顺序保存父子关系、坐标、尺寸、对齐、偏移、锚点、层级和中文显示名；审阅页直接消费它。 |
| `layout-decision.json` | 本批实际消费的 `automatic-layout-decision/1.0` 决策字节及其 ID；不能让页面或节点快照另行推导对齐结果。 |
| `review.html` | 通用、自包含、可直接用本地浏览器打开的审阅页；嵌入本批冻结参考图和节点数据，并提供基于内嵌 data URL/原始字节的产物入口。 |
| `generation-result.json` | 记录 `layout.png`、两份布局 JSON 和 `review.html` 的相对路径、真实文件 SHA，以及上游绑定摘要；自身 SHA 只由 stdout 返回，避免自引用。 |

每个布局版本使用独立候选目录；重新生成或人工修改后必须使用新版本目录，不能把不同批次的 HTML、PNG、节点或决策拼在一起。产物路径在机器数据中使用项目根相对路径并通过项目根路径校验，审阅页的下载入口直接使用内嵌 data URL/原始字节，单独搬走 HTML 后仍可下载。参考图可以来自冻结目标的 `original_file`，但必须在生成时读取实际字节；参考项目中的专用脚本或页面不能成为通用生成器的输入或模板分支。

`generation-result.json` 必须由生成器在其他产物写完后自行写入，摘要仅作可选追踪。生成器 stdout 保留原有完整 result，并额外返回 `generation_result_file` 和该文件的 `generation_result_sha256`；不要把 stdout 重定向覆盖 `generation-result.json`，如需留存 stdout，应另存为独立日志或回执文件。这样可以避免生成结果文件产生自引用，且调用方仍能核对其最终字节。

## 审阅页模板

`review.html` 只能由一个通用模板生成，不得按场景复制专用 HTML、专用节点 ID 或专用坐标规则。模板至少提供以下区域和行为：

本页保持不可编辑，供用户直观看 V2 布局 PNG、节点关系和页面内容，并据此确认布局图；完整技术节点与决策数据保留在可展开详情中供需要时查看，不构成独立文字确认门。V4 正式场景直接消费 V2 确认的布局目标和 V3 验收的资源；场景实现中的校准按[正式场景视觉还原与校准](../../cocos-game-asset-integration/references/visual-alignment-authoring.md)执行。不得在此页临时改框再把页面状态冒充已确认数据。

- 左栏展示完整冻结参考图，保持原始宽高比，不裁切、不拉伸；右栏按 `layout-nodes.json` 的数组顺序列出全部节点。小屏幕可以改为上下排列，但不能删除左栏或把长 PNG 作为唯一审阅入口。
- 图片和高亮框使用同一个目标 viewport 坐标映射。映射以图片实际内容框的左上角、显示宽高和目标 viewport 宽高定义；图片与覆盖框共享同一缩放比例，窗口变化或上下排列时保持该映射，不能使用另一套手工百分比或过期的 `target_css`。父框和当前框必须在同一映射下绘制，保证 `target_bounds` 在任意缩放下仍与原图对齐。
- 节点选择同时显示当前节点和其父节点，当前节点与父节点使用不同颜色；图例明确说明颜色含义。节点卡片展示父子关系、水平左/中/右对齐、垂直上/中/下对齐、双轴偏移、位置和尺寸。根节点明确显示“无上级”。
- 节点卡片还应直接展示确认过的功能分组类别与理由，便于检查部件是否属于对应功能组件；不能仅在大区域里列出全部图标和文字就视为完成分组。语义定义见[功能语义分组约束](functional-semantic-grouping.md)，页面不自行推测或修改归属。
- 默认视图显示易读的中文名称和中文关系说明；技术 ID、完整原始字段、SHA 和坐标细节放在可展开的详情中。节点名称优先使用节点声明中的中文显示字段（例如 `display_name_zh`；声明的 `display_name` 本身为中文时也可使用），缺失时使用集中维护的通用语义映射（例如容器、视觉组件、运行时文字、交互热区、根视口），不得根据项目专有 ID 写分支或硬编码专有节点名称。
- 长名称和长列表必须换行、可滚动且完整可见；详情区域不能通过固定高度、单行省略或裁切隐藏信息。无障碍名称、键盘可操作的节点选择和清晰的当前选择状态应保留。
- 页面显式标记当前候选状态，例如“待人工布局确认”；打开页面、切换节点、下载文件或生成成功都不改变确认状态，也不写入业务、存档、Work Item 或正式确认记录。

参考图、节点 JSON 和页面脚本都内嵌在 HTML 中，页面不得引用 CDN、远程字体、网络资源、开发服务器、游戏运行环境或外部 JavaScript。下载入口直接导出内嵌 data URL/原始字节中的本次生成 JSON；不能把页面运行时重新序列化的派生对象冒充 `layout-nodes.json` 或 `layout-decision.json`。对图片及 JSON 的 `data:` 内容、链接和显示摘要应由模板安全生成。

## 数据和安全边界

审阅页不建立坐标、父子关系、对齐规则或名称数据的副本。它只读取同批 `layout-nodes.json` 和生成结果绑定的冻结参考图；布局节点的 `target_bounds`、`parent_target_bounds`、`relative_position`、`axis_alignment`、`self_anchor`、`reference_anchor` 和 `offset` 是唯一事实来源。布局 PNG 仍由确定性渲染器生成并接受现有的 PNG 魔数、尺寸、metadata、节点、编号和像素检查。

生成器和文件门必须读取实际文件，不要求提供或复算 SHA：

- 每个节点的父节点必须存在，允许的根只能是 `viewport` 或 `safe-area`；父子关系不能自引用、成环或跨 scene/state。父目标 bounds、子目标 bounds、四边距离和 viewport 边界必须逐项校验。
- 必须读取已绑定 proposal 的实际拆解元素，核对功能分组及父级继承；仅让 HTML、JSON 和 PNG 互相一致不够，因为三者可能共同使用了错误分组。`semantic_grouping` 的类别、理由或父级漂移不得复用旧拆解确认，缺失归属不能用最小包含容器补齐。
- `layout-nodes.json` 的节点顺序、节点身份、编号映射、父编号、决策 ID 和 scene/state 必须与布局 PNG 和本批决策逐项一致。缺失父节点、循环关系、非法边界、元素漏绑、调序、跨场景输入或身份不一致都应以明确错误阻断，不能静默丢节点或降级为距离猜测。
- `review.html`、节点 JSON、决策 JSON、布局 PNG 和冻结参考图都必须存在且可读取；任何路径越界或必要文件缺失都使本批失败，SHA 变化不影响验收。页面模板的布局标识、内嵌数据和下载字节也应由校验器核对。
- 中文名称、ID、用户可见摘要和 JSON 内嵌值必须正确转义。脚本数据应使用安全的 JSON 序列化并阻断 `</script` 提前闭合；DOM 文本优先使用 `textContent`，不能把节点名称或 ID 拼入未转义的 `innerHTML`，避免名称输入改变页面结构或执行脚本。

## 身份绑定与独立确认

布局生成结果、V2 场景根计划、布局合同和 `layout-annotation-confirmation/1.0` 共同保存以下同批身份。字段名以机器 Schema 为准，实际路径须指向可读取文件，SHA 仅作可选记录：

| 身份 | 必须绑定 |
| --- | --- |
| 上游参考与拆解 | 冻结参考图/`target_sha256`、`scene_id`、`state_id`、拆解确认 ID、实际 proposal 文件；页面不能显示一个参考图而绑定另一张图。 |
| 布局决策 | `layout_decision_file`、`layout_decision_id`；`layout_decision_sha256` 可省略；决策逐元素覆盖确认元素并与节点对齐字段一致。 |
| 标准标注图 | `layout_annotation_file`、`layout_annotation_sha256`、尺寸、metadata SHA 和 `layout_annotation_identity_sha256`。 |
| 节点快照 | `layout_nodes_file`；页面和下载必须指向本批实际节点内容，`layout_nodes_sha256` 可省略。 |
| 审阅页 | `layout_review_file`、`layout_review_sha256`、`layout_review_identity_sha256`；身份投影还应覆盖页面绑定的参考、决策、节点和 PNG 身份。 |

上述字段必须同时进入独立布局 confirmation、decision record 和 user decision receipt，并在三份记录中逐字段一致。人工确认针对用户实际看到的 `review.html` 与同批布局 PNG 产生，用户可直接简短确认图片，也可按图号反馈修改；无需另行确认 JSON 或 decision record。旧审阅页、旧节点或旧决策不能确认新布局。页面显示候选状态不等于 `accepted`，只有控制面收到明确的人工确认消息、写入受保护 receipt/ledger 并通过真实文件门后，布局确认才成立。任何参考图、拆解 proposal、决策、节点、PNG、审阅页或其身份变化都会使旧确认失效；拆解事实变化还必须先回到拆解图确认。

布局审阅页是给人检查结构和关系的可读界面，不能取代 PNG 标注图、布局合同、F2 机器校验或 V4 运行态证据。独立布局确认完成后，V2 才能继续合同回对和生产方案；V3/V4 仍必须复核当前场景 Work Item 的绑定身份与机器证据。

## 可复现调用

以下命令保留现有入口和参数；`--output` 所在目录是本批唯一写入目录，`--layout-decision-file` 可以指向已准备的决策源文件，生成器会把实际消费的决策作为同目录 `layout-decision.json` 输出：

```text
node skills/cocos-game-asset-integration/scripts/generate_layout_annotation.mjs docs/visual-assets.json --project-root . --scene-id <scene-id> --state-id <state-id> --output .workflow-control/evidence/<work-item-id>/<layout-version>/layout.png --decomposition-confirmation-id <confirmation-id> --decomposition-confirmation-sha256 sha256:<64-lowercase-hex> --proposal-sha256 sha256:<64-lowercase-hex> --layout-decision-file <decision-source.json> --layout-decision-sha256 sha256:<64-lowercase-hex>
```

成功后同目录应有 `layout.png`、`layout-nodes.json`、`layout-decision.json`、`review.html` 和 `generation-result.json`；stdout 保留完整 result，并额外返回 `generation_result_file` 与 `generation_result_sha256`，调用方据实际路径读取最后一份文件，不核对摘要。stdout 若需保存，使用不同的日志路径，不能写回 `generation-result.json`。
