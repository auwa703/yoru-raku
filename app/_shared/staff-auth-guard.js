// app/_shared/staff-auth-guard.js
//
// スタッフPINログイン向けの認証ガード。
// スタッフはSupabase Authのユーザーではないため、専用の署名付きトークン（staff-login.tsが発行）を
// localStorageに保存し、以降のAPI呼び出しにAuthorizationヘッダーとして付与する。
//
// 使い方：
//   const token = requireStaffSession(); // 無ければ /login へリダイレクト
//   fetch('/.netlify/functions/staff-me', { headers: { Authorization: 'Bearer ' + token } })

const STAFF_TOKEN_KEY = 'yoruraku_staff_token';

function requireStaffSession() {
  const token = localStorage.getItem(STAFF_TOKEN_KEY);
  if (!token) {
    window.location.href = '/login';
    return null;
  }
  return token;
}

function setStaffSession(token) {
  localStorage.setItem(STAFF_TOKEN_KEY, token);
}

function clearStaffSession() {
  localStorage.removeItem(STAFF_TOKEN_KEY);
}

window.requireStaffSession = requireStaffSession;
window.setStaffSession = setStaffSession;
window.clearStaffSession = clearStaffSession;

// 認証付きfetchのヘルパー。401が返ってきたらセッション切れとみなしログイン画面へ。
window.staffFetch = async function (url, options = {}) {
  const token = requireStaffSession();
  if (!token) return null;
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
  });
  if (res.status === 401) {
    clearStaffSession();
    window.location.href = '/login';
    return null;
  }
  return res;
};
