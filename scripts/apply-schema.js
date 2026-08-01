#!/usr/bin/env node
/**
 * Apply schema.sql + migrations against DATABASE_URL (or POSTGRES_*).
 * Usage: DATABASE_URL=... node scripts/apply-schema.js
 */
require('dotenv').config();
const { pool, testConnection, closePool } = require('../database/connection');
const path = require('path');

async function main() {
  const ok = await testConnection();
  if (!ok) {
    console.error('DB connection failed. Set DATABASE_URL or POSTGRES_* env vars.');
    process.exit(1);
  }
  // Reuse migrate.js logic
  require(path.join(__dirname, '..', 'database', 'migrate.js'));
}

main().catch(async (err) => {
  console.error(err);
  await closePool();
  process.exit(1);
});
