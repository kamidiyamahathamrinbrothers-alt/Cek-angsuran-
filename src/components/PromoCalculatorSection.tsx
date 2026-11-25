import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bike,
  Calculator,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  FileSpreadsheet,
  Info,
  Loader2,
  MessageCircle,
  Sparkles,
  Upload,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  InstallmentLookupResponse,
  InstallmentPackage,
  MotorProduct,
  SpreadsheetInstallmentDataset,
  UploadedDocument,
} from '../types';
import {
  buildWhatsAppMessage,
  buildWhatsAppShareUrl,
  formatRupiah,
  formatRupiahInput,
  parseRupiahInput,
} from '../utils/format';

interface PromoCalculatorSectionProps {
  motors: MotorProduct[];
  motorsLoading: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  externalSelectedMotorId?: number | null;
  externalDocumentId?: number | null;
  onClearExternalDocument?: () => void;
  standalone?: boolean;
}

const HERO_BANNER_IMAGE = '/src/assets/images/hero_yamaha_promo_1795388181756.jpg';

export default function PromoCalculatorSection({
  motors,
  motorsLoading,
  isOpen,
  onOpenChange,
  externalSelectedMotorId,
  externalDocumentId,
  onClearExternalDocument,
  standalone = false,
}: PromoCalculatorSectionProps) {
  const calculatorRef = useRef<HTMLDivElement | null>(null);
  const quickUploadInputRef = useRef<HTMLInputElement | null>(null);

  // Data source state: 'db' or uploaded spreadsheet document ID
  const [spreadsheetDocs, setSpreadsheetDocs] = useState<UploadedDocument[]>([]);
  const [dataSource, setDataSource] = useState<'db' | number>('db');
  const [sheetDataset, setSheetDataset] = useState<SpreadsheetInstallmentDataset | null>(null);
  const [sheetLoading, setSheetLoading] = useState<boolean>(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [quickUploading, setQuickUploading] = useState<boolean>(false);

  const [selectedMotorName, setSelectedMotorName] = useState<string>('');
  const [selectedMotorId, setSelectedMotorId] = useState<number>(0);

  // DP selection: dropdown mode by default so switching DP immediately updates data; optional manual input mode
  const [dpMode, setDpMode] = useState<'select' | 'manual'>('select');
  const [dpInput, setDpInput] = useState<string>('Rp4.000.000');
  const [selectedTenor, setSelectedTenor] = useState<number>(23);

  const [lookupResult, setLookupResult] = useState<InstallmentLookupResponse | null>(null);
  const [lookupLoading, setLookupLoading] = useState<boolean>(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const [copied, setCopied] = useState<boolean>(false);
  const [showMessagePreview, setShowMessagePreview] = useState<boolean>(false);
  const [bannerImgFailed, setBannerImgFailed] = useState<boolean>(false);
  const [motorImgFailed, setMotorImgFailed] = useState<boolean>(false);

  const fetchSpreadsheetDocs = useCallback(async () => {
    try {
      const res = await fetch('/api/documents');
      if (!res.ok) return;
      const data = await res.json();
      const allDocs = (data.documents || []) as UploadedDocument[];
      const usable = allDocs.filter(
        (d) => (d.file_type === 'excel' || d.file_type === 'sheets') && Boolean(d.stored_filename)
      );
      setSpreadsheetDocs(usable);
    } catch {
      // Ignore silent document list error
    }
  }, []);

  useEffect(() => {
    fetchSpreadsheetDocs();
  }, [fetchSpreadsheetDocs]);

  // Honor external document selection from Account tab
  useEffect(() => {
    if (externalDocumentId) {
      fetchSpreadsheetDocs();
      setDataSource(externalDocumentId);
      setDpMode('select');
      if (onClearExternalDocument) {
        onClearExternalDocument();
      }
    }
  }, [externalDocumentId, fetchSpreadsheetDocs, onClearExternalDocument]);

  // Load parsed Excel/Sheets installment dataset when a spreadsheet source is selected
  useEffect(() => {
    if (dataSource === 'db') {
      setSheetDataset(null);
      setSheetError(null);
      setSheetLoading(false);
      return;
    }

    let cancelled = false;
    setSheetLoading(true);
    setSheetError(null);

    fetch(`/api/documents/${dataSource}/installments-data`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Gagal membaca data angsuran dari file Excel/Sheets.');
        }
        return data as SpreadsheetInstallmentDataset;
      })
      .then((dataset) => {
        if (cancelled) return;
        setSheetDataset(dataset);
        if (dataset.motors.length === 0) {
          setSheetError(
            'File ini belum memiliki kolom motor, DP, dan tenor angsuran yang terbaca. Pastikan ada kolom nama motor, DP, dan tenor.'
          );
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSheetDataset(null);
        setSheetError(err instanceof Error ? err.message : 'Gagal membaca file Excel/Sheets.');
      })
      .finally(() => {
        if (!cancelled) setSheetLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dataSource]);

  const activeMotors = useMemo(() => {
    if (dataSource !== 'db' && sheetDataset) {
      return sheetDataset.motors;
    }
    return motors;
  }, [dataSource, sheetDataset, motors]);

  const uniqueMotorNames = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const m of activeMotors) {
      if (!seen.has(m.motor_name)) {
        seen.add(m.motor_name);
        list.push(m.motor_name);
      }
    }
    return list;
  }, [activeMotors]);

  // Initialize or reset motor selection whenever activeMotors changes
  useEffect(() => {
    if (activeMotors.length === 0) {
      setSelectedMotorName('');
      setSelectedMotorId(0);
      return;
    }

    const stillExists = activeMotors.some((m) => m.id === selectedMotorId);
    if (stillExists) return;

    const preferred =
      activeMotors.find(
        (m) => m.motor_name.toLowerCase().includes('aerox') && m.variant.toLowerCase() === 'standard'
      ) || activeMotors[0];

    setSelectedMotorName(preferred.motor_name);
    setSelectedMotorId(preferred.id);
    setMotorImgFailed(false);

    if (dataSource === 'db' && preferred.motor_name.toLowerCase().includes('aerox')) {
      setDpInput('Rp4.000.000');
      setSelectedTenor(23);
    } else if (preferred.min_dp) {
      setDpInput(formatRupiah(preferred.min_dp));
    }
  }, [activeMotors, selectedMotorId, dataSource]);

  // Respond when user clicks a motor unit card on Home
  useEffect(() => {
    if (!externalSelectedMotorId || motors.length === 0) return;
    setDataSource('db');
    const match = motors.find((m) => m.id === externalSelectedMotorId);
    if (match) {
      setSelectedMotorName(match.motor_name);
      setSelectedMotorId(match.id);
      setMotorImgFailed(false);
      setDpMode('select');
      if (match.min_dp) {
        setDpInput(formatRupiah(match.min_dp));
      }
      if (!isOpen) {
        onOpenChange(true);
      }
      setTimeout(() => {
        calculatorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  }, [externalSelectedMotorId, motors, isOpen, onOpenChange]);

  const variantsForSelectedMotor = useMemo(() => {
    return activeMotors.filter((m) => m.motor_name === selectedMotorName);
  }, [activeMotors, selectedMotorName]);

  const activeMotor = useMemo(() => {
    return activeMotors.find((m) => m.id === selectedMotorId) ?? null;
  }, [activeMotors, selectedMotorId]);

  const numericDp = useMemo(() => parseRupiahInput(dpInput), [dpInput]);

  // Compute Excel/Sheets lookup directly in memory when dataSource !== 'db'
  const sheetLookupResult: InstallmentLookupResponse | null = useMemo(() => {
    if (dataSource === 'db' || !sheetDataset || !activeMotor) return null;

    const motorPkgs = sheetDataset.packages.filter((p) => p.motor_id === activeMotor.id);
    const availableDps = Array.from(new Set(motorPkgs.map((p) => p.dp_amount))).sort((a, b) => a - b);

    if (availableDps.length === 0) {
      return {
        motor: activeMotor,
        requested_dp: numericDp,
        requested_tenor: selectedTenor,
        exact_dp_available: false,
        available_dps: [],
        nearest_dps: [],
        available_tenors: [],
        packages: [],
        packages_by_tenor: {},
        selected_package: null,
        message: 'Belum ada data DP dan angsuran untuk motor ini pada file Excel/Sheets.',
      };
    }

    const effectiveDp = availableDps.includes(numericDp)
      ? numericDp
      : dpMode === 'select'
      ? availableDps[0]
      : numericDp;

    const exactDpAvailable = availableDps.includes(effectiveDp);
    if (!exactDpAvailable) {
      const nearestDps = [...availableDps]
        .sort((a, b) => {
          const diffA = Math.abs(a - effectiveDp);
          const diffB = Math.abs(b - effectiveDp);
          if (diffA !== diffB) return diffA - diffB;
          return a - b;
        })
        .slice(0, 3);

      return {
        motor: activeMotor,
        requested_dp: effectiveDp,
        requested_tenor: selectedTenor,
        exact_dp_available: false,
        available_dps: availableDps,
        nearest_dps: nearestDps,
        available_tenors: [],
        packages: [],
        packages_by_tenor: {},
        selected_package: null,
        message: 'DP yang Anda masukkan belum tersedia di file Excel/Sheets. Pilih DP terdekat di bawah.',
      };
    }

    const matchingPkgs = motorPkgs
      .filter((p) => p.dp_amount === effectiveDp)
      .sort((a, b) => a.tenor_months - b.tenor_months);

    const availableTenors = matchingPkgs.map((p) => p.tenor_months);
    const packagesByTenor: Record<number, InstallmentPackage | null> = {};
    for (const pkg of matchingPkgs) {
      packagesByTenor[pkg.tenor_months] = pkg;
    }
    const effectiveTenor = availableTenors.includes(selectedTenor)
      ? selectedTenor
      : availableTenors.includes(23)
      ? 23
      : availableTenors[Math.floor(availableTenors.length / 2)] ?? availableTenors[0];

    return {
      motor: activeMotor,
      requested_dp: effectiveDp,
      requested_tenor: effectiveTenor,
      exact_dp_available: true,
      available_dps: availableDps,
      nearest_dps: [],
      available_tenors: availableTenors,
      packages: matchingPkgs,
      packages_by_tenor: packagesByTenor,
      selected_package: packagesByTenor[effectiveTenor] ?? null,
      message: null,
    };
  }, [dataSource, sheetDataset, activeMotor, numericDp, selectedTenor, dpMode]);

  // Auto-query DB when dataSource === 'db'
  useEffect(() => {
    if (dataSource !== 'db') return;
    if ((!standalone && !isOpen) || !selectedMotorId) return;

    const queryDp = numericDp > 0 ? numericDp : 1;
    if (dpMode === 'manual' && numericDp <= 0) {
      setLookupResult(null);
      setLookupError('Masukkan nominal DP dalam Rupiah untuk mencari angsuran dari database.');
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setLookupLoading(true);
      setLookupError(null);
      try {
        const params = new URLSearchParams({
          motor_id: String(selectedMotorId),
          dp_amount: String(queryDp),
          tenor_months: String(selectedTenor),
        });
        const res = await fetch(`/api/installments/lookup?${params.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLookupError(data.error || 'Gagal memuat data angsuran.');
          setLookupResult(null);
          return;
        }
        const parsed = data as InstallmentLookupResponse;
        setLookupResult(parsed);

        // In dropdown mode, if current DP doesn't exist for this motor, snap automatically to a valid DP
        if (
          dpMode === 'select' &&
          !parsed.exact_dp_available &&
          parsed.available_dps.length > 0
        ) {
          const fallbackDp = parsed.available_dps.includes(4000000)
            ? 4000000
            : parsed.available_dps[0];
          setDpInput(formatRupiah(fallbackDp));
        }
      } catch {
        if (!cancelled) {
          setLookupError('Koneksi ke server database terputus. Coba beberapa saat lagi.');
        }
      } finally {
        if (!cancelled) {
          setLookupLoading(false);
        }
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [dataSource, standalone, isOpen, selectedMotorId, numericDp, selectedTenor, dpMode]);

  const activeResult = dataSource === 'db' ? lookupResult : sheetLookupResult;
  const activeLoading = dataSource === 'db' ? lookupLoading : sheetLoading;
  const activeError = dataSource === 'db' ? lookupError : sheetError;

  // Keep dpInput synced when switching to Excel/Sheets in dropdown mode
  useEffect(() => {
    if (dataSource === 'db' || dpMode !== 'select' || !sheetLookupResult) return;
    if (
      sheetLookupResult.available_dps.length > 0 &&
      !sheetLookupResult.available_dps.includes(numericDp)
    ) {
      const nextDp = sheetLookupResult.available_dps.includes(4000000)
        ? 4000000
        : sheetLookupResult.available_dps[0];
      setDpInput(formatRupiah(nextDp));
    }
  }, [dataSource, dpMode, sheetLookupResult, numericDp]);

  // Strictly use ONLY tenors that actually exist in DB / Excel / Sheet for this motor & DP
  const validTenors = useMemo(() => {
    if (!activeResult || !activeResult.exact_dp_available) return [];
    const tenors =
      activeResult.available_tenors && activeResult.available_tenors.length > 0
        ? activeResult.available_tenors
        : Object.entries(activeResult.packages_by_tenor)
            .filter(([, pkg]) => pkg !== null)
            .map(([t]) => Number(t));
    return [...tenors].sort((a, b) => a - b);
  }, [activeResult]);

  // Auto-snap selectedTenor whenever DP or Motor changes so it always matches an existing tenor
  useEffect(() => {
    if (validTenors.length === 0) return;
    if (!validTenors.includes(selectedTenor)) {
      const preferredTenor = validTenors.includes(23)
        ? 23
        : validTenors[Math.floor(validTenors.length / 2)] ?? validTenors[0];
      setSelectedTenor(preferredTenor);
    }
  }, [validTenors, selectedTenor]);

  function handleMotorTypeChange(nextMotorName: string) {
    setSelectedMotorName(nextMotorName);
    setMotorImgFailed(false);
    const matchingVariants = activeMotors.filter((m) => m.motor_name === nextMotorName);
    if (matchingVariants.length > 0) {
      const nextMotor = matchingVariants[0];
      setSelectedMotorId(nextMotor.id);
      if (nextMotor.motor_name.toLowerCase().includes('aerox') && nextMotor.variant.toLowerCase() === 'standard') {
        setDpInput('Rp4.000.000');
      } else if (nextMotor.min_dp) {
        setDpInput(formatRupiah(nextMotor.min_dp));
      }
    }
  }

  function handleVariantChange(nextId: number) {
    setSelectedMotorId(nextId);
    setMotorImgFailed(false);
    const match = activeMotors.find((m) => m.id === nextId);
    if (match?.min_dp && dpMode === 'select') {
      setDpInput(formatRupiah(match.min_dp));
    }
  }

  function handleDpDropdownChange(nextDpStr: string) {
    const val = Number(nextDpStr);
    if (val > 0) {
      setDpInput(formatRupiah(val));
    }
  }

  async function handleQuickUploadExcel(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setQuickUploading(true);
    setSheetError(null);

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          resolve(result.includes(',') ? result.split(',')[1] : result);
        };
        reader.onerror = () => reject(new Error('Gagal membaca file dari perangkat.'));
        reader.readAsDataURL(file);
      });

      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: file.name.replace(/\.[^/.]+$/, ''),
          category: 'Tabel Angsuran',
          uploaderName: 'Pengguna Cek Angsuran',
          notes: 'Diunggah langsung dari halaman Cek Angsuran',
          filename: file.name,
          mimeType: file.type || '',
          fileBase64: base64,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSheetError(data.error || 'Gagal mengunggah file Excel/Sheets.');
        return;
      }

      await fetchSpreadsheetDocs();
      if (data.document?.id) {
        setDpMode('select');
        setSelectedMotorId(0);
        setDataSource(data.document.id);
      }
    } catch (err: unknown) {
      setSheetError(err instanceof Error ? err.message : 'Gagal mengunggah file Excel/Sheets.');
    } finally {
      setQuickUploading(false);
    }
  }

  function handleOpenCalculator() {
    const nextState = !isOpen;
    onOpenChange(nextState);
    if (nextState) {
      setTimeout(() => {
        calculatorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  }

  const canShareWhatsApp = Boolean(
    activeResult && activeResult.exact_dp_available && validTenors.length > 0
  );

  const whatsAppMessage = useMemo(() => {
    if (!activeResult || !canShareWhatsApp) return '';
    return buildWhatsAppMessage({
      motor: activeResult.motor,
      dpAmount: activeResult.requested_dp,
      selectedTenor,
      packagesByTenor: activeResult.packages_by_tenor,
      availableTenors: validTenors,
    });
  }, [activeResult, canShareWhatsApp, selectedTenor, validTenors]);

  const whatsAppUrl = useMemo(() => {
    if (!whatsAppMessage) return '#';
    return buildWhatsAppShareUrl(whatsAppMessage);
  }, [whatsAppMessage]);

  async function handleCopyMessage() {
    if (!whatsAppMessage) return;
    try {
      await navigator.clipboard.writeText(whatsAppMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }

  const showCalculator = standalone || isOpen;
  const availableDps = activeResult?.available_dps ?? [];
  const activeSelectedPackage = activeResult?.packages_by_tenor[selectedTenor] ?? null;
  const isSourceLoading = dataSource === 'db' ? motorsLoading : sheetLoading;

  return (
    <section
      id="promo-khusus"
      className={`mx-auto max-w-6xl px-4 pb-12 sm:px-6 lg:px-8 ${standalone ? 'pt-6' : 'pt-8'}`}
    >
      {/* Banner / Promo Header Card (only when embedded on Home) */}
      {!standalone && (
        <div className="relative overflow-hidden rounded-3xl bg-[#0B1F3A] text-white shadow-lg">
          <div className="grid grid-cols-1 items-stretch lg:grid-cols-12">
            <div className="relative z-10 flex flex-col justify-between p-6 sm:p-10 lg:col-span-6">
              <div>
                <p className="text-xs font-semibold tracking-wider text-blue-300">
                  Yamaha Thamrin Gunung Ibul · Prabumulih
                </p>
                <h1
                  className="mt-3 font-display text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-[2.75rem] lg:leading-[1.12]"
                  style={{ textWrap: 'balance' }}
                >
                  PROMO KHUSUS YAMAHA
                </h1>
                <p className="mt-3 text-lg font-medium text-blue-100 sm:text-xl">
                  Cek Angsuran Motor Impianmu
                </p>
                <p className="mt-4 max-w-lg text-sm leading-relaxed text-slate-300">
                  Simulasi kredit otomatis berdasarkan tabel angsuran resmi dealer maupun file Excel
                  dan Google Sheets. Pilih tipe motor, varian, nominal DP, dan tenor yang tersedia.
                </p>
              </div>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={handleOpenCalculator}
                  aria-expanded={isOpen}
                  className="inline-flex min-h-[48px] items-center justify-center gap-2.5 rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-150 hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 active:scale-[0.99] whitespace-nowrap shrink-0"
                >
                  <Calculator className="h-4 w-4" />
                  CEK ANGSURAN
                  {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
                <span className="text-xs text-slate-300">
                  Data otomatis dari database, Excel, & Sheets
                </span>
              </div>
            </div>

            <div className="relative min-h-[240px] bg-slate-900 lg:col-span-6 lg:min-h-[380px]">
              {!bannerImgFailed ? (
                <img
                  src={HERO_BANNER_IMAGE}
                  alt="Showroom Yamaha Thamrin Prabumulih menampilkan unit unggulan Yamaha"
                  referrerPolicy="no-referrer"
                  onError={() => setBannerImgFailed(true)}
                  className="h-full w-full object-cover object-center"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-br from-[#0B1F3A] to-blue-900 p-8 text-center">
                  <Bike className="h-16 w-16 text-blue-300" />
                  <p className="mt-3 text-sm font-medium text-blue-100">Yamaha Thamrin Prabumulih</p>
                </div>
              )}
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0B1F3A] via-[#0B1F3A]/20 to-transparent lg:bg-gradient-to-r lg:from-[#0B1F3A] lg:via-[#0B1F3A]/35 lg:to-transparent"
                aria-hidden="true"
              />
            </div>
          </div>
        </div>
      )}

      {/* Focused Calculator Workspace */}
      <div ref={calculatorRef} className="scroll-mt-20">
        <AnimatePresence initial={false}>
          {showCalculator && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className={`${
                standalone ? '' : 'mt-6'
              } rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8`}
            >
              {/* Header & Selected Motor Summary */}
              <div className="flex flex-col justify-between gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-center">
                <div>
                  {standalone && (
                    <p className="text-xs font-semibold text-blue-700">
                      PROMO KHUSUS YAMAHA · Yamaha Thamrin Prabumulih
                    </p>
                  )}
                  {standalone ? (
                    <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A] sm:text-3xl">
                      Cek Angsuran Motor Impianmu
                    </h1>
                  ) : (
                    <h2 className="font-display text-xl font-bold text-[#0B1F3A] sm:text-2xl">
                      Kalkulator Simulasi Kredit Yamaha
                    </h2>
                  )}
                  <p className="mt-1 text-sm text-slate-600">
                    Ganti DP langsung menampilkan data angsuran dan tenor resmi yang tersedia dari
                    database atau file Excel / Google Sheets.
                  </p>
                </div>

                {activeMotor && (
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 px-3.5 py-2.5">
                    {activeMotor.image_url && !motorImgFailed ? (
                      <img
                        src={activeMotor.image_url}
                        alt={`${activeMotor.motor_name} ${activeMotor.variant}`}
                        referrerPolicy="no-referrer"
                        onError={() => setMotorImgFailed(true)}
                        className="h-12 w-16 rounded-xl border border-slate-200 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-16 items-center justify-center rounded-xl bg-slate-100 text-[#0B1F3A]">
                        <Bike className="h-6 w-6" />
                      </div>
                    )}
                    <div className="text-left">
                      <p className="text-sm font-semibold text-slate-900">{activeMotor.motor_name}</p>
                      <p className="text-xs text-slate-500">Varian {activeMotor.variant}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Sumber Data Bar: Database Resmi vs Upload / Pilih Excel & Google Sheets */}
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50/80 p-3.5 sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#0B1F3A] text-white">
                      {dataSource === 'db' ? (
                        <Database className="h-4 w-4" />
                      ) : (
                        <FileSpreadsheet className="h-4 w-4" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#0B1F3A]">Sumber Data Angsuran</p>
                      <p className="text-[11px] text-slate-500">
                        {dataSource === 'db'
                          ? 'Menggunakan database resmi dealer Yamaha Thamrin'
                          : `Membaca langsung dari file: ${sheetDataset?.document.title || 'Excel / Sheets'}`}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative min-w-[220px]">
                      <select
                        aria-label="Pilih sumber data angsuran"
                        value={String(dataSource)}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDpMode('select');
                          setSelectedMotorId(0);
                          setDataSource(val === 'db' ? 'db' : Number(val));
                        }}
                        className="h-11 w-full appearance-none rounded-xl border border-slate-300 bg-white pr-9 pl-3.5 text-xs font-semibold text-slate-900 transition-colors focus:border-blue-700 focus:outline-none"
                      >
                        <option value="db">Database Resmi Dealer</option>
                        {spreadsheetDocs.map((doc) => (
                          <option key={doc.id} value={doc.id}>
                            {doc.file_type === 'excel' ? 'Excel' : 'Sheets'}: {doc.title}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    </div>

                    <input
                      ref={quickUploadInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv,.ods,.tsv"
                      onChange={handleQuickUploadExcel}
                      className="sr-only"
                    />
                    <button
                      type="button"
                      disabled={quickUploading}
                      onClick={() => quickUploadInputRef.current?.click()}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-white px-3.5 py-2 text-xs font-semibold text-blue-800 transition-colors hover:border-blue-600 hover:bg-blue-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                    >
                      {quickUploading ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Memproses...
                        </>
                      ) : (
                        <>
                          <Upload className="h-3.5 w-3.5" />
                          Upload Excel / Sheet
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {isSourceLoading ? (
                <div className="flex items-center justify-center gap-3 py-14 text-slate-500">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-700" />
                  <span className="text-sm font-medium">
                    {dataSource === 'db'
                      ? 'Memuat daftar motor dari database...'
                      : 'Membaca data motor, DP, dan tenor dari Excel / Sheets...'}
                  </span>
                </div>
              ) : activeMotors.length === 0 ? (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-900">
                  {sheetError ||
                    'Belum ada data motor dan angsuran yang terbaca dari sumber data ini.'}
                </div>
              ) : (
                <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12">
                  {/* Left Column: Form Inputs */}
                  <div className="space-y-5 lg:col-span-5">
                    <div>
                      <label
                        htmlFor="calc-motor-type"
                        className="block text-sm font-semibold text-slate-800"
                      >
                        1. Pilih Tipe Motor
                      </label>
                      <div className="relative mt-1.5">
                        <select
                          id="calc-motor-type"
                          value={selectedMotorName}
                          onChange={(e) => handleMotorTypeChange(e.target.value)}
                          className="h-12 w-full appearance-none rounded-xl border border-slate-300 bg-white pr-10 pl-4 text-sm font-medium text-slate-900 transition-colors focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15"
                        >
                          {uniqueMotorNames.map((name) => (
                            <option key={name} value={name}>
                              {name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor="calc-motor-variant"
                        className="block text-sm font-semibold text-slate-800"
                      >
                        2. Pilih Varian Motor
                      </label>
                      <div className="relative mt-1.5">
                        <select
                          id="calc-motor-variant"
                          value={selectedMotorId}
                          onChange={(e) => handleVariantChange(Number(e.target.value))}
                          className="h-12 w-full appearance-none rounded-xl border border-slate-300 bg-white pr-10 pl-4 text-sm font-medium text-slate-900 transition-colors focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15"
                        >
                          {variantsForSelectedMotor.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.variant}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
                      </div>
                    </div>

                    {/* Step 3: DP Selector (Auto-linked to Excel / Sheet / DB) */}
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor={dpMode === 'select' ? 'calc-dp-select' : 'calc-dp-input'}
                          className="block text-sm font-semibold text-slate-800"
                        >
                          3. Pilih Nominal DP (Uang Muka)
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setDpMode((prev) => (prev === 'select' ? 'manual' : 'select'))
                          }
                          className="text-xs font-semibold text-blue-700 hover:underline"
                        >
                          {dpMode === 'select' ? 'Ketik DP Manual' : 'Pilih Daftar DP'}
                        </button>
                      </div>

                      {dpMode === 'select' && availableDps.length > 0 ? (
                        <div className="relative mt-1.5">
                          <select
                            id="calc-dp-select"
                            value={
                              availableDps.includes(numericDp) ? numericDp : availableDps[0]
                            }
                            onChange={(e) => handleDpDropdownChange(e.target.value)}
                            className="h-12 w-full appearance-none rounded-xl border border-slate-300 bg-white pr-10 pl-4 font-mono text-base font-bold text-[#0B1F3A] tabular-nums transition-colors focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15"
                          >
                            {availableDps.map((dpVal) => (
                              <option key={dpVal} value={dpVal}>
                                {formatRupiah(dpVal)}
                              </option>
                            ))}
                          </select>
                          <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-500" />
                        </div>
                      ) : (
                        <input
                          id="calc-dp-input"
                          type="text"
                          inputMode="numeric"
                          value={dpInput}
                          onChange={(e) => setDpInput(formatRupiahInput(e.target.value))}
                          placeholder="Contoh: Rp4.000.000"
                          className="mt-1.5 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-mono text-base font-semibold text-slate-900 tabular-nums transition-colors focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15"
                        />
                      )}

                      {availableDps.length > 0 && (
                        <div className="mt-2.5">
                          <p className="text-xs font-medium text-slate-500">
                            {dataSource === 'db'
                              ? 'Pilihan DP tersedia di database (ganti DP langsung update):'
                              : 'Pilihan DP dari Excel / Sheets (ganti DP langsung update):'}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {availableDps.map((dpVal) => {
                              const isSelectedDp = dpVal === numericDp;
                              return (
                                <button
                                  key={dpVal}
                                  type="button"
                                  onClick={() => {
                                    setDpMode('select');
                                    setDpInput(formatRupiah(dpVal));
                                  }}
                                  className={`min-h-[38px] rounded-lg border px-3 py-1.5 font-mono text-xs font-semibold tabular-nums transition-colors ${
                                    isSelectedDp
                                      ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white'
                                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-blue-300 hover:bg-blue-50'
                                  }`}
                                >
                                  {formatRupiah(dpVal)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Step 4: Only Existing Tenors */}
                    <div>
                      <span className="block text-sm font-semibold text-slate-800">
                        4. Pilihan Tenor Tersedia (Bulan)
                      </span>

                      {validTenors.length > 0 ? (
                        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
                          {validTenors.map((tenor) => {
                            const active = selectedTenor === tenor;
                            return (
                              <button
                                key={tenor}
                                type="button"
                                onClick={() => setSelectedTenor(tenor)}
                                className={`min-h-[44px] rounded-xl border px-2 py-2 text-center text-sm font-semibold tabular-nums transition-all ${
                                  active
                                    ? 'border-blue-700 bg-blue-700 text-white shadow-sm'
                                    : 'border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-slate-50'
                                }`}
                              >
                                {tenor} bln
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-500">
                          {activeLoading
                            ? 'Memuat daftar tenor yang tersedia...'
                            : 'Pilih nominal DP yang tersedia untuk melihat tenor resmi.'}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Live Result & WhatsApp Share */}
                  <div className="lg:col-span-7">
                    <div className="flex h-full flex-col justify-between rounded-2xl border border-slate-200 bg-slate-50/70 p-5 sm:p-6">
                      <div>
                        <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-4">
                          <div>
                            <p className="text-xs font-semibold text-blue-700">
                              {dataSource === 'db'
                                ? 'Hasil Simulasi Database'
                                : 'Hasil Simulasi Excel / Sheets'}
                            </p>
                            <h3 className="mt-0.5 text-lg font-bold text-[#0B1F3A]">
                              {activeMotor
                                ? `${activeMotor.motor_name}${
                                    activeMotor.variant ? ` · ${activeMotor.variant}` : ''
                                  }`
                                : 'Pilih Motor'}
                            </h3>
                          </div>
                          <div className="text-right">
                            <p className="text-xs text-slate-500">Uang Muka (DP)</p>
                            <p className="font-mono text-base font-bold text-slate-900 tabular-nums">
                              {numericDp > 0 ? formatRupiah(numericDp) : '-'}
                            </p>
                          </div>
                        </div>

                        {activeLoading ? (
                          <div className="flex flex-col items-center justify-center gap-3 py-12 text-slate-500">
                            <Loader2 className="h-6 w-6 animate-spin text-blue-700" />
                            <p className="text-sm font-medium">
                              Mengambil data angsuran terbaru...
                            </p>
                          </div>
                        ) : activeError ? (
                          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                            {activeError}
                          </div>
                        ) : activeResult && !activeResult.exact_dp_available ? (
                          <div className="mt-5 space-y-4">
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                              <p className="text-sm font-semibold text-amber-900">
                                DP {formatRupiah(activeResult.requested_dp)} belum tersedia
                              </p>
                              <p className="mt-1 text-xs leading-relaxed text-amber-800">
                                {activeResult.message}
                              </p>
                            </div>

                            {activeResult.nearest_dps.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-slate-700">
                                  Rekomendasi DP terdekat yang tersedia:
                                </p>
                                <div className="mt-2 flex flex-wrap gap-2.5">
                                  {activeResult.nearest_dps.map((nearDp) => (
                                    <button
                                      key={nearDp}
                                      type="button"
                                      onClick={() => {
                                        setDpMode('select');
                                        setDpInput(formatRupiah(nearDp));
                                      }}
                                      className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 font-mono text-sm font-semibold text-blue-800 tabular-nums shadow-xs transition-colors hover:border-blue-600 hover:bg-blue-50"
                                    >
                                      <Sparkles className="h-4 w-4 text-blue-600" />
                                      Gunakan DP {formatRupiah(nearDp)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : activeResult ? (
                          <div className="mt-5 space-y-5">
                            {/* Highlighted Selected Tenor */}
                            <div className="rounded-2xl bg-[#0B1F3A] p-5 text-white">
                              <div className="flex flex-wrap items-baseline justify-between gap-2">
                                <span className="text-xs font-medium text-blue-200">
                                  Angsuran Tenor Pilihan ({selectedTenor} Bulan)
                                </span>
                                {activeSelectedPackage && (
                                  <span className="text-xs text-blue-200">
                                    {activeSelectedPackage.promo_name} · Berlaku{' '}
                                    {activeSelectedPackage.effective_date}
                                  </span>
                                )}
                              </div>

                              {activeSelectedPackage ? (
                                <p className="mt-2 font-mono text-2xl font-bold tracking-tight text-white tabular-nums sm:text-3xl">
                                  {selectedTenor} x{' '}
                                  {formatRupiah(activeSelectedPackage.installment_amount)}
                                </p>
                              ) : (
                                <div className="mt-2">
                                  <p className="text-base font-semibold text-amber-300">
                                    Pilih salah satu tenor yang tersedia di bawah
                                  </p>
                                </div>
                              )}
                            </div>

                            {/* Only Existing Tenor Breakdown */}
                            <div>
                              <p className="text-xs font-semibold text-slate-600">
                                Rincian tenor yang tersedia ({validTenors.length} pilihan):
                              </p>
                              <div className="mt-2.5 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
                                {validTenors.map((tenor) => {
                                  const pkg = activeResult.packages_by_tenor[tenor];
                                  if (!pkg) return null;
                                  const isSelected = tenor === selectedTenor;
                                  return (
                                    <button
                                      key={tenor}
                                      type="button"
                                      onClick={() => setSelectedTenor(tenor)}
                                      className={`flex w-full items-center justify-between px-4 py-3 text-left transition-colors ${
                                        isSelected
                                          ? 'bg-blue-50/90 text-[#0B1F3A]'
                                          : 'bg-white text-slate-700 hover:bg-slate-50'
                                      }`}
                                    >
                                      <div className="flex items-center gap-2.5">
                                        <span
                                          className={`text-sm font-semibold ${
                                            isSelected ? 'text-blue-800' : 'text-slate-800'
                                          }`}
                                        >
                                          {tenor} Bulan
                                        </span>
                                        {isSelected && (
                                          <span className="text-xs font-semibold text-blue-700">
                                            · Dipilih
                                          </span>
                                        )}
                                      </div>

                                      <span
                                        className={`font-mono text-sm tabular-nums ${
                                          isSelected
                                            ? 'font-bold text-[#0B1F3A]'
                                            : 'font-semibold text-slate-900'
                                        }`}
                                      >
                                        {tenor} x {formatRupiah(pkg.installment_amount)}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {/* Footer Actions: WhatsApp Share + Copy + Official Disclaimer */}
                      <div className="mt-6 border-t border-slate-200 pt-5">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                          {canShareWhatsApp ? (
                            <a
                              href={whatsAppUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
                            >
                              <MessageCircle className="h-4 w-4" />
                              BAGIKAN DETAIL ANGSURAN
                            </a>
                          ) : (
                            <button
                              type="button"
                              disabled
                              className="inline-flex min-h-[48px] flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-200 px-5 py-3 text-sm font-bold text-slate-500"
                            >
                              <MessageCircle className="h-4 w-4" />
                              BAGIKAN DETAIL ANGSURAN
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={!canShareWhatsApp}
                            onClick={handleCopyMessage}
                            className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {copied ? (
                              <>
                                <Check className="h-4 w-4 text-emerald-600" />
                                Tersalin
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4" />
                                Salin Teks
                              </>
                            )}
                          </button>
                        </div>

                        {canShareWhatsApp && (
                          <div className="mt-3">
                            <button
                              type="button"
                              onClick={() => setShowMessagePreview((v) => !v)}
                              className="text-xs font-medium text-blue-700 hover:underline"
                            >
                              {showMessagePreview
                                ? 'Sembunyikan pratinjau pesan WhatsApp'
                                : 'Lihat pratinjau pesan WhatsApp'}
                            </button>
                            {showMessagePreview && (
                              <pre className="mt-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3.5 font-sans text-xs leading-relaxed whitespace-pre-wrap text-slate-700">
                                {whatsAppMessage}
                              </pre>
                            )}
                          </div>
                        )}

                        <div className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-slate-500">
                          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                          <p>
                            Simulasi ini hanya bersifat estimasi berdasarkan tabel angsuran di
                            database atau file Excel/Sheets dan bukan merupakan penawaran kredit
                            resmi. Keputusan persetujuan kredit sepenuhnya mengikuti verifikasi
                            lembaga pembiayaan.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
