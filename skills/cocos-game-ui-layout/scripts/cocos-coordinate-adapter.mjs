/** 校验未缩放父矩形及锚点；该适配器不承担 Camera、旋转或世界坐标投影。 */
function checkedFrame({ width, height, anchorX = 0.5, anchorY = 0.5 }) {
  if (![width, height].every((value) => Number.isFinite(value) && value > 0)
    || ![anchorX, anchorY].every(Number.isFinite)) throw new TypeError("尺寸必须为正有限数，锚点必须有限");
  return { width, height, anchorX, anchorY };
}

/** 将父矩形左上布局坐标转成 Creator 锚点局部坐标，显式反转 Y 方向。 */
export function layoutPointToNodeLocal({ x, y }, frame) {
  const { width, height, anchorX, anchorY } = checkedFrame(frame);
  if (![x, y].every(Number.isFinite)) throw new TypeError("坐标必须有限");
  return { x: x - width * anchorX, y: height * (1 - anchorY) - y };
}

/** 将 Creator 锚点局部坐标还原为左上布局坐标，供输入和测量使用同一逆变换。 */
export function nodeLocalToLayoutPoint({ x, y }, frame) {
  const { width, height, anchorX, anchorY } = checkedFrame(frame);
  if (![x, y].every(Number.isFinite)) throw new TypeError("坐标必须有限");
  return { x: x + width * anchorX, y: height * (1 - anchorY) - y };
}

/** 将 cover 结果转换为 Sprite 的锚点位置，保留原图尺寸时才应用返回的 scale。 */
export function coverTransformToCocos(cover, parentFrame, spriteAnchor = { x: 0.5, y: 0.5 }) {
  if (![cover?.x, cover?.y, cover?.displayWidth, cover?.displayHeight, cover?.scale, spriteAnchor.x, spriteAnchor.y].every(Number.isFinite)
    || cover.displayWidth <= 0 || cover.displayHeight <= 0 || cover.scale <= 0) throw new TypeError("cover 尺寸、缩放及锚点必须有效");
  // Sprite 锚点 Y 从底部计量；先求该锚点在图像左上坐标中的位置，再转换父空间。
  const position = layoutPointToNodeLocal({
    x: cover.x + cover.displayWidth * spriteAnchor.x,
    y: cover.y + cover.displayHeight * (1 - spriteAnchor.y),
  }, parentFrame);
  return { ...position, scale: cover.scale };
}
