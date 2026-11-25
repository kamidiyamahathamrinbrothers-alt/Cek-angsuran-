import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bike,
  Calculator,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  FileCheck2,
  FileText,
  Info,
  Layers,
  Link2,
  Loader2,
  MapPin,
  MessageCircle,
  Percent,
  Printer,
  Search,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import {
  AutoInstallmentCategory,
  AutoInstallmentRecord,
  AutoSearchMotorOption,
  AutoSearchResponse,
} from '../types';
import {
  buildWhatsAppShareUrl,
  formatRupiah,
  formatRupiahInput,
  parseRupiahInput,
} from '../utils/format';

interface HomeAutoLookupSectionProps {
  initialCategory?: AutoInstallmentCategory;
  refreshKey?: number;
  initialMotorName?: string | null;
  initialVariant?: string | null;
  onClearInitialMotor?: () => void;
  canUploadAdmin?: boolean;
  onUploadRegulerExcel?: () => void;
}

function formatPercentLabel(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return '0%';
  const rounded = Math.round(pct * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}%` : `${rounded.toFixed(1).replace('.', ',')}%`;
}

function pickBestTenor(validTenors: number[], preferredTenor: number): number {
  if (!validTenors || validTenors.length === 0) return preferredTenor;
  if (validTenors.includes(preferredTenor)) return preferredTenor;
  if (validTenors.includes(23)) return 23;
  if (validTenors.includes(24)) return 24;
  return validTenors.reduce((best, cur) =>
    Math.abs(cur - preferredTenor) < Math.abs(best - preferredTenor) ? cur : best
  );
}

const ALLOWED_BRANCH_ORDER = ['Palembang', 'Sumsel', 'Bengkulu'] as const;

export default function HomeAutoLookupSection({
  initialCategory = 'promo',
  refreshKey = 0,
  initialMotorName,
  onClearInitialMotor,
  canUploadAdmin = false,
  onUploadRegulerExcel,
}: HomeAutoLookupSectionProps = {}) {
  const [selectedCategory, setSelectedCategory] = useState<AutoInstallmentCategory>(initialCategory);
  const [branches, setBranches] = useState<string[]>([...ALLOWED_BRANCH_ORDER]);
  const [selectedBranch, setSelectedBranch] = useState<string>('Palembang');
  const [options, setOptions] = useState<AutoSearchMotorOption[]>([]);
  const [optionsFallbackNote, setOptionsFallbackNote] = useState<string | null>(null);
  const [loadingOptions, setLoadingOptions] = useState<boolean>(true);

  const [motorSearchQuery, setMotorSearchQuery] = useState<string>('');
  const [selectedMotor, setSelectedMotor] = useState<string>('');
  const [selectedVariant, setSelectedVariant] = useState<string>('');
  const [selectedLeasing, setSelectedLeasing] = useState<string>('');
  const [dpMode, setDpMode] = useState<'select' | 'manual'>('select');
  const [dpInput, setDpInput] = useState<string>('Rp4.000.000');
  const [selectedTenor, setSelectedTenor] = useState<number>(23);

  // Diskon langsung mengurangi DP: otomatis ambil dari PDF di database ('pdf') atau 'manual'
  const [discountSourceMode, setDiscountSourceMode] = useState<'pdf' | 'manual'>(
    initialCategory === 'reguler' ? 'manual' : 'pdf'
  );
  const [discountMode, setDiscountMode] = useState<'nominal' | 'percent'>('percent');
  const [discountNominalInput, setDiscountNominalInput] = useState<string>('');
  const [discountPercentInput, setDiscountPercentInput] = useState<string>('0');

  const [searching, setSearching] = useState<boolean>(false);
  const [searchResult, setSearchResult] = useState<AutoSearchResponse | null>(null);
  const [detailHighlighted, setDetailHighlighted] = useState<boolean>(false);
  const [revealKey, setRevealKey] = useState<number>(0);

  const [waPhoneInput, setWaPhoneInput] = useState<string>('');
  const [showWaSharePanel, setShowWaSharePanel] = useState<boolean>(false);
  const [copiedWaLink, setCopiedWaLink] = useState<boolean>(false);
  const [copiedWaText, setCopiedWaText] = useState<boolean>(false);

  const slipRef = useRef<HTMLDivElement | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optionsReqIdRef = useRef<number>(0);
  const searchReqIdRef = useRef<number>(0);
  const selectedMotorRef = useRef<string>(selectedMotor);
  const dpInputRef = useRef<string>(dpInput);
  const selectedTenorRef = useRef<number>(selectedTenor);

  selectedMotorRef.current = selectedMotor;
  dpInputRef.current = dpInput;
  selectedTenorRef.current = selectedTenor;

  const fetchOptions = useCallback(
    async (
      branchParam: string,
      categoryParam: AutoInstallmentCategory,
      preserveCurrentSelection = false
    ) => {
      const reqId = ++optionsReqIdRef.current;
      setLoadingOptions(true);
      try {
        const params = new URLSearchParams();
        if (branchParam) params.set('branch', branchParam);
        params.set('category', categoryParam);
        const res = await fetch(`/api/auto-installments/options?${params.toString()}`);
        if (!res.ok || reqId !== optionsReqIdRef.current) return;
        const data = await res.json();
        if (reqId !== optionsReqIdRef.current) return;

        const rawBranches = (data.branches || []) as string[];
        const orderedAllowed = ALLOWED_BRANCH_ORDER.map((allowedName) =>
          rawBranches.find((b) => b.trim().toLowerCase() === allowedName.toLowerCase()) ||
          allowedName
        );
        const motorsList = (data.motors || []) as AutoSearchMotorOption[];

        setBranches(orderedAllowed);
        setOptions(motorsList);
        setOptionsFallbackNote(data.fallback_note ? String(data.fallback_note) : null);

        if (motorsList.length === 0) {
          setSelectedMotor('');
          setSelectedVariant('');
          setSearchResult(null);
          return;
        }

        const currentMotor = selectedMotorRef.current;
        let targetMotor =
          preserveCurrentSelection && currentMotor
            ? motorsList.find((m) => m.motor_name === currentMotor)
            : undefined;

        if (!targetMotor) {
          targetMotor =
            motorsList.find((m) => m.motor_name.toLowerCase().includes('aerox')) || motorsList[0];
          setSelectedMotor(targetMotor.motor_name);
        }

        setSelectedVariant(targetMotor.variants.length > 1 ? targetMotor.variants[0] : '');
        setSelectedLeasing('');

        let chosenDp = parseRupiahInput(dpInputRef.current);
        if (targetMotor.dps.length > 0) {
          const keepDp = preserveCurrentSelection && targetMotor.dps.includes(chosenDp);
          if (!keepDp) {
            chosenDp = targetMotor.dps.includes(4000000) ? 4000000 : targetMotor.dps[0];
            setDpInput(formatRupiah(chosenDp));
          }
        }

        const validTenorsForDp =
          targetMotor.dp_tenors?.[chosenDp]?.length
            ? targetMotor.dp_tenors[chosenDp]
            : targetMotor.tenors;

        if (validTenorsForDp.length > 0) {
          const currentTenor = selectedTenorRef.current;
          const keepTenor = preserveCurrentSelection && validTenorsForDp.includes(currentTenor);
          if (!keepTenor) {
            setSelectedTenor(pickBestTenor(validTenorsForDp, currentTenor));
          }
        }
      } finally {
        if (reqId === optionsReqIdRef.current) {
          setLoadingOptions(false);
        }
      }
    },
    []
  );

  // Initial load & refreshKey/initialCategory sync
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      void fetchOptions(selectedBranch, selectedCategory, false);
      return;
    }
    const targetCat = initialCategory || selectedCategory;
    if (targetCat !== selectedCategory) {
      setSelectedCategory(targetCat);
      setDiscountSourceMode(targetCat === 'reguler' ? 'manual' : 'pdf');
    }
    void fetchOptions(selectedBranch, targetCat, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCategory, refreshKey]);

  // Pre-select motor when navigating from Home catalog cards
  useEffect(() => {
    if (!initialMotorName || options.length === 0) return;
    const normalizedTarget = initialMotorName.trim().toLowerCase();
    const matchedOption =
      options.find((m) => m.motor_name.trim().toLowerCase() === normalizedTarget) ||
      options.find(
        (m) =>
          m.motor_name.trim().toLowerCase().includes(normalizedTarget) ||
          normalizedTarget.includes(m.motor_name.trim().toLowerCase())
      );

    if (matchedOption) {
      setSelectedMotor(matchedOption.motor_name);
      setSelectedVariant(matchedOption.variants.length > 1 ? matchedOption.variants[0] : '');
      let nextDp = parseRupiahInput(dpInputRef.current);
      if (matchedOption.dps.length > 0) {
        nextDp = matchedOption.dps.includes(4000000) ? 4000000 : matchedOption.dps[0];
        setDpInput(formatRupiah(nextDp));
      }
      const validTenors = matchedOption.dp_tenors?.[nextDp] || matchedOption.tenors;
      if (validTenors.length > 0) {
        setSelectedTenor(pickBestTenor(validTenors, selectedTenorRef.current));
      }
    }
    onClearInitialMotor?.();
  }, [initialMotorName, options, onClearInitialMotor]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  const filteredMotorOptions = useMemo(() => {
    const q = motorSearchQuery.trim().toLowerCase();
    if (!q) return options;
    const filtered = options.filter(
      (m) =>
        m.motor_name.toLowerCase().includes(q) ||
        m.variants.some((v) => v.toLowerCase().includes(q))
    );
    return filtered;
  }, [options, motorSearchQuery]);

  const activeMotorOption = useMemo(
    () => options.find((m) => m.motor_name === selectedMotor) ?? null,
    [options, selectedMotor]
  );

  const numericDp = useMemo(() => parseRupiahInput(dpInput), [dpInput]);

  const dbDiscount = searchResult?.matched_discount ?? null;

  // Hitung diskon Rp, persentase (%), dan DP setelah diskon secara real-time
  const discountSummary = useMemo(() => {
    const baseDp = Math.max(0, numericDp);
    if (baseDp <= 0) {
      return {
        baseDp: 0,
        discountAmount: 0,
        discountPercent: 0,
        discountPercentLabel: '0%',
        netDp: 0,
        sourceLabel: '',
      };
    }

    if (discountSourceMode === 'pdf') {
      if (!dbDiscount) {
        return {
          baseDp,
          discountAmount: 0,
          discountPercent: 0,
          discountPercentLabel: '0%',
          netDp: baseDp,
          sourceLabel: '',
        };
      }
      const appliedDiscount = Math.min(baseDp, Math.max(0, dbDiscount.discount_amount));
      const pct =
        dbDiscount.discount_type === 'percent'
          ? dbDiscount.discount_percent
          : (appliedDiscount / baseDp) * 100;
      return {
        baseDp,
        discountAmount: appliedDiscount,
        discountPercent: pct,
        discountPercentLabel: formatPercentLabel(pct),
        netDp: Math.max(0, baseDp - appliedDiscount),
        sourceLabel: dbDiscount.source_file,
      };
    }

    let rawDiscount = 0;
    if (discountMode === 'percent') {
      const cleaned = discountPercentInput.replace(',', '.').replace(/[^0-9.]/g, '');
      const pct = Math.min(100, Math.max(0, Number.parseFloat(cleaned) || 0));
      rawDiscount = Math.round((baseDp * pct) / 100);
    } else {
      rawDiscount = parseRupiahInput(discountNominalInput);
    }

    const appliedDiscount = Math.min(baseDp, Math.max(0, rawDiscount));
    const computedPercent =
      discountMode === 'percent'
        ? Math.min(
            100,
            Math.max(
              0,
              Number.parseFloat(discountPercentInput.replace(',', '.').replace(/[^0-9.]/g, '')) || 0
            )
          )
        : (appliedDiscount / baseDp) * 100;

    return {
      baseDp,
      discountAmount: appliedDiscount,
      discountPercent: computedPercent,
      discountPercentLabel: formatPercentLabel(computedPercent),
      netDp: Math.max(0, baseDp - appliedDiscount),
      sourceLabel: 'Input Manual',
    };
  }, [
    numericDp,
    discountSourceMode,
    dbDiscount,
    discountMode,
    discountNominalInput,
    discountPercentInput,
  ]);

  // Quick preset DPs (up to 4 clean spread options from available database DPs)
  const quickDpPresets = useMemo(() => {
    const dps = activeMotorOption?.dps || [];
    if (dps.length <= 4) return dps;
    const indices = [
      0,
      Math.floor((dps.length - 1) * 0.25),
      Math.floor((dps.length - 1) * 0.55),
      dps.length - 1,
    ];
    return Array.from(new Set(indices)).map((i) => dps[i]);
  }, [activeMotorOption]);

  const availableTenors = useMemo(() => {
    if (!activeMotorOption) return [11, 17, 23, 29, 33];
    if (dpMode === 'select' && activeMotorOption.dp_tenors?.[numericDp]?.length) {
      return activeMotorOption.dp_tenors[numericDp];
    }
    return activeMotorOption.tenors.length ? activeMotorOption.tenors : [11, 17, 23, 29, 33];
  }, [activeMotorOption, dpMode, numericDp]);

  const runSearch = useCallback(
    async (
      motorName: string,
      dpAmount: number,
      tenorMonths: number,
      branch: string,
      category: AutoInstallmentCategory,
      variantName = '',
      leasingName = '',
      scrollAndHighlight = false
    ) => {
      if (!motorName || dpAmount <= 0 || tenorMonths <= 0) {
        setSearchResult(null);
        return;
      }

      const reqId = ++searchReqIdRef.current;
      setSearching(true);
      try {
        const params = new URLSearchParams({
          motor_name: motorName,
          dp_amount: String(dpAmount),
          tenor_months: String(tenorMonths),
          category,
        });
        if (branch) {
          params.set('branch', branch);
        }
        if (variantName) {
          params.set('variant', variantName);
        }
        if (leasingName) {
          params.set('leasing_name', leasingName);
        }
        const res = await fetch(`/api/auto-installments/search?${params.toString()}`);
        const data = await res.json();
        if (res.ok && reqId === searchReqIdRef.current) {
          setSearchResult(data as AutoSearchResponse);
          if (scrollAndHighlight) {
            setRevealKey((prev) => prev + 1);
            setDetailHighlighted(true);
            if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
            highlightTimerRef.current = setTimeout(() => setDetailHighlighted(false), 1200);
            slipRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      } finally {
        if (reqId === searchReqIdRef.current) {
          setSearching(false);
        }
      }
    },
    []
  );

  // Automatic lookup whenever Kategori, Wilayah, Motor, Variant, Leasing, DP, or Tenor changes
  useEffect(() => {
    if (loadingOptions || options.length === 0) return;
    if (!selectedMotor || numericDp <= 0 || selectedTenor <= 0) {
      setSearchResult(null);
      return;
    }

    const timer = setTimeout(() => {
      void runSearch(
        selectedMotor,
        numericDp,
        selectedTenor,
        selectedBranch,
        selectedCategory,
        selectedVariant,
        selectedLeasing,
        false
      );
    }, 90);

    return () => clearTimeout(timer);
  }, [
    loadingOptions,
    options.length,
    selectedMotor,
    selectedVariant,
    selectedLeasing,
    numericDp,
    selectedTenor,
    selectedBranch,
    selectedCategory,
    runSearch,
  ]);

  function handleCategorySelect(nextCat: AutoInstallmentCategory) {
    if (nextCat === selectedCategory) return;
    setSelectedCategory(nextCat);
    setMotorSearchQuery('');
    setSelectedVariant('');
    setSelectedLeasing('');
    setSearchResult(null);
    if (nextCat === 'reguler') {
      setDiscountSourceMode('manual');
      setDiscountPercentInput('0');
      setDiscountNominalInput('');
    } else {
      setDiscountSourceMode('pdf');
    }
    void fetchOptions(selectedBranch, nextCat, false);
  }

  function handleBranchSelect(nextBranch: string) {
    if (nextBranch === selectedBranch) return;
    setSelectedBranch(nextBranch);
    void fetchOptions(nextBranch, selectedCategory, true);
  }

  function handleMotorChange(nextMotorName: string) {
    setSelectedMotor(nextMotorName);
    setSelectedLeasing('');
    const opt = options.find((m) => m.motor_name === nextMotorName);
    if (opt) {
      setSelectedVariant(opt.variants.length > 1 ? opt.variants[0] : '');
      let nextDp = numericDp;
      if (dpMode === 'select' && opt.dps.length > 0) {
        nextDp = opt.dps.includes(4000000) ? 4000000 : opt.dps[0];
        setDpInput(formatRupiah(nextDp));
      }
      const validTenors = opt.dp_tenors?.[nextDp]?.length ? opt.dp_tenors[nextDp] : opt.tenors;
      if (validTenors.length > 0 && !validTenors.includes(selectedTenor)) {
        setSelectedTenor(pickBestTenor(validTenors, selectedTenor));
      }
    } else {
      setSelectedVariant('');
    }
  }

  function handleSelectDpValue(nextDp: number) {
    setDpInput(formatRupiah(nextDp));
    if (activeMotorOption) {
      const dpSpecificTenors = activeMotorOption.dp_tenors?.[nextDp];
      if (dpSpecificTenors && dpSpecificTenors.length > 0 && !dpSpecificTenors.includes(selectedTenor)) {
        setSelectedTenor(pickBestTenor(dpSpecificTenors, selectedTenor));
      }
    }
  }

  function handleSwitchDiscountMode(nextMode: 'nominal' | 'percent') {
    if (nextMode === discountMode) return;
    if (nextMode === 'percent') {
      const pct = Math.round(discountSummary.discountPercent * 10) / 10;
      setDiscountPercentInput(String(pct > 0 ? pct : 0));
    } else {
      setDiscountNominalInput(
        discountSummary.discountAmount > 0 ? formatRupiah(discountSummary.discountAmount) : ''
      );
    }
    setDiscountMode(nextMode);
  }

  function handleInstantShowDetail(e: React.FormEvent) {
    e.preventDefault();
    void runSearch(
      selectedMotor,
      numericDp,
      selectedTenor,
      selectedBranch,
      selectedCategory,
      selectedVariant,
      selectedLeasing,
      true
    );
  }

  const matched = searchResult?.matched_record ?? null;

  // Hitung ringkasan DP & Diskon berdasarkan record & diskon PDF yang cocok di database
  const matchedNetSummary = useMemo(() => {
    if (!matched) {
      return {
        baseDp: discountSummary.baseDp,
        discountAmount: discountSummary.discountAmount,
        discountPercentLabel: discountSummary.discountPercentLabel,
        netDp: discountSummary.netDp,
        pdfSource: discountSummary.sourceLabel,
      };
    }
    const baseDp = matched.dp_amount;
    if (discountSourceMode === 'pdf') {
      if (!dbDiscount) {
        return {
          baseDp,
          discountAmount: 0,
          discountPercentLabel: '0%',
          netDp: baseDp,
          pdfSource: '',
        };
      }
      const appliedDiscount = Math.min(baseDp, Math.max(0, dbDiscount.discount_amount));
      const pct =
        dbDiscount.discount_type === 'percent'
          ? dbDiscount.discount_percent
          : baseDp > 0
          ? (appliedDiscount / baseDp) * 100
          : 0;
      return {
        baseDp,
        discountAmount: appliedDiscount,
        discountPercentLabel: formatPercentLabel(pct),
        netDp: Math.max(0, baseDp - appliedDiscount),
        pdfSource: dbDiscount.source_file,
      };
    }

    const rawDiscount =
      discountMode === 'percent'
        ? Math.round((baseDp * discountSummary.discountPercent) / 100)
        : discountSummary.discountAmount;
    const appliedDiscount = Math.min(baseDp, Math.max(0, rawDiscount));
    const pct = baseDp > 0 ? (appliedDiscount / baseDp) * 100 : 0;
    return {
      baseDp,
      discountAmount: appliedDiscount,
      discountPercentLabel:
        discountMode === 'percent'
          ? discountSummary.discountPercentLabel
          : formatPercentLabel(pct),
      netDp: Math.max(0, baseDp - appliedDiscount),
      pdfSource: '',
    };
  }, [matched, discountSourceMode, dbDiscount, discountMode, discountSummary]);

  // Deduplicate multi-region matches by branch
  const matchingBranches = useMemo(() => {
    const list = searchResult?.all_matching_leasings || [];
    const seen = new Set<string>();
    const unique: AutoInstallmentRecord[] = [];
    for (const item of list) {
      const key = (item.branch || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }, [searchResult]);

  // Distinct leasings matching current motor + DP + tenor
  const matchingLeasings = useMemo(() => {
    const list = searchResult?.all_matching_leasings || [];
    const seen = new Set<string>();
    const unique: AutoInstallmentRecord[] = [];
    for (const item of list) {
      const key = (item.leasing_name || '').trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      unique.push(item);
    }
    return unique;
  }, [searchResult]);

  const whatsAppShareMessage = useMemo(() => {
    if (!searchResult?.found || !matched) return '';

    const motorDetail =
      matched.variant && matched.variant.toLowerCase() !== 'standard'
        ? `${matched.motor_name} (${matched.variant})`
        : matched.motor_name;

    const tenorLines = (searchResult.related_tenors || []).map(
      (item) => `- ${item.tenor_months} Bulan: ${formatRupiah(item.installment_amount)}/bln`
    );

    const dpLines =
      matchedNetSummary.discountAmount > 0
        ? [
            `DP Pricelist: ${formatRupiah(matchedNetSummary.baseDp)}`,
            `Diskon DP (${matchedNetSummary.discountPercentLabel}): -${formatRupiah(
              matchedNetSummary.discountAmount
            )}${matchedNetSummary.pdfSource ? ` [Promo: ${dbDiscount?.promo_title || matchedNetSummary.pdfSource}]` : ''}`,
            `DP Setelah Diskon (DP Bayar): ${formatRupiah(matchedNetSummary.netDp)}`,
          ]
        : [`DP (Uang Muka): ${formatRupiah(matched.dp_amount)}`];

    const categoryLabel =
      (matched.category || selectedCategory) === 'reguler' ? 'Reguler' : 'Promo';

    return [
      '*SIMULASI KREDIT YAMAHA THAMRIN*',
      `Kategori: ${categoryLabel}`,
      `Motor: ${motorDetail}`,
      ...(matched.branch ? [`Wilayah: ${matched.branch}`] : []),
      ...dpLines,
      `Tenor Pilihan: ${matched.tenor_months} Bulan`,
      `Angsuran per Bulan: ${formatRupiah(matched.installment_amount)}/bulan`,
      ...(tenorLines.length > 0 ? ['', 'Pilihan Tenor Lainnya:', ...tenorLines] : []),
      '',
      `Berlaku per ${matched.effective_date}`,
      'Yamaha Thamrin Gunung Ibul Prabumulih.',
    ].join('\n');
  }, [searchResult, matched, matchedNetSummary, dbDiscount, selectedCategory]);

  const whatsAppShareUrl = useMemo(() => {
    if (!whatsAppShareMessage) return '#';
    return buildWhatsAppShareUrl(whatsAppShareMessage, waPhoneInput);
  }, [whatsAppShareMessage, waPhoneInput]);

  async function handleCopyWhatsAppLink() {
    if (!whatsAppShareMessage || whatsAppShareUrl === '#') return;
    try {
      await navigator.clipboard.writeText(whatsAppShareUrl);
      setCopiedWaLink(true);
      setTimeout(() => setCopiedWaLink(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }

  async function handleCopyWhatsAppText() {
    if (!whatsAppShareMessage) return;
    try {
      await navigator.clipboard.writeText(whatsAppShareMessage);
      setCopiedWaText(true);
      setTimeout(() => setCopiedWaText(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  }

  return (
    <section
      id="database-angsuran-otomatis"
      className="mx-auto max-w-7xl px-4 pt-6 pb-14 sm:px-6 lg:px-8"
    >
      {/* Clean Page Title */}
      <div className="flex flex-col justify-between gap-2 border-b border-slate-200/90 pb-4 sm:flex-row sm:items-end dark:border-slate-800">
        <h1 className="font-display text-2xl font-extrabold tracking-tight text-[#0B1F3A] sm:text-3xl dark:text-white">
          Cek Angsuran
        </h1>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">
          Yamaha Thamrin Prabumulih · Data Pricelist Resmi
        </p>
      </div>

      {/* Unified Showroom Filter Toolbar: Kategori (Promo & Reguler) + Wilayah */}
      <div className="no-print mt-5 overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-[0_2px_12px_-4px_rgba(11,31,58,0.07)] transition-colors dark:border-slate-800 dark:bg-slate-900">
        {/* Menu Kategori: Promo & Reguler (Tepat di bawah judul Cek Angsuran) */}
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5 dark:border-slate-800/80">
          <div className="flex items-center gap-3 shrink-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-[#0046B8] dark:bg-blue-950/60 dark:text-blue-400">
              <Layers className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-bold text-[#0B1F3A] dark:text-white">Kategori</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {selectedCategory === 'promo'
                  ? 'Pricelist & Diskon Promo'
                  : 'Pricelist Kredit Reguler'}
              </p>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Menu Kategori Angsuran"
            className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1 sm:inline-flex dark:bg-slate-800/90"
          >
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === 'promo'}
              onClick={() => handleCategorySelect('promo')}
              className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-5 py-2 text-xs font-semibold whitespace-nowrap transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0046B8] ${
                selectedCategory === 'promo'
                  ? 'bg-[#0B1F3A] text-white shadow-sm dark:bg-blue-600'
                  : 'text-slate-600 hover:bg-white/80 hover:text-[#0B1F3A] dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-white'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span>Promo</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === 'reguler'}
              onClick={() => handleCategorySelect('reguler')}
              className={`inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg px-5 py-2 text-xs font-semibold whitespace-nowrap transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0046B8] ${
                selectedCategory === 'reguler'
                  ? 'bg-[#0B1F3A] text-white shadow-sm dark:bg-blue-600'
                  : 'text-slate-600 hover:bg-white/80 hover:text-[#0B1F3A] dark:text-slate-300 dark:hover:bg-slate-700/70 dark:hover:text-white'
              }`}
            >
              <Calculator className="h-3.5 w-3.5" />
              <span>Reguler</span>
            </button>
          </div>
        </div>

        {/* Sleek Wilayah Navigation Row (Palembang, Sumsel, Bengkulu only) */}
        <div className="flex flex-col gap-3 bg-slate-50/50 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5 dark:bg-slate-900/60">
          <div className="flex items-center gap-3 shrink-0">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-[#0B1F3A] dark:bg-slate-800 dark:text-blue-400">
              <MapPin className="h-4 w-4" />
            </span>
            <div>
              <p className="text-xs font-bold text-[#0B1F3A] dark:text-white">Wilayah</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">{selectedBranch}</p>
            </div>
          </div>

          <div
            role="tablist"
            aria-label="Menu Pilihan Wilayah"
            className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible sm:pb-0"
          >
            {branches.map((branchName) => {
              const isActive = selectedBranch === branchName;
              return (
                <button
                  key={branchName}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleBranchSelect(branchName)}
                  className={`min-h-[40px] shrink-0 whitespace-nowrap rounded-xl px-4 py-2 text-xs font-semibold transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0046B8] ${
                    isActive
                      ? 'bg-[#0046B8] text-white shadow-sm dark:bg-blue-600'
                      : 'border border-slate-200/80 bg-white text-slate-600 hover:border-slate-300 hover:text-[#0B1F3A] dark:border-slate-700/80 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-700 dark:hover:text-white'
                  }`}
                >
                  {branchName}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {loadingOptions ? (
        <div className="mt-8 flex items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white py-20 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin text-[#0046B8] dark:text-blue-400" />
          <span className="text-sm font-medium">
            Memuat database angsuran {selectedCategory === 'reguler' ? 'Reguler' : 'Promo'}...
          </span>
        </div>
      ) : options.length === 0 ? (
        selectedCategory === 'reguler' ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs sm:p-10 dark:border-slate-800 dark:bg-slate-900">
            <div className="mx-auto max-w-xl text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-[#0046B8] dark:bg-blue-950/60 dark:text-blue-400">
                <Upload className="h-7 w-7" />
              </div>
              <h2 className="mt-4 font-display text-lg font-bold text-[#0B1F3A] sm:text-xl dark:text-white">
                Excel Angsuran Reguler Belum Diunggah
                {selectedBranch ? ` (${selectedBranch})` : ''}
              </h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-600 sm:text-sm dark:text-slate-300">
                Database <strong>Promo</strong> Anda tetap aman dan berjalan terpisah. Untuk
                mengaktifkan menu <strong>Reguler</strong>, silakan unggah file Excel (
                <code className="font-mono text-[11px]">.xlsx / .xls / .csv</code>) dengan sheet
                atau kolom wilayah <strong>Palembang</strong>, <strong>Sumsel</strong>, dan{' '}
                <strong>Bengkulu</strong>.
              </p>

              <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
                {onUploadRegulerExcel && (
                  <button
                    type="button"
                    onClick={onUploadRegulerExcel}
                    className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#0046B8] px-5 py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#003794] sm:w-auto dark:bg-blue-600 dark:hover:bg-blue-500"
                  >
                    <Upload className="h-4 w-4" />
                    {canUploadAdmin
                      ? 'Upload Excel Reguler Sekarang'
                      : 'Masuk Staff & Upload Excel Reguler'}
                  </button>
                )}

                <a
                  href="/api/auto-installments/template?category=reguler"
                  download
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 sm:w-auto dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                >
                  <Download className="h-4 w-4 text-[#0046B8] dark:text-blue-400" />
                  Download Template Excel Reguler (.xlsx)
                </a>
              </div>

              <p className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">
                Mendukung tabel DP &amp; Tenor horizontal (11, 17, 23, 29, 33, 35 bln) maupun daftar
                baris vertikal otomatis.
              </p>
            </div>
          </div>
        ) : (
          <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center text-sm font-semibold text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-200">
            Data angsuran Promo belum tersedia{selectedBranch ? ` untuk wilayah ${selectedBranch}` : ''}.
            Silakan hubungi admin.
          </div>
        )
      ) : (
        <>
          {(optionsFallbackNote || searchResult?.fallback_note) && (
            <div className="no-print mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-blue-200/80 bg-blue-50/70 px-4 py-2.5 text-xs text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/35 dark:text-blue-200">
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4 shrink-0 text-[#0046B8] dark:text-blue-400" />
                <span>{searchResult?.fallback_note || optionsFallbackNote}</span>
              </div>
              {selectedCategory === 'reguler' && onUploadRegulerExcel && canUploadAdmin && (
                <button
                  type="button"
                  onClick={onUploadRegulerExcel}
                  className="font-semibold text-[#0046B8] hover:underline dark:text-blue-300"
                >
                  Update Excel Reguler
                </button>
              )}
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 items-start gap-7 lg:grid-cols-12">
            {/* Left Column: Configurator Form */}
            <form
              onSubmit={handleInstantShowDetail}
              className="no-print rounded-2xl border border-slate-200/90 bg-white p-5 shadow-[0_2px_12px_-4px_rgba(11,31,58,0.07)] transition-colors sm:p-6 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="space-y-5">
                {/* 01. Tipe Motor */}
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <label
                      htmlFor="home-auto-motor"
                      className="text-xs font-semibold text-slate-800 dark:text-slate-200"
                    >
                      01. Tipe Motor
                    </label>
                    <span className="text-[11px] font-medium text-slate-500 tabular-nums dark:text-slate-400">
                      {options.length} model tersedia
                    </span>
                  </div>

                  {options.length > 8 && (
                    <div className="relative mt-2">
                      <Search className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={motorSearchQuery}
                        onChange={(e) => {
                          const q = e.target.value;
                          setMotorSearchQuery(q);
                          const ql = q.trim().toLowerCase();
                          if (ql) {
                            const firstMatch = options.find((m) =>
                              m.motor_name.toLowerCase().includes(ql)
                            );
                            if (firstMatch && firstMatch.motor_name !== selectedMotor) {
                              handleMotorChange(firstMatch.motor_name);
                            }
                          }
                        }}
                        placeholder="Cari cepat tipe motor (misal: NMAX, Aerox, Gear)..."
                        aria-label="Cari tipe motor"
                        className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pr-8 pl-8 text-xs text-slate-800 placeholder:text-slate-400 focus:border-[#0046B8] focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                      />
                      {motorSearchQuery && (
                        <button
                          type="button"
                          onClick={() => setMotorSearchQuery('')}
                          aria-label="Hapus pencarian motor"
                          className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}

                  <div className="relative mt-2">
                    <Bike className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <select
                      id="home-auto-motor"
                      value={selectedMotor}
                      onChange={(e) => handleMotorChange(e.target.value)}
                      className="h-12 w-full appearance-none rounded-xl border border-slate-300 bg-white pr-10 pl-10 text-sm font-semibold text-[#0B1F3A] transition-colors focus:border-[#0046B8] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
                    >
                      {(filteredMotorOptions.length > 0 ? filteredMotorOptions : options).map((m) => (
                        <option key={m.motor_name} value={m.motor_name}>
                          {m.motor_name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
                  </div>

                  {activeMotorOption && activeMotorOption.variants.length > 1 && (
                    <div className="mt-2.5">
                      <span className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                        Varian
                      </span>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {activeMotorOption.variants.map((v) => {
                          const isVarActive = (selectedVariant || activeMotorOption.variants[0]) === v;
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={() => setSelectedVariant(v)}
                              className={`min-h-[34px] rounded-lg border px-3 py-1 text-xs font-semibold transition-colors ${
                                isVarActive
                                  ? 'border-[#0046B8] bg-blue-50 text-[#0046B8] dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300'
                              }`}
                            >
                              {v}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

              {/* 02. Nominal DP */}
              <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={dpMode === 'select' ? 'home-auto-dp-select' : 'home-auto-dp-input'}
                    className="text-xs font-semibold text-slate-800 dark:text-slate-200"
                  >
                    02. Nominal DP (Uang Muka)
                  </label>

                  <div className="flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                    <button
                      type="button"
                      onClick={() => setDpMode('select')}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                        dpMode === 'select'
                          ? 'bg-white text-[#0B1F3A] shadow-xs dark:bg-slate-900 dark:text-white'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      Pilih Daftar
                    </button>
                    <button
                      type="button"
                      onClick={() => setDpMode('manual')}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                        dpMode === 'manual'
                          ? 'bg-white text-[#0B1F3A] shadow-xs dark:bg-slate-900 dark:text-white'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                      }`}
                    >
                      Input Manual
                    </button>
                  </div>
                </div>

                {dpMode === 'select' && activeMotorOption && activeMotorOption.dps.length > 0 ? (
                  <>
                    <div className="relative mt-2">
                      <select
                        id="home-auto-dp-select"
                        value={
                          activeMotorOption.dps.includes(numericDp)
                            ? numericDp
                            : activeMotorOption.dps[0]
                        }
                        onChange={(e) => handleSelectDpValue(Number(e.target.value))}
                        className="h-12 w-full appearance-none rounded-xl border border-slate-300 bg-white pr-10 pl-4 font-mono text-base font-bold text-[#0B1F3A] tabular-nums transition-colors focus:border-[#0046B8] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
                      >
                        {activeMotorOption.dps.map((dpVal) => (
                          <option key={dpVal} value={dpVal}>
                            {formatRupiah(dpVal)}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute top-1/2 right-3.5 h-4 w-4 -translate-y-1/2 text-slate-500 dark:text-slate-400" />
                    </div>

                    {quickDpPresets.length > 1 && (
                      <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                        {quickDpPresets.map((dpVal) => {
                          const isSelected = numericDp === dpVal;
                          return (
                            <button
                              key={dpVal}
                              type="button"
                              onClick={() => handleSelectDpValue(dpVal)}
                              className={`min-h-[36px] rounded-lg border px-2 py-1.5 font-mono text-[11px] font-semibold tabular-nums transition-colors whitespace-nowrap truncate ${
                                isSelected
                                  ? 'border-[#0046B8] bg-blue-50 text-[#0046B8] dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white'
                              }`}
                            >
                              {formatRupiah(dpVal)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </>
                ) : (
                  <input
                    id="home-auto-dp-input"
                    type="text"
                    inputMode="numeric"
                    value={dpInput}
                    onChange={(e) => setDpInput(formatRupiahInput(e.target.value))}
                    placeholder="Contoh: Rp4.000.000"
                    className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-mono text-base font-bold text-[#0B1F3A] tabular-nums focus:border-[#0046B8] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                  />
                )}
              </div>

              {/* 03. Diskon DP (Otomatis Ambil dari PDF Database / Input Manual) */}
              <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    03. Diskon DP ({discountSummary.discountPercentLabel})
                  </span>

                  {selectedCategory === 'promo' ? (
                    <div className="flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                      <button
                        type="button"
                        onClick={() => setDiscountSourceMode('pdf')}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                          discountSourceMode === 'pdf'
                            ? 'bg-white text-[#0B1F3A] shadow-xs dark:bg-slate-900 dark:text-white'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                        }`}
                      >
                        Dari PDF Database
                      </button>
                      <button
                        type="button"
                        onClick={() => setDiscountSourceMode('manual')}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                          discountSourceMode === 'manual'
                            ? 'bg-white text-[#0B1F3A] shadow-xs dark:bg-slate-900 dark:text-white'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                        }`}
                      >
                        Input Manual
                      </button>
                    </div>
                  ) : (
                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                      Potongan DP Manual (Opsional)
                    </span>
                  )}
                </div>

                {discountSourceMode === 'pdf' ? (
                  dbDiscount ? (
                    <div className="mt-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5 dark:border-emerald-800/60 dark:bg-emerald-950/40">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-emerald-900 dark:text-emerald-200">
                          <FileText className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
                          <span>{dbDiscount.promo_title || 'Promo Diskon PDF'}</span>
                        </div>
                        <span className="font-mono text-xs font-extrabold text-emerald-700 tabular-nums dark:text-emerald-400">
                          {discountSummary.discountPercentLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-emerald-800 dark:text-emerald-300/90">
                        Sumber PDF: {dbDiscount.source_file}
                        {dbDiscount.branch ? ` · Wilayah ${dbDiscount.branch}` : ''}
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-emerald-200/80 pt-2 text-xs dark:border-emerald-800/60">
                        <span className="font-mono font-semibold text-emerald-800 tabular-nums dark:text-emerald-300">
                          Potongan: -{formatRupiah(discountSummary.discountAmount)}
                        </span>
                        <span className="font-mono font-bold text-[#0B1F3A] tabular-nums dark:text-white">
                          DP Bayar: {formatRupiah(discountSummary.netDp)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-xs text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300">
                      <p className="font-medium text-slate-700 dark:text-slate-200">
                        {selectedCategory === 'reguler'
                          ? 'Diskon PDF otomatis tidak diterapkan pada kategori Reguler (0%).'
                          : 'Belum ada aturan diskon PDF untuk motor ini di database (0%).'}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {selectedCategory === 'reguler'
                          ? 'Gunakan tab Input Manual jika ingin memberikan potongan DP khusus.'
                          : 'Admin dapat mengunggah PDF promo di menu Promo & Data Angsuran atau gunakan Input Manual.'}
                      </p>
                    </div>
                  )
                ) : (
                  <>
                    <div className="mt-2 flex items-center justify-end">
                      <div className="flex items-center rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800">
                        <button
                          type="button"
                          onClick={() => handleSwitchDiscountMode('percent')}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                            discountMode === 'percent'
                              ? 'bg-white text-[#0B1F3A] shadow-xs dark:bg-slate-900 dark:text-white'
                              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                          }`}
                        >
                          Persen (%)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSwitchDiscountMode('nominal')}
                          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                            discountMode === 'nominal'
                              ? 'bg-white text-[#0B1F3A] shadow-xs dark:bg-slate-900 dark:text-white'
                              : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                          }`}
                        >
                          Nominal (Rp)
                        </button>
                      </div>
                    </div>

                    {discountMode === 'percent' ? (
                      <>
                        <div className="relative mt-2">
                          <input
                            id="home-auto-discount-percent"
                            type="number"
                            min={0}
                            max={100}
                            step="0.5"
                            inputMode="decimal"
                            value={discountPercentInput}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '') {
                                setDiscountPercentInput('');
                                return;
                              }
                              const num = Number.parseFloat(v);
                              if (Number.isNaN(num)) return;
                              setDiscountPercentInput(String(Math.min(100, Math.max(0, num))));
                            }}
                            placeholder="0"
                            className="h-12 w-full rounded-xl border border-slate-300 bg-white pr-11 pl-4 font-mono text-base font-bold text-[#0B1F3A] tabular-nums focus:border-[#0046B8] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
                          />
                          <span className="pointer-events-none absolute top-1/2 right-3.5 flex -translate-y-1/2 items-center gap-0.5 text-sm font-bold text-slate-500 dark:text-slate-400">
                            <Percent className="h-4 w-4" />
                          </span>
                        </div>

                        <div className="mt-2.5 grid grid-cols-5 gap-1.5">
                          {[0, 5, 10, 15, 20].map((pct) => {
                            const isSelected =
                              discountMode === 'percent' &&
                              Math.abs(discountSummary.discountPercent - pct) < 0.01;
                            return (
                              <button
                                key={pct}
                                type="button"
                                onClick={() => setDiscountPercentInput(String(pct))}
                                className={`min-h-[36px] rounded-lg border px-2 py-1.5 font-mono text-xs font-semibold tabular-nums transition-colors ${
                                  isSelected
                                    ? 'border-[#0046B8] bg-blue-50 text-[#0046B8] dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white'
                                }`}
                              >
                                {pct}%
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <>
                        <input
                          id="home-auto-discount-nominal"
                          type="text"
                          inputMode="numeric"
                          value={discountNominalInput}
                          onChange={(e) => setDiscountNominalInput(formatRupiahInput(e.target.value))}
                          placeholder="Contoh: Rp500.000"
                          className="mt-2 h-12 w-full rounded-xl border border-slate-300 bg-white px-4 font-mono text-base font-bold text-[#0B1F3A] tabular-nums focus:border-[#0046B8] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                        />

                        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                          {[0, 300000, 500000, 1000000].map((nom) => {
                            const isSelected =
                              nom === 0
                                ? discountSummary.discountAmount === 0
                                : parseRupiahInput(discountNominalInput) === nom;
                            return (
                              <button
                                key={nom}
                                type="button"
                                onClick={() =>
                                  setDiscountNominalInput(nom === 0 ? '' : formatRupiah(nom))
                                }
                                className={`min-h-[36px] rounded-lg border px-2 py-1.5 font-mono text-[11px] font-semibold tabular-nums transition-colors whitespace-nowrap ${
                                  isSelected
                                    ? 'border-[#0046B8] bg-blue-50 text-[#0046B8] dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-300'
                                    : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900 dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white'
                                }`}
                              >
                                {nom === 0 ? '0%' : nom === 1000000 ? 'Rp1 jt' : `Rp${nom / 1000}rb`}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}

                    {/* Ringkasan Otomatis Pengurangan DP */}
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3.5 py-2.5 text-xs dark:border dark:border-slate-800 dark:bg-slate-800/70">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-500 dark:text-slate-400">
                          Potongan ({discountSummary.discountPercentLabel}):
                        </span>
                        <span className="font-mono font-bold text-emerald-700 tabular-nums dark:text-emerald-400">
                          -{formatRupiah(discountSummary.discountAmount)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500 dark:text-slate-400">DP Bayar:</span>
                        <span className="font-mono font-bold text-[#0B1F3A] tabular-nums dark:text-white">
                          {formatRupiah(discountSummary.netDp)}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* 04. Tenor Selector Grid */}
              <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    04. Pilih Tenor (Bulan)
                  </span>
                  <span className="font-mono text-xs font-semibold text-[#0046B8] tabular-nums dark:text-blue-400">
                    {selectedTenor} Bulan
                  </span>
                </div>

                <div
                  role="radiogroup"
                  aria-label="Pilihan Tenor"
                  className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-5"
                >
                  {availableTenors.map((tenor) => {
                    const isSelected = selectedTenor === tenor;
                    return (
                      <button
                        key={tenor}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => setSelectedTenor(tenor)}
                        className={`flex min-h-[48px] flex-col items-center justify-center rounded-xl border px-2 py-2 transition-all duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0046B8] ${
                          isSelected
                            ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white shadow-xs dark:border-blue-500 dark:bg-blue-600'
                            : 'border-slate-200 bg-slate-50/80 text-slate-700 hover:border-slate-300 hover:bg-white hover:text-[#0B1F3A] dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800 dark:hover:text-white'
                        }`}
                      >
                        <span className="font-mono text-sm font-bold leading-none tabular-nums">
                          {tenor}
                        </span>
                        <span
                          className={`mt-1 text-[10px] font-medium leading-none ${
                            isSelected ? 'text-slate-300 dark:text-blue-100' : 'text-slate-500 dark:text-slate-400'
                          }`}
                        >
                          Bulan
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Primary CTA Button */}
              <div className="border-t border-slate-100 pt-5 dark:border-slate-800">
                <button
                  type="submit"
                  disabled={searching || !selectedMotor || numericDp <= 0}
                  className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#0B1F3A] to-[#0046B8] px-5 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-150 hover:from-[#102A4E] hover:to-[#003794] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 dark:from-blue-600 dark:to-blue-500 dark:hover:from-blue-500 dark:hover:to-blue-400"
                >
                  {searching ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Memuat Detail Angsuran...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Tampilkan Detail Angsuran</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>

          {/* Right Column: Dealership Showroom Slip */}
          <div ref={slipRef} className="lg:col-span-7">
            <div
              id="printable-simulation-slip"
              className={`overflow-hidden rounded-2xl border bg-white shadow-[0_6px_24px_-8px_rgba(11,31,58,0.12)] transition-all duration-200 dark:bg-slate-900 ${
                detailHighlighted
                  ? 'border-[#0046B8] ring-2 ring-[#0046B8]/25 dark:border-blue-500 dark:ring-blue-500/30'
                  : 'border-slate-200/90 dark:border-slate-800'
              }`}
            >
              {searching ? (
                <div className="flex flex-col items-center justify-center gap-3 py-28 text-slate-500 dark:text-slate-400">
                  <Loader2 className="h-6 w-6 animate-spin text-[#0046B8] dark:text-blue-400" />
                  <p className="text-sm font-medium">Mencocokkan data tepat di database...</p>
                </div>
              ) : !searchResult || !searchResult.found || !matched ? (
                <div
                  key={`empty-${revealKey}`}
                  className="animate-slip-fade-in flex flex-col items-center justify-center p-8 text-center sm:p-12"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400">
                    <Calculator className="h-7 w-7" />
                  </div>
                  <p className="mt-4 text-base font-bold text-slate-900 dark:text-white">
                    {searchResult?.message ||
                      'Kombinasi DP atau tenor tidak ditemukan di database.'}
                  </p>
                  <p className="mt-1.5 max-w-md text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Sistem hanya menampilkan nominal resmi dari file Excel dealer. Pilih langsung
                    tenor atau nominal DP terdekat yang tersedia di bawah ini.
                  </p>

                  {searchResult?.available_tenors_for_dp &&
                    searchResult.available_tenors_for_dp.length > 0 && (
                      <div className="mt-5 w-full max-w-md">
                        <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                          Tenor Tersedia untuk DP Ini:
                        </p>
                        <div className="mt-2 flex flex-wrap justify-center gap-2">
                          {searchResult.available_tenors_for_dp.map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setSelectedTenor(t)}
                              className="min-h-[38px] rounded-xl border border-[#0046B8]/40 bg-blue-50 px-3.5 py-1.5 font-mono text-xs font-bold text-[#0046B8] transition-colors hover:bg-[#0046B8] hover:text-white dark:border-blue-500/50 dark:bg-blue-950/50 dark:text-blue-300 dark:hover:bg-blue-600 dark:hover:text-white"
                            >
                              {t} Bulan
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                  {searchResult?.nearest_dps && searchResult.nearest_dps.length > 0 && (
                    <div className="mt-5 w-full max-w-lg">
                      <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                        Nominal DP Terdekat di Excel untuk Motor Ini:
                      </p>
                      <div className="mt-2 flex flex-wrap justify-center gap-2">
                        {searchResult.nearest_dps.map((dpVal) => (
                          <button
                            key={dpVal}
                            type="button"
                            onClick={() => {
                              setDpMode('select');
                              handleSelectDpValue(dpVal);
                            }}
                            className="min-h-[38px] rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 font-mono text-xs font-bold text-[#0B1F3A] transition-colors hover:border-[#0046B8] hover:bg-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-blue-500 dark:hover:bg-blue-950/60"
                          >
                            {formatRupiah(dpVal)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div key={`result-${revealKey}`} className="animate-slip-fade-in">
                  {/* Showroom Header Showcase (Tanpa Gambar Motor -> Diganti DP, Tenor Dipilih, Angsuran) */}
                  <div className="showroom-hero-surface border-b border-slate-200 p-5 text-white sm:p-7 dark:border-slate-800">
                    <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                      <div className="flex flex-wrap items-center gap-2 text-xs font-medium tracking-wide text-blue-200">
                        <span>Yamaha Thamrin Prabumulih</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-white">
                          {(matched.category || selectedCategory) === 'reguler'
                            ? 'Reguler'
                            : 'Promo'}
                        </span>
                        {matched.branch && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>Wilayah {matched.branch}</span>
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300 tabular-nums">
                        <span>ID #{matched.id}</span>
                        <span aria-hidden="true">·</span>
                        <span>Berlaku {matched.effective_date}</span>
                      </div>
                    </div>

                    <h2 className="mt-2.5 font-display text-2xl font-extrabold tracking-tight text-white text-balance sm:text-3xl">
                      {matched.motor_name}
                    </h2>

                    {/* Ringkasan Utama Pengganti Gambar Motor: DP, Tenor Dipilih, Angsuran */}
                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-xs">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-medium text-blue-100">
                            {matchedNetSummary.discountAmount > 0
                              ? 'DP Setelah Diskon'
                              : 'DP (Uang Muka)'}
                          </p>
                          <span className="font-mono text-[11px] font-bold text-emerald-300 tabular-nums">
                            Diskon {matchedNetSummary.discountPercentLabel}
                          </span>
                        </div>
                        <p className="mt-1.5 font-mono text-xl font-bold text-white tabular-nums">
                          {formatRupiah(matchedNetSummary.netDp)}
                        </p>
                        {matchedNetSummary.discountAmount > 0 && (
                          <div className="mt-2 space-y-1 text-[11px] tabular-nums">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="font-mono text-blue-200/75 line-through">
                                {formatRupiah(matchedNetSummary.baseDp)}
                              </span>
                              <span className="font-mono font-semibold text-emerald-300">
                                Hemat -{formatRupiah(matchedNetSummary.discountAmount)} (
                                {matchedNetSummary.discountPercentLabel})
                              </span>
                            </div>
                            {matchedNetSummary.pdfSource && (
                              <p className="text-[11px] font-medium text-emerald-200/90">
                                Diskon PDF: {matchedNetSummary.pdfSource}
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl border border-white/15 bg-white/10 p-4 backdrop-blur-xs">
                        <p className="text-xs font-medium text-blue-100">Tenor Dipilih</p>
                        <p className="mt-1.5 font-mono text-xl font-bold text-white tabular-nums">
                          {matched.tenor_months} Bulan
                        </p>
                      </div>

                      <div className="rounded-xl border border-sky-300/45 bg-blue-500/30 p-4 shadow-inner backdrop-blur-xs">
                        <p className="text-xs font-semibold text-sky-100">Angsuran per Bulan</p>
                        <p className="mt-1.5 font-mono text-2xl font-extrabold tracking-tight text-white tabular-nums">
                          {formatRupiah(matched.installment_amount)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Tenor Comparison, Multi-Leasing & Multi-Branch Section */}
                  <div className="space-y-5 p-5 sm:p-6">
                    {matchingLeasings.length > 1 && (
                      <div className="border-b border-slate-100 pb-5 dark:border-slate-800">
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Pilihan Leasing / Pembiayaan
                        </p>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {matchingLeasings.map((lItem) => {
                            const isCurrent =
                              (selectedLeasing &&
                                lItem.leasing_name.toLowerCase() === selectedLeasing.toLowerCase()) ||
                              (!selectedLeasing && lItem.id === matched.id);
                            return (
                              <button
                                key={lItem.id}
                                type="button"
                                onClick={() => setSelectedLeasing(lItem.leasing_name)}
                                className={`min-h-[40px] rounded-xl border px-3.5 py-2 text-xs font-semibold tabular-nums transition-colors ${
                                  isCurrent
                                    ? 'border-[#0046B8] bg-blue-50 text-[#0046B8] dark:border-blue-500 dark:bg-blue-950/60 dark:text-blue-200'
                                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800'
                                }`}
                              >
                                {lItem.leasing_name} · {formatRupiah(lItem.installment_amount)}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {matchingBranches.length > 1 && (
                      <div className="border-b border-slate-100 pb-5 dark:border-slate-800">
                        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Perbandingan Wilayah untuk Kombinasi Ini
                        </p>
                        <div className="mt-2.5 flex flex-wrap gap-2">
                          {matchingBranches.map((bItem) => (
                            <button
                              key={bItem.id}
                              type="button"
                              onClick={() => handleBranchSelect(bItem.branch)}
                              className={`min-h-[40px] rounded-xl border px-3.5 py-2 text-xs font-semibold tabular-nums transition-colors ${
                                bItem.id === matched.id
                                  ? 'border-[#0B1F3A] bg-[#0B1F3A] text-white dark:border-blue-500 dark:bg-blue-600'
                                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-800/70 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800'
                              }`}
                            >
                              {bItem.branch} · {formatRupiah(bItem.installment_amount)}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {searchResult.related_tenors.length > 0 && (
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Perbandingan Semua Tenor Tersedia
                          </p>
                          <span className="text-[11px] text-slate-500 dark:text-slate-400">
                            Klik tenor untuk mengganti
                          </span>
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                          {searchResult.related_tenors.map((rel) => {
                            const isCurrent = rel.tenor_months === matched.tenor_months;
                            return (
                              <button
                                key={rel.id}
                                type="button"
                                onClick={() => setSelectedTenor(rel.tenor_months)}
                                className={`flex min-h-[68px] flex-col justify-between rounded-xl border px-3.5 py-3 text-left transition-all duration-150 ${
                                  isCurrent
                                    ? 'border-[#0046B8] bg-blue-50/80 text-[#0B1F3A] shadow-xs dark:border-blue-500 dark:bg-blue-950/60 dark:text-white'
                                    : 'border-slate-200 bg-white text-slate-700 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50/70 hover:shadow-xs dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-300 dark:hover:border-slate-700 dark:hover:bg-slate-800'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span
                                    className={`text-[11px] font-semibold ${
                                      isCurrent
                                        ? 'text-[#0046B8] dark:text-blue-400'
                                        : 'text-slate-500 dark:text-slate-400'
                                    }`}
                                  >
                                    {rel.tenor_months} Bulan
                                  </span>
                                  {isCurrent && (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-[#0046B8] dark:text-blue-400" />
                                  )}
                                </div>
                                <span className="mt-1.5 font-mono text-sm font-bold text-[#0B1F3A] tabular-nums dark:text-white">
                                  {formatRupiah(rel.installment_amount)}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Quiet Source Footer */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-300">
                        <FileCheck2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                        Sumber: {matched.source_file}
                      </span>
                      {matched.branch && <span>Wilayah: {matched.branch}</span>}
                    </div>
                  </div>

                  {/* Actions Row & URL-Encoded WhatsApp Link Builder */}
                  <div className="no-print border-t border-slate-200 bg-slate-50/70 px-5 py-4 sm:px-6 dark:border-slate-800 dark:bg-slate-950/60">
                    <div className="flex flex-col gap-2.5 sm:flex-row">
                      <a
                        href={whatsAppShareUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                      >
                        <MessageCircle className="h-4 w-4" />
                        Bagikan ke WhatsApp
                      </a>

                      <button
                        type="button"
                        onClick={handleCopyWhatsAppLink}
                        className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-xs font-semibold text-emerald-800 transition-colors hover:border-emerald-400 hover:bg-emerald-50 dark:border-emerald-800/70 dark:bg-slate-900 dark:text-emerald-300 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/40"
                      >
                        {copiedWaLink ? (
                          <>
                            <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                            Tautan WA Disalin
                          </>
                        ) : (
                          <>
                            <Link2 className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                            Salin Tautan WA
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => window.print()}
                        className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Printer className="h-4 w-4 text-[#0B1F3A] dark:text-slate-300" />
                        Cetak / Simpan PDF
                      </button>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => setShowWaSharePanel((prev) => !prev)}
                        aria-expanded={showWaSharePanel}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0046B8] hover:underline dark:text-blue-400"
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {showWaSharePanel
                          ? 'Sembunyikan Tautan & Pratinjau WhatsApp'
                          : 'Lihat Tautan WhatsApp (URL-Encoded) & Pratinjau Pesan'}
                        {showWaSharePanel ? (
                          <ChevronUp className="h-3.5 w-3.5" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>

                    {showWaSharePanel && (
                      <div className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
                          <div className="sm:col-span-5">
                            <label
                              htmlFor="wa-target-phone"
                              className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                            >
                              Nomor WhatsApp Tujuan (Opsional)
                            </label>
                            <input
                              id="wa-target-phone"
                              type="tel"
                              inputMode="tel"
                              value={waPhoneInput}
                              onChange={(e) => setWaPhoneInput(e.target.value)}
                              placeholder="Contoh: 081234567890"
                              className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-white px-3 font-mono text-xs text-slate-900 focus:border-[#0046B8] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
                            />
                          </div>

                          <div className="sm:col-span-7">
                            <label
                              htmlFor="wa-generated-url"
                              className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300"
                            >
                              Tautan Berbagi WhatsApp (Terenkripsi URL)
                            </label>
                            <div className="mt-1 flex gap-2">
                              <input
                                id="wa-generated-url"
                                type="text"
                                readOnly
                                value={whatsAppShareUrl}
                                onFocus={(e) => e.currentTarget.select()}
                                className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 font-mono text-[11px] text-slate-700 focus:border-[#0046B8] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300 dark:focus:border-blue-500"
                              />
                              <button
                                type="button"
                                onClick={handleCopyWhatsAppLink}
                                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                              >
                                {copiedWaLink ? (
                                  <>
                                    <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400" />
                                    Disalin
                                  </>
                                ) : (
                                  <>
                                    <Copy className="h-3.5 w-3.5" />
                                    Salin URL
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                              Pratinjau Detail Pesan WhatsApp
                            </span>
                            <button
                              type="button"
                              onClick={handleCopyWhatsAppText}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0046B8] hover:underline dark:text-blue-400"
                            >
                              {copiedWaText ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-700 dark:text-emerald-400" />
                                  Teks Disalin
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  Salin Teks
                                </>
                              )}
                            </button>
                          </div>
                          <pre className="mt-1.5 max-h-52 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-200 bg-slate-50 p-3 font-sans text-xs leading-relaxed text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                            {whatsAppShareMessage}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        </>
      )}
    </section>
  );
}
