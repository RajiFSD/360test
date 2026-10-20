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
