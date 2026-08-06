const { Pool } = require('pg');
const logger = require('../utils/logger');

const READ_REPLICA_URL = process.env.POSTGRES_READ_REPLICA_URL;
const HAS_REPLICA = !!READ_REPLICA_URL;

let readPool = null;

function getReadPool() {
  if (!HAS_REPLICA) {
    const { pool } = require('./connection');
    return pool;
  }

  if (!readPool) {
    readPool = new Pool({
      connectionString: READ_REPLICA_URL,
      max: parseInt(process.env.DB_REPLICA_POOL_MAX, 10) || 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 30000
    });

    readPool.on('error', (err) => {
      logger.error('Read replica pool error', { error: err.message });
    });

    logger.info('Read replica pool created');
  }

  return readPool;
}

function hasReadReplica() {
  return HAS_REPLICA;
}

async function getReadReplicaMetrics() {
  if (!HAS_REPLICA || !readPool) {
    return { available: false, total: 0, idle: 0, waiting: 0 };
  }
  return {
    available: true,
    total: readPool.totalCount,
    idle: readPool.idleCount,
    waiting: readPool.waitingCount
  };
}

async function closeReadPool() {
  if (readPool) {
    await readPool.end();
    readPool = null;
    logger.info('Read replica pool closed');
  }
}

module.exports = {
  getReadPool,
  hasReadReplica,
  getReadReplicaMetrics,
  closeReadPool
};
