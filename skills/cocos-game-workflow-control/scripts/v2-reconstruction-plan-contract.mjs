/** 标准 V2 冻结方案唯一允许的根字段，供阶段门与高保真前置门共用。 */
export const V2_PLAN_FIELDS = Object.freeze([
  'schemaVersion', 'workItemId', 'status', 'stage', 'frozen', 'sceneId',
  'sceneMaster', 'sceneReconstructionContract', 'decompositionAnnotation', 'technicalDecomposition',
  'visualDecompositionConfirmation', 'visualProductionContract', 'visualProductionUnits', 'displayLayerContexts',
]);
