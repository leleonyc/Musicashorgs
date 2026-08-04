import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  Play, Pause, Star, Wallet, Music2, History, LogOut, CheckCircle2,
  ArrowRight, UserPlus, LogIn, Search, Target, CalendarClock, Mail, Lock,
} from "lucide-react";

// ---- Supabase --------------------------------------------------------------
// Preencha essas duas variáveis no seu .env (veja .env.example):
//   VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
//   VITE_SUPABASE_ANON_KEY=sua-anon-key
// (nunca use a service_role key no frontend, só a anon/public key)
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Login real com e-mail + senha via Supabase Auth. Cada usuário tem uma
// linha em musicash_users com o MESMO id do auth.users (chave estrangeira),
// e RLS garante que cada um só lê/escreve a própria linha.
//
// Tabela + policies esperadas no Supabase (rode isso no SQL Editor):
//
// create table public.musicash_users (
//   id uuid primary key references auth.users(id) on delete cascade,
//   name text not null,
//   phone text,
//   balance integer not null default 0,
//   ratings jsonb not null default '{}',
//   withdrawals jsonb not null default '[]',
//   daily_reset_at timestamptz not null default now(),  -- início da janela de 24h da meta diária
//   daily_count integer not null default 0,
//   created_at timestamptz not null default now(),
//   cycle_start_at timestamptz not null default now(),  -- início do ciclo atual de 30 dias
//   last_withdrawal_at timestamptz
// );
// alter table public.musicash_users enable row level security;
// create policy "usuário lê o próprio perfil" on public.musicash_users
//   for select using (auth.uid() = id);
// create policy "usuário cria o próprio perfil" on public.musicash_users
//   for insert with check (auth.uid() = id);
// create policy "usuário atualiza o próprio perfil" on public.musicash_users
//   for update using (auth.uid() = id);

// ---- regras do app ----------------------------------------------------------
const RATE_REWARD = 10;       // $ por avaliação
const DAILY_LIMIT = 10;       // avaliações por dia
const MIN_COMMENT = 50;       // caracteres mínimos no comentário
const WITHDRAW_CYCLE_DAYS = 30; // saque liberado a cada 30 dias, como um salário

const todayStr = () => new Date().toISOString().slice(0, 10);

// ---- motor de som -----------------------------------------------------------
// Nada de arquivos de áudio embutidos (que dependiam de um base64 gigante e
// não tocavam de forma confiável em todo navegador). Cada faixa agora é uma
// música curta GERADA NA HORA por osciladores do Web Audio API — sem
// nenhum arquivo, sem servidor, sem direitos de terceiros envolvidos, e com
// reprodução garantida porque quem "toca" o som é o próprio navegador do
// usuário, sintetizando notas em tempo real (como um instrumento).
const NOTE_FREQ = {
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, G3: 196.00, A3: 220.00, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.00, A4: 440.00, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00,
};

// cada "estilo" define timbre (forma de onda), andamento e duas frases
// melódicas (verso e refrão) mais uma linha de baixo — tudo autoral,
// gerado por matemática simples, então não há questão de direitos autorais.
const STYLES = {
  upbeat: {
    wave: "square", bpm: 132,
    bass: ["C3", "C3", "G3", "G3", "A3", "A3", "F3", "F3"],
    verse: ["C4", "E4", "G4", "C5", "G4", "E4", "D4", "E4"],
    chorus: ["E4", "G4", "C5", "E5", "C5", "G4", "A4", "G4"],
  },
  moody: {
    wave: "sine", bpm: 86,
    bass: ["A3", "A3", "F3", "F3", "C3", "C3", "G3", "G3"],
    verse: ["A3", "C4", "E4", "A4", "E4", "C4", "D4", "C4"],
    chorus: ["F3", "A3", "C4", "F4", "C4", "A3", "G3", "A3"],
  },
  swing: {
    wave: "triangle", bpm: 104,
    bass: ["G3", "G3", "D3", "D3", "C3", "C3", "A3", "A3"],
    verse: ["G3", "B3", "D4", "G4", "D4", "B3", "A3", "B3"],
    chorus: ["D4", "F4", "A4", "D5", "A4", "F4", "G4", "F4"],
  },
  aggro: {
    wave: "sawtooth", bpm: 152,
    bass: ["E3", "E3", "B3", "B3", "G3", "G3", "D3", "D3"],
    verse: ["E4", "G4", "B4", "E5", "B4", "G4", "F4", "G4"],
    chorus: ["G4", "B4", "D5", "G5", "D5", "B4", "C5", "B4"],
  },
};

// ---- legendas sincronizadas ------------------------------------------------
// Como as faixas são instrumentais sintetizadas (não existem gravações reais
// nem letras oficiais para elas), cada estilo tem uma pequena letra ORIGINAL,
// escrita para este app, que acompanha a reprodução em forma de legenda —
// útil pra quem não consegue ouvir o áudio.
const LYRIC_BANKS = {
  upbeat: [
    "a luz de neon pisca e ninguém dorme",
    "o batimento sobe, ninguém segura",
    "essa cidade inteira dança comigo",
    "(refrão) solta o corpo, deixa ir",
    "(refrão) que a noite não tem pressa",
    "cada esquina guarda um som novo",
    "o relógio para quando a batida entra",
    "de novo essa vibração, de novo esse instante",
  ],
  moody: [
    "o silêncio pesa mais que a palavra",
    "guardei essa lembrança num canto qualquer",
    "a chuva lava o que ainda dói",
    "(refrão) fico aqui, só respirando",
    "(refrão) o tempo passa devagar",
    "as sombras contam o que eu não digo",
    "um acorde solto no meio do quarto",
    "essa saudade tem o meu tamanho",
  ],
  swing: [
    "o violão embala essa tarde mansa",
    "descalço no chão, sem pressa nenhuma",
    "o vento traz um cheiro de mato molhado",
    "(refrão) deixa balançar, devagar",
    "(refrão) que a vida é feita de detalhes",
    "um verso solto na varanda",
    "essa melodia cabe no meu bolso",
    "o sol se deita e a gente continua",
  ],
  aggro: [
    "o grave bate igual coração acelerado",
    "essa raiva vira som, vira grito",
    "ninguém segura esse tanto de energia",
    "(refrão) levanta e não recua",
    "(refrão) quebra tudo que te prende",
    "a guitarra corta o ar como lâmina",
    "esse impulso não cabe no peito",
    "de pé até o fim, sem desculpa",
  ],
};

// gira a letra-base do estilo pra cada faixa não começar sempre na mesma linha
function getLyricLines(song) {
  const bank = LYRIC_BANKS[song.style];
  const n = parseInt(song.id.slice(1), 10) || 0;
  const rot = n % bank.length;
  return [...bank.slice(rot), ...bank.slice(0, rot)];
}

const TRACK_DURATION = 60; // duração "virtual" de cada faixa no app
const CHORUS_OFFSETS = [20, 15, 25, 30, 10, 22, 18, 26, 20, 24];
const COVERS = ["🌆", "🌊", "☀️", "🔌", "🍃", "⚙️", "🌙", "🔥", "❄️", "🌸", "🌵", "🌀", "🎆", "🌫️", "⭐"];
const GENRES = ["Synthwave", "Indie Folk", "Pop", "Eletrônica", "MPB", "Rock", "Lo-fi", "Trap", "Bossa Nova", "Reggae", "Funk", "Samba", "Jazz", "Metal", "Punk"];
const TITLE_A = ["Noites de", "Luz de", "Eco de", "Sombra de", "Fogo em", "Chuva de", "Vento de", "Silêncio em", "Brilho de", "Deserto de", "Onda de", "Cristal de", "Poeira de", "Rastro de", "Farol de", "Névoa de", "Ritmo de", "Pulso de", "Aurora em", "Constelação de"];
const TITLE_B = ["Neon", "Vidro", "Concreto", "Papel", "Ferro", "Âmbar", "Grafite", "Marfim", "Cobre", "Sal", "Nuvem", "Espelho", "Pedra", "Fumaça", "Estrela", "Madeira", "Metal", "Cinza", "Ouro", "Prata", "Vento", "Chama", "Gelo", "Areia", "Lua"];
const ART_A = ["Vetor", "Zona", "Costa", "Máquina", "Rio", "Campo", "Círculo", "Vale", "Torre", "Ilha", "Bairro", "Praça", "Estação", "Distrito", "Litoral"];
const ART_B = ["Cromático", "Sul", "Cinza", "Lenta", "Solar", "Nórdico", "Elétrico", "Selvagem", "Urbano", "Profundo", "Lunar", "Noturno", "Errante", "Coletivo", "Central"];

// cada gênero usa um dos 4 estilos sonoros (o clima combina com o gênero)
const GENRE_STYLE = {
  Synthwave: "upbeat", Pop: "upbeat", Eletrônica: "upbeat", Funk: "upbeat",
  Rock: "moody", "Lo-fi": "moody", Jazz: "moody",
  "Indie Folk": "swing", MPB: "swing", "Bossa Nova": "swing", Reggae: "swing", Samba: "swing",
  Trap: "aggro", Metal: "aggro", Punk: "aggro",
};

// gradiente premium por estilo, usado como "capa" de cada faixa
const COVER_GRADIENTS = {
  upbeat: "linear-gradient(155deg, #3fae66 0%, #123a20 100%)",
  moody: "linear-gradient(155deg, #4b3f8a 0%, #1c1730 100%)",
  swing: "linear-gradient(155deg, #d4a853 0%, #4a350f 100%)",
  aggro: "linear-gradient(155deg, #d1425a 0%, #3a0f18 100%)",
};

function generateSongs() {
  const list = [];
  let idx = 0;
  for (let a = 0; a < TITLE_A.length; a++) {
    for (let b = 0; b < TITLE_B.length; b++) {
      const genre = GENRES[idx % GENRES.length];
      list.push({
        id: `g${idx}`,
        title: `${TITLE_A[a]} ${TITLE_B[b]}`,
        artist: `${ART_A[idx % ART_A.length]} ${ART_B[(idx * 3) % ART_B.length]}`,
        genre,
        cover: COVERS[idx % COVERS.length],
        style: GENRE_STYLE[genre],
        duration: TRACK_DURATION,
        chorusAt: CHORUS_OFFSETS[idx % CHORUS_OFFSETS.length],
      });
      idx++;
    }
  }
  return list;
}
const SONGS = generateSongs(); // 20 x 25 = 500 faixas

const fmtTime = (secs) => {
  if (!secs || !isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

// ---- CSS próprio (evita classes Tailwind arbitrárias, que não são
// compiladas neste ambiente e deixavam botões/cores sem efeito) ----
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,500;0,600;0,700;0,800;1,500;1,600&family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap');

  * { font-family: 'Outfit', -apple-system, sans-serif; }
  h1, h2, .mc-display { font-family: 'Bodoni Moda', serif; font-weight: 700; letter-spacing: -0.01em; }
  .mc-code, .mc-mono { font-family: 'JetBrains Mono', monospace; }

  .mc-app {
    background:
      radial-gradient(50vw 50vw at 50% -10%, rgba(212,168,83,0.10), transparent 62%),
      radial-gradient(40vw 40vw at 100% 100%, rgba(212,168,83,0.06), transparent 60%),
      linear-gradient(180deg, #030303 0%, #070706 50%, #030303 100%);
    color:#f3ede0; min-height:100vh; width:100%;
  }
  .mc-muted { color:#a89f8c; }
  .mc-faint { color:#5c5648; }
  .mc-panel {
    background:linear-gradient(180deg, rgba(243,237,224,0.035), rgba(243,237,224,0.012));
    border:1px solid rgba(212,168,83,0.16);
    box-shadow: 0 1px 0 rgba(243,237,224,0.03) inset, 0 10px 30px -14px rgba(0,0,0,0.75);
    backdrop-filter: blur(16px);
    transition: border-color .2s ease, transform .15s ease, box-shadow .2s ease;
  }
  .mc-panel-hover:hover { background:linear-gradient(180deg, rgba(243,237,224,0.06), rgba(243,237,224,0.02)); border-color:rgba(212,168,83,0.4); }
  .mc-input, .mc-textarea {
    background:rgba(243,237,224,0.03); color:#f3ede0; border:1px solid rgba(212,168,83,0.18); width:100%;
    transition: border-color .15s ease, background-color .15s ease;
  }
  .mc-input:focus, .mc-textarea:focus { border-color:#d4a853; outline:none; background:rgba(212,168,83,0.06); box-shadow:0 0 0 3px rgba(212,168,83,0.12); }
  .mc-btn-primary {
    background:linear-gradient(135deg, #f2d38a 0%, #d4a853 45%, #9c7326 100%); color:#1a1305; font-weight:700; border:none; cursor:pointer;
    box-shadow: 0 6px 24px -8px rgba(212,168,83,0.6), 0 1px 0 rgba(255,255,255,0.3) inset;
    transition: filter .15s ease, transform .12s ease, box-shadow .2s ease;
  }
  .mc-btn-primary:hover:not(:disabled) { filter:brightness(1.1); transform:translateY(-1px); box-shadow: 0 12px 32px -8px rgba(212,168,83,0.75), 0 1px 0 rgba(255,255,255,0.3) inset; }
  .mc-btn-primary:active:not(:disabled) { transform:scale(0.98); }
  .mc-btn-primary:disabled { opacity:0.35; cursor:not-allowed; box-shadow:none; }
  .mc-btn-outline {
    background:rgba(243,237,224,0.02); color:#f3ede0; border:1px solid rgba(212,168,83,0.25); cursor:pointer;
    transition: border-color .15s ease, background-color .15s ease, transform .12s ease;
  }
  .mc-btn-outline:hover:not(:disabled) { border-color:#d4a853; background:rgba(212,168,83,0.08); }
  .mc-btn-outline:active:not(:disabled) { transform:scale(0.98); }
  .mc-btn-outline:disabled { opacity:0.35; cursor:not-allowed; }
  .mc-btn-ghost { background:transparent; border:none; color:#a89f8c; cursor:pointer; transition:color .15s ease; }
  .mc-btn-ghost:hover { color:#f3ede0; }
  .mc-green-text { color:#6fbf8f; }
  .mc-green-border { border-color:#4a9e6d !important; }
  .mc-gold-text { color:#d4a853; }
  .mc-header { background:rgba(3,3,3,0.85); backdrop-filter:blur(18px) saturate(140%); border-bottom:1px solid rgba(212,168,83,0.14); }
  .mc-glowbox { animation:mc-pulse 3.2s ease-in-out infinite; }
  @keyframes mc-pulse {
    0%, 100% { box-shadow:0 0 26px rgba(212,168,83,0.35); }
    50% { box-shadow:0 0 50px rgba(212,168,83,0.6); }
  }
  .mc-blob { position:absolute; border-radius:9999px; filter:blur(100px); pointer-events:none; }
  .mc-eyebrow {
    font-family:'JetBrains Mono',monospace; font-size:11.5px; letter-spacing:.16em; text-transform:uppercase;
    color:#d4a853; display:inline-flex; align-items:center; gap:9px;
  }
  .mc-eyebrow::before, .mc-eyebrow::after { content:""; width:14px; height:1px; background:rgba(212,168,83,0.5); }
  .mc-tab-active { color:#f3ede0; position:relative; }
  .mc-tab-active::after {
    content:""; position:absolute; left:0; right:0; bottom:-1px; height:2px; border-radius:2px;
    background:linear-gradient(90deg, #9c7326, #f2d38a, #9c7326);
    box-shadow:0 0 8px rgba(212,168,83,0.7);
  }
  .mc-tab { color:#786f5c; cursor:pointer; background:none; border:none; position:relative; transition:color .15s ease; }
  .mc-tab:hover { color:#d8cfb8; }
  .mc-star-on { fill:#d4a853; color:#d4a853; filter:drop-shadow(0 0 4px rgba(212,168,58,0.5)); }
  .mc-star-off { color:#332e22; }
  .mc-star-off:hover { color:#d4a853; }
  .mc-error { color:#e08a7c; }
  .mc-progress-track { background:rgba(243,237,224,0.06); border-radius:9999px; height:8px; overflow:hidden; }
  .mc-progress-fill { background:linear-gradient(90deg, #9c7326, #f2d38a); height:100%; transition:width .4s ease; box-shadow:0 0 10px rgba(212,168,83,0.5); }
  .mc-badge { background:rgba(243,237,224,0.03); border:1px solid rgba(212,168,83,0.2); border-radius:9999px; padding:2px 10px; font-size:11px; }
  .mc-seek-track { position:relative; background:rgba(243,237,224,0.1); border-radius:9999px; height:4px; cursor:pointer; }
  .mc-seek-track:hover .mc-seek-fill { filter:brightness(1.15); }
  .mc-seek-fill { background:linear-gradient(90deg, #9c7326, #f2d38a); height:100%; border-radius:9999px; position:relative; box-shadow:0 0 8px rgba(212,168,83,0.6); }
  .mc-seek-thumb {
    position:absolute; top:50%; width:12px; height:12px; border-radius:9999px; background:#f3ede0;
    transform:translate(-50%, -50%); box-shadow:0 1px 4px rgba(0,0,0,0.6), 0 0 0 3px rgba(212,168,83,0.3);
  }
  .mc-time { font-size:11px; color:#786f5c; font-variant-numeric:tabular-nums; font-family:'JetBrains Mono',monospace; }
  .mc-mode-btn { font-size:11px; padding:3px 9px; border-radius:9999px; border:1px solid rgba(212,168,83,0.2); background:transparent; color:#786f5c; cursor:pointer; transition:border-color .15s ease, color .15s ease; }
  .mc-mode-btn:hover { border-color:#d4a853; color:#f3ede0; }
  .mc-mode-btn-active { border-color:#d4a853; color:#d4a853; background:rgba(212,168,83,0.12); }
  .mc-yt-btn { font-size:11px; padding:3px 9px; border-radius:9999px; border:1px solid rgba(212,168,83,0.2); background:transparent; color:#786f5c; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; gap:4px; transition:border-color .15s ease, color .15s ease; }
  .mc-yt-btn:hover { border-color:#FF3B3B; color:#f3ede0; }
  .mc-lyrics { padding:10px 14px 14px; border-top:1px solid rgba(212,168,83,0.14); }
  .mc-lyric-line { font-size:12px; text-align:center; padding:2px 0; transition:color .2s ease, font-weight .2s ease; }
  .mc-lyric-dim { color:#5c5648; }
  .mc-lyric-current { color:#d4a853; font-weight:700; font-size:14px; text-shadow:0 0 12px rgba(212,168,83,0.4); }

  .mc-cover { position:relative; overflow:hidden; box-shadow:0 4px 14px -4px rgba(0,0,0,0.7), 0 0 0 1px rgba(212,168,83,0.15) inset; }
  .mc-cover::after { content:""; position:absolute; inset:0; background:linear-gradient(155deg, rgba(255,255,255,0.14), transparent 55%); }
  .mc-eq { display:flex; align-items:flex-end; gap:2px; height:14px; }
  .mc-eq span { width:3px; background:#f3ede0; border-radius:2px; animation:mc-eq-bounce 0.9s ease-in-out infinite; }
  .mc-eq span:nth-child(1) { animation-delay:0s; }
  .mc-eq span:nth-child(2) { animation-delay:0.2s; }
  .mc-eq span:nth-child(3) { animation-delay:0.4s; }
  @keyframes mc-eq-bounce { 0%, 100% { height:4px; opacity:.7; } 50% { height:13px; opacity:1; } }
  .mc-chip {
    background:rgba(243,237,224,0.04); border:1px solid rgba(212,168,83,0.18); border-radius:9999px;
    padding:1px 8px; font-size:10px; font-weight:600; letter-spacing:.02em; color:#c9bfa5;
  }
  .mc-wallet-pill {
    background:linear-gradient(135deg, rgba(212,168,83,0.2), rgba(212,168,83,0.05));
    border:1px solid rgba(212,168,83,0.45);
    box-shadow:0 0 18px -4px rgba(212,168,83,0.45);
  }
  .mc-scale-in { animation:mc-scale-in .25s cubic-bezier(.2,.9,.3,1.2); }
  @keyframes mc-scale-in { from { opacity:0; transform:scale(0.97) translateY(4px); } to { opacity:1; transform:scale(1) translateY(0); } }

  /* emblema do logo: anel dourado fino, sem preenchimento sólido — assinatura mais luxo */
  .mc-emblem { padding:2px; background:linear-gradient(155deg, #f2d38a, #9c7326); box-shadow:0 6px 20px -6px rgba(212,168,83,0.55); }
  .mc-emblem-inner { background:#0a0a09; width:100%; height:100%; display:flex; align-items:center; justify-content:center; }
  .mc-logo-mark { position:relative; font-family:'Bodoni Moda', serif; font-weight:700; color:#d4a853; line-height:1; display:inline-block; }
  .mc-logo-bar { position:absolute; left:-22%; right:-22%; top:54%; height:2px; background:linear-gradient(90deg, transparent, #d4a853 20%, #d4a853 80%, transparent); }
`;

// marca própria: um "M" com um traço horizontal (referência a símbolo de moeda),
// dentro do anel dourado — em vez de um ícone genérico ou texto "M$"
function Logo({ size = 80, radius = 20, glow = false }) {
  return (
    <div className={`mc-emblem${glow ? " mc-glowbox" : ""}`} style={{ width: size, height: size, borderRadius: radius }}>
      <div className="mc-emblem-inner" style={{ borderRadius: Math.max(0, radius - 2) }}>
        <span className="mc-logo-mark" style={{ fontSize: size * 0.46 }}>
          M<span className="mc-logo-bar" />
        </span>
      </div>
    </div>
  );
}

export default function MusiCash() {
  const [view, setView] = useState("landing");
  const [loginForm, setLoginForm] = useState({ email: "", senha: "" });
  const [createForm, setCreateForm] = useState({ nome: "", telefone: "", email: "", senha: "" });
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const [tab, setTab] = useState("descobrir");
  const [userId, setUserId] = useState(null);
  const [balance, setBalance] = useState(0);
  const [ratings, setRatings] = useState({}); // { [songId]: {stars, comment, date} }
  const [withdrawals, setWithdrawals] = useState([]);
  const [lastWithdrawalAt, setLastWithdrawalAt] = useState(null);
  const [createdAt, setCreatedAt] = useState(null);
  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [dailyResetAt, setDailyResetAt] = useState(new Date().toISOString());
  const [dailyCount, setDailyCount] = useState(0);
  const [cycleStartAt, setCycleStartAt] = useState(new Date().toISOString());
  const [loaded, setLoaded] = useState(false);

  const [playingId, setPlayingId] = useState(null);
  const [playMode, setPlayMode] = useState({}); // { [songId]: "chorus" | "full" }
  const [progress, setProgress] = useState({}); // { [songId]: currentTimeSeconds }
  const [playError, setPlayError] = useState(""); // mensagem real de erro, se o navegador bloquear o áudio
  const [soundCheck, setSoundCheck] = useState(""); // resultado do teste de som isolado
  const seekTrackRefs = useRef({});

  // ---- motor de áudio: Web Audio API sintetizando notas em tempo real.
  // Não depende de nenhum arquivo de música — por isso funciona sempre e
  // não usa nada com direitos autorais de terceiros. ----
  const audioCtxRef = useRef(null);
  const activeNodesRef = useRef([]); // osciladores tocando agora, p/ poder parar
  const schedulerTimerRef = useRef(null);
  const nextNoteTimeRef = useRef(0);
  const noteIndexRef = useRef(0);
  const playingIdRef = useRef(null); // espelha playingId dentro do loop
  const playModeRef = useRef("full");
  const rafRef = useRef(null);
  const playStartWallRef = useRef(0);
  const playStartOffsetRef = useRef(0);

  const getAudioCtx = () => {
    if (!audioCtxRef.current) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) throw new Error("Web Audio API indisponível neste navegador");
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === "suspended") {
      audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const stopSound = useCallback(() => {
    if (schedulerTimerRef.current) {
      clearTimeout(schedulerTimerRef.current);
      schedulerTimerRef.current = null;
    }
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    activeNodesRef.current.forEach(({ osc, gain }) => {
      try { gain.gain.cancelScheduledValues(0); } catch (e) { /* já parado */ }
      try { osc.stop(); } catch (e) { /* já parado */ }
    });
    activeNodesRef.current = [];
    playingIdRef.current = null;
  }, []);

  // agenda uma nota (melodia + baixo) num instante exato do relógio de áudio
  const scheduleNote = (ctx, style, mode) => {
    const beat = 60 / style.bpm;
    const time = nextNoteTimeRef.current;
    const pattern = mode === "chorus" ? style.chorus : style.verse;
    const idx = noteIndexRef.current % pattern.length;
    const note = pattern[idx];
    const freq = NOTE_FREQ[note];

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = style.wave;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(0.14, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + beat * 0.92);
    osc.connect(gain).connect(ctx.destination);
    osc.start(time);
    osc.stop(time + beat);
    activeNodesRef.current.push({ osc, gain });
    osc.onended = () => {
      activeNodesRef.current = activeNodesRef.current.filter((n) => n.osc !== osc);
    };

    // linha de baixo, uma nota a cada dois tempos de melodia
    if (idx % 2 === 0) {
      const bassNote = style.bass[Math.floor(idx / 2) % style.bass.length];
      const bassFreq = NOTE_FREQ[bassNote] / 2;
      const bosc = ctx.createOscillator();
      const bgain = ctx.createGain();
      bosc.type = "sine";
      bosc.frequency.value = bassFreq;
      bgain.gain.setValueAtTime(0.0001, time);
      bgain.gain.linearRampToValueAtTime(0.11, time + 0.03);
      bgain.gain.exponentialRampToValueAtTime(0.0001, time + beat * 1.85);
      bosc.connect(bgain).connect(ctx.destination);
      bosc.start(time);
      bosc.stop(time + beat * 2);
      activeNodesRef.current.push({ osc: bosc, gain: bgain });
      bosc.onended = () => {
        activeNodesRef.current = activeNodesRef.current.filter((n) => n.osc !== bosc);
      };
    }

    noteIndexRef.current += 1;
    nextNoteTimeRef.current += beat;
  };

  // scheduler com "lookahead": agenda notas um pouco à frente do tempo real,
  // padrão recomendado para Web Audio (evita falhas de timing do JS)
  const runScheduler = (songId, style) => {
    if (playingIdRef.current !== songId) return;
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const scheduleAhead = 0.2;
    while (nextNoteTimeRef.current < ctx.currentTime + scheduleAhead) {
      scheduleNote(ctx, style, playModeRef.current);
    }
    schedulerTimerRef.current = setTimeout(() => runScheduler(songId, style), 50);
  };

  const playSong = useCallback((song, fromTime, mode) => {
    stopSound();
    setPlayError("");
    playingIdRef.current = song.id;
    playModeRef.current = mode;
    noteIndexRef.current = 0;

    // tenta iniciar o áudio, mas a legenda sincronizada abaixo funciona de
    // qualquer forma — assim quem não consegue ouvir ainda acompanha a faixa
    let ctx = null;
    try {
      ctx = getAudioCtx();
    } catch (err) {
      setPlayError(`Sem áudio disponível neste navegador (${err?.message || "erro desconhecido"}) — a legenda abaixo continua funcionando.`);
    }
    if (ctx) {
      const style = STYLES[song.style];
      nextNoteTimeRef.current = ctx.currentTime + 0.05;
      runScheduler(song.id, style);
    }

    playStartWallRef.current = performance.now();
    playStartOffsetRef.current = fromTime;
    setPlayingId(song.id);

    const tick = () => {
      if (playingIdRef.current !== song.id) return;
      const elapsed = playStartOffsetRef.current + (performance.now() - playStartWallRef.current) / 1000;
      if (elapsed >= song.duration) {
        stopSound();
        setPlayingId(null);
        setProgress((p2) => ({ ...p2, [song.id]: 0 }));
        return;
      }
      setProgress((p2) => ({ ...p2, [song.id]: elapsed }));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [stopSound]);

  // teste isolado: um bipe curto, só pra confirmar se o aparelho/navegador
  // consegue emitir som (não depende do catálogo de músicas)
  const runSoundCheck = () => {
    setSoundCheck("Tocando teste…");
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 440;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.2, ctx.currentTime + 0.02);
      gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.45);
      setTimeout(() => {
        setSoundCheck(`Bipe disparado sem erros (contexto: ${ctx.state}). Se não ouviu nada, o problema é volume/mudo/modo silencioso no aparelho, não o app.`);
      }, 500);
    } catch (err) {
      setSoundCheck(`Erro ao tentar tocar som: ${err?.name || "erro"} — ${err?.message || "sem detalhes"}`);
    }
  };

  useEffect(() => {
    return () => {
      stopSound();
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch (e) { /* já fechado */ }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const [expandedId, setExpandedId] = useState(null);
  const [draftStars, setDraftStars] = useState(0);
  const [draftComment, setDraftComment] = useState("");

  const [wForm, setWForm] = useState({ nome: "", telefone: "", valor: "" });
  const [wMsg, setWMsg] = useState("");
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  // ---- persistência real: cada usuário é uma linha na tabela musicash_users
  // do Supabase, com o MESMO id da conta em auth.users. Ao logar/criar conta,
  // carregamos os dados direto do banco pro estado (veja submitLogin/
  // confirmCreate). Daqui em diante, qualquer mudança em saldo, avaliações,
  // saques etc. é salva de volta na mesma linha, então o progresso e o
  // contador de dias aparecem certos em qualquer sessão/dispositivo. ----
  const [saveError, setSaveError] = useState("");
  const persist = useCallback(async (next) => {
    if (!userId) return;
    const { error } = await supabase.from("musicash_users").upsert({
      id: userId,
      name: nome,
      phone: telefone,
      balance: next.balance,
      ratings: next.ratings,
      withdrawals: next.withdrawals,
      daily_reset_at: next.dailyResetAt,
      daily_count: next.dailyCount,
      created_at: createdAt,
      cycle_start_at: next.cycleStartAt,
      last_withdrawal_at: next.lastWithdrawalAt,
    });
    if (error) {
      console.error("Falha ao salvar no Supabase", error);
      setSaveError("Não deu para salvar seu progresso agora. Verifique sua conexão.");
    } else if (saveError) {
      setSaveError("");
    }
  }, [userId, nome, telefone, createdAt, saveError]);

  useEffect(() => {
    if (!authed || !loaded || !userId) return;
    persist({ balance, ratings, withdrawals, dailyResetAt, dailyCount, cycleStartAt, lastWithdrawalAt });
  }, [balance, ratings, withdrawals, dailyResetAt, dailyCount, cycleStartAt, lastWithdrawalAt, authed, loaded, userId, persist]);

  useEffect(() => {
    if (!authed) {
      setWForm((f) => ({ ...f, nome: "", telefone: "" }));
    } else {
      setWForm((f) => ({ ...f, nome: nome || f.nome, telefone: telefone || f.telefone }));
    }
  }, [authed, nome, telefone]);

  // formata telefone como (11) 91234-5678 enquanto digita
  const formatPhone = (v) => {
    const digits = v.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  // aplica no estado do app o id de sessão + uma linha vinda da tabela
  // musicash_users, e entra no app
  const applyLoadedUser = (uid, row) => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // meta diária: janela rolante de 24h (não é "dia de calendário")
    const rawDailyReset = row.daily_reset_at ?? row.created_at ?? nowIso;
    const hoursSinceDailyReset = (now - new Date(rawDailyReset).getTime()) / 3600000;
    const dailyExpired = hoursSinceDailyReset >= 24;

    // ciclo de saque: janela rolante de 30 dias (30 x 24h), que reinicia
    // sozinha ao completar, mesmo sem saque
    const rawCycleStart = row.cycle_start_at ?? row.created_at ?? nowIso;
    const daysSinceCycle = (now - new Date(rawCycleStart).getTime()) / 86400000;
    const cycleExpired = daysSinceCycle >= WITHDRAW_CYCLE_DAYS;

    setUserId(uid);
    setBalance(row.balance ?? 0);
    setRatings(row.ratings ?? {});
    setWithdrawals(row.withdrawals ?? []);
    setCreatedAt(row.created_at ?? nowIso);
    setNome(row.name ?? "");
    setTelefone(row.phone ?? "");
    setDailyResetAt(dailyExpired ? nowIso : rawDailyReset);
    setDailyCount(dailyExpired ? 0 : (row.daily_count ?? 0));
    setCycleStartAt(cycleExpired ? nowIso : rawCycleStart);
    setLastWithdrawalAt(row.last_withdrawal_at ?? null);
    setAuthed(true);
    setLoaded(true);
    setView("app");
  };

  // busca (ou cria, se ainda não existir) a linha de perfil de um usuário
  // logado no Supabase Auth e aplica no estado do app
  const loadProfileForSession = async (authUser, fallbackName) => {
    const { data: row, error } = await supabase
      .from("musicash_users")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle();
    if (error) throw error;

    if (row) {
      applyLoadedUser(authUser.id, row);
      return;
    }

    // primeiro login depois da confirmação de e-mail: ainda não existe
    // perfil, então criamos um agora
    const fresh = {
      id: authUser.id,
      name: fallbackName || authUser.user_metadata?.name || "",
      phone: "",
      balance: 0,
      ratings: {},
      withdrawals: [],
      daily_reset_at: new Date().toISOString(),
      daily_count: 0,
      created_at: new Date().toISOString(),
      cycle_start_at: new Date().toISOString(),
      last_withdrawal_at: null,
    };
    const { error: insertError } = await supabase.from("musicash_users").insert(fresh);
    if (insertError) throw insertError;
    applyLoadedUser(authUser.id, fresh);
  };

  // ---- sessão automática: se o navegador já tem uma sessão válida do
  // Supabase (login anterior), entra direto sem pedir e-mail/senha de novo ----
  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const session = data?.session;
      if (session?.user) {
        try {
          await loadProfileForSession(session.user);
        } catch (e) {
          console.error("Falha ao restaurar sessão", e);
        }
      }
      setCheckingSession(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user && authed) {
        // sessão encerrada em outra aba, por exemplo
        setAuthed(false);
        setLoaded(false);
        setView("landing");
      }
    });
    return () => {
      active = false;
      sub?.subscription?.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- criar acesso ----
  const submitCreateStep1 = (e) => {
    e.preventDefault();
    const digits = createForm.telefone.replace(/\D/g, "");
    if (!createForm.nome.trim() || digits.length < 10 || !createForm.email.trim() || createForm.senha.length < 6) {
      setAuthError("Preencha nome, telefone válido (com DDD), e-mail e uma senha com pelo menos 6 caracteres.");
      return;
    }
    setAuthError("");
    setView("confirmarDados");
  };

  const confirmCreate = async () => {
    setAuthError("");
    setAuthBusy(true);
    const digits = createForm.telefone.replace(/\D/g, "");
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email: createForm.email.trim(),
        password: createForm.senha,
        options: { data: { name: createForm.nome.trim() } },
      });
      if (signUpError) throw signUpError;

      // se a confirmação de e-mail estiver ligada no projeto, ainda não
      // existe sessão aqui — avisamos a pessoa a checar a caixa de entrada
      if (!data.session) {
        setAuthError("Conta criada! Confira seu e-mail para confirmar o cadastro e depois entre normalmente.");
        setView("landing");
        return;
      }

      const record = {
        id: data.user.id,
        name: createForm.nome.trim(),
        phone: digits,
        balance: 0,
        ratings: {},
        withdrawals: [],
        daily_reset_at: new Date().toISOString(),
        daily_count: 0,
        created_at: new Date().toISOString(),
        cycle_start_at: new Date().toISOString(),
        last_withdrawal_at: null,
      };
      const { error: insertError } = await supabase.from("musicash_users").insert(record);
      if (insertError) throw insertError;

      applyLoadedUser(data.user.id, record);
    } catch (e) {
      console.error("Falha ao criar conta", e);
      setAuthError(`Não deu para criar sua conta: ${e?.message || String(e)}`);
      setView("create");
    } finally {
      setAuthBusy(false);
    }
  };

  // ---- login ----
  const submitLogin = async (e) => {
    e.preventDefault();
    setAuthError("");
    if (!loginForm.email.trim() || !loginForm.senha) {
      setAuthError("Preencha e-mail e senha.");
      return;
    }
    setAuthBusy(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: loginForm.email.trim(),
        password: loginForm.senha,
      });
      if (error) throw error;

      await loadProfileForSession(data.user);
    } catch (e) {
      console.error("Falha ao entrar", e);
      setAuthError(
        e?.message?.includes("Invalid login credentials")
          ? "E-mail ou senha incorretos."
          : `Não deu para conectar: ${e?.message || String(e)}`
      );
    } finally {
      setAuthBusy(false);
    }
  };

  const handleLogout = async () => {
    stopSound();
    setPlayingId(null);
    await supabase.auth.signOut();
    setAuthed(false);
    setLoaded(false);
    setUserId(null);
    setLoginForm({ email: "", senha: "" });
    setCreateForm({ nome: "", telefone: "", email: "", senha: "" });
    setBalance(0);
    setRatings({});
    setWithdrawals([]);
    setCreatedAt(null);
    setNome("");
    setTelefone("");
    setDailyResetAt(new Date().toISOString());
    setDailyCount(0);
    setCycleStartAt(new Date().toISOString());
    setView("landing");
  };

  // ---- player ----
  const startPlayback = (song, mode) => {
    if (playingId === song.id && playMode[song.id] === mode) {
      stopSound();
      setPlayingId(null);
      return;
    }
    const fromTime = mode === "chorus" ? song.chorusAt : 0;
    setPlayMode((m) => ({ ...m, [song.id]: mode }));
    playSong(song, fromTime, mode);
  };

  const togglePlayPause = (song) => {
    if (playingId === song.id) {
      stopSound();
      setPlayingId(null);
      return;
    }
    const mode = playMode[song.id] || "full";
    setPlayMode((m) => ({ ...m, [song.id]: mode }));
    playSong(song, progress[song.id] || 0, mode);
  };

  const seekTo = (song, clientX) => {
    const track = seekTrackRefs.current[song.id];
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const newTime = ratio * song.duration;
    setProgress((p) => ({ ...p, [song.id]: newTime }));
    if (playingId === song.id) {
      playSong(song, newTime, playMode[song.id] || "full");
    }
  };

  const handleSeekDown = (song, e) => {
    e.preventDefault();
    seekTo(song, e.clientX);
    const onMove = (ev) => seekTo(song, ev.clientX);
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleSeekTouch = (song, e) => {
    const touch = e.touches[0];
    if (touch) seekTo(song, touch.clientX);
  };

  // ---- relógio vivo: recalcula a cada minuto (e reseta sozinho quando as
  // janelas de 24h/30 dias viram), mesmo que o usuário fique com a aba
  // aberta o tempo todo, sem precisar dar F5 ou logar de novo ----
  const [, tick] = useState(0);
  useEffect(() => {
    if (!authed || !loaded) return;
    const id = setInterval(() => {
      const now = Date.now();

      // meta diária: vira sozinha 24h depois do último reset
      if (dailyResetAt && now - new Date(dailyResetAt).getTime() >= 24 * 3600000) {
        setDailyResetAt(new Date(now).toISOString());
        setDailyCount(0);
      }

      // ciclo de saque: completa 30 "voltas" de 24h e reinicia sozinho,
      // mesmo que o usuário não tenha sacado nesse meio tempo
      if (cycleStartAt && now - new Date(cycleStartAt).getTime() >= WITHDRAW_CYCLE_DAYS * 86400000) {
        setCycleStartAt(new Date(now).toISOString());
      }

      tick((t) => t + 1); // força recálculo das barras de progresso
    }, 60000);
    return () => clearInterval(id);
  }, [authed, loaded, dailyResetAt, cycleStartAt]);

  // ---- avaliação (estrelas + comentário, com limite diário rolante de 24h) ----
  const hoursSinceDailyReset = dailyResetAt ? (Date.now() - new Date(dailyResetAt).getTime()) / 3600000 : 24;
  const todayCount = hoursSinceDailyReset >= 24 ? 0 : dailyCount;
  const hoursUntilDailyReset = Math.max(0, 24 - hoursSinceDailyReset);
  const limitReached = todayCount >= DAILY_LIMIT;

  const openRating = (songId) => {
    if (ratings[songId] || limitReached) return;
    setExpandedId(songId);
    setDraftStars(0);
    setDraftComment("");
  };

  const cancelRating = () => {
    setExpandedId(null);
    setDraftStars(0);
    setDraftComment("");
  };

  const submitRating = (songId) => {
    if (limitReached || ratings[songId]) return;
    if (draftStars < 1) return;
    if (draftComment.trim().length < MIN_COMMENT) return;

    setRatings((r) => ({ ...r, [songId]: { stars: draftStars, comment: draftComment.trim(), date: new Date().toLocaleString("pt-BR") } }));
    setBalance((b) => b + RATE_REWARD);
    if (hoursSinceDailyReset >= 24) {
      setDailyResetAt(new Date().toISOString());
      setDailyCount(1);
    } else {
      setDailyCount((c) => c + 1);
    }
    cancelRating();
  };

  // ---- saque: ciclo rolante de 30 x 24h, como um salário. Ao completar as
  // 30 voltas, o ciclo reinicia sozinho (veja o relógio vivo acima) — o
  // saque fica liberado assim que o ciclo bate 30 dias, e some de novo caso
  // o usuário deixe passar sem sacar, porque o próximo ciclo já começou. ----
  const daysSinceCycleStart = cycleStartAt ? (Date.now() - new Date(cycleStartAt).getTime()) / 86400000 : 0;
  const daysUntilNextWithdraw = Math.max(0, WITHDRAW_CYCLE_DAYS - daysSinceCycleStart);
  const canWithdraw = daysSinceCycleStart >= WITHDRAW_CYCLE_DAYS && balance > 0;

  const submitWithdraw = (e) => {
    e.preventDefault();
    if (!canWithdraw) return;
    const valor = Number(wForm.valor);
    const digits = wForm.telefone.replace(/\D/g, "");
    if (!wForm.nome.trim() || digits.length < 10 || !valor || valor <= 0) {
      setWMsg("Preencha nome, telefone e valor válidos.");
      return;
    }
    if (valor > balance) {
      setWMsg("Saldo insuficiente para esse saque.");
      return;
    }
    const novo = { id: Date.now(), nome: wForm.nome, telefone: wForm.telefone, valor, data: new Date().toLocaleString("pt-BR") };
    setWithdrawals((w) => [novo, ...w]);
    setBalance((b) => b - valor);
    const nowIso = new Date().toISOString();
    setLastWithdrawalAt(nowIso);
    setCycleStartAt(nowIso); // saca e já reinicia o ciclo de 30 dias
    setNome(wForm.nome);
    setTelefone(wForm.telefone);
    setWForm((f) => ({ ...f, valor: "" }));
    setWMsg("Saque solicitado com sucesso.");
    setTimeout(() => setWMsg(""), 3500);
  };

  const filteredSongs = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SONGS;
    return SONGS.filter(
      (s) => s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q) || s.genre.toLowerCase().includes(q)
    );
  }, [search]);

  const Style = () => <style>{CSS}</style>;

  // =========================================================================
  // CARREGANDO SESSÃO — checa se já existe login salvo no navegador
  // =========================================================================
  if (checkingSession) {
    return (
      <div className="mc-app flex flex-col items-center justify-center px-6">
        <Style />
        <Logo size={64} radius={16} glow />
        <p className="mc-muted text-sm mt-5">Carregando...</p>
      </div>
    );
  }

  // =========================================================================
  // LANDING / LOGIN — primeira tela do app: entrar com e-mail + senha
  // =========================================================================
  if (view === "landing") {
    return (
      <div className="mc-app flex flex-col items-center justify-center px-6 relative overflow-hidden">
        <Style />
        <div className="mc-blob" style={{ top: "-8rem", left: "-8rem", width: "26rem", height: "26rem", background: "rgba(212,168,83,0.16)" }} />
        <div className="mc-blob" style={{ bottom: "-8rem", right: "-8rem", width: "26rem", height: "26rem", background: "rgba(212,168,83,0.08)" }} />
        <div className="relative w-full max-w-sm mc-scale-in" style={{ zIndex: 1 }}>
          <div className="flex flex-col items-center text-center mb-8">
            <div className="mb-6">
              <Logo size={80} radius={20} glow />
            </div>
            <span className="mc-eyebrow mb-4">Acesso pessoal</span>
            <h1 className="mc-display text-4xl tracking-tight">MusiCash</h1>
            <p className="mc-muted mt-3 leading-relaxed">
              Entre com seu e-mail e senha para acessar seu saldo.
            </p>
          </div>

          <form onSubmit={submitLogin} className="mc-panel rounded-2xl p-6 space-y-4">
            <div>
              <label className="mc-muted block text-xs font-semibold uppercase tracking-wide mb-2">E-mail</label>
              <div className="relative">
                <Mail className="mc-muted absolute left-3 top-1/2 -translate-y-1/2" size={16} />
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(e) => setLoginForm((f) => ({ ...f, email: e.target.value }))}
                  className="mc-input pl-10 pr-4 py-3 rounded-xl"
                  placeholder="voce@email.com"
                  autoComplete="email"
                />
              </div>
            </div>
            <div>
              <label className="mc-muted block text-xs font-semibold uppercase tracking-wide mb-2">Senha</label>
              <div className="relative">
                <Lock className="mc-muted absolute left-3 top-1/2 -translate-y-1/2" size={16} />
                <input
                  type="password"
                  value={loginForm.senha}
                  onChange={(e) => setLoginForm((f) => ({ ...f, senha: e.target.value }))}
                  className="mc-input pl-10 pr-4 py-3 rounded-xl"
                  placeholder="Sua senha"
                  autoComplete="current-password"
                />
              </div>
            </div>
            {authError && <p className="mc-error text-xs">{authError}</p>}
            <button type="submit" disabled={authBusy} className="mc-btn-primary w-full py-3 rounded-full flex items-center justify-center gap-2">
              {authBusy ? "Entrando..." : (<>Entrar <LogIn size={16} /></>)}
            </button>
          </form>

          <button
            onClick={() => { setView("create"); setAuthError(""); }}
            className="mc-btn-outline w-full py-3.5 rounded-full flex items-center justify-center gap-2 mt-3"
          >
            <UserPlus size={18} /> Ainda não tenho acesso
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // CRIAR ACESSO
  // =========================================================================
  if (view === "create") {
    return (
      <div className="mc-app flex items-center justify-center p-6">
        <Style />
        <div className="w-full max-w-sm mc-scale-in">
          <button onClick={() => { setView("landing"); setAuthError(""); }} className="mc-btn-ghost text-sm mb-6">← voltar</button>
          <h2 className="mc-display text-2xl mb-1">Criar meu acesso</h2>
          <p className="mc-muted text-sm mb-6">Preencha seus dados para continuar.</p>
          <form onSubmit={submitCreateStep1} className="mc-panel rounded-2xl p-6 space-y-4">
            <div>
              <label className="mc-muted block text-xs font-semibold uppercase tracking-wide mb-2">Nome</label>
              <input value={createForm.nome} onChange={(e) => setCreateForm((f) => ({ ...f, nome: e.target.value }))} className="mc-input px-4 py-3 rounded-xl" placeholder="Seu nome" />
            </div>
            <div>
              <label className="mc-muted block text-xs font-semibold uppercase tracking-wide mb-2">Telefone</label>
              <input
                type="tel"
                inputMode="tel"
                value={createForm.telefone}
                onChange={(e) => setCreateForm((f) => ({ ...f, telefone: formatPhone(e.target.value) }))}
                className="mc-input px-4 py-3 rounded-xl"
                placeholder="(11) 91234-5678"
              />
            </div>
            <div>
              <label className="mc-muted block text-xs font-semibold uppercase tracking-wide mb-2">E-mail</label>
              <input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                className="mc-input px-4 py-3 rounded-xl"
                placeholder="voce@email.com"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="mc-muted block text-xs font-semibold uppercase tracking-wide mb-2">Senha</label>
              <input
                type="password"
                value={createForm.senha}
                onChange={(e) => setCreateForm((f) => ({ ...f, senha: e.target.value }))}
                className="mc-input px-4 py-3 rounded-xl"
                placeholder="Mínimo 6 caracteres"
                autoComplete="new-password"
              />
            </div>
            {authError && <p className="mc-error text-xs">{authError}</p>}
            <button type="submit" className="mc-btn-primary w-full py-3 rounded-full flex items-center justify-center gap-2">
              Confirmar <ArrowRight size={16} />
            </button>
          </form>
        </div>
      </div>
    );
  }

  // =========================================================================
  // CONFIRMAR DADOS
  // =========================================================================
  if (view === "confirmarDados") {
    return (
      <div className="mc-app flex items-center justify-center p-6">
        <Style />
        <div className="w-full max-w-sm mc-scale-in">
          <button onClick={() => setView("create")} className="mc-btn-ghost text-sm mb-6">← voltar</button>
          <div className="flex flex-col items-center mb-6 text-center">
            <div className="mc-panel w-14 h-14 rounded-full flex items-center justify-center mb-4" style={{ borderColor: "rgba(212,168,83,0.5)" }}>
              <UserPlus className="mc-gold-text" size={24} />
            </div>
            <h2 className="mc-display text-xl">Confirme seus dados</h2>
          </div>
          <div className="mc-panel rounded-2xl p-6 space-y-3 mb-6">
            <div><p className="mc-muted text-xs uppercase font-semibold">Nome</p><p className="font-semibold">{createForm.nome}</p></div>
            <div><p className="mc-muted text-xs uppercase font-semibold">Telefone</p><p className="font-semibold break-all">{createForm.telefone}</p></div>
          </div>
          {authError && <p className="mc-error text-xs mb-3">{authError}</p>}
          <button onClick={confirmCreate} disabled={authBusy} className="mc-btn-primary w-full py-3.5 rounded-full flex items-center justify-center gap-2 text-base">
            {authBusy ? "Criando..." : (<>Confirmar e entrar <ArrowRight size={18} /></>)}
          </button>
        </div>
      </div>
    );
  }

  // =========================================================================
  // APP PRINCIPAL
  // =========================================================================
  const ratedCount = Object.keys(ratings).length;

  return (
    <div className="mc-app flex flex-col">
      <Style />
      <header className="mc-header sticky top-0 z-10 px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo size={36} radius={10} />
          <span className="mc-display tracking-tight text-lg">MusiCash</span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="mc-badge mc-muted hidden sm:inline-block">{todayCount}/{DAILY_LIMIT} hoje</span>
          <div className="mc-wallet-pill flex items-center gap-1.5 rounded-full px-3.5 py-1.5">
            <Wallet size={14} className="mc-gold-text" />
            <span className="font-bold text-sm">${balance}</span>
          </div>
          <button onClick={handleLogout} className="mc-btn-ghost"><LogOut size={18} /></button>
        </div>
      </header>

      <nav className="hidden sm:flex px-5 gap-6" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        {[
          { id: "descobrir", label: "Descobrir" },
          { id: "historico", label: "Minhas avaliações" },
          { id: "sacar", label: "Sacar" },
        ].map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`py-3 text-sm font-semibold ${tab === t.id ? "mc-tab-active" : "mc-tab"}`}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="flex-1 px-5 py-6 pb-28 sm:pb-6 max-w-2xl w-full mx-auto mc-scale-in">
        {tab === "descobrir" && (
          <div>
            <p className="mc-muted text-sm mb-3">
              Ouça a faixa inteira ou pule direto para o refrão, dê de 1 a 5 estrelas e escreva pelo menos {MIN_COMMENT} caracteres sobre ela. Ganhe ${RATE_REWARD} por avaliação.
            </p>
            <div className="mc-panel rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="flex items-center gap-1.5 text-sm font-semibold"><Target size={14} className="mc-gold-text" /> Meta diária</span>
                <span className="mc-muted text-xs">{todayCount}/{DAILY_LIMIT} avaliações</span>
              </div>
              <div className="mc-progress-track"><div className="mc-progress-fill" style={{ width: `${Math.min(100, (todayCount / DAILY_LIMIT) * 100)}%` }} /></div>
            </div>
            <div className="mc-panel rounded-xl p-3 mb-4 text-sm flex items-center justify-between gap-3">
              <span className="mc-muted">Não sai som nenhum? Teste isolado, sem depender do catálogo:</span>
              <button onClick={runSoundCheck} className="mc-btn-outline text-xs px-3 py-1.5 rounded-full shrink-0">Testar som</button>
            </div>
            {soundCheck && <p className="mc-faint text-xs mb-4">{soundCheck}</p>}
            {playError && <p className="mc-error text-xs mb-4">{playError}</p>}
            {limitReached && (
              <div className="mc-panel rounded-xl p-3 mb-4 text-sm mc-error">
                Meta diária concluída ({DAILY_LIMIT}/{DAILY_LIMIT})! Libera de novo em {Math.ceil(hoursUntilDailyReset)}h.
              </div>
            )}
            <div className="relative mb-4">
              <Search className="mc-muted absolute left-3 top-1/2 -translate-y-1/2" size={16} />
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setVisibleCount(20); }}
                placeholder="Buscar por título, artista ou gênero…"
                className="mc-input pl-10 pr-4 py-2.5 rounded-lg text-sm"
              />
            </div>

            <div className="space-y-3">
              {filteredSongs.slice(0, visibleCount).map((song) => {
                const already = ratings[song.id];
                const isPlaying = playingId === song.id;
                const isExpanded = expandedId === song.id;
                const current = progress[song.id] || 0;
                const pct = song.duration ? Math.min(100, (current / song.duration) * 100) : 0;
                const mode = playMode[song.id];

                return (
                  <div key={song.id} className="mc-panel mc-panel-hover rounded-2xl overflow-hidden">
                    <div className="p-4 flex items-center gap-4">
                      <div
                        className="mc-cover w-12 h-12 rounded-xl flex items-center justify-center text-2xl shrink-0"
                        style={{ background: COVER_GRADIENTS[song.style] }}
                      >
                        {isPlaying ? (
                          <div className="mc-eq"><span /><span /><span /></div>
                        ) : (
                          <span style={{ position: "relative", zIndex: 1 }}>{song.cover}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold truncate">{song.title}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <p className="mc-muted text-xs truncate">{song.artist}</p>
                          <span className="mc-chip shrink-0">{song.genre}</span>
                        </div>
                        {already ? (
                          <span className="mc-green-text text-xs mt-1.5 inline-flex items-center gap-1">
                            <CheckCircle2 size={12} /> Avaliado — {already.stars}★ · +${RATE_REWARD}
                          </span>
                        ) : (
                          <button
                            onClick={() => openRating(song.id)}
                            disabled={limitReached}
                            className="mc-btn-outline text-xs mt-1.5 px-3 py-1 rounded-full"
                          >
                            Avaliar
                          </button>
                        )}
                      </div>
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <button
                          onClick={() => togglePlayPause(song)}
                          className="mc-btn-primary w-11 h-11 rounded-full flex items-center justify-center"
                          aria-label={isPlaying ? "Pausar" : "Ouvir música inteira"}
                        >
                          {isPlaying ? <Pause size={17} fill="#1a1305" /> : <Play size={17} fill="#1a1305" style={{ marginLeft: 2 }} />}
                        </button>
                      </div>
                    </div>

                    {/* mini player: barra de progresso + pular para o refrão */}
                    <div className="px-4 pb-3 flex items-center gap-3">
                      <span className="mc-time w-9 text-right">{fmtTime(current)}</span>
                      <div
                        ref={(el) => (seekTrackRefs.current[song.id] = el)}
                        className="mc-seek-track flex-1"
                        onMouseDown={(e) => handleSeekDown(song, e)}
                        onTouchStart={(e) => handleSeekTouch(song, e)}
                        onTouchMove={(e) => handleSeekTouch(song, e)}
                        role="slider"
                        aria-label={`Progresso de ${song.title}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(pct)}
                      >
                        <div className="mc-seek-fill" style={{ width: `${pct}%` }}>
                          <div className="mc-seek-thumb" style={{ left: "100%" }} />
                        </div>
                      </div>
                      <span className="mc-time w-9">{fmtTime(song.duration)}</span>
                      <button
                        onClick={() => startPlayback(song, "chorus")}
                        className={`mc-mode-btn ${isPlaying && mode === "chorus" ? "mc-mode-btn-active" : ""}`}
                        title="Pular para o refrão"
                      >
                        Refrão
                      </button>
                      <a
                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${song.title} ${song.artist}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mc-yt-btn"
                        title="Buscar esse título no YouTube (faixa fictícia, gerada neste app — a busca pode não trazer resultado)"
                      >
                        ▶ YouTube
                      </a>
                    </div>

                    {isPlaying && (() => {
                      const lines = getLyricLines(song);
                      const lineIdx = Math.min(lines.length - 1, Math.floor((current / song.duration) * lines.length));
                      return (
                        <div className="mc-lyrics">
                          {lineIdx > 0 && <p className="mc-lyric-line mc-lyric-dim">{lines[lineIdx - 1]}</p>}
                          <p className="mc-lyric-line mc-lyric-current">{lines[lineIdx]}</p>
                          {lineIdx < lines.length - 1 && <p className="mc-lyric-line mc-lyric-dim">{lines[lineIdx + 1]}</p>}
                        </div>
                      );
                    })()}

                    {isExpanded && (
                      <div className="p-4 pt-0 space-y-3" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                        <div className="flex items-center gap-1 pt-3">
                          {[1, 2, 3, 4, 5].map((n) => (
                            <button key={n} onClick={() => setDraftStars(n)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                              <Star size={22} className={n <= draftStars ? "mc-star-on" : "mc-star-off"} />
                            </button>
                          ))}
                        </div>
                        <textarea
                          value={draftComment}
                          onChange={(e) => setDraftComment(e.target.value)}
                          placeholder="O que você achou dessa faixa?"
                          rows={3}
                          className="mc-textarea rounded-lg px-3 py-2 text-sm"
                        />
                        <p className={`text-xs ${draftComment.trim().length >= MIN_COMMENT ? "mc-green-text" : "mc-faint"}`}>
                          {draftComment.trim().length}/{MIN_COMMENT} caracteres
                        </p>
                        <div className="flex gap-2">
                          <button onClick={cancelRating} className="mc-btn-outline flex-1 py-2 rounded-full text-sm">Cancelar</button>
                          <button
                            onClick={() => submitRating(song.id)}
                            disabled={draftStars < 1 || draftComment.trim().length < MIN_COMMENT}
                            className="mc-btn-primary flex-1 py-2 rounded-full text-sm"
                          >
                            Enviar avaliação
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {visibleCount < filteredSongs.length && (
              <button onClick={() => setVisibleCount((v) => v + 20)} className="mc-btn-outline w-full py-3 rounded-full mt-4 text-sm">
                Carregar mais ({filteredSongs.length - visibleCount} restantes)
              </button>
            )}
          </div>
        )}

        {tab === "historico" && (
          <div>
            <p className="mc-muted text-sm mb-4">{ratedCount} faixas avaliadas.</p>
            <div className="space-y-2">
              {Object.entries(ratings).map(([songId, r]) => {
                const song = SONGS.find((s) => s.id === songId);
                if (!song) return null;
                return (
                  <div key={songId} className="mc-panel rounded-xl p-3">
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-3">
                        <span className="text-xl">{song.cover}</span>
                        <div>
                          <p className="text-sm font-semibold">{song.title}</p>
                          <p className="mc-muted text-xs">{song.artist}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="mc-green-text text-sm font-bold flex items-center gap-1"><Star size={12} className="mc-star-on" /> {r.stars}</span>
                        <span className="mc-muted text-xs">+${RATE_REWARD}</span>
                      </div>
                    </div>
                    <p className="mc-muted text-sm mt-2">{r.comment}</p>
                  </div>
                );
              })}
              {ratedCount === 0 && <p className="mc-faint text-sm text-center py-10">Nenhuma avaliação ainda. Vá em "Descobrir" e avalie uma faixa.</p>}
            </div>
          </div>
        )}

        {tab === "sacar" && (
          <div>
            <div className="mc-panel mc-wallet-pill rounded-2xl p-5 mb-4 flex items-center justify-between">
              <span className="mc-muted text-sm">Saldo disponível</span>
              <span className="mc-gold-text text-3xl mc-display">${balance}</span>
            </div>

            {saveError && <p className="mc-error text-xs mb-4">{saveError}</p>}

            <div className="mc-panel rounded-xl p-5 mb-5 space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="flex items-center gap-1.5 text-sm font-semibold"><CalendarClock size={14} className="mc-gold-text" /> Ciclo de saque (30 em 30 dias)</span>
                  <span className="mc-muted text-xs">{Math.min(Math.floor(daysSinceCycleStart), WITHDRAW_CYCLE_DAYS)}/{WITHDRAW_CYCLE_DAYS} dias</span>
                </div>
                <div className="mc-progress-track"><div className="mc-progress-fill" style={{ width: `${Math.min(100, (daysSinceCycleStart / WITHDRAW_CYCLE_DAYS) * 100)}%` }} /></div>
                <p className="mc-faint text-xs mt-2">
                  Assim como um salário, o saque é liberado uma vez a cada {WITHDRAW_CYCLE_DAYS} dias — isso ajuda nossos contadores a organizar certinho o dinheiro de cada ciclo antes de fechar o período. Se não for sacado a tempo, o ciclo reinicia sozinho e uma nova contagem de {WITHDRAW_CYCLE_DAYS} dias começa.
                </p>
              </div>
            </div>

            {!canWithdraw && (
              <p className="mc-faint text-xs mb-4">
                {balance <= 0
                  ? "Você ainda não tem saldo para sacar."
                  : `Faltam ${Math.ceil(daysUntilNextWithdraw)} dia(s) para liberar seu próximo saque.`}
              </p>
            )}

            <form onSubmit={submitWithdraw} className="mc-panel rounded-xl p-5 space-y-4">
              <div>
                <label className="mc-muted block text-xs font-semibold uppercase mb-1.5">Nome</label>
                <input
                  type="text"
                  value={wForm.nome}
                  onChange={(e) => setWForm((f) => ({ ...f, nome: e.target.value }))}
                  className="mc-input rounded-lg px-3 py-2.5 text-sm"
                  placeholder="Seu nome"
                  readOnly={!!nome}
                />
              </div>
              <div>
                <label className="mc-muted block text-xs font-semibold uppercase mb-1.5">Telefone</label>
                <input
                  type="tel"
                  inputMode="tel"
                  value={wForm.telefone}
                  onChange={(e) => setWForm((f) => ({ ...f, telefone: formatPhone(e.target.value) }))}
                  className="mc-input rounded-lg px-3 py-2.5 text-sm"
                  placeholder="(11) 91234-5678"
                  readOnly={!!telefone}
                />
              </div>
              <div>
                <label className="mc-muted block text-xs font-semibold uppercase mb-1.5">Valor ($)</label>
                <input type="number" min="1" value={wForm.valor} onChange={(e) => setWForm((f) => ({ ...f, valor: e.target.value }))} className="mc-input rounded-lg px-3 py-2.5 text-sm" placeholder="0" />
              </div>
              <button type="submit" disabled={!canWithdraw} className="mc-btn-primary w-full py-3 rounded-full">
                {canWithdraw ? "Solicitar saque" : "Requisitos não atingidos"}
              </button>
              {wMsg && <p className="mc-green-text text-sm text-center">{wMsg}</p>}
            </form>

            {withdrawals.length > 0 && (
              <div className="mt-6">
                <div className="mc-muted flex items-center gap-2 text-xs font-semibold uppercase mb-2"><History size={14} /> Histórico de saques</div>
                <div className="space-y-2">
                  {withdrawals.map((w) => (
                    <div key={w.id} className="mc-panel rounded-xl p-3 flex items-center justify-between text-sm">
                      <div>
                        <p className="font-semibold">{w.nome}</p>
                        <p className="mc-muted text-xs break-all">{w.telefone}</p>
                        <p className="mc-faint text-xs">{w.data}</p>
                      </div>
                      <span className="mc-green-text font-bold">-${w.valor}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-6 text-center max-w-md mx-auto">
              <p className="mc-faint text-xs leading-relaxed">
                MusiCash é um app feito para mostrar na prática um app de avaliação de músicas com recompensas.
                {showDisclaimer && (
                  <>
                    {" "}As faixas do catálogo são geradas ao vivo por um sintetizador simples rodando no seu navegador (nenhum arquivo de áudio, nenhum direito autoral de terceiros envolvido), e os nomes de artistas e títulos são todos fictícios. Seu cadastro, saldo, avaliações e saques ficam salvos de verdade e persistem entre sessões. Ainda assim, os saques registrados aqui não geram nenhuma transferência real de dinheiro — o MusiCash usa moeda fictícia e não tem valor monetário real.
                  </>
                )}
              </p>
              <button onClick={() => setShowDisclaimer((v) => !v)} className="mc-btn-ghost mc-faint text-[10px] mt-1.5 underline">
                {showDisclaimer ? "Ler menos" : "Ler mais"}
              </button>
            </div>
          </div>
        )}
      </main>

      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-20 flex items-stretch mc-header" style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        {[
          { id: "descobrir", label: "Descobrir", Icon: Search },
          { id: "historico", label: "Avaliações", Icon: History },
          { id: "sacar", label: "Sacar", Icon: Wallet },
        ].map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className="flex-1 flex flex-col items-center justify-center gap-1 py-2.5"
              style={{ color: active ? "#d4a853" : "#786f5c" }}
            >
              <t.Icon size={20} strokeWidth={active ? 2.4 : 2} style={active ? { filter: "drop-shadow(0 0 6px rgba(34,217,103,0.6))" } : undefined} />
              <span className="text-[11px] font-semibold">{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
