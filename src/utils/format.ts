import { InstallmentPackage, MotorProduct } from '../types';

export function formatRupiah(amount: number): string {
  return `Rp${new Intl.NumberFormat('id-ID').format(Math.round(amount))}`;
}

export function formatRupiahInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const num = Number(digits);
  return `Rp${new Intl.NumberFormat('id-ID').format(num)}`;
}

export function parseRupiahInput(raw: string): number {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return 0;
  return Number(digits);
}

export function buildWhatsAppMessage(params: {
  motor: MotorProduct;
  dpAmount: number;
  selectedTenor: number;
  packagesByTenor: Record<number, InstallmentPackage | null>;
  availableTenors?: number[];
}): string {
  const { motor, dpAmount, packagesByTenor, availableTenors } = params;
  const motorDisplay =
    motor.variant && motor.variant.toLowerCase() !== 'standard'
      ? `${motor.motor_name} (${motor.variant})`
      : motor.motor_name;

  const tenorsToList =
    availableTenors && availableTenors.length > 0
      ? [...availableTenors].sort((a, b) => a - b)
      : Object.keys(packagesByTenor)
          .map(Number)
          .filter((t) => packagesByTenor[t] !== null)
          .sort((a, b) => a - b);

  const tenorLines = tenorsToList.map((tenor) => {
    const pkg = packagesByTenor[tenor];
    const valueText = pkg ? formatRupiah(pkg.installment_amount) : 'Belum tersedia';
    return `${tenor} Bulan: ${valueText}`;
  });

  return [
    'PROMO KHUSUS YAMAHA',
    'Berikut simulasi angsuran motor Anda:',
    `Motor: ${motorDisplay}`,
    `DP: ${formatRupiah(dpAmount)}`,
    'Pilihan angsuran:',
    ...tenorLines,
    'Silakan pilih tenor yang paling sesuai.',
    'Hubungi sales Yamaha untuk informasi dan proses pengajuan kredit.',
    'Yamaha Thamrin Gunung Ibul Prabumulih.',
  ].join('\n');
}

export function normalizeWhatsAppPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('0')) return `62${digits.slice(1)}`;
  if (digits.startsWith('62')) return digits;
  return `62${digits}`;
}

export function buildWhatsAppShareUrl(message: string, phoneNumber?: string): string {
  const normalizedPhone = phoneNumber ? normalizeWhatsAppPhone(phoneNumber) : '';
  const encodedText = encodeURIComponent(message);
  return normalizedPhone
    ? `https://wa.me/${normalizedPhone}?text=${encodedText}`
    : `https://wa.me/?text=${encodedText}`;
}
