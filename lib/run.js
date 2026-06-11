import vm from 'node:vm';

/**
 * Evaluate a sapi query.js module in an isolated context and run its query
 * function against (data, params).
 *
 * The context gets only standard ECMAScript intrinsics — no require, process,
 * fetch, fs, timers, or other host APIs — and dynamic code generation is
 * disabled. This is best-effort isolation (node:vm is not a hard security
 * boundary); users should still review untrusted query.js (`sapi --query-src`).
 */
export async function runQuery(source, { data, params, timeout = 5000, identifier = 'query.js' }) {
  if (typeof vm.SourceTextModule !== 'function') {
    throw new Error('vm modules unavailable; run node with --experimental-vm-modules (the sapi CLI does this automatically)');
  }

  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });

  const mod = new vm.SourceTextModule(source, { identifier, context });
  await mod.link((specifier) => {
    throw new Error(`query.js tried to import "${specifier}" — sapi query modules must be self-contained`);
  });
  await mod.evaluate({ timeout });

  const ns = mod.namespace;
  const fn =
    typeof ns.default === 'function' ? ns.default :
    typeof ns.query === 'function' ? ns.query :
    null;
  if (!fn) {
    throw new Error('query.js must have a default export: function query(data, params)');
  }

  // Hand data/params over as JSON strings and parse them inside the context,
  // so query.js sees objects from its own realm (instanceof etc. behave).
  context.__fn = fn;
  context.__dataJson = JSON.stringify(data);
  context.__paramsJson = JSON.stringify(params);
  const result = vm.runInContext(
    '__fn(JSON.parse(__dataJson), JSON.parse(__paramsJson))',
    context,
    { timeout },
  );
  return await result;
}
