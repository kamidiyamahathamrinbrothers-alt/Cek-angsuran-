import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Bike,
  Calculator,
  CheckCircle2,
  FolderUp,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react';
import { AuthUser, MotorProduct } from '../types';
import { formatRupiah } from '../utils/format';
import CatalogStockSection from './CatalogStockSection';

interface HomeWebsiteProps {
  motors: MotorProduct[];
  motorsLoading: boolean;
  motorsError: string | null;
  currentUser: AuthUser | null;
  authToken: string | null;
  onNavigateCalculator: (motorId?: number) => void;
  onNavigateAccount: () => void;
  onStockUpdated: () => void;
}

const HERO_SHOWROOM_IMAGE = '/src/assets/images/hero_yamaha_promo_1795388181756.jpg';

export default function HomeWebsite({
  motors,
  motorsLoading,
  motorsError,
  currentUser,
  authToken,
  onNavigateCalculator,
  onNavigateAccount,
  onStockUpdated,
}: HomeWebsiteProps) {
  const [heroImgFailed, setHeroImgFailed] = useState(false);
  const [marqueeImgFailed, setMarqueeImgFailed] = useState(false);

  const totalReadyUnits = useMemo(
    () => motors.reduce((sum, m) => sum + Math.max(0, m.stock_count ?? 0), 0),
    [motors]
  );

  const flagshipMotor = useMemo(() => {
    if (motors.length === 0) return null;
    return (
      motors.find(
        (m) => m.motor_name.toLowerCase().includes('aerox') && m.variant.toLowerCase() === 'standard'
      ) || motors[0]
    );
  }, [motors]);

  return (
    <div className="overflow-x-hidden">
      {/* 1. Full-Bleed Architectural Showroom Hero */}
      <section className="relative overflow-hidden bg-[#061326] text-white">
        {/* Background Media with Measured Contrast Scrim */}
        <div className="absolute inset-0">
          {!heroImgFailed ? (
            <img
              src={HERO_SHOWROOM_IMAGE}
              alt="Showroom Yamaha Thamrin Gunung Ibul Prabumulih"
              referrerPolicy="no-referrer"
              onError={() => setHeroImgFailed(true)}
              className="h-full w-full object-cover object-center opacity-55 lg:object-right lg:opacity-75"
            />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-[#061326] via-[#0B1F3A] to-blue-950" />
          )}
          <div
            className="absolute inset-0 bg-gradient-to-r from-[#061326] via-[#061326]/90 to-[#061326]/35"
            aria-hidden="true"
          />
          <div
            className="absolute inset-0 bg-gradient-to-t from-[#061326] via-transparent to-[#061326]/40"
            aria-hidden="true"
          />
        </div>

        <div className="relative z-10 mx-auto max-w-7xl px-4 pt-12 pb-14 sm:px-6 sm:pt-16 sm:pb-20 lg:px-8 lg:pt-20 lg:pb-24">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-wider text-blue-300 sm:text-sm">
              Yamaha Thamrin Gunung Ibul · Prabumulih
            </p>
            <h1
              className="mt-4 font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl lg:text-[3.5rem] lg:leading-[1.08]"
              style={{ textWrap: 'balance' }}
            >
              Showroom Resmi Yamaha & Simulasi Kredit Transparan
            </h1>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-200 sm:text-lg">
              Cek stok motor terbaru, hitung cicilan resmi dari tabel angsuran dealer secara
              otomatis, dan bagikan rincian ke WhatsApp dalam hitungan detik.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <button
                type="button"
                onClick={() => onNavigateCalculator()}
                className="inline-flex min-h-[50px] items-center justify-center gap-2.5 rounded-xl bg-blue-600 px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-950/40 transition-all duration-150 hover:bg-blue-500 active:scale-[0.99] whitespace-nowrap"
              >
                <Calculator className="h-4 w-4" />
                Cek Angsuran Sekarang
              </button>
              <a
                href="#katalog-stok"
                className="inline-flex min-h-[50px] items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/10 px-6 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition-colors hover:bg-white/15 whitespace-nowrap"
              >
                Jelajahi Stok Unit
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>

          {/* Bottom Showroom Key Proof Strip */}
          <div className="mt-12 grid grid-cols-3 gap-4 border-t border-white/15 pt-7 sm:max-w-2xl sm:gap-8">
            <div>
              <p className="font-mono text-2xl font-bold text-white tabular-nums sm:text-3xl">
                {motors.length || 8}
              </p>
              <p className="mt-1 text-xs text-slate-300 sm:text-sm">Tipe & Varian Resmi</p>
            </div>
            <div>
              <p className="font-mono text-2xl font-bold text-white tabular-nums sm:text-3xl">
                {totalReadyUnits || 36}
              </p>
              <p className="mt-1 text-xs text-slate-300 sm:text-sm">Unit Ready Showroom</p>
            </div>
            <div>
              <p className="font-mono text-2xl font-bold text-white tabular-nums sm:text-3xl">
                5
              </p>
              <p className="mt-1 text-xs text-slate-300 sm:text-sm">Opsi Tenor 11–33 Bln</p>
            </div>
          </div>
        </div>
      </section>

      {/* 2. Asymmetric Bento Spotlight: Flagship Unit + Promo Khusus Card */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8 lg:py-16">
        <div className="grid grid-cols-1 items-stretch gap-6 lg:grid-cols-12">
          {/* 7-col Flagship Unit Card */}
          {flagshipMotor && (
            <div className="flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white transition-colors dark:border-slate-800 dark:bg-slate-900 lg:col-span-7 lg:flex-row">
              <div className="relative aspect-[4/3] w-full bg-slate-100 dark:bg-slate-800 lg:aspect-auto lg:w-1/2">
                {flagshipMotor.image_url && !marqueeImgFailed ? (
                  <img
                    src={flagshipMotor.image_url}
                    alt={`${flagshipMotor.motor_name} ${flagshipMotor.variant}`}
                    referrerPolicy="no-referrer"
                    onError={() => setMarqueeImgFailed(true)}
                    className="h-full w-full object-cover object-center"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-slate-100 text-[#0B1F3A] dark:bg-slate-800 dark:text-slate-300">
                    <Bike className="h-14 w-14 text-slate-400 dark:text-slate-500" />
                  </div>
                )}
              </div>

              <div className="flex flex-1 flex-col justify-between p-6 sm:p-8">
                <div>
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
                    Unit Unggulan · Ready {flagshipMotor.stock_count} Unit
                  </p>
                  <h2 className="mt-2 font-display text-2xl font-bold text-[#0B1F3A] dark:text-white">
                    {flagshipMotor.motor_name}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    Varian {flagshipMotor.variant}
                  </p>

                  <div className="mt-6 space-y-3 border-t border-slate-100 pt-5 dark:border-slate-800">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">DP Mulai Dari</span>
                      <span className="font-mono text-base font-bold text-slate-900 tabular-nums dark:text-slate-100">
                        {flagshipMotor.min_dp ? formatRupiah(flagshipMotor.min_dp) : '-'}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-slate-500 dark:text-slate-400">Angsuran Mulai</span>
                      <span className="font-mono text-lg font-extrabold text-blue-700 tabular-nums dark:text-blue-400">
                        {flagshipMotor.min_installment
                          ? formatRupiah(flagshipMotor.min_installment)
                          : '-'}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigateCalculator(flagshipMotor.id)}
                  className="mt-7 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-[#14325C] dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  Simulasikan {flagshipMotor.motor_name}
                  <ArrowUpRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {/* 5-col Promo Khusus & Layanan Card */}
          <div className="flex flex-col justify-between rounded-3xl border border-transparent bg-[#0B1F3A] p-7 text-white sm:p-8 lg:col-span-5 dark:border-slate-800 dark:bg-slate-900">
            <div>
              <p className="text-xs font-semibold tracking-wider text-blue-300 dark:text-blue-400">
                PROMO KHUSUS YAMAHA
              </p>
              <h2 className="mt-2 font-display text-2xl font-bold text-white sm:text-[1.75rem] sm:leading-tight">
                Cek Angsuran Motor Impianmu
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-300">
                Semua nominal angsuran terhubung langsung dengan database dealer. Pilih tenor 11,
                17, 23, 29, atau 33 bulan serta kirim penawaran ke WhatsApp pelanggan secara instan.
              </p>

              <ul className="mt-5 space-y-2.5 text-sm text-slate-200">
                <li className="flex items-center gap-2.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-blue-400" />
                  <span>Pencarian DP & rekomendasi DP terdekat otomatis</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <MessageCircle className="h-4 w-4 shrink-0 text-emerald-400" />
                  <span>Format pesan WhatsApp resmi siap kirim</span>
                </li>
                <li className="flex items-center gap-2.5">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-blue-400" />
                  <span>Data promo diperbarui berkala oleh admin dealer</span>
                </li>
              </ul>
            </div>

            <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
              <button
                type="button"
                onClick={() => onNavigateCalculator()}
                className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-500"
              >
                <Calculator className="h-4 w-4" />
                CEK ANGSURAN
              </button>
              <button
                type="button"
                onClick={onNavigateAccount}
                className="inline-flex min-h-[46px] items-center justify-center gap-2 rounded-xl border border-white/25 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                <FolderUp className="h-4 w-4" />
                Arsip File
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* 3. Alur Layanan Dealer (Clean 3-Column Editorial Band) */}
      <section className="border-y border-slate-200 bg-white transition-colors dark:border-slate-800 dark:bg-slate-900/70">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-3 md:divide-x md:divide-slate-200 dark:md:divide-slate-800">
            <div className="md:pr-6">
              <p className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">01.</p>
              <h3 className="mt-2 font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                Pilih Unit & Nominal DP
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Tentukan tipe dan varian motor Yamaha serta uang muka sesuai rencana Anda. Sistem
                otomatis mencocokkan paket resmi di database.
              </p>
            </div>
            <div className="md:px-6">
              <p className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">02.</p>
              <h3 className="mt-2 font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                Bandingkan 5 Tenor Kredit
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Lihat rincian angsuran untuk tenor 11, 17, 23, 29, dan 33 bulan secara berdampingan
                dengan angka Rupiah yang jelas dan mudah dibaca.
              </p>
            </div>
            <div className="md:pl-6">
              <p className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400">03.</p>
              <h3 className="mt-2 font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                Upload & Bagikan Dokumen
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                Semua pengguna dapat mengunggah file Excel, Google Sheets, dan PDF melalui menu Akun
                serta membagikan hasil simulasi ke WhatsApp.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Katalog Foto & Stok Motor */}
      {motorsError ? (
        <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
            {motorsError}
          </div>
        </section>
      ) : (
        <CatalogStockSection
          motors={motors}
          loading={motorsLoading}
          currentUser={currentUser}
          authToken={authToken}
          onSelectForCalculator={(id) => onNavigateCalculator(id)}
          onStockUpdated={onStockUpdated}
        />
      )}
    </div>
  );
}
