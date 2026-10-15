/** 工作流放宽后的关键回归用例；由主测试文件注入既有夹具，避免测试注册文件继续膨胀。 */

import { readdirSync } from 'node:fs';

const DIGEST_TOKENS = new Set(['sha1', 'sha256', 'hash', 'hashes', 'fingerprint', 'fingerprints']);

/** 使用完整字段 token 识别摘要名，避免误伤 share_id、shadow 等业务字段。 */
function isDigestField(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).some((token) => DIGEST_TOKENS.has(token));
}

/** 校验回归样例用到的 JSON Schema 子集，实际执行 oneOf、not 与对象字段约束。 */
function matchesSchema(value, schema) {
  if (!schema || typeof schema !== 'object') return true;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const matchesType = (type) => type === 'object' ? Boolean(value && typeof value === 'object' && !Array.isArray(value))
    : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isInteger(value)
      : type === 'number' ? typeof value === 'number' : type === 'null' ? value === null : typeof value === type;
  if (types.length && !types.some(matchesType)) return false;
  if (Object.hasOwn(schema, 'const') && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (Array.isArray(schema.required) && (!value || typeof value !== 'object' || schema.required.some((key) => !Object.hasOwn(value, key)))) return false;
  if (schema.minLength !== undefined && (typeof value !== 'string' || value.length < schema.minLength)) return false;
  if (schema.minProperties !== undefined && (!value || typeof value !== 'object' || Object.keys(value).length < schema.minProperties)) return false;
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(schema.properties)) if (Object.hasOwn(value, key) && !matchesSchema(value[key], child)) return false;
  }
  if (schema.additionalProperties === false && value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).some((key) => !Object.hasOwn(schema.properties ?? {}, key))) return false;
  if (schema.allOf && !schema.allOf.every((child) => matchesSchema(value, child))) return false;
  if (schema.anyOf && !schema.anyOf.some((child) => matchesSchema(value, child))) return false;
  if (schema.oneOf && schema.oneOf.filter((child) => matchesSchema(value, child)).length !== 1) return false;
  if (schema.not && matchesSchema(value, schema.not)) return false;
  return true;
}

/** 确认所有 schema 都不再以摘要必填或格式验证作为验收门。 */
function assertDigestConstraintsRemoved(schema, assert, label) {
  const visit = (value, path = label) => {
    if (Array.isArray(value)) return value.forEach((child, index) => visit(child, `${path}[${index}]`));
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value.required)) assert.ok(value.required.every((field) => !isDigestField(field)), `${path}.required 不应要求摘要`);
    if (value.not && Array.isArray(value.not.required)) assert.ok(value.not.required.length > 0, `${path}.not 不应因空 required 拒绝所有内容`);
    for (const key of ['properties', '$defs', 'definitions']) {
      for (const [field, child] of Object.entries(value[key] ?? {})) {
        if (isDigestField(field)) assert.deepEqual(Object.keys(child).sort(), ['description'], `${path}.${key}.${field} 仅保留说明，不验证摘要值`);
      }
    }
    for (const key of ['dependentRequired', 'dependentSchemas', 'dependencies']) {
      assert.ok(Object.keys(value[key] ?? {}).every((field) => !isDigestField(field)), `${path}.${key} 不应由摘要字段触发依赖门`);
      if (key === 'dependentRequired' || key === 'dependencies') {
        for (const [field, dependencies] of Object.entries(value[key] ?? {})) {
          if (Array.isArray(dependencies)) assert.ok(dependencies.every((dependency) => !isDigestField(dependency)), `${path}.${key}.${field} 不应要求摘要`);
        }
      }
    }
    for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
  };
  visit(schema);
}

/** 注册普通 Work Item、具体副作用和说明字段的回归测试。 */
export function registerRelaxedWorkflowTests({
  assert,
  test,
  setup,
  makeFoundationPackage,
  makePackage,
  writeBoundPackage,
  run,
  rejects,
  readFileSync,
  writeJson,
  join,
  rmSync,
  existsSync,
  makeEvidence,
  hash,
  prepareParallelFixture,
  writeUnitResults,
  makeParallelBatch,
  makeDelegation,
}) {
  test('摘要字段：全部 schema 无摘要硬门，非摘要业务结构仍保持校验', () => {
    const schemaDirectory = new URL('../references/', import.meta.url);
    const schemaFiles = readdirSync(schemaDirectory).filter((file) => file.endsWith('.schema.json'));
    // 按实际文件全量检查；新增领域合同不应因固定数量断言被误判为回归。
    assert.ok(schemaFiles.includes('work-item.schema.json') && schemaFiles.includes('implementation-package.schema.json'), '关键控制合同必须参与覆盖');
    for (const file of schemaFiles) assertDigestConstraintsRemoved(JSON.parse(readFileSync(new URL(file, schemaDirectory), 'utf8')), assert, file);

    const schema = JSON.parse(readFileSync(new URL('../references/implementation-package.schema.json', import.meta.url), 'utf8'));
    const outputPath = schema.$defs.visualOutputPaths.items;
    assert.equal(matchesSchema({ file: 'a.png' }, outputPath), true, '合法 file 输出路径对象应通过 oneOf/not');
    assert.equal(matchesSchema({ file: 'a.png', share_id: 17 }, outputPath), false, 'share_id 仍须为非空字符串');
    assert.equal(matchesSchema({ file: 'a.png', share_id: 'a', shareId: 'b' }, outputPath), false, 'share_id 与 shareId 的互斥约束应保留');
    assert.equal(matchesSchema(17, schema.$defs.visualExpectedAsset.properties.share_id), false, 'visualExpectedAsset.share_id 仍受类型约束');
    assert.ok(schema.$defs.textTypographyTarget.required.includes('shadow'), 'Typography 必须保留 shadow 规范');
    assert.equal(matchesSchema(17, schema.$defs.textTypographyTarget.properties.shadow), false, 'shadow 仍受值结构约束');
    assert.ok(schema.$defs.sceneCoverageRegion.required.includes('lighting_shadow_facts'), '场景覆盖必须保留光影事实字段');
    assert.equal(matchesSchema({}, schema.$defs.sceneCoverageRegion.properties.lighting_shadow_facts), false, '光影事实仍须为非空对象');
  });

  test('并行批次：摘要缺失、陈旧或类型错误不阻断，委派归属与派生分配仍校验', () => {
    // 仅保留两个已激活的同组单元，让并行入口测试聚焦批次摘要而不推进执行状态。
    let item = prepareParallelFixture('IMPLEMENTING', true);
    const delegationPath = join(item.f.root, 'delegations', 'm.json'); const changed = JSON.parse(readFileSync(delegationPath, 'utf8')); changed.completionBoundary = '批次后变化'; writeJson(delegationPath, changed);
    let result = run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo);
    assert.equal(result.status, 0, result.stderr);

    item = prepareParallelFixture('IMPLEMENTING', true); let batch = JSON.parse(readFileSync(item.batchPath, 'utf8'));
    batch.baselineHash = { stale: true }; batch.delegationHashes = 'invalid-map'; batch.fingerprint = 17; writeJson(item.batchPath, batch);
    result = run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo);
    assert.equal(result.status, 0, result.stderr);

    item = prepareParallelFixture('IMPLEMENTING', true); batch = JSON.parse(readFileSync(item.batchPath, 'utf8'));
    delete batch.baselineHash; delete batch.delegationHashes; delete batch.fingerprint; writeJson(item.batchPath, batch);
    result = run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo);
    assert.equal(result.status, 0, result.stderr);

    item = prepareParallelFixture('IMPLEMENTING', true); batch = JSON.parse(readFileSync(item.batchPath, 'utf8')); batch.executionUnitIds = ['MODULE-1', 'UNKNOWN']; batch.assignedAgents = ['fake-agent', 'module-agent']; writeJson(item.batchPath, batch);
    rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /与委派内容不一致/);

    item = prepareParallelFixture('IMPLEMENTING', true); const historyPath = join(item.f.root, 'delegations', 'batches', 'history.json'); batch = makeParallelBatch(item.f.repo, ['.workflow-control/delegations/m.json', '.workflow-control/delegations/m2.json'], { batchId: 'PB-HISTORY' }); batch.assignedAgents[0] = 'tampered-agent'; writeJson(historyPath, batch);
    rejects(run('parallel-check', ['--work-item', item.f.workPath, '--implementation-package', item.f.packagePath, '--batch', item.batchPath], item.f.repo), /历史并行批次损坏/);
  });

  test('普通任务：没有独立授权对象也能完成 Work Item、Diff Audit 和 Evidence 闭环', () => {
    const f = setup({ globalState: 'REVIEW', visualStage: 'V0', visualStageState: 'not-started', pendingApprovalState: 'REVIEW', pendingApprovalActionLevel: 'A1', pendingApprovalActionType: 'cocos-spec-candidate', pendingApprovalFileScope: ['docs'] }, [], makeFoundationPackage);
    const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
    const pkg = JSON.parse(readFileSync(f.packagePath, 'utf8'));
    assert.equal(Object.hasOwn(work, 'taskAuthorization'), false);
    assert.equal(Object.hasOwn(pkg, 'taskAuthorizationId'), false);
    const record = join(f.root, 'evidence', 'WI-1', 'ordinary-audit.json');
    const audited = run('diff-audit', ['--work-item', f.workPath, '--baseline', f.head, '--baseline-hash', hash, '--action-level', 'A1', '--action-type', 'cocos-spec-candidate', '--artifact', 'docs/spec.md', '--record', record], f.repo);
    assert.equal(audited.status, 0, audited.stderr);
    const audit = JSON.parse(audited.stdout);
    assert.equal(Object.hasOwn(audit, 'authorizationId'), false);
    assert.equal(audit.workItemId, 'WI-1');
    assert.equal(audit.authorizationBasis, 'TASK_SCOPE');
    const evidencePath = join(f.root, 'evidence', 'WI-1', 'ordinary-evidence.json');
    writeJson(evidencePath, makeEvidence(f, audit));
    assert.equal(run('advance', ['--work-item', f.workPath], f.repo).status, 0);
    assert.equal(run('advance', ['--work-item', f.workPath, '--evidence', evidencePath], f.repo).status, 0);
    assert.equal(run('advance', ['--work-item', f.workPath, '--evidence', evidencePath], f.repo).status, 0);
    assert.equal(JSON.parse(readFileSync(f.workPath, 'utf8')).globalState, 'COMPLETE');
  });

  test('A4：普通本地集成直接按 Work Item 范围通过，声明 destructive 仍需精确批准', () => {
    const ordinary = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A4', pendingApprovalActionType: 'cocos-integration', pendingApprovalState: 'INTEGRATING', pendingApprovalContext: 'local-integration', pendingApprovalFileScope: ['src/main.js'], pendingApprovalImpactSummary: [] });
    const ordinaryResult = run('preflight', ['--work-item', ordinary.workPath, '--implementation-package', ordinary.packagePath, '--action-level', 'A4', '--action-type', 'cocos-integration', '--path', 'src/main.js'], ordinary.repo);
    assert.equal(ordinaryResult.status, 0, ordinaryResult.stderr);
    assert.equal(JSON.parse(ordinaryResult.stdout).authorizationBasis, 'TASK_SCOPE');
    assert.equal(JSON.parse(ordinaryResult.stdout).explicitApprovalRequired, false);

    const destructive = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A4', pendingApprovalActionType: 'cocos-integration', pendingApprovalState: 'INTEGRATING', pendingApprovalContext: 'destructive-integration', pendingApprovalFileScope: ['src/main.js'], pendingApprovalImpactSummary: ['删除旧实现'], pendingApprovalDestructive: true });
    rejects(run('preflight', ['--work-item', destructive.workPath, '--ledger', destructive.ledgerPath, '--implementation-package', destructive.packagePath, '--action-level', 'A4', '--action-type', 'cocos-integration', '--path', 'src/main.js', '--destructive'], destructive.repo), /没有唯一|审批/);
    assert.deepEqual(JSON.parse(readFileSync(destructive.ledgerPath, 'utf8')).approvals, []);
  });

  test('高风险审批：账本可在确认时按需创建', () => {
    const f = setup({ globalState: 'PASSED' });
    rmSync(f.ledgerPath);
    const args = ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--pending-id', 'PENDING-ON-DEMAND', '--object', 'replace entry', '--stage', 'G1', '--action-type', 'cocos-integration', '--action-level', 'A4', '--gate', 'F4', '--context', 'destructive integration', '--path', 'src', '--impact', '破坏性替换集成入口', '--destructive'];
    const prepared = run('prepare-approval', args, f.repo);
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.equal(existsSync(f.ledgerPath), false);
    assert.equal(run('handoff', ['--work-item', f.workPath], f.repo).status, 0);
    const approved = run('approve', ['--work-item', f.workPath, '--ledger', f.ledgerPath, '--approval-id', 'AP-ON-DEMAND', '--user-text', '批准'], f.repo);
    assert.equal(approved.status, 0, approved.stderr);
    assert.equal(JSON.parse(readFileSync(f.ledgerPath, 'utf8')).approvals[0].approvalId, 'AP-ON-DEMAND');
  });

  test('说明性范围字段缺失时默认空数组，关键 Work Item 字段仍拒绝', () => {
    const f = setup();
    const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
    delete work.outOfScope;
    writeJson(f.workPath, work);
    const pkg = JSON.parse(readFileSync(f.packagePath, 'utf8'));
    delete pkg.outOfScope;
    delete pkg.stopConditions;
    writeJson(f.packagePath, pkg);
    const args = ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A3', '--action-type', 'cocos-code-change', '--path', 'src/main.js'];
    assert.equal(run('preflight', args, f.repo).status, 0);

    delete work.objective;
    writeJson(f.workPath, work);
    rejects(run('status', ['--work-item', f.workPath], f.repo), /缺少字段.*objective/);
  });

  test('A4：普通可恢复删除无需批准，命中禁止路径仍拒绝', () => {
    const deletionPackage = makePackage({ expectedDeletedFiles: ['src/old.js'] });
    deletionPackage.fileOwnership['src/old.js'] = 'implementer';
    deletionPackage.executionUnits.find((unit) => unit.unitId === 'SHARED-1').ownedPaths.push('src/old.js');
    const f = setup({ globalState: 'INTEGRATING', pendingApprovalActionLevel: 'A4', pendingApprovalActionType: 'cocos-integration', pendingApprovalState: 'INTEGRATING', pendingApprovalContext: 'local-cleanup', pendingApprovalFileScope: ['src/old.js'], pendingApprovalImpactSummary: [] });
    writeBoundPackage(f, deletionPackage);
    const allowedDelete = run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A4', '--action-type', 'cocos-integration', '--path', 'src/old.js', '--delete'], f.repo);
    assert.equal(allowedDelete.status, 0, allowedDelete.stderr);
    assert.equal(JSON.parse(allowedDelete.stdout).explicitApprovalRequired, false);
    const work = JSON.parse(readFileSync(f.workPath, 'utf8'));
    work.pendingApprovalFileScope = ['src/secret']; writeJson(f.workPath, work);
    rejects(run('preflight', ['--work-item', f.workPath, '--implementation-package', f.packagePath, '--action-level', 'A4', '--action-type', 'cocos-integration', '--path', 'src/secret', '--delete'], f.repo), /forbiddenPaths/);
  });

  test('委派门：Work Item 范围直接绑定，未登记代理仍拒绝', () => {
    const f = setup({ delegatedAgents: ['implementer'] });
    // 选择初始已激活的 SHARED 单元，令本测试只覆盖 Work Item 绑定和代理登记，不混入前序单元 READY 门。
    const delegation = { workItemId: 'WI-1', stageId: 'G1', owner: 'orchestrator', assignedAgent: 'implementer', executionUnitIds: ['SHARED-1'], parallelGroup: null, ownership: ['src/main.js'], allowedActions: ['cocos-code-change'], forbiddenActions: [], actionLevel: 'A3', allowedPaths: ['src/main.js'], forbiddenPaths: ['.git', 'src/secret'], acceptanceCommands: ['node --test'], completionBoundary: '完成返回', outOfScopeReturn: '越界返回', preserveOthersChanges: true };
    const path = join(f.root, 'delegations', 'worker.json'); writeJson(path, delegation);
    const valid = run('delegate-check', ['--work-item', f.workPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo);
    assert.equal(valid.status, 0, valid.stderr);
    delegation.assignedAgent = 'unregistered'; writeJson(path, delegation);
    rejects(run('delegate-check', ['--work-item', f.workPath, '--delegation', path, '--implementation-package', f.packagePath], f.repo), /未登记/);
  });
}
