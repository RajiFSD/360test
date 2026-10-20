const mysql = require('mysql2/promise');
const config = require('./config');

let pool;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      connectionLimit: config.db.poolSize,
      timezone: 'Z',
      dateStrings: false,
      decimalNumbers: true,
      supportBigNumbers: true,
      bigNumberStrings: false,
      namedPlaceholders: false,
    });
    // Keep CURRENT_TIMESTAMP and friends in UTC regardless of the server's zone.
    pool.on('connection', (conn) => conn.query("SET time_zone = '+00:00'"));
  }
  return pool;
}

/** Run a parameterized query and return rows. */
async function query(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows;
}

async function one(sql, params = []) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

/** Run fn(conn) inside a transaction; conn exposes query/one helpers. */
async function transaction(fn) {
  const conn = await getPool().getConnection();
  const tx = {
    query: async (sql, params = []) => (await conn.query(sql, params))[0],
    one: async (sql, params = []) => ((await conn.query(sql, params))[0][0] || null),
  };
  try {
    await conn.beginTransaction();
    const result = await fn(tx);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function close() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, query, one, transaction, close };
