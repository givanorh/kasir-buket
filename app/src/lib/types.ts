// Model data Kasir Buket. Semua koleksi disinkronkan; nilai uang dalam Rupiah (bilangan bulat).
export type Role = 'owner' | 'kasir' | 'perangkai';

export interface Base {
  id: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  deleted?: boolean;
}

export interface Outlet extends Base { name: string; address?: string; phone?: string; code?: string; active?: boolean }
export interface Staff extends Base { name: string; username: string; role: Role; active: boolean; outlet_id?: string | null }
export interface Device extends Base { code: string; name?: string; user_id?: string; outlet_id?: string; last_seen?: string }

export interface ExpenseCategory { name: string; biaya: boolean }
export interface Settings extends Base {
  store_name: string;
  address?: string;
  phone?: string;
  instagram?: string;
  receipt_footer?: string;
  payment_methods: string[];
  expense_categories: ExpenseCategory[];
  daily_capacity?: number; // kapasitas buket per hari (0 = tidak dibatasi)
  dp_min_percent?: number;
}

export interface Category extends Base { name: string; sort?: number }

export type ProductType = 'buket' | 'addon' | 'jasa' | 'bahan';
export interface Product extends Base {
  name: string;
  sku?: string;
  category_id?: string;
  type: ProductType;
  price: number; // harga jual
  cost: number; // HPP (harga pokok) per unit
  track_stock?: boolean;
  min_stock?: number;
  photo?: string; // data URL JPEG kecil
  description?: string;
  active?: boolean;
}

export interface Customer extends Base { name: string; phone?: string; address?: string; note?: string }

export interface OrderItem {
  product_id?: string;
  name: string;
  sku?: string;
  qty: number;
  price: number;
  cost: number;
  discount: number; // potongan per baris (Rp)
  note?: string;
  type?: ProductType;
}

export type Fulfillment = 'sekarang' | 'ambil' | 'antar';
export type ProductionStatus = 'antri' | 'dirangkai' | 'siap' | 'selesai' | 'batal';

export interface Order extends Base {
  no: string;
  outlet_id: string;
  device_id?: string;
  cashier_id?: string;
  cashier_name?: string;
  shift_id?: string | null;
  customer_id?: string | null;
  customer_name?: string;
  customer_phone?: string;
  items: OrderItem[];
  subtotal: number; // Σ qty × harga
  item_discount: number; // Σ potongan baris
  order_discount: number; // potongan transaksi
  extra_fee: number; // ongkir/biaya tambahan
  total: number; // subtotal − item_discount − order_discount + extra_fee
  cost_total: number; // Σ qty × HPP
  cash_received?: number;
  change?: number;
  fulfillment: Fulfillment;
  due_at?: string | null; // jadwal ambil/antar (ISO)
  recipient_name?: string;
  recipient_phone?: string;
  delivery_address?: string;
  card_message?: string; // kartu ucapan
  notes?: string; // catatan rangkaian
  production_status: ProductionStatus;
  production_note?: string;
  assigned_to?: string | null;
  production_at?: string;
  ready_at?: string;
  done_at?: string;
  void?: boolean;
  void_reason?: string;
  void_at?: string;
  source?: 'app' | 'kasirpintar';
}

export interface Payment extends Base {
  order_id: string;
  outlet_id: string;
  method: string;
  amount: number;
  kind: 'lunas' | 'dp' | 'pelunasan';
  shift_id?: string | null;
  user_id?: string;
  void?: boolean;
}

export interface StockMove extends Base {
  product_id: string;
  outlet_id: string;
  qty: number; // + masuk, − keluar
  reason: 'penjualan' | 'batal' | 'stok_masuk' | 'opname' | 'rusak' | 'impor';
  ref_id?: string;
  note?: string;
}

export interface Shift extends Base {
  outlet_id: string;
  device_id: string;
  user_id: string;
  user_name?: string;
  opened_at: string;
  opening_cash: number;
  closed_at?: string | null;
  expected_cash?: number;
  actual_cash?: number;
  note?: string;
}

export interface CashMove extends Base {
  outlet_id: string;
  shift_id?: string | null;
  type: 'masuk' | 'keluar';
  category: string;
  biaya: boolean; // dihitung sebagai beban di laba rugi
  method: string; // Tunai = memengaruhi laci kas
  amount: number;
  note?: string;
  user_id?: string;
}

export type PrintTarget = 'kasir' | 'produksi';
export interface PrintJob extends Base {
  target: PrintTarget;
  order_id: string;
  kind: 'struk' | 'tiket';
  status: 'pending' | 'printing' | 'done' | 'error';
  from_device?: string;
  printed_by?: string;
  printed_at?: string;
  error?: string;
}

export type Collection =
  | 'outlets' | 'staff' | 'devices' | 'settings' | 'categories' | 'products' | 'customers'
  | 'orders' | 'payments' | 'stock_moves' | 'shifts' | 'cash_moves' | 'print_jobs';

export const COLLECTIONS: Collection[] = [
  'outlets', 'staff', 'devices', 'settings', 'categories', 'products', 'customers',
  'orders', 'payments', 'stock_moves', 'shifts', 'cash_moves', 'print_jobs',
];
