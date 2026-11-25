import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Calculator,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  FileText,
  FolderUp,
  Link2,
  Loader2,
  LogIn,
  LogOut,
  Search,
  Settings,
  ShieldCheck,
  Table,
  Trash2,
  Upload,
  User,
  X,
} from 'lucide-react';
import {
  AuthUser,
  AutoInstallmentCategory,
  SpreadsheetPreview,
  UploadedDocument,
  UploadedFileType,
} from '../types';
import ConfirmModal from './ConfirmModal';

interface AccountUploadSectionProps {
  currentUser: AuthUser | null;
  authToken: string | null;
  onOpenLogin: () => void;
  onLogout: () => void;
  onOpenAdminDashboard: () => void;
  onDataAppliedToInstallments: (appliedCategory?: AutoInstallmentCategory) => void;
  onUseInCalculator?: (docId: number) => void;
  onGoToCalculator?: (category?: AutoInstallmentCategory) => void;
}

const CATEGORIES = [
  'Tabel Angsuran',
  'Daftar Harga OTR',
  'Stok Unit Dealer',
  'Brosur / PDF Leasing',
  'Syarat Kredit & Lainnya',
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function AccountUploadSection({
  currentUser,
  authToken,
  onOpenLogin,
  onLogout,
  onOpenAdminDashboard,
  onDataAppliedToInstallments,
  onUseInCalculator,
  onGoToCalculator,
}: AccountUploadSectionProps) {
  const canAdmin =
    Boolean(authToken) &&
    (currentUser?.role === 'super_admin' || currentUser?.role === 'admin');

  const [documents, setDocuments] = useState<UploadedDocument[]>([]);
  const [loadingDocs, setLoadingDocs] = useState<boolean>(true);
  const [filterType, setFilterType] = useState<'all' | UploadedFileType>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Upload Form State (terbuka untuk semua orang!)
  const [uploadMode, setUploadMode] = useState<'file' | 'sheets_link'>('file');
  const [title, setTitle] = useState<string>('');
  const [category, setCategory] = useState<string>('Tabel Angsuran');
  const [autoApplyTarget, setAutoApplyTarget] = useState<'none' | AutoInstallmentCategory>('reguler');
  const [uploaderName, setUploaderName] = useState<string>(currentUser?.name || '');
  const [notes, setNotes] = useState<string>('');
  const [sheetsUrl, setSheetsUrl] = useState<string>('');
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [selectedMimeType, setSelectedMimeType] = useState<string>('');
  const [selectedFileBase64, setSelectedFileBase64] = useState<string>('');
  const [uploading, setUploading] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error';
    text: string;
    appliedCategory?: AutoInstallmentCategory;
  } | null>(null);

  // Preview Modal
  const [previewDoc, setPreviewDoc] = useState<UploadedDocument | null>(null);
  const [sheetPreview, setSheetPreview] = useState<SpreadsheetPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState<boolean>(false);
  const [applyingAction, setApplyingAction] = useState<string | null>(null);
  const [extractingPdfId, setExtractingPdfId] = useState<number | null>(null);

  // Delete Confirm Modal
  const [deleteTarget, setDeleteTarget] = useState<UploadedDocument | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  useEffect(() => {
    if (currentUser?.name && !uploaderName) {
      setUploaderName(currentUser.name);
    }
  }, [currentUser, uploaderName]);

  const fetchDocuments = useCallback(async () => {
    setLoadingDocs(true);
    try {
      const params = new URLSearchParams();
      if (filterType !== 'all') params.set('type', filterType);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());
      const res = await fetch(`/api/documents?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setDocuments(data.documents || []);
      }
    } finally {
      setLoadingDocs(false);
    }
  }, [filterType, searchQuery]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchDocuments();
    }, 150);
    return () => clearTimeout(timer);
  }, [fetchDocuments]);

  function handleFilePick(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedFileName(file.name);
    setSelectedMimeType(file.type || '');
    if (!title.trim()) {
      setTitle(file.name.replace(/\.[^/.]+$/, ''));
    }

    const lower = file.name.toLowerCase();
    if (lower.endsWith('.pdf')) {
      setAutoApplyTarget('none');
    } else if (lower.includes('promo')) {
      setAutoApplyTarget('promo');
    } else if (lower.includes('reguler') || lower.includes('regular') || category === 'Tabel Angsuran') {
      setAutoApplyTarget('reguler');
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      setSelectedFileBase64(base64);
    };
    reader.readAsDataURL(file);
  }

  async function handleUploadSubmit(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);

    if (uploadMode === 'file' && !selectedFileBase64) {
      setFeedback({
        type: 'error',
        text: 'Pilih file Excel (.xlsx/.xls), Sheets (.csv/.ods), atau PDF (.pdf) terlebih dahulu.',
      });
      return;
    }

    if (uploadMode === 'sheets_link' && !sheetsUrl.trim()) {
      setFeedback({ type: 'error', text: 'Masukkan tautan Google Sheets yang valid.' });
      return;
    }

    const isPdfFile =
      uploadMode === 'file' &&
      (selectedFileName.toLowerCase().endsWith('.pdf') || selectedMimeType === 'application/pdf');
    const resolvedAutoApply =
      canAdmin && !isPdfFile && autoApplyTarget !== 'none' ? autoApplyTarget : '';

    setUploading(true);
    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: {
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          category,
          uploaderName: uploaderName.trim() || currentUser?.name || 'Pengunjung / Sales',
          notes: notes.trim(),
          ...(resolvedAutoApply ? { autoApplyCategory: resolvedAutoApply } : {}),
          ...(uploadMode === 'file'
            ? {
                filename: selectedFileName,
                mimeType: selectedMimeType,
                fileBase64: selectedFileBase64,
              }
            : {
                sheetsUrl: sheetsUrl.trim(),
              }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Gagal mengunggah file.' });
        return;
      }

      setTitle('');
      setNotes('');
      setSheetsUrl('');
      setSelectedFileName('');
      setSelectedMimeType('');
      setSelectedFileBase64('');
      const extraDiscountMsg =
        Number(data.extracted_discounts_count || 0) > 0
          ? ` ${data.extracted_discounts_count} aturan diskon PDF otomatis masuk ke database Cek Angsuran.`
          : '';
      const appliedCat = data.auto_applied_category as AutoInstallmentCategory | null | undefined;
      const syncedTotal = Number(data.auto_inserted || 0) + Number(data.auto_updated || 0);
      let extraAutoMsg = '';
      if (appliedCat && syncedTotal > 0) {
        extraAutoMsg = ` ${syncedTotal} data angsuran otomatis masuk ke Cek Angsuran (${
          appliedCat === 'reguler' ? 'Reguler' : 'Promo'
        }).`;
        onDataAppliedToInstallments(appliedCat);
      } else if (resolvedAutoApply && !appliedCat) {
        extraAutoMsg =
          ' File tersimpan di arsip, namun kolom Motor/DP/Tenor belum terbaca otomatis — silakan buka Dashboard Promo & Angsuran -> Database Angsuran Otomatis untuk mapping kolom.';
      }
      setFeedback({
        type: 'success',
        text: `Dokumen "${data.document.title}" berhasil diunggah dan tersimpan di server.${extraDiscountMsg}${extraAutoMsg}`,
        appliedCategory: appliedCat || undefined,
      });
      await fetchDocuments();
    } catch {
      setFeedback({ type: 'error', text: 'Tidak dapat terhubung ke server.' });
    } finally {
      setUploading(false);
    }
  }

  async function handleOpenPreview(doc: UploadedDocument) {
    setPreviewDoc(doc);
    setSheetPreview(null);
    if (doc.file_type === 'excel' || doc.file_type === 'sheets') {
      setLoadingPreview(true);
      try {
        const res = await fetch(`/api/documents/${doc.id}/preview`);
        const data = await res.json();
        if (res.ok && data.preview) {
          setSheetPreview(data.preview);
        }
      } finally {
        setLoadingPreview(false);
      }
    }
  }

  async function handleApplyToInstallments(
    doc: UploadedDocument,
    targetCategory: AutoInstallmentCategory
  ) {
    if (!authToken) return;
    const actionKey = `${doc.id}:${targetCategory}`;
    setApplyingAction(actionKey);
    setFeedback(null);
    try {
      const res = await fetch(`/api/documents/${doc.id}/apply-to-installments`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ category: targetCategory }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Gagal menerapkan file ke database angsuran.' });
        return;
      }
      setFeedback({
        type: 'success',
        text: `Berhasil mengimpor ${data.imported_count} paket angsuran dari "${doc.title}" ke kategori ${
          targetCategory === 'reguler' ? 'Reguler' : 'Promo'
        }.${data.errors?.length ? ` (${data.errors.length} baris dilewati)` : ''}`,
        appliedCategory: targetCategory,
      });
      onDataAppliedToInstallments(targetCategory);
    } catch {
      setFeedback({ type: 'error', text: 'Gagal terhubung ke server.' });
    } finally {
      setApplyingAction(null);
    }
  }

  async function handleExtractPdfDiscounts(doc: UploadedDocument) {
    if (!authToken) return;
    setExtractingPdfId(doc.id);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/auto-discounts/from-document/${doc.id}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({
          type: 'error',
          text: data.error || 'Gagal mengekstrak aturan diskon dari PDF.',
        });
        return;
      }
      setFeedback({
        type: 'success',
        text: `Berhasil mengekstrak ${data.saved_count} aturan diskon DP dari PDF "${doc.original_filename}" ke database Cek Angsuran.`,
      });
      onDataAppliedToInstallments();
      await fetchDocuments();
    } catch {
      setFeedback({ type: 'error', text: 'Gagal terhubung ke server.' });
    } finally {
      setExtractingPdfId(null);
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/documents/${deleteTarget.id}`, { method: 'DELETE' });
      if (res.ok) {
        setDeleteTarget(null);
        setFeedback({ type: 'success', text: 'Dokumen berhasil dihapus.' });
        await fetchDocuments();
      } else {
        const data = await res.json();
        setFeedback({ type: 'error', text: data.error || 'Gagal menghapus dokumen.' });
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="mx-auto max-w-6xl px-4 pt-6 pb-12 sm:px-6 lg:px-8">
      {/* Top Account & Role Card */}
      <div className="rounded-3xl border border-slate-200/90 bg-white p-5 shadow-[0_2px_12px_-4px_rgba(11,31,58,0.07)] transition-colors sm:p-7 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-4">
            <div className="showroom-hero-surface flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm">
              {currentUser ? <ShieldCheck className="h-6 w-6" /> : <User className="h-6 w-6" />}
            </div>
            <div>
              <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                {currentUser
                  ? `Akun Aktif · ${
                      currentUser.role === 'super_admin'
                        ? 'Super Admin'
                        : currentUser.role === 'admin'
                        ? 'Admin'
                        : 'Sales'
                    }`
                  : 'Akses Terbuka · Semua Pengguna'}
              </p>
              <h1 className="font-display text-xl font-bold text-[#0B1F3A] sm:text-2xl dark:text-white">
                {currentUser ? currentUser.name : 'Akun & Pusat Upload File Lengkap'}
              </h1>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                {currentUser
                  ? `@${currentUser.username} · Yamaha Thamrin Gunung Ibul Prabumulih`
                  : 'Semua orang dapat mengunggah dan melihat file Excel, Google Sheets, dan PDF.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {canAdmin && (
              <button
                type="button"
                onClick={onOpenAdminDashboard}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-blue-700 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-600"
              >
                <Settings className="h-4 w-4" />
                Dashboard Promo & Angsuran
              </button>
            )}
            {currentUser ? (
              <button
                type="button"
                onClick={onLogout}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <LogOut className="h-4 w-4" />
                Keluar
              </button>
            ) : (
              <button
                type="button"
                onClick={onOpenLogin}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-2 text-xs font-semibold text-white hover:bg-[#14325C] dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <LogIn className="h-4 w-4" />
                Masuk Akun Staff
              </button>
            )}
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`mt-5 flex flex-col justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium sm:flex-row sm:items-center ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-200'
              : 'border-red-200 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-200'
          }`}
        >
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{feedback.text}</span>
          </div>
          {feedback.type === 'success' && feedback.appliedCategory && onGoToCalculator && (
            <button
              type="button"
              onClick={() => onGoToCalculator(feedback.appliedCategory)}
              className="inline-flex min-h-[38px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-600"
            >
              <Calculator className="h-3.5 w-3.5" />
              Buka Cek Angsuran ({feedback.appliedCategory === 'reguler' ? 'Reguler' : 'Promo'})
            </button>
          )}
        </div>
      )}

      {/* Main Grid: Upload Form + Document Repository */}
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left: Universal Upload Form */}
        <div className="lg:col-span-5">
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_2px_12px_-4px_rgba(11,31,58,0.07)] transition-colors sm:p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400">
                <FolderUp className="h-5 w-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                  Upload File Lengkap
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Mendukung Excel (.xlsx/.xls), Sheets (.csv/.ods/Link), dan PDF
                </p>
              </div>
            </div>

            {/* Mode Switcher */}
            <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-800">
              <button
                type="button"
                onClick={() => setUploadMode('file')}
                className={`min-h-[40px] rounded-lg px-3 text-xs font-semibold transition-colors ${
                  uploadMode === 'file'
                    ? 'bg-white text-[#0B1F3A] shadow-xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Upload File
              </button>
              <button
                type="button"
                onClick={() => setUploadMode('sheets_link')}
                className={`min-h-[40px] rounded-lg px-3 text-xs font-semibold transition-colors ${
                  uploadMode === 'sheets_link'
                    ? 'bg-white text-[#0B1F3A] shadow-xs dark:bg-slate-900 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Tautan Google Sheets
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="mt-4 space-y-4">
              {uploadMode === 'file' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Pilih File Excel, Sheets (CSV/ODS), atau PDF
                  </label>
                  <label className="mt-1.5 flex min-h-[112px] cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center transition-colors hover:border-blue-600 hover:bg-blue-50/40 dark:border-slate-700 dark:bg-slate-950/60 dark:hover:border-blue-500 dark:hover:bg-blue-950/30">
                    <Upload className="h-6 w-6 text-blue-700 dark:text-blue-400" />
                    <span className="mt-2 text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {selectedFileName || 'Ketuk untuk pilih file dari HP atau komputer'}
                    </span>
                    <span className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                      Format: .xlsx, .xls, .csv, .ods, .pdf (Maks. 10 MB)
                    </span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,.ods,.tsv,.pdf,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                      onChange={handleFilePick}
                      className="sr-only"
                    />
                  </label>
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="upload-sheets-url"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Tautan Google Sheets
                  </label>
                  <div className="relative mt-1.5">
                    <Link2 className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="upload-sheets-url"
                      type="url"
                      required={uploadMode === 'sheets_link'}
                      value={sheetsUrl}
                      onChange={(e) => setSheetsUrl(e.target.value)}
                      placeholder="https://docs.google.com/spreadsheets/d/..."
                      className="h-11 w-full rounded-xl border border-slate-300 bg-white pr-3 pl-10 text-sm text-slate-900 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                    Jika Google Sheets bersifat publik, isi tabel akan otomatis tampil dalam pratinjau.
                  </p>
                </div>
              )}

              <div>
                <label
                  htmlFor="upload-title"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Judul Dokumen
                </label>
                <input
                  id="upload-title"
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Contoh: Pricelist Angsuran Yamaha November 2026"
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="upload-category"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Kategori
                  </label>
                  <select
                    id="upload-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="upload-uploader"
                    className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    Nama Pengunggah
                  </label>
                  <input
                    id="upload-uploader"
                    type="text"
                    value={uploaderName}
                    onChange={(e) => setUploaderName(e.target.value)}
                    placeholder="Nama Anda / Sales"
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="upload-notes"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300"
                >
                  Catatan Singkat (Opsional)
                </label>
                <textarea
                  id="upload-notes"
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Keterangan periode promo, leasing, atau cabang..."
                  className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                />
              </div>

              {!selectedFileName.toLowerCase().endsWith('.pdf') && (
                <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3.5 dark:border-blue-900/50 dark:bg-blue-950/30">
                  <p className="text-xs font-bold text-[#0B1F3A] dark:text-blue-200">
                    Aktifkan Langsung ke Menu Cek Angsuran
                  </p>
                  {canAdmin ? (
                    <>
                      <div className="mt-2 grid grid-cols-3 gap-1.5">
                        {(
                          [
                            { value: 'reguler', label: 'Masuk Reguler' },
                            { value: 'promo', label: 'Masuk Promo' },
                            { value: 'none', label: 'Arsip Saja' },
                          ] as const
                        ).map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setAutoApplyTarget(opt.value)}
                            className={`min-h-[36px] rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                              autoApplyTarget === opt.value
                                ? 'bg-[#0B1F3A] text-white shadow-xs dark:bg-blue-600'
                                : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                        {autoApplyTarget === 'reguler'
                          ? 'File Excel/CSV otomatis terbaca ke kategori Reguler tanpa menimpa Promo.'
                          : autoApplyTarget === 'promo'
                          ? 'File Excel/CSV otomatis masuk ke kategori Promo.'
                          : 'File hanya disimpan ke arsip dokumen dan belum muncul di Cek Angsuran.'}
                      </p>
                    </>
                  ) : (
                    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                      <p className="text-[11px] text-slate-600 dark:text-slate-400">
                        Masuk akun Staff/Admin agar Excel otomatis aktif di Reguler saat diunggah.
                      </p>
                      <button
                        type="button"
                        onClick={onOpenLogin}
                        className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-[#0B1F3A] px-2.5 py-1 text-[11px] font-semibold text-white dark:bg-blue-600"
                      >
                        <LogIn className="h-3 w-3" />
                        Masuk Staff
                      </button>
                    </div>
                  )}
                </div>
              )}

              <button
                type="submit"
                disabled={uploading}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#14325C] disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Mengunggah File...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4" />
                    Unggah Dokumen Sekarang
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        {/* Right: Document List */}
        <div className="lg:col-span-7">
          <div className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_2px_12px_-4px_rgba(11,31,58,0.07)] transition-colors sm:p-6 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-col justify-between gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center dark:border-slate-800">
              <div>
                <h2 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                  Daftar File Terunggah ({documents.length})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Semua file Excel, Sheets, dan PDF dapat dilihat, diunduh, atau dipratinjau.
                </p>
              </div>
              <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-800">
                {(['all', 'excel', 'sheets', 'pdf'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setFilterType(t)}
                    className={`min-h-[34px] rounded-lg px-2.5 text-xs font-semibold transition-colors ${
                      filterType === t
                        ? 'bg-white text-[#0B1F3A] shadow-xs dark:bg-slate-900 dark:text-white'
                        : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                    }`}
                  >
                    {t === 'all' ? 'Semua' : t === 'excel' ? 'Excel' : t === 'sheets' ? 'Sheets' : 'PDF'}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative mt-4">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari judul dokumen, kategori, atau pengunggah..."
                className="h-11 w-full rounded-xl border border-slate-300 bg-white pr-4 pl-10 text-sm text-slate-900 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
              />
            </div>

            {loadingDocs ? (
              <div className="flex items-center justify-center gap-2 py-14 text-slate-500 dark:text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-blue-700 dark:text-blue-400" />
                <span className="text-sm font-medium">Memuat daftar dokumen...</span>
              </div>
            ) : documents.length === 0 ? (
              <div className="py-12 text-center">
                <FileText className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
                <p className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
                  Belum ada file yang diunggah
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  Gunakan formulir di samping untuk mengunggah file Excel, Google Sheets, atau PDF.
                </p>
              </div>
            ) : (
              <div className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
                {documents.map((doc) => {
                  const isPdf = doc.file_type === 'pdf';
                  const isExcel = doc.file_type === 'excel';
                  return (
                    <div key={doc.id} className="py-4 first:pt-2 last:pb-0">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div
                            className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                              isPdf
                                ? 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-400'
                                : isExcel
                                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                                : 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-400'
                            }`}
                          >
                            {isPdf ? (
                              <FileText className="h-5 w-5" />
                            ) : isExcel ? (
                              <FileSpreadsheet className="h-5 w-5" />
                            ) : (
                              <Table className="h-5 w-5" />
                            )}
                          </div>
                          <div>
                            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                              {doc.title}
                            </h3>
                            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                              {doc.file_type.toUpperCase()} · {doc.category} · Oleh {doc.uploader_name}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-400 tabular-nums dark:text-slate-500">
                              {doc.original_filename}
                              {doc.file_size > 0 ? ` · ${formatBytes(doc.file_size)}` : ''}
                              {doc.row_count > 0 ? ` · ${doc.row_count} baris data` : ''}
                              {' · '}
                              {doc.created_at.slice(0, 10)}
                            </p>
                            {doc.notes && (
                              <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300">
                                {doc.notes}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 pl-13">
                        <button
                          type="button"
                          onClick={() => handleOpenPreview(doc)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                          <Eye className="h-3.5 w-3.5 text-blue-700 dark:text-blue-400" />
                          Pratinjau
                        </button>

                        {doc.stored_filename && (
                          <a
                            href={`/api/documents/${doc.id}/file?download=1`}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                          >
                            <Download className="h-3.5 w-3.5" />
                            Unduh
                          </a>
                        )}

                        {doc.sheets_url && (
                          <a
                            href={doc.sheets_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800/60 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-950"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Buka Sheets
                          </a>
                        )}

                        {onUseInCalculator && doc.file_type !== 'pdf' && doc.stored_filename && (
                          <button
                            type="button"
                            onClick={() => onUseInCalculator(doc.id)}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-600"
                          >
                            <Calculator className="h-3.5 w-3.5" />
                            Pakai di Cek Angsuran
                          </button>
                        )}

                        {doc.file_type !== 'pdf' && doc.stored_filename && (
                          canAdmin ? (
                            <>
                              <button
                                type="button"
                                disabled={applyingAction !== null}
                                onClick={() => handleApplyToInstallments(doc, 'promo')}
                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                              >
                                {applyingAction === `${doc.id}:promo`
                                  ? 'Mengimpor Promo...'
                                  : 'Terapkan ke Promo'}
                              </button>
                              <button
                                type="button"
                                disabled={applyingAction !== null}
                                onClick={() => handleApplyToInstallments(doc, 'reguler')}
                                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#0B1F3A] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#14325C] disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                              >
                                {applyingAction === `${doc.id}:reguler`
                                  ? 'Mengimpor Reguler...'
                                  : 'Terapkan ke Reguler'}
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={onOpenLogin}
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800 hover:bg-blue-100 dark:border-blue-800/60 dark:bg-blue-950/50 dark:text-blue-300"
                            >
                              <LogIn className="h-3.5 w-3.5" />
                              Masuk Admin untuk Terapkan ke Reguler
                            </button>
                          )
                        )}

                        {canAdmin && doc.file_type === 'pdf' && doc.stored_filename && (
                          <button
                            type="button"
                            disabled={extractingPdfId === doc.id}
                            onClick={() => handleExtractPdfDiscounts(doc)}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                          >
                            {extractingPdfId === doc.id
                              ? 'Mengekstrak Diskon...'
                              : 'Ekstrak Diskon PDF ke Cek Angsuran'}
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setDeleteTarget(doc)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300 dark:hover:bg-red-950"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Hapus
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preview Modal (PDF / Spreadsheet) */}
      {previewDoc && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
              <div>
                <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                  {previewDoc.title}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {previewDoc.original_filename} · {previewDoc.category}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-5">
              {previewDoc.file_type === 'pdf' ? (
                <iframe
                  src={`/api/documents/${previewDoc.id}/file`}
                  title={previewDoc.title}
                  className="h-[68vh] w-full rounded-xl border border-slate-200 dark:border-slate-800"
                />
              ) : loadingPreview ? (
                <div className="flex items-center justify-center gap-2 py-16 text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-700 dark:text-blue-400" />
                  <span className="text-sm font-medium">Memuat pratinjau tabel...</span>
                </div>
              ) : sheetPreview && sheetPreview.headers.length > 0 ? (
                <div>
                  <p className="mb-3 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    Sheet:{' '}
                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                      {sheetPreview.sheet_name}
                    </span>{' '}
                    · Menampilkan {sheetPreview.rows.length} dari {sheetPreview.total_rows} baris
                  </p>
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full border-collapse text-left text-xs">
                      <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-700 dark:border-slate-800 dark:bg-slate-800 dark:text-slate-200">
                        <tr>
                          {sheetPreview.headers.map((h) => (
                            <th key={h} className="px-3 py-2.5 whitespace-nowrap">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {sheetPreview.rows.map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                            {sheetPreview.headers.map((h) => (
                              <td
                                key={h}
                                className="px-3 py-2 whitespace-nowrap text-slate-700 tabular-nums dark:text-slate-300"
                              >
                                {String(row[h] ?? '')}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-sm text-slate-600 dark:text-slate-400">
                  <p>
                    Pratinjau tabel tidak tersedia untuk tautan ini (kemungkinan Google Sheets
                    privat).
                  </p>
                  {previewDoc.sheets_url && (
                    <a
                      href={previewDoc.sheets_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-blue-700 px-5 py-2 text-xs font-semibold text-white"
                    >
                      <ExternalLink className="h-4 w-4" />
                      Buka Tautan Google Sheets
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title="Hapus Dokumen?"
        description={`Yakin ingin menghapus "${deleteTarget?.title}" dari arsip?`}
        confirmLabel="Ya, Hapus"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </section>
  );
}
