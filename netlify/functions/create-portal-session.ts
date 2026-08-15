// netlify/functions/create-portal-session.ts
//
// アプリの「お支払い・契約管理」ボタンから呼び出す。
// カード変更・請求書確認・プラン変更・解約は、すべてStripe Customer Portal（Stripeが用意する画面）に任せる。

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { stripe } from './_stripe-client';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { store_id } = body;
    if (!store_id) {
      return { statusCode: 400, body: JSON.stringify({ error: 'store_id is required' }) };
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
    const { data: membership } = await supabase
      .from('store_members')
      .select('store_id')
      .eq('user_id', userData.user.id)
      .eq('store_id', store_id)
      .maybeSingle();
    if (!membership) {
      return { statusCode: 403, body: JSON.stringify({ error: 'この店舗の操作権限がありません' }) };
    }

    const { data: sub, error } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('store_id', store_id)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.stripe_customer_id) {
      return { statusCode: 404, body: JSON.stringify({ error: '契約情報が見つかりませんでした' }) };
    }

    const appUrl = process.env.PUBLIC_APP_URL || 'https://app.example.com';
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${appUrl}/app/home.html`,
    });

    return { statusCode: 200, body: JSON.stringify({ url: portalSession.url }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: 'ページの作成に失敗しました。もう一度お試しください。' }) };
  }
};
