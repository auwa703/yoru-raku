// netlify/functions/signup-store.ts
//
// サインアップ直後に呼ばれる。stores / store_members / subscriptions の初期行をまとめて作成する。
// クライアント側のRLS越しでは作れない（store_membersに本人がまだ居ないため）ので、
// この処理だけはservice role keyを使うNetlify Functionsで行う（唯一の例外）。
//
// 必要な環境変数：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// リクエストボディ：
//   { access_token }
//   店舗名・代表者名・電話番号・希望プランは、sb.auth.signUp() 時に
//   options.data (user_metadata) として渡したものをここで読み取る。
//   （メール確認が必須な設定の場合、この関数はサインアップ直後ではなく
//   　メール確認後の初回ログイン時に呼ばれることがあるため、フォーム値を直接受け取らず
//   　常にuser_metadataを正とする）

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const VALID_PLANS = new Set(['light', 'standard', 'pro']);

function randomSlug(length = 8): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // 紛らわしい文字（0,O,1,l,i）を除外
  let s = '';
  for (let i = 0; i < length; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { access_token } = body;

    if (!access_token) {
      return { statusCode: 400, body: JSON.stringify({ error: '必須項目が不足しています' }) };
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(access_token);
    if (userErr || !userData?.user) {
      return { statusCode: 401, body: JSON.stringify({ error: '認証情報が確認できませんでした' }) };
    }
    const userId = userData.user.id;
    const meta = userData.user.user_metadata || {};
    const store_name = meta.store_name;
    const owner_name = meta.owner_name;
    const phone = meta.phone;
    const plan_id = meta.plan_id;

    if (!store_name || !owner_name) {
      return { statusCode: 400, body: JSON.stringify({ error: '店舗情報が見つかりませんでした' }) };
    }

    // 既にこのユーザーが店舗を持っていないか確認（二重サインアップ防止）
    const { data: existingMembership } = await supabase
      .from('store_members')
      .select('store_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (existingMembership) {
      return { statusCode: 200, body: JSON.stringify({ store_id: existingMembership.store_id, already_exists: true }) };
    }

    // staff_login_slugの一意な値を発行（衝突したら数回リトライ）
    let slug = randomSlug();
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: clash } = await supabase.from('stores').select('id').eq('staff_login_slug', slug).maybeSingle();
      if (!clash) break;
      slug = randomSlug();
    }

    const { data: store, error: storeErr } = await supabase
      .from('stores')
      .insert({ name: store_name, owner_name, phone: phone || null, staff_login_slug: slug })
      .select('id')
      .single();
    if (storeErr) throw storeErr;

    const { error: memberErr } = await supabase
      .from('store_members')
      .insert({ store_id: store.id, user_id: userId, role: 'owner' });
    if (memberErr) throw memberErr;

    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const { error: subErr } = await supabase.from('subscriptions').insert({
      store_id: store.id,
      plan_id: VALID_PLANS.has(plan_id) ? plan_id : null,
      status: 'trialing',
      trial_ends_at: trialEndsAt,
    });
    if (subErr) throw subErr;

    return { statusCode: 200, body: JSON.stringify({ store_id: store.id }) };
  } catch (err) {
    console.error('signup-store処理中にエラーが発生しました', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'アカウント作成処理に失敗しました。もう一度お試しください。' }) };
  }
};
