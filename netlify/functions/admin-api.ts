// netlify/functions/admin-api.ts
//
// SUPER_ADMIN管理画面（/admin）が使う単一エンドポイント。
// `action` パラメータで処理を振り分ける。呼び出し元が super_admins に
// 登録されたSupabase Authユーザーであることを必ず確認してから、
// service roleで店舗横断の読み書きを行う（店舗をまたぐ操作は通常のRLSでは実現できないため）。
//
// 必要な環境変数：
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY

import type { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function requireSuperAdmin(event: any): Promise<{ ok: true } | { ok: false; statusCode: number; error: string }> {
  const authHeader = event.headers['authorization'] || event.headers['Authorization'];
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) return { ok: false, statusCode: 401, error: '認証が必要です' };

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, statusCode: 401, error: '認証が必要です' };

  const { data: admin } = await supabase.from('super_admins').select('user_id').eq('user_id', userData.user.id).maybeSingle();
  if (!admin) return { ok: false, statusCode: 403, error: '管理者権限がありません' };

  return { ok: true };
}

export const handler: Handler = async (event) => {
  const authCheck = await requireSuperAdmin(event);
  if (!authCheck.ok) {
    return { statusCode: authCheck.statusCode, body: JSON.stringify({ error: authCheck.error }) };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const action = event.queryStringParameters?.action || body.action;

    switch (action) {
      case 'list_stores': {
        const { data: stores, error } = await supabase
          .from('stores')
          .select('id, name, created_at, subscriptions(plan_id, status, is_monitor), staff(id)')
          .order('created_at', { ascending: false });
        if (error) throw error;
        const result = (stores || []).map((s: any) => ({
          id: s.id,
          name: s.name,
          registeredAt: s.created_at?.slice(0, 10),
          plan: s.subscriptions?.[0]?.plan_id || null,
          status: s.subscriptions?.[0]?.status || 'trialing',
          isMonitor: s.subscriptions?.[0]?.is_monitor || false,
          staffCount: (s.staff || []).length,
        }));
        return { statusCode: 200, body: JSON.stringify({ stores: result }) };
      }

      case 'get_store_detail': {
        const storeId = body.store_id;
        const { data: dailySettings } = await supabase.from('store_daily_settings').select('*').eq('store_id', storeId).maybeSingle();
        const { data: customSettings } = await supabase.from('store_custom_settings').select('*').eq('store_id', storeId).order('created_at', { ascending: true });
        return { statusCode: 200, body: JSON.stringify({ dailySettings: dailySettings || {}, customSettings: customSettings || [] }) };
      }

      case 'update_plan': {
        const { store_id, plan_id } = body;
        const { error } = await supabase.from('subscriptions').update({ plan_id, updated_at: new Date().toISOString() }).eq('store_id', store_id);
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      case 'suspend_store': {
        const { store_id } = body;
        const { error } = await supabase.from('subscriptions').update({ status: 'canceled', updated_at: new Date().toISOString() }).eq('store_id', store_id);
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      case 'reactivate_store': {
        const { store_id } = body;
        const { error } = await supabase.from('subscriptions').update({ status: 'active', updated_at: new Date().toISOString() }).eq('store_id', store_id);
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      case 'update_daily_settings': {
        const { store_id, settings } = body;
        const { error } = await supabase.from('store_daily_settings').upsert({ store_id, ...settings, updated_at: new Date().toISOString() }, { onConflict: 'store_id' });
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      case 'upsert_custom_setting': {
        const { store_id, key, label, value_boolean } = body;
        const { error } = await supabase.from('store_custom_settings').upsert(
          { store_id, key, label, value_type: 'boolean', value_boolean, updated_at: new Date().toISOString() },
          { onConflict: 'store_id,key' }
        );
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      case 'delete_custom_setting': {
        const { id } = body;
        const { error } = await supabase.from('store_custom_settings').delete().eq('id', id);
        if (error) throw error;
        return { statusCode: 200, body: JSON.stringify({ ok: true }) };
      }

      default:
        return { statusCode: 400, body: JSON.stringify({ error: '不明なactionです' }) };
    }
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: JSON.stringify({ error: '内部エラーが発生しました' }) };
  }
};
