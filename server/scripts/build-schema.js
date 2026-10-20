#!/usr/bin/env node
/** Concatenate db/migrations/*.sql into db/schema.sql (a single-file schema for manual installs). */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'db', 'migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const header = `-- SmartOutpass full schema (generated from db/migrations by \`npm run db:schema\`; do not edit by hand)
-- Usage: mysql -u <user> -p -e "CREATE DATABASE smartoutpass CHARACTER SET utf8mb4" && mysql -u <user> -p smartoutpass < db/schema.sql
SET time_zone = '+00:00';
`;
const body = files.map((f) => `\n-- ===== ${f} =====\n${fs.readFileSync(path.join(dir, f), 'utf8').trim()}\n`).join('');
fs.writeFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), header + body);
console.log(`db/schema.sql written from ${files.length} migration(s)`);
