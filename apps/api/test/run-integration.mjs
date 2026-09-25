import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const apiDirectory = fileURLToPath(new URL('../', import.meta.url));
const repositoryDirectory = fileURLToPath(new URL('../../../', import.meta.url));
const database = `stockledger_test_${randomUUID().replaceAll('-', '')}`;
const ciAdminUrl = process.env.CI ? process.env.DATABASE_URL : undefined;
const url = ciAdminUrl
  ? databaseUrl(ciAdminUrl, database)
  : `postgresql://stockledger:stockledger@127.0.0.1:5434/${database}`;
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

if (process.env.CI && !ciAdminUrl) throw new Error('DATABASE_URL is required in CI');

// Every run gets a random database. Local development uses Compose; CI uses
// the PostgreSQL service configured by the workflow. The developer database is
// never migrated, truncated, or seeded by this test harness.
if (ciAdminUrl) await createCiDatabase(ciAdminUrl, database);
else compose('createdb', '-U', 'stockledger', database);
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
  if (ciAdminUrl) await dropCiDatabase(ciAdminUrl, database);
  else compose('dropdb', '--force', '-U', 'stockledger', database);
}

function databaseUrl(adminUrl, name) {
  const parsed = new URL(adminUrl);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

async function createCiDatabase(adminUrl, name) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
}

async function dropCiDatabase(adminUrl, name) {
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  } finally {
    await client.end();
  }
}
