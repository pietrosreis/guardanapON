(function(){
  if (window.supabase && typeof window.supabase.createClient === 'function') return;
  function createError(payload, fallback) {
    var source = payload && typeof payload === 'object' ? payload : {};
    return { message: source.msg || source.message || source.error_description || source.error || fallback || 'Erro inesperado.', status: source.status || null, code: source.code || source.error_code || null, details: source.details || null };
  }
  function parseJwt(token) {
    try {
      var part = token.split('.')[1];
      var normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      var padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
      return JSON.parse(atob(padded));
    } catch (error) { return null; }
  }
  function toQueryValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return '';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    return String(value);
  }
  function buildFilterUrl(baseUrl, queryState) {
    var url = new URL(baseUrl);
    if (queryState.select) url.searchParams.set('select', queryState.select);
    (queryState.filters || []).forEach(function(filter){ url.searchParams.append(filter.column, filter.operator + '.' + toQueryValue(filter.value)); });
    (queryState.orders || []).forEach(function(item){ url.searchParams.append('order', item.column + '.' + (item.ascending ? 'asc' : 'desc')); });
    return url;
  }
  window.supabase = {
    createClient: function(supabaseUrl, supabaseKey) {
      var STORAGE_KEY = 'ce_session_' + new URL(supabaseUrl).hostname;
      var authListeners = new Set();
      var sessionCache = null;
      function notifyAuth(event, session) {
        authListeners.forEach(function(callback){ try { callback(event, session); } catch (error) { console.error(error); } });
      }
      function saveSession(session) {
        sessionCache = session || null;
        if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
        else localStorage.removeItem(STORAGE_KEY);
      }
      function loadSession() {
        if (sessionCache) return sessionCache;
        try { sessionCache = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (error) { sessionCache = null; }
        return sessionCache;
      }
      function normalizeSession(payload) {
        if (!payload || !payload.access_token) return null;
        var decoded = parseJwt(payload.access_token) || {};
        var user = payload.user || decoded.user_metadata ? {
          id: decoded.sub || (payload.user && payload.user.id) || null,
          email: (payload.user && payload.user.email) || decoded.email || null,
          app_metadata: (payload.user && payload.user.app_metadata) || decoded.app_metadata || {},
          user_metadata: (payload.user && payload.user.user_metadata) || decoded.user_metadata || {},
          created_at: (payload.user && payload.user.created_at) || decoded.created_at || null
        } : (payload.user || null);
        var expires_in = Number(payload.expires_in || 3600);
        var expires_at = Number(payload.expires_at || (Math.floor(Date.now()/1000) + expires_in));
        return { access_token: payload.access_token, refresh_token: payload.refresh_token || null, token_type: payload.token_type || 'bearer', expires_in: expires_in, expires_at: expires_at, user: user };
      }
      function getHashParams() { return new URLSearchParams(window.location.hash.replace(/^#/, '')); }
      async function captureSessionFromUrl() {
        var hash = getHashParams();
        var accessToken = hash.get('access_token');
        var refreshToken = hash.get('refresh_token');
        if (!accessToken) return loadSession();
        var session = normalizeSession({ access_token: accessToken, refresh_token: refreshToken, expires_in: Number(hash.get('expires_in') || 3600), token_type: hash.get('token_type') || 'bearer' });
        if (session && session.access_token) {
          try {
            var userResponse = await fetch(supabaseUrl + '/auth/v1/user', { headers: { apikey: supabaseKey, Authorization: 'Bearer ' + session.access_token } });
            var userPayload = await userResponse.json().catch(function(){ return null; });
            if (userResponse.ok && userPayload) session.user = userPayload;
          } catch (error) {}
          saveSession(session);
          window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
          notifyAuth(hash.get('type') === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN', session);
        }
        return loadSession();
      }
      async function refreshSessionIfNeeded() {
        var current = loadSession();
        if (!current || !current.refresh_token) return current || null;
        var expiresAt = Number(current.expires_at || 0);
        var now = Math.floor(Date.now()/1000);
        if (expiresAt && expiresAt - now > 45) return current;
        var response = await fetch(supabaseUrl + '/auth/v1/token?grant_type=refresh_token', { method: 'POST', headers: { 'Content-Type':'application/json', apikey:supabaseKey }, body: JSON.stringify({ refresh_token: current.refresh_token }) });
        var payload = await response.json().catch(function(){ return {}; });
        if (!response.ok) {
          saveSession(null);
          notifyAuth('SIGNED_OUT', null);
          return null;
        }
        var nextSession = normalizeSession(payload);
        saveSession(nextSession);
        notifyAuth('TOKEN_REFRESHED', nextSession);
        return nextSession;
      }
      async function getAccessToken() {
        var session = await captureSessionFromUrl();
        var refreshed = await refreshSessionIfNeeded();
        return (refreshed && refreshed.access_token) || (session && session.access_token) || null;
      }
      async function request(path, options) {
        options = options || {};
        var headers = Object.assign({ apikey: supabaseKey }, options.headers || {});
        var needsAuth = options.auth !== false;
        if (needsAuth) {
          var token = await getAccessToken();
          headers.Authorization = 'Bearer ' + (token || supabaseKey);
        } else if (!headers.Authorization) {
          headers.Authorization = 'Bearer ' + supabaseKey;
        }
        var response = await fetch(supabaseUrl + path, Object.assign({}, options, { headers: headers }));
        var isJson = String(response.headers.get('content-type') || '').indexOf('application/json') !== -1;
        var payload = isJson ? await response.json().catch(function(){ return null; }) : await response.text().catch(function(){ return ''; });
        if (!response.ok) return { data: null, error: createError(payload, 'Erro HTTP ' + response.status) };
        return { data: payload, error: null, response: response };
      }
      function createQueryBuilder(table) {
        var state = { table: table, select: '*', filters: [], orders: [], action: 'select', payload: null, upsert: false, onConflict: null, maybeSingle: false };
        var api = {
          select: function(columns){ state.select = columns || '*'; state.action = 'select'; return api; },
          eq: function(column, value){ state.filters.push({ column: column, operator: 'eq', value: value }); return api; },
          order: function(column, options){ state.orders.push({ column: column, ascending: !options || options.ascending !== false }); return api; },
          maybeSingle: function(){ state.maybeSingle = true; return execute(); },
          insert: function(payload){ state.action = 'insert'; state.payload = payload; return execute(); },
          update: function(payload){ state.action = 'update'; state.payload = payload; return api; },
          delete: function(){ state.action = 'delete'; return api; },
          upsert: function(payload, options){ state.action = 'upsert'; state.payload = payload; state.upsert = true; state.onConflict = options && options.onConflict || null; return execute(); },
          then: function(resolve, reject){ return execute().then(resolve, reject); },
          catch: function(reject){ return execute().catch(reject); }
        };
        async function execute() {
          var headers = { 'Content-Type': 'application/json' };
          var method = 'GET';
          var path = '/rest/v1/' + table;
          var body;
          if (state.action === 'select') {
            var url = buildFilterUrl(supabaseUrl + path, state);
            var selected = await request(url.pathname + url.search, { method: method, headers: headers });
            if (selected.error) return { data: null, error: selected.error };
            var rows = Array.isArray(selected.data) ? selected.data : [];
            return { data: state.maybeSingle ? (rows[0] || null) : rows, error: null };
          }
          if (state.action === 'insert' || state.action === 'upsert') {
            method = 'POST';
            headers.Prefer = 'return=representation';
            if (state.upsert) headers.Prefer += ',resolution=merge-duplicates';
            if (state.onConflict) {
              var upsertUrl = new URL(supabaseUrl + path);
              upsertUrl.searchParams.set('on_conflict', state.onConflict);
              path = upsertUrl.pathname + upsertUrl.search;
            }
            body = JSON.stringify(state.payload);
            var inserted = await request(path, { method: method, headers: headers, body: body });
            if (inserted.error) return { data: null, error: inserted.error };
            return { data: inserted.data, error: null };
          }
          var url2 = buildFilterUrl(supabaseUrl + path, state);
          path = url2.pathname + url2.search;
          if (state.action === 'update') { method = 'PATCH'; headers.Prefer = 'return=representation'; body = JSON.stringify(state.payload); }
          if (state.action === 'delete') { method = 'DELETE'; headers.Prefer = 'return=representation'; }
          var changed = await request(path, { method: method, headers: headers, body: body });
          if (changed.error) return { data: null, error: changed.error };
          return { data: changed.data, error: null };
        }
        return api;
      }
      var client = {
        from: function(table){ return createQueryBuilder(table); },
        rpc: async function(fn, params) { return request('/rest/v1/rpc/' + fn, { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify(params || {}) }); },
        auth: {
          getSession: async function(){ await captureSessionFromUrl(); var session = await refreshSessionIfNeeded(); return { data: { session: session || loadSession() }, error: null }; },
          signUp: async function(payload){
            var result = await request('/auth/v1/signup', { method:'POST', auth:false, headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email: payload.email, password: payload.password, data: payload.options && payload.options.data || {} }) });
            if (result.error) return { data:null, error: result.error };
            var session = normalizeSession(result.data);
            if (session) { saveSession(session); notifyAuth('SIGNED_IN', session); }
            return { data: result.data, error:null };
          },
          signInWithPassword: async function(payload){
            var result = await request('/auth/v1/token?grant_type=password', { method:'POST', auth:false, headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload) });
            if (result.error) return { data:null, error: result.error };
            var session = normalizeSession(result.data);
            saveSession(session);
            notifyAuth('SIGNED_IN', session);
            return { data: result.data, error:null };
          },
          signInWithOAuth: async function(payload){
            var url = new URL(supabaseUrl + '/auth/v1/authorize');
            url.searchParams.set('provider', payload.provider);
            if (payload.options && payload.options.redirectTo) url.searchParams.set('redirect_to', payload.options.redirectTo);
            var queryParams = payload.options && payload.options.queryParams || {};
            Object.keys(queryParams).forEach(function(key){ url.searchParams.set(key, queryParams[key]); });
            window.location.assign(url.toString());
            return { data: { url: url.toString() }, error: null };
          },
          resetPasswordForEmail: async function(email, options){ return request('/auth/v1/recover', { method:'POST', auth:false, headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email: email, redirect_to: options && options.redirectTo || window.location.origin }) }); },
          updateUser: async function(attributes){
            var token = await getAccessToken();
            var result = await request('/auth/v1/user', { method:'PUT', headers:{ 'Content-Type':'application/json', Authorization:'Bearer ' + (token || '') }, body: JSON.stringify(attributes) });
            if (result.error) return { data:null, error: result.error };
            var current = loadSession();
            if (current) { current.user = Object.assign({}, current.user || {}, result.data || {}); saveSession(current); notifyAuth('USER_UPDATED', current); }
            return { data: result.data, error:null };
          },
          signOut: async function(){
            var token = await getAccessToken();
            await request('/auth/v1/logout', { method:'POST', headers:{ Authorization:'Bearer ' + (token || '') } });
            saveSession(null); notifyAuth('SIGNED_OUT', null); return { error:null };
          },
          onAuthStateChange: function(callback){ authListeners.add(callback); return { data: { subscription: { unsubscribe: function(){ authListeners.delete(callback); } } } }; }
        }
      };
      captureSessionFromUrl().catch(function(){});
      return client;
    }
  };
})();
