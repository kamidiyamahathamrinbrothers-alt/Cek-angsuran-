export type UserRole = 'super_admin' | 'admin' | 'sales';

export type TenorMonths = number;

export const TENOR_OPTIONS: number[] = [11, 17, 23, 29, 33];

export interface AuthUser {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  is_active: boolean;
  created_at?: string;
}

export interface MotorProduct {
  id: number;
  brand: string;
  motor_name: string;
  variant: string;
  image_url: string;
  stock_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  min_dp?: number | null;
  min_installment?: number | null;
  active_packages_count?: number;
}

export interface InstallmentPackage {
  id: number;
  motor_id: number;
  dp_amount: number;
  tenor_months: number;
  installment_amount: number;
  promo_name: string;
  effective_date: string;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
  motor_name?: string;
  variant?: string;
  brand?: string;
  image_url?: string;
}

export interface InstallmentLookupResponse {
  motor: MotorProduct;
  requested_dp: number;
  requested_tenor: number;
  exact_dp_available: boolean;
  available_dps: number[];
  nearest_dps: number[];
  available_tenors: number[];
  packages: InstallmentPackage[];
  packages_by_tenor: Record<number, InstallmentPackage | null>;
  selected_package: InstallmentPackage | null;
  message: string | null;
}

export interface AdminUserRecord {
  id: number;
  name: string;
  username: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type UploadedFileType = 'excel' | 'sheets' | 'pdf';

export interface UploadedDocument {
  id: number;
  title: string;
  original_filename: string;
  file_type: UploadedFileType;
  mime_type: string;
  file_size: number;
  stored_filename: string;
  sheets_url: string;
  category: string;
  uploader_name: string;
  notes: string;
  row_count: number;
  created_at: string;
}

export interface SpreadsheetPreview {
  sheet_name: string;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  total_rows: number;
}

export interface SpreadsheetInstallmentDataset {
  document: UploadedDocument;
  motors: MotorProduct[];
  packages: InstallmentPackage[];
}

export type AutoImportSourceType =
  | 'excel'
  | 'csv'
  | 'google_sheets'
  | 'pdf'
  | 'manual_edit'
  | 'rollback';

export type AutoImportMode = 'upsert' | 'skip_existing' | 'replace_source';

export type AutoInstallmentCategory = 'promo' | 'reguler';

export interface AutoInstallmentRecord {
  id: number;
  motor_name: string;
  variant: string;
  dp_amount: number;
  tenor_months: number;
  installment_amount: number;
  leasing_name: string;
  branch: string;
  effective_date: string;
  is_active: boolean;
  source_file: string;
  category?: AutoInstallmentCategory;
  batch_id: number | null;
  created_at: string;
  updated_at: string;
  image_url?: string;
}

export interface AutoImportBatch {
  id: number;
  source_type: AutoImportSourceType;
  source_name: string;
  category?: AutoInstallmentCategory;
  leasing_default: string;
  branch_default: string;
  effective_date: string;
  import_mode: string;
  total_rows: number;
  inserted_count: number;
  updated_count: number;
  skipped_duplicates: number;
  status: 'completed' | 'rolled_back';
  uploaded_by_name: string;
  notes: string;
  created_at: string;
}

export interface AutoChangeLog {
  id: number;
  batch_id: number | null;
  action: string;
  actor_name: string;
  details: string;
  created_at: string;
}

export interface AutoColumnMapping {
  motor_name: string;
  variant: string;
  dp_amount: string;
  tenor_months: string;
  installment_amount: string;
  leasing_name: string;
  branch: string;
  effective_date: string;
  is_active: string;
  wide_tenor_columns: Record<string, number>;
}

export interface ParsedAutoSourceResponse {
  source_type: 'excel' | 'csv' | 'google_sheets' | 'pdf';
  source_name: string;
  sheet_names: string[];
  active_sheet: string;
  sheet_stats?: Array<{ sheet_name: string; row_count: number }>;
  headers: string[];
  rows: Array<Record<string, unknown>>;
  suggested_mapping: AutoColumnMapping;
  extraction_method?: string;
}

export interface ValidatedAutoRowPreview {
  row_index: number;
  motor_name: string;
  variant: string;
  dp_amount: number;
  tenor_months: number;
  installment_amount: number;
  leasing_name: string;
  branch: string;
  effective_date: string;
  is_active: boolean;
  category?: AutoInstallmentCategory;
  status: 'new' | 'update' | 'duplicate_in_file' | 'invalid';
  reason?: string;
}

export interface AutoValidationSummary {
  total_normalized: number;
  new_count: number;
  update_count: number;
  duplicate_in_file_count: number;
  invalid_count: number;
  rows: ValidatedAutoRowPreview[];
}

export interface AutoSearchMotorOption {
  motor_name: string;
  variants: string[];
  image_url: string;
  dps: number[];
  tenors: number[];
  leasings: string[];
  branches: string[];
  dp_tenors?: Record<number, number[]>;
}

export interface AutoDiscountRule {
  id: number;
  motor_name: string;
  branch: string;
  discount_type: 'percent' | 'nominal';
  discount_percent: number;
  discount_amount: number;
  min_dp: number;
  tenor_months: number;
  promo_title: string;
  source_pdf_id: number | null;
  source_file: string;
  effective_date: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MatchedDiscountInfo {
  id: number;
  motor_name: string;
  branch: string;
  discount_type: 'percent' | 'nominal';
  discount_percent: number;
  discount_amount: number;
  promo_title: string;
  source_file: string;
  effective_date: string;
}

export interface AutoSearchResponse {
  found: boolean;
  message: string | null;
  category?: AutoInstallmentCategory;
  motor_name: string;
  variant: string;
  dp_amount: number;
  tenor_months: number;
  leasing_name: string;
  branch: string;
  image_url: string;
  matched_record: AutoInstallmentRecord | null;
  matched_discount: MatchedDiscountInfo | null;
  all_matching_leasings: AutoInstallmentRecord[];
  related_tenors: AutoInstallmentRecord[];
  available_dps?: number[];
  nearest_dps?: number[];
  available_tenors_for_dp?: number[];
  fallback_note?: string | null;
}

