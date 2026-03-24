// ============================================================
//  GuardanapON — Supabase Client & Auth
//  Substitua SUPABASE_URL e SUPABASE_ANON_KEY pelos seus valores
//  do painel: https://app.supabase.com/project/_/settings/api
// ============================================================

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ---- CONFIGURAÇÃO ----
const SUPABASE_URL      = 'https://SEU_PROJETO.supabase.co';
const SUPABASE_ANON_KEY = 'SUA_ANON_KEY_AQUI';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ============================================================
//  AUTH
// ============================================================

/**
 * Login com e-mail e senha.
 * @returns {{ user, session, error }}
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  return { user: data?.user, session: data?.session, error };
}

/**
 * Cadastro de novo usuário.
 * @param {string} email
 * @param {string} password
 * @param {'cliente'|'musico'|'restaurante'|'admin'} role
 * @param {string} name
 */
export async function signUp(email, password, role, name) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { role, name }   // guardados em auth.users.raw_user_meta_data
    }
  });

  if (!error && data.user) {
    // Cria o registro na tabela pública `profiles`
    await supabase.from('profiles').insert({
      id:   data.user.id,
      role,
      name,
      email
    });
  }

  return { user: data?.user, error };
}

/** Logout */
export async function signOut() {
  return supabase.auth.signOut();
}

/** Retorna o usuário autenticado no momento */
export async function getCurrentUser() {
  const { data } = await supabase.auth.getUser();
  return data?.user ?? null;
}

/** Busca o perfil completo do usuário (com role, saldo, etc.) */
export async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return { profile: data, error };
}

// ============================================================
//  MÚSICAS / FILA
// ============================================================

/**
 * Busca a fila de votação de um evento ativo.
 * Retorna músicas ordenadas por votos (desc) + pedidos pagos primeiro.
 */
export async function getQueue(eventoId) {
  const { data, error } = await supabase
    .from('queue_items')
    .select(`
      *,
      song:songs(id, title, artist, album_art, has_chord),
      votes:votes(count)
    `)
    .eq('evento_id', eventoId)
    .order('is_paid', { ascending: false })
    .order('vote_count', { ascending: false });
  return { queue: data, error };
}

/** Adiciona um voto a um item da fila */
export async function voteOnSong(queueItemId, userId) {
  // Upsert evita votos duplicados (PK composta no schema)
  const { error } = await supabase
    .from('votes')
    .upsert({ queue_item_id: queueItemId, user_id: userId });
  return { error };
}

/** Remove o voto */
export async function removeVote(queueItemId, userId) {
  const { error } = await supabase
    .from('votes')
    .delete()
    .eq('queue_item_id', queueItemId)
    .eq('user_id', userId);
  return { error };
}

/** Busca músicas pelo nome (para o campo de pesquisa) */
export async function searchSongs(query) {
  const { data, error } = await supabase
    .from('songs')
    .select('id, title, artist, album_art, has_chord')
    .ilike('title', `%${query}%`)
    .limit(10);
  return { songs: data, error };
}

// ============================================================
//  PEDIDOS
// ============================================================

/**
 * Cria um pedido pago (fura-fila) ou de votação.
 * Para pedidos pagos, o pagamento via Mercado Pago deve ser
 * processado ANTES de chamar esta função; passe o payment_id.
 */
export async function createRequest({
  eventoId,
  songId,
  userId,
  isPaid = false,
  tipAmount = 0,
  dedication = '',
  paymentId = null
}) {
  const { data, error } = await supabase
    .from('queue_items')
    .insert({
      evento_id:   eventoId,
      song_id:     songId,
      requested_by: userId,
      is_paid:     isPaid,
      tip_amount:  tipAmount,
      dedication,
      payment_id:  paymentId,
      status:      'pending'   // pending | accepted | declined | refunded
    })
    .select()
    .single();
  return { request: data, error };
}

/**
 * Músico aceita um pedido → status = 'accepted'
 * O split de pagamento é processado via Edge Function no backend.
 */
export async function acceptRequest(queueItemId) {
  const { data, error } = await supabase
    .from('queue_items')
    .update({ status: 'accepted', responded_at: new Date().toISOString() })
    .eq('id', queueItemId)
    .select()
    .single();

  // Dispara Edge Function para executar o split
  if (!error && data.is_paid) {
    await supabase.functions.invoke('process-split', {
      body: { queue_item_id: queueItemId }
    });
  }
  return { request: data, error };
}

/**
 * Músico recusa um pedido → status = 'declined' + reembolso automático.
 * O reembolso é processado pela Edge Function 'process-refund'.
 */
export async function declineRequest(queueItemId) {
  const { data, error } = await supabase
    .from('queue_items')
    .update({ status: 'declined', responded_at: new Date().toISOString() })
    .eq('id', queueItemId)
    .select()
    .single();

  if (!error && data.is_paid) {
    await supabase.functions.invoke('process-refund', {
      body: { queue_item_id: queueItemId }
    });
  }
  return { request: data, error };
}

// ============================================================
//  REALTIME — escuta a fila em tempo real
// ============================================================

/**
 * Inscreve em atualizações da fila de um evento.
 * @param {string} eventoId
 * @param {(payload: any) => void} callback
 * @returns {RealtimeChannel} — chame .unsubscribe() ao desmontar
 */
export function subscribeToQueue(eventoId, callback) {
  return supabase
    .channel(`queue:${eventoId}`)
    .on(
      'postgres_changes',
      {
        event:  '*',
        schema: 'public',
        table:  'queue_items',
        filter: `evento_id=eq.${eventoId}`
      },
      callback
    )
    .subscribe();
}

// ============================================================
//  FINANCEIRO
// ============================================================

/** Busca extrato de transações do usuário */
export async function getTransactions(userId, limit = 20) {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return { transactions: data, error };
}

/** Busca saldo da carteira do usuário */
export async function getWalletBalance(userId) {
  const { data, error } = await supabase
    .from('wallets')
    .select('balance')
    .eq('user_id', userId)
    .single();
  return { balance: data?.balance ?? 0, error };
}

/** Busca receita do músico na noite (evento atual) */
export async function getMusicoEarnings(musicoId, eventoId) {
  const { data, error } = await supabase
    .from('earnings')
    .select('*')
    .eq('musico_id', musicoId)
    .eq('evento_id', eventoId)
    .single();
  return { earnings: data, error };
}

// ============================================================
//  EVENTOS
// ============================================================

/** Busca o evento ativo de um estabelecimento */
export async function getActiveEvent(restauranteId) {
  const { data, error } = await supabase
    .from('eventos')
    .select('*, musico:profiles(id, name), restaurante:profiles(id, name)')
    .eq('restaurante_id', restauranteId)
    .eq('status', 'live')
    .single();
  return { event: data, error };
}

/** Check-in do músico (inicia evento) */
export async function startEvent(musicoId, restauranteId) {
  const { data, error } = await supabase
    .from('eventos')
    .insert({
      musico_id:       musicoId,
      restaurante_id:  restauranteId,
      status:          'live',
      started_at:      new Date().toISOString()
    })
    .select()
    .single();
  return { event: data, error };
}

/** Check-out do músico (encerra evento) */
export async function endEvent(eventoId) {
  const { data, error } = await supabase
    .from('eventos')
    .update({ status: 'ended', ended_at: new Date().toISOString() })
    .eq('id', eventoId)
    .select()
    .single();
  return { event: data, error };
}
