import { resolve } from 'node:path';

/** 生成可复算的完整输入身份，嵌套对象按键排序但保留数组顺序。 */
function stableIdentity(value) {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableIdentity).join(',')}]`;
  if (typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableIdentity(value[key])}`).join(',')}}`;
  if (typeof value === 'number' && Number.isNaN(value)) return 'number:NaN';
  return `${typeof value}:${JSON.stringify(value)}`;
}

/**
 * 单次控制命令的只读校验上下文。
 * 同一命令内共享 JSON、Implementation Package、manifest、authority 和已校验 Work Item，
 * 但提交后的 Work Item 会通过 replaceJson 明确更新，避免复用旧快照。
 */
export class ValidationContext {
  constructor(repo, deps) {
    this.repo = resolve(String(repo));
    this.deps = deps;
    this.cache = new Map();
  }

  /** 将工件引用固定解析到当前仓库，避免 Work Item 内的相对路径受进程 cwd 影响。 */
  resolvePath(path) {
    return resolve(this.repo, String(path));
  }

  /** 按绝对路径缓存一次 JSON 读取；事务恢复仍由底层 readJson 在首次读取时负责。 */
  readJson(path, label) {
    const target = this.resolvePath(path);
    const key = `json:${target}`;
    if (!this.cache.has(key)) this.cache.set(key, this.deps.readJson(target, label));
    return this.cache.get(key);
  }

  /** 缓存 Work Item 的结构校验结果，避免 run 的 after inspect 重复遍历完整合同。 */
  validateWorkItem(path, label = 'Work Item') {
    if (!path || path === true) return this.deps.validateWorkItem(this.readJson(path, label));
    const target = this.resolvePath(path);
    const key = `work:${target}`;
    if (!this.cache.has(key)) this.cache.set(key, this.deps.validateWorkItem(this.readJson(target, label)));
    return this.cache.get(key);
  }

  /** 在原子写入成功后替换内存快照；validated=true 表示调用方已完成本次结构校验。 */
  replaceJson(path, value, { validated = false } = {}) {
    const target = this.resolvePath(path);
    this.cache.set(`json:${target}`, value);
    this.cache.delete(`work:${target}`);
    this.clearDerivedValidationCaches();
    if (validated) this.cache.set(`work:${target}`, value);
    return value;
  }

  /** 丢弃单个路径及其已派生校验缓存，供外部修改检测或重试前重新读取。 */
  invalidate(path) {
    const target = this.resolvePath(path);
    for (const key of this.cache.keys()) if (key.endsWith(`:${target}`) || key.includes(`:${target}:`)) this.cache.delete(key);
    this.clearDerivedValidationCaches();
  }

  /** 清除依赖 Work Item、Implementation Package 或 manifest 的派生结果，避免写入后误用旧校验。 */
  clearDerivedValidationCaches() {
    for (const key of this.cache.keys()) if (key.startsWith('manifest:') || key.startsWith('authority:') || key.startsWith('package:')) this.cache.delete(key);
  }

  /** 读取当前命令的审批账本；未提供账本时只返回稳定的空账本。 */
  readLedger(path, options = {}) {
    if (!path || path === true) {
      if (options.required === true) return this.deps.readLedger(path);
      return { schemaVersion: '1.0', approvals: [] };
    }
    const target = this.resolvePath(path);
    const key = `ledger:${target}`;
    if (!this.cache.has(key)) this.cache.set(key, this.deps.readLedger(target));
    return this.cache.get(key);
  }

  /** 读取并缓存实施包绑定的 manifest 快照，确保 bytes、SHA 和解析结果成组复用。 */
  loadVisualManifestSnapshot(pkg) {
    if (!pkg || (pkg.visualProductionUnits === undefined && pkg.visualManifestFile === undefined)) return null;
    const key = `manifest:${resolve(this.repo, String(pkg.visualManifestFile ?? ''))}:${pkg.visualManifestSha256 ?? ''}`;
    if (!this.cache.has(key)) this.cache.set(key, this.deps.loadVisualManifestSnapshot(pkg, this.repo));
    return this.cache.get(key);
  }

  /** 缓存当前 Work Item、实施包及其拆解委派对应的 immutable authority。 */
  authorityFor(pkg, work, delegations = [], manifestSnapshot = this.loadVisualManifestSnapshot(pkg)) {
    if (!this.deps.visualConfirmationAuthority || !pkg || !work) return null;
    // authority 会读取完整合同内容；只拼接少量 ID 会在范围或包字段变化时误命中旧结论。
    const identity = stableIdentity({ repo: this.repo, work, pkg, delegations, manifestSnapshot });
    const key = `authority:${identity}`;
    if (!this.cache.has(key)) {
      this.cache.set(key, this.deps.visualConfirmationAuthority(work, manifestSnapshot?.manifest ?? null, {
        projectRoot: this.repo,
        checkFiles: true,
        implementationPackage: pkg,
        delegations,
      }));
    }
    return this.cache.get(key);
  }

  /** 校验并缓存实施包；manifest 和 authority 都从同一上下文派生，避免重复合同遍历。 */
  validateImplementationPackage(pkg, work, delegations = []) {
    // 包校验依赖完整 Work Item、包和委派内容，任何范围或执行计划变化都必须重验。
    const packageKey = `package:${stableIdentity({ repo: this.repo, work, pkg, delegations })}`;
    if (!this.cache.has(packageKey)) {
      const manifestSnapshot = this.loadVisualManifestSnapshot(pkg);
      const authority = this.authorityFor(pkg, work, delegations, manifestSnapshot);
      this.cache.set(packageKey, this.deps.validateImplementationPackage(pkg, work, this.repo, delegations, { manifestSnapshot, authority, validationContext: this }));
    }
    return this.cache.get(packageKey);
  }

  /** 缓存单次命令读取的 Evidence Manifest。 */
  readEvidence(path) {
    return this.readJson(path, 'Evidence Manifest');
  }

  /** 返回上下文中已缓存的 manifest 内容，阶段门直接消费同一解析对象。 */
  manifestFor(pkg) {
    return this.loadVisualManifestSnapshot(pkg)?.manifest ?? null;
  }
}

/** 创建命令级校验上下文；依赖注入保持稳定入口和业务函数边界不变。 */
export function createValidationContext(repo, deps) {
  return new ValidationContext(repo, deps);
}
