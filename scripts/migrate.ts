import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Db } from '../src/db/db.js';

// 단순 마이그레이션 러너 — db/migrations/*.sql을 이름순으로 실행 (idempotent, IF NOT EXISTS).
const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'db', 'migrations');

async function main() {
  const db = new Db();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sql = readFileSync(join(migrationsDir, f), 'utf8');
    process.stdout.write(`▶ ${f} ... `);
    await db.query(sql);
    console.log('done');
  }
  await db.close();
  console.log('✅ migrations applied');
}

main().catch((e) => {
  console.error('❌ migration failed:', e.message);
  process.exit(1);
});
