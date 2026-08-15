// netlify/edge-functions/admin-auth.ts
//
// /admin 以下を簡易パスワード保護する応急処置。
// 本格的なログイン機能（Supabase Authでの管理者ロール判定等）に置き換わるまでの暫定措置。
//
// 必要な環境変数：
//   ADMIN_BASIC_AUTH_USER
//   ADMIN_BASIC_AUTH_PASSWORD

import type { Context } from '@netlify/edge-functions';

export default async (request: Request, context: Context) => {
  const user = Deno.env.get('ADMIN_BASIC_AUTH_USER');
  const pass = Deno.env.get('ADMIN_BASIC_AUTH_PASSWORD');

  if (!user || !pass) {
    return new Response('Admin auth is not configured.', { status: 500 });
  }

  const authHeader = request.headers.get('authorization');
  const expected = 'Basic ' + btoa(`${user}:${pass}`);

  if (authHeader !== expected) {
    return new Response('認証が必要です', {
      status: 401,
      headers: { 'WWW-Authenticate': 'Basic realm="Admin", charset="UTF-8"' },
    });
  }

  return context.next();
};
