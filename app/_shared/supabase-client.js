// app/_shared/supabase-client.js
//
// Supabaseクライアントの共通初期化（フロントエンド用）。
// このファイルより前に、以下のCDNスクリプトを読み込んでおくこと：
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
//
// SUPABASE_URL / SUPABASE_ANON_KEY はSupabaseの「publishable」キーであり、
// クライアント側コードに埋め込むことを前提に設計されている（秘密鍵ではない）。
// アクセス制御はデータベース側のRow Level Security (RLS) が担う。
// 実データへの読み書き権限を持つ service role key は、
// 絶対にこのファイルやフロントエンドコードに含めないこと（Netlify Functions専用）。

const SUPABASE_URL = 'https://gjbcyioyfzholxbkqhlr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_OJGl1zfR_C7DyNy5Qjo8Uw_ryq2wEje';

window.sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
