(function(){
  var cfg = window.APP_CONFIG;
  function qs(id){ return document.getElementById(id); }
  function escapeHtml(value){ return String(value == null ? '' : value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
  function moeda(valor){ return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number.isFinite(valor) ? valor : 0); }
  function parseValor(texto){
    var limpo = String(texto || '').trim();
    if (!limpo) return NaN;
    var semEspaco = limpo.replace(/\s/g,'');
    var normalizado = semEspaco.indexOf(',') >= 0 ? semEspaco.replace(/\./g,'').replace(',', '.') : semEspaco;
    var valor = Number(normalizado);
    return Number.isFinite(valor) ? valor : NaN;
  }
  function normalizeText(value){ return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
  function formatarDataBR(dataIso){ if (!dataIso) return '-'; var parts = dataIso.split('-'); return parts[2] + '/' + parts[1] + '/' + parts[0]; }
  function formatarDataHora(dataIso){ if (!dataIso) return '-'; try { return new Date(dataIso).toLocaleString('pt-BR'); } catch (error) { return dataIso; } }
  function currentMonthRef(baseDate){ baseDate = baseDate || new Date(); return baseDate.getFullYear() + '-' + String(baseDate.getMonth()+1).padStart(2,'0'); }
  function monthLabelShort(isoMonth){ if (!isoMonth) return '-'; var parts = isoMonth.split('-'); var s = new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString('pt-BR', { month:'short', year:'2-digit' }); return s.charAt(0).toUpperCase() + s.slice(1); }
  function monthLabelLong(isoMonth){ if (!isoMonth) return '-'; var parts = isoMonth.split('-'); var s = new Date(Number(parts[0]), Number(parts[1]) - 1, 1).toLocaleDateString('pt-BR', { month:'long', year:'numeric' }); return s.charAt(0).toUpperCase() + s.slice(1); }
  function monthLabel(isoMonth){ return monthLabelLong(isoMonth); }
  var THEMES=['light','dark','midnight']; function getStoredTheme(){ try{ var t=localStorage.getItem(cfg.STORAGE_KEYS.theme); return THEMES.indexOf(t)>=0?t:null; }catch(e){return null;} }
  function applyStoredTheme(){
    var t = getStoredTheme();
    if (!t || t === 'light') { t = 'dark'; try { localStorage.setItem(cfg.STORAGE_KEYS.theme, 'dark'); } catch(e){} }
    document.documentElement.setAttribute('data-theme', t);
  }
  function setTheme(t){ document.documentElement.setAttribute('data-theme',t); try{localStorage.setItem(cfg.STORAGE_KEYS.theme,t);}catch(e){} updateThemePicker(); }
  function toggleTheme(){ var a=document.documentElement.getAttribute('data-theme'); setTheme(THEMES[(THEMES.indexOf(a)+1)%THEMES.length]); }
  function updateThemePicker(){ var a=document.documentElement.getAttribute('data-theme'); document.querySelectorAll('.theme-option').forEach(function(b){b.classList.toggle('active',b.dataset.theme===a);}); var btn=document.getElementById('themeToggle'); if(btn){btn.textContent=a==='midnight'?'🌑':(a==='dark'?'◑':'◐'); btn.title='Tema: '+(a==='midnight'?'Midnight':(a==='dark'?'Escuro':'Claro'));} }
  function initThemePicker(){
    var btn=document.getElementById('themeToggle'); if(!btn) return;
    var picker=document.createElement('div'); picker.className='theme-picker'; picker.id='themePicker';
    [['light','Claro','swatch-light'],['dark','Escuro','swatch-dark'],['midnight','Midnight','swatch-midnight']].forEach(function(o){
      var b=document.createElement('button'); b.className='theme-option'; b.dataset.theme=o[0];
      b.innerHTML='<span class="theme-swatch '+o[2]+'"></span>'+o[1];
      b.addEventListener('click',function(e){e.stopPropagation();setTheme(o[0]);picker.classList.remove('open');});
      picker.appendChild(b);
    });
    document.body.appendChild(picker);
    function pos(){ var r=btn.getBoundingClientRect(),w=168,l=Math.max(4,Math.min(r.right-w,window.innerWidth-w-4)); picker.style.top=(r.bottom+8)+'px'; picker.style.left=l+'px'; }
    btn.addEventListener('click',function(e){ e.stopPropagation(); var o=picker.classList.contains('open'); picker.classList.remove('open'); if(!o){pos();picker.classList.add('open');updateThemePicker();} });
    document.addEventListener('click',function(){picker.classList.remove('open');});
    window.addEventListener('scroll',function(){picker.classList.remove('open');},{passive:true});
    window.addEventListener('resize',function(){picker.classList.remove('open');},{passive:true});
    updateThemePicker();
  }
  function getStoredPlanilhaMes(){ try { var valor = localStorage.getItem(cfg.STORAGE_KEYS.planilhaMes); return /^\d{4}-\d{2}$/.test(valor || '') ? valor : currentMonthRef(); } catch (error) { return currentMonthRef(); } }
  function setStoredPlanilhaMes(valor){ try { localStorage.setItem(cfg.STORAGE_KEYS.planilhaMes, valor || currentMonthRef()); } catch (error) {} }
  function usuarioParaAcesso(username){ return String(username || '').toLowerCase() + '@guardanapon.app'; }
  function normalizarEmailOuUsuario(valor){ var texto = String(valor || '').trim(); return !texto ? '' : (texto.indexOf('@') >= 0 ? texto.toLowerCase() : usuarioParaAcesso(texto)); }
  function validarUsuario(username){ var valor = String(username || '').trim(); if (!valor) return 'Informe o nome de usuário.'; if (valor.length < 3) return 'O usuário precisa ter pelo menos 3 caracteres.'; if (!/^[a-zA-Z0-9_.-]+$/.test(valor)) return 'Use apenas letras, números, ponto, traço ou underline.'; return ''; }
  function validarSenha(senha){ if (!senha) return 'Informe a senha.'; if (senha.length < 6) return 'A senha precisa ter pelo menos 6 caracteres.'; return ''; }
  function showToast(message, type, detail){
    type = type || 'info';
    var wrap = qs('toastWrap');
    if (!wrap) return;
    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.innerHTML = escapeHtml(message) + (detail ? '<small>' + escapeHtml(detail) + '</small>' : '');
    wrap.appendChild(toast);
    setTimeout(function(){ if (toast.parentNode) toast.parentNode.removeChild(toast); }, 3200);
  }
  function setLoading(visible, title, sub){
    var overlay = qs('loadingOverlay');
    if (!overlay) return;
    qs('loadingTitle').textContent = title || 'Carregando';
    qs('loadingSub').textContent = sub || 'Só um instante.';
    overlay.style.display = visible ? 'flex' : 'none';
  }
  function showFatalError(message){
    var box = qs('fatalErrorBox');
    if (!box) return alert(message);
    box.innerHTML = '<strong>Não foi possível carregar o painel.</strong><div>' + escapeHtml(message) + '</div>';
    box.style.display = 'block';
    setLoading(false);
  }
  window.AppCommon = { qs:qs, moeda:moeda, parseValor:parseValor, normalizeText:normalizeText, formatarDataBR:formatarDataBR, formatarDataHora:formatarDataHora, currentMonthRef:currentMonthRef, monthLabel:monthLabel, monthLabelLong:monthLabelLong, monthLabelShort:monthLabelShort, applyStoredTheme:applyStoredTheme, toggleTheme:toggleTheme, setTheme:setTheme, initThemePicker:initThemePicker, getStoredPlanilhaMes:getStoredPlanilhaMes, setStoredPlanilhaMes:setStoredPlanilhaMes, usuarioParaAcesso:usuarioParaAcesso, normalizarEmailOuUsuario:normalizarEmailOuUsuario, validarUsuario:validarUsuario, validarSenha:validarSenha, showToast:showToast, setLoading:setLoading, showFatalError:showFatalError, escapeHtml:escapeHtml };
})();
