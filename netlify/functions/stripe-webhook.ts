// netlify/functions/stripe-webhook.ts
//
// Stripeからのイベント通知を受け取り、契約状態(subscriptions)をDBに反映する。
// 「決済成功しました」という表示だけで契約を有効化せず、必ずこのWebhookを経由する。
//
// 必須事項：
//   - 署名検証（stripe.webhooks.constructEvent）
//   - 冪等性（同じイベントIDを二重処理しない → stripe_webhook_events テーブルで担保）
//
// 必要な環境変数：
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
//
// Netlify側の設定：
//   この関数のURL（例：https://app.example.com/.netlify/functions/stripe-webhook）を
//   StripeダッシュボードのWebhookエンドポイントとして登録し、以下のイベントを選択する：
//     checkout.session.completed
//     customer.subscription.created
//     customer.subscription.updated
//     customer.subscription.deleted
//     invoice.payment_succeeded
//     invoice.payment_failed

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { stripe } from './_stripe-client';
import type Stripe from 'stripe';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const handler: Handler = async (event) => {
  const signature = event.headers['stripe-signature'];
  if (!signature) {
    return { statusCode: 400, body: 'Missing stripe-signature header' };
  }

  let stripeEvent: Stripe.Event;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body!,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Webhook署名検証に失敗しました', err);
    return { statusCode: 400, body: 'Invalid signature' };
  }

  // ---- 冪等性チェック：同じイベントIDを二重処理しない ----
  const { data: existing } = await supabase
    .from('stripe_webhook_events')
    .select('id')
    .eq('id', stripeEvent.id)
    .maybeSingle();
  if (existing) {
    return { statusCode: 200, body: JSON.stringify({ received: true, duplicate: true }) };
  }
  await supabase.from('stripe_webhook_events').insert({ id: stripeEvent.id, type: stripeEvent.type });

  try {
    switch (stripeEvent.type) {
      case 'checkout.session.completed': {
        const session = stripeEvent.data.object as Stripe.Checkout.Session;
        const storeId = session.client_reference_id;
        const subscriptionId = session.subscription as string;
        if (storeId && subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          await upsertSubscription(storeId, sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = stripeEvent.data.object as Stripe.Subscription;
        const storeId = sub.metadata?.store_id;
        if (storeId) await upsertSubscription(storeId, sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = stripeEvent.data.object as Stripe.Subscription;
        const storeId = sub.metadata?.store_id;
        if (storeId) {
          await supabase
            .from('subscriptions')
            .update({ status: 'canceled', updated_at: new Date().toISOString() })
            .eq('store_id', storeId);
        }
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = stripeEvent.data.object as Stripe.Invoice;
        const subscriptionId = invoice.subscription as string;
        if (subscriptionId) {
          const sub = await stripe.subscriptions.retrieve(subscriptionId);
          const storeId = sub.metadata?.store_id;
          if (storeId) {
            // 即削除・即利用停止ではなく past_due に変更するのみ。
            // 利用制限をかけるかどうかはアプリ側の判定（subscription_status参照）で行う。
            await supabase
              .from('subscriptions')
              .update({ status: 'past_due', updated_at: new Date().toISOString() })
              .eq('store_id', storeId);
          }
        }
        break;
      }
      default:
        // 未対応のイベントは無視（受信は成功として扱う）
        break;
    }
  } catch (err) {
    console.error('Webhook処理中にエラーが発生しました', err);
    // Stripe側に失敗を伝え、リトライしてもらう
    return { statusCode: 500, body: JSON.stringify({ error: 'internal error' }) };
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};

async function upsertSubscription(storeId: string, sub: Stripe.Subscription) {
  const planId = sub.metadata?.plan_id || null;
  await supabase.from('subscriptions').upsert(
    {
      store_id: storeId,
      plan_id: planId,
      status: sub.status, // active / trialing / past_due / canceled 等、Stripeの状態をほぼそのまま反映
      stripe_customer_id: sub.customer as string,
      stripe_subscription_id: sub.id,
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'store_id' }
  );
}
