#!/usr/bin/env node
/**
 * Database Migration Script
 *
 * Applies the baseline schema and tracked migrations in order.
 *
 * Workflow:
 *   1. Ensure the `schema_migrations` tracking table exists.
 *   2. Apply `database/schema.sql` as the idempotent baseline (safe for both
 *      fresh databases and existing databases created before this script).
 *   3. Apply every `database/migrations/*.sql` file in filename order inside a
 *      transaction, recording each success in `schema_migrations` so reruns are
 *      idempotent.
 */

const fs = require('fs');
const path = require('path');
const { pool, testConnection } = require('./connection');
const logger = require('../utils/logger');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const SCHEMA_FILE = path.join(__dirname, 'schema.sql');

/**
 * Ensure the migration tracking table exists.
 */
const ensureMigrationsTable = async (client) => {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
};

/**
 * Return the list of migration filenames already recorded in the tracking table.
 */
const getAppliedMigrations = async (client) => {
  const result = await client.query('SELECT filename FROM schema_migrations ORDER BY filename');
  return new Set(result.rows.map((row) => row.filename));
};

/**
 * Apply the baseline schema file idempotently. The file is expected to use
 * `IF NOT EXISTS` / `CREATE OR REPLACE` so it is safe to rerun.
 */
const applySchema = async () => {
  if (!fs.existsSync(SCHEMA_FILE)) {
    throw new Error(`Schema file not found: ${SCHEMA_FILE}`);
  }

  const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8');
  if (!schemaSql.trim()) {
    logger.info('Schema file is empty, skipping baseline application');
    return;
  }

  logger.info('Applying baseline schema...');
  await pool.query(schemaSql);
  logger.info('Baseline schema applied');
};

/**
 * Apply a single migration file inside a transaction and record it.
 */
const applyMigration = async (client, filename) => {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filePath, 'utf8');

  logger.info(`Applying migration: ${filename}`);

  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING',
      [filename]
    );
    await client.query('COMMIT');
    logger.info(`Migration applied: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error(`Migration failed: ${filename}`, { error: err.message, stack: err.stack });
    throw err;
  }
};

/**
 * Run all migrations that have not yet been recorded.
 */
const applyPendingMigrations = async () => {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.info('Migrations directory not found, skipping migrations');
    return;
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    logger.info('No migration files found');
    return;
  }

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedMigrations(client);

    let pendingCount = 0;
    for (const filename of files) {
      if (applied.has(filename)) {
        logger.info(`Migration already applied, skipping: ${filename}`);
        continue;
      }
      await applyMigration(client, filename);
      pendingCount += 1;
    }

    logger.info(`Migrations complete: ${pendingCount} applied, ${files.length - pendingCount} already up to date`);
  } finally {
    client.release();
  }
};

/**
 * Run the full migration workflow.
 */
const runMigrations = async () => {
  logger.info('Starting database migration...');

  try {
    const connected = await testConnection();
    if (!connected) {
      throw new Error('Failed to connect to database');
    }

    await applySchema();
    await applyPendingMigrations();

    const result = await pool.query(
      "SELECT COUNT(*) as table_count FROM information_schema.tables WHERE table_schema = 'public'"
    );
    logger.info(`Migration finished. Public tables: ${result.rows[0].table_count}`);
  } catch (error) {
    logger.error('Migration failed', { error: error.message, stack: error.stack });
    process.exit(1);
  }
};

// Run migrations if this script is executed directly
if (require.main === module) {
  runMigrations().finally(async () => {
    // The pool is created at module load time; close it so the CLI exits cleanly.
    await pool.end();
  });
}

module.exports = { runMigrations };
