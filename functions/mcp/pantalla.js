/**
 * Pantalla de login y consentimiento del conector (la abre claude.ai al conectar "Rubik").
 * El dueño entra con su cuenta de la app (Firebase Auth, email y contraseña, igual que login.html); la contraseña va
 * directo a Firebase desde el navegador y a la Function solo llega el ID token, que se verifica con firebase-admin.
 */
const FIREBASE = {
    apiKey: "AIzaSyDXYlofy31cDP14xVAVxWo_7TqXdSgsIjA",   // clave pública web (la misma de login.html)
    authDomain: "rubik-bolivia.firebaseapp.com",
    projectId: "rubik-bolivia",
};

const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[c]));

const ESTILO = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;color:#1d1f24;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px}
.c{background:#fff;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.08);padding:24px;max-width:380px;width:100%}
h1{font-size:20px;margin:0 0 6px}p{font-size:14px;color:#555;line-height:1.45;margin:8px 0}
label{display:block;font-size:13px;font-weight:600;margin-top:12px}input{width:100%;padding:12px;border:1.5px solid #d7dae0;border-radius:10px;font-size:16px;margin-top:4px}
button{width:100%;padding:13px;border:0;border-radius:10px;font-size:16px;font-weight:700;margin-top:14px;cursor:pointer}
.p{background:#111;color:#fff}.s{background:#eceef2;color:#222}.e{color:#b00020;font-size:13px;min-height:18px;margin-top:8px}.chip{display:inline-block;background:#eef;border-radius:8px;padding:2px 8px;font-weight:600}
@media (prefers-color-scheme:dark){body{background:#15171b;color:#eee}.c{background:#1f2228}p{color:#bbb}input{background:#15171b;color:#eee;border-color:#3a3e46}.s{background:#2b2f37;color:#eee}.chip{background:#2b2f50}}`;

function pagina(titulo, cuerpo, nonce) {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(titulo)}</title><style nonce="${nonce}">${ESTILO}</style></head><body><div class="c">${cuerpo}</div></body></html>`;
}

function login({ solicitud, cliente, redirectHost, nonce }) {
    const cuerpo = `<h1>Conectar Claude con Rubik</h1>
<p><span class="chip">${esc(cliente)}</span> pide acceso a tu app de Rubik (clientes, proyectos, presupuestos y base) para cotizar desde Claude. Al permitir, se vuelve a <b>${esc(redirectHost)}</b>.</p>
<div id="entrar"><label>Email<input id="email" type="email" autocomplete="username" inputmode="email"></label>
<label>Contraseña<input id="clave" type="password" autocomplete="current-password"></label>
<button class="p" id="btn-entrar">Entrar y permitir</button></div>
<div id="ya" hidden><p>Entraste como <b id="quien"></b>.</p><button class="p" id="btn-permitir">Permitir acceso</button><button class="s" id="btn-otra">Usar otra cuenta</button></div>
<button class="s" id="btn-negar">No permitir</button><div class="e" id="err"></div>
<p style="font-size:12px">Solo pueden entrar las cuentas autorizadas de Rubik. Podés cortar el acceso cuando quieras (ver la guía).</p>
<script nonce="${nonce}" src="https://www.gstatic.com/firebasejs/9.1.3/firebase-app-compat.js"></script>
<script nonce="${nonce}" src="https://www.gstatic.com/firebasejs/9.1.3/firebase-auth-compat.js"></script>
<script nonce="${nonce}">
(function(){
var SOL=${JSON.stringify(String(solicitud))};
firebase.initializeApp(${JSON.stringify(FIREBASE)});
var auth=firebase.auth(),$=function(i){return document.getElementById(i)},ocupado=false;
function error(t){$('err').textContent=t||'';}
function enviar(decision,idToken){
  if(ocupado)return;ocupado=true;error('');
  fetch('/oauth/authorize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({solicitud:SOL,decision:decision,id_token:idToken||''})})
  .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
  .then(function(x){if(x.j&&x.j.redirect){location.replace(x.j.redirect);return;}ocupado=false;error((x.j&&x.j.error_description)||'No se pudo completar.');})
  .catch(function(){ocupado=false;error('Sin conexión. Probá de nuevo.');});
}
function permitir(){var u=auth.currentUser;if(!u)return;u.getIdToken(true).then(function(t){enviar('permitir',t);}).catch(function(){error('Volvé a entrar.');});}
auth.onAuthStateChanged(function(u){ if(u&&!u.isAnonymous){$('quien').textContent=u.email||u.uid;$('ya').hidden=false;$('entrar').hidden=true;} else {$('ya').hidden=true;$('entrar').hidden=false;} });
$('btn-entrar').onclick=function(){var e=$('email').value.trim(),c=$('clave').value;if(!e||!c)return error('Escribí tu email y contraseña.');error('');
  auth.signInWithEmailAndPassword(e,c).then(permitir).catch(function(){error('Email o contraseña incorrectos.');});};
$('clave').addEventListener('keydown',function(ev){if(ev.key==='Enter')$('btn-entrar').click();});
$('btn-permitir').onclick=permitir;
$('btn-otra').onclick=function(){auth.signOut();};
$('btn-negar').onclick=function(){enviar('negar');};
})();
</script>`;
    return pagina("Conectar Claude con Rubik", cuerpo, nonce);
}

function error({ titulo, texto, nonce }) {
    return pagina(titulo || "No se pudo conectar", `<h1>${esc(titulo || "No se pudo conectar")}</h1><p>${esc(texto)}</p><p>Volvé a Claude y probá conectar de nuevo.</p>`, nonce);
}

function ayuda(nonce) {
    return pagina("Conector Rubik", `<h1>Conector Rubik para Claude</h1><p>Esta dirección es el conector MCP de la app de Rubik Bolivia. Se agrega en Claude → Configuración → Conectores → Agregar conector personalizado, con la URL <b>https://rubikbolivia.com/mcp</b>. Solo pueden entrar las cuentas autorizadas.</p>`, nonce);
}

/** CSP: solo los scripts de Firebase de gstatic y los propios (nonce); conexión a Firebase Auth y a esta misma web. */
function csp(nonce) {
    return [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' https://www.gstatic.com`,
        `style-src 'nonce-${nonce}'`,
        "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com",
        "frame-src https://rubik-bolivia.firebaseapp.com",
        "img-src 'self' data:",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
    ].join("; ");
}

module.exports = { login, error, ayuda, csp };
