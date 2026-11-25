import { useState } from 'react';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  PackageCheck,
  Share,
  Smartphone,
  WifiOff,
  X,
} from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

function getApkUrls() {
  if (typeof window === 'undefined') {
    return {
      standaloneUrl: '/cek-angsuran',
      publicStandaloneUrl: '/cek-angsuran',
      pwabuilderUrl: 'https://www.pwabuilder.com/',
      zipDownloadUrl: '/api/apk/cek-angsuran-project.zip',
    };
  }
  const origin = window.location.origin;
  const standaloneUrl = `${origin}/cek-angsuran`;
  const publicOrigin = origin.replace('://ais-dev-', '://ais-pre-');
  const publicStandaloneUrl = `${publicOrigin}/cek-angsuran`;
  const pwabuilderUrl = `https://www.pwabuilder.com/reportcard?site=${encodeURIComponent(
    publicStandaloneUrl
  )}`;
  const zipDownloadUrl = `/api/apk/cek-angsuran-project.zip?origin=${encodeURIComponent(
    publicOrigin
  )}`;
  return { standaloneUrl, publicStandaloneUrl, pwabuilderUrl, zipDownloadUrl };
}

interface InstallGuideModalProps {
  open: boolean;
  onClose: () => void;
}

function InstallGuideModal({ open, onClose }: InstallGuideModalProps) {
  const { isInstallable, isIOS, isAndroid, isInIframe, install } = usePWAInstall();
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (!open) return null;

  const { standaloneUrl, publicStandaloneUrl, pwabuilderUrl, zipDownloadUrl } = getApkUrls();

  async function handleCopyUrl() {
    try {
      await navigator.clipboard.writeText(publicStandaloneUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    } catch {
      // Clipboard unavailable
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="apk-install-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
    >
      <div className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <button
          type="button"
          onClick={onClose}
          aria-label="Tutup panduan instalasi"
          className="absolute top-4 right-4 flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-3.5 pr-8">
          <img
            src="/pwa-192x192.png"
            alt="Ikon Aplikasi Cek Angsuran"
            className="h-14 w-14 shrink-0 rounded-2xl border border-slate-200 shadow-xs dark:border-slate-700"
          />
          <div>
            <h2
              id="apk-install-modal-title"
              className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white"
            >
              Install Aplikasi Cek Angsuran
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              Langsung pasang di layar utama HP (Android WebAPK / iOS) atau buat file installer{' '}
              <code className="font-mono text-[11px]">.apk</code>.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-4">
          {/* Langkah 1: Install Langsung sebagai Android WebAPK */}
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-800/70 dark:bg-emerald-950/35">
            <p className="text-xs font-bold text-emerald-950 dark:text-emerald-200">
              1. Langsung Pasang di HP Android (1 Klik — WebAPK)
            </p>

            {isInstallable ? (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void install()}
                  className="inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  <Download className="h-4 w-4" />
                  Pasang Aplikasi Sekarang
                </button>
              </div>
            ) : isInIframe ? (
              <div className="mt-2.5 space-y-2.5">
                <p className="text-xs leading-relaxed text-emerald-900 dark:text-emerald-200/90">
                  Browser tidak mengizinkan instalasi APK langsung dari dalam frame pratinjau. Buka
                  tautan khusus di tab browser baru untuk langsung memasang di HP Android:
                </p>
                <a
                  href={standaloneUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  <ExternalLink className="h-4 w-4" />
                  Buka Halaman Install APK di Tab Baru
                </a>
              </div>
            ) : isIOS ? (
              <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                <li>
                  1. Pastikan Anda sedang membuka halaman{' '}
                  <a
                    href="/cek-angsuran"
                    className="font-semibold text-[#0046B8] underline dark:text-blue-400"
                  >
                    /cek-angsuran
                  </a>{' '}
                  di Safari.
                </li>
                <li>
                  2. Ketuk ikon <Share className="inline h-3.5 w-3.5" /> <strong>Bagikan</strong> →{' '}
                  <strong>Tambahkan ke Layar Utama</strong>.
                </li>
              </ol>
            ) : (
              <ol className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                <li>
                  1. Buka{' '}
                  <a
                    href="/cek-angsuran"
                    className="font-semibold text-[#0046B8] underline dark:text-blue-400"
                  >
                    /cek-angsuran
                  </a>{' '}
                  di Google Chrome {isAndroid ? 'HP Anda' : 'Android'}.
                </li>
                <li>
                  2. Ketuk menu <strong>⋮ (titik tiga kanan atas)</strong> → pilih{' '}
                  <strong>&quot;Instal aplikasi&quot;</strong> atau{' '}
                  <strong>&quot;Tambahkan ke layar utama&quot;</strong>.
                </li>
              </ol>
            )}
          </div>

          {/* Bagikan Link Install ke HP Sales / Konsumen */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-800/60">
            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Link Aplikasi Khusus Cek Angsuran (Buka di Chrome HP)
            </span>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                readOnly
                value={publicStandaloneUrl}
                onFocus={(e) => e.currentTarget.select()}
                className="h-10 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 font-mono text-[11px] text-slate-700 focus:border-[#0046B8] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-300"
              />
              <button
                type="button"
                onClick={handleCopyUrl}
                className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                {copiedUrl ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                    Disalin
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Salin
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Opsi 2: Generate File .APK Online + Source Android Studio */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950/60">
            <p className="text-xs font-bold text-[#0B1F3A] dark:text-white">
              2. Buat &amp; Unduh File Installer <code className="font-mono">.APK</code> Fisik
            </p>
            <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              Untuk membagikan file <code className="font-mono text-[11px]">.apk</code> lewat
              WhatsApp, Anda bisa paketkan otomatis via PWABuilder atau compile menggunakan Android
              Studio.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <a
                href={pwabuilderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-[#0046B8] px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#003794] dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <PackageCheck className="h-4 w-4 shrink-0" />
                Paketkan .APK (PWABuilder)
              </a>

              <a
                href={zipDownloadUrl}
                download
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <FileArchive className="h-4 w-4 shrink-0 text-[#0046B8] dark:text-blue-400" />
                Source Android Studio (.zip)
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface PWAInstallButtonProps {
  compact?: boolean;
}

export function PWAInstallButton({ compact = false }: PWAInstallButtonProps) {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const [modalOpen, setModalOpen] = useState(false);

  if (isInstalled) {
    return null;
  }

  async function handlePrimaryClick() {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) return;
    }
    setModalOpen(true);
  }

  return (
    <>
      <button
        type="button"
        onClick={handlePrimaryClick}
        title="Pasang Aplikasi Cek Angsuran di HP (Android / iOS)"
        className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl bg-[#0046B8] py-2 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#003794] whitespace-nowrap shrink-0 dark:bg-blue-600 dark:hover:bg-blue-500 ${
          compact ? 'px-3' : 'px-3.5'
        }`}
      >
        <Smartphone className="h-4 w-4 shrink-0" />
        <span>{isInstallable ? 'Install APK' : 'Install APK'}</span>
      </button>

      <InstallGuideModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

export function PWAInstallBanner() {
  const { isInstallable, isInstalled, isInIframe, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  if (isInstalled || dismissed) {
    return null;
  }

  const { standaloneUrl } = getApkUrls();

  return (
    <>
      <div className="no-print mx-auto mt-4 max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col justify-between gap-3 rounded-2xl border border-blue-200 bg-gradient-to-r from-[#0B1F3A] to-[#0046B8] p-4 text-white shadow-sm sm:flex-row sm:items-center dark:border-blue-800/80">
          <div className="flex items-center gap-3">
            <img
              src="/pwa-192x192.png"
              alt="Cek Angsuran APK"
              className="h-11 w-11 shrink-0 rounded-xl border border-white/20 shadow-xs"
            />
            <div>
              <p className="font-display text-sm font-bold text-white">
                Pasang Aplikasi Cek Angsuran di HP Anda
              </p>
              <p className="mt-0.5 text-xs text-blue-100">
                {isInstallable
                  ? 'Ketuk tombol di kanan untuk langsung menginstal aplikasi ke layar utama Android/Chrome.'
                  : isInIframe
                  ? 'Buka di tab browser baru agar tombol 1-klik Install Aplikasi langsung aktif di HP Anda.'
                  : 'Akses langsung halaman Cek Angsuran (Promo & Reguler) layar penuh & tetap jalan saat offline.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isInstallable ? (
              <button
                type="button"
                onClick={() => void install()}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-400 whitespace-nowrap"
              >
                <Download className="h-4 w-4" />
                Install Sekarang (1 Klik)
              </button>
            ) : isInIframe ? (
              <a
                href={standaloneUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-400 whitespace-nowrap"
              >
                <ExternalLink className="h-4 w-4" />
                Buka &amp; Install APK
              </a>
            ) : (
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-xs font-bold text-[#0B1F3A] shadow-xs transition-colors hover:bg-blue-50 whitespace-nowrap"
              >
                <Smartphone className="h-4 w-4" />
                Install / File .APK
              </button>
            )}

            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="inline-flex min-h-[42px] items-center justify-center rounded-xl border border-white/25 bg-white/10 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-white/20 whitespace-nowrap"
            >
              File .APK
            </button>

            <button
              type="button"
              onClick={() => setDismissed(true)}
              aria-label="Tutup banner install aplikasi"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-blue-100 transition-colors hover:bg-white/15 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <InstallGuideModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-20 left-4 z-50 flex items-center gap-2 rounded-xl border border-amber-400/50 bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg md:bottom-5"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" />
      <span>Mode Offline — Menampilkan data angsuran tersimpan</span>
    </div>
  );
}
