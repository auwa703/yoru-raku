// netlify/functions/create-checkout-session.ts
//
// 料金ページでプランを選び「〇〇で始める」を押した際に呼び出される。
// Stripe Checkoutの決済ページURLを発行して返す。
// ここでは契約を有効化しない（有効化は stripe-webhook.ts が行う）。
//
// 必要な環境変数：
//   STRIPE_SECRET_KEY
//   STRIPE_PRICE_ID_LIGHT / STANDARD / PRO
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//   PUBLIC_APP_URL   （例：https://app.example.com）※success/cancel遷移先の組み立てに使用

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { stripe, PRICE_ID_MAP } from './_stripe-client';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const { store_id, plan_id } = body;

    if (!store_id || !plan_id || !PRICE_ID_MAP[plan_id]) {
      return { statusCode: 400, body: JSON.stringify({ error: 'store_id または plan_id が不正です' }) };
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

    const { data: store, error: storeErr } = await supabase
      .from('stores')
      .select('id, name')
      .eq('id', store_id)
      .maybeSingle();
    if (storeErr) throw storeErr;
    if (!store) {
      return { statusCode: 404, body: JSON.stringify({ error: '店舗が見つかりませんでした' }) };
    }

    // 既にStripe Customerが発行済みならそれを使い、なければ新規作成
    const { data: existingSub } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('store_id', store_id)
      .maybeSingle();

    let customerId = existingSub?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: store.name,
        metadata: { store_id: store.id },
      });
      customerId = customer.id;
    }

    const appUrl = process.env.PUBLIC_APP_URL || 'https://app.example.com';

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: PRICE_ID_MAP[plan_id]!, quantity: 1 }],
      success_url: `${appUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/billing/cancel`,
      client_reference_id: store_id,
      subscription_data: {
        metadata: { store_id, plan_id },
      },
      // 決済成功後の契約有効化は success_url 到達ではなく stripe-webhook.ts で行う
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: '決済ページの作成に失敗しました。もう一度お試しください。' }) };
  }
};
