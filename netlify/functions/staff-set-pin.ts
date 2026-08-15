// netlify/functions/staff-set-pin.ts
//
// オーナーが「スタッフ管理」からスタッフのPINを設定・変更する。
// PINはハッシュ化してから保存し、平文は一切保存しない。
//
// 必要な環境変数：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { staff_id, pin } = body;
    if (!staff_id || !pin || !/^\d{4,6}$/.test(pin)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'PINは4〜6桁の数字で入力してください' }) };
    }

    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: '認証が必要です' }) };
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return { statusCode: 401, body: JSON.stringify({ error: '認証が必要です' }) };
    }

    const { data: staff } = await supabase.from('staff').select('id, store_id').eq('id', staff_id).maybeSingle();
    if (!staff) {
      return { statusCode: 404, body: JSON.stringify({ error: 'スタッフが見つかりませんでした' }) };
    }
    const { data: membership } = await supabase
      .from('store_members')
      .select('store_id')
      .eq('user_id', userData.user.id)
      .eq('store_id', staff.store_id)
      .maybeSingle();
    if (!membership) {
      return { statusCode: 403, body: JSON.stringify({ error: 'この店舗の操作権限がありません' }) };
    }

    const pinHash = await bcrypt.hash(pin, 10);
    const { error } = await supabase.from('staff').update({ pin_hash: pinHash }).eq('id', staff_id);
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: '内部エラーが発生しました' }) };
  }
};
