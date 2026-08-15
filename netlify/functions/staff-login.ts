// netlify/functions/staff-login.ts
//
// スタッフの「PINログイン」。Supabase Authのユーザーではないスタッフのために、
// 店舗コード（stores.staff_login_slug）＋ログインID＋PINで認証し、
// 短時間だけ有効な署名付きトークンを発行する。
// このトークンはSupabase Authのセッションとは別物で、
// staff-me.ts / staff-payslip.ts が Authorization ヘッダー経由で検証する。
//
// 必要な環境変数：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//   STAFF_SESSION_SECRET   （JWT署名用のランダムな文字列）

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { slug, login_id, pin } = body;
    if (!slug || !login_id || !pin) {
      return { statusCode: 400, body: JSON.stringify({ error: '店舗コード・ログインID・PINをすべて入力してください' }) };
    }

    const { data: store } = await supabase.from('stores').select('id, name').eq('staff_login_slug', slug).maybeSingle();
    if (!store) {
      return { statusCode: 401, body: JSON.stringify({ error: '店舗コードが正しくありません' }) };
    }

    const { data: staff } = await supabase
      .from('staff')
      .select('id, name, pin_hash, status')
      .eq('store_id', store.id)
      .eq('login_id', login_id)
      .maybeSingle();
    if (!staff || staff.status !== 'active' || !staff.pin_hash) {
      return { statusCode: 401, body: JSON.stringify({ error: 'ログインIDまたはPINが正しくありません' }) };
    }

    const valid = await bcrypt.compare(pin, staff.pin_hash);
    if (!valid) {
      return { statusCode: 401, body: JSON.stringify({ error: 'ログインIDまたはPINが正しくありません' }) };
    }

    const token = jwt.sign(
      { staff_id: staff.id, store_id: store.id },
      process.env.STAFF_SESSION_SECRET!,
      { expiresIn: '12h' }
    );

    return { statusCode: 200, body: JSON.stringify({ token, staff_name: staff.name, store_name: store.name }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: '内部エラーが発生しました' }) };
  }
};
