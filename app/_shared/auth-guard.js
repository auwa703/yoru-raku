// app/_shared/auth-guard.js
//
// 店舗オーナー・管理者向けの認証ガード。
// supabase-client.js を先に読み込んでおくこと。
//
// 使い方：
//   const { user, storeId, role } = await requireStoreSession();
// ログインしていない場合は自動的に /login へリダイレクトする（この関数はその場合resolveしない）。

async function requireStoreSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    window.location.href = '/login';
    return new Promise(() => {}); // リダイレクト完了までこのPromiseは解決しない
  }

  const { data: membership, error } = await sb
    .from('store_members')
    .select('store_id, role')
    .eq('user_id', session.user.id)
    .maybeSingle();

  if (error || !membership) {
    // Supabase Authのユーザーではあるが、どの店舗にも所属していない
    // （オンボーディング未完了、またはアカウント異常）→ ログイン画面へ差し戻す
    await sb.auth.signOut();
    window.location.href = '/login';
    return new Promise(() => {});
  }

  return { user: session.user, storeId: membership.store_id, role: membership.role };
}

window.requireStoreSession = requireStoreSession;

window.signOutAndRedirect = async function () {
  await sb.auth.signOut();
  window.location.href = '/login';
};
