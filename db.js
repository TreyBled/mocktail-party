const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res.rows;
  } finally {
    client.release();
  }
}

async function run(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return { lastID: res.rows[0]?.id, changes: res.rowCount };
  } finally {
    client.release();
  }
}

async function initTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS wet_ingredients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      unit TEXT,
      is_active INTEGER DEFAULT 1
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS dry_ingredients (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      unit TEXT,
      is_active INTEGER DEFAULT 1
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS drinks (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      instructions TEXT
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS drink_ingredients (
      id SERIAL PRIMARY KEY,
      drink_id INTEGER NOT NULL,
      ingredient_type TEXT NOT NULL CHECK(ingredient_type IN ('wet','dry')),
      ingredient_id INTEGER NOT NULL,
      quantity TEXT,
      FOREIGN KEY(drink_id) REFERENCES drinks(id) ON DELETE CASCADE
    )
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      drink_id INTEGER NOT NULL,
      customer_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','completed')),
      FOREIGN KEY(drink_id) REFERENCES drinks(id)
    )
  `);
  // Add customer_name if missing (for existing databases)
  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND column_name='customer_name') THEN
        ALTER TABLE orders ADD COLUMN customer_name TEXT;
      END IF;
    END $$;
  `);
}

module.exports = { query, run, initTables };