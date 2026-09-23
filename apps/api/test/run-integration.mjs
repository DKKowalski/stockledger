import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const apiDirectory = fileURLToPath(new URL('../', import.meta.url));
const repositoryDirectory = fileURLToPath(new URL('../../../', import.meta.url));
const database = `stockledger_test_${randomUUID().replaceAll('-', '')}`;
const url = `postgresql://stockledger:stockledger@127.0.0.1:5434/${database}`;
const env = {
  ...process.env,
  DATABASE_URL: url,
  DIRECT_DATABASE_URL: url,
  INVENTORY_TEST_DATABASE_URL: url,
};
const compose = (...args) => execFileSync('docker', ['compose', 'exec', '-T', 'postgres', ...args], {
  cwd: repositoryDirectory,
  stdio: 'inherit',
});

// Create a unique database in the local Compose service. Never migrate or seed
// the developer's DATABASE_URL, and only drop the database created by this run.
compose('createdb', '-U', 'stockledger', database);
try {
  const migrationOutput = execFileSync('npm', ['exec', '--', 'prisma', 'db', 'migrate', '--quiet'], {
    cwd: apiDirectory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'],
  });
  const migrationResult = migrationOutput.trim().split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((entry) => entry.kind === 'result')?.envelope;
  if (!migrationResult?.ok) throw new Error(`Test migration failed: ${migrationOutput}`);
  console.log(migrationResult.result.summary);
  execFileSync('npm', ['exec', '--', 'vitest', 'run', '--config', 'vitest.integration.config.ts'], {
    cwd: apiDirectory, env, stdio: 'inherit',
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = typeof error.status === 'number' ? error.status : 1;
} finally {
  compose('dropdb', '--force', '-U', 'stockledger', database);
}
