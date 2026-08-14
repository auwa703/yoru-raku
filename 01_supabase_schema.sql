-- ============================================================
-- 店舗管理SaaS DBスキーマ雛形
-- 方針：全テーブルに store_id を持たせ、Row Level Security (RLS) で
--       「自分の store_id 以外は一切見えない／書けない」をDB側で強制する。
--       ダミー・テスト用のデータのみを想定。実店舗データは投入しないこと。
-- ============================================================

-- ----------------------------------------------------------
-- 0. 店舗・契約まわり
-- ----------------------------------------------------------
create table stores (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_name text,
  phone text,
  created_at timestamptz not null default now()
);

-- auth.users の user_id と store_id を紐付ける（1店舗に複数管理者もありうる）
create table store_members (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner', -- owner / manager / staff_login など
  created_at timestamptz not null default now(),
  unique(store_id, user_id)
);

create table plans (
  id text primary key,             -- 'light' / 'standard' / 'pro'
  name text not null,
  monthly_price integer not null,  -- 円
  stripe_price_id text             -- Stripe側のPrice ID（後で設定）
);

create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  plan_id text references plans(id),
  status text not null default 'trialing', -- trialing / active / past_due / canceled
  is_monitor boolean not null default false, -- 先行モニター価格かどうか
  trial_ends_at timestamptz,
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Stripe Webhookの冪等性担保用（同じイベントを二重処理しない）
create table stripe_webhook_events (
  id text primary key, -- StripeのイベントID
  type text not null,
  received_at timestamptz not null default now()
);

-- ----------------------------------------------------------
-- 1. 店舗設定
-- ----------------------------------------------------------
create table store_settings (
  store_id uuid primary key references stores(id) on delete cascade,
  closing_day integer,          -- 給与締め日
  payday integer,               -- 給与支払日
  base_hourly_wage integer,
  business_day_switch_time time, -- 深夜営業の営業日切替時刻（例：翌5:00）
  register_float integer,        -- レジ準備金
  updated_at timestamptz not null default now()
);

-- 「日次管理設定」：店舗ごとにON/OFFできる機能フラグ
create table store_daily_settings (
  store_id uuid primary key references stores(id) on delete cascade,
  use_sales boolean not null default false,
  use_sales_by_payment boolean not null default false,
  use_visitor_groups boolean not null default false,
  use_visitor_count boolean not null default false,
  use_staff_display boolean not null default false,
  use_daily_pay boolean not null default false,
  use_expenses boolean not null default false,
  use_purchases boolean not null default false,
  use_other_income boolean not null default false,
  use_other_outcome boolean not null default false,
  use_notes boolean not null default false,
  use_cash_count boolean not null default false,
  use_cash_closing boolean not null default false,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------
-- 2. スタッフ・勤怠
-- ----------------------------------------------------------
create table staff (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  login_id text,
  hourly_wage integer,
  status text not null default 'active', -- active / retired
  joined_at date,
  retired_at date,
  note text,
  created_at timestamptz not null default now()
);

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  business_date date not null,   -- 深夜営業を考慮した「営業日」
  clock_in timestamptz,
  clock_out timestamptz,
  clock_in_method text,          -- 'qr' / 'admin_manual'
  clock_out_method text,         -- 'qr' / 'admin_manual'
  clock_in_qr_token_id uuid,     -- 打刻時に使用したQRトークン（監査用）
  clock_out_qr_token_id uuid,
  edited_by_admin boolean not null default false,
  edited_by uuid references auth.users(id),  -- 手動修正した管理者
  edit_reason text,                          -- 手動修正の理由（必須運用を推奨）
  created_at timestamptz not null default now()
);

-- 店舗設置のタブレット/PCに表示するQRコード用トークン。
-- 数十秒ごとに新しい行を発行し、有効期限内のものだけ打刻を許可する。
-- スタッフのスマホが読み取った時点でのトークンを検証することで、
-- 「その場でしか打刻できない」を担保する（Netlify Functions側でサーバー検証必須）。
create table attendance_qr_tokens (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  token_hash text not null,       -- トークンそのものはハッシュ化して保存
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null -- issued_at + 30秒程度を想定
);
create index idx_qr_tokens_store_expiry on attendance_qr_tokens(store_id, expires_at);

-- ----------------------------------------------------------
-- 3. バック・日払い・給与
-- ----------------------------------------------------------
create table back_items (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  name text not null,
  category text,           -- ドリンク／同伴／予約／ショット等
  sale_price integer,
  back_amount integer not null,
  is_active boolean not null default true,
  sort_order integer not null default 0
);

create table back_records (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  back_item_id uuid references back_items(id),
  business_date date not null,
  quantity integer not null default 1,
  amount integer not null,
  created_at timestamptz not null default now()
);

create table daily_payments (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  business_date date not null,
  amount integer not null,
  pay_source text not null default 'register_cash', -- register_cash / other_cash / bank / other
  created_at timestamptz not null default now()
);

create table payroll_records (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  staff_id uuid not null references staff(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  worked_hours numeric,
  base_pay integer,
  back_total integer,
  daily_pay_total integer,
  deductions integer,
  tax_withheld integer,
  final_amount integer,
  received_signature text,     -- 受領サイン（画像URL等）
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------
-- 4. 今日の営業（日報）・売上・経費・仕入・その他入出金
-- ----------------------------------------------------------
create table daily_reports (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  business_date date not null,
  open_time time,
  close_time time,
  visitor_groups integer,
  visitor_count integer,
  note text,
  handover_note text,
  status text not null default 'draft', -- draft / closed
  closed_by uuid references auth.users(id),
  closed_at timestamptz,
  unique(store_id, business_date)
);

create table sales_records (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  business_date date not null,
  payment_method text not null, -- cash / card / qr / other
  amount integer not null,
  created_at timestamptz not null default now()
);

-- 経費・仕入・その他入出金をまとめて1テーブルで管理（type列で区別）
create table cash_transactions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  business_date date not null,
  type text not null,           -- expense / purchase / other_income / other_outcome
  label text,
  amount integer not null,
  pay_source text not null default 'register_cash', -- register_cash / bank / card / credit / other
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------
-- 5. 金種・現金締め
-- ----------------------------------------------------------
create table cash_denomination_counts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  business_date date not null,
  denomination integer not null, -- 10000, 5000, 1000, 500, 100, 50, 10, 5, 1
  count integer not null default 0,
  unique(store_id, business_date, denomination)
);

create table cash_closings (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references stores(id) on delete cascade,
  business_date date not null,
  theoretical_balance integer not null,
  actual_balance integer not null,
  difference integer not null,
  created_at timestamptz not null default now(),
  unique(store_id, business_date)
);

-- ----------------------------------------------------------
-- 6. マニュアル・FAQ（SUPER_ADMINが編集、店舗には公開のみ）
--    ※ store_id を持たない「全店舗共通」テーブル。RLSは読み取り全店舗許可・書き込みは管理者のみ。
-- ----------------------------------------------------------
create table manual_articles (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  body text not null,
  video_url text,
  target_plan text,          -- null = 全プラン共通
  sort_order integer not null default 0,
  is_published boolean not null default true,
  updated_at timestamptz not null default now()
);

create table faq_items (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  related_screen_path text,
  sort_order integer not null default 0,
  is_published boolean not null default true
);

-- ----------------------------------------------------------
-- 7. 監査ログ（PROプランの「操作履歴」等）
-- ----------------------------------------------------------
create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  store_id uuid references stores(id) on delete cascade,
  user_id uuid references auth.users(id),
  action text not null,
  target_table text,
  target_id text,
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security（店舗分離の要）
-- ============================================================
-- 共通の考え方：
--   store_id を持つ全テーブルで RLS を有効化し、
--   「store_members に自分(auth.uid())が所属する store_id」の行だけ許可する。
-- ============================================================

create or replace function is_member_of_store(target_store_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from store_members
    where store_id = target_store_id
      and user_id = auth.uid()
  );
$$;

-- 例：staff テーブルへの適用（他の store_id 付きテーブルにも同パターンを適用する）
alter table staff enable row level security;
create policy "store members can view own staff"
  on staff for select
  using (is_member_of_store(store_id));
create policy "store members can modify own staff"
  on staff for all
  using (is_member_of_store(store_id))
  with check (is_member_of_store(store_id));

-- 同様のポリシーを、store_id を持つ全テーブルへ一括適用する。
-- （staffで作成した is_member_of_store() 関数を再利用）
do $$
declare
  tbl text;
  tables text[] := array[
    'store_settings', 'store_daily_settings', 'attendance_records',
    'back_items', 'back_records', 'daily_payments', 'payroll_records',
    'daily_reports', 'sales_records', 'cash_transactions',
    'cash_denomination_counts', 'cash_closings', 'audit_logs', 'subscriptions'
  ];
begin
  foreach tbl in array tables loop
    execute format('alter table %I enable row level security;', tbl);
    execute format(
      'create policy "store members can access own %1$s" on %1$I for all using (is_member_of_store(store_id)) with check (is_member_of_store(store_id));',
      tbl
    );
  end loop;
end $$;

-- store_settings / store_daily_settings は store_id が主キーのため上と同じ関数で問題なく動作する。
-- stores 自体（親テーブル）にも別途RLSを適用する。
alter table stores enable row level security;
create policy "store members can view own store"
  on stores for select
  using (is_member_of_store(id));
create policy "store members can update own store"
  on stores for update
  using (is_member_of_store(id))
  with check (is_member_of_store(id));

-- store_members 自体：自分の所属行のみ閲覧可能（他店舗の名簿は見せない）
alter table store_members enable row level security;
create policy "users can view their own memberships"
  on store_members for select
  using (user_id = auth.uid());
-- （トークンの発行・検証はNetlify Functions側でservice role keyを使って行う）。
-- RLSは有効化のうえ、クライアント向けポリシーは一切作成しない＝デフォルト全拒否とする。
alter table attendance_qr_tokens enable row level security;

-- manual_articles / faq_items は全店舗が閲覧可、書き込みはSUPER_ADMINのみ（別途admin用ロールで制御）
alter table manual_articles enable row level security;
create policy "anyone authenticated can read published manuals"
  on manual_articles for select
  using (is_published = true);

alter table faq_items enable row level security;
create policy "anyone authenticated can read published faq"
  on faq_items for select
  using (is_published = true);

-- ============================================================
-- 初期マスタデータ
-- ============================================================
insert into plans (id, name, monthly_price) values
  ('light', 'LIGHT', 2980),
  ('standard', 'STANDARD', 4980),
  ('pro', 'PRO', 7980);
