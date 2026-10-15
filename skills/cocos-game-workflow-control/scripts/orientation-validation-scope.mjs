/** 屏幕方向与代表性视口的唯一映射，避免 UI、QA 和控制面扩大验证范围。 */
const VIEWPORT_KINDS_BY_ORIENTATION = Object.freeze({
  portrait: Object.freeze(['narrow-portrait', 'standard-portrait']),
  landscape: Object.freeze(['landscape', 'desktop-wide']),
});

/** 从项目明确支持的方向推导验证范围；缺少或非法声明不能默认为双方向。 */
export function resolveOrientationCoverage(policy) {
  const allowed = policy?.allowed;
  const errors = [];
  if (!Array.isArray(allowed) || allowed.length === 0
    || allowed.some((item) => typeof item !== 'string' || !Object.hasOwn(VIEWPORT_KINDS_BY_ORIENTATION, item))
    || new Set(allowed).size !== allowed.length) {
    errors.push('orientationPolicy.allowed 必须是非空且不重复的 portrait/landscape 数组');
  }
  const orientations = errors.length ? [] : [...allowed];
  return {
    orientations,
    viewportKinds: orientations.flatMap((orientation) => VIEWPORT_KINDS_BY_ORIENTATION[orientation]),
    requiresOrientationChange: orientations.length === 2,
    errors,
  };
}

/** 根级与嵌套合同必须声明同一方向集合，数组顺序不改变支持范围。 */
export function validateOrientationPolicyConsistency(rootPolicy, nestedPolicy) {
  const root = resolveOrientationCoverage(rootPolicy);
  const nested = resolveOrientationCoverage(nestedPolicy);
  if (root.errors.length || nested.errors.length) return [...new Set([...root.errors, ...nested.errors])];
  return root.orientations.length === nested.orientations.length
    && root.orientations.every((orientation) => nested.orientations.includes(orientation))
    ? [] : ['根级与嵌套 orientationPolicy.allowed 必须一致'];
}

/** 根据实测几何识别方向，方形视口沿用固定设计基准的横屏判定。 */
export function measuredOrientation(viewport) {
  if (!Number.isFinite(viewport?.width) || viewport.width <= 0
    || !Number.isFinite(viewport?.height) || viewport.height <= 0) return null;
  return viewport.width < viewport.height ? 'portrait' : 'landscape';
}

/** 代表类别只接受同方向的真实尺寸，标签或宽竖屏不能冒充桌面横屏。 */
export function matchesRepresentativeViewport(kind, viewport) {
  const orientation = measuredOrientation(viewport);
  if (kind === 'narrow-portrait') return orientation === 'portrait' && viewport.width <= 375;
  if (kind === 'standard-portrait') return orientation === 'portrait' && viewport.width >= 390;
  if (kind === 'landscape') return orientation === 'landscape';
  if (kind === 'desktop-wide') return orientation === 'landscape' && viewport.width >= 1024;
  return false;
}

/** 方向切换必须来自同一未刷新的页面，换上下文或自报事件不能代替实测。 */
export function hasSamePageOrientationChange(records, viewportOf = (record) => record.viewportRect) {
  return records.some((record, index) => {
    if (index === 0 || record.samePageWithPrevious !== true || record.pageReloaded !== false
      || record.contextId === undefined || record.contextId !== records[index - 1].contextId) return false;
    const before = measuredOrientation(viewportOf(records[index - 1]));
    const after = measuredOrientation(viewportOf(record));
    return before !== null && after !== null && before !== after;
  });
}
