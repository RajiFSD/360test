const http = require('http');
const config = require('./config');
const db = require('./db');
const { createApp } = require('./app');
const { attachSocket } = require('./socket');
const { startJobs } = require('./jobs');

async function main() {
  try {
    await db.query('SELECT 1');
  } catch (err) {
    console.error(`[db] cannot connect to MariaDB at ${config.db.host}:${config.db.port}/${config.db.database}: ${err.message}`);
    console.error('      Check server/.env and run `npm run db:migrate && npm run db:seed`.');
    process.exit(1);
  }

  // Fail fast if DB_NAME points at a database that wasn't created by our migrations.
  const REQUIRED = [['users', 'roll_no'], ['trips', 'escalation_level'], ['audit_logs', 'entity'], ['location_pings', 'recorded_at'], ['tracking_consents', 'revoke_reason']];
  const cols = await db.query(
    'SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE()',
  );
  const have = new Set(cols.map((r) => `${r.t ?? r.TABLE_NAME}.${r.c ?? r.COLUMN_NAME}`));
  const missing = REQUIRED.filter(([t, c]) => !have.has(`${t}.${c}`)).map(([t, c]) => `${t}.${c}`);
  if (missing.length) {
    console.error(`[db] database "${config.db.database}" does not have the SmartOutpass schema (missing: ${missing.join(', ')}).`);
    console.error('     Point DB_NAME in server/.env at a new/empty database and run `npm run db:migrate && npm run db:seed`,');
    console.error('     or run `npm run db:reset` to DROP ALL TABLES in this database and recreate them.');
    process.exit(1);
  }

  const app = createApp();
  const server = http.createServer(app);
  attachSocket(server);
  const stopJobs = config.enableJobs ? startJobs() : () => {};

  server.listen(config.port, () => {
    console.log(`SmartOutpass API listening on http://localhost:${config.port}  (docs: /api/docs)`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down…`);
    stopJobs();
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
