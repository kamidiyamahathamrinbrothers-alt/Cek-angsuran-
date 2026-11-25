import { FormEvent, useState } from 'react';
import { Lock, ShieldCheck, X } from 'lucide-react';
import { AuthUser } from '../types';

interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (token: string, user: AuthUser) => void;
}

const DEMO_ACCOUNTS = [
  {
    label: 'Super Admin',
    username: 'superadmin',
    password: 'ThamrinSuper#2026',
    desc: 'Kelola motor, promo, angsuran & pengguna',
  },
  {
    label: 'Admin',
    username: 'admin',
    password: 'ThamrinAdmin#2026',
    desc: 'Tambah & perbarui angsuran serta promo',
  },
  {
    label: 'Sales',
    username: 'sales',
    password: 'ThamrinSales#2026',
    desc: 'Kalkulator simulasi & bagikan WhatsApp',
  },
];

export default function LoginModal({ open, onClose, onSuccess }: LoginModalProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Gagal login. Periksa kembali akun Anda.');
        return;
      }
      onSuccess(data.token, data.user);
      setUsername('');
      setPassword('');
    } catch {
      setError('Tidak dapat terhubung ke server.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#0B1F3A] text-white dark:bg-blue-600">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 id="login-modal-title" className="text-lg font-bold text-slate-900 dark:text-white">
                Masuk Portal Staff
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Yamaha Thamrin Gunung Ibul Prabumulih
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            aria-label="Tutup dialog login"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="login-username" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Username / Email
            </label>
            <input
              id="login-username"
              type="text"
              required
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Masukkan username atau email admin"
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 transition-colors focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300">
              Password
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Masukkan password"
              className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3.5 text-sm text-slate-900 transition-colors focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500 dark:focus:ring-blue-500/20"
            />
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#14325C] disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
          >
            <Lock className="h-4 w-4" />
            {loading ? 'Memverifikasi...' : 'Masuk Sekarang'}
          </button>
        </form>

        <div className="mt-6 border-t border-slate-200 pt-4 dark:border-slate-800">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
            Akses Cepat Uji Role RBAC
          </p>
          <div className="mt-2.5 grid grid-cols-1 gap-2">
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.username}
                type="button"
                onClick={() => {
                  setUsername(acc.username);
                  setPassword(acc.password);
                  setError(null);
                }}
                className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/60 dark:border-slate-800 dark:bg-slate-800/70 dark:hover:border-blue-700 dark:hover:bg-slate-800"
              >
                <div>
                  <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    {acc.label}
                  </span>
                  <span className="ml-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                    @{acc.username}
                  </span>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{acc.desc}</p>
                </div>
                <span className="text-xs font-medium text-blue-700 dark:text-blue-400">Isi</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
