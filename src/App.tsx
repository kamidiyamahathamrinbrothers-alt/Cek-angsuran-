import { useEffect, useState } from 'react';
import {
  Calculator,
  FolderUp,
  LogIn,
  LogOut,
  MapPin,
  Moon,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import AccountUploadSection from './components/AccountUploadSection';
import AdminDashboard from './components/AdminDashboard';
import HomeAutoLookupSection from './components/HomeAutoLookupSection';
import LoginModal from './components/LoginModal';
import { OfflineIndicator } from './components/PWAInstallModal';
import { AuthUser, AutoInstallmentCategory } from './types';

const TOKEN_STORAGE_KEY = 'yamaha_thamrin_auth_token';
const THEME_STORAGE_KEY = 'yamaha_thamrin_theme';

type PageView = 'calculator' | 'account' | 'admin';
type ThemeMode = 'light' | 'dark';

function isDedicatedCekAngsuranPath(): boolean {
  if (typeof window === 'undefined') return false;
  return window.location.pathname.toLowerCase().startsWith('/cek-angsuran');
}

export default function App() {
  const [isApkMode, setIsApkMode] = useState<boolean>(() => isDedicatedCekAngsuranPath());
  const [view, setView] = useState<PageView>('calculator');
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) {
      return 'dark';
    }
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
      if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
    }
    return 'light';
  });

  const [authToken, setAuthToken] = useState<string | null>(() =>
    localStorage.getItem(TOKEN_STORAGE_KEY)
  );
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [loginModalOpen, setLoginModalOpen] = useState<boolean>(false);
  const [adminInitialTab, setAdminInitialTab] = useState<'installments' | 'auto_db'>('installments');
  const [adminImportCategory, setAdminImportCategory] =
    useState<AutoInstallmentCategory>('promo');
  const [pendingRegulerUpload, setPendingRegulerUpload] = useState<boolean>(false);
  const [calculatorCategoryHint, setCalculatorCategoryHint] =
    useState<AutoInstallmentCategory>('promo');
  const [dataRefreshKey, setDataRefreshKey] = useState<number>(0);

  useEffect(() => {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Ignore storage error
    }
  }, [theme]);

  function toggleTheme() {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }

  useEffect(() => {
    if (!authToken) {
      setCurrentUser(null);
      return;
    }
    let cancelled = false;
    fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('invalid');
        return res.json();
      })
      .then((data) => {
        if (!cancelled && data.user) {
          setCurrentUser(data.user);
        }
      })
      .catch(() => {
        if (!cancelled) {
          localStorage.removeItem(TOKEN_STORAGE_KEY);
          setAuthToken(null);
          setCurrentUser(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  function handleLoginSuccess(token: string, user: AuthUser) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
    setAuthToken(token);
    setCurrentUser(user);
    setLoginModalOpen(false);
    if (user.role === 'super_admin' || user.role === 'admin') {
      if (pendingRegulerUpload) {
        setAdminInitialTab('auto_db');
        setAdminImportCategory('reguler');
        setPendingRegulerUpload(false);
      }
      setView('admin');
    } else {
      if (pendingRegulerUpload) {
        setPendingRegulerUpload(false);
        setView('account');
      } else {
        setView('calculator');
      }
    }
  }

  async function handleLogout() {
    if (authToken) {
      try {
        await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${authToken}` },
        });
      } catch {
        // Ignore network error during logout
      }
    }
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setAuthToken(null);
    setCurrentUser(null);
    if (view === 'admin') {
      setView('calculator');
    }
  }

  function navigateTab(nextView: PageView) {
    setView(nextView);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleDataUpdated(appliedCategory?: AutoInstallmentCategory) {
    setDataRefreshKey((prev) => prev + 1);
    if (appliedCategory) {
      setCalculatorCategoryHint(appliedCategory);
    }
  }

  function handleGoToCalculator(targetCategory?: AutoInstallmentCategory) {
    if (targetCategory) {
      setCalculatorCategoryHint(targetCategory);
    }
    setDataRefreshKey((prev) => prev + 1);
    navigateTab('calculator');
  }

  const canAccessAdmin =
    currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  function exitApkModeToWeb(targetView: PageView = 'calculator') {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      window.history.pushState({}, '', '/');
    }
    setIsApkMode(false);
    setView(targetView);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function handleOpenRegulerUpload() {
    if (isApkMode) {
      if (typeof window !== 'undefined' && window.location.pathname !== '/') {
        window.history.pushState({}, '', '/');
      }
      setIsApkMode(false);
    }
    if (canAccessAdmin) {
      setAdminInitialTab('auto_db');
      setAdminImportCategory('reguler');
      setView('admin');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (currentUser) {
      setView('account');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setPendingRegulerUpload(true);
    setLoginModalOpen(true);
  }

  useEffect(() => {
    const onPopState = () => {
      const dedicated = isDedicatedCekAngsuranPath();
      setIsApkMode(dedicated);
      if (dedicated) {
        setView('calculator');
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Dedicated Standalone APK / PWA Mode khusus halaman Cek Angsuran (/cek-angsuran)
  if (isApkMode) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900 transition-colors duration-200 dark:bg-[#080E1A] dark:text-slate-100">
        <header className="no-print sticky top-0 z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-lg transition-colors duration-200 dark:border-slate-800/90 dark:bg-[#0B1221]/90">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <span className="font-display text-lg font-extrabold tracking-tight text-[#0B1F3A] whitespace-nowrap shrink-0 dark:text-white">
              Cek Angsuran
            </span>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={toggleTheme}
                aria-pressed={theme === 'dark'}
                aria-label={theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
                title={theme === 'dark' ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap'}
                className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {theme === 'dark' ? (
                  <>
                    <Sun className="h-4 w-4 text-amber-400" />
                    <span className="hidden sm:inline">Terang</span>
                  </>
                ) : (
                  <>
                    <Moon className="h-4 w-4 text-[#0B1F3A]" />
                    <span className="hidden sm:inline">Gelap</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1">
          <HomeAutoLookupSection
            initialCategory={calculatorCategoryHint}
            refreshKey={dataRefreshKey}
            canUploadAdmin={canAccessAdmin}
            onUploadRegulerExcel={handleOpenRegulerUpload}
          />
        </main>

        <footer className="no-print border-t border-slate-200/80 bg-white/80 py-4 text-center text-[11px] text-slate-500 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4">
            <span>Yamaha Thamrin Gunung Ibul Prabumulih</span>
            <button
              type="button"
              onClick={() => exitApkModeToWeb('account')}
              className="font-semibold text-[#0046B8] hover:underline dark:text-blue-400"
            >
              Buka Menu Akun &amp; Pengaturan
            </button>
          </div>
        </footer>

        <OfflineIndicator />

        <LoginModal
          open={loginModalOpen}
          onClose={() => {
            setPendingRegulerUpload(false);
            setLoginModalOpen(false);
          }}
          onSuccess={handleLoginSuccess}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#F4F6FA] pb-18 text-slate-900 transition-colors duration-200 dark:bg-[#070C17] dark:text-slate-100">
      {/* Top Bar Contract: 3 clean zones separated by gap-8 */}
      <header className="no-print border-b border-slate-200/80 bg-white/90 backdrop-blur-lg transition-colors duration-200 md:sticky md:top-0 md:z-30 dark:border-slate-800/90 dark:bg-[#0B1221]/90">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3.5 sm:gap-8 sm:px-6 lg:px-8">
          {/* Zone 1: Single-line brand wordmark */}
          <button
            type="button"
            onClick={() => navigateTab('calculator')}
            className="font-display text-lg font-extrabold tracking-tight text-[#0B1F3A] whitespace-nowrap shrink-0 dark:text-white"
          >
            Yamaha Thamrin
          </button>

          {/* Zone 2: Concise single-line navigation links */}
          <nav className="hidden items-center gap-7 text-sm font-medium text-slate-600 md:flex dark:text-slate-300">
            <button
              type="button"
              onClick={() => navigateTab('calculator')}
              className={`transition-colors hover:text-[#0B1F3A] whitespace-nowrap shrink-0 dark:hover:text-white ${
                view === 'calculator'
                  ? 'font-semibold text-[#0B1F3A] underline decoration-2 decoration-[#0046B8] underline-offset-8 dark:text-white dark:decoration-blue-400'
                  : ''
              }`}
            >
              Cek Angsuran
            </button>
            <button
              type="button"
              onClick={() => navigateTab('account')}
              className={`transition-colors hover:text-[#0B1F3A] whitespace-nowrap shrink-0 dark:hover:text-white ${
                view === 'account'
                  ? 'font-semibold text-[#0B1F3A] underline decoration-2 decoration-[#0046B8] underline-offset-8 dark:text-white dark:decoration-blue-400'
                  : ''
              }`}
            >
              Akun
            </button>
            {canAccessAdmin && (
              <button
                type="button"
                onClick={() => {
                  setAdminInitialTab('installments');
                  setAdminImportCategory('promo');
                  navigateTab('admin');
                }}
                className={`transition-colors hover:text-[#0B1F3A] whitespace-nowrap shrink-0 dark:hover:text-white ${
                  view === 'admin'
                    ? 'font-semibold text-[#0046B8] underline decoration-2 decoration-[#0046B8] underline-offset-8 dark:text-blue-400 dark:decoration-blue-400'
                    : 'text-slate-700 dark:text-slate-300'
                }`}
              >
                Promo & Data Angsuran
              </button>
            )}
          </nav>

          {/* Zone 3: Theme Toggle + Primary Auth Action */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={toggleTheme}
              aria-pressed={theme === 'dark'}
              aria-label={theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
              title={theme === 'dark' ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap'}
              className="inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="h-4 w-4 text-amber-400" />
                  <span className="hidden sm:inline">Terang</span>
                </>
              ) : (
                <>
                  <Moon className="h-4 w-4 text-[#0B1F3A]" />
                  <span className="hidden sm:inline">Gelap</span>
                </>
              )}
            </button>

            {currentUser ? (
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <LogOut className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                Keluar (
                {currentUser.role === 'super_admin'
                  ? 'Super Admin'
                  : currentUser.role === 'admin'
                  ? 'Admin'
                  : 'Sales'}
                )
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setLoginModalOpen(true)}
                className="inline-flex min-h-[40px] items-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#14325C] whitespace-nowrap shrink-0 dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <LogIn className="h-3.5 w-3.5" />
                Masuk Staff
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {view === 'admin' && authToken && currentUser ? (
          <AdminDashboard
            token={authToken}
            currentUser={currentUser}
            onDataChanged={() => handleDataUpdated()}
            onOpenCalculator={handleGoToCalculator}
            initialTab={adminInitialTab}
            initialAutoImportCategory={adminImportCategory}
          />
        ) : view === 'account' ? (
          <AccountUploadSection
            currentUser={currentUser}
            authToken={authToken}
            onOpenLogin={() => setLoginModalOpen(true)}
            onLogout={handleLogout}
            onOpenAdminDashboard={() => navigateTab('admin')}
            onDataAppliedToInstallments={handleDataUpdated}
            onGoToCalculator={handleGoToCalculator}
          />
        ) : (
          <HomeAutoLookupSection
            initialCategory={calculatorCategoryHint}
            refreshKey={dataRefreshKey}
            canUploadAdmin={canAccessAdmin}
            onUploadRegulerExcel={handleOpenRegulerUpload}
          />
        )}
      </main>

      {/* Quiet Dealer Footer */}
      <footer className="no-print border-t border-slate-200/80 bg-white/80 transition-colors duration-200 dark:border-slate-800/90 dark:bg-[#0B1221]/80">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-6 px-4 py-8 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <div>
            <p className="font-display text-base font-bold text-[#0B1F3A] dark:text-white">
              Yamaha Thamrin Gunung Ibul Prabumulih
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
              <MapPin className="h-3.5 w-3.5 text-[#0046B8] dark:text-blue-400" />
              Gunung Ibul, Kota Prabumulih, Sumatera Selatan
            </p>
          </div>

          <div className="max-w-md text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            <p className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
              <ShieldCheck className="h-3.5 w-3.5 text-[#0046B8] dark:text-blue-400" />
              Data Angsuran Terhubung Langsung dengan Database Dealer
            </p>
            <p className="mt-1">
              Simulasi pada halaman ini merupakan estimasi referensi dan bukan merupakan penawaran
              kredit resmi yang mengikat.
            </p>
          </div>
        </div>
      </footer>

      {/* Fixed Bottom Navigation Bar: Cek Angsuran | Akun */}
      <nav
        aria-label="Navigasi Utama Bawah"
        className="no-print fixed right-0 bottom-0 left-0 z-40 border-t border-slate-200/80 bg-white/90 backdrop-blur-lg transition-colors duration-200 dark:border-slate-800/90 dark:bg-[#0B1221]/92"
      >
        <div className="mx-auto grid h-16 max-w-7xl grid-cols-2 items-center">
          <button
            type="button"
            onClick={() => navigateTab('calculator')}
            className={`relative flex h-full min-h-[44px] flex-col items-center justify-center gap-1 transition-colors ${
              view === 'calculator'
                ? 'text-[#0046B8] dark:text-blue-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {view === 'calculator' && (
              <span
                aria-hidden="true"
                className="absolute top-0 h-0.5 w-12 rounded-full bg-[#0046B8] dark:bg-blue-400"
              />
            )}
            <Calculator
              className={`h-5 w-5 ${view === 'calculator' ? 'stroke-[2.4]' : 'stroke-[1.8]'}`}
            />
            <span
              className={`text-[11px] leading-none ${
                view === 'calculator' ? 'font-bold' : 'font-medium'
              }`}
            >
              Cek Angsuran
            </span>
          </button>

          <button
            type="button"
            onClick={() => navigateTab('account')}
            className={`relative flex h-full min-h-[44px] flex-col items-center justify-center gap-1 transition-colors ${
              view === 'account' || view === 'admin'
                ? 'text-[#0046B8] dark:text-blue-400'
                : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {(view === 'account' || view === 'admin') && (
              <span
                aria-hidden="true"
                className="absolute top-0 h-0.5 w-12 rounded-full bg-[#0046B8] dark:bg-blue-400"
              />
            )}
            <FolderUp
              className={`h-5 w-5 ${
                view === 'account' || view === 'admin' ? 'stroke-[2.4]' : 'stroke-[1.8]'
              }`}
            />
            <span
              className={`text-[11px] leading-none ${
                view === 'account' || view === 'admin' ? 'font-bold' : 'font-medium'
              }`}
            >
              Akun
            </span>
          </button>
        </div>
      </nav>

      <OfflineIndicator />

      <LoginModal
        open={loginModalOpen}
        onClose={() => {
          setPendingRegulerUpload(false);
          setLoginModalOpen(false);
        }}
        onSuccess={handleLoginSuccess}
      />
    </div>
  );
}
