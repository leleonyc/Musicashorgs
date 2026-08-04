-- Rode esse arquivo inteiro no SQL Editor do seu projeto Supabase
-- (Supabase Dashboard → SQL Editor → New query → cole tudo → Run)

create table public.musicash_users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text,
  balance integer not null default 0,
  ratings jsonb not null default '{}',
  withdrawals jsonb not null default '[]',
  daily_reset_at timestamptz not null default now(),
  daily_count integer not null default 0,
  created_at timestamptz not null default now(),
  cycle_start_at timestamptz not null default now(),
  last_withdrawal_at timestamptz
);

alter table public.musicash_users enable row level security;

create policy "usuário lê o próprio perfil"
  on public.musicash_users for select
  using (auth.uid() = id);

create policy "usuário cria o próprio perfil"
  on public.musicash_users for insert
  with check (auth.uid() = id);

create policy "usuário atualiza o próprio perfil"
  on public.musicash_users for update
  using (auth.uid() = id);
