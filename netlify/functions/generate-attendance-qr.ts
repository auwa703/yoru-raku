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
    // 呼び出し元は「店舗の管理端末としてログイン済みのセッション」であることを前提とする。
    // 実装時：Supabase Authのセッションからstore_idを取得し、
    //         そのユーザーがstore_membersに所属しているかを必ず検証すること。
    const storeId = event.queryStringParameters?.store_id;
    if (!storeId) {
      return { statusCode: 400, body: JSON.stringify({ error: 'store_id is required' }) };
    }
    // TODO: 認証チェック（Authorizationヘッダーのトークンを検証し、
    //       このユーザーが storeId の店舗に所属しているか確認する）

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
