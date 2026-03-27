# GuardanapON — Instruções para o Claude Code

## O que é
Marketplace de entretenimento ao vivo — clientes votam e pagam por músicas em tempo real, músicos recebem via split de pagamento.

## Stack
- Frontend: HTML/CSS/JS vanilla + Tailwind CSS
- Backend: Supabase (PostgreSQL + RLS + Realtime + Edge Functions)
- Deploy: Vercel
- Pagamentos: Mercado Pago (futuro) com split músico/restaurante/plataforma
- Integrações futuras: Spotify Web API, Cifra Club API
- Design system: Napkin Brutalism (fonte Epilogue + Space Grotesk + Indie Flower, cor primária `#d8ef00`)

## Roles de usuário
- **Cliente** — Home, Busca, Fila, Carteira, Perfil
- **Músico** — Cockpit (pedidos), Financeiro/Split, Perfil
- **Casa (restaurante)** — em desenvolvimento
- **Admin** — em desenvolvimento

## Split de pagamento padrão
- Músico: 70% | Restaurante: 20% | Plataforma: 10%
- Configurável por estabelecimento na tabela `restaurantes`

## Skills disponíveis

As skills estão em `.claude/skills/`. Sempre leia a skill relevante antes de executar uma tarefa.

### Desenvolvimento
| Skill | Quando usar |
|-------|-------------|
| `app-builder.md` | Criar ou expandir funcionalidades completas |
| `frontend-design.md` | Criar ou ajustar UI, componentes, layouts |
| `database-design.md` | Alterar schema, criar tabelas, índices, RLS, Realtime |
| `api-patterns.md` | Integrar Mercado Pago, Spotify API, Edge Functions |
| `tailwind-patterns.md` | Estilização com Tailwind CSS |
| `deployment-procedures.md` | Deploy na Vercel, variáveis de ambiente |
| `clean-code.md` | Sempre — padrões de código JS/HTML |
| `systematic-debugging.md` | Investigar e corrigir bugs |
| `code-review-checklist.md` | Revisar código antes de commit |
| `lint-and-validate.md` | Validar qualidade e consistência do código |
| `web-design-guidelines.md` | Revisar UI/UX |

### Produto
| Skill | Quando usar |
|-------|-------------|
| `user-story.md` | Escrever histórias para cada role (cliente, músico, casa) |
| `proto-persona.md` | Definir perfis dos 3 tipos de usuário |
| `jobs-to-be-done.md` | Entender o que cliente e músico querem realizar |
| `prioritization-advisor.md` | Decidir o que construir primeiro |
| `problem-framing-canvas.md` | Estruturar problemas antes de buildar |
| `pol-probe.md` | Documentar experimentos de validação |
| `pol-probe-advisor.md` | Escolher tipo de protótipo para validar hipóteses |

## Convenções do projeto
- Estética Napkin Brutalism: sombras sólidas sem blur, uppercase, bold
- Cor primária: `#d8ef00` (amarelo-lima)
- RLS ativo em todas as tabelas — sempre filtrar por `user_id` ou role
- Realtime habilitado nas tabelas `queue_items` e `votes`
- Edge Functions em Deno/TypeScript em `supabase/functions/`
- Não executa áudio (sem conflito com ECAD) — apenas metadados e links externos
