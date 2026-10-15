import { createHash } from 'node:crypto';
import { schemaRequired } from './runtime/schema-contract.mjs';

/** 并行批次允许的严格字段。 */
const BATCH_FIELDS = ['batchId', 'workItemId', 'packageId', 'baselineHash', 'parallelGroup', 'delegationFiles', 'delegationHashes', 'executionUnitIds', 'assignedAgents', 'createdAt', 'fingerprint'];
const BATCH_REQUIRED_FIELDS = schemaRequired('parallel-delegation-batch.schema.json');

/** 稳定序列化批次不可变字段。 */
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** 计算原子并行批次不可变指纹。 */
export function parallelBatchFingerprint(batch) {
  const immutable = Object.fromEntries(BATCH_FIELDS.filter((field) => field !== 'fingerprint').map((field) => [field, batch[field]]));
  return `sha256:${createHash('sha256').update(stableJson(immutable)).digest('hex')}`;
}

/** 校验批次身份与当前委派内容；摘要字段只保留为可选记录。 */
function validateBatchEnvelope(batch, batchPath, work, pkg, repo, io, bindCurrent = true) {
  if (!batch || typeof batch !== 'object' || Array.isArray(batch)) throw new Error('Parallel Delegation Batch 必须为对象');
  const missing = BATCH_REQUIRED_FIELDS.filter((field) => batch[field] === undefined);
  const extra = Object.keys(batch).filter((field) => !BATCH_FIELDS.includes(field));
  if (missing.length || extra.length) throw new Error(`Parallel Delegation Batch 字段不严格：缺少 ${missing.join('、') || '无'}；多余 ${extra.join('、') || '无'}`);
  if (!batch.batchId || !batch.workItemId || !batch.packageId || !batch.parallelGroup || Number.isNaN(Date.parse(batch.createdAt))) throw new Error('Parallel Delegation Batch 工作项、实施包、并行组或时间无效');
  // 摘要字段只供追踪；验收仍检查真实委派文件、归属、命令和执行顺序。
  if (bindCurrent && (batch.workItemId !== work.workItemId || batch.packageId !== pkg.packageId)) throw new Error('Parallel Delegation Batch 未绑定当前工作项或实施包');
  for (const field of ['delegationFiles', 'executionUnitIds', 'assignedAgents']) {
    const values = batch[field];
    if (!Array.isArray(values) || values.length < 2 || new Set(values).size !== values.length || values.some((value) => typeof value !== 'string' || !value) || JSON.stringify(values) !== JSON.stringify([...values].sort())) throw new Error(`Parallel Delegation Batch.${field} 必须为至少两个已排序唯一字符串`);
  }
  for (const path of batch.delegationFiles) {
    const normalized = io.normalizeRepoPath(repo, io.resolve(repo, path));
    if (!normalized.startsWith('.workflow-control/delegations/') || normalized.startsWith('.workflow-control/delegations/batches/')) throw new Error(`并行委派文件路径无效：${path}`);
  }
  const relativeBatch = io.normalizeRepoPath(repo, batchPath);
  if (!relativeBatch.startsWith('.workflow-control/delegations/batches/')) throw new Error('Parallel Delegation Batch 必须保存在 .workflow-control/delegations/batches/');
}

/** 校验原子并行委派批次及其全部委派。 */
export function validateParallelBatch(batch, batchPath, work, pkg, repo, io) {
  if (work.globalState !== 'IMPLEMENTING') throw new Error('A3 parallel-check 仅允许 IMPLEMENTING 状态');
  validateBatchEnvelope(batch, batchPath, work, pkg, repo, io);
  const batchesRoot = '.workflow-control/delegations/batches';

  // 委派文件可能在过程中修订；每次验收都重新读取并校验当前归属、命令和动作范围。
  const delegations = batch.delegationFiles.map((path) => {
    const normalized = io.normalizeRepoPath(repo, io.resolve(repo, path));
    const target = io.resolve(repo, normalized);
    if (!io.existsSync(target)) throw new Error(`并行委派文件不存在：${path}`);
    return io.validateDelegation(io.readJson(target, 'Delegation Package'));
  });
  const derivedUnits = [...new Set(delegations.flatMap((delegation) => delegation.executionUnitIds ?? []))].sort();
  const derivedAgents = [...new Set(delegations.map((delegation) => delegation.assignedAgent))].sort();
  if (JSON.stringify(derivedUnits) !== JSON.stringify(batch.executionUnitIds) || JSON.stringify(derivedAgents) !== JSON.stringify(batch.assignedAgents)) throw new Error('并行批次 executionUnitIds/assignedAgents 与委派内容不一致');
  const agents = new Set(); const assignedUnits = new Set();
  const readyUnits = [];
  for (const delegation of delegations) {
    io.validateDelegationForWork(delegation, work, repo);
    if (delegation.actionLevel !== 'A3' || delegation.parallelGroup !== batch.parallelGroup) throw new Error('并行批次委派必须全部为同一非空组的 A3');
    const binding = io.validateDelegationBinding(delegation, pkg);
    for (const unit of binding.units) {
      if (assignedUnits.has(unit.unitId)) throw new Error(`并行批次重复分配 execution unit：${unit.unitId}`);
      assignedUnits.add(unit.unitId);
      readyUnits.push(unit);
    }
    if (agents.has(delegation.assignedAgent)) throw new Error(`并行批次代理身份重复：${delegation.assignedAgent}`);
    agents.add(delegation.assignedAgent);
  }
  const groupUnits = pkg.executionUnits.filter((unit) => unit.parallelGroup === batch.parallelGroup).map((unit) => unit.unitId).sort();
  if (groupUnits.length < 2 || JSON.stringify(groupUnits) !== JSON.stringify([...assignedUnits].sort())) throw new Error('并行批次遗漏或额外分配并行组 execution unit');

  const root = io.resolve(repo, batchesRoot);
  for (const name of io.existsSync(root) ? io.readdirSync(root).filter((item) => item.endsWith('.json')) : []) {
    const historyPath = io.resolve(root, name);
    if (io.resolve(historyPath) === io.resolve(batchPath)) continue;
    let history;
    try { history = JSON.parse(io.readFileSync(historyPath, 'utf8')); } catch { continue; }
    try { validateBatchEnvelope(history, historyPath, work, pkg, repo, io, false); } catch (error) { throw new Error(`历史并行批次损坏：${name}：${error.message}`); }
    if (history.packageId !== pkg.packageId) continue;
    const duplicated = history.executionUnitIds.filter((unitId) => assignedUnits.has(unitId));
    if (duplicated.length) throw new Error(`execution unit 已存在历史并行批次分配：${duplicated.join('、')}`);
  }
  // 当前委派身份、范围和历史分配复核通过后才检查预设顺序，避免摘要漂移使有效任务失效。
  for (const unit of readyUnits) io.assertUnitReady(unit, work, pkg, repo);
  return { batchId: batch.batchId, parallelGroup: batch.parallelGroup, executionUnitIds: [...assignedUnits].sort() };
}
