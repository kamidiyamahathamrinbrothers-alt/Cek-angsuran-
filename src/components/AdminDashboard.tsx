import { ChangeEvent, FormEvent, useCallback, useEffect, useState } from 'react';
import {
  Bike,
  Download,
  Edit3,
  FileSpreadsheet,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  AdminUserRecord,
  AuthUser,
  AutoInstallmentCategory,
  InstallmentPackage,
  MotorProduct,
  TENOR_OPTIONS,
  TenorMonths,
  UserRole,
} from '../types';
import { formatRupiah, formatRupiahInput, parseRupiahInput } from '../utils/format';
import AutoInstallmentAdmin from './AutoInstallmentAdmin';
import ConfirmModal from './ConfirmModal';

interface AdminDashboardProps {
  token: string;
  currentUser: AuthUser;
  initialTab?: AdminTab;
  initialAutoImportCategory?: AutoInstallmentCategory;
  onDataChanged: () => void;
  onOpenCalculator?: (category?: AutoInstallmentCategory) => void;
}

type AdminTab = 'installments' | 'auto_db' | 'motors' | 'users';

const PRESET_MOTOR_IMAGES = [
  {
    label: 'Yamaha Aerox (Studio)',
    url: '/src/assets/images/motor_yamaha_aerox_1795388181092.jpg',
  },
  {
    label: 'Yamaha NMAX (Studio)',
    url: '/src/assets/images/motor_yamaha_nmax_1795388180934.jpg',
  },
  {
    label: 'Yamaha Grand Filano (Studio)',
    url: '/src/assets/images/motor_yamaha_filano_1795388181422.jpg',
  },
  {
    label: 'Yamaha Fazzio (Studio)',
    url: '/src/assets/images/motor_yamaha_fazzio_1795388181050.jpg',
  },
];

export default function AdminDashboard({
  token,
  currentUser,
  initialTab,
  initialAutoImportCategory,
  onDataChanged,
  onOpenCalculator,
}: AdminDashboardProps) {
  const isSuperAdmin = currentUser.role === 'super_admin';
  const canManageInstallments = currentUser.role === 'super_admin' || currentUser.role === 'admin';

  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab ?? 'installments');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Data state
  const [motors, setMotors] = useState<MotorProduct[]>([]);
  const [packages, setPackages] = useState<InstallmentPackage[]>([]);
  const [users, setUsers] = useState<AdminUserRecord[]>([]);
  const [loadingData, setLoadingData] = useState<boolean>(true);

  // Filters
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterMotorId, setFilterMotorId] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');

  // Batch Add Installment Modal
  const [batchModalOpen, setBatchModalOpen] = useState<boolean>(false);
  const [batchMotorId, setBatchMotorId] = useState<number>(0);
  const [batchDpInput, setBatchDpInput] = useState<string>('');
  const [batchPromoName, setBatchPromoName] = useState<string>('Promo Khusus Yamaha');
  const [batchEffectiveDate, setBatchEffectiveDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [batchStatus, setBatchStatus] = useState<'active' | 'inactive'>('active');
  const [batchTenors, setBatchTenors] = useState<Record<TenorMonths, string>>({
    11: '',
    17: '',
    23: '',
    29: '',
    33: '',
  });
  const [savingBatch, setSavingBatch] = useState<boolean>(false);

  // Edit Single Installment Modal
  const [editingPackage, setEditingPackage] = useState<InstallmentPackage | null>(null);
  const [editPkgDp, setEditPkgDp] = useState<string>('');
  const [editPkgTenor, setEditPkgTenor] = useState<TenorMonths>(23);
  const [editPkgInstallment, setEditPkgInstallment] = useState<string>('');
  const [editPkgPromo, setEditPkgPromo] = useState<string>('');
  const [editPkgDate, setEditPkgDate] = useState<string>('');
  const [editPkgStatus, setEditPkgStatus] = useState<'active' | 'inactive'>('active');
  const [savingEditPkg, setSavingEditPkg] = useState<boolean>(false);

  // Import Modal
  const [importModalOpen, setImportModalOpen] = useState<boolean>(false);
  const [importFileName, setImportFileName] = useState<string>('');
  const [importBase64, setImportBase64] = useState<string>('');
  const [importing, setImporting] = useState<boolean>(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  // Motor Modal
  const [motorModalOpen, setMotorModalOpen] = useState<boolean>(false);
  const [editingMotor, setEditingMotor] = useState<MotorProduct | null>(null);
  const [motorBrand, setMotorBrand] = useState<string>('Yamaha');
  const [motorName, setMotorName] = useState<string>('');
  const [motorVariant, setMotorVariant] = useState<string>('');
  const [motorImageUrl, setMotorImageUrl] = useState<string>(PRESET_MOTOR_IMAGES[0].url);
  const [motorActive, setMotorActive] = useState<boolean>(true);
  const [savingMotor, setSavingMotor] = useState<boolean>(false);

  // User Modal
  const [userModalOpen, setUserModalOpen] = useState<boolean>(false);
  const [editingUser, setEditingUser] = useState<AdminUserRecord | null>(null);
  const [userName, setUserName] = useState<string>('');
  const [userUsername, setUserUsername] = useState<string>('');
  const [userPassword, setUserPassword] = useState<string>('');
  const [userRole, setUserRole] = useState<UserRole>('admin');
  const [userActive, setUserActive] = useState<boolean>(true);
  const [savingUser, setSavingUser] = useState<boolean>(false);

  // Confirm Delete Modal
  const [confirmDelete, setConfirmDelete] = useState<{
    type: 'package' | 'motor' | 'user';
    id: number;
    title: string;
    description: string;
  } | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  const authHeaders = useCallback(
    () => ({
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    }),
    [token]
  );

  const loadMotors = useCallback(async () => {
    const res = await fetch('/api/admin/motors', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setMotors(data.motors || []);
      if (data.motors?.length > 0 && !batchMotorId) {
        setBatchMotorId(data.motors[0].id);
      }
    }
  }, [token, batchMotorId]);

  const loadPackages = useCallback(async () => {
    const params = new URLSearchParams();
    if (searchQuery.trim()) params.set('search', searchQuery.trim());
    if (filterMotorId) params.set('motor_id', filterMotorId);
    if (filterStatus !== 'all') params.set('status', filterStatus);

    const res = await fetch(`/api/admin/installments?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setPackages(data.packages || []);
    }
  }, [token, searchQuery, filterMotorId, filterStatus]);

  const loadUsers = useCallback(async () => {
    if (!isSuperAdmin) return;
    const res = await fetch('/api/admin/users', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setUsers(data.users || []);
    }
  }, [token, isSuperAdmin]);

  const refreshAll = useCallback(async () => {
    setLoadingData(true);
    try {
      await Promise.all([loadMotors(), loadPackages(), loadUsers()]);
    } finally {
      setLoadingData(false);
    }
  }, [loadMotors, loadPackages, loadUsers]);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (canManageInstallments) {
      refreshAll();
    }
  }, [canManageInstallments, refreshAll]);

  useEffect(() => {
    if (!canManageInstallments) return;
    const timer = setTimeout(() => {
      loadPackages();
    }, 180);
    return () => clearTimeout(timer);
  }, [canManageInstallments, loadPackages]);

  if (!canManageInstallments) {
    return (
      <section className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-xs dark:border-slate-800 dark:bg-slate-900">
          <h2 className="font-display text-xl font-bold text-[#0B1F3A] dark:text-white">
            Akses Terbatas
          </h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Akun dengan role <span className="font-semibold">Sales</span> hanya memiliki izin untuk
            menggunakan kalkulator simulasi angsuran dan membagikan rincian ke WhatsApp.
          </p>
        </div>
      </section>
    );
  }

  function showBanner(type: 'success' | 'error', text: string) {
    setFeedback({ type, text });
    setTimeout(() => {
      setFeedback((prev) => (prev?.text === text ? null : prev));
    }, 5000);
  }

  // Batch Create / Upsert 5 Tenors
  async function handleSaveBatch(e: FormEvent) {
    e.preventDefault();
    const dpNum = parseRupiahInput(batchDpInput);
    if (!batchMotorId || dpNum <= 0) {
      showBanner('error', 'Pilih motor dan masukkan nominal DP yang valid.');
      return;
    }

    const tenorsPayload: Record<string, number> = {};
    for (const t of TENOR_OPTIONS) {
      const num = parseRupiahInput(batchTenors[t]);
      if (num > 0) {
        tenorsPayload[String(t)] = num;
      }
    }

    if (Object.keys(tenorsPayload).length === 0) {
      showBanner('error', 'Isi minimal satu nominal angsuran tenor (11, 17, 23, 29, atau 33 bulan).');
      return;
    }

    setSavingBatch(true);
    try {
      const res = await fetch('/api/admin/installments/batch', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          motor_id: batchMotorId,
          dp_amount: dpNum,
          promo_name: batchPromoName.trim() || 'Promo Khusus Yamaha',
          effective_date: batchEffectiveDate,
          status: batchStatus,
          tenors: tenorsPayload,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Gagal menyimpan paket angsuran.');
        return;
      }
      setBatchModalOpen(false);
      setBatchDpInput('');
      setBatchTenors({ 11: '', 17: '', 23: '', 29: '', 33: '' });
      showBanner('success', `${data.count} paket angsuran berhasil disimpan ke database.`);
      await refreshAll();
      onDataChanged();
    } catch {
      showBanner('error', 'Gagal terhubung ke server.');
    } finally {
      setSavingBatch(false);
    }
  }

  function openEditPackage(pkg: InstallmentPackage) {
    setEditingPackage(pkg);
    setEditPkgDp(formatRupiah(pkg.dp_amount));
    setEditPkgTenor(pkg.tenor_months);
    setEditPkgInstallment(formatRupiah(pkg.installment_amount));
    setEditPkgPromo(pkg.promo_name);
    setEditPkgDate(pkg.effective_date);
    setEditPkgStatus(pkg.status);
  }

  async function handleSaveEditPackage(e: FormEvent) {
    e.preventDefault();
    if (!editingPackage) return;
    const dpNum = parseRupiahInput(editPkgDp);
    const instNum = parseRupiahInput(editPkgInstallment);
    if (dpNum <= 0 || instNum <= 0) {
      showBanner('error', 'Nominal DP dan angsuran harus lebih dari Rp0.');
      return;
    }

    setSavingEditPkg(true);
    try {
      const res = await fetch(`/api/admin/installments/${editingPackage.id}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          dp_amount: dpNum,
          tenor_months: editPkgTenor,
          installment_amount: instNum,
          promo_name: editPkgPromo.trim() || 'Promo Khusus Yamaha',
          effective_date: editPkgDate,
          status: editPkgStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Gagal memperbarui paket angsuran.');
        return;
      }
      setEditingPackage(null);
      showBanner('success', 'Data paket angsuran berhasil diperbarui.');
      await refreshAll();
      onDataChanged();
    } catch {
      showBanner('error', 'Gagal terhubung ke server.');
    } finally {
      setSavingEditPkg(false);
    }
  }

  async function handleTogglePackageStatus(pkg: InstallmentPackage) {
    const nextStatus = pkg.status === 'active' ? 'inactive' : 'active';
    try {
      const res = await fetch(`/api/admin/installments/${pkg.id}/status`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ status: nextStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Gagal mengubah status paket.');
        return;
      }
      showBanner(
        'success',
        `Paket ${pkg.motor_name} ${pkg.tenor_months} bulan (${formatRupiah(pkg.dp_amount)}) diubah menjadi ${
          nextStatus === 'active' ? 'Aktif' : 'Nonaktif'
        }.`
      );
      await refreshAll();
      onDataChanged();
    } catch {
      showBanner('error', 'Gagal terhubung ke server.');
    }
  }

  async function handleExport(format: 'xlsx' | 'csv') {
    try {
      const res = await fetch(`/api/admin/installments/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        showBanner('error', 'Gagal mengekspor data angsuran.');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `data_angsuran_yamaha_thamrin.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      showBanner('error', 'Terjadi kendala saat mengunduh file export.');
    }
  }

  async function handleDownloadTemplate() {
    try {
      const res = await fetch('/api/admin/installments/template', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'template_import_angsuran_yamaha.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      showBanner('error', 'Gagal mengunduh template Excel.');
    }
  }

  function handleImportFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportErrors([]);

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      setImportBase64(base64);
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmitImport(e: FormEvent) {
    e.preventDefault();
    if (!importBase64) {
      showBanner('error', 'Pilih file Excel (.xlsx) atau CSV (.csv) terlebih dahulu.');
      return;
    }
    setImporting(true);
    setImportErrors([]);
    try {
      const res = await fetch('/api/admin/installments/import', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ fileBase64: importBase64, filename: importFileName }),
      });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Import gagal.');
        return;
      }
      if (data.errors && data.errors.length > 0) {
        setImportErrors(data.errors);
      }
      showBanner('success', `Berhasil mengimpor ${data.imported_count} baris angsuran.`);
      await refreshAll();
      onDataChanged();
      if (!data.errors || data.errors.length === 0) {
        setImportModalOpen(false);
        setImportBase64('');
        setImportFileName('');
      }
    } catch {
      showBanner('error', 'Gagal mengunggah file import.');
    } finally {
      setImporting(false);
    }
  }

  // Motor CRUD (Super Admin)
  function openCreateMotor() {
    setEditingMotor(null);
    setMotorBrand('Yamaha');
    setMotorName('');
    setMotorVariant('');
    setMotorImageUrl(PRESET_MOTOR_IMAGES[0].url);
    setMotorActive(true);
    setMotorModalOpen(true);
  }

  function openEditMotor(motor: MotorProduct) {
    setEditingMotor(motor);
    setMotorBrand(motor.brand);
    setMotorName(motor.motor_name);
    setMotorVariant(motor.variant);
    setMotorImageUrl(motor.image_url || PRESET_MOTOR_IMAGES[0].url);
    setMotorActive(motor.is_active);
    setMotorModalOpen(true);
  }

  async function handleSaveMotor(e: FormEvent) {
    e.preventDefault();
    if (!motorName.trim() || !motorVariant.trim()) {
      showBanner('error', 'Tipe motor dan varian wajib diisi.');
      return;
    }
    setSavingMotor(true);
    try {
      const url = editingMotor ? `/api/admin/motors/${editingMotor.id}` : '/api/admin/motors';
      const method = editingMotor ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify({
          brand: motorBrand.trim() || 'Yamaha',
          motor_name: motorName.trim(),
          variant: motorVariant.trim(),
          image_url: motorImageUrl.trim(),
          is_active: motorActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Gagal menyimpan data motor.');
        return;
      }
      setMotorModalOpen(false);
      showBanner('success', editingMotor ? 'Data motor diperbarui.' : 'Motor baru berhasil ditambahkan.');
      await refreshAll();
      onDataChanged();
    } catch {
      showBanner('error', 'Gagal terhubung ke server.');
    } finally {
      setSavingMotor(false);
    }
  }

  // User CRUD (Super Admin)
  function openCreateUser() {
    setEditingUser(null);
    setUserName('');
    setUserUsername('');
    setUserPassword('');
    setUserRole('admin');
    setUserActive(true);
    setUserModalOpen(true);
  }

  function openEditUser(u: AdminUserRecord) {
    setEditingUser(u);
    setUserName(u.name);
    setUserUsername(u.username);
    setUserPassword('');
    setUserRole(u.role);
    setUserActive(u.is_active);
    setUserModalOpen(true);
  }

  async function handleSaveUser(e: FormEvent) {
    e.preventDefault();
    if (!userName.trim() || (!editingUser && (!userUsername.trim() || userPassword.length < 6))) {
      showBanner('error', 'Lengkapi nama, username, dan password minimal 6 karakter.');
      return;
    }
    setSavingUser(true);
    try {
      const url = editingUser ? `/api/admin/users/${editingUser.id}` : '/api/admin/users';
      const method = editingUser ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: JSON.stringify({
          name: userName.trim(),
          username: userUsername.trim(),
          password: userPassword || undefined,
          role: userRole,
          is_active: userActive,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Gagal menyimpan pengguna.');
        return;
      }
      setUserModalOpen(false);
      showBanner('success', editingUser ? 'Data pengguna diperbarui.' : 'Pengguna baru berhasil ditambahkan.');
      await loadUsers();
    } catch {
      showBanner('error', 'Gagal terhubung ke server.');
    } finally {
      setSavingUser(false);
    }
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      let endpoint = '';
      if (confirmDelete.type === 'package') endpoint = `/api/admin/installments/${confirmDelete.id}`;
      if (confirmDelete.type === 'motor') endpoint = `/api/admin/motors/${confirmDelete.id}`;
      if (confirmDelete.type === 'user') endpoint = `/api/admin/users/${confirmDelete.id}`;

      const res = await fetch(endpoint, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        showBanner('error', data.error || 'Gagal menghapus data.');
        return;
      }
      setConfirmDelete(null);
      showBanner('success', 'Data berhasil dihapus dari database.');
      await refreshAll();
      onDataChanged();
    } catch {
      showBanner('error', 'Gagal terhubung ke server.');
    } finally {
      setDeleting(false);
    }
  }

  const roleLabel =
    currentUser.role === 'super_admin'
      ? 'Super Admin'
      : currentUser.role === 'admin'
      ? 'Admin'
      : 'Sales';

  return (
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end dark:border-slate-800">
        <div>
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-400">
            Dashboard Admin · {roleLabel} ({currentUser.name})
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-[#0B1F3A] sm:text-3xl dark:text-white">
            PROMO & DATA ANGSURAN
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Kelola tabel motor Yamaha, nominal DP, paket angsuran 5 tenor, promo, serta import/export data.
          </p>
        </div>

        {/* Sub-navigation tabs */}
        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setActiveTab('installments')}
            className={`min-h-[40px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'installments'
                ? 'bg-[#0B1F3A] text-white shadow-xs dark:bg-blue-600'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Data Angsuran & Promo
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('auto_db')}
            className={`min-h-[40px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'auto_db'
                ? 'bg-[#0B1F3A] text-white shadow-xs dark:bg-blue-600'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Database Angsuran Otomatis
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('motors')}
            className={`min-h-[40px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'motors'
                ? 'bg-[#0B1F3A] text-white shadow-xs dark:bg-blue-600'
                : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Data Motor ({motors.length})
          </button>
          {isSuperAdmin && (
            <button
              type="button"
              onClick={() => setActiveTab('users')}
              className={`min-h-[40px] rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'users'
                  ? 'bg-[#0B1F3A] text-white shadow-xs dark:bg-blue-600'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Pengguna Admin ({users.length})
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div
          className={`mt-5 rounded-xl border px-4 py-3 text-sm font-medium ${
            feedback.type === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-200'
              : 'border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* TAB: DATABASE ANGSURAN OTOMATIS */}
      {activeTab === 'auto_db' && (
        <AutoInstallmentAdmin
          token={token}
          currentUser={currentUser}
          initialImportCategory={initialAutoImportCategory}
          onDatabaseChanged={onDataChanged}
          onOpenCalculator={onOpenCalculator}
        />
      )}

      {/* TAB 1: DATA ANGSURAN & PROMO */}
      {activeTab === 'installments' && (
        <div className="mt-6 space-y-5">
          {/* Action Toolbar */}
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  if (motors.length > 0 && !batchMotorId) setBatchMotorId(motors[0].id);
                  setBatchModalOpen(true);
                }}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#14325C] dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <Plus className="h-4 w-4" />
                Tambah DP & Angsuran
              </button>

              <button
                type="button"
                onClick={() => {
                  setImportErrors([]);
                  setImportModalOpen(true);
                }}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Upload className="h-4 w-4 text-blue-700 dark:text-blue-400" />
                Import Excel / CSV
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleExport('xlsx')}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <FileSpreadsheet className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                Export Excel
              </button>
              <button
                type="button"
                onClick={() => handleExport('csv')}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <Download className="h-4 w-4 text-blue-700 dark:text-blue-400" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Search & Filters */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="relative sm:col-span-6">
              <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari tipe motor, promo, atau nominal DP (misal: Aerox atau 4000000)..."
                className="h-11 w-full rounded-xl border border-slate-300 bg-white pr-4 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-700/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-blue-500"
              />
            </div>

            <div className="sm:col-span-3">
              <select
                value={filterMotorId}
                onChange={(e) => setFilterMotorId(e.target.value)}
                aria-label="Filter berdasarkan motor"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
              >
                <option value="">Semua Tipe Motor</option>
                {motors.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.motor_name} · {m.variant}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-3">
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as 'all' | 'active' | 'inactive')}
                aria-label="Filter status paket"
                className="h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-800 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
              >
                <option value="all">Semua Status</option>
                <option value="active">Aktif</option>
                <option value="inactive">Nonaktif</option>
              </select>
            </div>
          </div>

          {/* Data Display: Mobile Cards + Desktop Table */}
          {loadingData ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-14 text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin text-blue-700 dark:text-blue-400" />
              <span className="text-sm font-medium">Memuat data angsuran...</span>
            </div>
          ) : packages.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Tidak ada data angsuran ditemukan</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Ubah kata kunci pencarian atau tambahkan paket DP dan angsuran baru.
              </p>
            </div>
          ) : (
            <>
              {/* Mobile-Friendly Card View (Android / HP) */}
              <div className="space-y-3 md:hidden">
                {packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs dark:border-slate-800 dark:bg-slate-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-[#0B1F3A] dark:text-white">
                          {pkg.motor_name} · {pkg.variant}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {pkg.promo_name} · {pkg.effective_date}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleTogglePackageStatus(pkg)}
                        className={`min-h-[34px] rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                          pkg.status === 'active'
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {pkg.status === 'active' ? 'Aktif' : 'Nonaktif'}
                      </button>
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">DP</p>
                        <p className="font-mono text-xs font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                          {formatRupiah(pkg.dp_amount)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Tenor</p>
                        <p className="font-mono text-xs font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                          {pkg.tenor_months} Bulan
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Angsuran</p>
                        <p className="font-mono text-xs font-bold text-blue-800 tabular-nums dark:text-blue-400">
                          {formatRupiah(pkg.installment_amount)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => openEditPackage(pkg)}
                        className="flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmDelete({
                            type: 'package',
                            id: pkg.id,
                            title: 'Hapus Paket Angsuran?',
                            description: `Hapus angsuran ${pkg.motor_name} (${pkg.variant}) DP ${formatRupiah(
                              pkg.dp_amount
                            )} tenor ${pkg.tenor_months} bulan?`,
                          })
                        }
                        className="flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-xs font-semibold text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Hapus
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Data Table */}
              <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white md:block dark:border-slate-800 dark:bg-slate-900">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3">Motor & Varian</th>
                        <th className="px-4 py-3 text-right">DP</th>
                        <th className="px-4 py-3 text-right">Tenor</th>
                        <th className="px-4 py-3 text-right">Angsuran / Bln</th>
                        <th className="px-4 py-3">Promo</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {packages.map((pkg) => (
                        <tr key={pkg.id} className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-900 dark:text-white">{pkg.motor_name}</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{pkg.variant}</p>
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs font-semibold text-slate-800 tabular-nums dark:text-slate-200">
                            {formatRupiah(pkg.dp_amount)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-xs font-medium text-slate-700 tabular-nums dark:text-slate-300">
                            {pkg.tenor_months} bln
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-sm font-bold text-[#0B1F3A] tabular-nums dark:text-blue-400">
                            {formatRupiah(pkg.installment_amount)}
                          </td>
                          <td className="px-4 py-3">
                            <p className="text-xs font-medium text-slate-800 dark:text-slate-200">{pkg.promo_name}</p>
                            <p className="font-mono text-[11px] text-slate-500 tabular-nums dark:text-slate-400">
                              {pkg.effective_date}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => handleTogglePackageStatus(pkg)}
                              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors ${
                                pkg.status === 'active'
                                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300 dark:hover:bg-emerald-950/80'
                                  : 'border-slate-200 bg-slate-100 text-slate-600 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700'
                              }`}
                            >
                              {pkg.status === 'active' ? 'Aktif' : 'Nonaktif'}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditPackage(pkg)}
                                className="rounded-lg border border-slate-200 p-2 text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
                                title="Edit paket angsuran"
                              >
                                <Edit3 className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmDelete({
                                    type: 'package',
                                    id: pkg.id,
                                    title: 'Hapus Paket Angsuran?',
                                    description: `Hapus angsuran ${pkg.motor_name} (${pkg.variant}) DP ${formatRupiah(
                                      pkg.dp_amount
                                    )} tenor ${pkg.tenor_months} bulan?`,
                                  })
                                }
                                className="rounded-lg border border-red-200 p-2 text-red-600 transition-colors hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/40"
                                title="Hapus paket angsuran"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* TAB 2: DATA MOTOR */}
      {activeTab === 'motors' && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
            <div>
              <h2 className="text-base font-bold text-[#0B1F3A] dark:text-white">Daftar Tipe & Varian Motor Yamaha</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isSuperAdmin
                  ? 'Super Admin dapat menambah, mengubah varian, atau menonaktifkan unit motor.'
                  : 'Mode baca saja untuk Admin. Hubungi Super Admin untuk menambah atau menghapus unit motor.'}
              </p>
            </div>
            {isSuperAdmin && (
              <button
                type="button"
                onClick={openCreateMotor}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#14325C] dark:bg-blue-600 dark:hover:bg-blue-500"
              >
                <Plus className="h-4 w-4" />
                Tambah Data Motor
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {motors.map((motor) => (
              <div
                key={motor.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-[#0B1F3A] dark:bg-slate-800 dark:text-blue-400">
                        <Bike className="h-5 w-5" />
                      </div>
                      <div>
                        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{motor.brand}</p>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">{motor.motor_name}</h3>
                        <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Varian: {motor.variant}</p>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        motor.is_active ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {motor.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <p className="mt-4 text-xs text-slate-500 tabular-nums dark:text-slate-400">
                    Paket aktif: {motor.active_packages_count ?? 0} tenor
                  </p>
                </div>

                {isSuperAdmin && (
                  <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={() => openEditMotor(motor)}
                      className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit Motor
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDelete({
                          type: 'motor',
                          id: motor.id,
                          title: 'Hapus Data Motor?',
                          description: `Menghapus "${motor.motor_name} (${motor.variant})" akan ikut menghapus semua paket angsuran yang terhubung dengannya.`,
                        })
                      }
                      className="flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 3: PENGGUNA ADMIN (SUPER ADMIN ONLY) */}
      {activeTab === 'users' && isSuperAdmin && (
        <div className="mt-6 space-y-5">
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-[#0B1F3A] dark:text-blue-400" />
              <div>
                <h2 className="text-base font-bold text-[#0B1F3A] dark:text-white">Manajemen Pengguna & Hak Akses</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Atur akun Super Admin, Admin Angsuran, dan Sales Dealer.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={openCreateUser}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#0B1F3A] px-4 py-2 text-sm font-semibold text-white hover:bg-[#14325C] dark:bg-blue-600 dark:hover:bg-blue-500"
            >
              <Plus className="h-4 w-4" />
              Tambah Pengguna
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">{u.name}</h3>
                      <p className="font-mono text-xs text-slate-500 dark:text-slate-400">@{u.username}</p>
                    </div>
                    <span
                      className={`text-xs font-semibold ${
                        u.is_active ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                      }`}
                    >
                      {u.is_active ? 'Aktif' : 'Nonaktif'}
                    </span>
                  </div>
                  <p className="mt-3 text-xs font-semibold text-blue-700 dark:text-blue-400">
                    Role:{' '}
                    {u.role === 'super_admin'
                      ? 'Super Admin'
                      : u.role === 'admin'
                      ? 'Admin'
                      : 'Sales'}
                  </p>
                </div>

                <div className="mt-4 flex gap-2 border-t border-slate-100 pt-4 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => openEditUser(u)}
                    className="flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  {u.id !== currentUser.id && (
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmDelete({
                          type: 'user',
                          id: u.id,
                          title: 'Hapus Pengguna?',
                          description: `Yakin ingin menghapus akun "${u.name}" (@${u.username})?`,
                        })
                      }
                      className="flex min-h-[40px] items-center justify-center rounded-xl border border-red-200 bg-red-50 px-3 text-xs font-semibold text-red-700 hover:bg-red-100 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 dark:hover:bg-red-950/70"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL: TAMBAH DP & ANGSURAN 5 TENOR */}
      {batchModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="my-8 w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                Tambah DP & Paket Angsuran
              </h3>
              <button
                type="button"
                onClick={() => setBatchModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBatch} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Pilih Motor & Varian
                </label>
                <select
                  value={batchMotorId}
                  onChange={(e) => setBatchMotorId(Number(e.target.value))}
                  required
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
                >
                  {motors.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.motor_name} · {m.variant}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Nominal DP (Rupiah)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={batchDpInput}
                    onChange={(e) => setBatchDpInput(formatRupiahInput(e.target.value))}
                    placeholder="Contoh: Rp4.000.000"
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm font-semibold text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Nama Promo</label>
                  <input
                    type="text"
                    value={batchPromoName}
                    onChange={(e) => setBatchPromoName(e.target.value)}
                    placeholder="Promo Khusus Yamaha"
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Tanggal Berlaku
                  </label>
                  <input
                    type="date"
                    value={batchEffectiveDate}
                    onChange={(e) => setBatchEffectiveDate(e.target.value)}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Status</label>
                  <select
                    value={batchStatus}
                    onChange={(e) => setBatchStatus(e.target.value as 'active' | 'inactive')}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
                  >
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 dark:border-slate-800">
                <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  Input Angsuran per Tenor (kosongkan jika tenor tidak tersedia)
                </p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {TENOR_OPTIONS.map((t) => (
                    <div key={t}>
                      <label className="block text-xs text-slate-600 dark:text-slate-400">Angsuran {t} Bulan</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={batchTenors[t]}
                        onChange={(e) =>
                          setBatchTenors((prev) => ({
                            ...prev,
                            [t]: formatRupiahInput(e.target.value),
                          }))
                        }
                        placeholder="Rp0"
                        className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm font-semibold text-slate-900 tabular-nums focus:border-blue-700 focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:border-blue-500"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setBatchModalOpen(false)}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingBatch}
                  className="min-h-[44px] rounded-xl bg-[#0B1F3A] px-5 py-2 text-sm font-semibold text-white hover:bg-[#14325C] disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {savingBatch ? 'Menyimpan...' : 'Simpan ke Database'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: EDIT SINGLE PACKAGE */}
      {editingPackage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div>
                <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">Edit Angsuran</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {editingPackage.motor_name} · {editingPackage.variant}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingPackage(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveEditPackage} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Nominal DP</label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={editPkgDp}
                  onChange={(e) => setEditPkgDp(formatRupiahInput(e.target.value))}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Tenor</label>
                  <select
                    value={editPkgTenor}
                    onChange={(e) => setEditPkgTenor(Number(e.target.value) as TenorMonths)}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    {Array.from(new Set([...TENOR_OPTIONS, editPkgTenor]))
                      .sort((a, b) => a - b)
                      .map((t) => (
                        <option key={t} value={t}>
                          {t} Bulan
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Status</label>
                  <select
                    value={editPkgStatus}
                    onChange={(e) => setEditPkgStatus(e.target.value as 'active' | 'inactive')}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  >
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nominal Angsuran per Bulan
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={editPkgInstallment}
                  onChange={(e) => setEditPkgInstallment(formatRupiahInput(e.target.value))}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm font-semibold text-slate-900 tabular-nums dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Nama Promo</label>
                  <input
                    type="text"
                    value={editPkgPromo}
                    onChange={(e) => setEditPkgPromo(e.target.value)}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Tanggal Berlaku</label>
                  <input
                    type="date"
                    value={editPkgDate}
                    onChange={(e) => setEditPkgDate(e.target.value)}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingPackage(null)}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingEditPkg}
                  className="min-h-[44px] rounded-xl bg-[#0B1F3A] px-5 py-2 text-sm font-semibold text-white hover:bg-[#14325C] dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {savingEditPkg ? 'Menyimpan...' : 'Simpan Perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: IMPORT EXCEL / CSV */}
      {importModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                Import Data Angsuran (Excel / CSV)
              </h3>
              <button
                type="button"
                onClick={() => setImportModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitImport} className="mt-4 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400">
                <p className="font-semibold text-slate-800 dark:text-slate-200">Format Kolom yang Didukung:</p>
                <p className="mt-1 font-mono text-[11px]">
                  motor_name, variant, dp_amount, tenor_11, tenor_17, tenor_23, tenor_29, tenor_33,
                  promo_name, effective_date, status
                </p>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="mt-2.5 inline-flex items-center gap-1.5 font-semibold text-blue-700 hover:underline dark:text-blue-400"
                >
                  <Download className="h-3.5 w-3.5" />
                  Unduh Template Excel (.xlsx)
                </button>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Pilih File (.xlsx atau .csv)
                </label>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleImportFileChange}
                  className="mt-1.5 block w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-[#0B1F3A] file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:file:bg-blue-600"
                />
                {importFileName && (
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">File dipilih: {importFileName}</p>
                )}
              </div>

              {importErrors.length > 0 && (
                <div className="max-h-36 overflow-y-auto rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200">
                  <p className="font-semibold">Catatan Validasi Baris:</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {importErrors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setImportModalOpen(false)}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Tutup
                </button>
                <button
                  type="submit"
                  disabled={importing || !importBase64}
                  className="min-h-[44px] rounded-xl bg-blue-700 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {importing ? 'Mengimpor...' : 'Mulai Import'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: MOTOR FORM (SUPER ADMIN) */}
      {motorModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                {editingMotor ? 'Edit Data Motor' : 'Tambah Data Motor Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setMotorModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMotor} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Merek</label>
                <input
                  type="text"
                  value={motorBrand}
                  onChange={(e) => setMotorBrand(e.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Tipe Motor</label>
                <input
                  type="text"
                  required
                  value={motorName}
                  onChange={(e) => setMotorName(e.target.value)}
                  placeholder="Contoh: Yamaha Lexi LX 155"
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Varian Motor</label>
                <input
                  type="text"
                  required
                  value={motorVariant}
                  onChange={(e) => setMotorVariant(e.target.value)}
                  placeholder="Contoh: Standard / S Version / ABS"
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Gambar Unit</label>
                <select
                  value={motorImageUrl}
                  onChange={(e) => setMotorImageUrl(e.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  {PRESET_MOTOR_IMAGES.map((img) => (
                    <option key={img.url} value={img.url}>
                      {img.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={motorActive}
                  onChange={(e) => setMotorActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700 dark:border-slate-600 dark:bg-slate-950"
                />
                Tampilkan unit ini di halaman Home & Kalkulator
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setMotorModalOpen(false)}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingMotor}
                  className="min-h-[44px] rounded-xl bg-[#0B1F3A] px-5 py-2 text-sm font-semibold text-white hover:bg-[#14325C] dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {savingMotor ? 'Menyimpan...' : 'Simpan Motor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: USER FORM (SUPER ADMIN) */}
      {userModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <h3 className="font-display text-lg font-bold text-[#0B1F3A] dark:text-white">
                {editingUser ? 'Edit Pengguna' : 'Tambah Pengguna Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setUserModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Nama Lengkap</label>
                <input
                  type="text"
                  required
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              {!editingUser && (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Username</label>
                  <input
                    type="text"
                    required
                    value={userUsername}
                    onChange={(e) => setUserUsername(e.target.value)}
                    className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 font-mono text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  {editingUser ? 'Password Baru (kosongkan jika tidak diubah)' : 'Password (min. 6 karakter)'}
                </label>
                <input
                  type="password"
                  required={!editingUser}
                  value={userPassword}
                  onChange={(e) => setUserPassword(e.target.value)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Hak Akses (Role)</label>
                <select
                  value={userRole}
                  onChange={(e) => setUserRole(e.target.value as UserRole)}
                  className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                >
                  <option value="super_admin">Super Admin</option>
                  <option value="admin">Admin</option>
                  <option value="sales">Sales</option>
                </select>
              </div>
              <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={userActive}
                  onChange={(e) => setUserActive(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-700 dark:border-slate-600 dark:bg-slate-950"
                />
                Akun Aktif
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setUserModalOpen(false)}
                  className="min-h-[44px] rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingUser}
                  className="min-h-[44px] rounded-xl bg-[#0B1F3A] px-5 py-2 text-sm font-semibold text-white hover:bg-[#14325C] dark:bg-blue-600 dark:hover:bg-blue-500"
                >
                  {savingUser ? 'Menyimpan...' : 'Simpan Pengguna'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CONFIRM DELETE MODAL */}
      <ConfirmModal
        open={Boolean(confirmDelete)}
        title={confirmDelete?.title || ''}
        description={confirmDelete?.description || ''}
        confirmLabel="Ya, Hapus"
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </section>
  );
}
