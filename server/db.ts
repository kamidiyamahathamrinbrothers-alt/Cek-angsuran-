import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = path.resolve(process.cwd(), 'data');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'yamaha_thamrin.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function hashPassword(password: string, existingSalt?: string): string {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS motor_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand TEXT NOT NULL DEFAULT 'Yamaha',
      motor_name TEXT NOT NULL,
      variant TEXT NOT NULL,
      image_url TEXT NOT NULL DEFAULT '',
      stock_count INTEGER NOT NULL DEFAULT 3,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(brand, motor_name, variant)
    );

    CREATE TABLE IF NOT EXISTS installment_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      motor_id INTEGER NOT NULL,
      dp_amount INTEGER NOT NULL,
      tenor_months INTEGER NOT NULL,
      installment_amount INTEGER NOT NULL,
      promo_name TEXT NOT NULL DEFAULT 'Promo Khusus Yamaha',
      effective_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (motor_id) REFERENCES motor_products(id) ON DELETE CASCADE,
      UNIQUE(motor_id, dp_amount, tenor_months)
    );

    CREATE INDEX IF NOT EXISTS idx_installment_motor_id
      ON installment_packages(motor_id);
    CREATE INDEX IF NOT EXISTS idx_installment_dp_amount
      ON installment_packages(dp_amount);
    CREATE INDEX IF NOT EXISTS idx_installment_tenor_months
      ON installment_packages(tenor_months);
    CREATE INDEX IF NOT EXISTS idx_installment_status
      ON installment_packages(status);
    CREATE INDEX IF NOT EXISTS idx_installment_lookup
      ON installment_packages(motor_id, dp_amount, tenor_months, status);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('super_admin', 'admin', 'sales')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS uploaded_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      file_type TEXT NOT NULL CHECK(file_type IN ('excel', 'sheets', 'pdf')),
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL DEFAULT 0,
      stored_filename TEXT NOT NULL DEFAULT '',
      sheets_url TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Tabel Angsuran',
      uploader_name TEXT NOT NULL DEFAULT 'Pengunjung',
      notes TEXT NOT NULL DEFAULT '',
      row_count INTEGER NOT NULL DEFAULT 0,
      parsed_preview_json TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_uploaded_docs_type ON uploaded_documents(file_type);
    CREATE INDEX IF NOT EXISTS idx_uploaded_docs_created ON uploaded_documents(created_at);

    CREATE TABLE IF NOT EXISTS auto_import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_type TEXT NOT NULL CHECK(source_type IN ('excel', 'csv', 'google_sheets', 'pdf', 'manual_edit', 'rollback')),
      source_name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'promo' CHECK(category IN ('promo', 'reguler')),
      leasing_default TEXT NOT NULL DEFAULT '',
      branch_default TEXT NOT NULL DEFAULT '',
      effective_date TEXT NOT NULL,
      import_mode TEXT NOT NULL DEFAULT 'upsert',
      total_rows INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      skipped_duplicates INTEGER NOT NULL DEFAULT 0,
      column_mapping_json TEXT NOT NULL DEFAULT '{}',
      snapshot_before_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed', 'rolled_back')),
      uploaded_by_user_id INTEGER,
      uploaded_by_name TEXT NOT NULL DEFAULT 'Admin',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auto_installment_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      motor_name TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT 'Standard',
      dp_amount INTEGER NOT NULL,
      tenor_months INTEGER NOT NULL,
      installment_amount INTEGER NOT NULL,
      leasing_name TEXT NOT NULL DEFAULT '',
      branch TEXT NOT NULL DEFAULT '',
      effective_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      source_file TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'promo' CHECK(category IN ('promo', 'reguler')),
      batch_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES auto_import_batches(id) ON DELETE SET NULL,
      UNIQUE(motor_name, variant, dp_amount, tenor_months, leasing_name, branch, category)
    );

    CREATE INDEX IF NOT EXISTS idx_auto_inst_motor ON auto_installment_records(motor_name, variant);
    CREATE INDEX IF NOT EXISTS idx_auto_inst_dp ON auto_installment_records(dp_amount);
    CREATE INDEX IF NOT EXISTS idx_auto_inst_tenor ON auto_installment_records(tenor_months);
    CREATE INDEX IF NOT EXISTS idx_auto_inst_leasing ON auto_installment_records(leasing_name);
    CREATE INDEX IF NOT EXISTS idx_auto_inst_branch ON auto_installment_records(branch);
    CREATE INDEX IF NOT EXISTS idx_auto_inst_active ON auto_installment_records(is_active);
    CREATE INDEX IF NOT EXISTS idx_auto_inst_batch ON auto_installment_records(batch_id);
    CREATE INDEX IF NOT EXISTS idx_auto_inst_search ON auto_installment_records(motor_name, dp_amount, tenor_months, is_active);

    CREATE TABLE IF NOT EXISTS auto_change_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER,
      action TEXT NOT NULL,
      actor_user_id INTEGER,
      actor_name TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES auto_import_batches(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auto_logs_created ON auto_change_logs(created_at);

    CREATE TABLE IF NOT EXISTS auto_discount_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      motor_name TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT '',
      discount_type TEXT NOT NULL CHECK(discount_type IN ('percent', 'nominal')),
      discount_percent REAL NOT NULL DEFAULT 0,
      discount_amount INTEGER NOT NULL DEFAULT 0,
      min_dp INTEGER NOT NULL DEFAULT 0,
      tenor_months INTEGER NOT NULL DEFAULT 0,
      promo_title TEXT NOT NULL DEFAULT '',
      source_pdf_id INTEGER,
      source_file TEXT NOT NULL,
      effective_date TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (source_pdf_id) REFERENCES uploaded_documents(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_auto_disc_motor ON auto_discount_rules(motor_name, branch, is_active);
    CREATE INDEX IF NOT EXISTS idx_auto_disc_pdf ON auto_discount_rules(source_pdf_id);
  `);

  // Non-destructive column migration if motor_products already existed without stock_count
  const columns = db.prepare('PRAGMA table_info(motor_products)').all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === 'stock_count')) {
    db.exec('ALTER TABLE motor_products ADD COLUMN stock_count INTEGER NOT NULL DEFAULT 3;');
  }

  // Non-destructive column migration for auto_import_batches.category
  const batchCols = db.prepare('PRAGMA table_info(auto_import_batches)').all() as Array<{ name: string }>;
  if (!batchCols.some((c) => c.name === 'category')) {
    db.exec("ALTER TABLE auto_import_batches ADD COLUMN category TEXT NOT NULL DEFAULT 'promo';");
  }

  migrateAutoInstallmentUniqueConstraint();
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_auto_inst_category ON auto_installment_records(category);'
  );
  seedInitialUsersIfEmpty();
  ensureOwnerAdminAccount();
  seedInitialCatalogIfEmpty();
  seedAutoInstallmentsIfEmpty();
}

function migrateAutoInstallmentUniqueConstraint(): void {
  const tableMeta = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auto_installment_records'")
    .get() as { sql?: string } | undefined;

  if (!tableMeta?.sql || tableMeta.sql.includes('leasing_name, branch, category)')) {
    return;
  }

  const existingCols = db
    .prepare('PRAGMA table_info(auto_installment_records)')
    .all() as Array<{ name: string }>;
  const hasCategoryCol = existingCols.some((c) => c.name === 'category');

  db.exec('PRAGMA foreign_keys = OFF;');
  db.exec('BEGIN;');
  try {
    const categorySelectExpr = hasCategoryCol
      ? "CASE WHEN LOWER(TRIM(category)) = 'reguler' THEN 'reguler' ELSE 'promo' END"
      : "'promo'";

    db.exec(`
      CREATE TABLE auto_installment_records_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        motor_name TEXT NOT NULL,
        variant TEXT NOT NULL DEFAULT 'Standard',
        dp_amount INTEGER NOT NULL,
        tenor_months INTEGER NOT NULL,
        installment_amount INTEGER NOT NULL,
        leasing_name TEXT NOT NULL DEFAULT '',
        branch TEXT NOT NULL DEFAULT '',
        effective_date TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        source_file TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'promo' CHECK(category IN ('promo', 'reguler')),
        batch_id INTEGER,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (batch_id) REFERENCES auto_import_batches(id) ON DELETE SET NULL,
        UNIQUE(motor_name, variant, dp_amount, tenor_months, leasing_name, branch, category)
      );

      INSERT INTO auto_installment_records_v2 (
        id, motor_name, variant, dp_amount, tenor_months, installment_amount,
        leasing_name, branch, effective_date, is_active, source_file, category, batch_id, created_at, updated_at
      )
      SELECT
        id, motor_name, variant, dp_amount, tenor_months, installment_amount,
        leasing_name, branch, effective_date, is_active, source_file, ${categorySelectExpr}, batch_id, created_at, updated_at
      FROM auto_installment_records;

      DROP TABLE auto_installment_records;
      ALTER TABLE auto_installment_records_v2 RENAME TO auto_installment_records;

      CREATE INDEX IF NOT EXISTS idx_auto_inst_motor ON auto_installment_records(motor_name, variant);
      CREATE INDEX IF NOT EXISTS idx_auto_inst_dp ON auto_installment_records(dp_amount);
      CREATE INDEX IF NOT EXISTS idx_auto_inst_tenor ON auto_installment_records(tenor_months);
      CREATE INDEX IF NOT EXISTS idx_auto_inst_leasing ON auto_installment_records(leasing_name);
      CREATE INDEX IF NOT EXISTS idx_auto_inst_branch ON auto_installment_records(branch);
      CREATE INDEX IF NOT EXISTS idx_auto_inst_active ON auto_installment_records(is_active);
      CREATE INDEX IF NOT EXISTS idx_auto_inst_category ON auto_installment_records(category);
      CREATE INDEX IF NOT EXISTS idx_auto_inst_batch ON auto_installment_records(batch_id);
      CREATE INDEX IF NOT EXISTS idx_auto_inst_search ON auto_installment_records(category, motor_name, dp_amount, tenor_months, is_active);
    `);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
}

function seedInitialUsersIfEmpty(): void {
  const countRow = db.prepare('SELECT COUNT(*) as total FROM users').get() as { total: number };
  if (countRow.total > 0) return;

  const now = new Date().toISOString();
  const insertUser = db.prepare(`
    INSERT INTO users (name, username, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `);

  insertUser.run('Kepala Cabang Prabumulih', 'superadmin', hashPassword('ThamrinSuper#2026'), 'super_admin', now, now);
  insertUser.run('Admin Kredit Yamaha', 'admin', hashPassword('ThamrinAdmin#2026'), 'admin', now, now);
  insertUser.run('Sales Executive Gunung Ibul', 'sales', hashPassword('ThamrinSales#2026'), 'sales', now, now);
}

function ensureOwnerAdminAccount(): void {
  const existing = db.prepare("SELECT id FROM users WHERE LOWER(username) = 'kamidi'").get();
  if (existing) return;

  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (name, username, password_hash, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, ?, ?)
  `).run(
    'Kamidi Yamaha Thamrin',
    'kamidi',
    hashPassword('YamahaAdmin#2026'),
    'super_admin',
    now,
    now
  );
}

function seedInitialCatalogIfEmpty(): void {
  const countRow = db.prepare('SELECT COUNT(*) as total FROM motor_products').get() as { total: number };
  if (countRow.total > 0) return;

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  const insertMotor = db.prepare(`
    INSERT INTO motor_products (brand, motor_name, variant, image_url, stock_count, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `);

  const insertPkg = db.prepare(`
    INSERT INTO installment_packages (
      motor_id, dp_amount, tenor_months, installment_amount, promo_name, effective_date, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `);

  const catalog: Array<{
    brand: string;
    motor_name: string;
    variant: string;
    image_url: string;
    stock_count: number;
    dps: Array<{
      dp: number;
      promo: string;
      tenors: Partial<Record<11 | 17 | 23 | 29 | 33, number>>;
    }>;
  }> = [
    {
      brand: 'Yamaha',
      motor_name: 'Yamaha Aerox',
      variant: 'Standard',
      image_url: '/src/assets/images/motor_yamaha_aerox_1795388181092.jpg',
      stock_count: 5,
      dps: [
        {
          dp: 3000000,
          promo: 'Promo Khusus Yamaha Prabumulih',
          tenors: { 11: 4985000, 17: 3515000, 23: 2825000, 29: 2415000, 33: 2228000 },
        },
        {
          dp: 4000000,
          promo: 'Promo Khusus Yamaha Prabumulih',
          tenors: { 11: 4865000, 17: 3428000, 23: 2747485, 29: 2345000, 33: 2162000 },
        },
        {
          dp: 5000000,
          promo: 'Promo DP Ringan Aerox',
          tenors: { 11: 4745000, 17: 3342000, 23: 2670000, 29: 2275000, 33: 2095000 },
        },
        {
          dp: 6000000,
          promo: 'Promo Reguler Thamrin',
          tenors: { 11: 4620000, 17: 3255000, 23: 2592000, 29: 2208000, 33: 2032000 },
        },
      ],
    },
    {
      brand: 'Yamaha',
      motor_name: 'Yamaha Aerox',
      variant: 'Connected / ABS',
      image_url: '/src/assets/images/motor_yamaha_aerox_1795388181092.jpg',
      stock_count: 3,
      dps: [
        {
          dp: 4000000,
          promo: 'Promo Khusus Yamaha Prabumulih',
          tenors: { 11: 5290000, 17: 3730000, 23: 2992000, 29: 2554000, 33: 2354000 },
        },
        {
          dp: 5000000,
          promo: 'Promo Khusus Yamaha Prabumulih',
          tenors: { 11: 5165000, 17: 3642000, 23: 2918000, 29: 2488000, 33: 2292000 },
        },
        {
          dp: 6500000,
          promo: 'Promo Reguler Thamrin',
          tenors: { 11: 4980000, 17: 3510000, 23: 2808000, 29: 2392000, 33: 2201000 },
        },
      ],
    },
    {
      brand: 'Yamaha',
      motor_name: 'Yamaha NMAX',
      variant: 'Neo',
      image_url: '/src/assets/images/motor_yamaha_nmax_1795388180934.jpg',
      stock_count: 6,
      dps: [
        {
          dp: 3500000,
          promo: 'Promo Maxi Yamaha Gunung Ibul',
          tenors: { 11: 5340000, 17: 3765000, 23: 3015000, 29: 2572000, 33: 2370000 },
        },
        {
          dp: 4500000,
          promo: 'Promo Maxi Yamaha Gunung Ibul',
          tenors: { 11: 5215000, 17: 3678000, 23: 2942000, 29: 2508000, 33: 2310000 },
        },
        {
          dp: 6000000,
          promo: 'Promo Reguler Thamrin',
          tenors: { 11: 5030000, 17: 3545000, 23: 2832000, 29: 2412000, 33: 2220000 },
        },
      ],
    },
    {
      brand: 'Yamaha',
      motor_name: 'Yamaha NMAX',
      variant: 'Turbo',
      image_url: '/src/assets/images/motor_yamaha_nmax_1795388180934.jpg',
      stock_count: 2,
      dps: [
        {
          dp: 4500000,
          promo: 'Promo NMAX Turbo Spesial',
          tenors: { 11: 6090000, 17: 4295000, 23: 3440000, 29: 2935000, 33: 2705000 },
        },
        {
          dp: 6000000,
          promo: 'Promo NMAX Turbo Spesial',
          tenors: { 11: 5905000, 17: 4162000, 23: 3330000, 29: 2840000, 33: 2616000 },
        },
        {
          dp: 8000000,
          promo: 'Promo Reguler Thamrin',
          tenors: { 11: 5660000, 17: 3988000, 23: 3186000, 29: 2714000, 33: 2498000 },
        },
      ],
    },
    {
      brand: 'Yamaha',
      motor_name: 'Yamaha Grand Filano',
      variant: 'Hybrid Neo',
      image_url: '/src/assets/images/motor_yamaha_filano_1795388181422.jpg',
      stock_count: 4,
      dps: [
        {
          dp: 2500000,
          promo: 'Promo Classy Yamaha Prabumulih',
          tenors: { 11: 4215000, 17: 2972000, 23: 2380000, 29: 2032000, 33: 1872000 },
        },
        {
          dp: 3500000,
          promo: 'Promo Classy Yamaha Prabumulih',
          tenors: { 11: 4092000, 17: 2885000, 23: 2308000, 29: 1968000, 33: 1814000 },
        },
        {
          dp: 4500000,
          promo: 'Promo Reguler Thamrin',
          tenors: { 11: 3968000, 17: 2798000, 23: 2236000, 29: 1905000, 33: 1755000 },
        },
      ],
    },
    {
      brand: 'Yamaha',
      motor_name: 'Yamaha Grand Filano',
      variant: 'Hybrid Lux',
      image_url: '/src/assets/images/motor_yamaha_filano_1795388181422.jpg',
      stock_count: 3,
      dps: [
        {
          dp: 3000000,
          promo: 'Promo Classy Yamaha Prabumulih',
          tenors: { 11: 4320000, 17: 3045000, 23: 2438000, 29: 2080000, 33: 1916000 },
        },
        {
          dp: 4000000,
          promo: 'Promo Classy Yamaha Prabumulih',
          tenors: { 11: 4195000, 17: 2958000, 23: 2366000, 29: 2016000, 33: 1858000 },
        },
      ],
    },
    {
      brand: 'Yamaha',
      motor_name: 'Yamaha Fazzio',
      variant: 'Hybrid Neo',
      image_url: '/src/assets/images/motor_yamaha_fazzio_1795388181050.jpg',
      stock_count: 7,
      dps: [
        {
          dp: 2000000,
          promo: 'Promo DP Hemat Fazzio',
          tenors: { 11: 3560000, 17: 2512000, 23: 2012000, 29: 1718000 },
        },
        {
          dp: 3000000,
          promo: 'Promo Classy Yamaha Prabumulih',
          tenors: { 11: 3438000, 17: 2425000, 23: 1940000, 29: 1655000, 33: 1525000 },
        },
        {
          dp: 4000000,
          promo: 'Promo Reguler Thamrin',
          tenors: { 11: 3315000, 17: 2338000, 23: 1868000, 29: 1592000, 33: 1466000 },
        },
      ],
    },
    {
      brand: 'Yamaha',
      motor_name: 'Yamaha Fazzio',
      variant: 'Hybrid Lux',
      image_url: '/src/assets/images/motor_yamaha_fazzio_1795388181050.jpg',
      stock_count: 4,
      dps: [
        {
          dp: 2500000,
          promo: 'Promo Classy Yamaha Prabumulih',
          tenors: { 11: 3685000, 17: 2598000, 23: 2080000, 29: 1775000, 33: 1635000 },
        },
        {
          dp: 3500000,
          promo: 'Promo Classy Yamaha Prabumulih',
          tenors: { 11: 3560000, 17: 2510000, 23: 2008000, 29: 1712000, 33: 1576000 },
        },
      ],
    },
  ];

  for (const item of catalog) {
    const motorRes = insertMotor.run(
      item.brand,
      item.motor_name,
      item.variant,
      item.image_url,
      item.stock_count,
      now,
      now
    );
    const motorId = Number(motorRes.lastInsertRowid);
    for (const dpGroup of item.dps) {
      for (const [tenorStr, amount] of Object.entries(dpGroup.tenors)) {
        if (typeof amount === 'number') {
          insertPkg.run(motorId, dpGroup.dp, Number(tenorStr), amount, dpGroup.promo, today, now, now);
        }
      }
    }
  }
}

function seedAutoInstallmentsIfEmpty(): void {
  const countRow = db
    .prepare('SELECT COUNT(*) as total FROM auto_installment_records')
    .get() as { total: number };
  if (countRow.total > 0) return;

  const rows = db
    .prepare(`
      SELECT
        m.motor_name,
        m.variant,
        p.dp_amount,
        p.tenor_months,
        p.installment_amount,
        p.effective_date
      FROM installment_packages p
      JOIN motor_products m ON m.id = p.motor_id
      WHERE m.is_active = 1 AND p.status = 'active'
      ORDER BY m.motor_name ASC, m.variant ASC, p.dp_amount ASC, p.tenor_months ASC
    `)
    .all() as Array<{
      motor_name: string;
      variant: string;
      dp_amount: number;
      tenor_months: number;
      installment_amount: number;
      effective_date: string;
    }>;

  if (rows.length === 0) return;

  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  db.exec('BEGIN');
  try {
    const batchRes = db
      .prepare(`
        INSERT INTO auto_import_batches (
          source_type, source_name, leasing_default, branch_default, effective_date,
          import_mode, total_rows, inserted_count, updated_count, skipped_duplicates,
          column_mapping_json, snapshot_before_json, status, uploaded_by_user_id, uploaded_by_name,
          notes, created_at
        ) VALUES ('excel', 'Database Awal Dealer Thamrin', 'BAF Finance', 'Yamaha Thamrin Gunung Ibul Prabumulih', ?, 'upsert', ?, ?, 0, 0, '{}', '[]', 'completed', NULL, 'Sistem Dealer', 'Sinkronisasi awal dari tabel produk resmi dealer', ?)
      `)
      .run(today, rows.length, rows.length, now);

    const batchId = Number(batchRes.lastInsertRowid);
    const insertRec = db.prepare(`
      INSERT OR IGNORE INTO auto_installment_records (
        motor_name, variant, dp_amount, tenor_months, installment_amount,
        leasing_name, branch, effective_date, is_active, source_file, batch_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'BAF Finance', 'Yamaha Thamrin Gunung Ibul Prabumulih', ?, 1, 'Database Awal Dealer Thamrin', ?, ?, ?)
    `);

    for (const r of rows) {
      insertRec.run(
        r.motor_name,
        r.variant || 'Standard',
        Math.round(r.dp_amount),
        Math.round(r.tenor_months),
        Math.round(r.installment_amount),
        r.effective_date || today,
        batchId,
        now,
        now
      );
    }

    db.prepare(`
      INSERT INTO auto_change_logs (batch_id, action, actor_user_id, actor_name, details, created_at)
      VALUES (?, 'import_confirmed', NULL, 'Sistem Dealer', ?, ?)
    `).run(batchId, `Inisialisasi ${rows.length} record angsuran otomatis awal dari katalog dealer.`, now);

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    console.error('seedAutoInstallmentsIfEmpty error:', err);
  }
}

