// netlify/functions/staff-payslip.ts
//
// PINログインしたスタッフが、自分の今月の給与見込みを閲覧するためのAPI。
// 計算は _payroll.ts の共通関数を使用する（オーナー画面の給与計算と完全一致させるため）。

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { verifyStaffToken } from './_staff-auth';
import { calculatePayrollForStaff, currentMonthRange } from './_payroll';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
  const payload = verifyStaffToken(event);
  if (!payload) {
    return { statusCode: 401, body: JSON.stringify({ error: '認証が必要です' }) };
  }

  try {
    const { start, end } = currentMonthRange();
    const line = await calculatePayrollForStaff(supabase, payload.store_id, payload.staff_id, start, end);
    if (!line) {
      return { statusCode: 404, body: JSON.stringify({ error: 'スタッフ情報が見つかりませんでした' }) };
    }
    return { statusCode: 200, body: JSON.stringify(line) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: '内部エラーが発生しました' }) };
  }
};
