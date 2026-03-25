PLANILHA FINANCEIRA - VERSAO FINAL CONSOLIDADA

Base consolidada em uma unica versao, sem dividir por varios zips parciais.

O que esta junto nesta entrega:
- multipagina com arquivos JS separados
- lancamentos com parcelado dentro dos detalhes da saida
- dashboard com meta/deposito por historico
- pesquisa visual refinada
- admin visual refinado
- admin com acesso seguro (ativar/desativar, bloquear 24h, forcar senha, tornar admin)
- seletor de mes moderno
- botao "Mes atual" so aparece quando a planilha nao esta no mes atual

Arquivos SQL incluidos:
1) sql_migracao_financeira.sql
   Execute se ainda nao criou os campos financeiros novos.
2) sql_admin_acesso_seguro.sql
   Execute para habilitar as colunas e policies do admin de acesso seguro.
3) sql_verificacao_unico.sql
   Consulta unica para conferencia de estrutura.
4) sql_opcional_verificacao.sql
   Consulta complementar opcional.

Validacoes feitas nesta consolidacao:
- sintaxe dos arquivos JS validada com node --check
- referencias src/href dos HTML conferidas
- ids usados no JS conferidos contra os HTML
- ids duplicados por pagina verificados

Ordem sugerida:
1. subir os arquivos para a raiz do repositorio
2. executar os SQLs que faltarem no Supabase
3. redeploy na Vercel
4. testar login, dashboard, lancamentos, pesquisa e admin
