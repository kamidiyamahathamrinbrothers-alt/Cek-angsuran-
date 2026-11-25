import { ChangeEvent, FormEvent, useMemo, useState } from 'react';
import {
  Bike,
  Calculator,
  Camera,
  Check,
  Image as ImageIcon,
  Loader2,
  Package,
  Search,
  X,
  ZoomIn,
} from 'lucide-react';
import { AuthUser, MotorProduct } from '../types';
import { formatRupiah } from '../utils/format';

interface CatalogStockSectionProps {
  motors: MotorProduct[];
  loading: boolean;
  currentUser: AuthUser | null;
  authToken: string | null;
  onSelectForCalculator: (motorId: number) => void;
  onStockUpdated: () => void;
}

export default function CatalogStockSection({
  motors,
  loading,
  currentUser,
  authToken,
  onSelectForCalculator,
  onStockUpdated,
}: CatalogStockSectionProps) {
  const canEditStock =
    Boolean(authToken) &&
    (currentUser?.role === 'super_admin' || currentUser?.role === 'admin');

  const [search, setSearch] = useState('');
  const [selectedBrandModel, setSelectedBrandModel] = useState<string>('all');
  const [onlyReadyStock, setOnlyReadyStock] = useState<boolean>(false);
  const [failedImages, setFailedImages] = useState<Record<number, boolean>>({});

  // Photo Lightbox / Detail Modal
  const [activeMotor, setActiveMotor] = useState<MotorProduct | null>(null);

  // Stock & Photo Update State (Admin / Super Admin)
  const [editingStockMotor, setEditingStockMotor] = useState<MotorProduct | null>(null);
  const [stockCountInput, setStockCountInput] = useState<number>(0);
  const [photoBase64, setPhotoBase64] = useState<string>('');
  const [photoFilename, setPhotoFilename] = useState<string>('');
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string>('');
  const [savingStock, setSavingStock] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const modelGroups = useMemo(() => {
    const names = new Set<string>();
    for (const m of motors) {
      names.add(m.motor_name);
    }
    return Array.from(names);
  }, [motors]);

  const filteredMotors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return motors.filter((m) => {
      if (selectedBrandModel !== 'all' && m.motor_name !== selectedBrandModel) return false;
      if (onlyReadyStock && (m.stock_count ?? 0) <= 0) return false;
      if (q) {
        const hay = `${m.brand} ${m.motor_name} ${m.variant}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [motors, search, selectedBrandModel, onlyReadyStock]);

  const totalReadyUnits = useMemo(
    () => motors.reduce((sum, m) => sum + Math.max(0, m.stock_count ?? 0), 0),
    [motors]
  );

  function openEditStock(motor: MotorProduct) {
    setEditingStockMotor(motor);
    setStockCountInput(motor.stock_count ?? 0);
    setPhotoBase64('');
    setPhotoFilename('');
    setPhotoPreviewUrl(motor.image_url || '');
  }

  function handlePhotoFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setPhotoPreviewUrl(result);
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      setPhotoBase64(base64);
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveStock(e: FormEvent) {
    e.preventDefault();
    if (!editingStockMotor || !authToken) return;
    setSavingStock(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/motors/${editingStockMotor.id}/stock`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stock_count: stockCountInput,
          photoBase64: photoBase64 || undefined,
          photoFilename: photoFilename || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFeedback({ type: 'error', text: data.error || 'Gagal memperbarui stok unit.' });
        return;
      }
      setEditingStockMotor(null);
      setFeedback({
        type: 'success',
        text: `Stok dan foto ${editingStockMotor.motor_name} (${editingStockMotor.variant}) diperbarui.`,
      });
      onStockUpdated();
    } catch {
      setFeedback({ type: 'error', text: 'Gagal terhubung ke server.' });
    } finally {
      setSavingStock(false);
    }
  }

  return (
    <section id="katalog-stok" className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end dark:border-slate-800">
        <div>
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
            Showroom Unit Resmi · Prabumulih
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A] sm:text-3xl dark:text-white">
            Katalog Foto & Stok Motor
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Lihat foto unit, varian, dan ketersediaan stok dealer terkini. Ketuk foto untuk memperbesar
            atau cek simulasi angsuran.
          </p>
        </div>

        <div className="flex items-center gap-4 text-xs font-medium text-slate-600 dark:text-slate-400">
          <span className="tabular-nums">Total Varian: {motors.length}</span>
          <span aria-hidden="true">·</span>
          <span className="font-semibold text-[#0B1F3A] tabular-nums dark:text-white">
            Total Unit Ready: {totalReadyUnits} Unit
          </span>
        </div>
      </div>

      {feedback && (
        <div
          className={`mt-5 flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-200'
              : 'border-red-200 bg-red-50 text-red-900 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-200'
          }`}
        >
          <Check className="h-4 w-4 shrink-0" />
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="mt-6 space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
          <div className="relative sm:col-span-7">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari tipe atau varian motor (misal: Aerox, NMAX Turbo, Filano)..."
              className="h-11 w-full rounded-xl border border-slate-300 bg-white pr-4 pl-10 text-sm text-slate-900 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-500/20"
            />
          </div>
          <div className="flex items-center gap-2 sm:col-span-5">
            <button
              type="button"
              onClick={() => setOnlyReadyStock((v) => !v)}
              className={`flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition-colors ${
                onlyReadyStock
                  ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white dark:border-blue-600 dark:bg-blue-600'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
              }`}
            >
              <Package className="h-4 w-4" />
              {onlyReadyStock ? 'Hanya Ready Stock' : 'Tampilkan Semua Stok'}
            </button>
          </div>
        </div>

        {/* Model Filter Tabs */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedBrandModel('all')}
            className={`min-h-[38px] rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              selectedBrandModel === 'all'
                ? 'border-blue-700 bg-blue-700 text-white dark:border-blue-600 dark:bg-blue-600'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
            }`}
          >
            Semua Tipe
          </button>
          {modelGroups.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSelectedBrandModel(name)}
              className={`min-h-[38px] rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                selectedBrandModel === name
                  ? 'border-blue-700 bg-blue-700 text-white dark:border-blue-600 dark:bg-blue-600'
                  : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Gallery Grid */}
      {loading ? (
        <div className="mt-10 flex items-center justify-center gap-2 py-12 text-slate-500 dark:text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin text-blue-700 dark:text-blue-400" />
          <span className="text-sm font-medium">Memuat katalog foto stok motor...</span>
        </div>
      ) : filteredMotors.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            Tidak ada unit motor yang cocok
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Coba ubah filter atau kata kunci pencarian.
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMotors.map((motor) => {
            const imgBroken = failedImages[motor.id];
            const stock = motor.stock_count ?? 0;
            return (
              <article
                key={motor.id}
                className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-all duration-150 hover:border-blue-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 dark:hover:border-blue-700"
              >
                <button
                  type="button"
                  onClick={() => setActiveMotor(motor)}
                  className="relative aspect-[4/3] w-full overflow-hidden bg-slate-100 text-left focus:outline-none dark:bg-slate-800"
                  aria-label={`Perbesar foto ${motor.motor_name} ${motor.variant}`}
                >
                  {motor.image_url && !imgBroken ? (
                    <img
                      src={motor.image_url}
                      alt={`${motor.motor_name} ${motor.variant}`}
                      referrerPolicy="no-referrer"
                      onError={() => setFailedImages((prev) => ({ ...prev, [motor.id]: true }))}
                      className="h-full w-full object-cover object-center transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-[#0B1F3A] dark:from-slate-800 dark:to-slate-900 dark:text-slate-300">
                      <Bike className="h-12 w-12 text-slate-400 dark:text-slate-500" />
                      <span className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                        {motor.motor_name}
                      </span>
                    </div>
                  )}
                  <span className="absolute right-3 bottom-3 inline-flex items-center gap-1 rounded-lg bg-slate-950/75 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-xs">
                    <ZoomIn className="h-3.5 w-3.5" />
                    Lihat Foto
                  </span>
                </button>

                <div className="flex flex-1 flex-col justify-between p-5">
                  <div>
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-slate-500 dark:text-slate-400">
                        {motor.brand} · {motor.variant}
                      </span>
                      <span
                        className={`font-semibold tabular-nums ${
                          stock > 0
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {stock > 0 ? `Ready ${stock} Unit` : 'Stok Habis'}
                      </span>
                    </div>

                    <h2 className="mt-1.5 font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                      {motor.motor_name}
                    </h2>

                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 dark:border-slate-800">
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">DP Mulai</p>
                        <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                          {motor.min_dp ? formatRupiah(motor.min_dp) : 'Hubungi Sales'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Angsuran Mulai</p>
                        <p className="font-mono text-sm font-bold text-blue-700 tabular-nums dark:text-blue-400">
                          {motor.min_installment ? formatRupiah(motor.min_installment) : '-'}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => onSelectForCalculator(motor.id)}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-[#14325C] dark:bg-blue-600 dark:hover:bg-blue-500"
                    >
                      <Calculator className="h-3.5 w-3.5" />
                      Cek Angsuran
                    </button>
                    {canEditStock && (
                      <button
                        type="button"
                        onClick={() => openEditStock(motor)}
                        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                        title="Ubah stok atau upload foto unit"
                      >
                        <Camera className="h-3.5 w-3.5" />
                        Stok
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Photo Lightbox Modal */}
      {activeMotor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 dark:border-slate-800">
              <div>
                <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                  {activeMotor.motor_name} · {activeMotor.variant}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Stok Dealer:{' '}
                  {activeMotor.stock_count > 0 ? `${activeMotor.stock_count} Unit Ready` : 'Kosong'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveMotor(null)}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                aria-label="Tutup foto"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="aspect-[4/3] w-full bg-slate-100 dark:bg-slate-950">
              {activeMotor.image_url && !failedImages[activeMotor.id] ? (
                <img
                  src={activeMotor.image_url}
                  alt={`${activeMotor.motor_name} ${activeMotor.variant}`}
                  referrerPolicy="no-referrer"
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center text-slate-400 dark:text-slate-500">
                  <ImageIcon className="h-12 w-12" />
                  <p className="mt-2 text-xs">Foto unit belum tersedia</p>
                </div>
              )}
            </div>

            <div className="flex flex-col justify-between gap-3 border-t border-slate-100 p-5 sm:flex-row sm:items-center dark:border-slate-800">
              <div className="text-xs text-slate-600 dark:text-slate-400">
                DP mulai{' '}
                <span className="font-mono font-bold text-slate-900 tabular-nums dark:text-slate-100">
                  {activeMotor.min_dp ? formatRupiah(activeMotor.min_dp) : '-'}
                </span>{' '}
                · Angsuran mulai{' '}
                <span className="font-mono font-bold text-blue-700 tabular-nums dark:text-blue-400">
                  {activeMotor.min_installment ? formatRupiah(activeMotor.min_installment) : '-'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  const id = activeMotor.id;
                  setActiveMotor(null);
                  onSelectForCalculator(id);
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-600"
              >
                <Calculator className="h-4 w-4" />
                Cek Angsuran Unit Ini
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Stock & Upload Photo Modal (Admin / Super Admin) */}
      {editingStockMotor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div>
                <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                  Perbarui Stok & Foto Unit
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {editingStockMotor.motor_name} · {editingStockMotor.variant}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingStockMotor(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveStock} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Jumlah Stok Unit Ready
                </label>
                <input
                  type="number"
                  min={0}
                  value={stockCountInput}
                  onChange={(e) => setStockCountInput(Math.max(0, Number(e.target.value) || 0))}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Upload Foto Stok Baru (JPG/PNG/WEBP, opsional)
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handlePhotoFileChange}
                  className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white p-2 text-xs text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#0B1F3A] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:file:bg-blue-600"
                />
                {photoPreviewUrl && (
                  <img
                    src={photoPreviewUrl}
                    alt="Pratinjau unit"
                    referrerPolicy="no-referrer"
                    className="mt-3 h-36 w-full rounded-xl border border-slate-200 object-cover dark:border-slate-700"
                  />
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditingStockMotor(null)}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingStock}
                  className="min-h-[44px] rounded-xl bg-[#0B1F3A] px-5 py-2 text-sm font-semibold text-white hover:bg-[#14325C] disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {savingStock ? 'Menyimpan...' : 'Simpan Stok & Foto'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
