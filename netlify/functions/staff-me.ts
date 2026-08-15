// netlify/functions/staff-me.ts
//
// PINログインしたスタッフが、自分の勤怠履歴（今月分）を閲覧するためのAPI。

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { verifyStaffToken } from './_staff-auth';
import { currentMonthRange } from './_payroll';

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
    const { data: staff } = await supabase.from('staff').select('id, name').eq('id', payload.staff_id).maybeSingle();
    if (!staff) {
      return { statusCode: 404, body: JSON.stringify({ error: 'スタッフ情報が見つかりませんでした' }) };
    }

    const { start, end } = currentMonthRange();
    const { data: attendance, error } = await supabase
      .from('attendance_records')
      .select('business_date, clock_in, clock_out')
      .eq('staff_id', payload.staff_id)
      .gte('business_date', start)
      .lte('business_date', end)
      .order('business_date', { ascending: false });
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ name: staff.name, attendance: attendance || [] }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: '内部エラーが発生しました' }) };
  }
};
