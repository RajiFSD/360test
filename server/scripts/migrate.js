#!/usr/bin/env node
/**
 * Applies db/migrations/*.sql in order, tracking them in schema_migrations.
 *   node scripts/migrate.js          apply pending migrations (creates the database if missing)
 *   node scripts/migrate.js --fresh  drop ALL tables in the database first (dev only)
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('../src/config');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

async function main() {
  const fresh = process.argv.includes('--fresh');
  if (fresh && config.env === 'production') throw new Error('--fresh is disabled in production');

  const base = { host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, multipleStatements: true };
  const admin = await mysql.createConnection(base);
  await admin.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  const conn = await mysql.createConnection({ ...base, database: config.db.database });
  await conn.query("SET time_zone = '+00:00'");

  if (fresh) {
    const [tables] = await conn.query('SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [config.db.database]);
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const { t } of tables) await conn.query(`DROP TABLE IF EXISTS \`${t}\``);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    console.log(`[migrate] dropped ${tables.length} tables`);
  }

  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name VARCHAR(190) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
  const [done] = await conn.query('SELECT name FROM schema_migrations');
  const applied = new Set(done.map((r) => r.name));

  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    process.stdout.write(`[migrate] applying ${file} … `);
    await conn.query(sql);
    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
    console.log('ok');
    count++;
  }
  console.log(count ? `[migrate] ${count} migration(s) applied` : '[migrate] database is up to date');
  await conn.end();
}

main().catch((err) => {
  console.error('[migrate] failed:', err.message);
  process.exit(1);
});
