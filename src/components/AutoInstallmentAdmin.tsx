import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Calculator,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  Loader2,
  LogOut,
  Percent,
  Plus,
  RotateCcw,
  ScrollText,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AutoChangeLog,
  AutoColumnMapping,
  AutoDiscountRule,
  AutoImportBatch,
  AutoImportMode,
  AutoInstallmentCategory,
  AutoInstallmentRecord,
  AutoValidationSummary,
  AuthUser,
  ParsedAutoSourceResponse,
} from '../types';
import { formatRupiah, formatRupiahInput, parseRupiahInput } from '../utils/format';
import {
  extractSpreadsheetIdFromInput,
  getGoogleSheetsAccessToken,
  initGoogleSheetsAuth,
  signInWithGoogleSheets,
  signOutGoogleSheets,
} from '../utils/googleSheetsAuth';
import ConfirmModal from './ConfirmModal';

interface AutoInstallmentAdminProps {
  token: string;
  currentUser: AuthUser;
  initialImportCategory?: AutoInstallmentCategory;
  onDatabaseChanged?: () => void;
  onOpenCalculator?: (category?: AutoInstallmentCategory) => void;
}

type ModuleSubTab = 'import' | 'records' | 'batches' | 'logs' | 'discounts';

interface DraftDiscountRow {
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

interface StoredPdfDocItem {
  id: number;
  title: string;
  original_filename: string;
  stored_filename: string;
  file_size: number;
  category: string;
  uploader_name: string;
  created_at: string;
}

export default function AutoInstallmentAdmin({
  token,
  initialImportCategory,
  onDatabaseChanged,
  onOpenCalculator,
}: AutoInstallmentAdminProps) {
  const [subTab, setSubTab] = useState<ModuleSubTab>('import');
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
    savedCategory?: AutoInstallmentCategory;
  } | null>(null);

  // Google Sheets OAuth state (token held strictly in memory via googleSheetsAuth)
  const [googleUserEmail, setGoogleUserEmail] = useState<string | null>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(() => getGoogleSheetsAccessToken());
  const [googleAuthLoading, setGoogleAuthLoading] = useState<boolean>(false);
  const [sheetUrlInput, setSheetUrlInput] = useState<string>('');
  const [gsMetadata, setGsMetadata] = useState<{
    spreadsheet_id: string;
    title: string;
    sheet_names: string[];
  } | null>(null);
  const [selectedGsTab, setSelectedGsTab] = useState<string>('');
  const [loadingGsMeta, setLoadingGsMeta] = useState<boolean>(false);

  // Import Wizard State (Steps 1 -> 4)
  const [importCategory, setImportCategory] = useState<AutoInstallmentCategory>(
    initialImportCategory ?? 'promo'
  );
  const [autoConfirmOnUpload, setAutoConfirmOnUpload] = useState<boolean>(true);
  const [parsingSource, setParsingSource] = useState<boolean>(false);
  const [parsedSource, setParsedSource] = useState<ParsedAutoSourceResponse | null>(null);
  const [pendingFileInfo, setPendingFileInfo] = useState<{
    filename: string;
    fileBase64: string;
  } | null>(null);
  const [mapping, setMapping] = useState<AutoColumnMapping | null>(null);
  const [defaultLeasing, setDefaultLeasing] = useState<string>('BAF Finance');
  const [defaultBranch, setDefaultBranch] = useState<string>('Palembang');
  const [defaultEffectiveDate, setDefaultEffectiveDate] = useState<string>(
    new Date().toISOString().slice(0, 10)
  );
  const [importMode, setImportMode] = useState<AutoImportMode>('upsert');
  const [importNotes, setImportNotes] = useState<string>('');

  const [validating, setValidating] = useState<boolean>(false);
  const [validation, setValidation] = useState<AutoValidationSummary | null>(null);
  const [confirmingImport, setConfirmingImport] = useState<boolean>(false);

  // Stored Records, Batches, Logs
  const [records, setRecords] = useState<AutoInstallmentRecord[]>([]);
  const [availableBranches, setAvailableBranches] = useState<string[]>([]);
  const [batches, setBatches] = useState<AutoImportBatch[]>([]);
  const [logs, setLogs] = useState<AutoChangeLog[]>([]);
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [recordSearch, setRecordSearch] = useState<string>('');
  const [recordCategoryFilter, setRecordCategoryFilter] = useState<'all' | AutoInstallmentCategory>('all');
  const [recordBranchFilter, setRecordBranchFilter] = useState<string>('');
  const [recordStatusFilter, setRecordStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Confirmation Modals
  const [rollbackTarget, setRollbackTarget] = useState<AutoImportBatch | null>(null);
  const [rollingBack, setRollingBack] = useState<boolean>(false);
  const [deleteRecordTarget, setDeleteRecordTarget] = useState<AutoInstallmentRecord | null>(null);
  const [deletingRecord, setDeletingRecord] = useState<boolean>(false);

  // Inline edit record state
  const [editingRecord, setEditingRecord] = useState<AutoInstallmentRecord | null>(null);
  const [editDpStr, setEditDpStr] = useState<string>('');
  const [editInstallmentStr, setEditInstallmentStr] = useState<string>('');
  const [savingEdit, setSavingEdit] = useState<boolean>(false);

  // PDF Discounts tab state
  const [discountRules, setDiscountRules] = useState<AutoDiscountRule[]>([]);
  const [storedPdfDocs, setStoredPdfDocs] = useState<StoredPdfDocItem[]>([]);
  const [parsingDiscountPdf, setParsingDiscountPdf] = useState<boolean>(false);
  const [pendingDiscountPdf, setPendingDiscountPdf] = useState<{
    filename: string;
    fileBase64: string;
    extractionMethod: string;
    rows: DraftDiscountRow[];
  } | null>(null);
  const [savingDiscounts, setSavingDiscounts] = useState<boolean>(false);
  const [extractingDocId, setExtractingDocId] = useState<number | null>(null);
  const [manualDiscMotor, setManualDiscMotor] = useState<string>('');
  const [manualDiscBranch, setManualDiscBranch] = useState<string>('');
  const [manualDiscType, setManualDiscType] = useState<'percent' | 'nominal'>('percent');
  const [manualDiscValue, setManualDiscValue] = useState<string>('10');
  const [manualDiscTitle, setManualDiscTitle] = useState<string>('Promo Diskon PDF');
  const [addingManualDisc, setAddingManualDisc] = useState<boolean>(false);

  useEffect(() => {
    const unsubscribe = initGoogleSheetsAuth(
      (user, accessToken) => {
        setGoogleUserEmail(user.email || user.displayName || 'Akun Google Terhubung');
        setGoogleToken(accessToken);
      },
      () => {
        setGoogleUserEmail(null);
        setGoogleToken(null);
      }
    );
    return () => unsubscribe();
  }, []);

  function notify(type: 'success' | 'error', text: string, savedCategory?: AutoInstallmentCategory) {
    setFeedback({ type, text, savedCategory });
  }

  useEffect(() => {
    if (initialImportCategory) {
      setImportCategory(initialImportCategory);
      setSubTab('import');
    }
  }, [initialImportCategory]);

  const loadRecords = useCallback(async () => {
    setLoadingList(true);
    try {
      const params = new URLSearchParams();
      if (recordSearch.trim()) params.set('search', recordSearch.trim());
      if (recordCategoryFilter !== 'all') params.set('category', recordCategoryFilter);
      if (recordBranchFilter) params.set('branch', recordBranchFilter);
      if (recordStatusFilter !== 'all') params.set('status', recordStatusFilter);
      const res = await fetch(`/api/admin/auto-installments/records?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRecords(data.records || []);
        if (Array.isArray(data.branches)) {
          setAvailableBranches(data.branches);
        }
      }
    } finally {
      setLoadingList(false);
    }
  }, [token, recordSearch, recordCategoryFilter, recordBranchFilter, recordStatusFilter]);

  const loadBatches = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/admin/auto-installments/batches', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBatches(data.batches || []);
      }
    } finally {
      setLoadingList(false);
    }
  }, [token]);

  const loadLogs = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/admin/auto-installments/logs', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || []);
      }
    } finally {
      setLoadingList(false);
    }
  }, [token]);

  const loadDiscounts = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch('/api/admin/auto-discounts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setDiscountRules(data.rules || []);
        setStoredPdfDocs(data.pdf_documents || []);
      }
    } finally {
      setLoadingList(false);
    }
  }, [token]);

  useEffect(() => {
    if (subTab === 'records') loadRecords();
    if (subTab === 'batches') loadBatches();
    if (subTab === 'logs') loadLogs();
    if (subTab === 'discounts') loadDiscounts();
  }, [subTab, loadRecords, loadBatches, loadLogs, loadDiscounts]);

  // Step 1A: Handle Excel / CSV / PDF File Upload & Parse
  async function handleFileUpload(e: ChangeEvent<HTMLInputElement>, requestedSheet?: string) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setFeedback(null);
    setValidation(null);
    setParsingSource(true);

    try {
      const fileBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = () => reject(new Error('Gagal membaca file dari perangkat.'));
        reader.readAsDataURL(file);
      });

      setPendingFileInfo({ filename: file.name, fileBase64 });

      const res = await fetch('/api/admin/auto-installments/parse-file', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: file.name,
          fileBase64,
          sheetName: requestedSheet || '',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Gagal memproses file.');
        return;
      }

      const parsed = data as ParsedAutoSourceResponse;
      setParsedSource(parsed);
      setMapping(parsed.suggested_mapping);

      // Single-sheet workbooks without a branch column apply cleanly across all branches
      const effectiveDefaultBranch =
        parsed.sheet_names.length <= 1 && !parsed.suggested_mapping.branch
          ? 'Semua Wilayah'
          : defaultBranch;
      if (effectiveDefaultBranch !== defaultBranch) {
        setDefaultBranch(effectiveDefaultBranch);
      }

      const sheetSummary =
        parsed.sheet_stats && parsed.sheet_stats.length > 1
          ? ` dari ${parsed.sheet_stats.length} sheet (${parsed.sheet_stats.map((s) => `${s.sheet_name}: ${s.row_count}`).join(', ')})`
          : '';
      const summary = await runValidationDirect(
        parsed.rows,
        parsed.suggested_mapping,
        importCategory,
        effectiveDefaultBranch
      );

      if (
        autoConfirmOnUpload &&
        parsed.source_type !== 'pdf' &&
        summary &&
        summary.new_count + summary.update_count > 0
      ) {
        await confirmImportDirect(
          parsed,
          parsed.suggested_mapping,
          importCategory,
          effectiveDefaultBranch
        );
      } else {
        notify(
          'success',
          `Berhasil membaca ${parsed.rows.length} baris${sheetSummary} dari "${parsed.source_name}". Periksa ringkasan lalu klik "Konfirmasi & Simpan ke Database".`
        );
      }
    } catch (err: unknown) {
      notify('error', err instanceof Error ? err.message : 'Gagal membaca file.');
    } finally {
      setParsingSource(false);
    }
  }

  async function runValidationDirect(
    rowsToValidate: Array<Record<string, unknown>>,
    mappingToUse: AutoColumnMapping,
    categoryOverride?: AutoInstallmentCategory,
    branchOverride?: string
  ): Promise<AutoValidationSummary | null> {
    if (rowsToValidate.length === 0) return null;
    const cat = categoryOverride ?? importCategory;
    const branchToUse = branchOverride ?? defaultBranch;
    setValidating(true);
    try {
      const res = await fetch('/api/admin/auto-installments/validate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rows: rowsToValidate,
          mapping: mappingToUse,
          category: cat,
          defaultLeasing,
          defaultBranch: branchToUse,
          defaultEffectiveDate,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        const summary = data as AutoValidationSummary;
        setValidation(summary);
        return summary;
      }
      return null;
    } finally {
      setValidating(false);
    }
  }

  async function handleSwitchExcelSheet(sheetName: string) {
    if (!pendingFileInfo) return;
    setParsingSource(true);
    setValidation(null);
    try {
      const res = await fetch('/api/admin/auto-installments/parse-file', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: pendingFileInfo.filename,
          fileBase64: pendingFileInfo.fileBase64,
          sheetName,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Gagal mengganti sheet.');
        return;
      }
      const parsed = data as ParsedAutoSourceResponse;
      setParsedSource(parsed);
      setMapping(parsed.suggested_mapping);
      await runValidationDirect(parsed.rows, parsed.suggested_mapping);
    } finally {
      setParsingSource(false);
    }
  }

  // Step 1B: Official Google Sheets OAuth Integration
  async function handleGoogleSignIn() {
    setGoogleAuthLoading(true);
    setFeedback(null);
    try {
      const res = await signInWithGoogleSheets();
      setGoogleUserEmail(res.user.email || res.user.displayName || 'Terhubung ke Google');
      setGoogleToken(res.accessToken);
      notify('success', 'Berhasil terhubung ke akun Google untuk membaca Google Sheets.');
    } catch (err: unknown) {
      notify(
        'error',
        err instanceof Error ? err.message : 'Gagal masuk dengan Google.'
      );
    } finally {
      setGoogleAuthLoading(false);
    }
  }

  async function handleFetchGoogleSheetMeta() {
    if (!googleToken) {
      notify('error', 'Hubungkan akun Google terlebih dahulu.');
      return;
    }
    const spreadsheetId = extractSpreadsheetIdFromInput(sheetUrlInput);
    if (!spreadsheetId) {
      notify('error', 'Masukkan URL Google Sheets atau Spreadsheet ID yang valid.');
      return;
    }
    setLoadingGsMeta(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/auto-installments/google-sheets/metadata', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Google-Access-Token': `Bearer ${googleToken}`,
        },
        body: JSON.stringify({ spreadsheetId }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Gagal membaca metadata Google Sheets.');
        return;
      }
      setGsMetadata(data);
      if (data.sheet_names?.length > 1) {
        setSelectedGsTab('__ALL__');
      } else if (data.sheet_names?.length === 1) {
        setSelectedGsTab(data.sheet_names[0]);
      }
    } finally {
      setLoadingGsMeta(false);
    }
  }

  async function handleReadGoogleSheetData(tabName?: string) {
    if (!googleToken || !gsMetadata) return;
    const targetTab = tabName || selectedGsTab;
    if (!targetTab) {
      notify('error', 'Pilih tab sheet terlebih dahulu.');
      return;
    }
    setParsingSource(true);
    setValidation(null);
    setPendingFileInfo(null);
    try {
      const res = await fetch('/api/admin/auto-installments/google-sheets/read', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Google-Access-Token': `Bearer ${googleToken}`,
        },
        body: JSON.stringify({
          spreadsheetId: gsMetadata.spreadsheet_id,
          spreadsheetTitle: gsMetadata.title,
          sheetName: targetTab,
          sheetNames: gsMetadata.sheet_names,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Gagal membaca data Google Sheets.');
        return;
      }
      const parsed = data as ParsedAutoSourceResponse;
      setParsedSource(parsed);
      setMapping(parsed.suggested_mapping);
      notify(
        'success',
        `Berhasil membaca ${parsed.rows.length} baris dari Google Sheets "${parsed.source_name}". Validasi otomatis dijalankan di bawah.`
      );
      await runValidationDirect(parsed.rows, parsed.suggested_mapping);
    } finally {
      setParsingSource(false);
    }
  }

  // Step 2 & 3: Run Validation & Duplicate Detection
  async function handleRunValidation() {
    if (!parsedSource || !mapping) return;
    setValidating(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/auto-installments/validate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          rows: parsedSource.rows,
          mapping,
          category: importCategory,
          defaultLeasing,
          defaultBranch,
          defaultEffectiveDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Validasi gagal.');
        return;
      }
      setValidation(data as AutoValidationSummary);
    } finally {
      setValidating(false);
    }
  }

  async function confirmImportDirect(
    sourceObj: ParsedAutoSourceResponse,
    mappingObj: AutoColumnMapping,
    categoryToSave: AutoInstallmentCategory,
    branchToSave: string
  ) {
    setConfirmingImport(true);
    try {
      const res = await fetch('/api/admin/auto-installments/confirm-import', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceType: sourceObj.source_type,
          sourceName: sourceObj.source_name,
          category: categoryToSave,
          rows: sourceObj.rows,
          mapping: mappingObj,
          defaultLeasing,
          defaultBranch: branchToSave,
          defaultEffectiveDate,
          importMode,
          notes: importNotes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Konfirmasi import gagal.');
        return;
      }

      notify(
        'success',
        `Data kategori ${categoryToSave === 'reguler' ? 'Reguler' : 'Promo'} berhasil disimpan (Batch #${data.batch_id}): ${data.inserted_count} baru, ${data.updated_count} diperbarui, ${data.skipped_count} dilewati. Menu Cek Angsuran langsung siap dipakai.`,
        categoryToSave
      );
      setRecordCategoryFilter(categoryToSave);
      setParsedSource(null);
      setValidation(null);
      setPendingFileInfo(null);
      setImportNotes('');
      onDatabaseChanged?.();
      setSubTab('records');
    } finally {
      setConfirmingImport(false);
    }
  }

  // Step 4: Confirm Transactional Import
  async function handleConfirmImport() {
    if (!parsedSource || !mapping) return;
    setFeedback(null);
    await confirmImportDirect(parsedSource, mapping, importCategory, defaultBranch);
  }

  function handleChangeImportCategory(nextCat: AutoInstallmentCategory) {
    if (nextCat === importCategory) return;
    setImportCategory(nextCat);
    setValidation(null);
    if (parsedSource && mapping) {
      void runValidationDirect(parsedSource.rows, mapping, nextCat);
    }
  }

  // Export Database to Excel
  async function handleExportExcel() {
    try {
      const res = await fetch('/api/admin/auto-installments/export', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        notify('error', 'Gagal mengekspor database ke Excel.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'database_angsuran_otomatis_yamaha.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify('success', 'File Excel Database Angsuran Otomatis berhasil diunduh.');
    } catch {
      notify('error', 'Terjadi kendala saat mengunduh file Excel.');
    }
  }

  async function handleToggleRecordActive(rec: AutoInstallmentRecord) {
    const res = await fetch(`/api/admin/auto-installments/records/${rec.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ is_active: !rec.is_active }),
    });
    if (res.ok) {
      await loadRecords();
      onDatabaseChanged?.();
    }
  }

  async function handleSaveInlineEdit() {
    if (!editingRecord) return;
    const dpNum = parseRupiahInput(editDpStr);
    const instNum = parseRupiahInput(editInstallmentStr);
    if (dpNum <= 0 || instNum <= 0) {
      notify('error', 'Nominal DP dan angsuran harus lebih dari Rp0.');
      return;
    }
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/admin/auto-installments/records/${editingRecord.id}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dp_amount: dpNum,
          installment_amount: instNum,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Gagal menyimpan perubahan.');
        return;
      }
      setEditingRecord(null);
      notify('success', 'Record angsuran berhasil diperbarui dan dicatat dalam log.');
      await loadRecords();
      onDatabaseChanged?.();
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleConfirmDeleteRecord() {
    if (!deleteRecordTarget) return;
    setDeletingRecord(true);
    try {
      const res = await fetch(`/api/admin/auto-installments/records/${deleteRecordTarget.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setDeleteRecordTarget(null);
        notify('success', 'Record berhasil dihapus.');
        await loadRecords();
        onDatabaseChanged?.();
      }
    } finally {
      setDeletingRecord(false);
    }
  }

  async function handleConfirmRollback() {
    if (!rollbackTarget) return;
    setRollingBack(true);
    try {
      const res = await fetch(`/api/admin/auto-installments/batches/${rollbackTarget.id}/rollback`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Gagal menjalankan rollback.');
        return;
      }
      setRollbackTarget(null);
      notify(
        'success',
        `Rollback berhasil: ${data.removed_count} baris dihapus, ${data.restored_count} baris sebelumnya dipulihkan.`
      );
      await loadBatches();
      onDatabaseChanged?.();
    } finally {
      setRollingBack(false);
    }
  }

  function toggleWideTenorMapping(header: string, tenorStr: string) {
    if (!mapping) return;
    const nextWide = { ...mapping.wide_tenor_columns };
    const n = Number(tenorStr);
    if (!tenorStr || !Number.isInteger(n) || n < 1 || n > 60) {
      delete nextWide[header];
    } else {
      nextWide[header] = n;
    }
    setMapping({ ...mapping, wide_tenor_columns: nextWide });
    setValidation(null);
  }

  async function handleUploadDiscountPdf(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setFeedback(null);
    setParsingDiscountPdf(true);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const res = String(reader.result || '');
          resolve(res.includes(',') ? res.split(',')[1] : res);
        };
        reader.onerror = () => reject(new Error('Gagal membaca file PDF.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/admin/auto-discounts/parse-pdf', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: file.name,
          fileBase64: base64,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Gagal mengekstrak diskon dari PDF.');
        return;
      }

      const rows = (data.rows || []) as DraftDiscountRow[];
      setPendingDiscountPdf({
        filename: file.name,
        fileBase64: base64,
        extractionMethod: data.extraction_method || 'ocr_vision',
        rows,
      });

      if (rows.length === 0) {
        notify(
          'error',
          `PDF "${file.name}" terbaca, namun tidak ditemukan baris diskon otomatis. Anda dapat menambahkan aturan diskon manual di bawah.`
        );
      } else {
        notify(
          'success',
          `Berhasil membaca ${rows.length} aturan diskon dari PDF "${file.name}". Periksa pratinjau lalu klik Simpan ke Database.`
        );
      }
    } catch {
      notify('error', 'Terjadi kendala saat memproses file PDF diskon.');
    } finally {
      setParsingDiscountPdf(false);
    }
  }

  async function handleConfirmSaveDiscountPdf() {
    if (!pendingDiscountPdf || pendingDiscountPdf.rows.length === 0) return;
    setSavingDiscounts(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/auto-discounts/import-pdf', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filename: pendingDiscountPdf.filename,
          fileBase64: pendingDiscountPdf.fileBase64,
          rows: pendingDiscountPdf.rows,
          replace_existing: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Gagal menyimpan diskon PDF ke database.');
        return;
      }
      notify(
        'success',
        `${data.saved_count} aturan diskon DP dari "${pendingDiscountPdf.filename}" aktif dan langsung terhubung ke Cek Angsuran.`
      );
      setPendingDiscountPdf(null);
      await loadDiscounts();
      onDatabaseChanged?.();
    } finally {
      setSavingDiscounts(false);
    }
  }

  async function handleExtractFromExistingPdf(doc: StoredPdfDocItem) {
    setExtractingDocId(doc.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/auto-discounts/from-document/${doc.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Gagal mengekstrak diskon dari PDF ini.');
        return;
      }
      notify(
        'success',
        `Berhasil menerapkan ${data.saved_count} aturan diskon dari PDF "${doc.original_filename}" ke Cek Angsuran.`
      );
      await loadDiscounts();
      onDatabaseChanged?.();
    } finally {
      setExtractingDocId(null);
    }
  }

  async function handleAddManualDiscountRule(e: React.FormEvent) {
    e.preventDefault();
    if (!manualDiscMotor.trim()) {
      notify('error', 'Masukkan nama tipe motor atau "ALL" untuk semua motor.');
      return;
    }
    setAddingManualDisc(true);
    try {
      const payload =
        manualDiscType === 'percent'
          ? {
              motor_name: manualDiscMotor.trim(),
              branch: manualDiscBranch,
              discount_type: 'percent',
              discount_percent: Number.parseFloat(manualDiscValue) || 0,
              discount_amount: 0,
              promo_title: manualDiscTitle.trim() || 'Promo Diskon PDF',
              source_file: pendingDiscountPdf?.filename || 'Aturan Diskon Database',
            }
          : {
              motor_name: manualDiscMotor.trim(),
              branch: manualDiscBranch,
              discount_type: 'nominal',
              discount_percent: 0,
              discount_amount: parseRupiahInput(manualDiscValue),
              promo_title: manualDiscTitle.trim() || 'Promo Diskon PDF',
              source_file: pendingDiscountPdf?.filename || 'Aturan Diskon Database',
            };

      const res = await fetch('/api/admin/auto-discounts', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        notify('error', data.error || 'Gagal menyimpan aturan diskon.');
        return;
      }
      setManualDiscMotor('');
      notify('success', 'Aturan diskon berhasil ditambahkan dan langsung aktif di Cek Angsuran.');
      await loadDiscounts();
      onDatabaseChanged?.();
    } finally {
      setAddingManualDisc(false);
    }
  }

  async function handleToggleDiscountActive(rule: AutoDiscountRule) {
    const res = await fetch(`/api/admin/auto-discounts/${rule.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ is_active: !rule.is_active }),
    });
    if (res.ok) {
      await loadDiscounts();
      onDatabaseChanged?.();
    }
  }

  async function handleDeleteDiscountRule(id: number) {
    const res = await fetch(`/api/admin/auto-discounts/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      await loadDiscounts();
      onDatabaseChanged?.();
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {/* Header Module Card */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#0B1F3A] text-white dark:bg-blue-600">
            <Database className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
              Database Angsuran Otomatis Yamaha
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Upload Excel, CSV, Google Sheets resmi, atau PDF (ekstraksi tabel & OCR), lalu
              mapping kolom, validasi duplikat, dan sinkronkan langsung ke Cek Angsuran di Home.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleExportExcel}
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-800 transition-colors hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-950/80"
        >
          <Download className="h-4 w-4" />
          Export Database ke Excel
        </button>
      </div>

      {/* Sub-Tabs */}
      <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900">
        {(
          [
            { id: 'import', label: '1. Import & Mapping Data', icon: Upload },
            { id: 'records', label: '2. Data Database Tersimpan', icon: FileSpreadsheet },
            { id: 'batches', label: '3. Riwayat Upload & Rollback', icon: History },
            { id: 'logs', label: '4. Log Perubahan', icon: ScrollText },
            { id: 'discounts', label: '5. Diskon PDF', icon: Percent },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                subTab === tab.id
                  ? 'bg-[#0B1F3A] text-white shadow-xs dark:bg-blue-600'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {feedback && (
        <div
          className={`flex flex-col justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium sm:flex-row sm:items-center ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200'
              : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200'
          }`}
        >
          <div className="flex items-start gap-2.5">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          {feedback.type === 'success' && feedback.savedCategory && onOpenCalculator && (
            <button
              type="button"
              onClick={() => onOpenCalculator(feedback.savedCategory)}
              className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-600"
            >
              <Calculator className="h-3.5 w-3.5" />
              Buka Cek Angsuran ({feedback.savedCategory === 'reguler' ? 'Reguler' : 'Promo'})
            </button>
          )}
        </div>
      )}

      {/* SUB-TAB 1: IMPORT WIZARD */}
      {subTab === 'import' && (
        <div className="space-y-6">
          {/* Kategori Data Import Banner (Promo vs Reguler) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
              <div>
                <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                  Pilih Kategori Data Tujuan
                </p>
                <h3 className="mt-0.5 font-display text-base font-bold text-[#0B1F3A] dark:text-white">
                  Upload ke Kategori {importCategory === 'reguler' ? 'Reguler' : 'Promo'}
                </h3>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {importCategory === 'reguler'
                    ? 'Data Excel Reguler disimpan terpisah untuk menu kategori Reguler dan tidak menimpa data Promo yang sudah berjalan.'
                    : 'Data Excel Promo tersambung langsung ke menu kategori Promo di Cek Angsuran.'}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div
                  role="tablist"
                  aria-label="Pilih Kategori Tujuan Import"
                  className="inline-flex rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-950"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={importCategory === 'promo'}
                    onClick={() => handleChangeImportCategory('promo')}
                    className={`min-h-[40px] rounded-lg px-4 py-1.5 text-xs font-bold transition-colors ${
                      importCategory === 'promo'
                        ? 'bg-[#0B1F3A] text-white shadow-xs dark:bg-blue-600'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    Promo
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={importCategory === 'reguler'}
                    onClick={() => handleChangeImportCategory('reguler')}
                    className={`min-h-[40px] rounded-lg px-4 py-1.5 text-xs font-bold transition-colors ${
                      importCategory === 'reguler'
                        ? 'bg-[#0B1F3A] text-white shadow-xs dark:bg-blue-600'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                    }`}
                  >
                    Reguler
                  </button>
                </div>

                <a
                  href={`/api/auto-installments/template?category=${importCategory}`}
                  className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Download className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />
                  Template Excel {importCategory === 'reguler' ? 'Reguler' : 'Promo'} (.xlsx)
                </a>
              </div>
            </div>
          </div>

          {/* Step 1: Source Pickers */}
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Left: Excel / CSV / PDF Upload */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-display text-base font-bold text-[#0B1F3A] dark:text-white">
                A. Upload File Excel {importCategory === 'reguler' ? 'Reguler' : 'Promo'}, CSV, atau PDF (OCR)
              </h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Mendukung `.xlsx`, `.xls`, `.csv`, serta dokumen `.pdf`. Jika Excel memiliki sheet
                Palembang, Sumsel, dan Bengkulu, sistem otomatis membaca semua wilayah sekaligus.
              </p>

              <label className="mt-4 flex min-h-[140px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-5 text-center transition-colors hover:border-blue-600 hover:bg-blue-50/40 dark:border-slate-700 dark:bg-slate-950 dark:hover:border-blue-500 dark:hover:bg-blue-950/30">
                {parsingSource ? (
                  <>
                    <Loader2 className="h-7 w-7 animate-spin text-blue-700 dark:text-blue-400" />
                    <span className="mt-2.5 text-xs font-bold text-[#0B1F3A] dark:text-white">
                      Memproses & mengekstrak tabel data...
                    </span>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2 text-blue-700 dark:text-blue-400">
                      <FileSpreadsheet className="h-6 w-6" />
                      <FileText className="h-6 w-6" />
                    </div>
                    <span className="mt-2.5 text-sm font-bold text-slate-900 dark:text-white">
                      Pilih File Excel {importCategory === 'reguler' ? 'Reguler' : 'Promo'}, CSV, atau PDF
                    </span>
                    <span className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Format .xlsx, .xls, .csv, .pdf (Maks. 15 MB)
                    </span>
                  </>
                )}
                <input
                  type="file"
                  disabled={parsingSource || confirmingImport}
                  accept=".xlsx,.xls,.csv,.ods,.tsv,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                  onChange={(e) => handleFileUpload(e)}
                  className="sr-only"
                />
              </label>

              <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={autoConfirmOnUpload}
                  onChange={(e) => setAutoConfirmOnUpload(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-[#0B1F3A] focus:ring-blue-600"
                />
                <span>
                  Otomatis simpan ke database setelah file Excel/CSV terbaca (1-klik langsung aktif di{' '}
                  {importCategory === 'reguler' ? 'Reguler' : 'Promo'})
                </span>
              </label>
            </div>

            {/* Right: Official Google Sheets Integration */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-display text-base font-bold text-[#0B1F3A] dark:text-white">
                    B. Import Google Sheets (Integrasi Resmi)
                  </h3>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Hubungkan akun Google Anda untuk membaca tab dan tabel angsuran langsung dari
                    Google Sheets secara aman.
                  </p>
                </div>
              </div>

              {!googleToken ? (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center dark:border-slate-800 dark:bg-slate-950">
                  <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
                    Masuk dengan Google untuk memberi izin aplikasi membaca Google Sheets Anda.
                  </p>
                  <button
                    type="button"
                    disabled={googleAuthLoading}
                    onClick={handleGoogleSignIn}
                    className="inline-flex min-h-[44px] items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-800 shadow-xs transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 48 48" aria-hidden="true">
                      <path
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                    </svg>
                    {googleAuthLoading ? 'Menghubungkan...' : 'Sign in with Google'}
                  </button>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/50">
                    <span className="font-semibold text-emerald-900 dark:text-emerald-200">
                      Terhubung: {googleUserEmail}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        signOutGoogleSheets();
                        setGsMetadata(null);
                      }}
                      className="inline-flex items-center gap-1 font-semibold text-slate-600 hover:text-red-700 dark:text-slate-300 dark:hover:text-red-400"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Putuskan
                    </button>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      type="text"
                      value={sheetUrlInput}
                      onChange={(e) => setSheetUrlInput(e.target.value)}
                      placeholder="Tempel tautan Google Sheets atau Spreadsheet ID..."
                      className="h-11 flex-1 rounded-xl border border-slate-300 bg-white px-3.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                    />
                    <button
                      type="button"
                      disabled={loadingGsMeta}
                      onClick={handleFetchGoogleSheetMeta}
                      className="min-h-[44px] shrink-0 rounded-xl bg-[#0B1F3A] px-4 py-2 text-xs font-bold text-white hover:bg-[#14325C] disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                    >
                      {loadingGsMeta ? 'Memuat...' : 'Cek Sheet'}
                    </button>
                  </div>

                  {gsMetadata && (
                    <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-950">
                      <div className="flex-1">
                        <p className="text-xs font-bold text-slate-900 dark:text-white">{gsMetadata.title}</p>
                        <select
                          value={selectedGsTab}
                          onChange={(e) => setSelectedGsTab(e.target.value)}
                          aria-label="Pilih tab Google Sheets"
                          className="mt-1.5 h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                        >
                          {gsMetadata.sheet_names.length > 1 && (
                            <option value="__ALL__">
                              Semua Tab Sekaligus ({gsMetadata.sheet_names.join(', ')})
                            </option>
                          )}
                          {gsMetadata.sheet_names.map((name) => (
                            <option key={name} value={name}>
                              Tab: {name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <button
                        type="button"
                        disabled={parsingSource}
                        onClick={() => handleReadGoogleSheetData()}
                        className="min-h-[42px] shrink-0 rounded-xl bg-blue-700 px-4 py-2 text-xs font-bold text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500"
                      >
                        Ambil Data Tab
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Step 2: Column Mapping + Defaults + Raw Preview */}
          {parsedSource && mapping && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center dark:border-slate-800">
                <div>
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                    Langkah 2 · Mapping Kolom Otomatis & Manual
                  </p>
                  <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                    {parsedSource.source_name} ({parsedSource.rows.length} baris sumber)
                  </h3>
                  {parsedSource.sheet_stats && parsedSource.sheet_stats.length > 1 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {parsedSource.sheet_stats.map((st) => (
                        <span
                          key={st.sheet_name}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-[#0B1F3A] tabular-nums dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-200"
                        >
                          Sheet {st.sheet_name}: {st.row_count} baris
                        </span>
                      ))}
                    </div>
                  )}
                  {parsedSource.extraction_method && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Metode ekstraksi PDF: {parsedSource.extraction_method}
                    </p>
                  )}
                </div>

                {parsedSource.sheet_names.length > 1 && pendingFileInfo && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-400">Sheet:</span>
                    <select
                      value={parsedSource.active_sheet}
                      onChange={(e) => handleSwitchExcelSheet(e.target.value)}
                      className="h-10 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="__ALL__">
                        Semua Sheet ({parsedSource.sheet_names.length})
                      </option>
                      {parsedSource.sheet_names.map((s) => (
                        <option key={s} value={s}>
                          Sheet: {s}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Default Metadata Fields */}
              <div className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-950">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Leasing Default (jika kolom leasing kosong)
                  </label>
                  <input
                    type="text"
                    value={defaultLeasing}
                    onChange={(e) => {
                      setDefaultLeasing(e.target.value);
                      setValidation(null);
                    }}
                    placeholder="Contoh: BAF Finance / Adira"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Cabang / Wilayah Default
                  </label>
                  <input
                    type="text"
                    value={defaultBranch}
                    onChange={(e) => {
                      setDefaultBranch(e.target.value);
                      setValidation(null);
                    }}
                    placeholder="Contoh: Prabumulih - Gunung Ibul"
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Tanggal Berlaku Default
                  </label>
                  <input
                    type="date"
                    value={defaultEffectiveDate}
                    onChange={(e) => {
                      setDefaultEffectiveDate(e.target.value);
                      setValidation(null);
                    }}
                    className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              {/* Manual Field Mapping Dropdowns */}
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(
                  [
                    { key: 'motor_name', label: 'Tipe Motor *' },
                    { key: 'variant', label: 'Varian Motor' },
                    { key: 'dp_amount', label: 'Nominal DP *' },
                    { key: 'tenor_months', label: 'Kolom Tenor (Format Vertikal)' },
                    { key: 'installment_amount', label: 'Kolom Angsuran (Format Vertikal)' },
                    { key: 'leasing_name', label: 'Nama Leasing / Pembiayaan' },
                    { key: 'branch', label: 'Cabang / Wilayah' },
                    { key: 'effective_date', label: 'Tanggal Berlaku' },
                    { key: 'is_active', label: 'Status Aktif' },
                  ] as const
                ).map((field) => (
                  <div key={field.key}>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      {field.label}
                    </label>
                    <select
                      value={mapping[field.key]}
                      onChange={(e) => {
                        setMapping({ ...mapping, [field.key]: e.target.value });
                        setValidation(null);
                      }}
                      className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                    >
                      <option value="">-- Tidak Dipetakan / Gunakan Default --</option>
                      {parsedSource.headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              {/* Wide Tenor Columns Helper (if spreadsheet has horizontal tenor columns like 11, 17, 23...) */}
              <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/60 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
                <p className="text-xs font-bold text-[#0B1F3A] dark:text-blue-200">
                  Mapping Kolom Tenor Horizontal (Opsional — jika setiap tenor punya kolom sendiri)
                </p>
                <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-400">
                  Isi angka bulan (misal 11, 17, 23, 29, 33, 12, 24, 36) untuk kolom yang berisi
                  nominal angsuran per tenor. Kosongkan jika memakai Kolom Tenor & Angsuran Vertikal.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                  {parsedSource.headers.map((h) => (
                    <div key={h} className="rounded-lg border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
                      <p className="truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300" title={h}>
                        {h}
                      </p>
                      <input
                        type="number"
                        min={1}
                        max={60}
                        placeholder="Tenor (bln)"
                        value={mapping.wide_tenor_columns[h] ?? ''}
                        onChange={(e) => toggleWideTenorMapping(h, e.target.value)}
                        className="mt-1 h-8 w-full rounded border border-slate-200 bg-white px-2 font-mono text-xs text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Raw Preview Table (first 8 rows before validation) */}
              {parsedSource.rows.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Pratinjau Data Mentah (maks. 8 baris pertama):
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                        <tr>
                          {parsedSource.headers.map((h) => (
                            <th key={h} className="px-3 py-2 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {parsedSource.rows.slice(0, 8).map((row, idx) => (
                          <tr key={idx}>
                            {parsedSource.headers.map((h) => (
                              <td key={h} className="px-3 py-2 whitespace-nowrap text-slate-700 tabular-nums dark:text-slate-300">
                                {String(row[h] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  disabled={validating}
                  onClick={handleRunValidation}
                  className="inline-flex min-h-[46px] items-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-600 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {validating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Memvalidasi & Mengecek Duplikat...
                    </>
                  ) : (
                    <>
                      Validasi Data & Cek Duplikat
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 & 4: Validation Summary, Duplicate Detection, & Confirm Import */}
          {validation && parsedSource && (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center dark:border-slate-800">
                <div>
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                    Langkah 3 & 4 · Validasi Data, Deteksi Duplikat & Konfirmasi Import
                  </p>
                  <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                    Ringkasan Pemeriksaan ({validation.total_normalized} record)
                  </h3>
                </div>
                <button
                  type="button"
                  disabled={
                    confirmingImport ||
                    (validation.new_count === 0 &&
                      (importMode === 'skip_existing' || validation.update_count === 0))
                  }
                  onClick={handleConfirmImport}
                  className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  {confirmingImport ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Menyimpan ke Database...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Konfirmasi &amp; Simpan ke {importCategory === 'reguler' ? 'Reguler' : 'Promo'}
                    </>
                  )}
                </button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/40">
                  <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">Data Baru</p>
                  <p className="mt-1 font-mono text-2xl font-bold text-emerald-900 tabular-nums dark:text-emerald-200">
                    {validation.new_count}
                  </p>
                </div>
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-3.5 dark:border-blue-900/60 dark:bg-blue-950/40">
                  <p className="text-[11px] font-semibold text-blue-800 dark:text-blue-300">Update Data Lama</p>
                  <p className="mt-1 font-mono text-2xl font-bold text-blue-900 tabular-nums dark:text-blue-200">
                    {validation.update_count}
                  </p>
                </div>
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-900/60 dark:bg-amber-950/40">
                  <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">Duplikat di File</p>
                  <p className="mt-1 font-mono text-2xl font-bold text-amber-900 tabular-nums dark:text-amber-200">
                    {validation.duplicate_in_file_count}
                  </p>
                </div>
                <div className="rounded-xl border border-red-200 bg-red-50 p-3.5 dark:border-red-900/60 dark:bg-red-950/40">
                  <p className="text-[11px] font-semibold text-red-800 dark:text-red-300">Baris Tidak Valid</p>
                  <p className="mt-1 font-mono text-2xl font-bold text-red-900 tabular-nums dark:text-red-200">
                    {validation.invalid_count}
                  </p>
                </div>
              </div>

              {/* Validation Preview Table */}
              <div className="mt-5 max-h-[360px] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="sticky top-0 border-b border-slate-200 bg-slate-50 font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2.5">Status</th>
                      <th className="px-3 py-2.5">Motor & Varian</th>
                      <th className="px-3 py-2.5 text-right">DP</th>
                      <th className="px-3 py-2.5 text-right">Tenor</th>
                      <th className="px-3 py-2.5 text-right">Angsuran</th>
                      <th className="px-3 py-2.5">Leasing / Cabang</th>
                      <th className="px-3 py-2.5">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {validation.rows.slice(0, 100).map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2 font-semibold whitespace-nowrap">
                          {r.status === 'new' && (
                            <span className="text-emerald-700 dark:text-emerald-400">Baru</span>
                          )}
                          {r.status === 'update' && (
                            <span className="text-blue-700 dark:text-blue-400">Update</span>
                          )}
                          {r.status === 'duplicate_in_file' && (
                            <span className="text-amber-700 dark:text-amber-400">Duplikat</span>
                          )}
                          {r.status === 'invalid' && (
                            <span className="text-red-700 dark:text-red-400">Invalid</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <span className="font-semibold text-slate-900 dark:text-white">{r.motor_name}</span>{' '}
                          <span className="text-slate-500 dark:text-slate-400">· {r.variant}</span>
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-800 tabular-nums dark:text-slate-200">
                          {r.dp_amount > 0 ? formatRupiah(r.dp_amount) : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                          {r.tenor_months > 0 ? `${r.tenor_months} bln` : '-'}
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-[#0B1F3A] tabular-nums dark:text-blue-400">
                          {r.installment_amount > 0 ? formatRupiah(r.installment_amount) : '-'}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                          {r.leasing_name}
                          {r.branch ? ` · ${r.branch}` : ''}
                        </td>
                        <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{r.reason || 'Siap disimpan'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Import Mode & Confirmation */}
              <div className="mt-5 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 dark:border-slate-800 dark:bg-slate-950">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Mode Penanganan Konflik Data
                  </label>
                  <select
                    value={importMode}
                    onChange={(e) => setImportMode(e.target.value as AutoImportMode)}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
                  >
                    <option value="upsert">
                      Simpan Data Baru & Perbarui Data Lama yang Cocok (Aman + Rollback)
                    </option>
                    <option value="skip_existing">
                      Tambahkan Hanya Data Baru (Lewati Data yang Sudah Ada)
                    </option>
                    <option value="replace_source">
                      Ganti Data Sebelumnya dari Sumber File yang Sama
                    </option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Catatan Batch Import (Opsional)
                  </label>
                  <input
                    type="text"
                    value={importNotes}
                    onChange={(e) => setImportNotes(e.target.value)}
                    placeholder="Contoh: Pricelist BAF November 2026 Prabumulih"
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
                  <ShieldCheck className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                  Transaksi aman: snapshot data lama disimpan otomatis untuk rollback kapan saja.
                </p>
                <button
                  type="button"
                  disabled={
                    confirmingImport ||
                    (validation.new_count === 0 &&
                      (importMode === 'skip_existing' || validation.update_count === 0))
                  }
                  onClick={handleConfirmImport}
                  className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-emerald-700 px-6 py-3 text-sm font-bold text-white shadow-xs transition-colors hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  {confirmingImport ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Menyimpan ke Database...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Konfirmasi & Simpan ke Database
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: STORED DATABASE RECORDS */}
      {subTab === 'records' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="relative sm:col-span-5">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                value={recordSearch}
                onChange={(e) => setRecordSearch(e.target.value)}
                placeholder="Cari tipe motor, varian, wilayah, leasing, DP, atau sumber file..."
                className="h-11 w-full rounded-xl border border-slate-300 bg-white pr-4 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
              />
            </div>
            <div className="sm:col-span-2">
              <select
                value={recordCategoryFilter}
                onChange={(e) =>
                  setRecordCategoryFilter(e.target.value as 'all' | AutoInstallmentCategory)
                }
                aria-label="Filter kategori promo atau reguler"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="all">Semua Kategori</option>
                <option value="promo">Promo</option>
                <option value="reguler">Reguler</option>
              </select>
            </div>
            <div className="sm:col-span-3">
              <select
                value={recordBranchFilter}
                onChange={(e) => setRecordBranchFilter(e.target.value)}
                aria-label="Filter wilayah atau cabang"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="">Semua Wilayah / Cabang</option>
                {availableBranches.map((br) => (
                  <option key={br} value={br}>
                    {br}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <select
                value={recordStatusFilter}
                onChange={(e) =>
                  setRecordStatusFilter(e.target.value as 'all' | 'active' | 'inactive')
                }
                aria-label="Filter status aktif"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
              >
                <option value="all">Semua Status</option>
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
              </select>
            </div>
          </div>

          {loadingList ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-14 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-blue-700 dark:text-blue-400" />
              <span className="text-sm font-medium">Memuat record database...</span>
            </div>
          ) : records.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Tidak ada record ditemukan.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-3">ID & Kategori</th>
                      <th className="px-3 py-3">Motor & Varian</th>
                      <th className="px-3 py-3 text-right">DP</th>
                      <th className="px-3 py-3 text-right">Tenor</th>
                      <th className="px-3 py-3 text-right">Angsuran / Bln</th>
                      <th className="px-3 py-3">Leasing & Cabang</th>
                      <th className="px-3 py-3">Berlaku / Sumber</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3 text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {records.map((rec) => (
                      <tr key={rec.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <span className="font-mono text-slate-500 tabular-nums dark:text-slate-400">
                            #{rec.id}
                          </span>
                          <span
                            className={`ml-1.5 inline-block rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                              rec.category === 'reguler'
                                ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                                : 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                            }`}
                          >
                            {rec.category === 'reguler' ? 'Reguler' : 'Promo'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-bold text-slate-900 dark:text-white">{rec.motor_name}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{rec.variant}</p>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-semibold text-slate-800 tabular-nums dark:text-slate-200">
                          {formatRupiah(rec.dp_amount)}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-700 tabular-nums dark:text-slate-300">
                          {rec.tenor_months} bln
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono font-bold text-[#0B1F3A] tabular-nums dark:text-blue-400">
                          {formatRupiah(rec.installment_amount)}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{rec.leasing_name || '-'}</p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">{rec.branch || '-'}</p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-mono text-[11px] text-slate-700 tabular-nums dark:text-slate-300">
                            {rec.effective_date}
                          </p>
                          <p className="max-w-[160px] truncate text-[11px] text-slate-500 dark:text-slate-400" title={rec.source_file}>
                            {rec.source_file}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => handleToggleRecordActive(rec)}
                            className={`rounded-lg border px-2 py-1 text-[11px] font-semibold ${
                              rec.is_active
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {rec.is_active ? 'Aktif' : 'Nonaktif'}
                          </button>
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingRecord(rec);
                              setEditDpStr(formatRupiah(rec.dp_amount));
                              setEditInstallmentStr(formatRupiah(rec.installment_amount));
                            }}
                            className="mr-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteRecordTarget(rec)}
                            className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                            title="Hapus record"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: BATCH HISTORY & ROLLBACK */}
      {subTab === 'batches' && (
        <div className="space-y-3">
          {loadingList ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-14 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-blue-700 dark:text-blue-400" />
              <span className="text-sm font-medium">Memuat riwayat upload...</span>
            </div>
          ) : batches.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              Belum ada riwayat upload.
            </div>
          ) : (
            batches.map((b) => (
              <div
                key={b.id}
                className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#0B1F3A] dark:text-blue-400">
                      Batch #{b.id}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${
                        b.category === 'reguler'
                          ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                          : 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                      }`}
                    >
                      {b.category === 'reguler' ? 'REGULER' : 'PROMO'}
                    </span>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      {b.source_type.toUpperCase()}
                    </span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                        b.status === 'completed'
                          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                          : 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                      }`}
                    >
                      {b.status === 'completed' ? 'Aktif' : 'Sudah Di-rollback'}
                    </span>
                  </div>
                  <h4 className="mt-1 text-sm font-bold text-slate-900 dark:text-white">{b.source_name}</h4>
                  <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                    Oleh {b.uploaded_by_name} · {b.created_at.replace('T', ' ').slice(0, 16)} ·
                    Leasing: {b.leasing_default || '-'}
                  </p>
                  <p className="mt-1 font-mono text-[11px] text-slate-600 tabular-nums dark:text-slate-400">
                    Baru: {b.inserted_count} · Update: {b.updated_count} · Dilewati:{' '}
                    {b.skipped_duplicates}
                  </p>
                </div>

                {b.status === 'completed' && (
                  <button
                    type="button"
                    onClick={() => setRollbackTarget(b)}
                    className="inline-flex min-h-[42px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-950/70"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Rollback Batch Ini
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* SUB-TAB 4: AUDIT CHANGE LOGS */}
      {subTab === 'logs' && (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          {loadingList ? (
            <div className="flex items-center justify-center gap-2 py-14 text-slate-500 dark:text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-blue-700 dark:text-blue-400" />
              <span className="text-sm font-medium">Memuat log perubahan...</span>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500 dark:text-slate-400">Belum ada log aktivitas.</div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {logs.map((log) => (
                <div key={log.id} className="flex flex-col gap-1 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs font-bold text-[#0B1F3A] dark:text-blue-400">
                      {log.action.toUpperCase()} · {log.actor_name}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-700 dark:text-slate-300">{log.details}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                    {log.created_at.replace('T', ' ').slice(0, 19)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 5: PDF DISCOUNTS DATABASE */}
      {subTab === 'discounts' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Upload PDF Diskon Baru */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-6 dark:border-slate-800 dark:bg-slate-900">
              <h3 className="font-display text-base font-bold text-[#0B1F3A] dark:text-white">
                Upload PDF Promo / Diskon DP
              </h3>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Unggah brosur atau tabel diskon berformat PDF (.pdf). Sistem otomatis membaca
                potongan persen (%) maupun nominal Rupiah per motor &amp; wilayah lalu
                menghubungkannya ke menu Cek Angsuran.
              </p>

              <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-blue-300 bg-blue-50/60 px-4 py-5 text-xs font-bold text-[#0B1F3A] transition-colors hover:bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200 dark:hover:bg-blue-950/50">
                {parsingDiscountPdf ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin text-blue-700 dark:text-blue-400" />
                    <span>Mengekstrak Diskon dari PDF...</span>
                  </>
                ) : (
                  <>
                    <FileText className="h-4 w-4 text-blue-700 dark:text-blue-400" />
                    <span>Pilih File PDF Diskon (.pdf)</span>
                  </>
                )}
                <input
                  type="file"
                  accept=".pdf,application/pdf"
                  disabled={parsingDiscountPdf}
                  onChange={handleUploadDiscountPdf}
                  className="hidden"
                />
              </label>

              {/* PDF yang Sudah Ada di Database */}
              {storedPdfDocs.length > 0 && (
                <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    PDF Tersimpan di Database ({storedPdfDocs.length})
                  </p>
                  <div className="mt-2.5 space-y-2">
                    {storedPdfDocs.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-slate-900 dark:text-white">
                            {doc.original_filename}
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            {doc.category} · {doc.created_at.slice(0, 10)}
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={extractingDocId === doc.id}
                          onClick={() => handleExtractFromExistingPdf(doc)}
                          className="inline-flex min-h-[36px] shrink-0 items-center gap-1.5 rounded-lg bg-[#0B1F3A] px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-900 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                        >
                          {extractingDocId === doc.id ? 'Memproses...' : 'Ekstrak Diskon'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Tambah Aturan Diskon Manual */}
            <form
              onSubmit={handleAddManualDiscountRule}
              className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-6 dark:border-slate-800 dark:bg-slate-900"
            >
              <h3 className="font-display text-base font-bold text-[#0B1F3A] dark:text-white">
                Tambah Aturan Diskon Cepat
              </h3>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                Tambahkan atau lengkapi aturan diskon per tipe motor jika dibutuhkan.
              </p>

              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Tipe Motor (atau &quot;ALL&quot;)
                  </label>
                  <input
                    type="text"
                    value={manualDiscMotor}
                    onChange={(e) => setManualDiscMotor(e.target.value)}
                    placeholder="Contoh: AEROX ALPHA"
                    className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Wilayah</label>
                  <select
                    value={manualDiscBranch}
                    onChange={(e) => setManualDiscBranch(e.target.value)}
                    className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="">Semua Wilayah (Palembang, Sumsel, Bengkulu)</option>
                    <option value="Palembang">Palembang</option>
                    <option value="Sumsel">Sumsel</option>
                    <option value="Bengkulu">Bengkulu</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Jenis Diskon</label>
                  <select
                    value={manualDiscType}
                    onChange={(e) => {
                      const t = e.target.value === 'nominal' ? 'nominal' : 'percent';
                      setManualDiscType(t);
                      setManualDiscValue(t === 'percent' ? '10' : 'Rp500.000');
                    }}
                    className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="percent">Persen (%)</option>
                    <option value="nominal">Nominal (Rp)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {manualDiscType === 'percent' ? 'Persentase (%)' : 'Nominal Potongan DP'}
                  </label>
                  <input
                    type="text"
                    value={manualDiscValue}
                    onChange={(e) =>
                      setManualDiscValue(
                        manualDiscType === 'nominal'
                          ? formatRupiahInput(e.target.value)
                          : e.target.value
                      )
                    }
                    className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-xs font-bold text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Nama Program / Promo
                  </label>
                  <input
                    type="text"
                    value={manualDiscTitle}
                    onChange={(e) => setManualDiscTitle(e.target.value)}
                    className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={addingManualDisc}
                className="mt-4 inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[#0B1F3A] px-4 py-2 text-xs font-bold text-white hover:bg-blue-900 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <Plus className="h-4 w-4" />
                {addingManualDisc ? 'Menyimpan...' : 'Simpan Aturan Diskon'}
              </button>
            </form>
          </div>

          {/* Preview Hasil Ekstraksi PDF Sebelum Simpan */}
          {pendingDiscountPdf && pendingDiscountPdf.rows.length > 0 && (
            <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-5 dark:border-blue-900/60 dark:bg-blue-950/30">
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h3 className="font-display text-base font-bold text-[#0B1F3A] dark:text-white">
                    Pratinjau Diskon dari {pendingDiscountPdf.filename} (
                    {pendingDiscountPdf.rows.length} aturan)
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Metode ekstraksi: {pendingDiscountPdf.extractionMethod}. Klik Simpan untuk
                    langsung menghubungkan diskon ini ke Cek Angsuran.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={savingDiscounts}
                  onClick={handleConfirmSaveDiscountPdf}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-2 text-xs font-bold text-white hover:bg-emerald-600 disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  {savingDiscounts ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  Simpan &amp; Aktifkan ke Database
                </button>
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">Tipe Motor</th>
                      <th className="px-3 py-2.5 font-semibold">Wilayah</th>
                      <th className="px-3 py-2.5 font-semibold">Diskon</th>
                      <th className="px-3 py-2.5 font-semibold">Tenor</th>
                      <th className="px-3 py-2.5 font-semibold">Promo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {pendingDiscountPdf.rows.map((r, idx) => (
                      <tr key={idx}>
                        <td className="px-3 py-2 font-bold text-[#0B1F3A] dark:text-white">{r.motor_name}</td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                          {r.branch || 'Semua Wilayah'}
                        </td>
                        <td className="px-3 py-2 font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                          {r.discount_type === 'percent'
                            ? `${r.discount_percent}%`
                            : formatRupiah(r.discount_amount)}
                        </td>
                        <td className="px-3 py-2 text-slate-600 tabular-nums dark:text-slate-400">
                          {r.tenor_months > 0 ? `${r.tenor_months} Bulan` : 'Semua Tenor'}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{r.promo_title}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Daftar Aturan Diskon Aktif di Database */}
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-5 py-4 dark:border-slate-800">
              <h3 className="font-display text-base font-bold text-[#0B1F3A] dark:text-white">
                Aturan Diskon DP Aktif di Database ({discountRules.length})
              </h3>
            </div>

            {loadingList ? (
              <div className="flex items-center justify-center gap-2 py-12 text-slate-500 dark:text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-blue-700 dark:text-blue-400" />
                <span className="text-xs font-medium">Memuat aturan diskon...</span>
              </div>
            ) : discountRules.length === 0 ? (
              <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
                Belum ada aturan diskon PDF tersimpan di database. Unggah file PDF diskon di atas.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-600 dark:bg-slate-950 dark:text-slate-400">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Motor</th>
                      <th className="px-4 py-3 font-semibold">Wilayah</th>
                      <th className="px-4 py-3 font-semibold">Diskon DP</th>
                      <th className="px-4 py-3 font-semibold">Sumber PDF</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {discountRules.map((rule) => (
                      <tr key={rule.id}>
                        <td className="px-4 py-3 font-bold text-[#0B1F3A] dark:text-white">{rule.motor_name}</td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                          {rule.branch || 'Semua Wilayah'}
                        </td>
                        <td className="px-4 py-3 font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                          {rule.discount_type === 'percent'
                            ? `${rule.discount_percent}%`
                            : formatRupiah(rule.discount_amount)}
                        </td>
                        <td className="px-4 py-3 text-slate-600 dark:text-slate-400">{rule.source_file}</td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleToggleDiscountActive(rule)}
                            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold ${
                              rule.is_active
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
                                : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {rule.is_active ? 'Aktif' : 'Nonaktif'}
                          </button>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            type="button"
                            onClick={() => handleDeleteDiscountRule(rule.id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                          >
                            <Trash2 className="h-3 w-3" />
                            Hapus
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inline Edit Modal */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
              Edit Record #{editingRecord.id}
            </h3>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {editingRecord.motor_name} · {editingRecord.variant} · {editingRecord.tenor_months} Bulan
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Nominal DP</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editDpStr}
                  onChange={(e) => setEditDpStr(formatRupiahInput(e.target.value))}
                  className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Angsuran per Bulan
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editInstallmentStr}
                  onChange={(e) => setEditInstallmentStr(formatRupiahInput(e.target.value))}
                  className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="min-h-[42px] rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={handleSaveInlineEdit}
                className="min-h-[42px] rounded-xl bg-[#0B1F3A] px-4 py-2 text-xs font-bold text-white hover:bg-[#14325C] dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                {savingEdit ? 'Menyimpan...' : 'Simpan Perubahan'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(rollbackTarget)}
        title="Rollback Batch Import?"
        description={`Yakin ingin mengembalikan database ke kondisi sebelum Batch #${rollbackTarget?.id} ("${rollbackTarget?.source_name}")? Seluruh perubahan dari batch ini akan dibatalkan.`}
        confirmLabel="Ya, Rollback Sekarang"
        loading={rollingBack}
        onConfirm={handleConfirmRollback}
        onCancel={() => setRollbackTarget(null)}
      />

      <ConfirmModal
        open={Boolean(deleteRecordTarget)}
        title="Hapus Record Angsuran?"
        description={`Hapus record #${deleteRecordTarget?.id} (${deleteRecordTarget?.motor_name} · ${deleteRecordTarget?.variant}) dari Database Angsuran Otomatis?`}
        confirmLabel="Ya, Hapus"
        loading={deletingRecord}
        onConfirm={handleConfirmDeleteRecord}
        onCancel={() => setDeleteRecordTarget(null)}
      />
    </div>
  );
}
