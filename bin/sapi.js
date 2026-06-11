#!/usr/bin/env node
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Sandboxed query execution needs vm.SourceTextModule, which Node still
// gates behind --experimental-vm-modules. Re-exec with the flag when missing.
if (typeof vm.SourceTextModule !== 'function') {
  const r = spawnSync(
    process.execPath,
    ['--experimental-vm-modules', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit' },
  );
  process.exit(r.status ?? 1);
}

const { main } = await import('../lib/cli.js');
process.exit(await main(process.argv.slice(2)));
