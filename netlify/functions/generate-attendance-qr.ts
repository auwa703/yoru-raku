// netlify/functions/generate-attendance-qr.ts
//
// 店舗に設置したタブレット/PCがこの関数を約20〜30秒ごとに呼び出し、
// 新しいQRコード用トークンを取得して画面に表示する。
// トークンはハッシュ化してDBに保存し、生のトークンはこの応答でのみ返す
// （ハッシュ化することで、DBが漏洩してもQRの偽造はできない）。
//
// 必要な環境変数：
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY   ※service roleキーはこの関数（サーバー側）でのみ使用し、
//                                 絶対にフロントエンドへ渡さないこと
//   ATTENDANCE_QR_TTL_SECONDS   （未設定時は30秒）

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { randomBytes, createHash } from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const TTL_SECONDS = parseInt(process.env.ATTENDANCE_QR_TTL_SECONDS || '30', 10);

export const handler: Handler = async (event) => {
  try {
    const storeId = event.queryStringParameters?.store_id;
    if (!storeId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'store_id is required' }) };
    }

    // 呼び出し元が storeId の店舗に所属するSupabase Authユーザーであることを確認する。
    const authHeader = event.headers['authorization'] || event.headers['Authorization'];
    const token = authHeader?.replace(/^Bearer\s+/i, '');
    if (!token) {
      return { statusCode: 401, body: JSON.stringify({ error: '認証が必要です' }) };
    }
    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return { statusCode: 401, body: JSON.stringify({ error: '認証が必要です' }) };
    }
    const { data: membership } = await supabase
      .from('store_members')
      .select('store_id')
      .eq('user_id', userData.user.id)
      .eq('store_id', storeId)
      .maybeSingle();
    if (!membership) {
      return { statusCode: 403, body: JSON.stringify({ error: 'この店舗の操作権限がありません' }) };
    }

    const rawToken = randomBytes(24).toString('hex');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();

    const { error } = await supabase.from('attendance_qr_tokens').insert({
      store_id: storeId,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    if (error) throw error;

    // QRコードにはこの qr_payload をそのままエンコードする。
    // 例：https://app.example.com/attend?store=xxx&token=yyy
    const qrPayload = `${storeId}.${rawToken}`;

    return {
      statusCode: 200,
      body: JSON.stringify({
        qr_payload: qrPayload,
        expires_at: expiresAt,
        ttl_seconds: TTL_SECONDS,
      }),
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: '内部エラーが発生しました' }) };
  }
};
