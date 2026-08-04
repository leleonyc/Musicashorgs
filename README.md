# MusiCash

App em React + Vite com login real por e-mail/senha (Supabase Auth), meta diária
que reseta a cada 24h e ciclo de saque de 30 dias que reinicia sozinho.

⚠️ **Aviso importante:** este app usa moeda fictícia. Não existe nenhum gateway
de pagamento (Pix, TED, etc.) conectado — os "saques" só ficam registrados no
banco de dados, sem gerar transferência real de dinheiro. Isso está declarado
na própria interface do app (aba Descobrir → "Ler mais"). Se você for
processar dinheiro de verdade, precisa integrar um gateway de pagamento e
ajustar esse aviso para refletir a realidade.

---

## 1. Rodar localmente

```bash
npm install
cp .env.example .env
# edite o .env com as chaves do seu projeto Supabase (passo 2)
npm run dev
```

Abre em `http://localhost:5173`.

---

## 2. Configurar o Supabase (passo a passo)

### 2.1 Criar o projeto
1. Entra em [supabase.com](https://supabase.com) → **New project**.
2. Escolhe um nome, senha do banco e região (South America se quiser mais perto do Brasil).
3. Espera o projeto terminar de provisionar (leva ~1-2 min).

### 2.2 Pegar as chaves da API
1. No painel do projeto, vai em **Project Settings** (ícone de engrenagem) → **API**.
2. Copia:
   - **Project URL** → cola em `VITE_SUPABASE_URL` no `.env`
   - **anon public key** → cola em `VITE_SUPABASE_ANON_KEY` no `.env`
3. **Nunca** use a `service_role key` no frontend — essa é só pra backend/servidor.

### 2.3 Criar a tabela e as permissões (RLS)
1. No painel do projeto, vai em **SQL Editor** → **New query**.
2. Abre o arquivo `supabase/schema.sql` deste projeto, copia todo o conteúdo e cola lá.
3. Clica em **Run**.
4. Isso cria a tabela `musicash_users` e as políticas de segurança (RLS) que
   garantem que cada usuário só vê e edita o próprio perfil — nunca o de outra pessoa.

### 2.4 Configurar o login por e-mail
1. Vai em **Authentication** → **Providers** → confirma que **Email** está habilitado (vem habilitado por padrão).
2. Vai em **Authentication** → **Settings** (ou **Sign In / Providers** → **Email**, dependendo da versão do painel):
   - Se quiser que qualquer pessoa consiga testar o app sem precisar confirmar
     o e-mail (mais fácil pra testar), **desmarca** a opção "Confirm email".
   - Se deixar **marcada** (recomendado para produção), o Supabase manda um
     e-mail de confirmação e a pessoa só consegue entrar depois de clicar no link.
3. (Opcional, mas recomendado antes de lançar de verdade) Em **Authentication** →
   **URL Configuration**, ajusta o **Site URL** para a URL final do seu app na
   Vercel (você vai pegar essa URL no passo 4). Isso faz os links de
   confirmação de e-mail apontarem pro lugar certo.

Pronto — o Supabase já está pronto para autenticar de verdade.

---

## 3. Subir para o GitHub

```bash
cd musicash
git init
git add .
git commit -m "MusiCash inicial"
```

1. Cria um repositório novo em [github.com/new](https://github.com/new) (pode
   deixar privado).
2. Copia a URL do repositório (ex.: `https://github.com/seu-usuario/musicash.git`)
   e roda:

```bash
git remote add origin https://github.com/seu-usuario/musicash.git
git branch -M main
git push -u origin main
```

O `.env` **não vai** para o GitHub (já está no `.gitignore`), então suas
chaves não ficam expostas publicamente ali. Só o `.env.example` (sem valores
reais) é versionado.

---

## 4. Publicar na Vercel

1. Entra em [vercel.com/new](https://vercel.com/new) e faz login com sua conta do GitHub.
2. Escolhe o repositório `musicash` que você acabou de subir.
3. A Vercel detecta automaticamente que é um projeto Vite — não precisa mudar
   build command nem output directory (`vite build` / `dist`, já vêm certos).
4. Antes de clicar em Deploy, expande **Environment Variables** e adiciona:
   - `VITE_SUPABASE_URL` → a mesma URL do seu `.env`
   - `VITE_SUPABASE_ANON_KEY` → a mesma anon key do seu `.env`
5. Clica em **Deploy**. Em ~1 minuto seu app estará no ar numa URL tipo
   `https://musicash-seunome.vercel.app`.
6. (Recomendado) Volta no Supabase → **Authentication** → **URL Configuration**
   e atualiza o **Site URL** para essa URL da Vercel, assim os e-mails de
   confirmação de cadastro apontam para o app já publicado.

Pronto — login, cadastro, meta diária e ciclo de saque de 30 dias já
funcionam de verdade, salvando tudo no seu banco Supabase.

---

## Estrutura do projeto

```
musicash/
├── src/
│   ├── App.jsx        ← o app inteiro (UI + lógica + Supabase)
│   ├── main.jsx        ← ponto de entrada do React
│   └── index.css       ← Tailwind
├── supabase/
│   └── schema.sql       ← script pra criar a tabela + permissões no Supabase
├── .env.example
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
└── vite.config.js
```
