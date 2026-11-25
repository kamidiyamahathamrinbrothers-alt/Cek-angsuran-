import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { Router } from 'express';
import * as XLSX from 'xlsx';
import { AuthenticatedRequest, requireAuth, requireRole } from './auth';
import { db, UPLOADS_DIR } from './db';
import {
  AutoColumnMapping,
  AutoDiscountRule,
  AutoImportMode,
  AutoInstallmentCategory,
  AutoInstallmentRecord,
  MatchedDiscountInfo,
  ValidatedAutoRowPreview,
} from '../src/types';

export function normalizeAutoCategory(val: unknown): AutoInstallmentCategory {
  return String(val ?? '').trim().toLowerCase() === 'reguler' ? 'reguler' : 'promo';
}

function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function parseRupiahInt(val: unknown): number {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) return 0;
    return Math.round(val);
  }
  let str = String(val ?? '').trim();
  if (!str) return 0;

  // Strip trailing ",-" or Indonesian decimal ",00"
  str = str.replace(/,-$/, '').replace(/,\d{1,2}$/, '');

  // Handle decimal format like "2747485.00" or "4000000.5"
  if (/^(?:Rp\.?\s*)?\d+\.\d{1,2}$/i.test(str)) {
    const num = Number(str.replace(/[^\d.]/g, ''));
    return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
  }

  const digits = str.replace(/\D/g, '');
  if (!digits) return 0;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function parseTenorInt(val: unknown): number {
  if (typeof val === 'number') {
    const n = Math.round(val);
    return n >= 1 && n <= 60 ? n : 0;
  }
  const digits = String(val ?? '').replace(/\D/g, '');
  if (!digits) return 0;
  const n = Number(digits);
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : 0;
}

function normalizeDateStr(val: unknown, fallbackDate: string): string {
  const s = String(val ?? '').trim();
  if (!s) return fallbackDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return fallbackDate;
}

function extractTenorFromHeaderName(header: string): number | null {
  let norm = normalizeKey(header);
  if (!norm) return null;
  norm = norm.replace(/_(?:rp|idr)$/i, '');
  const m = norm.match(
    /^(?:tenor_?|angs_?|angsuran_?|cicilan_?|top_?|t_?|b_?)?(\d{1,2})(?:_?(?:bulan|bln|x|m|kali))?$/
  );
  if (m) {
    const n = Number(m[1]);
    return Number.isInteger(n) && n >= 1 && n <= 60 ? n : null;
  }
  const suffixMatch = norm.match(/(?:tenor|angsuran|angs|cicilan|top)_(\d{1,2})(?:_(?:bulan|bln|x|kali))?$/);
  if (suffixMatch) {
    const n = Number(suffixMatch[1]);
    return Number.isInteger(n) && n >= 1 && n <= 60 ? n : null;
  }
  return null;
}

export function normalizeBranchValue(rawBranch: string, fallbackBranch = ''): string {
  const raw = (rawBranch || '').trim();
  const target = raw || fallbackBranch.trim();
  if (!target) return '';

  const lower = target.toLowerCase().replace(/\s+/g, ' ');
  if (/\bpalembang\b|\bplg\b/.test(lower)) return 'Palembang';
  if (/\bsumsel\b|sumatera\s*selatan/.test(lower)) return 'Sumsel';
  if (/\bbengkulu\b|\bbangkulu\b|\bbkl\b/.test(lower)) return 'Bengkulu';
  if (
    /^(sheet\d*|reguler|promo|pricelist|price\s*list|tabel(\s*angsuran)?|data(\s*angsuran)?|angsuran|kredit|all|semua(\s*wilayah)?|default)$/i.test(
      lower
    )
  ) {
    return 'Semua Wilayah';
  }
  return target;
}

export function detectAutoColumnMapping(headers: string[]): AutoColumnMapping {
  const mapping: AutoColumnMapping = {
    motor_name: '',
    variant: '',
    dp_amount: '',
    tenor_months: '',
    installment_amount: '',
    leasing_name: '',
    branch: '',
    effective_date: '',
    is_active: '',
    wide_tenor_columns: {},
  };

  for (const header of headers) {
    const n = normalizeKey(header);
    if (!n) continue;

    if (
      !mapping.motor_name &&
      [
        'motor_name',
        'tipe_motor',
        'nama_motor',
        'motor',
        'unit',
        'model',
        'tipe',
        'type',
        'type_motor',
        'nama_type',
        'type_kendaraan',
        'nama_unit',
        'nama_barang',
        'unit_motor',
        'jenis_motor',
        'jenis_kendaraan',
        'nama_kendaraan',
        'seri_motor',
        'model_motor',
        'kendaraan',
        'produk',
        'item',
      ].includes(n)
    ) {
      mapping.motor_name = header;
      continue;
    }
    if (
      !mapping.variant &&
      ['variant', 'varian', 'varian_motor', 'seri', 'sub_model', 'tipe_varian', 'type_varian', 'versi'].includes(n)
    ) {
      mapping.variant = header;
      continue;
    }
    if (
      !mapping.dp_amount &&
      [
        'dp_amount',
        'dp',
        'uang_muka',
        'uang_muka_rp',
        'nominal_dp',
        'dp_otr',
        'dp_otr_rp',
        'dp_murni',
        'dp_nett',
        'dp_net',
        'dp_bayar',
        'dp_minimal',
        'dp_min',
        'dp_normal',
        'dp_reguler',
        'dp_pricelist',
        'dp_awal',
        'dp_standar',
        'total_dp',
        'tdp',
        'min_dp',
        'um',
        'dp_rp',
        'tanda_jadi',
      ].includes(n)
    ) {
      mapping.dp_amount = header;
      continue;
    }
    if (!mapping.tenor_months && ['tenor_months', 'tenor', 'tenor_bulan', 'jangka_waktu', 'bulan', 'lama_angsuran'].includes(n)) {
      mapping.tenor_months = header;
      continue;
    }
    if (
      !mapping.installment_amount &&
      ['installment_amount', 'angsuran', 'cicilan', 'angsuran_per_bulan', 'nominal_angsuran', 'cicilan_per_bulan'].includes(n)
    ) {
      mapping.installment_amount = header;
      continue;
    }
    if (
      !mapping.leasing_name &&
      ['leasing_name', 'leasing', 'pembiayaan', 'sumber_pembiayaan', 'finance', 'multifinance', 'lembaga_pembiayaan', 'finco'].includes(n)
    ) {
      mapping.leasing_name = header;
      continue;
    }
    if (
      !mapping.branch &&
      ['branch', 'cabang', 'wilayah', 'cabang_wilayah', 'area', 'kota', 'dealer', 'region', 'daerah', 'wilayah_sheet'].includes(n)
    ) {
      mapping.branch = header;
      continue;
    }
    if (!mapping.effective_date && ['effective_date', 'tanggal_berlaku', 'tgl_berlaku', 'tanggal', 'berlaku'].includes(n)) {
      mapping.effective_date = header;
      continue;
    }
    if (!mapping.is_active && ['status', 'is_active', 'status_aktif', 'aktif'].includes(n)) {
      mapping.is_active = header;
      continue;
    }

    const wideTenor = extractTenorFromHeaderName(header);
    if (wideTenor !== null) {
      mapping.wide_tenor_columns[header] = wideTenor;
    }
  }

  // Fallback partial matching if exact header names weren't matched
  if (!mapping.motor_name) {
    const motorCand = headers.find((h) => {
      const n = normalizeKey(h);
      return n.includes('motor') || n.includes('tipe') || n.includes('type') || n.includes('model');
    });
    if (motorCand) mapping.motor_name = motorCand;
  }
  if (!mapping.dp_amount) {
    const dpCand = headers.find((h) => {
      const n = normalizeKey(h);
      return n === 'dp' || n.startsWith('dp_') || n.endsWith('_dp') || n.includes('uang_muka');
    });
    if (dpCand) mapping.dp_amount = dpCand;
  }

  return mapping;
}

function makeUniqueKey(r: {
  motor_name: string;
  variant: string;
  dp_amount: number;
  tenor_months: number;
  leasing_name: string;
  branch: string;
}): string {
  return [
    r.motor_name.trim().toLowerCase(),
    r.variant.trim().toLowerCase(),
    String(Math.round(r.dp_amount)),
    String(Math.round(r.tenor_months)),
    r.leasing_name.trim().toLowerCase(),
    r.branch.trim().toLowerCase(),
  ].join('||');
}

function mapAndValidateRows(params: {
  rawRows: Array<Record<string, unknown>>;
  mapping: AutoColumnMapping;
  defaultLeasing: string;
  defaultBranch: string;
  defaultEffectiveDate: string;
  category?: AutoInstallmentCategory;
}): {
  rows: ValidatedAutoRowPreview[];
  new_count: number;
  update_count: number;
  duplicate_in_file_count: number;
  invalid_count: number;
} {
  const { rawRows, mapping, defaultLeasing, defaultBranch, defaultEffectiveDate } = params;
  const targetCategory: AutoInstallmentCategory = normalizeAutoCategory(params.category);

  const existingRecords = db
    .prepare(
      'SELECT id, motor_name, variant, dp_amount, tenor_months, leasing_name, branch FROM auto_installment_records WHERE category = ?'
    )
    .all(targetCategory) as Array<{
      id: number;
      motor_name: string;
      variant: string;
      dp_amount: number;
      tenor_months: number;
      leasing_name: string;
      branch: string;
    }>;

  const existingKeySet = new Set(existingRecords.map(makeUniqueKey));
  const seenFileKeys = new Set<string>();
  const previews: ValidatedAutoRowPreview[] = [];

  const wideEntries = Object.entries(mapping.wide_tenor_columns || {}).filter(
    ([col, tenor]) => col && Number.isInteger(tenor) && tenor >= 1 && tenor <= 60
  );

  rawRows.forEach((raw, idx) => {
    const rowNumber = idx + 1;
    const motorName = mapping.motor_name ? String(raw[mapping.motor_name] ?? '').trim() : '';
    const variant = (mapping.variant ? String(raw[mapping.variant] ?? '').trim() : '') || 'Standard';
    const dpAmount = mapping.dp_amount ? parseRupiahInt(raw[mapping.dp_amount]) : 0;
    const leasingName =
      (mapping.leasing_name ? String(raw[mapping.leasing_name] ?? '').trim() : '') ||
      defaultLeasing.trim() ||
      'Dealer Resmi Yamaha';
    const branch = normalizeBranchValue(
      mapping.branch ? String(raw[mapping.branch] ?? '').trim() : '',
      defaultBranch.trim()
    );
    const effectiveDate = normalizeDateStr(
      mapping.effective_date ? raw[mapping.effective_date] : '',
      defaultEffectiveDate
    );
    const statusRaw = mapping.is_active ? String(raw[mapping.is_active] ?? '1').trim().toLowerCase() : '1';
    const isActive = !['0', 'false', 'inactive', 'nonaktif', 'tidak'].includes(statusRaw);

    const pushCandidate = (tenorMonths: number, installmentAmount: number) => {
      const reasons: string[] = [];
      if (!motorName) reasons.push('Tipe motor kosong');
      if (dpAmount <= 0) reasons.push('DP harus lebih dari Rp0');
      if (tenorMonths < 1 || tenorMonths > 60) reasons.push('Tenor tidak valid (1–60 bulan)');
      if (installmentAmount <= 0) reasons.push('Angsuran harus lebih dari Rp0');

      if (reasons.length > 0) {
        previews.push({
          row_index: rowNumber,
          motor_name: motorName || '-',
          variant,
          dp_amount: dpAmount,
          tenor_months: tenorMonths,
          installment_amount: installmentAmount,
          leasing_name: leasingName,
          branch,
          effective_date: effectiveDate,
          is_active: isActive,
          status: 'invalid',
          reason: reasons.join('; '),
        });
        return;
      }

      const key = makeUniqueKey({
        motor_name: motorName,
        variant,
        dp_amount: dpAmount,
        tenor_months: tenorMonths,
        leasing_name: leasingName,
        branch,
      });

      if (seenFileKeys.has(key)) {
        previews.push({
          row_index: rowNumber,
          motor_name: motorName,
          variant,
          dp_amount: dpAmount,
          tenor_months: tenorMonths,
          installment_amount: installmentAmount,
          leasing_name: leasingName,
          branch,
          effective_date: effectiveDate,
          is_active: isActive,
          status: 'duplicate_in_file',
          reason: 'Duplikat kombinasi Motor, Varian, DP, Tenor, dan Leasing di dalam file yang sama',
        });
        return;
      }

      seenFileKeys.add(key);
      const isUpdate = existingKeySet.has(key);
      previews.push({
        row_index: rowNumber,
        motor_name: motorName,
        variant,
        dp_amount: dpAmount,
        tenor_months: tenorMonths,
        installment_amount: installmentAmount,
        leasing_name: leasingName,
        branch,
        effective_date: effectiveDate,
        is_active: isActive,
        status: isUpdate ? 'update' : 'new',
      });
    };

    // Long format if tenor_months + installment_amount mapped and populated
    if (mapping.tenor_months && mapping.installment_amount) {
      const tVal = parseTenorInt(raw[mapping.tenor_months]);
      const instVal = parseRupiahInt(raw[mapping.installment_amount]);
      if (tVal > 0 || instVal > 0 || wideEntries.length === 0) {
        pushCandidate(tVal, instVal);
        return;
      }
    }

    // Wide format: multiple tenor columns
    if (wideEntries.length > 0) {
      let emitted = 0;
      for (const [colHeader, tenorMonths] of wideEntries) {
        const cellVal = raw[colHeader];
        if (cellVal === undefined || cellVal === null || String(cellVal).trim() === '') {
          continue;
        }
        const instVal = parseRupiahInt(cellVal);
        pushCandidate(tenorMonths, instVal);
        emitted++;
      }
      if (emitted === 0) {
        previews.push({
          row_index: rowNumber,
          motor_name: motorName || '-',
          variant,
          dp_amount: dpAmount,
          tenor_months: 0,
          installment_amount: 0,
          leasing_name: leasingName,
          branch,
          effective_date: effectiveDate,
          is_active: isActive,
          status: 'invalid',
          reason: 'Tidak ada nominal angsuran pada kolom tenor baris ini',
        });
      }
      return;
    }

    pushCandidate(0, 0);
  });

  return {
    rows: previews,
    new_count: previews.filter((r) => r.status === 'new').length,
    update_count: previews.filter((r) => r.status === 'update').length,
    duplicate_in_file_count: previews.filter((r) => r.status === 'duplicate_in_file').length,
    invalid_count: previews.filter((r) => r.status === 'invalid').length,
  };
}

function scoreHeaderRow(cells: unknown[]): number {
  if (!Array.isArray(cells)) return -1;
  let score = 0;
  let nonEmpty = 0;

  for (const c of cells) {
    const raw = String(c ?? '').trim();
    if (!raw) continue;
    nonEmpty++;
    const n = normalizeKey(raw);
    if (!n) continue;

    if (
      [
        'motor_name',
        'tipe_motor',
        'nama_motor',
        'motor',
        'unit',
        'model',
        'tipe',
        'type',
        'type_motor',
        'nama_unit',
        'kendaraan',
        'produk',
      ].includes(n)
    ) {
      score += 5;
    } else if (
      [
        'dp_amount',
        'dp',
        'uang_muka',
        'nominal_dp',
        'dp_otr',
        'dp_murni',
        'dp_nett',
        'dp_net',
        'dp_bayar',
        'dp_min',
        'dp_minimal',
        'min_dp',
        'um',
      ].includes(n)
    ) {
      score += 5;
    } else if (
      ['variant', 'varian', 'seri', 'tenor', 'angsuran', 'cicilan', 'leasing', 'cabang', 'wilayah', 'otr'].includes(n)
    ) {
      score += 3;
    } else if (extractTenorFromHeaderName(raw) !== null) {
      score += 2;
    }
  }

  return nonEmpty >= 2 ? score : -1;
}

function expandSheetMergesToMatrix(worksheet: XLSX.WorkSheet): unknown[][] {
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: '' });
  const merges = worksheet['!merges'] || [];
  for (const merge of merges) {
    const topLeft = matrix[merge.s.r]?.[merge.s.c];
    if (topLeft === undefined || topLeft === null || String(topLeft).trim() === '') continue;
    for (let r = merge.s.r; r <= merge.e.r; r++) {
      if (!matrix[r]) matrix[r] = [];
      for (let c = merge.s.c; c <= merge.e.c; c++) {
        const current = matrix[r][c];
        if (current === undefined || current === null || String(current).trim() === '') {
          matrix[r][c] = topLeft;
        }
      }
    }
  }
  return matrix;
}

export function extractTableFromMatrix(
  matrix: unknown[][],
  sheetName: string,
  options?: { attachSheetColumn?: boolean }
): {
  headers: string[];
  rows: Array<Record<string, unknown>>;
} {
  if (!matrix || matrix.length === 0) {
    return { headers: [], rows: [] };
  }

  const scanLimit = Math.min(30, matrix.length);
  let bestIdx = -1;
  let bestScore = -1;

  for (let i = 0; i < scanLimit; i++) {
    const score = scoreHeaderRow(matrix[i]);
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  const headerIdx =
    bestScore >= 4
      ? bestIdx
      : matrix.findIndex((row) => Array.isArray(row) && row.some((c) => String(c ?? '').trim() !== ''));

  if (headerIdx === -1) {
    return { headers: [], rows: [] };
  }

  const primaryHeaderRow = matrix[headerIdx] || [];
  const nextRow = matrix[headerIdx + 1];
  let dataStartIdx = headerIdx + 1;

  // Detect 2-row grouped header (e.g. row H has "TENOR", row H+1 has 11, 17, 23, 29, 33)
  let tenorSubHits = 0;
  if (Array.isArray(nextRow)) {
    for (const cell of nextRow) {
      if (extractTenorFromHeaderName(String(cell ?? '')) !== null) {
        tenorSubHits++;
      }
    }
  }
  const hasTwoRowHeader = tenorSubHits >= 2;
  if (hasTwoRowHeader) {
    dataStartIdx = headerIdx + 2;
  }

  const maxCols = Math.max(
    primaryHeaderRow.length,
    hasTwoRowHeader && Array.isArray(nextRow) ? nextRow.length : 0
  );

  const rawHeaders: string[] = [];
  for (let c = 0; c < maxCols; c++) {
    const topVal = String(primaryHeaderRow[c] ?? '').trim();
    const subVal = hasTwoRowHeader && Array.isArray(nextRow) ? String(nextRow[c] ?? '').trim() : '';
    let label = topVal;
    if (hasTwoRowHeader && subVal && subVal.toLowerCase() !== topVal.toLowerCase()) {
      const subTenor = extractTenorFromHeaderName(subVal);
      if (subTenor !== null) {
        label = subVal;
      } else if (!topVal) {
        label = subVal;
      } else {
        label = `${topVal} ${subVal}`;
      }
    }
    rawHeaders.push(label || `Kolom_${c + 1}`);
  }

  // Trim trailing synthetic empty columns that have no data at all
  let effectiveCols = rawHeaders.length;
  while (effectiveCols > 1 && rawHeaders[effectiveCols - 1].startsWith('Kolom_')) {
    const colIdx = effectiveCols - 1;
    const hasAnyValue = matrix
      .slice(dataStartIdx)
      .some((r) => Array.isArray(r) && String(r[colIdx] ?? '').trim() !== '');
    if (hasAnyValue) break;
    effectiveCols--;
  }

  const headers: string[] = [];
  const used = new Map<string, number>();
  for (let c = 0; c < effectiveCols; c++) {
    const h = rawHeaders[c];
    const count = used.get(h) ?? 0;
    used.set(h, count + 1);
    headers.push(count === 0 ? h : `${h}_${count + 1}`);
  }

  const shouldAttachSheet = options?.attachSheetColumn ?? false;
  const sheetColName = 'Wilayah (Sheet)';
  if (shouldAttachSheet && sheetName && !headers.includes(sheetColName)) {
    headers.push(sheetColName);
  }

  // Identify likely motor/variant/dp/tenor columns for smart forward-fill of grouped rows
  const prelimMap = detectAutoColumnMapping(headers);
  const motorCol = prelimMap.motor_name;
  const variantCol = prelimMap.variant;
  const dpCol = prelimMap.dp_amount;
  const wideCols = Object.keys(prelimMap.wide_tenor_columns);

  let lastMotorName = '';
  let lastVariant = '';

  const rows: Array<Record<string, unknown>> = [];
  for (let i = dataStartIdx; i < matrix.length; i++) {
    const rowArr = matrix[i];
    if (!Array.isArray(rowArr) || rowArr.every((c) => String(c ?? '').trim() === '')) continue;

    const obj: Record<string, unknown> = {};
    for (let colIdx = 0; colIdx < effectiveCols; colIdx++) {
      obj[headers[colIdx]] = rowArr[colIdx] ?? '';
    }

    // Forward-fill blank motor names in grouped DP rows (ignoring note/footer rows)
    const rawMotor = motorCol ? String(obj[motorCol] ?? '').trim() : '';
    const isFooterOrNote =
      rawMotor &&
      /^(total|catatan|keterangan|note|nb|syarat|ketentuan|\*)/i.test(rawMotor);
    if (isFooterOrNote) continue;

    // Skip repeated header rows inside the sheet
    if (
      motorCol &&
      rawMotor &&
      normalizeKey(rawMotor) === normalizeKey(motorCol) &&
      dpCol &&
      parseRupiahInt(obj[dpCol]) === 0
    ) {
      continue;
    }

    if (motorCol) {
      if (rawMotor) {
        lastMotorName = rawMotor;
        if (variantCol) {
          lastVariant = String(obj[variantCol] ?? '').trim();
        }
      } else if (lastMotorName) {
        const hasDpOrTenor =
          (dpCol && parseRupiahInt(obj[dpCol]) > 0) ||
          wideCols.some((wc) => parseRupiahInt(obj[wc]) > 0) ||
          (prelimMap.installment_amount && parseRupiahInt(obj[prelimMap.installment_amount]) > 0);
        if (hasDpOrTenor) {
          obj[motorCol] = lastMotorName;
          if (variantCol && !String(obj[variantCol] ?? '').trim() && lastVariant) {
            obj[variantCol] = lastVariant;
          }
        }
      }
    }

    if (shouldAttachSheet && sheetName && !obj[sheetColName]) {
      obj[sheetColName] = sheetName;
    }

    rows.push(obj);
  }

  return { headers, rows };
}

function canonicalizeSheetExtraction(
  extracted: { headers: string[]; rows: Array<Record<string, unknown>> },
  sheetName: string
): { headers: string[]; rows: Array<Record<string, unknown>> } {
  const map = detectAutoColumnMapping(extracted.headers);
  const renameMap = new Map<string, string>();
  if (map.motor_name) renameMap.set(map.motor_name, 'Tipe Motor');
  if (map.variant) renameMap.set(map.variant, 'Varian Motor');
  if (map.dp_amount) renameMap.set(map.dp_amount, 'Nominal DP');
  if (map.tenor_months) renameMap.set(map.tenor_months, 'Tenor (Bulan)');
  if (map.installment_amount) renameMap.set(map.installment_amount, 'Angsuran');
  if (map.leasing_name) renameMap.set(map.leasing_name, 'Leasing');
  if (map.branch) renameMap.set(map.branch, 'Cabang / Wilayah');
  if (map.effective_date) renameMap.set(map.effective_date, 'Tanggal Berlaku');
  if (map.is_active) renameMap.set(map.is_active, 'Status Aktif');
  for (const [col, tenor] of Object.entries(map.wide_tenor_columns)) {
    renameMap.set(col, `${tenor} Bulan`);
  }

  const outHeaders: string[] = [];
  const seenH = new Set<string>();
  for (const h of extracted.headers) {
    const target = renameMap.get(h) || h;
    if (!seenH.has(target)) {
      seenH.add(target);
      outHeaders.push(target);
    }
  }
  if (!seenH.has('Wilayah (Sheet)')) {
    seenH.add('Wilayah (Sheet)');
    outHeaders.push('Wilayah (Sheet)');
  }

  const outRows = extracted.rows.map((r) => {
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const target = renameMap.get(k) || k;
      if (next[target] === undefined || String(next[target] ?? '').trim() === '') {
        next[target] = v;
      }
    }
    if (!next['Wilayah (Sheet)']) {
      next['Wilayah (Sheet)'] = sheetName;
    }
    return next;
  });

  return { headers: outHeaders, rows: outRows };
}

export function parseExcelWorkbookBuffer(
  buffer: Buffer,
  requestedSheet?: string
): {
  sheetNames: string[];
  activeSheet: string;
  sheetStats: Array<{ sheet_name: string; row_count: number }>;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  suggestedMapping: AutoColumnMapping;
} {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    return {
      sheetNames: [],
      activeSheet: '',
      sheetStats: [],
      headers: [],
      rows: [],
      suggestedMapping: detectAutoColumnMapping([]),
    };
  }

  const useAllSheets =
    requestedSheet === '__ALL__' ||
    (!requestedSheet && sheetNames.length > 1);

  const targetSheets = useAllSheets
    ? sheetNames
    : [
        requestedSheet && sheetNames.includes(requestedSheet)
          ? requestedSheet
          : sheetNames[0],
      ];

  const attachSheetColumn =
    sheetNames.length > 1 ||
    !/^sheet\d+$/i.test(targetSheets[0]);

  const headerSet = new Set<string>();
  const combinedRows: Array<Record<string, unknown>> = [];
  const sheetStats: Array<{ sheet_name: string; row_count: number }> = [];

  for (const sName of targetSheets) {
    const ws = workbook.Sheets[sName];
    if (!ws) continue;
    const matrix = expandSheetMergesToMatrix(ws);
    const rawExtracted = extractTableFromMatrix(matrix, sName, { attachSheetColumn });
    const extracted =
      targetSheets.length > 1
        ? canonicalizeSheetExtraction(rawExtracted, sName)
        : rawExtracted;
    sheetStats.push({ sheet_name: sName, row_count: extracted.rows.length });
    for (const h of extracted.headers) headerSet.add(h);
    combinedRows.push(...extracted.rows);
  }

  const headers = Array.from(headerSet);
  const suggestedMapping = detectAutoColumnMapping(headers);
  if (!suggestedMapping.branch && headers.includes('Wilayah (Sheet)')) {
    suggestedMapping.branch = 'Wilayah (Sheet)';
  }

  return {
    sheetNames,
    activeSheet: useAllSheets ? '__ALL__' : targetSheets[0],
    sheetStats,
    headers,
    rows: combinedRows,
    suggestedMapping,
  };
}

export function syncExcelBufferToAutoInstallments(params: {
  buffer: Buffer;
  sourceName: string;
  actorUserId: number;
  actorName: string;
  category?: AutoInstallmentCategory;
}): { insertedCount: number; updatedCount: number; sheetStats: Array<{ sheet_name: string; row_count: number }> } {
  const targetCategory = normalizeAutoCategory(params.category);
  const parsed = parseExcelWorkbookBuffer(params.buffer, '__ALL__');
  if (parsed.rows.length === 0) {
    return { insertedCount: 0, updatedCount: 0, sheetStats: parsed.sheetStats };
  }
  const today = new Date().toISOString().slice(0, 10);
  const inferredDefaultBranch =
    parsed.sheetNames.length <= 1 ? 'Semua Wilayah' : 'Palembang';
  const summary = mapAndValidateRows({
    rawRows: parsed.rows,
    mapping: parsed.suggestedMapping,
    defaultLeasing: 'BAF Finance',
    defaultBranch: inferredDefaultBranch,
    defaultEffectiveDate: today,
    category: targetCategory,
  });

  const validRows = summary.rows.filter((r) => r.status === 'new' || r.status === 'update');
  if (validRows.length === 0) {
    return { insertedCount: 0, updatedCount: 0, sheetStats: parsed.sheetStats };
  }

  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const batchRes = db
      .prepare(`
        INSERT INTO auto_import_batches (
          source_type, source_name, category, leasing_default, branch_default, effective_date,
          import_mode, total_rows, inserted_count, updated_count, skipped_duplicates,
          column_mapping_json, snapshot_before_json, status, uploaded_by_user_id, uploaded_by_name,
          notes, created_at
        ) VALUES ('excel', ?, ?, 'BAF Finance', 'Palembang', ?, 'upsert', ?, 0, 0, ?, ?, '[]', 'completed', ?, ?, ?, ?)
      `)
      .run(
        params.sourceName,
        targetCategory,
        today,
        summary.rows.length,
        summary.duplicate_in_file_count + summary.invalid_count,
        JSON.stringify(parsed.suggestedMapping),
        params.actorUserId,
        params.actorName,
        `Sinkronisasi otomatis kategori ${targetCategory.toUpperCase()} dari dokumen Akun`,
        now
      );
    const batchId = Number(batchRes.lastInsertRowid);

    const upsertStmt = db.prepare(`
      INSERT INTO auto_installment_records (
        motor_name, variant, dp_amount, tenor_months, installment_amount,
        leasing_name, branch, effective_date, is_active, source_file, category, batch_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(motor_name, variant, dp_amount, tenor_months, leasing_name, branch, category) DO UPDATE SET
        installment_amount = excluded.installment_amount,
        effective_date = excluded.effective_date,
        is_active = excluded.is_active,
        source_file = excluded.source_file,
        batch_id = excluded.batch_id,
        updated_at = excluded.updated_at
    `);

    let insertedCount = 0;
    let updatedCount = 0;
    for (const row of validRows) {
      upsertStmt.run(
        row.motor_name,
        row.variant,
        Math.round(row.dp_amount),
        Math.round(row.tenor_months),
        Math.round(row.installment_amount),
        row.leasing_name,
        row.branch,
        row.effective_date,
        row.is_active ? 1 : 0,
        params.sourceName,
        targetCategory,
        batchId,
        now,
        now
      );
      if (row.status === 'update') updatedCount++;
      else insertedCount++;
    }

    db.prepare('UPDATE auto_import_batches SET inserted_count = ?, updated_count = ? WHERE id = ?').run(
      insertedCount,
      updatedCount,
      batchId
    );
    db.prepare(`
      INSERT INTO auto_change_logs (batch_id, action, actor_user_id, actor_name, details, created_at)
      VALUES (?, 'import_from_account_doc', ?, ?, ?, ?)
    `).run(
      batchId,
      params.actorUserId,
      params.actorName,
      `Sinkronisasi multi-sheet [${targetCategory.toUpperCase()}] dari "${params.sourceName}": ${insertedCount} baru, ${updatedCount} diperbarui.`,
      now
    );

    db.exec('COMMIT');
    return { insertedCount, updatedCount, sheetStats: parsed.sheetStats };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function buildMatrixResponse(
  sourceType: 'google_sheets',
  sourceName: string,
  sheetNames: string[],
  activeSheet: string,
  values: unknown[][],
  attachSheetColumn = false
) {
  const extracted = extractTableFromMatrix(values, activeSheet, { attachSheetColumn });
  const suggested = detectAutoColumnMapping(extracted.headers);
  if (!suggested.branch && extracted.headers.includes('Wilayah (Sheet)')) {
    suggested.branch = 'Wilayah (Sheet)';
  }

  return {
    source_type: sourceType,
    source_name: sourceName,
    sheet_names: sheetNames,
    active_sheet: activeSheet,
    sheet_stats: [{ sheet_name: activeSheet, row_count: extracted.rows.length }],
    headers: extracted.headers,
    rows: extracted.rows,
    suggested_mapping: suggested,
  };
}

function safeParseRowsJson(rawText: string): {
  extraction_method?: string;
  promo_title?: string;
  effective_date?: string;
  rows: Array<Record<string, unknown>>;
} {
  let cleaned = (rawText ?? '').trim();
  if (!cleaned) return { rows: [] };

  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  try {
    const parsed = JSON.parse(cleaned) as
      | Array<Record<string, unknown>>
      | {
          extraction_method?: string;
          promo_title?: string;
          effective_date?: string;
          rows?: Array<Record<string, unknown>>;
        };
    if (Array.isArray(parsed)) {
      return { rows: parsed };
    }
    return {
      extraction_method: parsed.extraction_method,
      promo_title: parsed.promo_title,
      effective_date: parsed.effective_date,
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
    };
  } catch {
    const extractMetaField = (key: string): string | undefined => {
      const m = cleaned.match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`));
      if (!m) return undefined;
      try {
        return JSON.parse(`"${m[1]}"`) as string;
      } catch {
        return m[1];
      }
    };

    const rowsMatch = cleaned.match(/"rows"\s*:\s*\[/);
    const arrayStart =
      rowsMatch && rowsMatch.index !== undefined
        ? rowsMatch.index + rowsMatch[0].length - 1
        : cleaned.indexOf('[');

    if (arrayStart === -1) {
      return { rows: [] };
    }

    const recoveredRows: Array<Record<string, unknown>> = [];
    let inString = false;
    let escaped = false;
    let braceDepth = 0;
    let objStart = -1;

    for (let i = arrayStart + 1; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (inString) {
        if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        if (braceDepth === 0) objStart = i;
        braceDepth++;
      } else if (ch === '}') {
        if (braceDepth > 0) {
          braceDepth--;
          if (braceDepth === 0 && objStart !== -1) {
            const slice = cleaned.slice(objStart, i + 1);
            try {
              const obj = JSON.parse(slice) as Record<string, unknown>;
              if (obj && typeof obj === 'object') {
                recoveredRows.push(obj);
              }
            } catch {
              // Skip incomplete trailing object
            }
            objStart = -1;
          }
        }
      } else if (ch === ']' && braceDepth === 0) {
        break;
      }
    }

    return {
      extraction_method: extractMetaField('extraction_method'),
      promo_title: extractMetaField('promo_title'),
      effective_date: extractMetaField('effective_date'),
      rows: recoveredRows,
    };
  }
}

async function extractPdfInstallmentTables(pdfBase64: string): Promise<{
  extractionMethod: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
}> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY belum tersedia di Settings > Secrets untuk melakukan ekstraksi tabel dan OCR PDF.'
    );
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: 'application/pdf',
            data: pdfBase64,
          },
        },
        {
          text:
            'Ekstrak seluruh baris tabel simulasi kredit / daftar angsuran motor Yamaha dari dokumen PDF ini (lakukan OCR jika dokumen berupa hasil scan/gambar). ' +
            'Kembalikan setiap kombinasi Tipe Motor, Varian, Nominal DP (integer Rupiah tanpa titik/koma), Tenor dalam bulan (integer, misal 11, 17, 23, 29, 33, 12, 24, 36), ' +
            'Angsuran per bulan (integer Rupiah tanpa titik/koma), Nama Leasing / pembiayaan jika tercantum, Cabang / wilayah jika tercantum, dan Tanggal Berlaku (YYYY-MM-DD) jika tercantum. ' +
            'Jangan mengarang atau menghitung angka sendiri; ambil hanya angka yang benar-benar tertulis di tabel PDF.',
        },
      ],
    },
    config: {
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          extraction_method: {
            type: Type.STRING,
            description: 'text_table atau ocr_vision',
          },
          rows: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                motor_name: { type: Type.STRING },
                variant: { type: Type.STRING },
                dp_amount: { type: Type.INTEGER },
                tenor_months: { type: Type.INTEGER },
                installment_amount: { type: Type.INTEGER },
                leasing_name: { type: Type.STRING },
                branch: { type: Type.STRING },
                effective_date: { type: Type.STRING },
              },
              required: ['motor_name', 'dp_amount', 'tenor_months', 'installment_amount'],
            },
          },
        },
        required: ['rows'],
      },
    },
  });

  const parsed = safeParseRowsJson(response.text ?? '{}');
  const extractedRows = parsed.rows;
  const headers = [
    'motor_name',
    'variant',
    'dp_amount',
    'tenor_months',
    'installment_amount',
    'leasing_name',
    'branch',
    'effective_date',
  ];

  const normalizedRows = extractedRows.map((r) => ({
    motor_name: String(r.motor_name ?? '').trim(),
    variant: String(r.variant ?? 'Standard').trim() || 'Standard',
    dp_amount: parseRupiahInt(r.dp_amount),
    tenor_months: parseTenorInt(r.tenor_months),
    installment_amount: parseRupiahInt(r.installment_amount),
    leasing_name: String(r.leasing_name ?? '').trim(),
    branch: String(r.branch ?? '').trim(),
    effective_date: String(r.effective_date ?? '').trim(),
  }));

  return {
    extractionMethod: parsed.extraction_method || 'ocr_vision',
    headers,
    rows: normalizedRows,
  };
}

function readGoogleToken(req: AuthenticatedRequest): string | null {
  const headerVal = String(req.headers['x-google-access-token'] ?? '').trim();
  if (!headerVal) return null;
  return headerVal.startsWith('Bearer ') ? headerVal.slice(7).trim() : headerVal;
}

// ============================================================================
// PDF DISCOUNT EXTRACTION & EXACT/SMART MATCHING HELPERS
// ============================================================================

export interface ExtractedDiscountDraft {
  motor_name: string;
  branch: string;
  discount_type: 'percent' | 'nominal';
  discount_percent: number;
  discount_amount: number;
  min_dp: number;
  tenor_months: number;
  promo_title: string;
  effective_date: string;
}

function normalizeMotorMatchText(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/\bYAMAHA\b/g, ' ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoreMotorMatch(targetMotor: string, ruleMotor: string): number {
  const normTarget = normalizeMotorMatchText(targetMotor);
  const normRule = normalizeMotorMatchText(ruleMotor);
  if (!normTarget || !normRule) return 0;
  if (normTarget === normRule) return 1000;
  if (normRule === 'ALL' || normRule === 'SEMUA' || normRule === 'SEMUA MOTOR') return 50;

  if (normTarget.startsWith(`${normRule} `) || normRule.startsWith(`${normTarget} `)) {
    return 750 + Math.min(normTarget.length, normRule.length);
  }
  if (normTarget.includes(normRule) || normRule.includes(normTarget)) {
    return 600 + Math.min(normTarget.length, normRule.length);
  }

  const targetTokens = new Set(normTarget.split(' ').filter((t) => t.length >= 2));
  const ruleTokens = normRule.split(' ').filter((t) => t.length >= 2);
  if (ruleTokens.length === 0) return 0;

  let matchedCount = 0;
  for (const tok of ruleTokens) {
    if (targetTokens.has(tok)) matchedCount += 1;
  }
  if (matchedCount === ruleTokens.length) {
    return 450 + matchedCount * 40;
  }
  return 0;
}

function extractReadableTextFromPdfBuffer(pdfBuffer: Buffer): string {
  const chunks: string[] = [];
  const rawLatin1 = pdfBuffer.toString('latin1');

  const decodePdfTextOps = (textSource: string): string[] => {
    const out: string[] = [];
    const parenMatches = textSource.match(/\((?:\\.|[^\\()])*\)\s*(?:Tj|'|")/g) || [];
    for (const m of parenMatches) {
      const inner = m.replace(/\)\s*(?:Tj|'|")$/, '').slice(1);
      const unescaped = inner
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, ' ')
        .replace(/\\t/g, ' ')
        .replace(/\\\(/g, '(')
        .replace(/\\\)/g, ')')
        .replace(/\\\\/g, '\\');
      if (unescaped.trim()) out.push(unescaped);
    }
    const arrayMatches = textSource.match(/\[[^\]]*\]\s*TJ/g) || [];
    for (const arr of arrayMatches) {
      const parts = arr.match(/\((?:\\.|[^\\()])*\)/g) || [];
      const joined = parts
        .map((p) =>
          p
            .slice(1, -1)
            .replace(/\\\(/g, '(')
            .replace(/\\\)/g, ')')
            .replace(/\\\\/g, '\\')
        )
        .join('');
      if (joined.trim()) out.push(joined);
    }
    return out;
  };

  chunks.push(...decodePdfTextOps(rawLatin1));

  let searchIdx = 0;
  while (searchIdx < pdfBuffer.length) {
    const streamStart = pdfBuffer.indexOf('stream', searchIdx, 'latin1');
    if (streamStart === -1) break;
    let dataStart = streamStart + 6;
    if (pdfBuffer[dataStart] === 0x0d && pdfBuffer[dataStart + 1] === 0x0a) dataStart += 2;
    else if (pdfBuffer[dataStart] === 0x0a) dataStart += 1;

    const streamEnd = pdfBuffer.indexOf('endstream', dataStart, 'latin1');
    if (streamEnd === -1) break;
    const slice = pdfBuffer.subarray(dataStart, streamEnd);
    try {
      const inflated = zlib.inflateSync(slice).toString('latin1');
      chunks.push(...decodePdfTextOps(inflated));
    } catch {
      // Non-deflate stream
    }
    searchIdx = streamEnd + 9;
  }

  return chunks.join('\n');
}

function parseDiscountsFromPlainText(
  text: string,
  fallbackDate: string
): ExtractedDiscountDraft[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const results: ExtractedDiscountDraft[] = [];
  const seenKeys = new Set<string>();

  for (const line of lines) {
    const pctMatch = line.match(/(\d+(?:[.,]\d+)?)\s*%/);
    const rpMatch = line.match(/(?:Rp\.?\s*)(\d{1,3}(?:[.,]\d{3})+|\d{5,8})/i);
    if (!pctMatch && !rpMatch) continue;

    let branch = '';
    if (/\bpalembang\b/i.test(line)) branch = 'Palembang';
    else if (/\bsumsel\b/i.test(line)) branch = 'Sumsel';
    else if (/\bbengkulu\b|\bbangkulu\b/i.test(line)) branch = 'Bengkulu';

    const tenorMatch = line.match(/(?:tenor\s*|bln\s*)(\d{1,2})\b|\b(\d{1,2})\s*(?:bulan|bln)\b/i);
    const tenorMonths = tenorMatch ? parseTenorInt(tenorMatch[1] || tenorMatch[2]) : 0;

    let discountType: 'percent' | 'nominal' = 'percent';
    let discountPercent = 0;
    let discountAmount = 0;

    if (pctMatch) {
      const pctVal = Number.parseFloat(pctMatch[1].replace(',', '.'));
      if (Number.isFinite(pctVal) && pctVal > 0 && pctVal <= 100) {
        discountType = 'percent';
        discountPercent = Math.round(pctVal * 10) / 10;
      }
    }
    if (rpMatch) {
      const rpVal = parseRupiahInt(rpMatch[1]);
      if (rpVal >= 50000 && (!pctMatch || discountPercent === 0)) {
        discountType = 'nominal';
        discountAmount = rpVal;
      } else if (rpVal >= 50000) {
        discountAmount = rpVal;
      }
    }

    if (discountPercent <= 0 && discountAmount <= 0) continue;

    const cleanedMotor = line
      .replace(/(\d+(?:[.,]\d+)?)\s*%/g, ' ')
      .replace(/(?:Rp\.?\s*)(\d{1,3}(?:[.,]\d{3})+|\d{5,8})/gi, ' ')
      .replace(
        /\b(palembang|sumsel|bengkulu|bangkulu|diskon|potongan|promo|cashback|dp|tenor|bulan|bln|untuk|khusus|wilayah|all)\b/gi,
        ' '
      )
      .replace(/[|;:–—-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanedMotor.length < 2) continue;

    const dedupKey = `${cleanedMotor.toLowerCase()}|${branch.toLowerCase()}|${tenorMonths}`;
    if (seenKeys.has(dedupKey)) continue;
    seenKeys.add(dedupKey);

    results.push({
      motor_name: cleanedMotor,
      branch,
      discount_type: discountType,
      discount_percent: discountPercent,
      discount_amount: discountAmount,
      min_dp: 0,
      tenor_months: tenorMonths,
      promo_title: 'Diskon PDF',
      effective_date: fallbackDate,
    });
  }

  return results;
}

export async function extractPdfDiscountRules(
  pdfBase64: string,
  sourceName: string
): Promise<{
  extractionMethod: string;
  rows: ExtractedDiscountDraft[];
}> {
  const today = new Date().toISOString().slice(0, 10);
  const apiKey = process.env.GEMINI_API_KEY;

  if (apiKey) {
    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              text:
                'Ekstrak aturan diskon DP / potongan DP / subsidi DP / cashback DP motor Yamaha dari dokumen PDF ini (lakukan OCR jika berupa gambar/scan). ' +
                'PENTING: Kelompokkan & ringkas agar RINGKAS tanpa duplikat! Jika 1 tipe motor memiliki diskon DP yang sama di banyak baris angsuran/DP, keluarkan CUKUP 1 baris aturan saja per kombinasi unik (motor_name, branch, tenor_months, nilai diskon). ' +
                'Pada root JSON isi promo_title (judul program singkat) dan effective_date (YYYY-MM-DD). ' +
                'Untuk tiap item di rows, isi: ' +
                '1. motor_name (nama tipe motor Yamaha, misal "AEROX ALPHA", "NEW MIO M3 CW", "NMAX NEO", "FAZZIO", atau "ALL" jika semua motor). ' +
                '2. branch ("Palembang", "Sumsel", atau "Bengkulu" jika disebut khusus; kosong "" jika berlaku semua wilayah). ' +
                '3. discount_type ("percent" jika %, atau "nominal" jika Rp). ' +
                '4. discount_percent (angka %, misal 10; 0 jika nominal Rp). ' +
                '5. discount_amount (integer Rupiah potongan DP, misal 500000; 0 jika persen). ' +
                '6. min_dp (integer minimal DP jika disyaratkan, selain itu 0). ' +
                '7. tenor_months (integer tenor khusus jika ada, selain itu 0 untuk semua tenor). ' +
                'Jangan mengarang angka; ambil hanya angka diskon/potongan DP yang benar-benar tertera di PDF.',
            },
          ],
        },
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              extraction_method: {
                type: Type.STRING,
                description: 'text_table atau ocr_vision',
              },
              promo_title: {
                type: Type.STRING,
                description: 'Judul singkat program promo dari PDF',
              },
              effective_date: {
                type: Type.STRING,
                description: 'Format YYYY-MM-DD',
              },
              rows: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    motor_name: { type: Type.STRING },
                    branch: { type: Type.STRING },
                    discount_type: { type: Type.STRING },
                    discount_percent: { type: Type.NUMBER },
                    discount_amount: { type: Type.INTEGER },
                    min_dp: { type: Type.INTEGER },
                    tenor_months: { type: Type.INTEGER },
                  },
                  required: ['motor_name', 'discount_type'],
                },
              },
            },
            required: ['rows'],
          },
        },
      });

      const parsed = safeParseRowsJson(response.text ?? '{}');
      const rootPromoTitle =
        String(parsed.promo_title ?? '').trim() || sourceName.replace(/\.pdf$/i, '');
      const rootEffectiveDate = normalizeDateStr(parsed.effective_date, today);

      const dedupSet = new Set<string>();
      const mappedRows: ExtractedDiscountDraft[] = [];
      for (const r of parsed.rows) {
        const motorName = String(r.motor_name ?? '').trim();
        const rawType = String(r.discount_type ?? '').trim().toLowerCase();
        const pct = Math.min(100, Math.max(0, Number(r.discount_percent ?? 0) || 0));
        const amt = parseRupiahInt(r.discount_amount);
        const discountType: 'percent' | 'nominal' =
          rawType === 'nominal' || (pct <= 0 && amt > 0) ? 'nominal' : 'percent';
        let branch = String(r.branch ?? '').trim();
        if (/^palembang$/i.test(branch)) branch = 'Palembang';
        else if (/^sumsel$/i.test(branch)) branch = 'Sumsel';
        else if (/^(bengkulu|bangkulu)$/i.test(branch)) branch = 'Bengkulu';
        else if (/^(all|semua|semua wilayah)$/i.test(branch)) branch = '';

        const finalPct = discountType === 'percent' ? Math.round(pct * 10) / 10 : 0;
        const finalAmt = discountType === 'nominal' ? amt : 0;
        if (!motorName || (finalPct <= 0 && finalAmt <= 0)) continue;

        const minDp = parseRupiahInt(r.min_dp);
        const tenorMonths = parseTenorInt(r.tenor_months);
        const dedupKey = `${motorName.toUpperCase()}|${branch.toLowerCase()}|${discountType}|${finalPct}|${finalAmt}|${minDp}|${tenorMonths}`;
        if (dedupSet.has(dedupKey)) continue;
        dedupSet.add(dedupKey);

        mappedRows.push({
          motor_name: motorName,
          branch,
          discount_type: discountType,
          discount_percent: finalPct,
          discount_amount: finalAmt,
          min_dp: minDp,
          tenor_months: tenorMonths,
          promo_title: String(r.promo_title ?? '').trim() || rootPromoTitle,
          effective_date: normalizeDateStr(r.effective_date, rootEffectiveDate),
        });
      }

      if (mappedRows.length > 0) {
        return {
          extractionMethod: parsed.extraction_method || 'ocr_vision',
          rows: mappedRows,
        };
      }
    } catch (geminiErr) {
      console.warn('Gemini PDF discount extraction fallback to native text parser:', geminiErr);
    }
  }

  const rawText = extractReadableTextFromPdfBuffer(Buffer.from(pdfBase64, 'base64'));
  const fallbackRows = parseDiscountsFromPlainText(rawText, today);
  return {
    extractionMethod: 'pdf_text_stream',
    rows: fallbackRows,
  };
}

export function saveDiscountRulesTransaction(params: {
  rules: ExtractedDiscountDraft[];
  sourcePdfId: number | null;
  sourceFile: string;
  replaceExistingForSource: boolean;
  actorUserId: number | null;
  actorName: string;
}): number {
  const now = new Date().toISOString();
  const cleanSource = params.sourceFile.trim() || 'Promo Diskon PDF';

  db.exec('BEGIN');
  try {
    if (params.replaceExistingForSource) {
      if (params.sourcePdfId) {
        db.prepare('DELETE FROM auto_discount_rules WHERE source_pdf_id = ? OR source_file = ?').run(
          params.sourcePdfId,
          cleanSource
        );
      } else {
        db.prepare('DELETE FROM auto_discount_rules WHERE source_file = ?').run(cleanSource);
      }
    }

    const insertStmt = db.prepare(`
      INSERT INTO auto_discount_rules (
        motor_name, branch, discount_type, discount_percent, discount_amount,
        min_dp, tenor_months, promo_title, source_pdf_id, source_file,
        effective_date, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    `);

    let inserted = 0;
    for (const r of params.rules) {
      const motorName = r.motor_name.trim();
      if (!motorName) continue;
      if (r.discount_percent <= 0 && r.discount_amount <= 0) continue;

      insertStmt.run(
        motorName,
        r.branch.trim(),
        r.discount_type,
        r.discount_type === 'percent' ? Math.min(100, Math.max(0, r.discount_percent)) : 0,
        r.discount_type === 'nominal' ? Math.max(0, Math.round(r.discount_amount)) : 0,
        Math.max(0, Math.round(r.min_dp || 0)),
        Math.max(0, Math.round(r.tenor_months || 0)),
        (r.promo_title || '').trim(),
        params.sourcePdfId,
        cleanSource,
        normalizeDateStr(r.effective_date, now.slice(0, 10)),
        now,
        now
      );
      inserted += 1;
    }

    db.prepare(`
      INSERT INTO auto_change_logs (batch_id, action, actor_user_id, actor_name, details, created_at)
      VALUES (NULL, 'pdf_discount_import', ?, ?, ?, ?)
    `).run(
      params.actorUserId,
      params.actorName,
      `Impor ${inserted} aturan diskon DP dari PDF "${cleanSource}".`,
      now
    );

    db.exec('COMMIT');
    return inserted;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function findMatchingDiscountRule(
  motorName: string,
  branch: string,
  dpAmount: number,
  tenorMonths: number
): MatchedDiscountInfo | null {
  const rows = db
    .prepare(`
      SELECT *
      FROM auto_discount_rules
      WHERE is_active = 1 AND TRIM(source_file) != ''
      ORDER BY updated_at DESC, id DESC
    `)
    .all() as Array<Record<string, unknown>>;

  if (rows.length === 0) return null;

  const targetBranch = branch.trim().toLowerCase();
  let bestScore = -1;
  let bestRow: Record<string, unknown> | null = null;

  for (const row of rows) {
    const motorScore = scoreMotorMatch(motorName, String(row.motor_name ?? ''));
    if (motorScore <= 0) continue;

    const ruleBranch = String(row.branch ?? '').trim().toLowerCase();
    let branchScore = 0;
    if (ruleBranch) {
      if (!targetBranch || ruleBranch !== targetBranch) continue;
      branchScore = 120;
    } else {
      branchScore = 20;
    }

    const ruleTenor = Number(row.tenor_months ?? 0);
    let tenorScore = 0;
    if (ruleTenor > 0) {
      if (tenorMonths <= 0 || ruleTenor !== tenorMonths) continue;
      tenorScore = 60;
    } else {
      tenorScore = 10;
    }

    const ruleMinDp = Number(row.min_dp ?? 0);
    if (ruleMinDp > 0 && dpAmount < ruleMinDp) continue;
    const dpScore = ruleMinDp > 0 ? 25 : 0;

    const totalScore = motorScore + branchScore + tenorScore + dpScore;
    if (totalScore > bestScore) {
      bestScore = totalScore;
      bestRow = row;
    }
  }

  if (!bestRow) return null;

  const discountType = String(bestRow.discount_type) === 'nominal' ? 'nominal' : 'percent';
  const rawPercent = Number(bestRow.discount_percent ?? 0);
  const rawNominal = Number(bestRow.discount_amount ?? 0);

  let computedAmount = 0;
  let computedPercent = 0;

  if (discountType === 'percent') {
    computedPercent = Math.min(100, Math.max(0, Math.round(rawPercent * 10) / 10));
    computedAmount =
      dpAmount > 0 ? Math.min(dpAmount, Math.round((dpAmount * computedPercent) / 100)) : 0;
  } else {
    computedAmount =
      dpAmount > 0
        ? Math.min(dpAmount, Math.max(0, Math.round(rawNominal)))
        : Math.max(0, Math.round(rawNominal));
    computedPercent =
      dpAmount > 0 ? Math.round((computedAmount / dpAmount) * 1000) / 10 : 0;
  }

  if (computedAmount <= 0 && computedPercent <= 0) return null;

  return {
    id: Number(bestRow.id),
    motor_name: String(bestRow.motor_name),
    branch: String(bestRow.branch ?? ''),
    discount_type: discountType,
    discount_percent: computedPercent,
    discount_amount: computedAmount,
    promo_title: String(bestRow.promo_title ?? ''),
    source_file: String(bestRow.source_file),
    effective_date: String(bestRow.effective_date),
  };
}

export function createAutoInstallmentsRouter(): Router {
  const router = Router();

  // ==========================================================================
  // PUBLIC SEARCH ENGINE ROUTES (EXACT MATCHING ONLY — NO ESTIMATION FORMULAS)
  // ==========================================================================

  router.get('/api/auto-installments/options', (req, res) => {
    try {
      const branchFilter = String(req.query.branch ?? '').trim();
      const categoryFilter = normalizeAutoCategory(req.query.category);

      const branchRows = db
        .prepare(`
          SELECT DISTINCT TRIM(branch) AS branch
          FROM auto_installment_records
          WHERE is_active = 1 AND TRIM(source_file) != '' AND TRIM(branch) != '' AND category = ?
          ORDER BY TRIM(branch) ASC
        `)
        .all(categoryFilter) as Array<{ branch: string }>;
      const branches = branchRows.map((b) => b.branch);

      const baseWhereClauses = ['r.is_active = 1', "TRIM(r.source_file) != ''", 'r.category = ?'];
      const whereClauses = [...baseWhereClauses];
      const params: Array<string> = [categoryFilter];
      if (branchFilter) {
        whereClauses.push(
          "(LOWER(TRIM(r.branch)) = LOWER(TRIM(?)) OR LOWER(TRIM(r.branch)) IN ('semua wilayah', ''))"
        );
        params.push(branchFilter);
      }

      let rows = db
        .prepare(`
          SELECT
            r.motor_name,
            r.variant,
            r.dp_amount,
            r.tenor_months,
            r.leasing_name,
            r.branch
          FROM auto_installment_records r
          WHERE ${whereClauses.join(' AND ')}
          ORDER BY r.motor_name ASC, r.variant ASC, r.dp_amount ASC, r.tenor_months ASC
        `)
        .all(...params) as Array<{
          motor_name: string;
          variant: string;
          dp_amount: number;
          tenor_months: number;
          leasing_name: string;
          branch: string;
        }>;

      let fallbackNote: string | null = null;
      if (rows.length === 0 && branchFilter && categoryFilter === 'reguler') {
        const allRegulerRows = db
          .prepare(`
            SELECT
              r.motor_name,
              r.variant,
              r.dp_amount,
              r.tenor_months,
              r.leasing_name,
              r.branch
            FROM auto_installment_records r
            WHERE ${baseWhereClauses.join(' AND ')}
            ORDER BY r.motor_name ASC, r.variant ASC, r.dp_amount ASC, r.tenor_months ASC
          `)
          .all(categoryFilter) as typeof rows;

        if (allRegulerRows.length > 0) {
          rows = allRegulerRows;
          const availLabel = branches.length > 0 ? branches.join(', ') : 'Excel Reguler';
          fallbackNote = `File Excel Reguler belum memisahkan sheet ${branchFilter}; menampilkan data Reguler yang tersedia (${availLabel}).`;
        }
      }

      const catalogImgs = db
        .prepare('SELECT motor_name, variant, image_url FROM motor_products WHERE is_active = 1')
        .all() as Array<{ motor_name: string; variant: string; image_url: string }>;

      const motorMap = new Map<
        string,
        {
          motor_name: string;
          variants: Set<string>;
          image_url: string;
          dps: Set<number>;
          tenors: Set<number>;
          leasings: Set<string>;
          branches: Set<string>;
          dpTenors: Map<number, Set<number>>;
        }
      >();

      for (const r of rows) {
        let entry = motorMap.get(r.motor_name);
        if (!entry) {
          const imgMatch =
            catalogImgs.find(
              (c) =>
                c.motor_name.toLowerCase() === r.motor_name.toLowerCase() &&
                c.image_url
            )?.image_url || '';
          entry = {
            motor_name: r.motor_name,
            variants: new Set<string>(),
            image_url: imgMatch,
            dps: new Set<number>(),
            tenors: new Set<number>(),
            leasings: new Set<string>(),
            branches: new Set<string>(),
            dpTenors: new Map<number, Set<number>>(),
          };
          motorMap.set(r.motor_name, entry);
        }
        entry.variants.add(r.variant || 'Standard');
        entry.dps.add(r.dp_amount);
        entry.tenors.add(r.tenor_months);
        let tSet = entry.dpTenors.get(r.dp_amount);
        if (!tSet) {
          tSet = new Set<number>();
          entry.dpTenors.set(r.dp_amount, tSet);
        }
        tSet.add(r.tenor_months);
        if (r.leasing_name) entry.leasings.add(r.leasing_name);
        if (r.branch) entry.branches.add(r.branch);
      }

      const motors = Array.from(motorMap.values()).map((m) => {
        const dpTenorsObj: Record<number, number[]> = {};
        for (const [dpVal, tSet] of m.dpTenors.entries()) {
          dpTenorsObj[dpVal] = Array.from(tSet).sort((a, b) => a - b);
        }
        return {
          motor_name: m.motor_name,
          variants: Array.from(m.variants),
          image_url: m.image_url,
          dps: Array.from(m.dps).sort((a, b) => a - b),
          tenors: Array.from(m.tenors).sort((a, b) => a - b),
          leasings: Array.from(m.leasings).sort(),
          branches: Array.from(m.branches).sort(),
          dp_tenors: dpTenorsObj,
        };
      });

      res.json({
        category: categoryFilter,
        branches,
        fallback_note: fallbackNote,
        motors,
      });
    } catch (err) {
      console.error('GET /api/auto-installments/options error:', err);
      res.status(500).json({ error: 'Gagal memuat pilihan database angsuran otomatis.' });
    }
  });

  router.get('/api/auto-installments/search', (req, res) => {
    try {
      const category = normalizeAutoCategory(req.query.category);
      const motorName = String(req.query.motor_name ?? '').trim();
      const variant = String(req.query.variant ?? '').trim();
      const dpAmount = parseRupiahInt(req.query.dp_amount);
      const tenorMonths = parseTenorInt(req.query.tenor_months);
      const leasingName = String(req.query.leasing_name ?? '').trim();
      const branch = String(req.query.branch ?? '').trim();

      if (!motorName || dpAmount <= 0 || tenorMonths <= 0) {
        res.status(400).json({
          error: 'Parameter motor_name, dp_amount, dan tenor_months wajib diisi dengan valid.',
        });
        return;
      }

      const buildConditions = (useBranch: boolean, exactBranch?: string) => {
        const conds = [
          'LOWER(TRIM(motor_name)) = LOWER(TRIM(?))',
          'dp_amount = ?',
          'tenor_months = ?',
          'is_active = 1',
          "TRIM(source_file) != ''",
          'category = ?',
        ];
        const prms: Array<string | number> = [motorName, dpAmount, tenorMonths, category];

        if (variant) {
          conds.push('LOWER(TRIM(variant)) = LOWER(TRIM(?))');
          prms.push(variant);
        }
        if (leasingName) {
          conds.push('LOWER(TRIM(leasing_name)) = LOWER(TRIM(?))');
          prms.push(leasingName);
        }
        if (useBranch && exactBranch) {
          conds.push(
            "(LOWER(TRIM(branch)) = LOWER(TRIM(?)) OR LOWER(TRIM(branch)) IN ('semua wilayah', ''))"
          );
          prms.push(exactBranch);
        }
        return { conds, prms };
      };

      const { conds, prms } = buildConditions(Boolean(branch), branch);
      let matches = db
        .prepare(`
          SELECT *
          FROM auto_installment_records
          WHERE ${conds.join(' AND ')}
          ORDER BY CASE WHEN LOWER(TRIM(branch)) = LOWER(TRIM(?)) THEN 0 ELSE 1 END, updated_at DESC, id DESC
        `)
        .all(...prms, branch || '') as Array<Record<string, unknown>>;

      let fallbackNote: string | null = null;

      // For Reguler: if requested branch has 0 records for this category/motor, fall back to available Reguler records
      if (matches.length === 0 && branch && category === 'reguler') {
        const branchHasAnyReguler = db
          .prepare(`
            SELECT 1 FROM auto_installment_records
            WHERE category = 'reguler' AND is_active = 1 AND TRIM(source_file) != ''
              AND (LOWER(TRIM(branch)) = LOWER(TRIM(?)) OR LOWER(TRIM(branch)) IN ('semua wilayah', ''))
            LIMIT 1
          `)
          .get(branch);

        if (!branchHasAnyReguler) {
          const fb = buildConditions(false);
          matches = db
            .prepare(`
              SELECT *
              FROM auto_installment_records
              WHERE ${fb.conds.join(' AND ')}
              ORDER BY updated_at DESC, id DESC
            `)
            .all(...fb.prms) as Array<Record<string, unknown>>;
          if (matches.length > 0) {
            fallbackNote = `Menampilkan data Reguler dari wilayah "${String(matches[0].branch || 'Umum')}" karena data khusus ${branch} tidak dipisahkan di Excel.`;
          }
        }
      }

      const catalogImgRow = db
        .prepare(`
          SELECT image_url FROM motor_products
          WHERE LOWER(TRIM(motor_name)) = LOWER(TRIM(?)) AND TRIM(image_url) != ''
          ORDER BY CASE WHEN LOWER(TRIM(variant)) = LOWER(TRIM(?)) THEN 0 ELSE 1 END, id ASC
          LIMIT 1
        `)
        .get(motorName, variant || 'Standard') as { image_url: string } | undefined;

      const imageUrl = catalogImgRow?.image_url || '';

      const mapRecord = (r: Record<string, unknown>): AutoInstallmentRecord => ({
        id: Number(r.id),
        motor_name: String(r.motor_name),
        variant: String(r.variant),
        dp_amount: Number(r.dp_amount),
        tenor_months: Number(r.tenor_months),
        installment_amount: Number(r.installment_amount),
        leasing_name: String(r.leasing_name),
        branch: String(r.branch),
        effective_date: String(r.effective_date),
        is_active: Number(r.is_active) === 1,
        source_file: String(r.source_file),
        category: normalizeAutoCategory(r.category),
        batch_id: r.batch_id !== null && r.batch_id !== undefined ? Number(r.batch_id) : null,
        created_at: String(r.created_at),
        updated_at: String(r.updated_at),
        image_url: imageUrl,
      });

      const matchedDiscount =
        category === 'promo'
          ? findMatchingDiscountRule(motorName, branch, dpAmount, tenorMonths)
          : null;

      if (matches.length === 0) {
        // Check available DPs & tenors for this motor so we give helpful 1-click choices instead of a dead end
        const scopeConds = [
          'LOWER(TRIM(motor_name)) = LOWER(TRIM(?))',
          'is_active = 1',
          "TRIM(source_file) != ''",
          'category = ?',
        ];
        const scopeParams: Array<string | number> = [motorName, category];
        if (variant) {
          scopeConds.push('LOWER(TRIM(variant)) = LOWER(TRIM(?))');
          scopeParams.push(variant);
        }
        if (branch && category === 'promo') {
          scopeConds.push(
            "(LOWER(TRIM(branch)) = LOWER(TRIM(?)) OR LOWER(TRIM(branch)) IN ('semua wilayah', ''))"
          );
          scopeParams.push(branch);
        }

        const dpRows = db
          .prepare(`
            SELECT DISTINCT dp_amount
            FROM auto_installment_records
            WHERE ${scopeConds.join(' AND ')}
            ORDER BY dp_amount ASC
          `)
          .all(...scopeParams) as Array<{ dp_amount: number }>;
        const availableDps = dpRows.map((d) => Number(d.dp_amount));
        const exactDpExists = availableDps.includes(dpAmount);

        const nearestDps = [...availableDps]
          .sort((a, b) => {
            const diffA = Math.abs(a - dpAmount);
            const diffB = Math.abs(b - dpAmount);
            return diffA !== diffB ? diffA - diffB : a - b;
          })
          .slice(0, 4);

        let availableTenorsForDp: number[] = [];
        let dpRelatedRows: Array<Record<string, unknown>> = [];
        if (exactDpExists) {
          dpRelatedRows = db
            .prepare(`
              SELECT *
              FROM auto_installment_records
              WHERE ${scopeConds.join(' AND ')} AND dp_amount = ?
              ORDER BY tenor_months ASC
            `)
            .all(...scopeParams, dpAmount) as Array<Record<string, unknown>>;
          availableTenorsForDp = Array.from(
            new Set(dpRelatedRows.map((r) => Number(r.tenor_months)))
          ).sort((a, b) => a - b);
        }

        let helpfulMessage: string;
        if (availableDps.length === 0) {
          helpfulMessage =
            category === 'reguler'
              ? 'Data angsuran kategori Reguler belum tersedia. Silakan upload Excel Reguler di menu Akun / Admin.'
              : 'Data angsuran belum tersedia. Silakan hubungi admin.';
        } else if (!exactDpExists) {
          helpfulMessage = `Nominal DP Rp${dpAmount.toLocaleString('id-ID')} tidak tersedia di pricelist ${motorName}. Silakan pilih DP terdekat yang tersedia di bawah.`;
        } else {
          helpfulMessage = `Tenor ${tenorMonths} bulan tidak tersedia untuk DP ini. Silakan pilih tenor yang tersedia (${availableTenorsForDp.join(', ')} bulan).`;
        }

        res.json({
          found: false,
          message: helpfulMessage,
          category,
          motor_name: motorName,
          variant: variant || 'Standard',
          dp_amount: dpAmount,
          tenor_months: tenorMonths,
          leasing_name: leasingName,
          branch,
          image_url: imageUrl,
          matched_record: null,
          matched_discount: matchedDiscount,
          all_matching_leasings: [],
          related_tenors: dpRelatedRows.map(mapRecord),
          available_dps: availableDps,
          nearest_dps: exactDpExists ? [] : nearestDps,
          available_tenors_for_dp: availableTenorsForDp,
          fallback_note: fallbackNote,
        });
        return;
      }

      const mappedMatches = matches.map(mapRecord);
      const primary = mappedMatches[0];
      const finalMatchedDiscount =
        category === 'promo'
          ? findMatchingDiscountRule(
              primary.motor_name,
              primary.branch || branch,
              primary.dp_amount,
              primary.tenor_months
            )
          : null;

      // Fetch all related tenors for the exact motor + variant + dp + leasing + branch + category
      const relatedRows = db
        .prepare(`
          SELECT *
          FROM auto_installment_records
          WHERE LOWER(TRIM(motor_name)) = LOWER(TRIM(?))
            AND LOWER(TRIM(variant)) = LOWER(TRIM(?))
            AND dp_amount = ?
            AND LOWER(TRIM(leasing_name)) = LOWER(TRIM(?))
            AND LOWER(TRIM(branch)) = LOWER(TRIM(?))
            AND category = ?
            AND is_active = 1
            AND TRIM(source_file) != ''
          ORDER BY tenor_months ASC
        `)
        .all(
          primary.motor_name,
          primary.variant,
          primary.dp_amount,
          primary.leasing_name,
          primary.branch,
          category
        ) as Array<Record<string, unknown>>;

      res.json({
        found: true,
        message: null,
        category,
        motor_name: primary.motor_name,
        variant: primary.variant,
        dp_amount: primary.dp_amount,
        tenor_months: primary.tenor_months,
        leasing_name: primary.leasing_name,
        branch: primary.branch,
        image_url: imageUrl,
        matched_record: primary,
        matched_discount: finalMatchedDiscount,
        all_matching_leasings: mappedMatches,
        related_tenors: relatedRows.map(mapRecord),
        available_tenors_for_dp: Array.from(
          new Set(relatedRows.map((r) => Number(r.tenor_months)))
        ).sort((a, b) => a - b),
        fallback_note: fallbackNote,
      });
    } catch (err) {
      console.error('GET /api/auto-installments/search error:', err);
      res.status(500).json({ error: 'Gagal mencari data angsuran dari database.' });
    }
  });

  // ==========================================================================
  // ADMIN ROUTES (RBAC PROTECTED: SUPER ADMIN & ADMIN ONLY)
  // ==========================================================================

  router.post(
    '/api/admin/auto-installments/parse-file',
    requireAuth,
    requireRole('super_admin', 'admin'),
    async (req, res) => {
      try {
        const filename = String(req.body?.filename ?? '').trim();
        const fileBase64 = String(req.body?.fileBase64 ?? '').trim();
        const requestedSheet = String(req.body?.sheetName ?? '').trim();

        if (!filename || !fileBase64) {
          res.status(400).json({ error: 'File dan nama file wajib disertakan.' });
          return;
        }

        const ext = filename.toLowerCase().split('.').pop() || '';
        const buffer = Buffer.from(fileBase64, 'base64');

        if (buffer.length === 0) {
          res.status(400).json({ error: 'File yang diunggah kosong.' });
          return;
        }
        if (buffer.length > 15 * 1024 * 1024) {
          res.status(400).json({ error: 'Ukuran file maksimal 15 MB.' });
          return;
        }

        if (ext === 'pdf') {
          const pdfMagic = buffer.subarray(0, 4).toString('ascii');
          if (pdfMagic !== '%PDF') {
            res.status(400).json({ error: 'File PDF tidak valid atau rusak.' });
            return;
          }
          const extracted = await extractPdfInstallmentTables(fileBase64);
          if (extracted.rows.length === 0) {
            res.status(422).json({
              error: 'Tidak ditemukan tabel angsuran yang terbaca di file PDF ini.',
            });
            return;
          }
          res.json({
            source_type: 'pdf',
            source_name: filename,
            sheet_names: ['PDF Ekstraksi'],
            active_sheet: 'PDF Ekstraksi',
            headers: extracted.headers,
            rows: extracted.rows,
            suggested_mapping: detectAutoColumnMapping(extracted.headers),
            extraction_method: extracted.extractionMethod,
          });
          return;
        }

        if (!['xlsx', 'xls', 'csv', 'ods', 'tsv'].includes(ext)) {
          res.status(400).json({
            error: 'Format file tidak didukung. Gunakan Excel (.xlsx, .xls), CSV (.csv), atau PDF (.pdf).',
          });
          return;
        }

        const parsedWorkbook = parseExcelWorkbookBuffer(buffer, requestedSheet);
        if (parsedWorkbook.sheetNames.length === 0) {
          res.status(400).json({ error: 'File spreadsheet tidak memiliki sheet data.' });
          return;
        }

        res.json({
          source_type: ext === 'csv' || ext === 'tsv' ? 'csv' : 'excel',
          source_name: filename,
          sheet_names: parsedWorkbook.sheetNames,
          active_sheet: parsedWorkbook.activeSheet,
          sheet_stats: parsedWorkbook.sheetStats,
          headers: parsedWorkbook.headers,
          rows: parsedWorkbook.rows,
          suggested_mapping: parsedWorkbook.suggestedMapping,
        });
      } catch (err) {
        console.error('POST /api/admin/auto-installments/parse-file error:', err);
        res.status(500).json({
          error:
            err instanceof Error
              ? err.message
              : 'Gagal membaca atau mengekstrak tabel dari file.',
        });
      }
    }
  );

  // Google Sheets Official API Proxy (receives short-lived access token from client via X-Google-Access-Token)
  router.post(
    '/api/admin/auto-installments/google-sheets/metadata',
    requireAuth,
    requireRole('super_admin', 'admin'),
    async (req: AuthenticatedRequest, res) => {
      try {
        const googleToken = readGoogleToken(req);
        if (!googleToken) {
          res.status(401).json({ error: 'Silakan masuk dengan Google terlebih dahulu untuk membaca Google Sheets.' });
          return;
        }
        const spreadsheetId = String(req.body?.spreadsheetId ?? '').trim();
        if (!spreadsheetId || !/^[a-zA-Z0-9-_]+$/.test(spreadsheetId)) {
          res.status(400).json({ error: 'ID Spreadsheet Google Sheets tidak valid.' });
          return;
        }

        const gsRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=properties.title,sheets.properties.title`,
          {
            headers: { Authorization: `Bearer ${googleToken}` },
          }
        );
        const gsData = await gsRes.json();
        if (!gsRes.ok) {
          res.status(gsRes.status).json({
            error:
              gsData?.error?.message ||
              'Gagal mengakses metadata Google Sheets. Pastikan akun Google Anda memiliki akses ke sheet ini.',
          });
          return;
        }

        const sheetNames = Array.isArray(gsData.sheets)
          ? gsData.sheets.map((s: { properties?: { title?: string } }) => String(s?.properties?.title ?? ''))
          : [];

        res.json({
          spreadsheet_id: spreadsheetId,
          title: String(gsData?.properties?.title ?? 'Google Sheets'),
          sheet_names: sheetNames.filter(Boolean),
        });
      } catch (err) {
        console.error('google-sheets/metadata error:', err);
        res.status(500).json({ error: 'Gagal menghubungi API resmi Google Sheets.' });
      }
    }
  );

  router.post(
    '/api/admin/auto-installments/google-sheets/read',
    requireAuth,
    requireRole('super_admin', 'admin'),
    async (req: AuthenticatedRequest, res) => {
      try {
        const googleToken = readGoogleToken(req);
        if (!googleToken) {
          res.status(401).json({ error: 'Token Google Sheets tidak ditemukan. Silakan hubungkan ulang akun Google.' });
          return;
        }
        const spreadsheetId = String(req.body?.spreadsheetId ?? '').trim();
        const sheetName = String(req.body?.sheetName ?? '').trim();
        const spreadsheetTitle = String(req.body?.spreadsheetTitle ?? 'Google Sheets').trim();
        const sheetNames = Array.isArray(req.body?.sheetNames)
          ? req.body.sheetNames.map(String)
          : sheetName
          ? [sheetName]
          : [];

        if (!spreadsheetId || !/^[a-zA-Z0-9-_]+$/.test(spreadsheetId) || !sheetName) {
          res.status(400).json({ error: 'Spreadsheet ID dan nama tab sheet wajib dipilih.' });
          return;
        }

        if (sheetName === '__ALL__' && sheetNames.length > 0) {
          const headerSet = new Set<string>();
          const combinedRows: Array<Record<string, unknown>> = [];
          const sheetStats: Array<{ sheet_name: string; row_count: number }> = [];

          for (const tab of sheetNames) {
            const encodedRange = encodeURIComponent(`'${tab.replace(/'/g, "''")}'!A1:Z5000`);
            const valRes = await fetch(
              `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`,
              { headers: { Authorization: `Bearer ${googleToken}` } }
            );
            const valData = await valRes.json();
            if (!valRes.ok) continue;
            const matrix = Array.isArray(valData.values) ? (valData.values as unknown[][]) : [];
            const rawExtracted = extractTableFromMatrix(matrix, tab, { attachSheetColumn: true });
            const extracted =
              sheetNames.length > 1 ? canonicalizeSheetExtraction(rawExtracted, tab) : rawExtracted;
            sheetStats.push({ sheet_name: tab, row_count: extracted.rows.length });
            for (const h of extracted.headers) headerSet.add(h);
            combinedRows.push(...extracted.rows);
          }

          const headers = Array.from(headerSet);
          const suggested = detectAutoColumnMapping(headers);
          if (!suggested.branch && headers.includes('Wilayah (Sheet)')) {
            suggested.branch = 'Wilayah (Sheet)';
          }

          res.json({
            source_type: 'google_sheets',
            source_name: `${spreadsheetTitle} (Semua Tab: ${sheetNames.join(', ')})`,
            sheet_names: sheetNames,
            active_sheet: '__ALL__',
            sheet_stats: sheetStats,
            headers,
            rows: combinedRows,
            suggested_mapping: suggested,
          });
          return;
        }

        const encodedRange = encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'!A1:Z5000`);
        const valRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}`,
          {
            headers: { Authorization: `Bearer ${googleToken}` },
          }
        );
        const valData = await valRes.json();
        if (!valRes.ok) {
          res.status(valRes.status).json({
            error: valData?.error?.message || 'Gagal membaca data dari tab Google Sheets.',
          });
          return;
        }

        const matrix = Array.isArray(valData.values) ? (valData.values as unknown[][]) : [];
        const parsed = buildMatrixResponse(
          'google_sheets',
          `${spreadsheetTitle} (${sheetName})`,
          sheetNames,
          sheetName,
          matrix,
          sheetNames.length > 1 || !/^sheet\d+$/i.test(sheetName)
        );
        res.json(parsed);
      } catch (err) {
        console.error('google-sheets/read error:', err);
        res.status(500).json({ error: 'Gagal membaca baris data dari Google Sheets.' });
      }
    }
  );

  router.post(
    '/api/admin/auto-installments/validate',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (req, res) => {
      try {
        const rawRows = Array.isArray(req.body?.rows)
          ? (req.body.rows as Array<Record<string, unknown>>)
          : [];
        const mapping = req.body?.mapping as AutoColumnMapping | undefined;
        const category = normalizeAutoCategory(req.body?.category);
        const defaultLeasing = String(req.body?.defaultLeasing ?? 'BAF Finance').trim();
        const defaultBranch = String(req.body?.defaultBranch ?? 'Palembang').trim();
        const defaultEffectiveDate = normalizeDateStr(
          req.body?.defaultEffectiveDate,
          new Date().toISOString().slice(0, 10)
        );

        if (!mapping || rawRows.length === 0) {
          res.status(400).json({ error: 'Data baris atau mapping kolom belum tersedia.' });
          return;
        }

        const summary = mapAndValidateRows({
          rawRows,
          mapping,
          defaultLeasing,
          defaultBranch,
          defaultEffectiveDate,
          category,
        });

        res.json({
          total_normalized: summary.rows.length,
          new_count: summary.new_count,
          update_count: summary.update_count,
          duplicate_in_file_count: summary.duplicate_in_file_count,
          invalid_count: summary.invalid_count,
          rows: summary.rows,
        });
      } catch (err) {
        console.error('POST /api/admin/auto-installments/validate error:', err);
        res.status(500).json({ error: 'Gagal memvalidasi data import.' });
      }
    }
  );

  router.post(
    '/api/admin/auto-installments/confirm-import',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (req: AuthenticatedRequest, res) => {
      try {
        const sourceType = String(req.body?.sourceType ?? 'excel');
        const sourceName = String(req.body?.sourceName ?? '').trim();
        const category = normalizeAutoCategory(req.body?.category);
        const rawRows = Array.isArray(req.body?.rows)
          ? (req.body.rows as Array<Record<string, unknown>>)
          : [];
        const mapping = req.body?.mapping as AutoColumnMapping | undefined;
        const defaultLeasing = String(req.body?.defaultLeasing ?? 'BAF Finance').trim();
        const defaultBranch = String(req.body?.defaultBranch ?? 'Palembang').trim();
        const defaultEffectiveDate = normalizeDateStr(
          req.body?.defaultEffectiveDate,
          new Date().toISOString().slice(0, 10)
        );
        const importMode = (req.body?.importMode as AutoImportMode) || 'upsert';
        const notes = String(req.body?.notes ?? '').trim();

        if (!sourceName || !mapping || rawRows.length === 0) {
          res.status(400).json({ error: 'Nama sumber file, mapping, dan baris data wajib lengkap.' });
          return;
        }
        if (!['excel', 'csv', 'google_sheets', 'pdf'].includes(sourceType)) {
          res.status(400).json({ error: 'Tipe sumber import tidak valid.' });
          return;
        }

        // Step 1: Validate BEFORE deleting or modifying any existing database rows
        const summary = mapAndValidateRows({
          rawRows,
          mapping,
          defaultLeasing,
          defaultBranch,
          defaultEffectiveDate,
          category,
        });

        const validRows = summary.rows.filter(
          (r) =>
            r.status === 'new' ||
            (r.status === 'update' && importMode !== 'skip_existing')
        );

        if (validRows.length === 0) {
          res.status(400).json({
            error:
              'Tidak ada baris valid yang siap disimpan (semua baris invalid atau duplikat dilewati). Data lama tetap aman tidak berubah.',
          });
          return;
        }

        const now = new Date().toISOString();

        // Step 2: Execute inside safe database transaction with rollback snapshot
        db.exec('BEGIN');
        try {
          const snapshotBefore: Array<Record<string, unknown>> = [];

          if (importMode === 'replace_source') {
            const oldSourceRows = db
              .prepare('SELECT * FROM auto_installment_records WHERE source_file = ? AND category = ?')
              .all(sourceName, category) as Array<Record<string, unknown>>;
            snapshotBefore.push(...oldSourceRows);
            db.prepare('DELETE FROM auto_installment_records WHERE source_file = ? AND category = ?').run(
              sourceName,
              category
            );
          } else if (importMode === 'upsert') {
            const findExisting = db.prepare(`
              SELECT * FROM auto_installment_records
              WHERE LOWER(TRIM(motor_name)) = LOWER(TRIM(?))
                AND LOWER(TRIM(variant)) = LOWER(TRIM(?))
                AND dp_amount = ?
                AND tenor_months = ?
                AND LOWER(TRIM(leasing_name)) = LOWER(TRIM(?))
                AND LOWER(TRIM(branch)) = LOWER(TRIM(?))
                AND category = ?
            `);
            for (const row of validRows) {
              if (row.status === 'update') {
                const prev = findExisting.get(
                  row.motor_name,
                  row.variant,
                  row.dp_amount,
                  row.tenor_months,
                  row.leasing_name,
                  row.branch,
                  category
                ) as Record<string, unknown> | undefined;
                if (prev) snapshotBefore.push(prev);
              }
            }
          }

          let insertedCount = 0;
          let updatedCount = 0;
          const skippedCount =
            summary.duplicate_in_file_count +
            summary.invalid_count +
            (importMode === 'skip_existing' ? summary.update_count : 0);

          const batchInsert = db.prepare(`
            INSERT INTO auto_import_batches (
              source_type, source_name, category, leasing_default, branch_default, effective_date,
              import_mode, total_rows, inserted_count, updated_count, skipped_duplicates,
              column_mapping_json, snapshot_before_json, status, uploaded_by_user_id, uploaded_by_name,
              notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, 'completed', ?, ?, ?, ?)
          `);

          const batchRes = batchInsert.run(
            sourceType,
            sourceName,
            category,
            defaultLeasing,
            defaultBranch,
            defaultEffectiveDate,
            importMode,
            summary.rows.length,
            skippedCount,
            JSON.stringify(mapping),
            JSON.stringify(snapshotBefore),
            req.user!.id,
            req.user!.name,
            notes,
            now
          );
          const batchId = Number(batchRes.lastInsertRowid);

          const upsertStmt = db.prepare(`
            INSERT INTO auto_installment_records (
              motor_name, variant, dp_amount, tenor_months, installment_amount,
              leasing_name, branch, effective_date, is_active, source_file, category, batch_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(motor_name, variant, dp_amount, tenor_months, leasing_name, branch, category) DO UPDATE SET
              installment_amount = excluded.installment_amount,
              effective_date = excluded.effective_date,
              is_active = excluded.is_active,
              source_file = excluded.source_file,
              batch_id = excluded.batch_id,
              updated_at = excluded.updated_at
          `);

          for (const row of validRows) {
            upsertStmt.run(
              row.motor_name,
              row.variant,
              Math.round(row.dp_amount),
              Math.round(row.tenor_months),
              Math.round(row.installment_amount),
              row.leasing_name,
              row.branch,
              row.effective_date,
              row.is_active ? 1 : 0,
              sourceName,
              category,
              batchId,
              now,
              now
            );
            if (row.status === 'update' && importMode !== 'replace_source') {
              updatedCount++;
            } else {
              insertedCount++;
            }
          }

          db.prepare(
            'UPDATE auto_import_batches SET inserted_count = ?, updated_count = ? WHERE id = ?'
          ).run(insertedCount, updatedCount, batchId);

          db.prepare(`
            INSERT INTO auto_change_logs (batch_id, action, actor_user_id, actor_name, details, created_at)
            VALUES (?, 'import_confirmed', ?, ?, ?, ?)
          `).run(
            batchId,
            req.user!.id,
            req.user!.name,
            `Import ${sourceType.toUpperCase()} [${category.toUpperCase()}] dari "${sourceName}": ${insertedCount} baru, ${updatedCount} diperbarui, ${skippedCount} dilewati.`,
            now
          );

          db.exec('COMMIT');
          res.status(201).json({
            success: true,
            batch_id: batchId,
            category,
            inserted_count: insertedCount,
            updated_count: updatedCount,
            skipped_count: skippedCount,
          });
        } catch (txErr) {
          db.exec('ROLLBACK');
          throw txErr;
        }
      } catch (err) {
        console.error('POST /api/admin/auto-installments/confirm-import error:', err);
        res.status(500).json({ error: 'Gagal menyimpan data import. Transaksi di-rollback.' });
      }
    }
  );

  router.get(
    '/api/admin/auto-installments/records',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (req, res) => {
      try {
        const search = String(req.query.search ?? '').trim().toLowerCase();
        const leasing = String(req.query.leasing ?? '').trim();
        const branch = String(req.query.branch ?? '').trim();
        const status = String(req.query.status ?? 'all').trim();
        const rawCategory = String(req.query.category ?? '').trim().toLowerCase();

        const conditions: string[] = [];
        const params: Array<string | number> = [];

        if (rawCategory === 'promo' || rawCategory === 'reguler') {
          conditions.push('category = ?');
          params.push(rawCategory);
        }
        if (search) {
          conditions.push(
            '(LOWER(motor_name) LIKE ? OR LOWER(variant) LIKE ? OR LOWER(leasing_name) LIKE ? OR LOWER(branch) LIKE ? OR LOWER(source_file) LIKE ? OR CAST(dp_amount AS TEXT) LIKE ?)'
          );
          params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (leasing) {
          conditions.push('leasing_name = ?');
          params.push(leasing);
        }
        if (branch) {
          conditions.push('branch = ?');
          params.push(branch);
        }
        if (status === 'active') conditions.push('is_active = 1');
        if (status === 'inactive') conditions.push('is_active = 0');

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = db
          .prepare(`
            SELECT * FROM auto_installment_records
            ${whereClause}
            ORDER BY category ASC, branch ASC, motor_name ASC, variant ASC, dp_amount ASC, tenor_months ASC
            LIMIT 5000
          `)
          .all(...params) as Array<Record<string, unknown>>;

        const branchRows = db
          .prepare("SELECT DISTINCT branch FROM auto_installment_records WHERE TRIM(branch) != '' ORDER BY branch ASC")
          .all() as Array<{ branch: string }>;

        res.json({
          records: rows.map((r) => ({
            ...r,
            category: normalizeAutoCategory(r.category),
            is_active: Number(r.is_active) === 1,
          })),
          branches: branchRows.map((b) => b.branch),
        });
      } catch (err) {
        console.error('GET /api/admin/auto-installments/records error:', err);
        res.status(500).json({ error: 'Gagal memuat data angsuran otomatis.' });
      }
    }
  );

  router.patch(
    '/api/admin/auto-installments/records/:id',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (req: AuthenticatedRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: 'ID record tidak valid.' });
          return;
        }
        const existing = db
          .prepare('SELECT * FROM auto_installment_records WHERE id = ?')
          .get(id) as Record<string, unknown> | undefined;
        if (!existing) {
          res.status(404).json({ error: 'Record tidak ditemukan.' });
          return;
        }

        const isActive =
          req.body?.is_active !== undefined
            ? req.body.is_active
              ? 1
              : 0
            : Number(existing.is_active);
        const installmentAmount =
          req.body?.installment_amount !== undefined
            ? parseRupiahInt(req.body.installment_amount)
            : Number(existing.installment_amount);
        const dpAmount =
          req.body?.dp_amount !== undefined
            ? parseRupiahInt(req.body.dp_amount)
            : Number(existing.dp_amount);

        if (dpAmount <= 0 || installmentAmount <= 0) {
          res.status(400).json({ error: 'Nominal DP dan angsuran harus lebih dari Rp0.' });
          return;
        }

        const now = new Date().toISOString();
        db.exec('BEGIN');
        try {
          db.prepare(`
            UPDATE auto_installment_records
            SET dp_amount = ?, installment_amount = ?, is_active = ?, updated_at = ?
            WHERE id = ?
          `).run(dpAmount, installmentAmount, isActive, now, id);

          db.prepare(`
            INSERT INTO auto_change_logs (batch_id, action, actor_user_id, actor_name, details, created_at)
            VALUES (?, 'record_updated', ?, ?, ?, ?)
          `).run(
            existing.batch_id !== null && existing.batch_id !== undefined
              ? Number(existing.batch_id)
              : null,
            req.user!.id,
            req.user!.name,
            `Ubah record #${id} (${existing.motor_name} ${existing.variant}, DP ${dpAmount}, ${existing.tenor_months} bln -> Rp${installmentAmount}, status=${isActive === 1 ? 'Aktif' : 'Nonaktif'}).`,
            now
          );
          db.exec('COMMIT');
        } catch (txErr) {
          db.exec('ROLLBACK');
          throw txErr;
        }

        res.json({ success: true });
      } catch (err) {
        console.error('PATCH /api/admin/auto-installments/records/:id error:', err);
        res.status(500).json({ error: 'Gagal memperbarui record angsuran.' });
      }
    }
  );

  router.delete(
    '/api/admin/auto-installments/records/:id',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (req: AuthenticatedRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: 'ID record tidak valid.' });
          return;
        }
        const existing = db
          .prepare('SELECT * FROM auto_installment_records WHERE id = ?')
          .get(id) as Record<string, unknown> | undefined;
        if (!existing) {
          res.status(404).json({ error: 'Record tidak ditemukan.' });
          return;
        }

        const now = new Date().toISOString();
        db.exec('BEGIN');
        try {
          db.prepare('DELETE FROM auto_installment_records WHERE id = ?').run(id);
          db.prepare(`
            INSERT INTO auto_change_logs (batch_id, action, actor_user_id, actor_name, details, created_at)
            VALUES (?, 'record_deleted', ?, ?, ?, ?)
          `).run(
            existing.batch_id !== null && existing.batch_id !== undefined
              ? Number(existing.batch_id)
              : null,
            req.user!.id,
            req.user!.name,
            `Hapus record #${id} (${existing.motor_name} ${existing.variant}, DP ${existing.dp_amount}, ${existing.tenor_months} bln).`,
            now
          );
          db.exec('COMMIT');
        } catch (txErr) {
          db.exec('ROLLBACK');
          throw txErr;
        }

        res.json({ success: true });
      } catch (err) {
        console.error('DELETE /api/admin/auto-installments/records/:id error:', err);
        res.status(500).json({ error: 'Gagal menghapus record angsuran.' });
      }
    }
  );

  router.get(
    '/api/admin/auto-installments/batches',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (_req, res) => {
      try {
        const batches = db
          .prepare(`
            SELECT
              id, source_type, source_name, category, leasing_default, branch_default,
              effective_date, import_mode, total_rows, inserted_count, updated_count,
              skipped_duplicates, status, uploaded_by_name, notes, created_at
            FROM auto_import_batches
            ORDER BY id DESC
            LIMIT 100
          `)
          .all();
        res.json({ batches });
      } catch (err) {
        console.error('GET /api/admin/auto-installments/batches error:', err);
        res.status(500).json({ error: 'Gagal memuat riwayat import database.' });
      }
    }
  );

  router.get(
    '/api/admin/auto-installments/logs',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (_req, res) => {
      try {
        const logs = db
          .prepare(`
            SELECT id, batch_id, action, actor_name, details, created_at
            FROM auto_change_logs
            ORDER BY id DESC
            LIMIT 200
          `)
          .all();
        res.json({ logs });
      } catch (err) {
        console.error('GET /api/admin/auto-installments/logs error:', err);
        res.status(500).json({ error: 'Gagal memuat log perubahan database.' });
      }
    }
  );

  router.post(
    '/api/admin/auto-installments/batches/:id/rollback',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (req: AuthenticatedRequest, res) => {
      try {
        const batchId = Number(req.params.id);
        if (!Number.isInteger(batchId) || batchId <= 0) {
          res.status(400).json({ error: 'ID batch tidak valid.' });
          return;
        }

        const batch = db
          .prepare('SELECT * FROM auto_import_batches WHERE id = ?')
          .get(batchId) as
          | {
              id: number;
              source_name: string;
              category?: string;
              status: string;
              snapshot_before_json: string;
            }
          | undefined;

        if (!batch) {
          res.status(404).json({ error: 'Batch import tidak ditemukan.' });
          return;
        }
        if (batch.status === 'rolled_back') {
          res.status(400).json({ error: 'Batch ini sudah pernah di-rollback sebelumnya.' });
          return;
        }

        const snapshotRows = JSON.parse(batch.snapshot_before_json || '[]') as Array<
          Record<string, unknown>
        >;
        const now = new Date().toISOString();
        const fallbackCategory = normalizeAutoCategory(batch.category);

        db.exec('BEGIN');
        try {
          // Remove rows added/updated by this batch
          const delInfo = db
            .prepare('DELETE FROM auto_installment_records WHERE batch_id = ?')
            .run(batchId);

          // Restore prior overwritten/replaced rows from snapshot
          const restoreStmt = db.prepare(`
            INSERT OR REPLACE INTO auto_installment_records (
              id, motor_name, variant, dp_amount, tenor_months, installment_amount,
              leasing_name, branch, effective_date, is_active, source_file, category, batch_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);

          for (const prev of snapshotRows) {
            restoreStmt.run(
              Number(prev.id),
              String(prev.motor_name),
              String(prev.variant ?? 'Standard'),
              Math.round(Number(prev.dp_amount)),
              Math.round(Number(prev.tenor_months)),
              Math.round(Number(prev.installment_amount)),
              String(prev.leasing_name ?? ''),
              String(prev.branch ?? ''),
              String(prev.effective_date ?? now.slice(0, 10)),
              Number(prev.is_active ?? 1),
              String(prev.source_file ?? 'Restored Snapshot'),
              prev.category ? normalizeAutoCategory(prev.category) : fallbackCategory,
              prev.batch_id !== undefined && prev.batch_id !== null ? Number(prev.batch_id) : null,
              String(prev.created_at ?? now),
              now
            );
          }

          db.prepare("UPDATE auto_import_batches SET status = 'rolled_back' WHERE id = ?").run(
            batchId
          );

          db.prepare(`
            INSERT INTO auto_change_logs (batch_id, action, actor_user_id, actor_name, details, created_at)
            VALUES (?, 'rollback_executed', ?, ?, ?, ?)
          `).run(
            batchId,
            req.user!.id,
            req.user!.name,
            `Rollback batch #${batchId} ("${batch.source_name}"): ${delInfo.changes} baris dihapus, ${snapshotRows.length} baris sebelumnya dipulihkan.`,
            now
          );

          db.exec('COMMIT');
          res.json({
            success: true,
            removed_count: delInfo.changes,
            restored_count: snapshotRows.length,
          });
        } catch (txErr) {
          db.exec('ROLLBACK');
          throw txErr;
        }
      } catch (err) {
        console.error('POST /api/admin/auto-installments/batches/:id/rollback error:', err);
        res.status(500).json({ error: 'Gagal menjalankan rollback batch import.' });
      }
    }
  );

  router.get('/api/auto-installments/template', (req, res) => {
    try {
      const cat = normalizeAutoCategory(req.query.category);
      const wb = XLSX.utils.book_new();
      const branches = ['Palembang', 'Sumsel', 'Bengkulu'];

      for (const br of branches) {
        const sampleRows = [
          {
            'Tipe Motor': 'AEROX ALPHA',
            'Varian Motor': 'Standard',
            'Nominal DP': 4000000,
            '11': 3850000,
            '17': 2690000,
            '23': 2150000,
            '29': 1830000,
            '33': 1685000,
            Leasing: 'BAF Finance',
          },
          {
            'Tipe Motor': 'NMAX NEO',
            'Varian Motor': 'Standard',
            'Nominal DP': 4500000,
            '11': 4120000,
            '17': 2890000,
            '23': 2310000,
            '29': 1970000,
            '33': 1815000,
            Leasing: 'BAF Finance',
          },
        ];
        const ws = XLSX.utils.json_to_sheet(sampleRows);
        XLSX.utils.book_append_sheet(wb, ws, br);
      }

      const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="template_angsuran_${cat}_yamaha.xlsx"`
      );
      res.send(buffer);
    } catch (err) {
      console.error('GET /api/auto-installments/template error:', err);
      res.status(500).json({ error: 'Gagal membuat template Excel.' });
    }
  });

  router.get(
    '/api/admin/auto-installments/export',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (req: AuthenticatedRequest, res) => {
      try {
        const rawCat = String(req.query.category ?? '').trim().toLowerCase();
        const whereSql =
          rawCat === 'promo' || rawCat === 'reguler' ? 'WHERE category = ?' : '';
        const params = rawCat === 'promo' || rawCat === 'reguler' ? [rawCat] : [];

        const rows = db
          .prepare(`
            SELECT
              id,
              UPPER(category) AS kategori,
              motor_name AS tipe_motor,
              variant AS varian_motor,
              dp_amount AS dp,
              tenor_months AS tenor_bulan,
              installment_amount AS angsuran_per_bulan,
              leasing_name AS nama_leasing,
              branch AS cabang_wilayah,
              effective_date AS tanggal_berlaku,
              CASE WHEN is_active = 1 THEN 'Aktif' ELSE 'Nonaktif' END AS status_aktif,
              source_file AS sumber_file,
              created_at,
              updated_at
            FROM auto_installment_records
            ${whereSql}
            ORDER BY category ASC, motor_name ASC, variant ASC, dp_amount ASC, tenor_months ASC
          `)
          .all(...params) as Array<Record<string, unknown>>;

        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Database Angsuran Otomatis');
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        db.prepare(`
          INSERT INTO auto_change_logs (batch_id, action, actor_user_id, actor_name, details, created_at)
          VALUES (NULL, 'export_excel', ?, ?, ?, ?)
        `).run(
          req.user!.id,
          req.user!.name,
          `Export ${rows.length} record Database Angsuran Otomatis ke file Excel.`,
          new Date().toISOString()
        );

        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          'attachment; filename="database_angsuran_otomatis_yamaha.xlsx"'
        );
        res.send(buffer);
      } catch (err) {
        console.error('GET /api/admin/auto-installments/export error:', err);
        res.status(500).json({ error: 'Gagal mengekspor Database Angsuran Otomatis.' });
      }
    }
  );

  // ==========================================================================
  // PDF DISCOUNT DATABASE ROUTES (EXTRACT FROM PDF & AUTO-APPLY TO DP)
  // ==========================================================================

  router.get(
    '/api/admin/auto-discounts',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (_req: AuthenticatedRequest, res) => {
      try {
        const rulesRows = db
          .prepare(`
            SELECT *
            FROM auto_discount_rules
            ORDER BY is_active DESC, updated_at DESC, id DESC
          `)
          .all() as Array<Record<string, unknown>>;

        const rules: AutoDiscountRule[] = rulesRows.map((r) => ({
          id: Number(r.id),
          motor_name: String(r.motor_name),
          branch: String(r.branch ?? ''),
          discount_type: String(r.discount_type) === 'nominal' ? 'nominal' : 'percent',
          discount_percent: Number(r.discount_percent ?? 0),
          discount_amount: Number(r.discount_amount ?? 0),
          min_dp: Number(r.min_dp ?? 0),
          tenor_months: Number(r.tenor_months ?? 0),
          promo_title: String(r.promo_title ?? ''),
          source_pdf_id:
            r.source_pdf_id !== null && r.source_pdf_id !== undefined
              ? Number(r.source_pdf_id)
              : null,
          source_file: String(r.source_file),
          effective_date: String(r.effective_date),
          is_active: Number(r.is_active) === 1,
          created_at: String(r.created_at),
          updated_at: String(r.updated_at),
        }));

        const pdfDocs = db
          .prepare(`
            SELECT id, title, original_filename, stored_filename, file_size, category, uploader_name, created_at
            FROM uploaded_documents
            WHERE file_type = 'pdf'
            ORDER BY created_at DESC, id DESC
          `)
          .all();

        res.json({ rules, pdf_documents: pdfDocs });
      } catch (err) {
        console.error('GET /api/admin/auto-discounts error:', err);
        res.status(500).json({ error: 'Gagal memuat database diskon PDF.' });
      }
    }
  );

  router.post(
    '/api/admin/auto-discounts/parse-pdf',
    requireAuth,
    requireRole('super_admin', 'admin'),
    async (req: AuthenticatedRequest, res) => {
      try {
        const { filename, fileBase64 } = req.body as {
          filename?: string;
          fileBase64?: string;
        };

        const safeName = String(filename ?? '').trim() || 'diskon.pdf';
        if (!fileBase64 || typeof fileBase64 !== 'string') {
          res.status(400).json({ error: 'File PDF tidak ditemukan dalam permintaan.' });
          return;
        }

        const buffer = Buffer.from(fileBase64, 'base64');
        if (buffer.length === 0) {
          res.status(400).json({ error: 'File PDF kosong.' });
          return;
        }
        if (buffer.length > 15 * 1024 * 1024) {
          res.status(400).json({ error: 'Ukuran file PDF maksimal 15 MB.' });
          return;
        }
        if (buffer.subarray(0, 4).toString('ascii') !== '%PDF') {
          res.status(400).json({ error: 'File bukan dokumen PDF yang valid.' });
          return;
        }

        const extracted = await extractPdfDiscountRules(fileBase64, safeName);
        res.json({
          source_name: safeName,
          extraction_method: extracted.extractionMethod,
          rows: extracted.rows,
        });
      } catch (err) {
        console.error('POST /api/admin/auto-discounts/parse-pdf error:', err);
        res.status(500).json({ error: 'Gagal mengekstrak diskon dari file PDF.' });
      }
    }
  );

  router.post(
    '/api/admin/auto-discounts/import-pdf',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (req: AuthenticatedRequest, res) => {
      try {
        const {
          filename,
          fileBase64,
          rows,
          replace_existing = true,
          promo_title,
          effective_date,
        } = req.body as {
          filename?: string;
          fileBase64?: string;
          rows?: ExtractedDiscountDraft[];
          replace_existing?: boolean;
          promo_title?: string;
          effective_date?: string;
        };

        const safeName = path.basename(String(filename ?? '').trim() || 'diskon_promo.pdf');
        if (!Array.isArray(rows) || rows.length === 0) {
          res.status(400).json({ error: 'Tidak ada baris diskon valid untuk disimpan ke database.' });
          return;
        }

        const now = new Date().toISOString();
        const resolvedDate = normalizeDateStr(effective_date, now.slice(0, 10));
        let pdfDocId: number | null = null;

        // Store the uploaded PDF into uploaded_documents & disk so it lives in the database
        if (fileBase64 && typeof fileBase64 === 'string') {
          const buf = Buffer.from(fileBase64, 'base64');
          if (buf.length > 0 && buf.subarray(0, 4).toString('ascii') === '%PDF') {
            if (!fs.existsSync(UPLOADS_DIR)) {
              fs.mkdirSync(UPLOADS_DIR, { recursive: true });
            }
            const storedFilename = `doc_${crypto.randomBytes(8).toString('hex')}.pdf`;
            fs.writeFileSync(path.join(UPLOADS_DIR, storedFilename), buf);

            const docRes = db
              .prepare(`
                INSERT INTO uploaded_documents (
                  title, original_filename, file_type, mime_type, file_size, stored_filename, sheets_url,
                  category, uploader_name, notes, row_count, parsed_preview_json, created_at
                ) VALUES (?, ?, 'pdf', 'application/pdf', ?, ?, '', 'Brosur / PDF Leasing', ?, ?, ?, '', ?)
              `)
              .run(
                String(promo_title || '').trim() || safeName.replace(/\.pdf$/i, ''),
                safeName,
                buf.length,
                storedFilename,
                req.user!.name,
                'Dokumen PDF Diskon DP otomatis terhubung ke Cek Angsuran',
                rows.length,
                now
              );
            pdfDocId = Number(docRes.lastInsertRowid);
          }
        }

        const normalizedRules: ExtractedDiscountDraft[] = rows.map((r) => ({
          motor_name: String(r.motor_name ?? '').trim(),
          branch: String(r.branch ?? '').trim(),
          discount_type: r.discount_type === 'nominal' ? 'nominal' : 'percent',
          discount_percent: Number(r.discount_percent ?? 0) || 0,
          discount_amount: parseRupiahInt(r.discount_amount),
          min_dp: parseRupiahInt(r.min_dp),
          tenor_months: parseTenorInt(r.tenor_months),
          promo_title:
            String(r.promo_title ?? '').trim() ||
            String(promo_title ?? '').trim() ||
            safeName.replace(/\.pdf$/i, ''),
          effective_date: normalizeDateStr(r.effective_date, resolvedDate),
        }));

        const savedCount = saveDiscountRulesTransaction({
          rules: normalizedRules,
          sourcePdfId: pdfDocId,
          sourceFile: safeName,
          replaceExistingForSource: Boolean(replace_existing),
          actorUserId: req.user!.id,
          actorName: req.user!.name,
        });

        res.json({
          success: true,
          saved_count: savedCount,
          source_pdf_id: pdfDocId,
          source_file: safeName,
        });
      } catch (err) {
        console.error('POST /api/admin/auto-discounts/import-pdf error:', err);
        res.status(500).json({ error: 'Gagal menyimpan aturan diskon PDF ke database.' });
      }
    }
  );

  router.post(
    '/api/admin/auto-discounts/from-document/:docId',
    requireAuth,
    requireRole('super_admin', 'admin'),
    async (req: AuthenticatedRequest, res) => {
      try {
        const docId = Number(req.params.docId);
        if (!Number.isInteger(docId) || docId <= 0) {
          res.status(400).json({ error: 'ID dokumen PDF tidak valid.' });
          return;
        }

        const doc = db
          .prepare('SELECT * FROM uploaded_documents WHERE id = ?')
          .get(docId) as
          | {
              id: number;
              title: string;
              original_filename: string;
              file_type: string;
              stored_filename: string;
            }
          | undefined;

        if (!doc || doc.file_type !== 'pdf' || !doc.stored_filename) {
          res.status(404).json({ error: 'Dokumen PDF tidak ditemukan di database.' });
          return;
        }

        const filePath = path.join(UPLOADS_DIR, path.basename(doc.stored_filename));
        if (!fs.existsSync(filePath)) {
          res.status(404).json({ error: 'File fisik PDF tidak ditemukan di penyimpanan server.' });
          return;
        }

        const pdfBuffer = fs.readFileSync(filePath);
        const extracted = await extractPdfDiscountRules(
          pdfBuffer.toString('base64'),
          doc.original_filename || doc.title
        );

        if (extracted.rows.length === 0) {
          res.status(400).json({
            error:
              'Tidak ditemukan daftar diskon motor/DP yang terbaca otomatis di PDF ini. Anda dapat menambah aturan diskon secara manual di bawah.',
          });
          return;
        }

        const savedCount = saveDiscountRulesTransaction({
          rules: extracted.rows,
          sourcePdfId: doc.id,
          sourceFile: doc.original_filename || doc.title,
          replaceExistingForSource: true,
          actorUserId: req.user!.id,
          actorName: req.user!.name,
        });

        res.json({
          success: true,
          saved_count: savedCount,
          source_file: doc.original_filename || doc.title,
          extraction_method: extracted.extractionMethod,
        });
      } catch (err) {
        console.error('POST /api/admin/auto-discounts/from-document/:docId error:', err);
        res.status(500).json({ error: 'Gagal mengekstrak diskon dari PDF di database.' });
      }
    }
  );

  router.post(
    '/api/admin/auto-discounts',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (req: AuthenticatedRequest, res) => {
      try {
        const {
          motor_name,
          branch = '',
          discount_type = 'percent',
          discount_percent = 0,
          discount_amount = 0,
          min_dp = 0,
          tenor_months = 0,
          promo_title = 'Promo Diskon PDF',
          source_file = 'Input Admin (PDF Database)',
          effective_date,
        } = req.body as Record<string, unknown>;

        const motorName = String(motor_name ?? '').trim();
        if (!motorName) {
          res.status(400).json({ error: 'Nama tipe motor wajib diisi.' });
          return;
        }

        const type: 'percent' | 'nominal' = discount_type === 'nominal' ? 'nominal' : 'percent';
        const pct = Math.min(100, Math.max(0, Number(discount_percent ?? 0) || 0));
        const amt = parseRupiahInt(discount_amount);
        if ((type === 'percent' && pct <= 0) || (type === 'nominal' && amt <= 0)) {
          res.status(400).json({ error: 'Nilai diskon harus lebih besar dari 0.' });
          return;
        }

        const now = new Date().toISOString();
        const effDate = normalizeDateStr(effective_date, now.slice(0, 10));
        const result = db
          .prepare(`
            INSERT INTO auto_discount_rules (
              motor_name, branch, discount_type, discount_percent, discount_amount,
              min_dp, tenor_months, promo_title, source_pdf_id, source_file,
              effective_date, is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 1, ?, ?)
          `)
          .run(
            motorName,
            String(branch ?? '').trim(),
            type,
            type === 'percent' ? Math.round(pct * 10) / 10 : 0,
            type === 'nominal' ? amt : 0,
            parseRupiahInt(min_dp),
            parseTenorInt(tenor_months),
            String(promo_title ?? '').trim(),
            String(source_file ?? '').trim() || 'Input Admin',
            effDate,
            now,
            now
          );

        res.status(201).json({ id: Number(result.lastInsertRowid) });
      } catch (err) {
        console.error('POST /api/admin/auto-discounts error:', err);
        res.status(500).json({ error: 'Gagal menambahkan aturan diskon.' });
      }
    }
  );

  router.patch(
    '/api/admin/auto-discounts/:id',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (req: AuthenticatedRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: 'ID aturan diskon tidak valid.' });
          return;
        }

        const existing = db
          .prepare('SELECT * FROM auto_discount_rules WHERE id = ?')
          .get(id) as Record<string, unknown> | undefined;
        if (!existing) {
          res.status(404).json({ error: 'Aturan diskon tidak ditemukan.' });
          return;
        }

        const nextActive =
          req.body.is_active !== undefined
            ? req.body.is_active
              ? 1
              : 0
            : Number(existing.is_active);
        const nextType =
          req.body.discount_type === 'nominal' || req.body.discount_type === 'percent'
            ? req.body.discount_type
            : String(existing.discount_type);
        const nextPct =
          req.body.discount_percent !== undefined
            ? Math.min(100, Math.max(0, Number(req.body.discount_percent) || 0))
            : Number(existing.discount_percent);
        const nextAmt =
          req.body.discount_amount !== undefined
            ? parseRupiahInt(req.body.discount_amount)
            : Number(existing.discount_amount);

        db.prepare(`
          UPDATE auto_discount_rules
          SET is_active = ?, discount_type = ?, discount_percent = ?, discount_amount = ?, updated_at = ?
          WHERE id = ?
        `).run(nextActive, nextType, nextPct, nextAmt, new Date().toISOString(), id);

        res.json({ success: true });
      } catch (err) {
        console.error('PATCH /api/admin/auto-discounts/:id error:', err);
        res.status(500).json({ error: 'Gagal memperbarui aturan diskon.' });
      }
    }
  );

  router.delete(
    '/api/admin/auto-discounts/:id',
    requireAuth,
    requireRole('super_admin', 'admin'),
    (req: AuthenticatedRequest, res) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          res.status(400).json({ error: 'ID aturan diskon tidak valid.' });
          return;
        }
        db.prepare('DELETE FROM auto_discount_rules WHERE id = ?').run(id);
        res.json({ success: true });
      } catch (err) {
        console.error('DELETE /api/admin/auto-discounts/:id error:', err);
        res.status(500).json({ error: 'Gagal menghapus aturan diskon.' });
      }
    }
  );

  return router;
}
