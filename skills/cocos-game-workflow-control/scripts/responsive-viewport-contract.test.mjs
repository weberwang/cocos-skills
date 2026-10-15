import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { calculateFixedDesignViewport } from '../../cocos-game-ui-layout/scripts/fixed-design-viewport.mjs';

import {
  IMAGE_PRODUCTION_DPR,
  REPRESENTATIVE_BEHAVIOR_REQUIREMENTS,
  REPRESENTATIVE_DPR_REQUIREMENTS,
  REPRESENTATIVE_VIEWPORT_KINDS,
  RESPONSIVE_CONTRACT_FIELDS,
  RUNTIME_EVIDENCE_FIELDS,
  computeCanvasBackingSize,
  isResponsiveWorkItem,
  normalizeRuntimeDpr,
  validateResponsiveContract,
  validateResponsiveEvidenceManifest,
  validateResponsiveEvidenceRecord,
} from './responsive-viewport-contract.mjs';

const WORK_ITEM_SCHEMA = JSON.parse(readFileSync(new URL('../references/work-item.schema.json', import.meta.url), 'utf8'));
const IMPLEMENTATION_PACKAGE_SCHEMA = JSON.parse(readFileSync(new URL('../references/implementation-package.schema.json', import.meta.url), 'utf8'));

/** 正式运行阶段收敛到 V4，避免数字范围继续把旧 V5 当成合法响应式工作项。 */
test('响应式工作项范围仅包含 V1-V4', () => {
  for (const visualStage of ['V1', 'V2', 'V3', 'V4', 'v4']) {
    assert.equal(isResponsiveWorkItem({ visualStage, visibleVisualProductionIntegration: true }), true);
  }
  for (const visualStage of ['V0', 'V5', 'V6']) {
    assert.equal(isResponsiveWorkItem({ visualStage, visibleVisualProductionIntegration: true }), false);
  }
});

/** 构造覆盖默认 usability 矩阵的工作流响应式合同。 */
function makeContract() {
  return {
    responsiveContractVersion: 'responsive-viewport/1.0',
    layoutContractVersion: 'layout/1.0',
    visualBaselineVersion: 'visual-baseline/1.0',
    logicalViewportSpace: { unit: 'css-logical-px', coordinateSpace: 'css-logical' },
    designResolutionPolicy: {
      portrait: { width: 1080, height: 1920, fitAxis: 'width' },
      landscape: { width: 1920, height: 1080, fitAxis: 'height' },
      canvasFit: 'fill-viewport',
      crossAxis: 'extend-or-crop',
      backgroundFit: { mode: 'cover-v1', sourceFocalPoint: { x: 0.5, y: 0.5 }, targetPoint: { x: 0.5, y: 0.5 } },
    },
    canvasBackingPolicy: { relation: 'logical-size-times-effective-dpr', rounding: 'round' },
    runtimeDprPolicy: { source: 'devicePixelRatio', dynamic: true, invalidFallback: 1, cap: 2, updatesOn: ['resize', 'orientation-change', 'display-density-change', 'same-page-resize'] },
    maxRuntimeDpr: 2,
    scaleMode: 'FIXED_WIDTH',
    cameraViewportPolicy: { coordinateSpace: 'css-logical-px', mapsTo: 'gameSize' },
    cameraZoomPolicy: { strategy: 'logical-viewport' },
    cameraOriginPolicy: { x: 0, y: 0, coordinateSpace: 'logical' },
    inputCoordinatePolicy: { from: 'css-client', to: 'logical-game', usesCamera: true },
    safeAreaPolicy: { source: 'environment-insets', coordinateSpace: 'css-logical-px' },
    resizePolicy: { samePage: true, recompute: ['css', 'backing', 'camera', 'input', 'safe-area'] },
    orientationPolicy: { allowed: ['portrait', 'landscape'], recomputeOnChange: true },
    textResolutionPolicy: { coordinateSpace: 'css-logical-px', noPhysicalPixelHardcode: true },
    assetResolutionPolicy: { productionDpr: IMAGE_PRODUCTION_DPR, runtimeDprIndependent: true },
    performanceBudget: {
      maxCanvasBackingWidth: 3840,
      maxCanvasBackingHeight: 2160,
      maxPixelCount: 8294400,
      renderTexturePixelBudget: 2000000,
      fullScreenFilterBudget: 2,
      transparentFullScreenLayerCount: 1,
      representativeDeviceResults: [{ device: 'representative', fps: 60 }],
      degradationPolicy: 'explicit-quality-tier-after-budget-failure',
    },
    representativeViewports: REPRESENTATIVE_VIEWPORT_KINDS.map((kind, index) => ({
      id: kind,
      kind,
      orientation: kind === 'landscape' || kind === 'desktop-wide' ? 'landscape' : 'portrait',
      logicalSize: { width: [320, 400, 800, 1440][index], height: [800, 800, 360, 900][index] },
      dprCoverage: REPRESENTATIVE_DPR_REQUIREMENTS,
    })),
    representativeDprs: REPRESENTATIVE_DPR_REQUIREMENTS,
    requiredRuntimeEvidence: [...RUNTIME_EVIDENCE_FIELDS, ...REPRESENTATIVE_DPR_REQUIREMENTS, ...REPRESENTATIVE_BEHAVIOR_REQUIREMENTS],
  };
}

/** 构造真实运行记录；测试只验证工作流几何和身份，不启动浏览器。 */
function makeEvidence(overrides = {}) {
  return {
    verificationStatus: 'verified',
    runtimeMeasured: true,
    measuredAt: '2026-09-20T00:00:00.000Z',
    viewportId: 'narrow-portrait',
    viewportRect: { width: 320, height: 800 },
    canvasRect: { width: 320, height: 800 },
    designTransform: calculateFixedDesignViewport({ width: 320, height: 800 }),
    logicalSize: { width: 320, height: 800 },
    backingSize: { width: 640, height: 1600 },
    cssDisplaySize: { width: 320, height: 800 },
    rawDevicePixelRatio: 2,
    effectiveDevicePixelRatio: 2,
    logicalToCssScale: 1,
    cssToPhysicalScale: 2,
    gameSize: { width: 320, height: 800 },
    cameraViewport: { width: 320, height: 800 },
    cameraZoom: 1,
    cameraOrigin: { x: 0, y: 0 },
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    edgeGaps: { top: 0, right: 0, bottom: 0, left: 0 },
    backgroundCoverage: { covered: true },
    keyUiRects: [{ id: 'play', x: 20, y: 20, width: 100, height: 48 }],
    inputHitResults: [{ id: 'play', logicalPoint: { x: 30, y: 30 }, hit: true }],
    resizeTrajectory: [{ event: 'same-page-resize' }, { event: 'orientation-change' }, { event: 'dpr-drop-to-1' }, { event: 'dpr-unchanged-resize' }],
    pageReloaded: false,
    screenshot: 'evidence/scene.png',
    sceneId: 'play',
    stateId: 'default',
    layoutContractVersion: 'layout/1.0',
    visualBaselineVersion: 'visual-baseline/1.0',
    matrixCases: [...REPRESENTATIVE_DPR_REQUIREMENTS, ...REPRESENTATIVE_BEHAVIOR_REQUIREMENTS],
    ...overrides,
  };
}

/** 按真实视口和 DPR 派生几何，避免用矩阵标签冒充测量覆盖。 */
function makeMeasuredEvidence(width, height, rawDpr, overrides = {}) {
  const effectiveDpr = normalizeRuntimeDpr(rawDpr);
  return makeEvidence({
    viewportRect: { width, height }, canvasRect: { width, height }, designTransform: calculateFixedDesignViewport({ width, height }), logicalSize: { width, height },
    cssDisplaySize: { width, height }, backingSize: { width: Math.ceil(width * effectiveDpr), height: Math.ceil(height * effectiveDpr) },
    rawDevicePixelRatio: rawDpr, effectiveDevicePixelRatio: effectiveDpr, cssToPhysicalScale: { x: effectiveDpr, y: effectiveDpr },
    gameSize: { width, height }, cameraViewport: { width, height },
    ...overrides,
  });
}

/** 单方向合同只冻结本方向设计基准、视口和 resize 行为。 */
function makeSingleOrientationContract(orientation) {
  const contract = makeContract();
  contract.orientationPolicy.allowed = [orientation];
  delete contract.designResolutionPolicy[orientation === 'portrait' ? 'landscape' : 'portrait'];
  contract.runtimeDprPolicy.updatesOn = ['resize', 'display-density-change', 'same-page-resize'];
  contract.requiredRuntimeEvidence = contract.requiredRuntimeEvidence.filter((item) => item !== 'orientation-change');
  contract.representativeViewports = orientation === 'portrait'
    ? [{ id: 'narrow', kind: 'narrow-portrait', logicalSize: { width: 320, height: 800 } }, { id: 'standard', kind: 'standard-portrait', logicalSize: { width: 390, height: 844 } }]
    : [{ id: 'landscape', kind: 'landscape', logicalSize: { width: 800, height: 360 } }, { id: 'desktop', kind: 'desktop-wide', logicalSize: { width: 1440, height: 900 } }];
  return contract;
}

/** 保持单页与方向不变，独立覆盖尺寸变化、DPR 降低和封顶。 */
function makeSingleOrientationMeasurements(orientation) {
  const sizes = orientation === 'portrait'
    ? [[320, 800], [390, 844], [400, 860], [420, 900], [430, 932]]
    : [[800, 360], [1024, 768], [1100, 800], [1200, 800], [1440, 900]];
  return sizes.map(([width, height], index) => makeMeasuredEvidence(width, height, [3, 1, 1, 1.5, 2][index], {
    contextId: 'same-page', samePageWithPrevious: index > 0,
    resizeTrajectory: [{ event: 'same-page-resize' }, { event: 'dpr-drop-to-1' }, { event: 'dpr-unchanged-resize' }],
  }));
}

test('单方向合同与 V4 证据无需另一方向设计、视口或切换轨迹', () => {
  for (const orientation of ['portrait', 'landscape']) {
    const contract = makeSingleOrientationContract(orientation);
    assert.deepEqual(validateResponsiveContract(contract), [], orientation);
    const records = makeSingleOrientationMeasurements(orientation);
    assert.deepEqual(validateResponsiveEvidenceManifest({ responsiveEvidence: records }, contract), [], orientation);
    assert.deepEqual(validateResponsiveEvidenceManifest({ responsiveEvidence: records }, contract, { requiredUnits: [{ unitType: 'SCENE', sceneId: 'play' }] }), [], orientation);
    const missingDpr = records.filter((record) => record.effectiveDevicePixelRatio !== 1.5);
    assert.match(validateResponsiveEvidenceManifest({ responsiveEvidence: missingDpr }, contract).join('\n'), /dpr-1.25-or-1.5/);
    const opposite = makeSingleOrientationMeasurements(orientation === 'portrait' ? 'landscape' : 'portrait')[0];
    assert.match(validateResponsiveEvidenceManifest({ responsiveEvidence: [...records, opposite] }, contract).join('\n'), /方向不在/);
  }
});

test('双方向声明继续要求另一方向和同页方向切换，非法方向不能缩小矩阵', () => {
  const contract = makeContract();
  const records = makeSingleOrientationMeasurements('portrait');
  assert.match(validateResponsiveEvidenceManifest({ responsiveEvidence: records }, contract).join('\n'), /landscape/);
  assert.match(validateResponsiveEvidenceManifest({ responsiveEvidence: records }, contract).join('\n'), /orientation-change/);
  const conflict = { ...makeSingleOrientationContract('portrait'), responsiveViewportContract: contract };
  assert.match(validateResponsiveEvidenceManifest({ responsiveEvidence: records }, conflict).join('\n'), /根级与嵌套 orientationPolicy.allowed 必须一致/);
  for (const allowed of [[], ['unknown'], ['portrait', 'portrait']]) {
    const invalid = makeSingleOrientationContract('portrait');
    invalid.orientationPolicy.allowed = allowed;
    assert.match(validateResponsiveContract(invalid).join('\n'), /orientationPolicy.allowed/);
    assert.match(validateResponsiveEvidenceManifest({ responsiveEvidence: records }, invalid).join('\n'), /orientationPolicy.allowed/);
  }
});

test('响应式合同覆盖 18 个字段、运行时 DPR 和 1:1 图片生产分离', () => {
  const contract = makeContract();
  assert.equal(RESPONSIVE_CONTRACT_FIELDS.length, 18);
  assert.deepEqual(validateResponsiveContract(contract, { stage: 'V1' }), []);
  assert.deepEqual(validateResponsiveContract({ ...contract, responsiveViewportContract: contract }, { stage: 'V1' }), []);
  const orientationConflict = { ...contract, orientationPolicy: { allowed: ['portrait'] }, responsiveViewportContract: contract };
  assert.match(validateResponsiveContract(orientationConflict).join('\n'), /根级与嵌套 orientationPolicy.allowed 必须一致/);
  const conflicting = { ...contract, designResolutionPolicy: structuredClone(contract.designResolutionPolicy), responsiveViewportContract: contract };
  conflicting.designResolutionPolicy.backgroundFit.targetPoint.x = 0.25;
  assert.match(validateResponsiveContract(conflicting, { stage: 'V1' }).join('\n'), /根级与嵌套 designResolutionPolicy 必须一致/);
  assert.equal(normalizeRuntimeDpr(undefined), 1);
  assert.equal(normalizeRuntimeDpr('2'), 1);
  assert.equal(normalizeRuntimeDpr(0), 1);
  assert.equal(normalizeRuntimeDpr(-1), 1);
  assert.equal(normalizeRuntimeDpr(3), 2);
  assert.deepEqual(computeCanvasBackingSize({ width: 320, height: 800 }, 1, 2), { width: 640, height: 1600 });
});

test('固定横竖屏设计基准、填满画布和背景 cover 必须符合合同', () => {
  const missing = makeContract();
  delete missing.designResolutionPolicy;
  assert.match(validateResponsiveContract(missing).join('\n'), /designResolutionPolicy/);

  const portrait = makeContract();
  portrait.designResolutionPolicy.portrait.fitAxis = 'height';
  assert.match(validateResponsiveContract(portrait).join('\n'), /portrait 必须为 1080×1920 且按 width 适配/);

  const landscape = makeContract();
  landscape.designResolutionPolicy.landscape.width = 1280;
  assert.match(validateResponsiveContract(landscape).join('\n'), /landscape 必须为 1920×1080 且按 height 适配/);

  const canvasBars = makeContract();
  canvasBars.designResolutionPolicy.canvasFit = 'fit';
  assert.match(validateResponsiveContract(canvasBars).join('\n'), /禁止画布黑边/);

  const scaleBars = makeContract();
  scaleBars.scaleMode = 'FIT';
  assert.match(validateResponsiveContract(scaleBars).join('\n'), /scaleMode 必须为 FIXED_WIDTH、FIXED_HEIGHT 或 custom；FIT 会产生黑边/);

  const unsupportedScale = makeContract();
  unsupportedScale.scaleMode = { mode: 'NONE' };
  assert.match(validateResponsiveContract(unsupportedScale).join('\n'), /scaleMode 必须为 FIXED_WIDTH、FIXED_HEIGHT 或 custom/);

  const backgroundBars = makeContract();
  backgroundBars.designResolutionPolicy.backgroundFit.mode = 'contain';
  assert.match(validateResponsiveContract(backgroundBars).join('\n'), /backgroundFit.mode 必须为 cover-v1/);
});

test('Work Item 与 Implementation Package 根级和嵌套响应式合同都要求设计分辨率策略', () => {
  for (const [label, schema] of [['Work Item', WORK_ITEM_SCHEMA], ['Implementation Package', IMPLEMENTATION_PACKAGE_SCHEMA]]) {
    assert.ok(schema.properties.designResolutionPolicy, `${label} 根属性应声明 designResolutionPolicy`);
    assert.ok(schema.allOf.some((rule) => rule.then?.required?.includes('designResolutionPolicy')), `${label} 根响应式合同应要求 designResolutionPolicy`);
    assert.ok(schema.$defs.responsiveViewportContract.required.includes('designResolutionPolicy'), `${label} 嵌套响应式合同应要求 designResolutionPolicy`);
    assert.ok(schema.$defs.responsiveViewportContract.properties.designResolutionPolicy, `${label} 嵌套响应式合同应声明 designResolutionPolicy`);
  }

  const nestedOnly = { responsiveViewportContract: makeContract() };
  assert.match(validateResponsiveContract(nestedOnly).join('\n'), /根字段必须声明 designResolutionPolicy/);

  const missingNestedPolicy = makeContract();
  delete missingNestedPolicy.designResolutionPolicy;
  assert.match(validateResponsiveContract({ ...makeContract(), responsiveViewportContract: missingNestedPolicy }).join('\n'), /嵌套 responsiveViewportContract 必须声明 designResolutionPolicy/);
});

test('合同拒绝缺失矩阵、DPR 上限和生产 DPR 混写', () => {
  const missing = makeContract();
  delete missing.representativeViewports;
  assert.match(validateResponsiveContract(missing).join('\n'), /representativeViewports/);

  const badCap = makeContract();
  badCap.maxRuntimeDpr = 3;
  assert.match(validateResponsiveContract(badCap).join('\n'), /maxRuntimeDpr/);

  for (const productionDpr of [1.5, 2]) {
    const mixed = makeContract();
    mixed.assetResolutionPolicy.productionDpr = productionDpr;
    assert.match(validateResponsiveContract(mixed).join('\n'), /生产 DPR/, `旧或非整数图片生产倍率不得放行：${productionDpr}`);
  }

  for (const shorthand of ['12', '1.25', '2.5', 'productionDpr=3']) {
    const unstructured = makeContract();
    unstructured.assetResolutionPolicy = shorthand;
    assert.match(validateResponsiveContract(unstructured).join('\n'), /生产 DPR/, `未结构化生产声明不得放行：${shorthand}`);
  }
});

test('V4 证据验证 CSS/backing、动态 DPR 和实测矩阵', () => {
  const contract = makeContract();
  const evidence = makeEvidence();
  assert.deepEqual(validateResponsiveEvidenceRecord(evidence, contract), []);
  const wrongAxis = makeEvidence({ designTransform: { ...evidence.designTransform, scale: 800 / 1920 } });
  assert.match(validateResponsiveEvidenceRecord(wrongAxis, contract).join('\n'), /designTransform.scale/);
  const bars = makeEvidence({ canvasRect: { x: 0, y: 25, width: 320, height: 775 } });
  assert.match(validateResponsiveEvidenceRecord(bars, contract).join('\n'), /Canvas 必须填满真实 CSS 视口/);
  const cssBars = makeEvidence({ cssDisplaySize: { width: 300, height: 800 } });
  assert.match(validateResponsiveEvidenceRecord(cssBars, contract).join('\n'), /CSS 显示尺寸必须填满真实视口/);
  const matrix = [
    makeMeasuredEvidence(360, 800, 1.5, { contextId: 'page-a' }),
    makeMeasuredEvidence(390, 844, 1, { contextId: 'page-a', samePageWithPrevious: true }),
    makeMeasuredEvidence(844, 390, 1, { contextId: 'page-a', samePageWithPrevious: true }),
    makeMeasuredEvidence(1366, 768, 2, { contextId: 'page-b' }),
    makeMeasuredEvidence(1280, 720, 3, { contextId: 'page-b', samePageWithPrevious: true }),
  ];
  assert.deepEqual(validateResponsiveEvidenceManifest({ responsiveEvidence: matrix }, contract, { requiredUnits: [{ unitType: 'SCENE', sceneId: 'play' }] }), []);

  const borrowedMatrix = [...matrix, makeMeasuredEvidence(390, 844, 1, { sceneId: 'secondary', contextId: 'secondary-page' })];
  assert.match(validateResponsiveEvidenceManifest({ responsiveEvidence: borrowedMatrix }, contract, { requiredUnits: [{ unitType: 'SCENE', sceneId: 'play' }, { unitType: 'SCENE', sceneId: 'secondary' }] }).join('\n'), /secondary.*narrow-portrait|secondary.*代表性/);

  const labelsOnly = [evidence, { ...evidence, viewportId: 'standard-portrait' }, { ...evidence, viewportId: 'landscape' }, { ...evidence, viewportId: 'desktop-wide' }];
  assert.match(validateResponsiveEvidenceManifest({ responsiveEvidence: labelsOnly }, contract).join('\n'), /standard-portrait|landscape|DPR|dpr-/i);

  const badDpr = { ...evidence, rawDevicePixelRatio: '2' };
  assert.match(validateResponsiveEvidenceRecord(badDpr, contract).join('\n'), /rawDevicePixelRatio/);
  const badBacking = { ...evidence, backingSize: { width: 641, height: 1600 } };
  assert.match(validateResponsiveEvidenceRecord(badBacking, contract).join('\n'), /backing/);
  for (const candidateSha256 of [undefined, 'sha256:stale']) {
    const withoutCurrentDigest = { ...evidence, candidateSha256 };
    assert.deepEqual(validateResponsiveEvidenceRecord(withoutCurrentDigest, contract), []);
  }
  const unverified = { ...evidence, verificationStatus: 'unverified', runtimeMeasured: false };
  assert.match(validateResponsiveEvidenceRecord(unverified, contract).join('\n'), /verified\/PASS/);
  assert.match(validateResponsiveEvidenceRecord({ ...evidence, verificationStatus: 'fail' }, contract).join('\n'), /verified\/PASS/);
  assert.match(validateResponsiveEvidenceRecord({ ...evidence, inputHitResults: [{ id: 'play', hit: false }] }, contract).join('\n'), /inputHitResults/);
  assert.match(validateResponsiveEvidenceRecord({ ...evidence, backgroundCoverage: { covered: false } }, contract).join('\n'), /完整覆盖/);
  assert.match(validateResponsiveEvidenceRecord({ ...evidence, layoutContractVersion: 'layout/old' }, contract).join('\n'), /layoutContractVersion/);
  assert.match(validateResponsiveEvidenceRecord({ ...evidence, visualBaselineVersion: 'visual-baseline/old' }, contract).join('\n'), /visualBaselineVersion/);

  const fractional = makeMeasuredEvidence(390.2, 844.2, 1.5, { backingSize: { width: 586, height: 1267 }, cssToPhysicalScale: { x: 586 / 390.2, y: 1267 / 844.2 } });
  assert.deepEqual(validateResponsiveEvidenceRecord(fractional, { ...contract, canvasBackingPolicy: { ...contract.canvasBackingPolicy, rounding: 'ceil' } }), []);
});

test('DISPLAY_LAYER 必须有自己的宿主同屏和 open/interact/close/restore 轨迹', () => {
  const display = makeEvidence({ displayLayerId: 'pause', hostSceneId: 'play', hostSceneState: 'default', resizeTrajectory: [{ event: 'open' }, { event: 'interact' }, { event: 'same-page-resize' }, { event: 'close' }, { event: 'restore' }] });
  assert.deepEqual(validateResponsiveEvidenceRecord(display, makeContract(), { unitType: 'DISPLAY_LAYER' }), []);
  const missingRestore = { ...display, resizeTrajectory: [{ event: 'open' }, { event: 'interact' }, { event: 'close' }] };
  assert.match(validateResponsiveEvidenceRecord(missingRestore, makeContract(), { unitType: 'DISPLAY_LAYER' }).join('\n'), /restore/);
});
