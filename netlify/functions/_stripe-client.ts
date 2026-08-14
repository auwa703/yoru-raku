// netlify/functions/_stripe-client.ts
//
// Stripeクライアントの共通初期化。
// 秘密鍵はこのファイル（サーバー側実行）でのみ使用し、フロントエンドには一切渡さない。
//
// 必要な環境変数：
//   STRIPE_SECRET_KEY

import Stripe from 'stripe';

if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('[stripe] STRIPE_SECRET_KEY が未設定です。決済関連のFunctionsはエラーになります。');
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', {
  apiVersion: '2024-06-20',
});

// プランID（DBの plans.id）→ Stripe Price ID の対応表。
// 実際のPrice IDが決まったら、環境変数から読み込む形にする。
export const PRICE_ID_MAP: Record<string, string | undefined> = {
  light: process.env.STRIPE_PRICE_ID_LIGHT,
  standard: process.env.STRIPE_PRICE_ID_STANDARD,
  pro: process.env.STRIPE_PRICE_ID_PRO,
};
