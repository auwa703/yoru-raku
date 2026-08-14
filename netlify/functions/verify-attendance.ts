// netlify/functions/verify-attendance.ts
//
// スタッフがQRコードを読み取って開いたページから呼び出される。
// 「読み取ったトークンが、この店舗の・有効期限内の・本物のトークンか」を
// サーバー側で検証してから出勤/退勤を記録する。
// クライアント側の判定だけに頼らないことが「その場でしか打刻できない」の要。
//
// 必要な環境変数：
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { qr_payload, staff_id, action } = body; // action: 'clock_in' | 'clock_out'

    if (!qr_payload || !staff_id || !['clock_in', 'clock_out'].includes(action)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'パラメータが不正です' }) };
    }

    const [storeId, rawToken] = String(qr_payload).split('.');
    if (!storeId || !rawToken) {
      return { statusCode: 400, body: JSON.stringify({ error: 'QRコードの形式が正しくありません' }) };
    }
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    // 有効期限内・未使用（同一店舗）のトークンかを確認
    const { data: tokenRow, error: tokenErr } = await supabase
      .from('attendance_qr_tokens')
      .select('id, store_id, expires_at')
      .eq('store_id', storeId)
      .eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();

    if (tokenErr) throw tokenErr;
    if (!tokenRow) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'コードの有効期限が切れています。もう一度お店のQRコードを読み取ってください。' }),
      };
    }

    // スタッフがこの店舗に所属しているかを確認
    const { data: staffRow, error: staffErr } = await supabase
      .from('staff')
      .select('id, store_id')
      .eq('id', staff_id)
      .eq('store_id', storeId)
      .maybeSingle();
    if (staffErr) throw staffErr;
    if (!staffRow) {
      return { statusCode: 403, body: JSON.stringify({ error: 'スタッフ情報を確認できませんでした' }) };
    }

    const businessDate = await resolveBusinessDate(storeId);
    const nowIso = new Date().toISOString();

    if (action === 'clock_in') {
      const { error } = await supabase.from('attendance_records').insert({
        store_id: storeId,
        staff_id,
        business_date: businessDate,
        clock_in: nowIso,
        clock_in_method: 'qr',
        clock_in_qr_token_id: tokenRow.id,
      });
      if (error) throw error;
    } else {
      // その日の未退勤レコードを探して退勤時刻を記録
      const { data: openRecord, error: findErr } = await supabase
        .from('attendance_records')
        .select('id')
        .eq('store_id', storeId)
        .eq('staff_id', staff_id)
        .eq('business_date', businessDate)
        .is('clock_out', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!openRecord) {
        return { statusCode: 409, body: JSON.stringify({ error: '出勤記録が見つかりませんでした。管理者にご連絡ください。' }) };
      }
      const { error } = await supabase
        .from('attendance_records')
        .update({ clock_out: nowIso, clock_out_method: 'qr', clock_out_qr_token_id: tokenRow.id })
        .eq('id', openRecord.id);
      if (error) throw error;
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: '内部エラーが発生しました' }) };
  }
};

async function resolveBusinessDate(storeId: string): Promise<string> {
  // store_settings.business_day_switch_time（例：'05:00:00'）より前の時刻は
  // 「前日の営業日」として扱う。深夜営業の店舗が日をまたいでも
  // 同じ営業日として勤怠・売上・レジ締めをまとめられるようにするための計算。
  const { data: settings } = await supabase
    .from('store_settings')
    .select('business_day_switch_time')
    .eq('store_id', storeId)
    .maybeSingle();

  const switchTime = settings?.business_day_switch_time || '05:00:00';
  const [swH, swM] = switchTime.split(':').map((n: string) => parseInt(n, 10));

  // Netlify Functionsの実行環境はUTCが基準のため、JST（UTC+9）に変換してから判定する。
  const nowUtc = new Date();
  const nowJst = new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000);
  const businessDate = new Date(nowJst);
  const nowMinutes = nowJst.getUTCHours() * 60 + nowJst.getUTCMinutes();
  const switchMinutes = swH * 60 + swM;
  if (nowMinutes < switchMinutes) {
    businessDate.setUTCDate(businessDate.getUTCDate() - 1);
  }
  return businessDate.toISOString().slice(0, 10);
}
