import crypto from 'node:crypto';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import * as XLSX from 'xlsx';
import {
  AuthenticatedRequest,
  attachOptionalAuth,
  createSessionForUser,
  deleteSession,
  requireAuth,
  requireRole,
} from './server/auth';
import { createApkExportRouter } from './server/apkExport';
import {
  createAutoInstallmentsRouter,
  detectAutoColumnMapping,
  extractPdfDiscountRules,
  normalizeAutoCategory,
  parseExcelWorkbookBuffer,
  saveDiscountRulesTransaction,
  syncExcelBufferToAutoInstallments,
} from './server/autoInstallments';
import { db, hashPassword, initDatabase, UPLOADS_DIR, verifyPassword } from './server/db';
import { SpreadsheetPreview, TENOR_OPTIONS, TenorMonths, UploadedFileType, UserRole } from './src/types';

initDatabase();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '22mb' }));
app.use(attachOptionalAuth);
app.use(createAutoInstallmentsRouter());
app.use(createApkExportRouter());

function parsePositiveInt(val: unknown): number | null {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num);
}

function isValidTenor(val: unknown): val is TenorMonths {
  const n = Number(val);
  return Number.isInteger(n) && n >= 1 && n <= 60;
}

// ============================================================================
// AUTHENTICATION ROUTES
// ============================================================================

app.post('/api/auth/login', (req, res) => {
  try {
    const rawIdentifier = String(req.body?.username ?? '').trim().toLowerCase();
    const username =
      rawIdentifier === 'kamidiyamahathamrinbrothers@gmail.com' ? 'kamidi' : rawIdentifier;
    const password = String(req.body?.password ?? '');

    if (!username || !password) {
      res.status(400).json({ error: 'Username dan password wajib diisi.' });
      return;
    }

    const row = db
      .prepare('SELECT id, name, username, password_hash, role, is_active, created_at FROM users WHERE LOWER(username) = ?')
      .get(username) as
      | {
          id: number;
          name: string;
          username: string;
          password_hash: string;
          role: UserRole;
          is_active: number;
          created_at: string;
        }
      | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Username atau password salah.' });
      return;
    }

    if (row.is_active !== 1) {
      res.status(403).json({ error: 'Akun Anda dinonaktifkan. Hubungi Super Admin.' });
      return;
    }

    const session = createSessionForUser(row.id);
    res.json({
      token: session.token,
      expires_at: session.expires_at,
      user: {
        id: row.id,
        name: row.name,
        username: row.username,
        role: row.role,
        is_active: true,
        created_at: row.created_at,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Terjadi kesalahan saat memproses login.' });
  }
});

app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/logout', (req: AuthenticatedRequest, res) => {
  if (req.authToken) {
    deleteSession(req.authToken);
  }
  res.json({ success: true });
});

// ============================================================================
// PUBLIC / SALES ROUTES (CALCULATOR & CATALOG)
// ============================================================================

app.get('/api/motors', (_req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT
          m.id,
          m.brand,
          m.motor_name,
          m.variant,
          m.image_url,
          m.stock_count,
          m.is_active,
          m.created_at,
          m.updated_at,
          MIN(CASE WHEN p.status = 'active' THEN p.dp_amount END) AS min_dp,
          MIN(CASE WHEN p.status = 'active' THEN p.installment_amount END) AS min_installment,
          COUNT(CASE WHEN p.status = 'active' THEN 1 END) AS active_packages_count
        FROM motor_products m
        LEFT JOIN installment_packages p ON p.motor_id = m.id
        WHERE m.is_active = 1
        GROUP BY m.id
        ORDER BY m.motor_name ASC, m.id ASC
      `)
      .all() as Array<{
        id: number;
        brand: string;
        motor_name: string;
        variant: string;
        image_url: string;
        stock_count: number;
        is_active: number;
        created_at: string;
        updated_at: string;
        min_dp: number | null;
        min_installment: number | null;
        active_packages_count: number;
      }>;

    res.json({
      motors: rows.map((r) => ({
        ...r,
        is_active: r.is_active === 1,
      })),
    });
  } catch (err) {
    console.error('GET /api/motors error:', err);
    res.status(500).json({ error: 'Gagal memuat daftar motor dari database.' });
  }
});

app.get('/api/installments/lookup', (req, res) => {
  try {
    const motorId = parsePositiveInt(req.query.motor_id);
    const dpAmount = Number(req.query.dp_amount);
    const tenorRaw = Number(req.query.tenor_months || 23);

    if (!motorId) {
      res.status(400).json({ error: 'Parameter motor_id wajib diisi dan valid.' });
      return;
    }

    if (!Number.isFinite(dpAmount) || dpAmount <= 0) {
      res.status(400).json({ error: 'Nominal DP harus lebih besar dari Rp0.' });
      return;
    }

    const requestedTenor: TenorMonths = isValidTenor(tenorRaw) ? tenorRaw : 23;

    const motorRow = db
      .prepare('SELECT * FROM motor_products WHERE id = ? AND is_active = 1')
      .get(motorId) as
      | {
          id: number;
          brand: string;
          motor_name: string;
          variant: string;
          image_url: string;
          is_active: number;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    if (!motorRow) {
      res.status(404).json({ error: 'Motor atau varian yang dipilih tidak ditemukan atau tidak aktif.' });
      return;
    }

    const motor = {
      ...motorRow,
      is_active: motorRow.is_active === 1,
    };

    const availableDpRows = db
      .prepare(`
        SELECT DISTINCT dp_amount
        FROM installment_packages
        WHERE motor_id = ? AND status = 'active'
        ORDER BY dp_amount ASC
      `)
      .all(motorId) as Array<{ dp_amount: number }>;

    const availableDps = availableDpRows.map((d) => d.dp_amount);
    const requestedDpRounded = Math.round(dpAmount);
    const exactDpAvailable = availableDps.includes(requestedDpRounded);

    const packagesByTenor: Record<number, unknown> = {};
    for (const t of TENOR_OPTIONS) {
      packagesByTenor[t] = null;
    }

    if (availableDps.length === 0) {
      res.json({
        motor,
        requested_dp: requestedDpRounded,
        requested_tenor: requestedTenor,
        exact_dp_available: false,
        available_dps: [],
        nearest_dps: [],
        available_tenors: [],
        packages: [],
        packages_by_tenor: packagesByTenor,
        selected_package: null,
        message: 'Belum ada paket angsuran aktif untuk tipe dan varian motor ini di database.',
      });
      return;
    }

    if (!exactDpAvailable) {
      const nearestDps = [...availableDps]
        .sort((a, b) => {
          const diffA = Math.abs(a - requestedDpRounded);
          const diffB = Math.abs(b - requestedDpRounded);
          if (diffA !== diffB) return diffA - diffB;
          return a - b;
        })
        .slice(0, 3);

      res.json({
        motor,
        requested_dp: requestedDpRounded,
        requested_tenor: requestedTenor,
        exact_dp_available: false,
        available_dps: availableDps,
        nearest_dps: nearestDps,
        available_tenors: [],
        packages: [],
        packages_by_tenor: packagesByTenor,
        selected_package: null,
        message: 'DP yang Anda masukkan belum tersedia di database. Silakan pilih nominal DP terdekat yang tersedia.',
      });
      return;
    }

    const pkgRows = db
      .prepare(`
        SELECT *
        FROM installment_packages
        WHERE motor_id = ? AND dp_amount = ? AND status = 'active'
        ORDER BY tenor_months ASC
      `)
      .all(motorId, requestedDpRounded) as Array<{
        id: number;
        motor_id: number;
        dp_amount: number;
        tenor_months: number;
        installment_amount: number;
        promo_name: string;
        effective_date: string;
        status: 'active' | 'inactive';
        created_at: string;
        updated_at: string;
      }>;

    const availableTenors: number[] = [];
    for (const pkg of pkgRows) {
      if (isValidTenor(pkg.tenor_months)) {
        packagesByTenor[pkg.tenor_months] = pkg;
        availableTenors.push(pkg.tenor_months);
      }
    }

    const selectedPackage = packagesByTenor[requestedTenor] ?? null;
    const message = selectedPackage
      ? null
      : `Tenor ${requestedTenor} bulan belum tersedia untuk kombinasi motor dan DP ini. Silakan pilih tenor yang tersedia.`;

    res.json({
      motor,
      requested_dp: requestedDpRounded,
      requested_tenor: requestedTenor,
      exact_dp_available: true,
      available_dps: availableDps,
      nearest_dps: [],
      available_tenors: availableTenors,
      packages: pkgRows,
      packages_by_tenor: packagesByTenor,
      selected_package: selectedPackage,
      message,
    });
  } catch (err) {
    console.error('GET /api/installments/lookup error:', err);
    res.status(500).json({ error: 'Gagal mengambil data angsuran dari database.' });
  }
});

// ============================================================================
// ADMIN ROUTES (RBAC PROTECTED)
// ============================================================================

app.get('/api/admin/motors', requireAuth, requireRole('super_admin', 'admin'), (_req, res) => {
  try {
    const rows = db
      .prepare(`
        SELECT
          m.*,
          COUNT(p.id) AS total_packages_count,
          COUNT(CASE WHEN p.status = 'active' THEN 1 END) AS active_packages_count
        FROM motor_products m
        LEFT JOIN installment_packages p ON p.motor_id = m.id
        GROUP BY m.id
        ORDER BY m.motor_name ASC, m.variant ASC
      `)
      .all() as Array<{
        id: number;
        brand: string;
        motor_name: string;
        variant: string;
        image_url: string;
        is_active: number;
        created_at: string;
        updated_at: string;
        total_packages_count: number;
        active_packages_count: number;
      }>;

    res.json({
      motors: rows.map((r) => ({
        ...r,
        is_active: r.is_active === 1,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/motors error:', err);
    res.status(500).json({ error: 'Gagal memuat data motor.' });
  }
});

app.post('/api/admin/motors', requireAuth, requireRole('super_admin'), (req, res) => {
  try {
    const brand = String(req.body?.brand ?? 'Yamaha').trim() || 'Yamaha';
    const motorName = String(req.body?.motor_name ?? '').trim();
    const variant = String(req.body?.variant ?? '').trim();
    const imageUrl = String(req.body?.image_url ?? '').trim();
    const stockCount = Math.max(0, Math.round(Number(req.body?.stock_count ?? 3) || 0));
    const isActive = req.body?.is_active === false ? 0 : 1;

    if (!motorName || !variant) {
      res.status(400).json({ error: 'Nama tipe motor dan varian wajib diisi.' });
      return;
    }

    const now = new Date().toISOString();
    const result = db
      .prepare(`
        INSERT INTO motor_products (brand, motor_name, variant, image_url, stock_count, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(brand, motorName, variant, imageUrl, stockCount, isActive, now, now);

    const created = db.prepare('SELECT * FROM motor_products WHERE id = ?').get(result.lastInsertRowid) as Record<
      string,
      unknown
    >;
    res.status(201).json({
      motor: { ...created, is_active: created.is_active === 1 },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: 'Kombinasi tipe motor dan varian tersebut sudah terdaftar.' });
      return;
    }
    console.error('POST /api/admin/motors error:', err);
    res.status(500).json({ error: 'Gagal menambahkan data motor.' });
  }
});

app.put('/api/admin/motors/:id', requireAuth, requireRole('super_admin'), (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID motor tidak valid.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM motor_products WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Data motor tidak ditemukan.' });
      return;
    }

    const brand = String(req.body?.brand ?? existing.brand).trim() || 'Yamaha';
    const motorName = String(req.body?.motor_name ?? existing.motor_name).trim();
    const variant = String(req.body?.variant ?? existing.variant).trim();
    const imageUrl = req.body?.image_url !== undefined ? String(req.body.image_url).trim() : String(existing.image_url);
    const stockCount =
      req.body?.stock_count !== undefined
        ? Math.max(0, Math.round(Number(req.body.stock_count) || 0))
        : Number(existing.stock_count ?? 3);
    const isActive = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : Number(existing.is_active);

    if (!motorName || !variant) {
      res.status(400).json({ error: 'Nama tipe motor dan varian tidak boleh kosong.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE motor_products
      SET brand = ?, motor_name = ?, variant = ?, image_url = ?, stock_count = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(brand, motorName, variant, imageUrl, stockCount, isActive, now, id);

    const updated = db.prepare('SELECT * FROM motor_products WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ motor: { ...updated, is_active: updated.is_active === 1 } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: 'Kombinasi tipe motor dan varian sudah digunakan.' });
      return;
    }
    console.error('PUT /api/admin/motors/:id error:', err);
    res.status(500).json({ error: 'Gagal memperbarui data motor.' });
  }
});

app.patch('/api/admin/motors/:id/stock', requireAuth, requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID motor tidak valid.' });
      return;
    }
    const existing = db.prepare('SELECT * FROM motor_products WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Data motor tidak ditemukan.' });
      return;
    }

    const stockCount =
      req.body?.stock_count !== undefined
        ? Math.max(0, Math.round(Number(req.body.stock_count) || 0))
        : Number(existing.stock_count ?? 0);

    let nextImageUrl = String(existing.image_url ?? '');
    if (req.body?.photoBase64 && req.body?.photoFilename) {
      const ext = path.extname(String(req.body.photoFilename)).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
        res.status(400).json({ error: 'Format foto harus JPG, PNG, atau WEBP.' });
        return;
      }
      const buffer = Buffer.from(String(req.body.photoBase64), 'base64');
      if (buffer.length > 6 * 1024 * 1024) {
        res.status(400).json({ error: 'Ukuran foto maksimal 6 MB.' });
        return;
      }
      const storedName = `motor_${id}_${crypto.randomBytes(6).toString('hex')}${ext}`;
      fs.writeFileSync(path.join(UPLOADS_DIR, storedName), buffer);
      nextImageUrl = `/api/uploads/${storedName}`;
    }

    const now = new Date().toISOString();
    db.prepare('UPDATE motor_products SET stock_count = ?, image_url = ?, updated_at = ? WHERE id = ?').run(
      stockCount,
      nextImageUrl,
      now,
      id
    );

    const updated = db.prepare('SELECT * FROM motor_products WHERE id = ?').get(id) as Record<string, unknown>;
    res.json({ motor: { ...updated, is_active: updated.is_active === 1 } });
  } catch (err) {
    console.error('PATCH /api/admin/motors/:id/stock error:', err);
    res.status(500).json({ error: 'Gagal memperbarui stok dan foto motor.' });
  }
});

app.get('/api/uploads/:filename', (req, res) => {
  const safeName = path.basename(String(req.params.filename || ''));
  const filePath = path.join(UPLOADS_DIR, safeName);
  if (!safeName || !fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File tidak ditemukan.' });
    return;
  }
  res.sendFile(filePath);
});

app.delete('/api/admin/motors/:id', requireAuth, requireRole('super_admin'), (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID motor tidak valid.' });
      return;
    }
    const existing = db.prepare('SELECT id FROM motor_products WHERE id = ?').get(id);
    if (!existing) {
      res.status(404).json({ error: 'Data motor tidak ditemukan.' });
      return;
    }
    db.prepare('DELETE FROM motor_products WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/motors/:id error:', err);
    res.status(500).json({ error: 'Gagal menghapus data motor.' });
  }
});

// Installment Packages CRUD + Search
app.get('/api/admin/installments', requireAuth, requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const search = String(req.query.search ?? '').trim().toLowerCase();
    const motorId = req.query.motor_id ? parsePositiveInt(req.query.motor_id) : null;
    const status = String(req.query.status ?? 'all').trim();

    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (motorId) {
      conditions.push('p.motor_id = ?');
      params.push(motorId);
    }

    if (status === 'active' || status === 'inactive') {
      conditions.push('p.status = ?');
      params.push(status);
    }

    if (search) {
      const numericDigits = search.replace(/\D/g, '');
      if (numericDigits.length >= 3 && numericDigits === search.replace(/[rp.\s,]/g, '')) {
        conditions.push('(CAST(p.dp_amount AS TEXT) LIKE ? OR LOWER(m.motor_name) LIKE ? OR LOWER(m.variant) LIKE ?)');
        params.push(`%${numericDigits}%`, `%${search}%`, `%${search}%`);
      } else {
        conditions.push(
          '(LOWER(m.motor_name) LIKE ? OR LOWER(m.variant) LIKE ? OR LOWER(p.promo_name) LIKE ? OR CAST(p.dp_amount AS TEXT) LIKE ?)'
        );
        params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
      }
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db
      .prepare(`
        SELECT
          p.*,
          m.brand,
          m.motor_name,
          m.variant,
          m.image_url
        FROM installment_packages p
        JOIN motor_products m ON m.id = p.motor_id
        ${whereClause}
        ORDER BY m.motor_name ASC, m.variant ASC, p.dp_amount ASC, p.tenor_months ASC
      `)
      .all(...params);

    res.json({ packages: rows });
  } catch (err) {
    console.error('GET /api/admin/installments error:', err);
    res.status(500).json({ error: 'Gagal memuat data paket angsuran.' });
  }
});

app.post('/api/admin/installments/batch', requireAuth, requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const motorId = parsePositiveInt(req.body?.motor_id);
    const dpAmount = parsePositiveInt(req.body?.dp_amount);
    const promoName = String(req.body?.promo_name ?? 'Promo Khusus Yamaha').trim() || 'Promo Khusus Yamaha';
    const effectiveDate = String(req.body?.effective_date ?? new Date().toISOString().slice(0, 10)).trim();
    const status = req.body?.status === 'inactive' ? 'inactive' : 'active';
    const tenorsInput = req.body?.tenors as Record<string, unknown> | undefined;

    if (!motorId || !dpAmount) {
      res.status(400).json({ error: 'Motor dan nominal DP wajib diisi dengan angka valid.' });
      return;
    }

    const motorExists = db.prepare('SELECT id FROM motor_products WHERE id = ?').get(motorId);
    if (!motorExists) {
      res.status(404).json({ error: 'Motor yang dipilih tidak ditemukan.' });
      return;
    }

    if (!tenorsInput || typeof tenorsInput !== 'object') {
      res.status(400).json({ error: 'Minimal satu nominal angsuran tenor harus diisi.' });
      return;
    }

    const entries: Array<{ tenor: TenorMonths; amount: number }> = [];
    for (const tenor of TENOR_OPTIONS) {
      const rawVal = tenorsInput[String(tenor)];
      if (rawVal === undefined || rawVal === null || rawVal === '' || Number(rawVal) === 0) {
        continue;
      }
      const parsed = parsePositiveInt(rawVal);
      if (!parsed) {
        res.status(400).json({ error: `Nominal angsuran tenor ${tenor} bulan tidak valid.` });
        return;
      }
      entries.push({ tenor, amount: parsed });
    }

    if (entries.length === 0) {
      res.status(400).json({ error: 'Masukkan minimal satu nilai angsuran tenor (11, 17, 23, 29, atau 33 bulan).' });
      return;
    }

    const now = new Date().toISOString();
    const upsertStmt = db.prepare(`
      INSERT INTO installment_packages (
        motor_id, dp_amount, tenor_months, installment_amount, promo_name, effective_date, status, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(motor_id, dp_amount, tenor_months) DO UPDATE SET
        installment_amount = excluded.installment_amount,
        promo_name = excluded.promo_name,
        effective_date = excluded.effective_date,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    db.exec('BEGIN');
    try {
      for (const item of entries) {
        upsertStmt.run(motorId, dpAmount, item.tenor, item.amount, promoName, effectiveDate, status, now, now);
      }
      db.exec('COMMIT');
    } catch (txErr) {
      db.exec('ROLLBACK');
      throw txErr;
    }

    res.status(201).json({ success: true, count: entries.length });
  } catch (err) {
    console.error('POST /api/admin/installments/batch error:', err);
    res.status(500).json({ error: 'Gagal menyimpan paket angsuran ke database.' });
  }
});

app.put('/api/admin/installments/:id', requireAuth, requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID paket tidak valid.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM installment_packages WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Paket angsuran tidak ditemukan.' });
      return;
    }

    const dpAmount = req.body?.dp_amount !== undefined ? parsePositiveInt(req.body.dp_amount) : Number(existing.dp_amount);
    const tenorMonths =
      req.body?.tenor_months !== undefined ? Number(req.body.tenor_months) : Number(existing.tenor_months);
    const installmentAmount =
      req.body?.installment_amount !== undefined
        ? parsePositiveInt(req.body.installment_amount)
        : Number(existing.installment_amount);
    const promoName = String(req.body?.promo_name ?? existing.promo_name).trim() || 'Promo Khusus Yamaha';
    const effectiveDate = String(req.body?.effective_date ?? existing.effective_date).trim();
    const status =
      req.body?.status !== undefined
        ? req.body.status === 'inactive'
          ? 'inactive'
          : 'active'
        : String(existing.status);

    if (!dpAmount || !installmentAmount || !isValidTenor(tenorMonths)) {
      res.status(400).json({ error: 'Data DP, tenor, atau angsuran tidak valid.' });
      return;
    }

    const now = new Date().toISOString();
    db.prepare(`
      UPDATE installment_packages
      SET dp_amount = ?, tenor_months = ?, installment_amount = ?, promo_name = ?, effective_date = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(dpAmount, tenorMonths, installmentAmount, promoName, effectiveDate, status, now, id);

    const updated = db.prepare('SELECT * FROM installment_packages WHERE id = ?').get(id);
    res.json({ package: updated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: 'Kombinasi motor, DP, dan tenor tersebut sudah ada.' });
      return;
    }
    console.error('PUT /api/admin/installments/:id error:', err);
    res.status(500).json({ error: 'Gagal memperbarui paket angsuran.' });
  }
});

app.patch('/api/admin/installments/:id/status', requireAuth, requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID paket tidak valid.' });
      return;
    }
    const status = req.body?.status === 'inactive' ? 'inactive' : 'active';
    const now = new Date().toISOString();
    const info = db
      .prepare('UPDATE installment_packages SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now, id);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Paket angsuran tidak ditemukan.' });
      return;
    }
    res.json({ success: true, status });
  } catch (err) {
    console.error('PATCH /api/admin/installments/:id/status error:', err);
    res.status(500).json({ error: 'Gagal mengubah status paket angsuran.' });
  }
});

app.delete('/api/admin/installments/:id', requireAuth, requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID paket tidak valid.' });
      return;
    }
    const info = db.prepare('DELETE FROM installment_packages WHERE id = ?').run(id);
    if (info.changes === 0) {
      res.status(404).json({ error: 'Paket angsuran tidak ditemukan.' });
      return;
    }
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/installments/:id error:', err);
    res.status(500).json({ error: 'Gagal menghapus paket angsuran.' });
  }
});

// Excel / CSV Export
app.get('/api/admin/installments/export', requireAuth, requireRole('super_admin', 'admin'), (req, res) => {
  try {
    const format = String(req.query.format ?? 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
    const rows = db
      .prepare(`
        SELECT
          m.brand,
          m.motor_name,
          m.variant,
          p.dp_amount,
          p.tenor_months,
          p.installment_amount,
          p.promo_name,
          p.effective_date,
          p.status
        FROM installment_packages p
        JOIN motor_products m ON m.id = p.motor_id
        ORDER BY m.motor_name ASC, m.variant ASC, p.dp_amount ASC, p.tenor_months ASC
      `)
      .all() as Array<Record<string, unknown>>;

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Angsuran Yamaha');

    if (format === 'csv') {
      const csvString = XLSX.utils.sheet_to_csv(worksheet);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="data_angsuran_yamaha_thamrin.csv"');
      res.send(csvString);
      return;
    }

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="data_angsuran_yamaha_thamrin.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('GET /api/admin/installments/export error:', err);
    res.status(500).json({ error: 'Gagal mengekspor data angsuran.' });
  }
});

// Template Download for Import
app.get('/api/admin/installments/template', requireAuth, requireRole('super_admin', 'admin'), (_req, res) => {
  try {
    const sampleRows = [
      {
        motor_name: 'Yamaha Aerox',
        variant: 'Standard',
        dp_amount: 4000000,
        tenor_11: 4865000,
        tenor_17: 3428000,
        tenor_23: 2747485,
        tenor_29: 2345000,
        tenor_33: 2162000,
        promo_name: 'Promo Khusus Yamaha Prabumulih',
        effective_date: new Date().toISOString().slice(0, 10),
        status: 'active',
      },
    ];
    const worksheet = XLSX.utils.json_to_sheet(sampleRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Template Import');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="template_import_angsuran_yamaha.xlsx"');
    res.send(buffer);
  } catch (err) {
    console.error('GET /api/admin/installments/template error:', err);
    res.status(500).json({ error: 'Gagal membuat template import.' });
  }
});

interface ParsedSpreadsheetEntry {
  rowNum: number;
  motorName: string;
  variant: string;
  dpAmount: number;
  tenor: number;
  installmentAmount: number;
  promoName: string;
  effectiveDate: string;
  status: 'active' | 'inactive';
}

function extractTenorFromHeader(normalizedKey: string): number | null {
  const m = normalizedKey.match(/^(?:tenor_|t_?)?(\d{1,2})(?:_?(?:bulan|bln|x|m))?$/);
  if (!m) return null;
  const n = Number(m[1]);
  return isValidTenor(n) ? n : null;
}

function parseWorkbookToEntries(buffer: Buffer): { entries: ParsedSpreadsheetEntry[]; errors: string[] } {
  const parsed = parseExcelWorkbookBuffer(buffer, '__ALL__');
  if (parsed.sheetNames.length === 0) {
    return { entries: [], errors: ['File tidak memiliki sheet data.'] };
  }
  const rawRows = parsed.rows;
  if (rawRows.length === 0) {
    return { entries: [], errors: ['Isi file kosong.'] };
  }

  const mapping = parsed.suggestedMapping;
  const wideEntries = Object.entries(mapping.wide_tenor_columns || {});
  const today = new Date().toISOString().slice(0, 10);
  const cleanNum = (v: unknown): number => {
    if (typeof v === 'number') return Math.round(v);
    const cleaned = String(v ?? '').trim().replace(/,-$/, '').replace(/,\d{1,2}$/, '');
    if (/^(?:Rp\.?\s*)?\d+\.\d{1,2}$/i.test(cleaned)) {
      const n = Number(cleaned.replace(/[^\d.]/g, ''));
      return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
    }
    const digits = cleaned.replace(/\D/g, '');
    return digits ? Number(digits) : 0;
  };

  const entries: ParsedSpreadsheetEntry[] = [];
  const errors: string[] = [];

  rawRows.forEach((row, index) => {
    const rowNum = index + 2;
    const normalized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      normalized[k.trim().toLowerCase().replace(/\s+/g, '_')] = v;
    }

    const motorName = String(
      (mapping.motor_name ? row[mapping.motor_name] : '') ||
        normalized.motor_name ||
        normalized.tipe_motor ||
        normalized.nama_motor ||
        normalized.motor ||
        normalized.unit ||
        normalized.model ||
        ''
    ).trim();
    const variant =
      String(
        (mapping.variant ? row[mapping.variant] : '') ||
          normalized.variant ||
          normalized.varian ||
          normalized.seri ||
          'Standard'
      ).trim() || 'Standard';
    const dpAmount = cleanNum(
      (mapping.dp_amount ? row[mapping.dp_amount] : undefined) ??
        normalized.dp_amount ??
        normalized.dp ??
        normalized.uang_muka ??
        normalized.nominal_dp ??
        normalized.dp_otr
    );
    const branchLabel = String(
      (mapping.branch ? row[mapping.branch] : '') || row['Wilayah (Sheet)'] || ''
    ).trim();
    const basePromo =
      String(normalized.promo_name ?? normalized.promo ?? normalized.program ?? 'Promo Khusus Yamaha').trim() ||
      'Promo Khusus Yamaha';
    const promoName = branchLabel ? `${basePromo} (${branchLabel})` : basePromo;
    const effectiveDate =
      String((mapping.effective_date ? row[mapping.effective_date] : '') || normalized.effective_date || normalized.tanggal || today).trim() ||
      today;
    const statusRaw = String((mapping.is_active ? row[mapping.is_active] : '') || normalized.status || 'active')
      .trim()
      .toLowerCase();
    const status: 'active' | 'inactive' =
      statusRaw === 'inactive' || statusRaw === 'nonaktif' || statusRaw === '0' ? 'inactive' : 'active';

    if (!motorName || dpAmount <= 0) {
      errors.push(`Baris ${rowNum}: nama motor atau nominal DP tidak valid.`);
      return;
    }

    if (mapping.tenor_months && mapping.installment_amount) {
      const tenor = Number(String(row[mapping.tenor_months] ?? '').replace(/\D/g, ''));
      const installment = cleanNum(row[mapping.installment_amount]);
      if (isValidTenor(tenor) && installment > 0) {
        entries.push({
          rowNum,
          motorName,
          variant,
          dpAmount,
          tenor,
          installmentAmount: installment,
          promoName,
          effectiveDate,
          status,
        });
        return;
      }
    }

    let rowImported = 0;
    for (const [header, tenor] of wideEntries) {
      const amount = cleanNum(row[header]);
      if (isValidTenor(tenor) && amount > 0) {
        entries.push({
          rowNum,
          motorName,
          variant,
          dpAmount,
          tenor,
          installmentAmount: amount,
          promoName,
          effectiveDate,
          status,
        });
        rowImported++;
      }
    }

    if (rowImported === 0) {
      for (const [key, val] of Object.entries(normalized)) {
        const tenor = extractTenorFromHeader(key);
        if (tenor !== null) {
          const amount = cleanNum(val);
          if (amount > 0) {
            entries.push({
              rowNum,
              motorName,
              variant,
              dpAmount,
              tenor,
              installmentAmount: amount,
              promoName,
              effectiveDate,
              status,
            });
            rowImported++;
          }
        }
      }
    }

    if (rowImported === 0) {
      errors.push(`Baris ${rowNum}: Tidak ditemukan kolom tenor/angsuran yang valid.`);
    }
  });

  // Fallback mapping check keeps unused import warning clean
  void detectAutoColumnMapping;
  return { entries, errors };
}

function importWorkbookBufferToInstallments(
  buffer: Buffer,
  actorRole: UserRole
): { importedCount: number; errors: string[] } {
  const { entries, errors } = parseWorkbookToEntries(buffer);
  if (entries.length === 0) {
    return { importedCount: 0, errors };
  }

  const now = new Date().toISOString();
  const findMotorStmt = db.prepare(`
    SELECT id FROM motor_products
    WHERE LOWER(TRIM(motor_name)) = LOWER(TRIM(?)) AND LOWER(TRIM(variant)) = LOWER(TRIM(?))
  `);
  const insertMotorStmt = db.prepare(`
    INSERT INTO motor_products (brand, motor_name, variant, image_url, stock_count, is_active, created_at, updated_at)
    VALUES ('Yamaha', ?, ?, '', 3, 1, ?, ?)
  `);
  const upsertPkgStmt = db.prepare(`
    INSERT INTO installment_packages (
      motor_id, dp_amount, tenor_months, installment_amount, promo_name, effective_date, status, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(motor_id, dp_amount, tenor_months) DO UPDATE SET
      installment_amount = excluded.installment_amount,
      promo_name = excluded.promo_name,
      effective_date = excluded.effective_date,
      status = excluded.status,
      updated_at = excluded.updated_at
  `);

  let importedCount = 0;

  db.exec('BEGIN');
  try {
    for (const entry of entries) {
      let motorRow = findMotorStmt.get(entry.motorName, entry.variant) as { id: number } | undefined;
      if (!motorRow) {
        if (actorRole === 'super_admin') {
          const created = insertMotorStmt.run(entry.motorName, entry.variant, now, now);
          motorRow = { id: Number(created.lastInsertRowid) };
        } else {
          errors.push(
            `Baris ${entry.rowNum}: Motor "${entry.motorName} (${entry.variant})" belum terdaftar. Hubungi Super Admin untuk menambahkan unit baru.`
          );
          continue;
        }
      }
      upsertPkgStmt.run(
        motorRow.id,
        entry.dpAmount,
        entry.tenor,
        entry.installmentAmount,
        entry.promoName,
        entry.effectiveDate,
        entry.status,
        now,
        now
      );
      importedCount++;
    }
    db.exec('COMMIT');
  } catch (txErr) {
    db.exec('ROLLBACK');
    throw txErr;
  }

  return { importedCount, errors };
}

// Excel / CSV Import (Admin)
app.post('/api/admin/installments/import', requireAuth, requireRole('super_admin', 'admin'), (req: AuthenticatedRequest, res) => {
  try {
    const fileBase64 = String(req.body?.fileBase64 ?? '').trim();
    if (!fileBase64) {
      res.status(400).json({ error: 'File Excel atau CSV tidak ditemukan dalam permintaan.' });
      return;
    }
    const buffer = Buffer.from(fileBase64, 'base64');
    const result = importWorkbookBufferToInstallments(buffer, req.user!.role);
    res.json({
      success: true,
      imported_count: result.importedCount,
      errors: result.errors,
    });
  } catch (err) {
    console.error('POST /api/admin/installments/import error:', err);
    res.status(500).json({ error: 'Gagal memproses import file Excel/CSV.' });
  }
});

// ============================================================================
// PUBLIC DOCUMENT UPLOAD ROUTES (EXCEL, SHEETS, PDF - SEMUA ORANG BISA UPLOAD)
// ============================================================================

function buildSpreadsheetPreviewFromBuffer(buffer: Buffer): { preview: SpreadsheetPreview | null; rowCount: number } {
  try {
    const parsed = parseExcelWorkbookBuffer(buffer, '__ALL__');
    if (parsed.sheetNames.length === 0) return { preview: null, rowCount: 0 };
    return {
      preview: {
        sheet_name:
          parsed.sheetNames.length > 1
            ? `Semua Sheet (${parsed.sheetNames.join(', ')})`
            : parsed.sheetNames[0],
        headers: parsed.headers,
        rows: parsed.rows.slice(0, 120),
        total_rows: parsed.rows.length,
      },
      rowCount: parsed.rows.length,
    };
  } catch {
    return { preview: null, rowCount: 0 };
  }
}

function extractGoogleSheetsCsvUrl(urlStr: string): string | null {
  try {
    const parsed = new URL(urlStr);
    if (!parsed.hostname.includes('docs.google.com')) return null;
    const match = parsed.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!match) return null;
    const sheetId = match[1];
    const gidMatch = parsed.hash.match(/gid=(\d+)/) || parsed.search.match(/gid=(\d+)/);
    const gid = gidMatch ? gidMatch[1] : '0';
    return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;
  } catch {
    return null;
  }
}

app.get('/api/documents', (req, res) => {
  try {
    const typeFilter = String(req.query.type ?? 'all').trim();
    const search = String(req.query.search ?? '').trim().toLowerCase();

    const conditions: string[] = [];
    const params: string[] = [];

    if (['excel', 'sheets', 'pdf'].includes(typeFilter)) {
      conditions.push('file_type = ?');
      params.push(typeFilter);
    }

    if (search) {
      conditions.push(
        '(LOWER(title) LIKE ? OR LOWER(original_filename) LIKE ? OR LOWER(category) LIKE ? OR LOWER(uploader_name) LIKE ?)'
      );
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db
      .prepare(`
        SELECT id, title, original_filename, file_type, mime_type, file_size, stored_filename, sheets_url,
               category, uploader_name, notes, row_count, created_at
        FROM uploaded_documents
        ${whereClause}
        ORDER BY id DESC
      `)
      .all(...params);

    res.json({ documents: rows });
  } catch (err) {
    console.error('GET /api/documents error:', err);
    res.status(500).json({ error: 'Gagal memuat daftar dokumen.' });
  }
});

app.post('/api/documents/upload', async (req: AuthenticatedRequest, res) => {
  try {
    const titleInput = String(req.body?.title ?? '').trim();
    const filename = String(req.body?.filename ?? '').trim();
    const mimeType = String(req.body?.mimeType ?? '').trim();
    const fileBase64 = String(req.body?.fileBase64 ?? '').trim();
    const sheetsUrl = String(req.body?.sheetsUrl ?? '').trim();
    const category = String(req.body?.category ?? 'Tabel Angsuran').trim() || 'Tabel Angsuran';
    const uploaderName =
      String(req.body?.uploaderName ?? '').trim() || req.user?.name || 'Tamu / Sales';
    const notes = String(req.body?.notes ?? '').trim();
    const rawAutoApply = String(req.body?.autoApplyCategory ?? '').trim().toLowerCase();
    const autoApplyCategory =
      rawAutoApply === 'reguler' || rawAutoApply === 'promo'
        ? normalizeAutoCategory(rawAutoApply)
        : null;
    const isAdminActor = Boolean(
      req.user && (req.user.role === 'admin' || req.user.role === 'super_admin')
    );

    if (!fileBase64 && !sheetsUrl) {
      res.status(400).json({ error: 'Pilih file (Excel, CSV/Sheets, PDF) atau masukkan tautan Google Sheets.' });
      return;
    }

    const now = new Date().toISOString();

    // Case 1: Google Sheets URL submission
    if (!fileBase64 && sheetsUrl) {
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(sheetsUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('bad protocol');
      } catch {
        res.status(400).json({ error: 'Tautan Google Sheets harus berupa URL https:// yang valid.' });
        return;
      }

      let previewJson = '';
      let rowCount = 0;
      let storedFilename = '';
      let fileSize = 0;
      let fetchedCsvBuf: Buffer | null = null;
      const csvExportUrl = extractGoogleSheetsCsvUrl(sheetsUrl);

      if (csvExportUrl) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 5000);
          const sheetRes = await fetch(csvExportUrl, { signal: controller.signal });
          clearTimeout(timer);
          if (sheetRes.ok) {
            const csvText = await sheetRes.text();
            if (csvText && !csvText.trim().startsWith('<!DOCTYPE')) {
              const csvBuf = Buffer.from(csvText, 'utf-8');
              fetchedCsvBuf = csvBuf;
              const parsed = buildSpreadsheetPreviewFromBuffer(csvBuf);
              if (parsed.preview) {
                previewJson = JSON.stringify(parsed.preview);
                rowCount = parsed.rowCount;
              }
              storedFilename = `doc_${crypto.randomBytes(8).toString('hex')}.csv`;
              fs.writeFileSync(path.join(UPLOADS_DIR, storedFilename), csvBuf);
              fileSize = csvBuf.length;
            }
          }
        } catch {
          // Private sheet or offline sandbox — keep link cleanly without failing upload
        }
      }

      const finalTitle = titleInput || 'Google Sheets Dokumen';
      const result = db
        .prepare(`
          INSERT INTO uploaded_documents (
            title, original_filename, file_type, mime_type, file_size, stored_filename, sheets_url,
            category, uploader_name, notes, row_count, parsed_preview_json, created_at
          ) VALUES (?, ?, 'sheets', 'text/csv', ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          finalTitle,
          'Google Sheets',
          fileSize,
          storedFilename,
          sheetsUrl,
          category,
          uploaderName,
          notes,
          rowCount,
          previewJson,
          now
        );

      const created = db
        .prepare(`
          SELECT id, title, original_filename, file_type, mime_type, file_size, stored_filename, sheets_url,
                 category, uploader_name, notes, row_count, created_at
          FROM uploaded_documents WHERE id = ?
        `)
        .get(result.lastInsertRowid);

      let autoSync: ReturnType<typeof syncExcelBufferToAutoInstallments> | null = null;
      if (autoApplyCategory && isAdminActor && fetchedCsvBuf) {
        try {
          autoSync = syncExcelBufferToAutoInstallments({
            buffer: fetchedCsvBuf,
            sourceName: finalTitle,
            actorUserId: req.user!.id,
            actorName: req.user!.name,
            category: autoApplyCategory,
          });
        } catch (syncErr) {
          console.warn('Google Sheets auto-apply skipped on upload:', syncErr);
        }
      }

      res.status(201).json({
        document: created,
        auto_applied_category:
          autoSync && autoSync.insertedCount + autoSync.updatedCount > 0
            ? autoApplyCategory
            : null,
        auto_inserted: autoSync?.insertedCount ?? 0,
        auto_updated: autoSync?.updatedCount ?? 0,
        sheet_stats: autoSync?.sheetStats ?? [],
      });
      return;
    }

    // Case 2: File upload (Excel, CSV/ODS Sheets, or PDF)
    const safeOrigName = path.basename(filename || 'dokumen');
    const ext = path.extname(safeOrigName).toLowerCase();

    let fileType: UploadedFileType;
    let resolvedMime = mimeType;

    if (ext === '.pdf' || mimeType === 'application/pdf') {
      fileType = 'pdf';
      resolvedMime = 'application/pdf';
    } else if (['.xlsx', '.xls'].includes(ext)) {
      fileType = 'excel';
      resolvedMime =
        resolvedMime || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else if (['.csv', '.ods', '.tsv'].includes(ext)) {
      fileType = 'sheets';
      resolvedMime = resolvedMime || 'text/csv';
    } else {
      res.status(400).json({
        error: 'Format file tidak didukung. Gunakan Excel (.xlsx/.xls), Sheets (.csv/.ods), atau PDF (.pdf).',
      });
      return;
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length === 0) {
      res.status(400).json({ error: 'File kosong.' });
      return;
    }
    if (buffer.length > 10 * 1024 * 1024) {
      res.status(400).json({ error: 'Ukuran file maksimal 10 MB.' });
      return;
    }

    const storedFilename = `doc_${crypto.randomBytes(8).toString('hex')}${ext || (fileType === 'pdf' ? '.pdf' : '.xlsx')}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, storedFilename), buffer);

    let previewJson = '';
    let rowCount = 0;
    if (fileType === 'excel' || fileType === 'sheets') {
      const parsed = buildSpreadsheetPreviewFromBuffer(buffer);
      if (parsed.preview) {
        previewJson = JSON.stringify(parsed.preview);
        rowCount = parsed.rowCount;
      }
    }

    const finalTitle = titleInput || safeOrigName.replace(/\.[^/.]+$/, '');
    const result = db
      .prepare(`
        INSERT INTO uploaded_documents (
          title, original_filename, file_type, mime_type, file_size, stored_filename, sheets_url,
          category, uploader_name, notes, row_count, parsed_preview_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?)
      `)
      .run(
        finalTitle,
        safeOrigName,
        fileType,
        resolvedMime,
        buffer.length,
        storedFilename,
        category,
        uploaderName,
        notes,
        rowCount,
        previewJson,
        now
      );

    const created = db
      .prepare(`
        SELECT id, title, original_filename, file_type, mime_type, file_size, stored_filename, sheets_url,
               category, uploader_name, notes, row_count, created_at
        FROM uploaded_documents WHERE id = ?
      `)
      .get(result.lastInsertRowid) as Record<string, unknown>;

    let extractedDiscountsCount = 0;
    if (fileType === 'pdf' && isAdminActor) {
      try {
        const extracted = await extractPdfDiscountRules(
          buffer.toString('base64'),
          safeOrigName
        );
        if (extracted.rows.length > 0) {
          extractedDiscountsCount = saveDiscountRulesTransaction({
            rules: extracted.rows,
            sourcePdfId: Number(result.lastInsertRowid),
            sourceFile: safeOrigName,
            replaceExistingForSource: true,
            actorUserId: req.user!.id,
            actorName: req.user!.name,
          });
          db.prepare('UPDATE uploaded_documents SET row_count = ? WHERE id = ?').run(
            extractedDiscountsCount,
            result.lastInsertRowid
          );
          created.row_count = extractedDiscountsCount;
        }
      } catch (discErr) {
        console.warn('PDF auto-discount extraction skipped on upload:', discErr);
      }
    }

    let autoSync: ReturnType<typeof syncExcelBufferToAutoInstallments> | null = null;
    if ((fileType === 'excel' || fileType === 'sheets') && autoApplyCategory && isAdminActor) {
      try {
        autoSync = syncExcelBufferToAutoInstallments({
          buffer,
          sourceName: safeOrigName || finalTitle,
          actorUserId: req.user!.id,
          actorName: req.user!.name,
          category: autoApplyCategory,
        });
      } catch (syncErr) {
        console.warn('Spreadsheet auto-apply skipped on upload:', syncErr);
      }
    }

    res.status(201).json({
      document: created,
      extracted_discounts_count: extractedDiscountsCount,
      auto_applied_category:
        autoSync && autoSync.insertedCount + autoSync.updatedCount > 0
          ? autoApplyCategory
          : null,
      auto_inserted: autoSync?.insertedCount ?? 0,
      auto_updated: autoSync?.updatedCount ?? 0,
      sheet_stats: autoSync?.sheetStats ?? [],
    });
  } catch (err) {
    console.error('POST /api/documents/upload error:', err);
    res.status(500).json({ error: 'Gagal mengunggah file ke server.' });
  }
});

app.get('/api/documents/:id/preview', (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID dokumen tidak valid.' });
      return;
    }
    const doc = db
      .prepare('SELECT id, title, file_type, sheets_url, parsed_preview_json FROM uploaded_documents WHERE id = ?')
      .get(id) as
      | { id: number; title: string; file_type: string; sheets_url: string; parsed_preview_json: string }
      | undefined;
    if (!doc) {
      res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
      return;
    }
    const preview = doc.parsed_preview_json ? JSON.parse(doc.parsed_preview_json) : null;
    res.json({ preview, sheets_url: doc.sheets_url });
  } catch (err) {
    console.error('GET /api/documents/:id/preview error:', err);
    res.status(500).json({ error: 'Gagal memuat pratinjau dokumen.' });
  }
});

app.get('/api/documents/:id/installments-data', (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID dokumen tidak valid.' });
      return;
    }
    const doc = db
      .prepare(`
        SELECT id, title, original_filename, file_type, mime_type, file_size, stored_filename, sheets_url,
               category, uploader_name, notes, row_count, created_at
        FROM uploaded_documents WHERE id = ?
      `)
      .get(id) as
      | {
          id: number;
          title: string;
          original_filename: string;
          file_type: UploadedFileType;
          mime_type: string;
          file_size: number;
          stored_filename: string;
          sheets_url: string;
          category: string;
          uploader_name: string;
          notes: string;
          row_count: number;
          created_at: string;
        }
      | undefined;

    if (!doc) {
      res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
      return;
    }
    if (doc.file_type === 'pdf' || !doc.stored_filename) {
      res.status(400).json({ error: 'Dokumen ini bukan file spreadsheet Excel/Sheets yang dapat dibaca.' });
      return;
    }

    const filePath = path.join(UPLOADS_DIR, path.basename(doc.stored_filename));
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File spreadsheet tidak ditemukan di penyimpanan.' });
      return;
    }

    const buffer = fs.readFileSync(filePath);
    const { entries, errors } = parseWorkbookToEntries(buffer);

    const activeEntries = entries.filter((e) => e.status === 'active');
    const motorMap = new Map<
      string,
      {
        id: number;
        brand: string;
        motor_name: string;
        variant: string;
        image_url: string;
        stock_count: number;
        is_active: boolean;
        created_at: string;
        updated_at: string;
      }
    >();

    // Match existing catalog photos if motor name matches
    const catalogMotors = db
      .prepare('SELECT motor_name, variant, image_url, stock_count FROM motor_products WHERE is_active = 1')
      .all() as Array<{ motor_name: string; variant: string; image_url: string; stock_count: number }>;

    let nextMotorId = 1;
    const packages: Array<Record<string, unknown>> = [];
    let nextPkgId = 1;
    const now = doc.created_at;

    for (const entry of activeEntries) {
      const key = `${entry.motorName.toLowerCase()}::${entry.variant.toLowerCase()}`;
      let motorObj = motorMap.get(key);
      if (!motorObj) {
        const matchedCatalog =
          catalogMotors.find(
            (cm) =>
              cm.motor_name.toLowerCase() === entry.motorName.toLowerCase() &&
              cm.variant.toLowerCase() === entry.variant.toLowerCase()
          ) ||
          catalogMotors.find((cm) => cm.motor_name.toLowerCase() === entry.motorName.toLowerCase());

        motorObj = {
          id: nextMotorId++,
          brand: 'Yamaha',
          motor_name: entry.motorName,
          variant: entry.variant,
          image_url: matchedCatalog?.image_url || '',
          stock_count: matchedCatalog?.stock_count ?? 3,
          is_active: true,
          created_at: now,
          updated_at: now,
        };
        motorMap.set(key, motorObj);
      }

      packages.push({
        id: nextPkgId++,
        motor_id: motorObj.id,
        dp_amount: entry.dpAmount,
        tenor_months: entry.tenor,
        installment_amount: entry.installmentAmount,
        promo_name: entry.promoName,
        effective_date: entry.effectiveDate,
        status: entry.status,
        created_at: now,
        updated_at: now,
        motor_name: motorObj.motor_name,
        variant: motorObj.variant,
        brand: 'Yamaha',
      });
    }

    res.json({
      document: doc,
      motors: Array.from(motorMap.values()),
      packages,
      errors,
    });
  } catch (err) {
    console.error('GET /api/documents/:id/installments-data error:', err);
    res.status(500).json({ error: 'Gagal membaca data angsuran dari file Excel/Sheets.' });
  }
});

app.get('/api/documents/:id/file', (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID dokumen tidak valid.' });
      return;
    }
    const doc = db
      .prepare('SELECT original_filename, mime_type, stored_filename FROM uploaded_documents WHERE id = ?')
      .get(id) as { original_filename: string; mime_type: string; stored_filename: string } | undefined;
    if (!doc || !doc.stored_filename) {
      res.status(404).json({ error: 'File fisik tidak tersedia di server.' });
      return;
    }
    const filePath = path.join(UPLOADS_DIR, path.basename(doc.stored_filename));
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File tidak ditemukan di penyimpanan.' });
      return;
    }

    const download = req.query.download === '1';
    res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `${download ? 'attachment' : 'inline'}; filename="${doc.original_filename.replace(/"/g, '')}"`
    );
    res.sendFile(filePath);
  } catch (err) {
    console.error('GET /api/documents/:id/file error:', err);
    res.status(500).json({ error: 'Gagal mengunduh file.' });
  }
});

app.post('/api/documents/:id/apply-to-installments', requireAuth, requireRole('super_admin', 'admin'), (req: AuthenticatedRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID dokumen tidak valid.' });
      return;
    }
    const doc = db
      .prepare('SELECT title, original_filename, file_type, stored_filename FROM uploaded_documents WHERE id = ?')
      .get(id) as
      | { title: string; original_filename: string; file_type: UploadedFileType; stored_filename: string }
      | undefined;
    if (!doc) {
      res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
      return;
    }
    if (doc.file_type === 'pdf' || !doc.stored_filename) {
      res.status(400).json({ error: 'Hanya file spreadsheet (Excel/CSV/Sheets) yang dapat diimpor langsung ke tabel angsuran.' });
      return;
    }
    const filePath = path.join(UPLOADS_DIR, path.basename(doc.stored_filename));
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'File sumber tidak ditemukan.' });
      return;
    }
    const buffer = fs.readFileSync(filePath);
    const targetCategory = normalizeAutoCategory(req.body?.category);
    const autoSync = syncExcelBufferToAutoInstallments({
      buffer,
      sourceName: doc.original_filename || doc.title,
      actorUserId: req.user!.id,
      actorName: req.user!.name,
      category: targetCategory,
    });
    const result =
      targetCategory === 'promo'
        ? importWorkbookBufferToInstallments(buffer, req.user!.role)
        : { importedCount: 0, errors: [] as string[] };
    const totalSynced = Math.max(autoSync.insertedCount + autoSync.updatedCount, result.importedCount);
    res.json({
      success: true,
      category: targetCategory,
      imported_count: totalSynced,
      auto_inserted: autoSync.insertedCount,
      auto_updated: autoSync.updatedCount,
      sheet_stats: autoSync.sheetStats,
      errors: result.errors,
    });
  } catch (err) {
    console.error('POST /api/documents/:id/apply-to-installments error:', err);
    res.status(500).json({ error: 'Gagal mengimpor dokumen ke database angsuran.' });
  }
});

app.delete('/api/documents/:id', (req, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID dokumen tidak valid.' });
      return;
    }
    const doc = db
      .prepare('SELECT stored_filename FROM uploaded_documents WHERE id = ?')
      .get(id) as { stored_filename: string } | undefined;
    if (!doc) {
      res.status(404).json({ error: 'Dokumen tidak ditemukan.' });
      return;
    }
    if (doc.stored_filename) {
      const filePath = path.join(UPLOADS_DIR, path.basename(doc.stored_filename));
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
    db.prepare('DELETE FROM uploaded_documents WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/documents/:id error:', err);
    res.status(500).json({ error: 'Gagal menghapus dokumen.' });
  }
});

// ============================================================================
// SUPER ADMIN USER MANAGEMENT ROUTES
// ============================================================================

app.get('/api/admin/users', requireAuth, requireRole('super_admin'), (_req, res) => {
  try {
    const users = db
      .prepare('SELECT id, name, username, role, is_active, created_at, updated_at FROM users ORDER BY id ASC')
      .all() as Array<{
        id: number;
        name: string;
        username: string;
        role: UserRole;
        is_active: number;
        created_at: string;
        updated_at: string;
      }>;

    res.json({
      users: users.map((u) => ({
        ...u,
        is_active: u.is_active === 1,
      })),
    });
  } catch (err) {
    console.error('GET /api/admin/users error:', err);
    res.status(500).json({ error: 'Gagal memuat daftar pengguna.' });
  }
});

app.post('/api/admin/users', requireAuth, requireRole('super_admin'), (req, res) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const username = String(req.body?.username ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const role = String(req.body?.role ?? 'sales') as UserRole;
    const isActive = req.body?.is_active === false ? 0 : 1;

    if (!name || !username || password.length < 6) {
      res.status(400).json({ error: 'Nama, username, dan password (min. 6 karakter) wajib diisi.' });
      return;
    }
    if (!['super_admin', 'admin', 'sales'].includes(role)) {
      res.status(400).json({ error: 'Role pengguna tidak valid.' });
      return;
    }

    const now = new Date().toISOString();
    const result = db
      .prepare(`
        INSERT INTO users (name, username, password_hash, role, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(name, username, hashPassword(password), role, isActive, now, now);

    const created = db
      .prepare('SELECT id, name, username, role, is_active, created_at, updated_at FROM users WHERE id = ?')
      .get(result.lastInsertRowid) as Record<string, unknown>;

    res.status(201).json({
      user: { ...created, is_active: created.is_active === 1 },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.includes('UNIQUE')) {
      res.status(409).json({ error: 'Username sudah terdaftar.' });
      return;
    }
    console.error('POST /api/admin/users error:', err);
    res.status(500).json({ error: 'Gagal menambahkan pengguna baru.' });
  }
});

app.put('/api/admin/users/:id', requireAuth, requireRole('super_admin'), (req: AuthenticatedRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID pengguna tidak valid.' });
      return;
    }

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      return;
    }

    const name = String(req.body?.name ?? existing.name).trim();
    const role = (req.body?.role ? String(req.body.role) : String(existing.role)) as UserRole;
    const isActive = req.body?.is_active !== undefined ? (req.body.is_active ? 1 : 0) : Number(existing.is_active);
    const password = String(req.body?.password ?? '');

    if (!name || !['super_admin', 'admin', 'sales'].includes(role)) {
      res.status(400).json({ error: 'Nama atau role pengguna tidak valid.' });
      return;
    }

    if (req.user?.id === id && (role !== 'super_admin' || isActive === 0)) {
      res.status(400).json({ error: 'Anda tidak dapat menurunkan role atau menonaktifkan akun Anda sendiri.' });
      return;
    }

    const now = new Date().toISOString();
    const nextPasswordHash = password.length >= 6 ? hashPassword(password) : String(existing.password_hash);

    db.prepare(`
      UPDATE users
      SET name = ?, role = ?, is_active = ?, password_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(name, role, isActive, nextPasswordHash, now, id);

    if (isActive === 0) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }

    const updated = db
      .prepare('SELECT id, name, username, role, is_active, created_at, updated_at FROM users WHERE id = ?')
      .get(id) as Record<string, unknown>;

    res.json({ user: { ...updated, is_active: updated.is_active === 1 } });
  } catch (err) {
    console.error('PUT /api/admin/users/:id error:', err);
    res.status(500).json({ error: 'Gagal memperbarui data pengguna.' });
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireRole('super_admin'), (req: AuthenticatedRequest, res) => {
  try {
    const id = parsePositiveInt(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'ID pengguna tidak valid.' });
      return;
    }
    if (req.user?.id === id) {
      res.status(400).json({ error: 'Anda tidak dapat menghapus akun yang sedang digunakan.' });
      return;
    }

    const target = db.prepare('SELECT role FROM users WHERE id = ?').get(id) as { role: UserRole } | undefined;
    if (!target) {
      res.status(404).json({ error: 'Pengguna tidak ditemukan.' });
      return;
    }

    if (target.role === 'super_admin') {
      const countSuper = db.prepare("SELECT COUNT(*) as total FROM users WHERE role = 'super_admin'").get() as {
        total: number;
      };
      if (countSuper.total <= 1) {
        res.status(400).json({ error: 'Minimal harus tersisa satu akun Super Admin aktif.' });
        return;
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/admin/users/:id error:', err);
    res.status(500).json({ error: 'Gagal menghapus pengguna.' });
  }
});

// ============================================================================
// VITE DEV MIDDLEWARE / STATIC DIST SERVER
// ============================================================================

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  const httpServer = http.createServer(app);

  if (!isProd) {
    const hmrEnabled = process.env.DISABLE_HMR !== 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: hmrEnabled ? { server: httpServer } : false,
        hmr: hmrEnabled ? {} : false,
      },
      appType: 'spa',
    });

    if (!hmrEnabled) {
      app.get('/@vite/client', async (_req, res, next) => {
        try {
          const result = await vite.transformRequest('/@vite/client');
          if (!result?.code) {
            next();
            return;
          }
          const patchedCode = result.code.replace(
            /const transport = normalizeModuleRunnerTransport\(\(\(\) => \{[\s\S]*?\}\)\(\)\);/,
            'const transport = normalizeModuleRunnerTransport({ async connect() {}, async disconnect() {}, send() {} });'
          );
          res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.send(patchedCode);
        } catch {
          next();
        }
      });
    }

    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Yamaha Thamrin Prabumulih server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
