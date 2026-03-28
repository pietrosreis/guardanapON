(function(){
  var cfg = window.APP_CONFIG;
  var C = window.AppCommon;
  var supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_KEY);
  window.AppAuth = { client: supabaseClient };
  function setErro(id, texto, ok){ var el = C.qs(id); if (!el) return; el.textContent = texto || ''; el.classList.toggle('field-ok', !!ok); }
  function limparErrosAuth(){ ['erroLoginUsuario','erroLoginSenha','erroLoginForm','erroCadastroUsuario','erroCadastroSenha','erroCadastroForm','erroResetForm','erroNovaSenha','erroSalvarSenha'].forEach(function(id){ setErro(id,'',false); }); }
  function trocarAbaAuth(tab){
    Array.prototype.forEach.call(document.querySelectorAll('.auth-tab-btn'), function(btn){ btn.classList.toggle('active', btn.dataset.authTab === tab); });
    Array.prototype.forEach.call(document.querySelectorAll('.auth-panel'), function(painel){ painel.classList.remove('active'); });
    var alvo = C.qs(tab === 'entrar' ? 'painelEntrar' : 'painelCadastrar');
    if (alvo) alvo.classList.add('active');
  }
  async function getSessionUser(){ var result = await supabaseClient.auth.getSession(); return result && result.data && result.data.session && result.data.session.user || null; }
  async function getOwnProfile(userId){
    if (!userId) return null;
    var result = await supabaseClient.from('profiles').select('*').eq('id', userId).maybeSingle();
    return result && result.data || null;
  }
  function getRedirectPage(){ return 'dashboard.html'; }
  function isForcedResetHash(){ return window.location.hash.indexOf('force-reset') >= 0; }
  function showUpdatePasswordBox(){
    var box = C.qs('updatePasswordBox');
    if (box) box.style.display = 'block';
  }
  async function redirectIfLogged(){
    var user = await getSessionUser();
    var hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.get('type') === 'recovery') {
      showUpdatePasswordBox();
      return;
    }
    if (!user) return;
    window.location.replace(getRedirectPage());
  }
  async function cadastrarUsuario(){
    limparErrosAuth();
    var username = C.qs('cadastroUsuario').value.trim();
    var senha = C.qs('cadastroSenha').value;
    var erroUsuario = C.validarUsuario(username);
    var erroSenha = C.validarSenha(senha);
    if (erroUsuario) setErro('erroCadastroUsuario', erroUsuario);
    if (erroSenha) setErro('erroCadastroSenha', erroSenha);
    if (erroUsuario || erroSenha) return;
    var btn = C.qs('btnCadastrar'); btn.disabled = true; btn.textContent = 'Aguarde...';
    var result = await supabaseClient.auth.signUp({ email: C.usuarioParaAcesso(username), password: senha, options: { data: { preferred_username: username } } });
    if (result.error) {
      var msg = String(result.error.message || '').toLowerCase();
      if (msg.indexOf('already') >= 0) {
        C.qs('loginUsuario').value = username;
        trocarAbaAuth('entrar');
        setErro('erroLoginForm', 'Usuário já cadastrado. Insira sua senha para entrar.');
        C.showToast('Usuário já existe — faça login abaixo.', 'info');
      } else {
        setErro('erroCadastroForm', result.error.message || 'Erro ao cadastrar.');
      }
      btn.disabled = false; btn.textContent = 'Cadastrar e Continuar'; return;
    }
    btn.disabled = false; btn.textContent = 'Cadastrar e Continuar';
    window.location.replace(getRedirectPage());
  }
  async function validarRestricoesPosLogin(user){
    var profile = await getOwnProfile(user && user.id);
    return { ok:true, profile:profile };
  }
  async function entrarUsuario(){
    limparErrosAuth();
    var username = C.qs('loginUsuario').value.trim();
    var senha = C.qs('loginSenha').value;
    var erroUsuario = C.validarUsuario(username);
    var erroSenha = C.validarSenha(senha);
    if (erroUsuario) setErro('erroLoginUsuario', erroUsuario);
    if (erroSenha) setErro('erroLoginSenha', erroSenha);
    if (erroUsuario || erroSenha) return;
    var btn = C.qs('btnEntrar'); btn.disabled = true; btn.textContent = 'Entrando...';
    var result = await supabaseClient.auth.signInWithPassword({ email: C.usuarioParaAcesso(username), password: senha });
    if (result.error) {
      setErro('erroLoginForm', 'Usuário ou senha incorretos.');
      btn.disabled = false; btn.textContent = 'Entrar no Painel'; return;
    }
    window.location.replace(getRedirectPage());
  }
  async function entrarComGoogle(){
    limparErrosAuth();
    var result = await supabaseClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + window.location.pathname.replace(/[^/]+$/, '') + getRedirectPage(), queryParams: { prompt: 'select_account' } } });
    if (result.error) setErro('erroLoginForm', 'Erro ao entrar com Google: ' + result.error.message);
  }
  async function enviarResetSenha(){
    limparErrosAuth();
    var email = C.normalizarEmailOuUsuario(C.qs('resetUsuarioEmail').value.trim());
    if (!email) return setErro('erroResetForm', 'Digite seu usuário ou email.');
    var result = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.href.split('#')[0] });
    if (result.error) return setErro('erroResetForm', 'Erro ao enviar reset: ' + result.error.message);
    setErro('erroResetForm', 'Link enviado. Confira seu email.', true);
    C.showToast('Link de redefinição enviado.', 'success');
  }
  async function salvarNovaSenha(){
    var senha = C.qs('novaSenha').value;
    var erroSenha = C.validarSenha(senha);
    if (erroSenha) return setErro('erroNovaSenha', erroSenha);
    var result = await supabaseClient.auth.updateUser({ password: senha });
    if (result.error) return setErro('erroSalvarSenha', 'Erro ao salvar nova senha: ' + result.error.message);
    setErro('erroSalvarSenha', 'Senha atualizada com sucesso.', true);
    C.showToast('Senha atualizada com sucesso.', 'success');
    window.location.hash = '';
    setTimeout(function(){ window.location.replace(getRedirectPage()); }, 800);
  }
  function init(){
    C.applyStoredTheme();
    C.initThemePicker();
    redirectIfLogged();
    Array.prototype.forEach.call(document.querySelectorAll('.auth-tab-btn'), function(btn){ btn.addEventListener('click', function(){ trocarAbaAuth(btn.dataset.authTab); limparErrosAuth(); }); });
    C.qs('themeToggle').addEventListener('click', C.toggleTheme);
    C.qs('btnCadastrar').addEventListener('click', cadastrarUsuario);
    C.qs('btnEntrar').addEventListener('click', entrarUsuario);
    C.qs('btnGoogleLogin').addEventListener('click', entrarComGoogle);

    /* Enter nos campos de login */
    function onEnterLogin(e){ if (e.key === 'Enter') { e.preventDefault(); entrarUsuario(); } }
    C.qs('loginUsuario').addEventListener('keydown', onEnterLogin);
    C.qs('loginSenha').addEventListener('keydown', onEnterLogin);

    /* Enter nos campos de cadastro */
    function onEnterCadastro(e){ if (e.key === 'Enter') { e.preventDefault(); cadastrarUsuario(); } }
    C.qs('cadastroUsuario').addEventListener('keydown', onEnterCadastro);
    C.qs('cadastroSenha').addEventListener('keydown', onEnterCadastro);

    /* Enter no campo de reset de senha */
    C.qs('resetUsuarioEmail').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); enviarResetSenha(); } });

    /* Enter no campo de nova senha */
    C.qs('novaSenha').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); salvarNovaSenha(); } });
    C.qs('btnMostrarReset').addEventListener('click', function(){ var box = C.qs('resetBox'); box.style.display = box.style.display === 'none' ? 'block' : 'none'; });
    C.qs('btnResetSenha').addEventListener('click', enviarResetSenha);
    C.qs('btnSalvarNovaSenha').addEventListener('click', salvarNovaSenha);
    window.addEventListener('error', function(event){ C.showFatalError(event.message || 'Erro inesperado ao iniciar a autenticação.'); });
    window.addEventListener('unhandledrejection', function(event){ C.showFatalError(event.reason && event.reason.message || 'Falha inesperada na autenticação.'); });
  }
  document.addEventListener('DOMContentLoaded', init);
})();
