// netlify/functions/_payroll.ts
//
// 給与計算ロジックの共通関数。
// 計算式は app/home.html の給与画面（オーナー用）と完全に一致させること
// （二重実装によるズレを防ぐため、スタッフ向けの給与明細はこの関数を必ず経由する）。
//
// 計算式：
//   勤務時間 = Σ(clock_out - clock_in)（時間単位）
//   基本給 = 勤務時間 × 時給
//   バック合計 = 対象期間の back_records.amount の合計
//   日払い合計 = 対象期間の daily_payments.amount の合計（前払い分として最終支給額から差し引く）
//   最終支給額 = 基本給 + バック合計 − 日払い合計

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PayrollLine {
  staffId: string;
  name: string;
  hours: number;
  basePay: number;
  backTotal: number;
  payTotal: number;
  final: number;
}

export function currentMonthRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { start, end };
}

export async function calculatePayrollForStaff(
  supabase: SupabaseClient,
  storeId: string,
  staffId: string,
  periodStart: string,
  periodEnd: string
): Promise<PayrollLine | null> {
  const { data: staff } = await supabase
    .from('staff')
    .select('id, name, hourly_wage')
    .eq('id', staffId)
    .eq('store_id', storeId)
    .maybeSingle();
  if (!staff) return null;

  const { data: attendance } = await supabase
    .from('attendance_records')
    .select('clock_in, clock_out')
    .eq('staff_id', staffId)
    .gte('business_date', periodStart)
    .lte('business_date', periodEnd);
  const hours = (attendance || [])
    .filter((a: any) => a.clock_in && a.clock_out)
    .reduce((sum: number, a: any) => sum + (new Date(a.clock_out).getTime() - new Date(a.clock_in).getTime()) / 3600000, 0);
  const basePay = Math.round(hours * (staff.hourly_wage || 0));

  const { data: backs } = await supabase
    .from('back_records')
    .select('amount')
    .eq('staff_id', staffId)
    .gte('business_date', periodStart)
    .lte('business_date', periodEnd);
  const backTotal = (backs || []).reduce((sum: number, b: any) => sum + b.amount, 0);

  const { data: pays } = await supabase
    .from('daily_payments')
    .select('amount')
    .eq('staff_id', staffId)
    .gte('business_date', periodStart)
    .lte('business_date', periodEnd);
  const payTotal = (pays || []).reduce((sum: number, p: any) => sum + p.amount, 0);

  return {
    staffId: staff.id,
    name: staff.name,
    hours,
    basePay,
    backTotal,
    payTotal,
    final: basePay + backTotal - payTotal,
  };
}
