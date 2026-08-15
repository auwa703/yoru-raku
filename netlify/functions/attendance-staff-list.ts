// netlify/functions/attendance-staff-list.ts
//
// QRコードを読み取った直後の画面（app/attend.html）が、
// 「誰が出勤/退勤するか」を選ばせるためにスタッフ一覧を取得する。
// スタッフは未ログインのため、有効なQRトークン（＝その場でQRコードを読み取った証拠）を
// 持っていることをもって一時的なアクセスを許可する。
//
// 必要な環境変数：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const qrPayload = event.queryStringParameters?.qr_payload;
    if (!qrPayload) {
      return { statusCode: 400, body: JSON.stringify({ error: 'qr_payload is required' }) };
    }
    const [storeId, rawToken] = String(qrPayload).split('.');
    if (!storeId || !rawToken) {
      return { statusCode: 400, body: JSON.stringify({ error: 'QRコードの形式が正しくありません' }) };
    }
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const { data: tokenRow } = await supabase
      .from('attendance_qr_tokens')
      .select('id')
      .eq('store_id', storeId)
      .eq('token_hash', tokenHash)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle();
    if (!tokenRow) {
      return { statusCode: 401, body: JSON.stringify({ error: 'コードの有効期限が切れています。もう一度お店のQRコードを読み取ってください。' }) };
    }

    const { data: staff, error } = await supabase
      .from('staff')
      .select('id, name')
      .eq('store_id', storeId)
      .eq('status', 'active')
      .order('name', { ascending: true });
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ staff: staff || [] }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: '内部エラーが発生しました' }) };
  }
};
