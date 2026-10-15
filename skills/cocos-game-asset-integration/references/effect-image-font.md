# 标注 PNG 中文字库

效果图拆解标注的右栏使用随 skill 固定的 `effect_image_font.mjs` 位图字库。运行时不读取系统字体、不调用 SVG，也不生成缺字方框：字符不在字库索引中时，标注生成直接失败。

字库由 Noto Sans CJK SC Regular 离线栅格化为 16×16 二值字形，覆盖 GB2312 字符集、ASCII 和中文标点，共 7540 个字形；压缩位图约 150653 字节，模块文件约 224 KB。来源文件 SHA-256 为 `2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b`。

来源：<https://github.com/notofonts/noto-cjk/blob/main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf>

许可证：SIL Open Font License 1.1，随 Noto CJK 仓库的 [Sans/LICENSE](https://github.com/notofonts/noto-cjk/blob/main/Sans/LICENSE) 发布。位图派生物保留来源、许可证和源文件 SHA 元数据，便于复验和再生成。
