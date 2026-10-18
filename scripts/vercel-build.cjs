'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const steps = [
  ['scripts/verify-ai-builder-provider.cjs'],
  [
    '--test',
    'tests/tios-personal-intelligence-engine.test.cjs',
    'tests/tios-personal-intelligence-service.test.cjs',
    'tests/tios-personal-intelligence-storage.test.cjs',
    'tests/tios-personal-intelligence-cloudflare.test.cjs',
  ],
];

for (const args of steps) {
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.error) {
    console.error(`Build command failed: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}
