# GuardanapON 🎵

Marketplace de entretenimento ao vivo — vote e peça músicas em tempo real.

---

## 📁 Estrutura do Projeto

```
guardanapon/
├── index.html          # App principal (todas as telas)
├── css/
│   └── styles.css      # Estilos (Napkin Brutalism)
├── js/
│   ├── app.js          # Lógica UI + navegação + interações
│   └── supabase.js     # Client Supabase + todas as queries
└── sql/
    └── schema.sql      # Schema completo do banco (PostgreSQL)
```

---

## 🚀 Setup Rápido

### 1. Supabase

1. Crie uma conta em [supabase.com](https://supabase.com)
2. Crie um novo projeto
3. No **SQL Editor**, execute o conteúdo de `sql/schema.sql`
4. Copie a **Project URL** e a **anon key** em:
   `Settings → API`

### 2. Configurar credenciais

Abra `js/supabase.js` e substitua:

```js
const SUPABASE_URL      = 'https://SEU_PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'SUA_ANON_KEY_AQUI';
```

### 3. Habilitar Realtime

No painel Supabase:
`Database → Replication → Supabase Realtime`
Ative as tabelas: `queue_items`, `votes`

### 4. Rodar localmente

Basta abrir `index.html` em qualquer servidor HTTP:

```bash
# Python
python3 -m http.server 8080

# Node
npx serve .

# VS Code
# Use a extensão "Live Server"
```

Acesse: `http://localhost:8080`

> ⚠️ **Modo Demo**: sem credenciais do Supabase, o app funciona totalmente offline com dados estáticos. Para testar, apenas abra o `index.html`.

---

## 👥 Papéis e Telas

| Role        | Telas disponíveis                                      |
|-------------|--------------------------------------------------------|
| **Cliente** | Home, Busca, Fila, Carteira, Perfil                   |
| **Músico**  | Cockpit (pedidos), Financeiro/Split, Perfil            |
| **Casa**    | (em desenvolvimento — usa telas de cliente por ora)    |
| **Admin**   | (em desenvolvimento)                                   |

---

## 💳 Integrações Futuras

| Serviço         | Finalidade                          | Arquivo         |
|-----------------|-------------------------------------|-----------------|
| Mercado Pago    | Checkout transparente + split       | Edge Function   |
| Spotify Web API | Metadados de músicas (capa, artista)| `js/supabase.js` |
| Cifra Club API  | Verificação de cifras disponíveis   | `js/supabase.js` |

### Edge Functions necessárias (Supabase Functions)

- `process-split` — Divide o pagamento entre músico/restaurante/plataforma
- `process-refund` — Reembolsa o cliente via Mercado Pago quando o músico recusa

---

## 🗄️ Modelo de Dados (resumo)

```
profiles       → usuários (cliente, músico, restaurante, admin)
wallets        → saldo de créditos do cliente
transactions   → extrato de movimentações
songs          → catálogo de músicas + flag has_chord
restaurantes   → dados do estabelecimento + % de split
eventos        → show/apresentação (músico ↔ restaurante)
queue_items    → fila de pedidos (voto ou pago)
votes          → votos na fila gratuita
earnings       → receita do músico por evento
```

---

## 🔑 Split de Pagamento (padrão)

```
Cliente paga R$ X
├── Músico:      70%
├── Restaurante: 20%
└── Plataforma:  10%
```

Configurável por estabelecimento na tabela `restaurantes`.

---

## 📱 Design System

- **Estética**: Napkin Brutalism — guardanapo de papel com tinta
- **Fonte display**: Epilogue (bold, uppercase)
- **Fonte corpo**: Space Grotesk
- **Fonte scribble**: Indie Flower
- **Cor primária**: `#d8ef00` (amarelo-lima)
- **Sombras**: ink shadows (offset sólido, sem blur)

---

## ⚖️ Legal

- O app exibe apenas **metadados** e links externos de cifras
- **Não executa áudio** (sem conflito com ECAD)
- Cifras são acessadas via WebView/link externo

---

*"Ideias direto na mesa."* ☕
