(function(){
  var cfg = window.APP_CONFIG;
  var C = window.AppCommon;
  var supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  var state = { receitas: [], despesas: [], parcelas: [], adminAtivo: false, currentUserId: null, filtroTipoPesquisa: 'todos', editandoItem: null, user: null, profileUsername: '', metaDepositadoTotal: 0, metaTabAtiva: 'meta', adminBusca: '', adminFiltro: 'todos', adminProfiles: [] };
  function q(id){ return C.qs(id); }
  function exists(id){ return !!q(id); }
  function getPage(){ return document.body.getAttribute('data-page') || 'dashboard'; }

  function setupMonthPicker(hiddenId, options){
    options = options || {};
    var hidden = q(hiddenId);
    var monthSelect = q(hiddenId + 'Mes');
    var yearSelect = q(hiddenId + 'Ano');
    if (!hidden || !monthSelect || !yearSelect) return;
    var allowEmpty = !!options.allowEmpty;
    var now = new Date();
    var startYear = options.startYear || (now.getFullYear() - 3);
    var endYear = options.endYear || (now.getFullYear() + 2);
    var months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    monthSelect.innerHTML = allowEmpty ? '<option value="">Mês</option>' : '';
    months.forEach(function(nome, index){ monthSelect.insertAdjacentHTML('beforeend', '<option value="' + String(index + 1).padStart(2,'0') + '">' + nome + '</option>'); });
    yearSelect.innerHTML = allowEmpty ? '<option value="">Ano</option>' : '';
    for (var year = endYear; year >= startYear; year--) yearSelect.insertAdjacentHTML('beforeend', '<option value="' + year + '">' + year + '</option>');
    function syncSelectsFromHidden(){
      var value = hidden.value || '';
      if (/^\d{4}-\d{2}$/.test(value)) {
        yearSelect.value = value.slice(0,4);
        monthSelect.value = value.slice(5,7);
      } else if (allowEmpty) {
        yearSelect.value = '';
        monthSelect.value = '';
      } else {
        var fallback = C.currentMonthRef();
        hidden.value = fallback;
        yearSelect.value = fallback.slice(0,4);
        monthSelect.value = fallback.slice(5,7);
      }
    }
    function syncHiddenFromSelects(){
      var year = yearSelect.value || '';
      var month = monthSelect.value || '';
      hidden.value = year && month ? (year + '-' + month) : '';
      hidden.dispatchEvent(new Event('change', { bubbles:true }));
    }
    monthSelect.addEventListener('change', syncHiddenFromSelects);
    yearSelect.addEventListener('change', syncHiddenFromSelects);
    hidden._syncMonthPicker = syncSelectsFromHidden;
    syncSelectsFromHidden();
  }
  function syncMonthPickerUI(hiddenId){ var hidden = q(hiddenId); if (hidden && typeof hidden._syncMonthPicker === 'function') hidden._syncMonthPicker(); }
  function getPlanilhaMesAtivo(){ var input = q('planilhaMes'); return input && /^\d{4}-\d{2}$/.test(input.value || '') ? input.value : C.getStoredPlanilhaMes(); }
  function updateMonthResetVisibility(){ if (!exists('btnMesAtual') || !exists('planilhaMes')) return; var atual = C.currentMonthRef(); var ativo = q('planilhaMes').value || atual; q('btnMesAtual').hidden = ativo === atual; }
  function syncPlanilhaMesUI(){ var mes = getPlanilhaMesAtivo(); var input = q('planilhaMes'); if (input && input.value !== mes) input.value = mes; syncMonthPickerUI('planilhaMes'); C.setStoredPlanilhaMes(mes); if (exists('planilhaMesLabel')) q('planilhaMesLabel').textContent = C.monthLabelLong(mes); if (exists('periodoAtualDescricao')) q('periodoAtualDescricao').textContent = C.monthLabelLong(mes); updateMonthResetVisibility(); }
  function toIsoDateSafe(value){ return value ? String(value).slice(0,10) : ''; }
  function getItemDate(item){ return toIsoDateSafe(item && (item.vencimento || item.created_at) || ''); }
  function isInPlanilhaMesByDate(iso){ return !!iso && iso.slice(0,7) === getPlanilhaMesAtivo(); }
  function receitasDoMesAtivo(){ return state.receitas.filter(function(item){ return isInPlanilhaMesByDate(getItemDate(item)); }); }
  function despesasDoMesAtivo(){ return state.despesas.filter(function(item){ return isInPlanilhaMesByDate(getItemDate(item)); }); }
  function parcelasDoMesAtivo(){ return state.parcelas.filter(function(item){ return isInPlanilhaMesByDate(getItemDate(item)); }); }
  function parcelasPendentesDoMesAtivo(){ return parcelasDoMesAtivo().filter(function(item){ return item.status !== 'paga'; }); }
  function valorMensalParcela(item){ return item.recorrente ? item.valor_total : (item.quantidade > 0 ? item.valor_total / item.quantidade : item.valor_total); }
  function dividirCategorias(textoCategorias, valor) {
    var partes = String(textoCategorias || '').split(',').map(function(v){ return v.trim(); }).filter(Boolean);
    var categorias = partes.length ? partes : ['Sem categoria'];
    var valorPorCategoria = valor / categorias.length;
    return categorias.map(function(cat){ return { categoria: cat, valor: valorPorCategoria }; });
  }
  function buildCreatedAtForPlanilha(){ var ref = getPlanilhaMesAtivo(); var hoje = new Date(); var atual = C.currentMonthRef(hoje); if (ref === atual) return hoje.toISOString(); return ref + '-15T12:00:00'; }
  async function getSessionUser(){ var result = await supabaseClient.auth.getSession(); return result && result.data && result.data.session && result.data.session.user || null; }
  async function verificarAdmin(userId, userEmail) {
    var email = String(userEmail || '').trim().toLowerCase();
    if (cfg.ADMIN_EMAILS.indexOf(email) >= 0) return true;
    var result = await supabaseClient.from('user_roles').select('role').eq('user_id', userId).maybeSingle();
    if (result.error) return false;
    return !!(result.data && result.data.role === 'admin');
  }
  async function vincularContaGoogleSeNecessario(user){
    if (!user || !user.app_metadata || user.app_metadata.provider !== 'google') return;
    try { await supabaseClient.rpc('link_google_account'); } catch (error) {}
  }
  function mesclarProviderExistente(atual, novo){
    var base = String(atual || '').trim(); var add = String(novo || '').trim();
    if (!base) return add || 'email'; if (!add) return base;
    var itens = base.split('+').map(function(v){ return v.trim().toLowerCase(); }).filter(Boolean);
    var alvo = add.toLowerCase(); if (itens.indexOf(alvo) >= 0) return base; return base + ' + ' + add;
  }
  async function upsertPerfilUsuario(user){
    if (!user) return;
    var email = user.email || '';
    var meta = user.user_metadata || {};
    var username = String(meta.preferred_username || meta.user_name || meta.name || email.split('@')[0] || 'usuario').trim();
    var providerAtual = user.app_metadata && user.app_metadata.provider || 'email';
    var existente = await supabaseClient.from('user_profiles').select('*').eq('user_id', user.id).maybeSingle();
    var provider = mesclarProviderExistente(existente.data && existente.data.provider, providerAtual);
    await supabaseClient.from('user_profiles').upsert({ user_id:user.id, username:username, email:email, provider:provider, created_at:(existente.data && existente.data.created_at) || user.created_at || new Date().toISOString(), last_login_at:new Date().toISOString(), is_active: existente.data && typeof existente.data.is_active === 'boolean' ? existente.data.is_active : true, blocked_until: existente.data && existente.data.blocked_until || null, force_password_reset: existente.data && !!existente.data.force_password_reset }, { onConflict:'user_id' });
  }
  async function getOwnProfile(userId){
    if (!userId) return null;
    var result = await supabaseClient.from('user_profiles').select('*').eq('user_id', userId).maybeSingle();
    return result && result.data || null;
  }
  async function validarAcessoUsuarioLogado(){
    var profile = await getOwnProfile(state.user && state.user.id);
    if (!profile) return true;
    if (profile.is_active === false) {
      await supabaseClient.auth.signOut();
      window.location.replace('index.html');
      return false;
    }
    if (profile.blocked_until && new Date(profile.blocked_until).getTime() > Date.now()) {
      await supabaseClient.auth.signOut();
      window.location.replace('index.html');
      return false;
    }
    if (profile.force_password_reset) {
      window.location.replace('index.html#force-reset');
      return false;
    }
    return true;
  }
  function isUserBlocked(profile){ return !!(profile && profile.blocked_until && new Date(profile.blocked_until).getTime() > Date.now()); }
  function formatUserStatus(profile){ return profile && profile.is_active === false ? 'Desativado' : 'Ativo'; }
  function formatBlockStatus(profile){ return isUserBlocked(profile) ? ('Até ' + C.formatarDataHora(profile.blocked_until)) : 'Livre'; }
  async function enviarResetAdmin(email){
    var result = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + window.location.pathname.replace(/[^/]+$/, '') + 'index.html' });
    return !result.error;
  }
  async function carregarMetaDoBanco(userId){
    var result = await supabaseClient.from('metas').select('valor, depositado').eq('user_id', userId).maybeSingle();
    if (result.error) return { valor:1000, depositado:0 };
    return { valor: result.data && Number(result.data.valor) || 1000, depositado: result.data && Number(result.data.depositado) || 0 };
  }
  async function salvarMetaNoBanco(){
    if (!state.user) return;
    var valor = exists('metaInput') ? Number(q('metaInput').value) || 1000 : 1000;
    await supabaseClient.from('metas').upsert({ user_id: state.user.id, valor:valor, depositado:state.metaDepositadoTotal || 0 }, { onConflict:'user_id' });
  }
  function setMetaTab(tab){
    state.metaTabAtiva = tab === 'deposito' ? 'deposito' : 'meta';
    Array.prototype.forEach.call(document.querySelectorAll('[data-meta-tab]'), function(btn){ btn.classList.toggle('active', btn.dataset.metaTab === state.metaTabAtiva); });
    if (exists('metaTabMeta')) q('metaTabMeta').style.display = state.metaTabAtiva === 'meta' ? 'block' : 'none';
    if (exists('metaTabDeposito')) q('metaTabDeposito').style.display = state.metaTabAtiva === 'deposito' ? 'block' : 'none';
  }
  async function adicionarDepositoMeta(){
    if (!state.user) return;
    var valor = C.parseValor(q('depositoMetaInput').value);
    if (!Number.isFinite(valor) || valor <= 0) return C.showToast('Digite um valor válido para o depósito.', 'error');
    state.metaDepositadoTotal = Number(state.metaDepositadoTotal || 0) + valor;
    q('depositoMetaInput').value = '';
    renderResumoCards();
    await salvarMetaNoBanco();
    C.showToast('Depósito adicionado à meta.', 'success');
  }
  function preencherRestanteMeta(){
    var meta = exists('metaInput') ? Number(q('metaInput').value) || 0 : 0;
    var restante = Math.max(meta - Number(state.metaDepositadoTotal || 0), 0);
    if (exists('depositoMetaInput')) q('depositoMetaInput').value = restante > 0 ? String(restante.toFixed(2)).replace('.', ',') : '';
  }




  async function removerGenerico(table, id){ var result = await supabaseClient.from(table).delete().eq('id', id).eq('user_id', state.user.id); return !result.error; }
  async function atualizarGenerico(table, id, payload){ var result = await supabaseClient.from(table).update(payload).eq('id', id).eq('user_id', state.user.id); return !result.error; }
  async function signOut(){
    try { C.setLoading(true,'Saindo','Encerrando sua sessão.'); await supabaseClient.auth.signOut(); } catch(e){} finally { C.setLoading(false); window.location.replace('index.html'); }
  }
  async function loadData(){
    C.setLoading(true, 'Carregando dados', 'Sincronizando suas movimentações.');
    state.user = await getSessionUser();
    if (!state.user) { window.location.replace('index.html'); return; }
    state.currentUserId = state.user.id;
    await vincularContaGoogleSeNecessario(state.user);
    await upsertPerfilUsuario(state.user);
    if (!(await validarAcessoUsuarioLogado())) return;
    state.adminAtivo = await verificarAdmin(state.user.id, state.user.email);
    // Busca o perfil real do banco para ter o username correto
    var perfilResult = await supabaseClient.from('user_profiles').select('username').eq('user_id', state.user.id).maybeSingle();
    state.profileUsername = perfilResult.data && perfilResult.data.username || '';
    var results = await Promise.all([
      supabaseClient.from('receitas').select('id, descricao, valor, categoria, status, tipo, recorrencia_tipo, recebimento_em, competencia, conta, observacao, created_at').eq('user_id', state.user.id).order('id', { ascending:true }),
      supabaseClient.from('despesas').select('id, descricao, categoria, valor, tipo, status, recorrencia_tipo, pagamento_em, competencia, forma_pagamento, centro_custo, conta, observacao, created_at').eq('user_id', state.user.id).order('id', { ascending:true }),
      supabaseClient.from('parcelas').select('id, descricao, categoria, valor_total, quantidade, parcela_atual, vencimento, status, recorrente, created_at').eq('user_id', state.user.id).order('vencimento', { ascending:true }),
      carregarMetaDoBanco(state.user.id)
    ]);
    state.receitas = (results[0].data || []).map(function(item){ return { id:item.id, descricao:item.descricao, valor:Number(item.valor||0), categoria:item.categoria||'', status:item.status||'recebido', tipo:item.tipo||'', recorrencia_tipo:item.recorrencia_tipo||'nao_recorrente', recebimento_em:item.recebimento_em||null, competencia:item.competencia||null, conta:item.conta||'', observacao:item.observacao||'', created_at:item.created_at||null }; });
    state.despesas = (results[1].data || []).map(function(item){ return { id:item.id, descricao:item.descricao, categoria:item.categoria||'', valor:Number(item.valor||0), tipo:item.tipo||'variavel', status:item.status||'paga', recorrencia_tipo:item.recorrencia_tipo||'nao_recorrente', pagamento_em:item.pagamento_em||null, competencia:item.competencia||null, forma_pagamento:item.forma_pagamento||'', centro_custo:item.centro_custo||'', conta:item.conta||'', observacao:item.observacao||'', created_at:item.created_at||null }; });
    state.parcelas = (results[2].data || []).map(function(item){ return { id:item.id, descricao:item.descricao, categoria:item.categoria || '', valor_total:Number(item.valor_total || 0), quantidade:Number(item.quantidade || 1), parcela_atual:Number(item.parcela_atual || 1), vencimento:item.vencimento || '', status:item.status || 'pendente', recorrente:!!item.recorrente, created_at:item.created_at || null }; });
    state.metaDepositadoTotal = Number(results[3].depositado) || 0;
    if (exists('metaInput')) q('metaInput').value = Number(results[3].valor) || 1000;
    if (exists('depositoMetaInput')) q('depositoMetaInput').value = '';
    updateUserBar();
    updateNav();
    renderCurrentPage();
    C.setLoading(false);
  }
  function updateUserBar(){
    var span = document.querySelector('#topUserInfo span');
    if (!span || !state.user) return;
    var meta = state.user.user_metadata || {};
    var email = state.user.email || '';
    // Usa o username do banco (user_profiles) como fonte mais confiável
    // Fallback: metadata → parte do email sem domínio interno
    var fromEmail = email.replace(/@planilhafinanceira\.app$/, '').split('@')[0];
    var displayName = state.profileUsername
      || meta.preferred_username
      || meta.user_name
      || meta.name
      || fromEmail
      || 'Usuário';
    span.textContent = displayName;
  }
  function updateNav(){
    Array.prototype.forEach.call(document.querySelectorAll('.nav-btn[data-target]'), function(btn){
      var t = btn.dataset.target;
      btn.classList.toggle('active', t === getPage());
      // Admins veem tudo; usuários comuns veem só Lançamentos e Pesquisa
      var adminOnly = (t === 'admin' || t === 'dashboard');
      btn.style.display = adminOnly
        ? (state.adminAtivo ? 'inline-flex' : 'none')
        : 'inline-flex';
      // Transição suave de opacidade
      btn.style.opacity = '1';
    });
  }
  function renderResumoCards(){
    if (!exists('totalReceitas')) return;
    syncPlanilhaMesUI();
    var totalReceitas = receitasDoMesAtivo().reduce(function(acc, item){ return acc + item.valor; }, 0);
    var totalDespesas = despesasDoMesAtivo().reduce(function(acc, item){ return acc + item.valor; }, 0) + parcelasPendentesDoMesAtivo().reduce(function(acc, item){ return acc + valorMensalParcela(item); }, 0);
    var saldo = totalReceitas - totalDespesas;
    var meta = exists('metaInput') ? Number(q('metaInput').value) || 0 : 0;
    var depositado = Number(state.metaDepositadoTotal || 0);
    var progresso = meta > 0 ? Math.min((Math.max(depositado, 0) / meta) * 100, 100) : 0;
    q('totalReceitas').textContent = C.moeda(totalReceitas);
    q('totalDespesas').textContent = C.moeda(totalDespesas);
    q('saldo').textContent = C.moeda(saldo);
    q('saldoTexto').textContent = saldo >= 0 ? 'Tudo sob controle' : 'Atenção ao orçamento';
    q('metaExibicao').textContent = C.moeda(meta);
    q('metaResumo').textContent = Math.round(progresso) + '% atingido';
    if (exists('metaPercentual')) q('metaPercentual').textContent = Math.round(progresso) + '%';
    if (exists('barraMeta')) q('barraMeta').style.width = progresso + '%';
    if (exists('mensagemMeta')) q('mensagemMeta').textContent = depositado >= meta ? 'Excelente! Você bateu sua meta com ' + C.moeda(depositado) + ' depositados.' : 'Você já depositou ' + C.moeda(depositado) + '. Faltam ' + C.moeda(Math.max(meta - depositado, 0)) + ' para atingir a meta.';
    if (exists('alertaMetaBox')) q('alertaMetaBox').textContent = depositado >= meta && meta > 0 ? 'Meta em dia: objetivo atingido no mês.' : (meta > 0 && depositado >= meta * 0.6 ? 'Meta andando bem: você já passou de 60% do objetivo.' : 'Alerta de meta: concentre novos depósitos para não fechar o mês muito abaixo do objetivo.');
    if (exists('metaValorResumo')) q('metaValorResumo').textContent = C.moeda(meta);
    if (exists('metaDepositadoResumo')) q('metaDepositadoResumo').textContent = C.moeda(depositado);
    if (exists('metaDepositadoResumoCard')) q('metaDepositadoResumoCard').textContent = C.moeda(depositado);
    if (exists('metaRestanteResumo')) q('metaRestanteResumo').textContent = C.moeda(Math.max(meta - depositado, 0));
  }
  function calcularResumoPeriodo(){
    var refAtual = getPlanilhaMesAtivo();
    var parts = refAtual.split('-').map(Number);
    var inicioAtual = new Date(parts[0], parts[1]-1, 1), inicioProximo = new Date(parts[0], parts[1], 1), inicioAnterior = new Date(parts[0], parts[1]-2, 1), fimAnterior = new Date(parts[0], parts[1]-1, 0);
    function inRange(iso, start, end){ if (!iso) return false; var d = new Date(iso + 'T12:00:00'); return d >= start && d <= end; }
    var atual = { receitas:0, despesas:0, qtdR:0, qtdD:0, qtdP:0, categorias:{} }, anterior = { receitas:0, despesas:0 };
    state.receitas.forEach(function(item){ var d = getItemDate(item); if (inRange(d, inicioAtual, new Date(inicioProximo - 1))) { atual.receitas += item.valor; atual.qtdR += 1; } if (inRange(d, inicioAnterior, fimAnterior)) anterior.receitas += item.valor; });
    state.despesas.forEach(function(item){ var d = getItemDate(item); if (inRange(d, inicioAtual, new Date(inicioProximo - 1))) { atual.despesas += item.valor; atual.qtdD += 1; dividirCategorias(item.categoria, item.valor).forEach(function(p){ atual.categorias[p.categoria] = (atual.categorias[p.categoria] || 0) + p.valor; }); } if (inRange(d, inicioAnterior, fimAnterior)) anterior.despesas += item.valor; });
    state.parcelas.filter(function(item){ return item.status !== 'paga'; }).forEach(function(item){ var mensal = valorMensalParcela(item), d = getItemDate(item); if (inRange(d, inicioAtual, new Date(inicioProximo - 1))) { atual.despesas += mensal; atual.qtdP += 1; dividirCategorias(item.categoria, mensal).forEach(function(p){ atual.categorias[p.categoria] = (atual.categorias[p.categoria] || 0) + p.valor; }); } if (inRange(d, inicioAnterior, fimAnterior)) anterior.despesas += mensal; });
    return { atual:atual, anterior:anterior, refAtual:refAtual };
  }
  function renderPeriodo(){
    if (!exists('periodoChart')) return;
    var resumo = calcularResumoPeriodo(), saldoAtual = resumo.atual.receitas - resumo.atual.despesas, saldoAnterior = resumo.anterior.receitas - resumo.anterior.despesas, delta = saldoAtual - saldoAnterior;
    var maior = Object.entries(resumo.atual.categorias).sort(function(a,b){ return b[1]-a[1]; })[0];
    q('insightSaldoPeriodo').textContent = C.moeda(saldoAtual);
    q('insightComparativoSaldo').textContent = delta === 0 ? 'Mesmo saldo do período anterior.' : ((delta > 0 ? 'Melhora' : 'Queda') + ' de ' + C.moeda(Math.abs(delta)) + ' versus o período anterior.');
    q('insightMaiorCategoria').textContent = maior ? maior[0] : '-';
    q('insightMaiorCategoriaValor').textContent = maior ? C.moeda(maior[1]) + ' concentrados nessa categoria.' : 'Nenhum gasto no período.';
    q('insightQtdPeriodo').textContent = String(resumo.atual.qtdR + resumo.atual.qtdD + resumo.atual.qtdP);
    q('insightQtdDetalhe').textContent = resumo.atual.qtdR + ' receitas • ' + resumo.atual.qtdD + ' saídas • ' + resumo.atual.qtdP + ' parcelas';
    renderPeriodoChart();
  }
  function gerarSerieMensal(){
    var parts = getPlanilhaMesAtivo().split('-').map(Number); var base = new Date(parts[0], parts[1]-1, 1), buckets = [], i, d, key;
    for (i = 5; i >= 0; i--) { d = new Date(base.getFullYear(), base.getMonth()-i, 1); key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0'); buckets.push({ key:key, label:C.monthLabelShort(key), receitas:0, despesas:0 }); }
    var map = new Map(buckets.map(function(v){ return [v.key, v]; }));
    state.receitas.forEach(function(item){ var k = getItemDate(item).slice(0,7); if (map.has(k)) map.get(k).receitas += item.valor; });
    state.despesas.forEach(function(item){ var k = getItemDate(item).slice(0,7); if (map.has(k)) map.get(k).despesas += item.valor; });
    state.parcelas.filter(function(item){ return item.status !== 'paga'; }).forEach(function(item){ var k = getItemDate(item).slice(0,7); if (map.has(k)) map.get(k).despesas += valorMensalParcela(item); });
    return buckets;
  }
  function renderPeriodoChart(){
    var svg = q('periodoChart'); if (!svg) return;
    var serie = gerarSerieMensal();
    var width = 640, height = 260, left = 56, right = 16, top = 20, bottom = 52;
    var chartH = height - top - bottom, chartW = width - left - right;
    var maxR = Math.max.apply(null,[1].concat(serie.map(function(v){return v.receitas;})));
    var maxD = Math.max.apply(null,[1].concat(serie.map(function(v){return v.despesas;})));
    var maxValue = Math.max(maxR, maxD);
    var slot = chartW / serie.length;
    var barW = Math.max(14, slot * 0.26), gap = 5;
    var parts = ['<rect x="0" y="0" width="'+width+'" height="'+height+'" fill="transparent"/>'];

    // Grid lines com valores
    for (var g = 0; g <= 4; g++) {
      var gy = top + (chartH/4)*g;
      var gVal = maxValue*(1-g/4);
      parts.push('<line x1="'+left+'" y1="'+gy+'" x2="'+(width-right)+'" y2="'+gy+'" stroke="rgba(148,163,184,.12)" stroke-width="1" stroke-dasharray="4,3"/>');
      if (gVal > 0) {
        var gl = gVal >= 1000 ? 'R$'+(gVal/1000).toFixed(0)+'k' : 'R$'+Math.round(gVal);
        parts.push('<text x="'+(left-8)+'" y="'+(gy+4)+'" text-anchor="end" font-size="10" fill="rgba(148,163,184,.65)" font-weight="600">'+gl+'</text>');
      }
    }
    // Linha base
    parts.push('<line x1="'+left+'" y1="'+(top+chartH)+'" x2="'+(width-right)+'" y2="'+(top+chartH)+'" stroke="rgba(148,163,184,.3)" stroke-width="1.5"/>');

    // Barras com animação e hover zone
    serie.forEach(function(item, idx){
      var cx = left + idx*slot + slot*0.5;
      var recH = Math.max(item.receitas>0?5:0, item.receitas/maxValue*(chartH-4));
      var desH = Math.max(item.despesas>0?5:0, item.despesas/maxValue*(chartH-4));
      var recY = top+chartH-recH, desY = top+chartH-desH;
      var isLast = idx === serie.length-1;
      var delay = (idx*0.08).toFixed(2);
      var delayD = (idx*0.08+0.05).toFixed(2);

      // Hover zone
      parts.push('<rect class="chart-hover-zone" x="'+(cx-slot*0.46)+'" y="'+top+'" width="'+(slot*0.92)+'" height="'+chartH+'" fill="transparent" rx="6" data-idx="'+idx+'" style="cursor:pointer"/>');

      // Barra receita
      if (item.receitas > 0) {
        parts.push('<rect class="chart-bar-rec" x="'+(cx-barW-gap/2)+'" y="'+recY+'" width="'+barW+'" height="'+recH+'" rx="7" fill="url(#gradRec)" opacity="0.93">'+
          '<animate attributeName="height" from="0" to="'+recH+'" dur=".65s" begin="'+delay+'s" fill="freeze" calcMode="spline" keySplines="0.22,1,0.36,1" keyTimes="0;1"/>'+
          '<animate attributeName="y" from="'+(top+chartH)+'" to="'+recY+'" dur=".65s" begin="'+delay+'s" fill="freeze" calcMode="spline" keySplines="0.22,1,0.36,1" keyTimes="0;1"/>'+
          '</rect>');
        // Valor em cima da barra receita no mês atual
        if (isLast && item.receitas > 0) {
          var rl = item.receitas>=1000?'R$'+(item.receitas/1000).toFixed(1)+'k':'R$'+item.receitas.toFixed(0);
          parts.push('<text x="'+(cx-barW/2-gap/2)+'" y="'+(recY-6)+'" text-anchor="middle" font-size="10" font-weight="800" fill="var(--success)" opacity="0">'+rl+
            '<animate attributeName="opacity" from="0" to="1" dur=".3s" begin="'+(parseFloat(delay)+0.65)+'s" fill="freeze"/>'+
            '</text>');
        }
      }

      // Barra despesa
      if (item.despesas > 0) {
        parts.push('<rect class="chart-bar-des" x="'+(cx+gap/2)+'" y="'+desY+'" width="'+barW+'" height="'+desH+'" rx="7" fill="url(#gradDes)" opacity="0.93">'+
          '<animate attributeName="height" from="0" to="'+desH+'" dur=".65s" begin="'+delayD+'s" fill="freeze" calcMode="spline" keySplines="0.22,1,0.36,1" keyTimes="0;1"/>'+
          '<animate attributeName="y" from="'+(top+chartH)+'" to="'+desY+'" dur=".65s" begin="'+delayD+'s" fill="freeze" calcMode="spline" keySplines="0.22,1,0.36,1" keyTimes="0;1"/>'+
          '</rect>');
        if (isLast && item.despesas > 0) {
          var dl = item.despesas>=1000?'R$'+(item.despesas/1000).toFixed(1)+'k':'R$'+item.despesas.toFixed(0);
          parts.push('<text x="'+(cx+barW/2+gap/2)+'" y="'+(desY-6)+'" text-anchor="middle" font-size="10" font-weight="800" fill="var(--danger)" opacity="0">'+dl+
            '<animate attributeName="opacity" from="0" to="1" dur=".3s" begin="'+(parseFloat(delayD)+0.65)+'s" fill="freeze"/>'+
            '</text>');
        }
      }

      // Label mês
      var labelColor = isLast ? 'var(--primary)' : 'rgba(148,163,184,.75)';
      var labelWeight = isLast ? '800' : '600';
      parts.push('<text x="'+cx+'" y="'+(top+chartH+18)+'" text-anchor="middle" font-size="11" fill="'+labelColor+'" font-weight="'+labelWeight+'">'+item.label+'</text>');

      // Indicador mês atual
      if (isLast) {
        parts.push('<circle cx="'+cx+'" cy="'+(top+chartH+30)+'" r="3" fill="var(--primary)"><animate attributeName="r" values="3;4;3" dur="2s" repeatCount="indefinite"/></circle>');
      }
    });

    // Tooltip group
    parts.push('<g id="chartTooltip" style="pointer-events:none;display:none">'+
      '<rect id="ttBg" rx="12" fill="var(--card)" stroke="var(--line)" stroke-width="1.5" filter="url(#ttShadow)"/>'+
      '<text id="ttLabel" font-size="10" font-weight="800" fill="var(--muted)"/>'+
      '<rect id="ttDotRec" width="9" height="9" rx="2" fill="url(#gradRec)"/>'+
      '<text id="ttRec" font-size="12" font-weight="700" fill="var(--text)"/>'+
      '<rect id="ttDotDes" width="9" height="9" rx="2" fill="url(#gradDes)"/>'+
      '<text id="ttDes" font-size="12" font-weight="700" fill="var(--text)"/>'+
      '<text id="ttSaldo" font-size="11" font-weight="700" fill="var(--muted)"/>'+
      '</g>');

    // Legenda
    var ly = height - 12;
    parts.push('<rect x="'+left+'" y="'+(ly-10)+'" width="10" height="10" rx="3" fill="url(#gradRec)"/>');
    parts.push('<text x="'+(left+14)+'" y="'+ly+'" font-size="11" font-weight="600" fill="rgba(148,163,184,.85)">Receitas</text>');
    parts.push('<rect x="'+(left+80)+'" y="'+(ly-10)+'" width="10" height="10" rx="3" fill="url(#gradDes)"/>');
    parts.push('<text x="'+(left+94)+'" y="'+ly+'" font-size="11" font-weight="600" fill="rgba(148,163,184,.85)">Despesas</text>');

    // Defs
    var defs = '<defs>'+
      '<linearGradient id="gradRec" x1="0" y1="0" x2="0" y2="1">'+
        '<stop offset="0%" stop-color="#a78bfa"/>'+
        '<stop offset="100%" stop-color="#7c3aed"/>'+
      '</linearGradient>'+
      '<linearGradient id="gradDes" x1="0" y1="0" x2="0" y2="1">'+
        '<stop offset="0%" stop-color="#f97316"/>'+
        '<stop offset="100%" stop-color="#dc2626"/>'+
      '</linearGradient>'+
      '<filter id="ttShadow" x="-12%" y="-12%" width="124%" height="130%">'+
        '<feDropShadow dx="0" dy="4" stdDeviation="8" flood-color="rgba(0,0,0,.28)"/>'+
      '</filter>'+
    '</defs>';

    svg.innerHTML = defs + parts.join('');
    svg.setAttribute('viewBox','0 0 '+width+' '+height);
    svg.style.height = 'auto';

    // Tooltip interativo
    var ttGroup=svg.getElementById('chartTooltip'),ttBg=svg.getElementById('ttBg');
    var ttLabel=svg.getElementById('ttLabel'),ttRec=svg.getElementById('ttRec');
    var ttDes=svg.getElementById('ttDes'),ttSaldo=svg.getElementById('ttSaldo');
    var ttDotRec=svg.getElementById('ttDotRec'),ttDotDes=svg.getElementById('ttDotDes');

    Array.prototype.forEach.call(svg.querySelectorAll('.chart-hover-zone'), function(zone){
      zone.addEventListener('mouseenter', function(){
        var idx=parseInt(zone.getAttribute('data-idx')); var item=serie[idx]; if(!item) return;
        var svgRect=svg.getBoundingClientRect();
        var zRect=zone.getBoundingClientRect();
        var scale=width/svgRect.width;
        var tx=((zRect.left+zRect.right)/2-svgRect.left)*scale;
        var ttW=172, ttH=82;
        var ttX=Math.max(4,Math.min(tx-ttW/2,width-ttW-4));
        var ttY=top-10;
        var saldo=item.receitas-item.despesas;
        var saldoTxt=(saldo>=0?'▲ Saldo +':'▼ Saldo ')+C.moeda(Math.abs(saldo));

        ttGroup.style.display='block';
        ttBg.setAttribute('x',ttX);ttBg.setAttribute('y',ttY);
        ttBg.setAttribute('width',ttW);ttBg.setAttribute('height',ttH);
        ttLabel.setAttribute('x',ttX+10);ttLabel.setAttribute('y',ttY+16);
        ttLabel.textContent=item.label.toUpperCase();
        ttDotRec.setAttribute('x',ttX+10);ttDotRec.setAttribute('y',ttY+23);
        ttRec.setAttribute('x',ttX+23);ttRec.setAttribute('y',ttY+32);
        ttRec.textContent='Receita: '+C.moeda(item.receitas);
        ttDotDes.setAttribute('x',ttX+10);ttDotDes.setAttribute('y',ttY+40);
        ttDes.setAttribute('x',ttX+23);ttDes.setAttribute('y',ttY+49);
        ttDes.textContent='Despesa: '+C.moeda(item.despesas);
        ttSaldo.setAttribute('x',ttX+10);ttSaldo.setAttribute('y',ttY+66);
        ttSaldo.setAttribute('fill',saldo>=0?'var(--success)':'var(--danger)');
        ttSaldo.textContent=saldoTxt;
      });
      zone.addEventListener('mouseleave',function(){ttGroup.style.display='none';});
    });
  }

  function renderCategorias(){
    var box = q('categoriasBox'); if (!box) return;
    var totalDespesas = despesasDoMesAtivo().reduce(function(acc, item){ return acc + item.valor; }, 0) + parcelasPendentesDoMesAtivo().reduce(function(acc, item){ return acc + valorMensalParcela(item); }, 0);
    var mapa = {};
    despesasDoMesAtivo().forEach(function(item){ dividirCategorias(item.categoria, item.valor).forEach(function(p){ mapa[p.categoria] = (mapa[p.categoria] || 0) + p.valor; }); });
    parcelasPendentesDoMesAtivo().forEach(function(item){ dividirCategorias(item.categoria, valorMensalParcela(item)).forEach(function(p){ mapa[p.categoria] = (mapa[p.categoria] || 0) + p.valor; }); });
    var lista = Object.entries(mapa).sort(function(a,b){ return b[1]-a[1]; });
    box.innerHTML = '';
    if (!lista.length) { box.innerHTML = '<div class="helper-box">Nenhuma despesa cadastrada ainda.</div>'; return; }
    lista.forEach(function(entry){ var percentual = totalDespesas > 0 ? entry[1] / totalDespesas * 100 : 0; var div = document.createElement('div'); div.style.marginBottom = '14px'; div.innerHTML = '<div style="display:flex;justify-content:space-between;gap:10px;font-size:14px;margin-bottom:8px;font-weight:700"><strong>' + C.escapeHtml(entry[0]) + '</strong><span>' + C.moeda(entry[1]) + '</span></div><div class="progress"><div class="progress-bar" style="width:' + percentual + '%"></div></div>'; box.appendChild(div); });
  }
  function renderReceitasLancamentos(){
    var tbody = q('tabelaReceitasLancamentos'); if (!tbody) return;
    tbody.innerHTML = '';
    var itens = receitasDoMesAtivo();
    if (!itens.length) { tbody.innerHTML = '<tr><td colspan="3" style="color:var(--muted);text-align:center;">Nenhuma receita lançada no mês selecionado.</td></tr>'; return; }
    itens.forEach(function(item){ var tr = document.createElement('tr'); tr.innerHTML = '<td>' + C.escapeHtml(item.descricao || '-') + '</td><td class="right">' + C.moeda(Number(item.valor || 0)) + '</td><td class="right"><div class="action-inline"><button class="btn-secondary" data-launch-action="duplicate" data-type="receita" data-id="' + item.id + '">Duplicar</button><button class="btn-danger" data-launch-action="delete" data-type="receita" data-id="' + item.id + '">Excluir</button></div></td>'; tbody.appendChild(tr); });
  }
  function renderSaidasLancamentos(){
    var tbody = q('tabelaSaidasLancamentos'); if (!tbody) return;
    tbody.innerHTML = '';
    var linhas = despesasDoMesAtivo().map(function(item){ return { type:'despesa', id:item.id, nome:item.descricao || '-', categoria:item.categoria || '-', valor:Number(item.valor || 0), parcelamento:'Não' }; }).concat(parcelasDoMesAtivo().map(function(item){ return { type:'parcela', id:item.id, nome:item.descricao || '-', categoria:item.categoria || '-', valor:valorMensalParcela(item), parcelamento:item.recorrente ? 'Recorrente' : 'Sim (' + item.parcela_atual + '/' + item.quantidade + ')' }; }));
    if (!linhas.length) { tbody.innerHTML = '<tr><td colspan="5" style="color:var(--muted);text-align:center;">Nenhuma saída lançada no mês selecionado.</td></tr>'; return; }
    linhas.forEach(function(item){ var tr = document.createElement('tr'); tr.innerHTML = '<td>' + C.escapeHtml(item.nome) + '</td><td>' + C.escapeHtml(item.categoria) + '</td><td class="right">' + C.moeda(item.valor) + '</td><td>' + C.escapeHtml(item.parcelamento) + '</td><td class="right"><div class="action-inline"><button class="btn-secondary" data-launch-action="duplicate" data-type="' + item.type + '" data-id="' + item.id + '">Duplicar</button><button class="btn-danger" data-launch-action="delete" data-type="' + item.type + '" data-id="' + item.id + '">Excluir</button></div></td>'; tbody.appendChild(tr); });
  }
  function renderParcelasCards(){ if (!exists('parcelasPendentesValor')) return; var pendentes = parcelasDoMesAtivo().filter(function(item){ return item.status !== 'paga'; }); var pagas = parcelasDoMesAtivo().filter(function(item){ return item.status === 'paga'; }); q('parcelasPendentesValor').textContent = C.moeda(pendentes.reduce(function(acc, item){ return acc + valorMensalParcela(item); }, 0)); q('parcelasPendentesQtd').textContent = pendentes.length + ' item(ns) pendentes'; q('parcelasPagasValor').textContent = C.moeda(pagas.reduce(function(acc, item){ return acc + valorMensalParcela(item); }, 0)); q('parcelasPagasQtd').textContent = pagas.length + ' item(ns) pagos'; }
  function labelTipo(type){ return type === 'receita' ? 'Receita' : (type === 'despesa' ? 'Saída' : 'Parcela'); }
  function construirItensPesquisa(){
    var itens = state.receitas.map(function(item){ return { type:'receita', id:item.id, descricao:item.descricao, categoria:'-', valor:item.valor, status:'-', detalhe:'Entrada', dataBase:getItemDate(item), raw:item }; }).concat(state.despesas.map(function(item){ return { type:'despesa', id:item.id, descricao:item.descricao, categoria:item.categoria || '-', valor:item.valor, status:'-', detalhe:'Saída avulsa', dataBase:getItemDate(item), raw:item }; })).concat(state.parcelas.map(function(item){ return { type:'parcela', id:item.id, descricao:item.descricao, categoria:item.categoria || '-', valor:valorMensalParcela(item), status:item.status, detalhe:item.recorrente ? 'Recorrente mensal' : (item.parcela_atual + '/' + item.quantidade), dataBase:getItemDate(item), raw:item }; }));
    var texto = exists('pesquisaTexto') ? C.normalizeText(q('pesquisaTexto').value) : '';
    var categoria = exists('pesquisaCategoria') ? C.normalizeText(q('pesquisaCategoria').value) : '';
    var mes = exists('pesquisaMes') ? q('pesquisaMes').value : '';
    var dataInicio = exists('pesquisaDataInicio') ? q('pesquisaDataInicio').value : '';
    var dataFim = exists('pesquisaDataFim') ? q('pesquisaDataFim').value : '';
    var status = exists('pesquisaStatus') ? q('pesquisaStatus').value : '';
    var ordenacao = exists('pesquisaOrdenacao') ? q('pesquisaOrdenacao').value : 'descricao';
    var filtrados = itens.filter(function(item){
      if (state.filtroTipoPesquisa === 'saidas' && item.type !== 'despesa' && item.type !== 'parcela') return false;
      if (state.filtroTipoPesquisa !== 'todos' && state.filtroTipoPesquisa !== 'saidas' && item.type !== state.filtroTipoPesquisa) return false;
      var textoBase = [item.descricao, item.categoria, item.detalhe, item.status].map(C.normalizeText).join(' ');
      if (texto && textoBase.indexOf(texto) < 0) return false;
      if (categoria && C.normalizeText(item.categoria || '').indexOf(categoria) < 0) return false;
      if (status && item.type === 'parcela' && item.status !== status) return false;
      if (status && item.type !== 'parcela') return false;
      var base = item.dataBase || '';
      if (mes && base.slice(0,7) !== mes) return false;
      if (dataInicio && (!base || base < dataInicio)) return false;
      if (dataFim && (!base || base > dataFim)) return false;
      return true;
    });
    filtrados.sort(function(a,b){ if (ordenacao === 'valor_desc') return b.valor - a.valor; if (ordenacao === 'valor_asc') return a.valor - b.valor; if (ordenacao === 'data_desc') return String(b.dataBase || '').localeCompare(String(a.dataBase || '')); if (ordenacao === 'data_asc') return String(a.dataBase || '').localeCompare(String(b.dataBase || '')); return a.descricao.localeCompare(b.descricao, 'pt-BR'); });
    return filtrados;
  }
  function renderPesquisa(){
    if (!exists('tabelaPesquisa')) return;
    var itens = construirItensPesquisa(), tabela = q('tabelaPesquisa'), cards = q('listaPesquisaMobile'); tabela.innerHTML = ''; cards.innerHTML = '';
    if (exists('resumoPesquisaTotal')) {
      q('resumoPesquisaTotal').textContent = String(itens.length);
      q('resumoPesquisaTipos').textContent = itens.filter(function(i){ return i.type === 'receita'; }).length + ' receitas • ' + itens.filter(function(i){ return i.type === 'despesa' || i.type === 'parcela'; }).length + ' saídas & parcelas';
      q('resumoPesquisaValor').textContent = C.moeda(itens.reduce(function(acc, item){ return acc + item.valor; }, 0));
      var mapa = {};
      itens.filter(function(i){ return i.categoria && i.categoria !== '-'; }).forEach(function(item){ var chave = item.categoria.split(',')[0].trim() || 'Sem categoria'; mapa[chave] = (mapa[chave] || 0) + Number(item.valor || 0); });
      var top = Object.entries(mapa).sort(function(a,b){ return b[1]-a[1]; })[0];
      q('resumoPesquisaCategoria').textContent = top ? top[0] : '-';
      q('resumoPesquisaCategoriaValor').textContent = top ? C.moeda(top[1]) : 'Sem concentração ainda';
      var mes = exists('pesquisaMes') ? q('pesquisaMes').value : ''; q('resumoPesquisaPeriodo').textContent = mes ? C.monthLabelLong(mes) : 'Todos';
    }
    if (!itens.length) { tabela.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted)">Nenhum resultado encontrado para os filtros atuais.</td></tr>'; cards.innerHTML = '<div class="helper-box">Nenhum resultado encontrado para os filtros atuais.</div>'; return; }
    itens.forEach(function(item){
      var statusBadge = item.type === 'parcela' ? '<span class="status-badge ' + (item.status === 'paga' ? 'status-paga' : 'status-pendente') + '">' + item.status + '</span>' : '-';
      var detalheExtra = item.type === 'parcela' && item.raw && item.raw.recorrente ? ' <span class="status-badge status-recorrente">Recorrente</span>' : '';
      var dataInfo = item.dataBase ? C.formatarDataBR(item.dataBase) : '-';
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>' + labelTipo(item.type) + '</td><td>' + C.escapeHtml(item.descricao) + detalheExtra + '</td><td>' + C.escapeHtml(item.categoria) + '</td><td>' + C.escapeHtml(item.detalhe) + ' • ' + dataInfo + '</td><td class="right">' + C.moeda(item.valor) + '</td><td>' + statusBadge + '</td><td class="right"><div class="admin-actions">' + (item.type === 'parcela' ? '<button class="btn-small btn-secondary" data-search-action="status" data-id="' + item.id + '">' + (item.status === 'paga' ? 'Pendente' : 'Paga') + '</button>' : '') + '<button class="btn-small btn-neutral" data-search-action="edit" data-type="' + item.type + '" data-id="' + item.id + '">Alterar</button><button class="btn-small btn-danger" data-search-action="delete" data-type="' + item.type + '" data-id="' + item.id + '">Excluir</button></div></td>';
      tabela.appendChild(tr);
      var card = document.createElement('div'); card.className = 'result-card'; card.innerHTML = '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;margin-bottom:10px"><div><div style="font-size:12px;font-weight:800;color:var(--primary);text-transform:uppercase;letter-spacing:.05em">' + labelTipo(item.type) + '</div><div style="font-size:16px;font-weight:800;line-height:1.25">' + C.escapeHtml(item.descricao) + '</div></div><div style="font-weight:800;">' + C.moeda(item.valor) + '</div></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px;margin-bottom:12px"><div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:800">Categoria</div><div style="font-size:14px;font-weight:700">' + C.escapeHtml(item.categoria) + '</div></div><div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:800">Detalhe</div><div style="font-size:14px;font-weight:700">' + C.escapeHtml(item.detalhe) + '</div></div><div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:800">Data</div><div style="font-size:14px;font-weight:700">' + dataInfo + '</div></div><div><div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:800">Status</div><div style="font-size:14px;font-weight:700">' + C.escapeHtml(item.type === 'parcela' ? item.status : '-') + '</div></div></div><div class="card-actions">' + (item.type === 'parcela' ? '<button class="btn-secondary" data-search-action="status" data-id="' + item.id + '">' + (item.status === 'paga' ? 'Marcar pendente' : 'Marcar paga') + '</button>' : '') + '<button class="btn-neutral" data-search-action="edit" data-type="' + item.type + '" data-id="' + item.id + '">Alterar</button><button class="btn-danger" data-search-action="delete" data-type="' + item.type + '" data-id="' + item.id + '">Excluir</button></div>'; cards.appendChild(card);
    });
  }
  function getAdminFilteredUsers(){
    return (state.adminProfiles || []).filter(function(item){
      var texto = (state.adminBusca || '').trim().toLowerCase();
      var matchTexto = !texto || [item.username, item.email, item.provider].join(' ').toLowerCase().indexOf(texto) !== -1;
      if (!matchTexto) return false;
      if (state.adminFiltro === 'ativos') return item.is_active !== false;
      if (state.adminFiltro === 'inativos') return item.is_active === false;
      if (state.adminFiltro === 'admins') return item.roleAtual === 'admin';
      if (state.adminFiltro === 'bloqueados') return isUserBlocked(item);
      return true;
    });
  }
  function renderAdminResumo(){
    var itens = state.adminProfiles || [];
    if (exists('adminResumoTotal')) q('adminResumoTotal').textContent = String(itens.length);
    if (exists('adminResumoAdmins')) q('adminResumoAdmins').textContent = String(itens.filter(function(item){ return item.roleAtual === 'admin'; }).length);
    if (exists('adminResumoAtivos')) q('adminResumoAtivos').textContent = String(itens.filter(function(item){ return item.is_active !== false; }).length);
    if (exists('adminResumoBloqueados')) q('adminResumoBloqueados').textContent = String(itens.filter(function(item){ return isUserBlocked(item); }).length);
  }
  function adminAvatarLabel(item){
    var base = (item.username || item.email || 'U').trim().split(/\s+/).slice(0,2).map(function(part){ return part.charAt(0).toUpperCase(); }).join('');
    return base || 'U';
  }
  function renderAdminUsuarios(){
    var tbody = q('tabelaAdminUsuarios');
    var mobile = exists('listaAdminMobile') ? q('listaAdminMobile') : null;
    if (!tbody) return;
    tbody.innerHTML = '';
    if (mobile) mobile.innerHTML = '';
    renderAdminResumo();
    var itens = getAdminFilteredUsers();
    if (!itens.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="admin-empty">Nenhum usuário encontrado para esse filtro.</td></tr>';
      if (mobile) mobile.innerHTML = '<div class="helper-box">Nenhum usuário encontrado para esse filtro.</div>';
      return;
    }
    itens.forEach(function(item){
      var roleAtual = item.roleAtual || 'user';
      var isSelf = item.user_id === state.currentUserId;
      var proximaRole = roleAtual === 'admin' ? 'user' : 'admin';
      var textoBotaoRole = roleAtual === 'admin' ? 'Tirar admin' : 'Tornar admin';
      var ativo = item.is_active !== false;
      var bloqueado = isUserBlocked(item);
      var tr = document.createElement('tr');
      tr.innerHTML = '<td><div class="admin-user-cell"><div class="admin-avatar">' + adminAvatarLabel(item) + '</div><div class="admin-user-main"><div class="admin-user-name">' + C.escapeHtml(item.username || 'Sem nome') + '</div><div class="admin-user-meta"><span>' + C.escapeHtml(item.email || '-') + '</span><span>•</span><span>' + C.escapeHtml(item.provider || '-') + '</span></div></div></div></td>' +
        '<td><div class="admin-stack"><div class="admin-pill-row"><span class="status-pill ' + (ativo ? 'status-ok' : 'status-off') + '">' + formatUserStatus(item) + '</span><span class="admin-mini ' + (roleAtual === 'admin' ? 'role-admin' : 'role-user') + '">' + C.escapeHtml(roleAtual) + '</span></div><div class="muted-value small">Criado em ' + C.formatarDataHora(item.created_at) + '</div></div></td>' +
        '<td><div class="admin-stack"><div class="muted-label">Bloqueio</div><div class="admin-pill-row"><span class="status-pill ' + (bloqueado ? 'status-warn' : 'status-muted') + '">' + formatBlockStatus(item) + '</span>' + (item.force_password_reset ? '<span class="admin-mini">Troca de senha pendente</span>' : '') + '</div></div></td>' +
        '<td><div class="admin-stack"><div class="muted-label">Último login</div><div class="muted-value">' + C.formatarDataHora(item.last_login_at) + '</div></div></td>' +
        '<td class="right"><div class="admin-actions">' +
        '<button class="btn-secondary" data-admin-role="' + proximaRole + '" data-user-id="' + item.user_id + '" ' + (isSelf && roleAtual === 'admin' ? 'disabled' : '') + '>' + (isSelf && roleAtual === 'admin' ? 'Seu acesso' : textoBotaoRole) + '</button>' +
        '<button class="btn-neutral" data-admin-active="' + (ativo ? 'false' : 'true') + '" data-user-id="' + item.user_id + '" ' + (isSelf ? 'disabled' : '') + '>' + (ativo ? 'Desativar' : 'Reativar') + '</button>' +
        '<button class="btn-neutral" data-admin-block="' + (bloqueado ? 'clear' : '24h') + '" data-user-id="' + item.user_id + '" ' + (isSelf ? 'disabled' : '') + '>' + (bloqueado ? 'Desbloquear' : 'Bloquear 24h') + '</button>' +
        '<button class="btn-primary" data-admin-reset="1" data-user-id="' + item.user_id + '" data-email="' + C.escapeHtml(item.email || '') + '">Forçar senha</button>' +
        '</div></td>';
      tbody.appendChild(tr);
      if (mobile) {
        var card = document.createElement('div');
        card.className = 'admin-card';
        card.innerHTML = '<div class="admin-card-top"><div class="admin-card-title"><div class="admin-avatar">' + adminAvatarLabel(item) + '</div><div><div class="admin-user-name">' + C.escapeHtml(item.username || 'Sem nome') + '</div><div class="admin-user-meta"><span>' + C.escapeHtml(item.email || '-') + '</span></div></div></div><span class="admin-mini ' + (roleAtual === 'admin' ? 'role-admin' : 'role-user') + '">' + C.escapeHtml(roleAtual) + '</span></div>' +
          '<div class="admin-card-grid"><div class="admin-stack"><div class="muted-label">Acesso</div><div class="admin-pill-row"><span class="status-pill ' + (ativo ? 'status-ok' : 'status-off') + '">' + formatUserStatus(item) + '</span></div></div><div class="admin-stack"><div class="muted-label">Bloqueio</div><div class="admin-pill-row"><span class="status-pill ' + (bloqueado ? 'status-warn' : 'status-muted') + '">' + formatBlockStatus(item) + '</span></div></div><div class="admin-stack"><div class="muted-label">Provedor</div><div class="muted-value">' + C.escapeHtml(item.provider || '-') + '</div></div><div class="admin-stack"><div class="muted-label">Último login</div><div class="muted-value">' + C.formatarDataHora(item.last_login_at) + '</div></div></div>' +
          (item.force_password_reset ? '<div class="admin-pill-row"><span class="admin-mini">Troca de senha pendente</span></div>' : '') +
          '<div class="admin-card-actions">' +
          '<button class="btn-secondary" data-admin-role="' + proximaRole + '" data-user-id="' + item.user_id + '" ' + (isSelf && roleAtual === 'admin' ? 'disabled' : '') + '>' + (isSelf && roleAtual === 'admin' ? 'Seu acesso' : textoBotaoRole) + '</button>' +
          '<button class="btn-neutral" data-admin-active="' + (ativo ? 'false' : 'true') + '" data-user-id="' + item.user_id + '" ' + (isSelf ? 'disabled' : '') + '>' + (ativo ? 'Desativar' : 'Reativar') + '</button>' +
          '<button class="btn-neutral" data-admin-block="' + (bloqueado ? 'clear' : '24h') + '" data-user-id="' + item.user_id + '" ' + (isSelf ? 'disabled' : '') + '>' + (bloqueado ? 'Desbloquear' : 'Bloquear 24h') + '</button>' +
          '<button class="btn-primary" data-admin-reset="1" data-user-id="' + item.user_id + '" data-email="' + C.escapeHtml(item.email || '') + '">Forçar senha</button>' +
          '</div>';
        mobile.appendChild(card);
      }
    });
  }
  async function carregarUsuariosAdmin(){
    var tbody = q('tabelaAdminUsuarios'); if (!tbody) return; tbody.innerHTML = '';
    var profiles = await supabaseClient.from('user_profiles').select('*').order('created_at', { ascending:false });
    var roles = await supabaseClient.from('user_roles').select('user_id, role');
    if (profiles.error || roles.error) return;
    var roleMap = new Map((roles.data || []).map(function(r){ return [r.user_id, r.role]; }));
    state.adminProfiles = (profiles.data || []).map(function(item){ item.roleAtual = roleMap.get(item.user_id) || 'user'; return item; });
    renderAdminUsuarios();
  }
  function renderCurrentPage(){ renderResumoCards(); renderPeriodo(); renderCategorias(); renderReceitasLancamentos(); renderSaidasLancamentos(); renderParcelasCards(); renderPesquisa(); if (getPage() === 'admin' && state.adminAtivo) carregarUsuariosAdmin(); }
  function initStaticEvents(){
    setupMonthPicker('planilhaMes', { startYear:new Date().getFullYear() - 4, endYear:new Date().getFullYear() + 1 });
    setupMonthPicker('pesquisaMes', { allowEmpty:true, startYear:new Date().getFullYear() - 4, endYear:new Date().getFullYear() + 1 });
    C.applyStoredTheme();
    q('themeToggle').addEventListener('click', C.toggleTheme);
    q('btnSairHeader').addEventListener('click', signOut);
    Array.prototype.forEach.call(document.querySelectorAll('.nav-btn[data-target]'), function(btn){ btn.addEventListener('click', function(){ window.location.href = btn.dataset.target + '.html'; }); });
    if (exists('planilhaMes')) { q('planilhaMes').value = C.getStoredPlanilhaMes(); q('planilhaMes').addEventListener('change', function(){ C.setStoredPlanilhaMes(q('planilhaMes').value); syncPlanilhaMesUI(); renderCurrentPage(); }); }
    if (exists('btnMesAtual')) q('btnMesAtual').addEventListener('click', function(){ q('planilhaMes').value = C.currentMonthRef(); syncMonthPickerUI('planilhaMes'); C.setStoredPlanilhaMes(q('planilhaMes').value); syncPlanilhaMesUI(); renderCurrentPage(); });
    if (exists('btnAddReceita')) q('btnAddReceita').addEventListener('click', adicionarReceita);
    if (exists('btnAddDespesa')) q('btnAddDespesa').addEventListener('click', adicionarDespesa);
    if (exists('btnAddParcela')) q('btnAddParcela').addEventListener('click', adicionarParcela);
    if (exists('btnPrefixarSalario')) q('btnPrefixarSalario').addEventListener('click', function(){ var campo = q('receitaDescricao'); var atual = campo.value.trim(); campo.value = atual ? ((atual.toLowerCase().indexOf('salário') === 0 || atual.toLowerCase().indexOf('salario') === 0) ? atual : 'Salário - ' + atual) : 'Salário - '; campo.focus(); });
    if (exists('saidaParceladaToggle')) {
      q('saidaParceladaToggle').addEventListener('change', function(){
        var bloco = q('blocoParceladoDentroSaidas');
        if (!bloco) return;
        var checked = this.checked;
        if (checked) {
          // Abre todos os <details> ancestrais caso estejam fechados
          var el = bloco.parentElement;
          while (el) {
            if (el.tagName === 'DETAILS') el.open = true;
            el = el.parentElement;
          }
          bloco.style.cssText = 'display:block !important';
        } else {
          bloco.style.cssText = 'display:none';
        }
      });
    }
    if (exists('parcelaRecorrente')) q('parcelaRecorrente').addEventListener('change', function(){ q('parcelaQuantidade').disabled = q('parcelaRecorrente').checked; q('parcelaAtual').disabled = q('parcelaRecorrente').checked; });
    if (exists('metaInput')) q('metaInput').addEventListener('input', async function(){ renderResumoCards(); await salvarMetaNoBanco(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-meta-tab]'), function(btn){ btn.addEventListener('click', function(){ setMetaTab(btn.dataset.metaTab); }); });
    if (exists('btnAdicionarDepositoMeta')) q('btnAdicionarDepositoMeta').addEventListener('click', adicionarDepositoMeta);
    if (exists('btnPreencherRestanteMeta')) q('btnPreencherRestanteMeta').addEventListener('click', preencherRestanteMeta);
    if (exists('tabelaReceitasLancamentos')) q('tabelaReceitasLancamentos').addEventListener('click', handleLaunchActions);
    if (exists('tabelaSaidasLancamentos')) q('tabelaSaidasLancamentos').addEventListener('click', handleLaunchActions);
    if (exists('tabelaPesquisa')) q('tabelaPesquisa').addEventListener('click', handleSearchActions);
    if (exists('listaPesquisaMobile')) q('listaPesquisaMobile').addEventListener('click', handleSearchActions);
    if (exists('tabelaAdminUsuarios')) q('tabelaAdminUsuarios').addEventListener('click', handleAdminActions);
    if (exists('listaAdminMobile')) q('listaAdminMobile').addEventListener('click', handleAdminActions);
    if (exists('adminBusca')) q('adminBusca').addEventListener('input', function(){ state.adminBusca = q('adminBusca').value || ''; renderAdminUsuarios(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-admin-filter]'), function(btn){ btn.addEventListener('click', function(){ state.adminFiltro = btn.dataset.adminFilter || 'todos'; Array.prototype.forEach.call(document.querySelectorAll('[data-admin-filter]'), function(el){ el.classList.toggle('active', el === btn); }); renderAdminUsuarios(); }); });
    Array.prototype.forEach.call(document.querySelectorAll('.segment-btn[data-search-type]'), function(btn){ btn.addEventListener('click', function(){ state.filtroTipoPesquisa = btn.dataset.searchType; Array.prototype.forEach.call(document.querySelectorAll('.segment-btn[data-search-type]'), function(el){ el.classList.toggle('active', el === btn); }); renderPesquisa(); }); });
    ['pesquisaTexto','pesquisaCategoria','pesquisaMes','pesquisaStatus','pesquisaOrdenacao','pesquisaDataInicio','pesquisaDataFim'].forEach(function(id){ if (exists(id)) { q(id).addEventListener('input', renderPesquisa); q(id).addEventListener('change', renderPesquisa); } });
    if (exists('btnLimparPesquisa')) q('btnLimparPesquisa').addEventListener('click', function(){ ['pesquisaTexto','pesquisaCategoria','pesquisaMes','pesquisaDataInicio','pesquisaDataFim'].forEach(function(id){ if (exists(id)) q(id).value = ''; }); syncMonthPickerUI('pesquisaMes'); if (exists('pesquisaStatus')) q('pesquisaStatus').value = ''; if (exists('pesquisaOrdenacao')) q('pesquisaOrdenacao').value = 'descricao'; state.filtroTipoPesquisa = 'todos'; Array.prototype.forEach.call(document.querySelectorAll('.segment-btn[data-search-type]'), function(btn){ btn.classList.toggle('active', btn.dataset.searchType === 'todos'); }); renderPesquisa(); });
    if (exists('btnLimparPesquisaMes')) q('btnLimparPesquisaMes').addEventListener('click', function(){ if (exists('pesquisaMes')) q('pesquisaMes').value = ''; syncMonthPickerUI('pesquisaMes'); renderPesquisa(); });
    if (exists('btnExportarCsv')) q('btnExportarCsv').addEventListener('click', exportarCsv);
    if (exists('btnModoRelatorio')) q('btnModoRelatorio').addEventListener('click', function(){ window.print(); });
    if (exists('btnFecharModal')) q('btnFecharModal').addEventListener('click', fecharModal);
    if (exists('btnCancelarModal')) q('btnCancelarModal').addEventListener('click', fecharModal);
    if (exists('btnSalvarEdicao')) q('btnSalvarEdicao').addEventListener('click', salvarEdicaoAtual);
    if (exists('modalBackdrop')) q('modalBackdrop').addEventListener('click', function(e){ if (e.target === q('modalBackdrop')) fecharModal(); });
  }
  async function handleLaunchActions(event){ var botao = event.target.closest('button[data-launch-action]'); if (!botao) return; if (botao.dataset.launchAction === 'duplicate') await duplicarItem(botao.dataset.type, Number(botao.dataset.id)); if (botao.dataset.launchAction === 'delete') await excluirItem(botao.dataset.type, Number(botao.dataset.id)); }
  async function handleSearchActions(event){ var botao = event.target.closest('button[data-search-action]'); if (!botao) return; if (botao.dataset.searchAction === 'edit') abrirModalEdicao(botao.dataset.type, Number(botao.dataset.id)); if (botao.dataset.searchAction === 'delete') await excluirItem(botao.dataset.type, Number(botao.dataset.id)); if (botao.dataset.searchAction === 'status') await alternarStatusParcela(Number(botao.dataset.id)); }
  async function handleAdminActions(event){
    var botao = event.target.closest('button');
    if (!botao) return;
    var userId = botao.dataset.userId;
    if (botao.dataset.adminRole) {
      await supabaseClient.from('user_roles').upsert({ user_id: userId, role: botao.dataset.adminRole }, { onConflict:'user_id' });
      C.showToast('Permissão atualizada.', 'success');
      await carregarUsuariosAdmin();
      return;
    }
    if (botao.dataset.adminActive) {
      var resultAtivo = await supabaseClient.from('user_profiles').update({ is_active: botao.dataset.adminActive === 'true' }).eq('user_id', userId);
      if (resultAtivo.error) return C.showToast('Não foi possível alterar o acesso.', 'error');
      C.showToast(botao.dataset.adminActive === 'true' ? 'Usuário reativado.' : 'Usuário desativado.', 'success');
      await carregarUsuariosAdmin();
      return;
    }
    if (botao.dataset.adminBlock) {
      var payload = botao.dataset.adminBlock === 'clear' ? { blocked_until:null } : { blocked_until:new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
      var resultBlock = await supabaseClient.from('user_profiles').update(payload).eq('user_id', userId);
      if (resultBlock.error) return C.showToast('Não foi possível alterar o bloqueio.', 'error');
      C.showToast(botao.dataset.adminBlock === 'clear' ? 'Bloqueio removido.' : 'Usuário bloqueado por 24h.', 'success');
      await carregarUsuariosAdmin();
      return;
    }
    if (botao.dataset.adminReset) {
      var updateReset = await supabaseClient.from('user_profiles').update({ force_password_reset:true, blocked_until:null, is_active:true }).eq('user_id', userId);
      if (updateReset.error) return C.showToast('Não foi possível marcar a redefinição.', 'error');
      var ok = await enviarResetAdmin(botao.dataset.email || '');
      C.showToast(ok ? 'Link de redefinição enviado por email.' : 'A conta foi marcada para redefinir a senha no próximo acesso.', ok ? 'success' : 'info');
      await carregarUsuariosAdmin();
      return;
    }
  }
  /* ── CRUD: Adicionar ── */
  async function adicionarReceita(){
    var desc = q('receitaDescricao'), val = q('receitaValor');
    if (!desc || !val) return;
    var descricao = desc.value.trim();
    var valor = parseFloat(String(val.value).replace(',','.'));
    if (!descricao) return C.showToast('Informe a descrição da receita.', 'error');
    if (!valor || valor <= 0) return C.showToast('Informe um valor válido.', 'error');
    var payload = {
      user_id: state.user.id,
      descricao: descricao,
      valor: valor,
      categoria: (q('receitaCategoria') && q('receitaCategoria').value.trim()) || '',
      status: (q('receitaStatus') && q('receitaStatus').value) || 'recebido',
      tipo: (q('receitaTipo') && q('receitaTipo').value) || 'receita_real',
      recorrencia_tipo: (q('receitaRecorrencia') && q('receitaRecorrencia').value) || 'nao_recorrente',
      recebimento_em: toIsoDateSafe(q('receitaRecebimento') && q('receitaRecebimento').value) || null,
      competencia: toIsoDateSafe(q('receitaCompetencia') && q('receitaCompetencia').value) || null,
      conta: (q('receitaConta') && q('receitaConta').value.trim()) || '',
      observacao: (q('receitaObservacao') && q('receitaObservacao').value.trim()) || '',
      created_at: buildCreatedAtForPlanilha()
    };
    var result = await supabaseClient.from('receitas').insert(payload);
    if (result.error) return C.showToast('Erro ao salvar receita: ' + result.error.message, 'error');
    C.showToast('Receita adicionada!', 'success');
    ['receitaDescricao','receitaValor','receitaCategoria','receitaConta','receitaObservacao'].forEach(function(id){ if (exists(id)) q(id).value = ''; });
    if (exists('receitaStatus')) q('receitaStatus').value = 'recebido';
    if (exists('receitaRecorrencia')) q('receitaRecorrencia').value = 'nao_recorrente';
    if (exists('receitaRecebimento')) q('receitaRecebimento').value = '';
    if (exists('receitaCompetencia')) q('receitaCompetencia').value = '';
    await loadData();
  }

  async function adicionarDespesa(){
    var desc = q('despesaDescricao'), val = q('despesaValor');
    if (!desc || !val) return;
    var descricao = desc.value.trim();
    var valor = parseFloat(String(val.value).replace(',','.'));
    if (!descricao) return C.showToast('Informe a descrição da saída.', 'error');
    if (!valor || valor <= 0) return C.showToast('Informe um valor válido.', 'error');
    var parceladoAtivo = exists('saidaParceladaToggle') && q('saidaParceladaToggle').checked;
    if (parceladoAtivo) {
      // Redireciona para adicionarParcela se o bloco parcelado estiver ativo
      return adicionarParcela();
    }
    var payload = {
      user_id: state.user.id,
      descricao: descricao,
      valor: valor,
      categoria: (q('despesaCategoria') && q('despesaCategoria').value.trim()) || '',
      status: (q('despesaStatus') && q('despesaStatus').value) || 'paga',
      tipo: (q('despesaTipo') && q('despesaTipo').value) || 'variavel',
      recorrencia_tipo: (q('despesaRecorrencia') && q('despesaRecorrencia').value) || 'nao_recorrente',
      pagamento_em: toIsoDateSafe(q('despesaPagamento') && q('despesaPagamento').value) || null,
      competencia: toIsoDateSafe(q('despesaCompetencia') && q('despesaCompetencia').value) || null,
      forma_pagamento: (q('despesaFormaPagamento') && q('despesaFormaPagamento').value) || '',
      centro_custo: (q('despesaCentroCusto') && q('despesaCentroCusto').value.trim()) || '',
      conta: (q('despesaConta') && q('despesaConta').value.trim()) || '',
      observacao: (q('despesaObservacao') && q('despesaObservacao').value.trim()) || '',
      created_at: buildCreatedAtForPlanilha()
    };
    var result = await supabaseClient.from('despesas').insert(payload);
    if (result.error) return C.showToast('Erro ao salvar saída: ' + result.error.message, 'error');
    C.showToast('Saída adicionada!', 'success');
    ['despesaDescricao','despesaValor','despesaCategoria','despesaCentroCusto','despesaConta','despesaObservacao'].forEach(function(id){ if (exists(id)) q(id).value = ''; });
    if (exists('despesaStatus')) q('despesaStatus').value = 'paga';
    if (exists('despesaTipo')) q('despesaTipo').value = 'variavel';
    if (exists('despesaRecorrencia')) q('despesaRecorrencia').value = 'nao_recorrente';
    if (exists('despesaPagamento')) q('despesaPagamento').value = '';
    if (exists('despesaCompetencia')) q('despesaCompetencia').value = '';
    await loadData();
  }

  async function adicionarParcela(){
    var desc = q('parcelaDescricao'), val = q('parcelaValor');
    if (!desc || !val) return;
    var descricao = desc.value.trim();
    var valor = parseFloat(String(val.value).replace(',','.'));
    if (!descricao) return C.showToast('Informe a descrição da parcela.', 'error');
    if (!valor || valor <= 0) return C.showToast('Informe um valor válido.', 'error');
    var recorrente = exists('parcelaRecorrente') && q('parcelaRecorrente').checked;
    var quantidade = recorrente ? 0 : (parseInt(q('parcelaQuantidade') && q('parcelaQuantidade').value) || 1);
    var atual = recorrente ? 1 : (parseInt(q('parcelaAtual') && q('parcelaAtual').value) || 1);
    var payload = {
      user_id: state.user.id,
      descricao: descricao,
      valor_total: valor,
      categoria: (q('parcelaCategoria') && q('parcelaCategoria').value.trim()) || '',
      quantidade: quantidade,
      parcela_atual: atual,
      recorrente: recorrente,
      status: (q('parcelaStatus') && q('parcelaStatus').value) || 'pendente',
      vencimento: toIsoDateSafe(q('parcelaVencimento') && q('parcelaVencimento').value) || null,
      created_at: buildCreatedAtForPlanilha()
    };
    var result = await supabaseClient.from('parcelas').insert(payload);
    if (result.error) return C.showToast('Erro ao salvar parcela: ' + result.error.message, 'error');
    C.showToast('Parcela adicionada!', 'success');
    ['parcelaDescricao','parcelaValor','parcelaCategoria'].forEach(function(id){ if (exists(id)) q(id).value = ''; });
    if (exists('parcelaQuantidade')) q('parcelaQuantidade').value = '';
    if (exists('parcelaAtual')) q('parcelaAtual').value = '';
    if (exists('parcelaVencimento')) q('parcelaVencimento').value = '';
    if (exists('parcelaStatus')) q('parcelaStatus').value = 'pendente';
    if (exists('parcelaRecorrente')) q('parcelaRecorrente').checked = false;
    if (exists('saidaParceladaToggle')) { q('saidaParceladaToggle').checked = false; if (exists('blocoParceladoDentroSaidas')) q('blocoParceladoDentroSaidas').style.cssText = 'display:none'; }
    await loadData();
  }

  /* ── CRUD: Duplicar / Excluir ── */
  async function duplicarItem(type, id){
    var tabela = type === 'receita' ? 'receitas' : (type === 'despesa' ? 'despesas' : 'parcelas');
    var encontrado = (type === 'receita' ? state.receitas : (type === 'despesa' ? state.despesas : state.parcelas)).find(function(i){ return i.id === id; });
    if (!encontrado) return C.showToast('Item não encontrado.', 'error');
    var clone = Object.assign({}, encontrado);
    delete clone.id;
    clone.created_at = buildCreatedAtForPlanilha();
    clone.user_id = state.user.id;
    var result = await supabaseClient.from(tabela).insert(clone);
    if (result.error) return C.showToast('Erro ao duplicar: ' + result.error.message, 'error');
    C.showToast('Item duplicado!', 'success');
    await loadData();
  }

  async function excluirItem(type, id){
    if (!confirm('Excluir este item? Essa ação não pode ser desfeita.')) return;
    var tabela = type === 'receita' ? 'receitas' : (type === 'despesa' ? 'despesas' : 'parcelas');
    var ok = await removerGenerico(tabela, id);
    if (!ok) return C.showToast('Erro ao excluir item.', 'error');
    C.showToast('Item excluído.', 'success');
    await loadData();
  }

  /* ── CRUD: Modal de edição ── */
  function fecharModal(){
    if (exists('modalBackdrop')) { q('modalBackdrop').style.display = 'none'; q('modalBackdrop').style.alignItems = ''; }
    state.editandoItem = null;
    ['modalReceitaForm','modalDespesaForm','modalParcelaForm'].forEach(function(id){ if (exists(id)) q(id).style.display = 'none'; });
  }

  function abrirModalEdicao(type, id){
    var item = (type === 'receita' ? state.receitas : (type === 'despesa' ? state.despesas : state.parcelas)).find(function(i){ return i.id === id; });
    if (!item) return C.showToast('Item não encontrado.', 'error');
    state.editandoItem = { type: type, id: id };
    ['modalReceitaForm','modalDespesaForm','modalParcelaForm'].forEach(function(fid){ if (exists(fid)) q(fid).style.display = 'none'; });
    if (exists('modalTitulo')) q('modalTitulo').textContent = type === 'receita' ? 'Editar receita' : (type === 'despesa' ? 'Editar saída' : 'Editar parcela');
    if (type === 'receita' && exists('modalReceitaForm')){
      q('modalReceitaForm').style.display = 'block';
      if (exists('editReceitaDescricao')) q('editReceitaDescricao').value = item.descricao || '';
      if (exists('editReceitaValor')) q('editReceitaValor').value = item.valor || '';
    } else if (type === 'despesa' && exists('modalDespesaForm')){
      q('modalDespesaForm').style.display = 'block';
      if (exists('editDespesaDescricao')) q('editDespesaDescricao').value = item.descricao || '';
      if (exists('editDespesaCategoria')) q('editDespesaCategoria').value = item.categoria || '';
      if (exists('editDespesaValor')) q('editDespesaValor').value = item.valor || '';
    } else if (type === 'parcela' && exists('modalParcelaForm')){
      q('modalParcelaForm').style.display = 'block';
      if (exists('editParcelaDescricao')) q('editParcelaDescricao').value = item.descricao || '';
      if (exists('editParcelaCategoria')) q('editParcelaCategoria').value = item.categoria || '';
      if (exists('editParcelaValor')) q('editParcelaValor').value = item.valor_total || '';
      if (exists('editParcelaQuantidade')) q('editParcelaQuantidade').value = item.quantidade || '';
      if (exists('editParcelaAtual')) q('editParcelaAtual').value = item.parcela_atual || '';
      if (exists('editParcelaVencimento')) q('editParcelaVencimento').value = toIsoDateSafe(item.vencimento);
      if (exists('editParcelaStatus')) q('editParcelaStatus').value = item.status || 'pendente';
      if (exists('editParcelaRecorrente')) q('editParcelaRecorrente').checked = !!item.recorrente;
    }
    if (exists('modalBackdrop')){ q('modalBackdrop').style.display = 'flex'; q('modalBackdrop').style.alignItems = 'center'; }
  }

  async function salvarEdicaoAtual(){
    if (!state.editandoItem) return;
    var type = state.editandoItem.type;
    var id = state.editandoItem.id;
    var tabela = type === 'receita' ? 'receitas' : (type === 'despesa' ? 'despesas' : 'parcelas');
    var payload = {};
    if (type === 'receita'){
      payload.descricao = (exists('editReceitaDescricao') && q('editReceitaDescricao').value.trim()) || '';
      payload.valor = parseFloat(String(exists('editReceitaValor') && q('editReceitaValor').value || '0').replace(',','.')) || 0;
      if (!payload.descricao) return C.showToast('Informe a descrição.', 'error');
    } else if (type === 'despesa'){
      payload.descricao = (exists('editDespesaDescricao') && q('editDespesaDescricao').value.trim()) || '';
      payload.categoria = (exists('editDespesaCategoria') && q('editDespesaCategoria').value.trim()) || '';
      payload.valor = parseFloat(String(exists('editDespesaValor') && q('editDespesaValor').value || '0').replace(',','.')) || 0;
      if (!payload.descricao) return C.showToast('Informe a descrição.', 'error');
    } else {
      payload.descricao = (exists('editParcelaDescricao') && q('editParcelaDescricao').value.trim()) || '';
      payload.categoria = (exists('editParcelaCategoria') && q('editParcelaCategoria').value.trim()) || '';
      payload.valor_total = parseFloat(String(exists('editParcelaValor') && q('editParcelaValor').value || '0').replace(',','.')) || 0;
      payload.quantidade = parseInt(exists('editParcelaQuantidade') && q('editParcelaQuantidade').value) || 0;
      payload.parcela_atual = parseInt(exists('editParcelaAtual') && q('editParcelaAtual').value) || 1;
      payload.vencimento = toIsoDateSafe(exists('editParcelaVencimento') && q('editParcelaVencimento').value) || null;
      payload.status = (exists('editParcelaStatus') && q('editParcelaStatus').value) || 'pendente';
      payload.recorrente = exists('editParcelaRecorrente') && q('editParcelaRecorrente').checked;
      if (!payload.descricao) return C.showToast('Informe a descrição.', 'error');
    }
    var ok = await atualizarGenerico(tabela, id, payload);
    if (!ok) return C.showToast('Erro ao salvar alterações.', 'error');
    C.showToast('Alterações salvas!', 'success');
    fecharModal();
    await loadData();
  }

  /* ── CRUD: Status parcela ── */
  async function alternarStatusParcela(id){
    var item = state.parcelas.find(function(i){ return i.id === id; });
    if (!item) return C.showToast('Parcela não encontrada.', 'error');
    var novoStatus = item.status === 'paga' ? 'pendente' : 'paga';
    var ok = await atualizarGenerico('parcelas', id, { status: novoStatus });
    if (!ok) return C.showToast('Erro ao alterar status.', 'error');
    C.showToast(novoStatus === 'paga' ? 'Marcada como paga!' : 'Marcada como pendente.', 'success');
    await loadData();
  }

  function exportarCsv(){ var itens = construirItensPesquisa(); if (!itens.length) return C.showToast('Não há resultados para exportar.', 'error'); var linhas = [['tipo','descricao','categoria','detalhe','valor','status','data'].join(';')].concat(itens.map(function(item){ return [labelTipo(item.type), '"' + String(item.descricao || '').replace(/"/g, '""') + '"', '"' + String(item.categoria || '').replace(/"/g, '""') + '"', '"' + String(item.detalhe || '').replace(/"/g, '""') + '"', Number(item.valor || 0).toFixed(2).replace('.', ','), '"' + String(item.status || '-').replace(/"/g, '""') + '"', item.dataBase || ''].join(';'); })); var blob = new Blob(['\ufeff' + linhas.join('\n')], { type:'text/csv;charset=utf-8;' }); var url = URL.createObjectURL(blob); var a = document.createElement('a'); a.href = url; a.download = 'planilha-financeira-' + getPlanilhaMesAtivo() + '.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); }
  async function init(){
    syncPlanilhaMesUI();
    initStaticEvents();
    setMetaTab('meta');
    window.addEventListener('error', function(event){ C.showFatalError(event.message || 'Erro inesperado ao iniciar o painel.'); });
    window.addEventListener('unhandledrejection', function(event){ C.showFatalError(event.reason && event.reason.message || 'Falha inesperada ao carregar o painel.'); });
    await loadData();
  }
  document.addEventListener('DOMContentLoaded', init);
})();
