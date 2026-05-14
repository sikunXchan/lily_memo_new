<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Supabase 同期セットアップ

クラウド同期はオプション。設定しない場合はローカル IndexedDB だけで動作する。

## 1. Supabase プロジェクトを作成
1. https://supabase.com で無料アカウントを作成し、新規プロジェクトを作成（リージョンは東京推奨）
2. プロジェクト作成後、左メニュー **SQL Editor** で以下の SQL を一度だけ実行：

```sql
create table public.folders (
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  parent_sync_id uuid,
  color text,
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);
alter table public.folders enable row level security;
create policy "own folders" on public.folders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index folders_user_updated_idx on public.folders(user_id, updated_at);

create table public.notes (
  sync_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  content text,
  folder_sync_id uuid,
  color text,
  type text default 'text',
  created_at bigint not null,
  updated_at bigint not null,
  deleted_at bigint
);
alter table public.notes enable row level security;
create policy "own notes" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index notes_user_updated_idx on public.notes(user_id, updated_at);
```

## 2. Email 認証を有効化
- **Authentication → Providers → Email** が有効になっていることを確認
- テスト中は **Confirm email** をオフにしておくとサインアップ直後にログインできて楽

## 3. 環境変数
**Settings → API** から取得した値を `.env.local` に貼り付け：

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxxx
```

## 4. アプリ側
1. `npm run dev` で起動
2. 設定画面の「クラウド同期」セクションで **新規登録** タブを選び、メールとパスワードでアカウントを作成
3. 別デバイスで同じメール/パスワードで **ログイン** → メモが自動同期される

家族で使う場合: 各メンバーがそれぞれ自分のメール/パスワードで登録する。同じアカウントで複数デバイスにログインすればそのデバイス群の間でメモが共有される。

## 同期の挙動
- アプリ起動時とタブが再表示された時にプル（`updated_at > 最終同期時刻` の行を取得）
- ローカルで編集すると 5 秒のデバウンスで自動プッシュ
- タブを閉じる / バックグラウンドに移った時は即時プッシュ
- ネットワーク断や認証切れの場合はキューに残り、復帰後の起動時に再送
- コンフリクト解決は `updated_at` ベースの Last-Write-Wins
- 削除は tombstone (`deleted_at`) として記録され、30 日後にローカルから物理削除される

