import type { City } from './sim.ts';

export type FlowKind = 'money' | 'goods';
export type FlowRow = {
  /** Original zero-based journal index, preserved even when displayed newest first. */
  index: number;
  kind: FlowKind;
  tick: number;
  reason: string;
  from: string;
  to: string;
  /** Integer satang for money; integer units for goods. */
  value: number;
  label: string;
  fromLabel: string;
  toLabel: string;
};
export type WalletAccount = { id: string; label: string; balance: number };
export type WalletGroupKey = 'city' | 'households' | 'firms' | 'outside' | 'system';
export type WalletGroup = {
  key: WalletGroupKey;
  label: string;
  description: string;
  /** Signed sum in integer satang, without hiding zero balances. */
  total: number;
  accounts: WalletAccount[];
};

const accountLabels: Record<string, string> = {
  treasury: 'คลังเมือง',
  outside: 'คู่สัญญาภายนอก',
  construction: 'บัญชีก่อสร้าง',
  roadworks: 'บัญชีสร้างถนน',
  upkeep: 'บัญชีบำรุงรักษา',
  landlord: 'บัญชีผู้ให้เช่า',
  production: 'แหล่งผลิตสินค้า',
};

function accountLabel(id: string): string {
  if (Object.hasOwn(accountLabels, id)) return accountLabels[id];
  if (id.startsWith('household:')) return `ครัวเรือน #${id.slice('household:'.length)}`;
  if (id.startsWith('firm:')) return `บริษัท #${id.slice('firm:'.length)}`;
  return `บัญชี ${id}`;
}

const reasonLabels: Record<string, string> = {
  'Initial municipal grant': 'เงินตั้งต้นให้เมืองจากภายนอก',
  'Demolition': 'ค่ารื้อถอน',
  'Emigration savings': 'เงินติดตัวครัวเรือนที่ย้ายออก',
  'Firm liquidation': 'คืนเงินเมื่อเลิกกิจการจากการรื้อถอน',
  'Outside residential developer investment': 'เงินลงทุนสร้างบ้านจากภายนอก',
  'New household arrival savings': 'เงินติดตัวครัวเรือนที่ย้ายเข้า',
  'Outside firm equity investment': 'เงินทุนบริษัทจากภายนอก',
  'Firm building investment': 'เงินลงทุนสร้างอาคารบริษัท',
  'Local wholesale goods': 'ซื้อสินค้าขายส่งในเมือง',
  'Outside goods import': 'นำเข้าสินค้าจากภายนอก',
  'Outside market goods export': 'รายรับจากการส่งออกสินค้า',
  'Monthly wages': 'จ่ายค่าจ้างตามวันทำงานจริง',
  'Monthly household wage tax': 'ภาษีจากค่าจ้างครัวเรือน',
  'Monthly firm rent': 'ค่าเช่าของบริษัทประจำเดือน',
  'Monthly firm profit tax': 'ภาษีจากกำไรบริษัท',
  'Monthly household rent': 'ค่าเช่าของครัวเรือนประจำเดือน',
  'Outside residential height investment': 'เงินลงทุนเพิ่มชั้นบ้านจากภายนอก',
  'Profitable firm height investment': 'เงินลงทุนเพิ่มชั้นอาคารบริษัท',
  'Daily road upkeep': 'ค่าบำรุงถนนประจำวัน',
  'Daily worker production': 'สินค้าที่คนงานผลิต',
  'Wholesale stock delivery': 'ส่งสินค้าขายส่งเข้าร้าน',
  'Imported shop stock': 'สินค้านำเข้าเพื่อเติมร้าน',
  'Household final consumption': 'สินค้าที่ครัวเรือนซื้อไปบริโภค',
  'Exported goods': 'สินค้าที่ส่งออกไปภายนอก',
  'Demolition stock write-off to outside': 'ตัดสต็อกออกเมื่อรื้อถอน (ไม่มีรายรับ)',
};

function reasonLabel(reason: string): string {
  if (Object.hasOwn(reasonLabels, reason)) return reasonLabels[reason];
  const road = /^Build (\d+) road cells$/.exec(reason);
  if (road) return `สร้างถนน ${road[1]} ช่อง`;
  const purchase = /^Household #(\d+) purchase$/.exec(reason);
  if (purchase) return `ครัวเรือน #${purchase[1]} ซื้อสินค้า`;
  return `รายการอื่น: ${reason}`;
}

/** Presentation only: no filtering, truncation, journal sorting or simulation mutation. */
export function flowRows(city: City, kind: FlowKind): FlowRow[] {
  const entries = kind === 'money' ? city.ledger : city.goodsLedger;
  return entries.map((entry, index): FlowRow => ({
    index,
    kind,
    tick: entry.tick,
    reason: entry.reason,
    from: entry.from,
    to: entry.to,
    value: 'amount' in entry ? entry.amount : entry.quantity,
    label: reasonLabel(entry.reason),
    fromLabel: accountLabel(entry.from),
    toLabel: accountLabel(entry.to),
  })).reverse();
}

/** Every source account appears exactly once, including historical and unknown IDs. */
export function walletGroups(city: City): WalletGroup[] {
  const groups: WalletGroup[] = [
    { key: 'city', label: 'คลังเมือง', description: 'เงินคลังสำหรับการลงทุนและรายจ่ายของเมือง', total: 0, accounts: [] },
    { key: 'households', label: 'ครัวเรือน', description: 'กระเป๋าเงินทุกบัญชีของครัวเรือน รวมบัญชีเดิมที่ยังอยู่ในประวัติ', total: 0, accounts: [] },
    { key: 'firms', label: 'บริษัท', description: 'กระเป๋าเงินทุกบัญชีของบริษัท อาจรวมค่าจ้างที่สำรองไว้ จึงไม่ใช่เงินพร้อมใช้ทั้งหมด', total: 0, accounts: [] },
    { key: 'outside', label: 'คู่สัญญาภายนอก', description: 'บัญชีคู่สัญญาแบบมีเครื่องหมายสำหรับเงินเข้าและออก ยอดติดลบไม่ใช่หนี้เมืองหรือเงินสดที่ใช้จ่ายได้', total: 0, accounts: [] },
    { key: 'system', label: 'บัญชีระบบและบัญชีอื่น', description: 'บัญชีก่อสร้าง ถนน บำรุงรักษา ผู้ให้เช่า และชื่อบัญชีอื่น โดยคงยอดตามข้อมูลจริง', total: 0, accounts: [] },
  ];
  const byKey = new Map(groups.map(group => [group.key, group]));
  for (const [id, balance] of Object.entries(city.accounts)) {
    const key: WalletGroupKey = id === 'treasury' ? 'city' : id === 'outside' ? 'outside' : id.startsWith('household:') ? 'households' : id.startsWith('firm:') ? 'firms' : 'system';
    const group = byKey.get(key)!;
    group.accounts.push({ id, label: accountLabel(id), balance });
    group.total += balance;
  }
  return groups;
}

const wholeMoneyFormatter = new Intl.NumberFormat('th-TH', { useGrouping: true, maximumFractionDigits: 0 });

/** Exact satang formatting avoids floating-point rounding at large safe integers. */
export function formatMoney(raw: number, signed = false): string {
  if (!Number.isSafeInteger(raw)) throw new RangeError('Money must be integer satang within the safe integer range.');
  const value = BigInt(raw), absolute = value < 0n ? -value : value;
  const sign = value < 0n ? '-' : signed && value > 0n ? '+' : '';
  return `${sign}${wholeMoneyFormatter.format(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`;
}
