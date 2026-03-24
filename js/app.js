// ============================================================
//  GuardanapON — App Logic & UI Controller
//  Depende de: supabase.js (importado via <script type="module">)
// ============================================================

// ============================================================
//  ESTADO GLOBAL
// ============================================================
const State = {
  currentRole: 'cliente',
  currentUser: null,
  currentProfile: null,
  activeEventId: null,
  currentOrderSong: '',
  currentOrderArtist: '',
  currentOrderEmoji: '🎸',
  currentOrderHasChord: true,
  currentOrderType: 'vote',
  selectedTip: 15,
  queueChannel: null,        // Realtime channel
};

// ============================================================
//  NAVEGAÇÃO DE TELAS
// ============================================================

/**
 * Exibe a tela com o id fornecido e esconde as demais.
 * @param {string} id - id do elemento .screen
 */
export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('active');
    window.scrollTo(0, 0);
  } else {
    console.warn(`[GuardanapON] Tela não encontrada: ${id}`);
  }
}

/** Ativa o item de navegação clicado e desativa os demais */
export function setActiveNav(el) {
  const nav = el.closest('nav');
  if (!nav) return;
  nav.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');
}

// ============================================================
//  AUTH — LOGIN / CADASTRO
// ============================================================

/** Seleciona papel no login */
export function selectRole(el, role) {
  document.querySelectorAll('.role-chip').forEach(c => c.classList.remove('selected'));
  el.classList.add('selected');
  State.currentRole = role;
}

/**
 * Executa login via Supabase.
 * Em modo DEMO (sem Supabase configurado), navega diretamente.
 */
export async function doLogin() {
  const email    = document.getElementById('login-email')?.value?.trim();
  const password = document.getElementById('login-pass')?.value;
  const errorEl  = document.getElementById('auth-error');

  if (!email) { showAuthError('Preencha o e-mail!'); return; }
  if (!password) { showAuthError('Preencha a senha!'); return; }

  // --- MODO DEMO: sem Supabase real, navega pela role selecionada ---
  if (isDemoMode()) {
    navigateByRole(State.currentRole);
    showToast('✓ Entrando como ' + State.currentRole + ' (modo demo)');
    return;
  }

  // --- MODO PRODUÇÃO ---
  showLoading(true);
  try {
    const { signIn, getUserProfile } = await import('./supabase.js');
    const { user, error } = await signIn(email, password);

    if (error) { showAuthError(error.message); return; }

    const { profile } = await getUserProfile(user.id);
    State.currentUser    = user;
    State.currentProfile = profile;

    navigateByRole(profile?.role ?? 'cliente');
    showToast('✓ Bem-vindo de volta, ' + (profile?.name ?? email) + '!');
  } catch (e) {
    showAuthError('Erro de conexão. Tente novamente.');
    console.error(e);
  } finally {
    showLoading(false);
  }
}

/**
 * Registra novo usuário.
 */
export async function doRegister() {
  const name     = document.getElementById('reg-name')?.value?.trim();
  const email    = document.getElementById('reg-email')?.value?.trim();
  const password = document.getElementById('reg-pass')?.value;

  if (!name || !email || !password) {
    showAuthError('Preencha todos os campos!'); return;
  }
  if (password.length < 8) {
    showAuthError('A senha precisa ter pelo menos 8 caracteres!'); return;
  }

  if (isDemoMode()) {
    showScreen('screen-cliente');
    showToast('🎉 Conta criada! Bem-vindo, ' + name + '!');
    return;
  }

  showLoading(true);
  try {
    const { signUp } = await import('./supabase.js');
    const { user, error } = await signUp(email, password, State.currentRole, name);
    if (error) { showAuthError(error.message); return; }

    State.currentUser = user;
    showToast('🎉 Conta criada! Confira seu e-mail para verificar.');
    showScreen('screen-login');
  } catch (e) {
    showAuthError('Erro ao criar conta. Tente novamente.');
  } finally {
    showLoading(false);
  }
}

export async function doLogout() {
  if (!isDemoMode()) {
    const { signOut } = await import('./supabase.js');
    await signOut();
  }
  // Limpa estado
  State.currentUser    = null;
  State.currentProfile = null;
  State.activeEventId  = null;
  if (State.queueChannel) {
    State.queueChannel.unsubscribe();
    State.queueChannel = null;
  }
  showScreen('screen-login');
  showToast('✓ Sessão encerrada.');
}

function navigateByRole(role) {
  const map = {
    cliente:     'screen-cliente',
    musico:      'screen-musico',
    restaurante: 'screen-cliente',
    admin:       'screen-cliente',
  };
  showScreen(map[role] ?? 'screen-cliente');
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = msg; el.classList.add('show'); }
}

// ============================================================
//  BUSCA DE MÚSICAS
// ============================================================

let searchDebounceTimer = null;

/** Chamado pelo oninput do campo de busca */
export function handleSearch(value) {
  const resultsEl     = document.getElementById('search-results');
  const suggestionsEl = document.getElementById('suggestions-section');

  if (value.length < 2) {
    resultsEl.style.display     = 'none';
    suggestionsEl.style.display = 'block';
    return;
  }

  resultsEl.style.display     = 'block';
  suggestionsEl.style.display = 'none';

  // Debounce para não disparar a cada tecla
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    if (isDemoMode()) return; // demo já tem resultados estáticos no HTML
    try {
      const { searchSongs } = await import('./supabase.js');
      const { songs } = await searchSongs(value);
      renderSearchResults(songs ?? []);
    } catch (e) {
      console.error('Erro na busca:', e);
    }
  }, 350);
}

/** Renderiza resultados dinâmicos vindos do Supabase */
function renderSearchResults(songs) {
  const container = document.getElementById('search-results-list');
  if (!container) return;

  container.innerHTML = songs.map(s => `
    <div class="search-result" onclick="App.selectSong('${escapeAttr(s.title)}', '${escapeAttr(s.artist)}', ${s.has_chord}, '${escapeAttr(s.album_art ?? '🎵')}')">
      <div class="album-art">${s.album_art ? `<img src="${s.album_art}" style="width:100%;height:100%;object-fit:cover;" alt="${escapeAttr(s.title)}"/>` : '🎵'}</div>
      <div style="flex:1;">
        <div style="font-weight:700;font-size:15px;">${escapeHtml(s.title)}</div>
        <div style="font-size:11px;opacity:0.5;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;">${escapeHtml(s.artist)}</div>
      </div>
      <span class="tag ${s.has_chord ? 'tag-primary' : 'tag-error'}">${s.has_chord ? 'CIFRA ✓' : 'SEM CIFRA'}</span>
    </div>
  `).join('');
}

export function showSearchResults() {
  const val = document.getElementById('search-input')?.value ?? '';
  if (val.length > 0) handleSearch(val);
}

// ============================================================
//  PEDIDO / ORDER FLOW
// ============================================================

/**
 * Seleciona uma música e abre o fluxo de pedido correto.
 * Se não tiver cifra, exibe o aviso primeiro.
 */
export function selectSong(song, artist, hasChord, emoji = '🎸') {
  State.currentOrderSong      = song;
  State.currentOrderArtist    = artist;
  State.currentOrderHasChord  = hasChord;
  State.currentOrderEmoji     = emoji;

  if (!hasChord) {
    const nameEl = document.getElementById('sem-cifra-song');
    if (nameEl) nameEl.textContent = `"${song}"`;
    openModal('modal-sem-cifra');
  } else {
    openOrderModal();
  }
}

export function openOrderModal() {
  const songEl   = document.getElementById('order-song-name');
  const artistEl = document.getElementById('order-artist-name');
  const emojiEl  = document.getElementById('order-emoji');
  const badgeEl  = document.getElementById('order-cifra-badge');

  if (songEl)   songEl.textContent   = State.currentOrderSong;
  if (artistEl) artistEl.textContent = State.currentOrderArtist;
  if (emojiEl)  emojiEl.textContent  = State.currentOrderEmoji;
  if (badgeEl) {
    badgeEl.textContent  = State.currentOrderHasChord ? 'CIFRA ✓' : 'SEM CIFRA ⚠';
    badgeEl.className    = 'tag ' + (State.currentOrderHasChord ? 'tag-primary' : 'tag-error');
  }

  // Reseta para voto grátis
  selectOrderType('vote', document.getElementById('order-type-vote'));
  openModal('modal-pedido');
}

export function selectOrderType(type, el) {
  State.currentOrderType = type;
  document.getElementById('order-type-vote')?.classList.remove('selected');
  document.getElementById('order-type-paid')?.classList.remove('selected');
  el?.classList.add('selected');
  const paidOpts = document.getElementById('paid-options');
  if (paidOpts) paidOpts.style.display = type === 'paid' ? 'block' : 'none';
}

export function selectTip(btn, amount) {
  State.selectedTip = amount;
  btn.closest('#paid-options')?.querySelectorAll('button[data-tip]').forEach(b => {
    b.classList.replace('btn-primary', 'btn-ghost');
  });
  btn.classList.replace('btn-ghost', 'btn-primary');
}

export async function submitOrder() {
  closeModal('modal-pedido');

  if (isDemoMode()) {
    if (State.currentOrderType === 'paid') {
      showToast(`🎵 Pedido fura-fila enviado! R$ ${State.selectedTip} debitado.`);
    } else {
      showToast('✓ Voto na fila registrado!');
    }
    setTimeout(() => showScreen('screen-cliente'), 300);
    return;
  }

  try {
    const { createRequest } = await import('./supabase.js');
    const dedication = document.getElementById('order-dedication')?.value ?? '';
    const { request, error } = await createRequest({
      eventoId:  State.activeEventId,
      songId:    null, // em produção, passe o ID real da música
      userId:    State.currentUser?.id,
      isPaid:    State.currentOrderType === 'paid',
      tipAmount: State.selectedTip,
      dedication,
    });

    if (error) { showToast('⚠ Erro ao enviar pedido.'); return; }
    showToast(State.currentOrderType === 'paid'
      ? `🎵 Pedido fura-fila enviado! R$ ${State.selectedTip} debitado.`
      : '✓ Voto registrado!'
    );
  } catch (e) {
    showToast('⚠ Erro de conexão.');
    console.error(e);
  }

  setTimeout(() => showScreen('screen-cliente'), 300);
}

// ============================================================
//  MÚSICO — ACEITAR / RECUSAR
// ============================================================

export async function handleMusicoAccept(btn) {
  const card       = btn.closest('.request-card');
  const itemId     = card?.dataset?.queueItemId;
  const title      = card?.querySelector('.song-title')?.textContent ?? '';

  setCardState(card, 'accepted');

  if (!isDemoMode() && itemId) {
    const { acceptRequest } = await import('./supabase.js');
    const { error } = await acceptRequest(itemId);
    if (error) { showToast('⚠ Erro ao aceitar pedido.'); return; }
  }

  showToast(`✓ "${title}" aceita! Valor creditado.`);
  setTimeout(() => card?.remove(), 1500);
}

export async function handleMusicoDecline(btn) {
  const card   = btn.closest('.request-card');
  const itemId = card?.dataset?.queueItemId;
  const title  = card?.querySelector('.song-title')?.textContent ?? '';

  setCardState(card, 'declined');

  if (!isDemoMode() && itemId) {
    const { declineRequest } = await import('./supabase.js');
    const { error } = await declineRequest(itemId);
    if (error) { showToast('⚠ Erro ao recusar pedido.'); return; }
  }

  showToast(`↩ "${title}" recusada. Cliente reembolsado automaticamente.`);
  setTimeout(() => card?.remove(), 1500);
}

function setCardState(card, state) {
  if (!card) return;
  if (state === 'accepted') {
    card.style.background    = 'rgba(216,239,0,0.15)';
    card.style.borderColor   = 'rgba(90,100,0,0.3)';
  } else {
    card.style.opacity       = '0.4';
  }
  card.querySelectorAll('button').forEach(b => b.disabled = true);
}

// ============================================================
//  VOTAÇÃO
// ============================================================

export async function toggleVote(btn) {
  const queueItem = btn.closest('.queue-item');
  const itemId    = queueItem?.dataset?.queueItemId;
  const icon      = btn.querySelector('.material-symbols-outlined');
  const wasVoted  = btn.classList.contains('voted');

  btn.classList.toggle('voted');
  if (icon) icon.style.fontVariationSettings = wasVoted ? "'FILL' 0" : "'FILL' 1";

  if (!isDemoMode() && itemId) {
    const { voteOnSong, removeVote } = await import('./supabase.js');
    if (wasVoted) {
      await removeVote(itemId, State.currentUser?.id);
      showToast('✓ Voto removido');
    } else {
      await voteOnSong(itemId, State.currentUser?.id);
      showToast('✓ Voto registrado!');
    }
  } else {
    showToast(wasVoted ? '✓ Voto removido' : '✓ Voto registrado!');
  }
}

// ============================================================
//  REALTIME — fila ao vivo
// ============================================================

export async function initRealtimeQueue(eventoId) {
  if (isDemoMode()) return;
  const { subscribeToQueue } = await import('./supabase.js');

  // Cancela inscrição anterior
  State.queueChannel?.unsubscribe();

  State.queueChannel = subscribeToQueue(eventoId, (payload) => {
    console.log('[Realtime] Queue update:', payload);
    // Aqui você pode re-renderizar os cards dinamicamente
    // Exemplo: loadQueue(); 
  });
}

// ============================================================
//  CARTEIRA
// ============================================================

export async function loadWalletBalance() {
  if (isDemoMode()) return;
  const { getWalletBalance } = await import('./supabase.js');
  const { balance } = await getWalletBalance(State.currentUser?.id);

  const el = document.getElementById('wallet-balance');
  if (el) el.textContent = `R$ ${balance.toFixed(2)}`;

  const coinEl = document.getElementById('coin-badge');
  if (coinEl) coinEl.textContent = `${balance} créditos`;
}

export function selectRecharge(btn) {
  btn.closest('.modal-sheet')?.querySelectorAll('.btn-primary, .btn-ghost').forEach(b => {
    if (b.dataset.recharge) b.classList.replace('btn-primary', 'btn-ghost');
  });
  btn.classList.replace('btn-ghost', 'btn-primary');
}

export async function confirmRecharge() {
  const amount = 50; // em produção, pegue do botão selecionado
  closeModal('modal-recarga');

  if (isDemoMode()) {
    showToast(`✓ Recarga de R$ ${amount} processada!`);
    return;
  }

  // Em produção: chamar Mercado Pago Checkout aqui
  // e depois registrar no Supabase via Edge Function
  showToast(`✓ Recarga de R$ ${amount} iniciada!`);
}

// ============================================================
//  MODAIS
// ============================================================

export function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('open');

  const closeOnOverlay = (e) => {
    if (e.target === modal) {
      closeModal(id);
      modal.removeEventListener('click', closeOnOverlay);
    }
  };
  modal.addEventListener('click', closeOnOverlay);
}

export function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

// ============================================================
//  TOAST
// ============================================================

let toastTimer = null;

export function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  clearTimeout(toastTimer);
  t.textContent = msg;
  t.classList.add('show');
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

// ============================================================
//  LOADING OVERLAY
// ============================================================

export function showLoading(visible) {
  const el = document.getElementById('loading-overlay');
  if (el) el.style.display = visible ? 'flex' : 'none';
}

// ============================================================
//  PERFIL — SALVAR
// ============================================================

export async function saveProfile() {
  if (isDemoMode()) { showToast('✓ Perfil salvo!'); return; }
  // Em produção: atualizar tabela profiles no Supabase
  showToast('✓ Perfil salvo!');
}

// ============================================================
//  UTILITÁRIOS
// ============================================================

/** Verifica se Supabase está configurado ou é demo */
function isDemoMode() {
  return typeof window.__SUPABASE_URL__ === 'undefined'
    || window.__SUPABASE_URL__ === 'https://SEU_PROJETO.supabase.co';
}

function escapeHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function escapeAttr(str) {
  return String(str).replace(/'/g, "\\'");
}

// ============================================================
//  INICIALIZAÇÃO
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  // Progresso da música tocando (simulação)
  let pct = 63;
  setInterval(() => {
    pct = Math.min(pct + 0.05, 100);
    document.querySelectorAll('.progress-fill').forEach(el => {
      el.style.width = pct + '%';
    });
  }, 3000);

  // Expõe funções globalmente para uso nos atributos HTML onclick
  window.App = {
    showScreen, setActiveNav, selectRole, doLogin, doRegister, doLogout,
    handleSearch, showSearchResults, selectSong, openOrderModal,
    selectOrderType, selectTip, submitOrder, openModal, closeModal,
    toggleVote, handleMusicoAccept, handleMusicoDecline,
    selectRecharge, confirmRecharge, saveProfile, showToast,
  };

  console.log('[GuardanapON] App iniciado ✓');
});

// Export default namespace para uso como módulo
export default {
  showScreen, setActiveNav, selectRole, doLogin, doRegister, doLogout,
  handleSearch, showSearchResults, selectSong, openOrderModal,
  selectOrderType, selectTip, submitOrder, openModal, closeModal,
  toggleVote, handleMusicoAccept, handleMusicoDecline,
  selectRecharge, confirmRecharge, saveProfile, showToast,
};
