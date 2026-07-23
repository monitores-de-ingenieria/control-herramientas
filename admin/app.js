import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app-check.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  where,
  serverTimestamp,
  addDoc,
  limit,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAqNViWNYRTI2uQaMlj6QMg7TGiiUZZVZQ",
  authDomain: "taller-maquinas-herramientas.firebaseapp.com",
  projectId: "taller-maquinas-herramientas",
  storageBucket: "taller-maquinas-herramientas.firebasestorage.app",
  messagingSenderId: "79762926711",
  appId: "1:79762926711:web:83a33df56183f56d6a2a72"
};

const app = initializeApp(firebaseConfig);

const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider("6LfqPUgtAAAAAGotRzMTvetHw4a1pKbj-D5lftbZ"),
  isTokenAutoRefreshEnabled: true
});

const auth = getAuth(app);
const db = getFirestore(app);

// App secundaria: permite crear usuarios nuevos sin cerrar la sesión del admin actual
const appSecundaria = initializeApp(firebaseConfig, "secundaria");
// App Check está ligado a la instancia de Firebase, no es global — sin esto,
// las peticiones de creación de usuario (que pasan por appSecundaria) llegan
// sin token de App Check y Google las rechaza con 401 Unauthorized antes de
// siquiera mirar el email/contraseña.
initializeAppCheck(appSecundaria, {
  provider: new ReCaptchaEnterpriseProvider("6LfqPUgtAAAAAGotRzMTvetHw4a1pKbj-D5lftbZ"),
  isTokenAutoRefreshEnabled: true
});
const authSecundaria = getAuth(appSecundaria);

// ── UTILIDADES ──
const colores = ["#22c55e","#3b82f6","#f59e0b","#8b5cf6","#ef4444","#14b8a6","#f97316"];
function colorEstudiante(nombre) {
  let h = 0; for (const c of nombre) h = (h * 31 + c.charCodeAt(0)) % colores.length;
  return colores[h];
}

function iniciales(nombre, apellido) {
  return ((nombre||"")[0]||"") + ((apellido||"")[0]||"");
}

// Escapa texto libre (nombre, apellido, teléfono, ciclo, etc.) antes de
// insertarlo en innerHTML. Estos campos los llena cualquier persona sin
// necesidad de iniciar sesión (formulario público de solicitud), así que
// nunca deben tratarse como HTML confiable — previene XSS almacenado.
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// Para valores insertados dentro de un onclick="fn('VALOR')": escapeHtml()
// solo protege el atributo HTML (comillas dobles), pero NO evita que un '
// dentro de VALOR rompa el string de JS de comillas simples — el navegador
// decodifica entidades HTML antes de ejecutar el JS del atributo, así que
// "&#39;" vuelve a ser ' justo antes de correr el código. Hace falta escapar
// para AMBAS capas: primero el string JS (\\ y '), luego el atributo HTML (").
function escapeAttr(str) {
  return String(str ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatFecha(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("es-DO", { day:"2-digit", month:"2-digit", year:"numeric" }) +
    " " + d.toLocaleTimeString("es-DO", { hour:"2-digit", minute:"2-digit" });
}

function mostrarToast(msg, tipo = "verde") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = tipo;
  t.style.display = "block";
  setTimeout(() => t.style.display = "none", 3000);
}

// ── LOGIN ──
let _lastLoginPass = "";

document.getElementById("btn-login").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-pass").value;
  const err = document.getElementById("login-error");
  err.style.display = "none";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
    _lastLoginPass = pass;
  } catch (e) {
    err.style.display = "block";
  }
});

document.getElementById("login-pass").addEventListener("keydown", e => {
  if (e.key === "Enter") document.getElementById("btn-login").click();
});

document.getElementById("btn-cerrar-sesion").addEventListener("click", () => signOut(auth));
window._signOut = () => signOut(auth);

// ── AUTH STATE ──
// Mostrar login si Firebase no responde en 5 segundos
const _authTimeout = setTimeout(() => {
  document.getElementById("pantalla-carga").style.display = "none";
  document.getElementById("pantalla-login").classList.add("visible");
}, 5000);

onAuthStateChanged(auth, async user => {
  clearTimeout(_authTimeout);
  const loginEl = document.getElementById("pantalla-login");
  const appEl = document.getElementById("app");
  const cargaEl = document.getElementById("pantalla-carga");
  if (user) {
    loginEl.classList.remove("visible");
    // Ojo: NO se muestra el panel todavía aquí. Antes se mostraba de una
    // vez (con todo el sidebar visible) y las secciones restringidas se
    // ocultaban después de que aplicarRolUsuario() terminara de leer el
    // rol — eso dejaba una ventana donde un "encargado" veía por un
    // instante secciones que no le corresponden (y si le daba clic justo
    // ahí, no pasaba nada, porque el permiso ya lo bloqueaba por dentro
    // aunque el botón siguiera visible). Se mantiene la pantalla de carga
    // puesta hasta que ya sabemos qué secciones puede ver.
    const letra = (user.email || "A")[0].toUpperCase();
    document.getElementById("admin-avatar").textContent = letra;
    // Reset defensivo: algunos navegadores restauran el valor de los <select>
    // al recargar la página (autocompletado de formulario), lo que dejaba
    // el filtro de "Incidencia" activado al volver a entrar sin haberlo
    // elegido. Forzamos que siempre arranque limpio.
    const filtroEstadoEl = document.getElementById("filtro-estado");
    if (filtroEstadoEl) filtroEstadoEl.value = "";
    document.getElementById("filtro-buscar")  && (document.getElementById("filtro-buscar").value  = "");
    document.getElementById("filtro-profesor") && (document.getElementById("filtro-profesor").value = "");
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("activo"));
    document.querySelector(".tab-btn[data-tab-estado='']")?.classList.add("activo");
    ocultarPanelIncidenciasProf();
    cargarDashboard();
    cargarSolicitudes();
    cargarPrestamosProf();
    cargarPrestamosExternos();
    cargarHerramientasCfg();
    cargarProfesoresCfg();
    cargarMateriasCfg();
    cargarLaboratoriosCfg();
    cargarCiclosCfg();
    cargarUsuariosCfg();
    cargarAuditoria();
    await aplicarRolUsuario(user);
    cargaEl.style.display = "none";
    appEl.classList.add("visible");
  } else {
    cargaEl.style.display = "none";
    loginEl.classList.add("visible");
    appEl.classList.remove("visible");
    document.getElementById("login-email").value = "";
    document.getElementById("login-pass").value = "";
  }
});

// ── ROLES Y PERMISOS ──
const ADMIN_RAIZ = ["utesamonitores@outlook.com"];
let rolActual = "administrador";
let usuarioActualNombre = "Administrador";

// Registra una entrada en el historial de auditoría (colección "auditoria").
// tipo: herramienta | profesor | usuario | prestamo | stock
// accion: crear | editar | eliminar | entrada | entregar | retornar
async function registrarAuditoria(tipo, accion, descripcion) {
  try {
    await addDoc(collection(db, "auditoria"), {
      tipo, accion, descripcion,
      usuario: usuarioActualNombre || "Desconocido",
      creadoEn: serverTimestamp()
    });
  } catch(e) { console.error("Error registrando auditoría:", e); }
}

let _auditoriaLista = [];
const AUDIT_ICONOS = { herramienta:"🔧", profesor:"👤", materia:"📚", usuario:"🔐", prestamo:"📋", stock:"📦" };
const AUDIT_ACCION_COLOR = { crear:"var(--verde)", editar:"var(--azul)", eliminar:"var(--rojo)", entrada:"var(--amarillo)", entregar:"var(--verde)", retornar:"var(--azul)" };

async function cargarAuditoria() {
  const wrap = document.getElementById("audit-wrap");
  try {
    onSnapshot(
      query(collection(db, "auditoria"), orderBy("creadoEn", "desc")),
      snap => {
        _auditoriaLista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        renderAuditoria();
      },
      err => {
        // Antes esto se quedaba pegado en "Cargando auditoría..." para
        // siempre si Firestore rechazaba la lectura (permisos de la colección
        // "auditoria", índice faltante, etc.) porque onSnapshot no tenía
        // callback de error. Ahora sí se avisa qué pasó.
        console.error("Error cargando auditoría:", err);
        if (wrap) wrap.innerHTML = '<div class="vacio" style="padding:20px"><div class="vacio-icono">⚠️</div><p>No se pudo cargar la auditoría (' + (err.code || err.message || "error desconocido") + '). Revisa las reglas de Firestore para la colección "auditoria".</p></div>';
      }
    );
  } catch(e) {
    console.error("Error cargando auditoría:", e);
    if (wrap) wrap.innerHTML = '<div class="vacio" style="padding:20px"><div class="vacio-icono">⚠️</div><p>No se pudo cargar la auditoría. Verifica tu conexión.</p></div>';
  }
}

function renderAuditoria() {
  const wrap = document.getElementById("audit-wrap");
  if (!wrap) return;
  const tipoF = document.getElementById("audit-filtro-tipo")?.value || "";
  const buscar = (document.getElementById("audit-buscar")?.value || "").toLowerCase();
  let lista = _auditoriaLista;
  if (tipoF) lista = lista.filter(a => a.tipo === tipoF);
  if (buscar) lista = lista.filter(a => (a.descripcion||"").toLowerCase().includes(buscar) || (a.usuario||"").toLowerCase().includes(buscar));

  if (!lista.length) {
    wrap.innerHTML = '<div class="vacio" style="padding:20px"><div class="vacio-icono">📜</div><p>No hay movimientos registrados todavía.</p></div>';
    return;
  }

  let html = "";
  let diaAnterior = null;
  lista.forEach((a, i) => {
    const fecha = a.creadoEn?.toDate ? a.creadoEn.toDate() : new Date(a.creadoEn || 0);
    const diaKey = fecha.toLocaleDateString("es-DO", { weekday:"long", day:"2-digit", month:"long", year:"numeric" });
    if (diaKey !== diaAnterior) {
      if (diaAnterior !== null) html += `</div>`; // cierra la línea de tiempo del día anterior
      html += `<div style="display:flex;align-items:center;gap:10px;margin:${diaAnterior===null?"0":"20px"} 0 10px">
        <span style="font-size:11px;font-weight:800;color:var(--texto-dim);text-transform:uppercase;letter-spacing:.04em;white-space:nowrap">${diaKey}</span>
        <span style="flex:1;height:1px;background:var(--borde)"></span>
      </div>`;
      html += `<div class="audit-linea">`;
      diaAnterior = diaKey;
    }
    const color = AUDIT_ACCION_COLOR[a.accion] || "var(--texto-dim)";
    const hora = fecha.toLocaleTimeString("es-DO", { hour:"2-digit", minute:"2-digit" });
    const esUltimoDelDia = (i === lista.length - 1) || (() => {
      const sigFecha = lista[i+1].creadoEn?.toDate ? lista[i+1].creadoEn.toDate() : new Date(lista[i+1].creadoEn || 0);
      return sigFecha.toLocaleDateString("es-DO", { weekday:"long", day:"2-digit", month:"long", year:"numeric" }) !== diaKey;
    })();
    html += `
      <div class="audit-item" style="${esUltimoDelDia ? "--audit-linea-alto:0;" : ""}">
        <span class="audit-punto" style="background:${color}22;color:${color}">${AUDIT_ICONOS[a.tipo]||"📌"}</span>
        <div class="audit-contenido">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline">
            <span style="font-size:12.5px;color:var(--texto)">${escapeHtml(a.descripcion) || "—"}</span>
            <span style="font-size:10.5px;color:var(--texto-dim);white-space:nowrap;flex-shrink:0">${hora}</span>
          </div>
          <div style="font-size:10px;color:var(--texto-dim);margin-top:2px">👤 ${escapeHtml(a.usuario) || "Desconocido"}</div>
        </div>
      </div>`;
  });
  html += `</div>`; // cierra la línea de tiempo del último día
  wrap.innerHTML = html;
}

document.getElementById("audit-filtro-tipo")?.addEventListener("change", renderAuditoria);
document.getElementById("audit-buscar")?.addEventListener("input", renderAuditoria);

function _auditoriaFilasExport() {
  const tipoF = document.getElementById("audit-filtro-tipo")?.value || "";
  const buscar = (document.getElementById("audit-buscar")?.value || "").toLowerCase();
  let lista = _auditoriaLista;
  if (tipoF) lista = lista.filter(a => a.tipo === tipoF);
  if (buscar) lista = lista.filter(a => (a.descripcion||"").toLowerCase().includes(buscar) || (a.usuario||"").toLowerCase().includes(buscar));
  return lista.map(a => {
    const fecha = a.creadoEn?.toDate ? a.creadoEn.toDate() : new Date(a.creadoEn || 0);
    return {
      Fecha: fecha.toLocaleDateString("es-DO"),
      Hora: fecha.toLocaleTimeString("es-DO", { hour:"2-digit", minute:"2-digit" }),
      Tipo: a.tipo || "",
      Acción: a.accion || "",
      Descripción: a.descripcion || "",
      Usuario: a.usuario || ""
    };
  });
}

window.exportarAuditoriaExcel = function() {
  const filas = _auditoriaFilasExport();
  if (!filas.length) { mostrarToast("No hay datos para exportar", "rojo"); return; }
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Auditoría");
  XLSX.writeFile(wb, `auditoria_${new Date().toISOString().slice(0,10)}.xlsx`);
};

window.exportarAuditoriaPDF = function() {
  const filas = _auditoriaFilasExport();
  if (!filas.length) { mostrarToast("No hay datos para exportar", "rojo"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text("Historial de Auditoría — Taller Mecánica Industrial", 14, 14);
  doc.setFontSize(9);
  doc.text(`Generado: ${new Date().toLocaleString("es-DO")}`, 14, 20);
  doc.autoTable({
    startY: 26,
    head: [["Fecha","Hora","Tipo","Acción","Descripción","Usuario"]],
    body: filas.map(f => [f.Fecha, f.Hora, f.Tipo, f.Acción, f.Descripción, f.Usuario]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [63,185,80] }
  });
  doc.save(`auditoria_${new Date().toISOString().slice(0,10)}.pdf`);
};
let seccionesPermitidas = null;

async function aplicarRolUsuario(user) {
  try {
    const snap = await getDoc(doc(db, "usuarios", user.uid));
    if (!snap.exists()) {
      const esRaiz = ADMIN_RAIZ.includes((user.email || "").toLowerCase());
      if (esRaiz) {
        rolActual = "administrador";
        seccionesPermitidas = null;
        mostrarSoloSecciones(null);
        document.getElementById("topbar-admin-nombre").textContent = "Administrador";
        document.getElementById("topbar-admin-rol").textContent = "Administrador";
      } else {
        mostrarToast("Sin acceso: no se encontró tu registro (uid: " + user.uid + ")", "rojo");
        console.warn("UID sin registro en Firestore:", user.uid, user.email);
        await signOut(auth);
      }
      return;
    }
    const datos = snap.data();

    if (datos.debeCambiarContrasena && datos.rol === "encargado") {
      document.getElementById("modal-cambiar-pass").classList.add("abierto");
      document.getElementById("btn-confirmar-nueva-pass").onclick = async () => {
        const nueva    = document.getElementById("nueva-pass-input").value;
        const confirma = document.getElementById("nueva-pass-confirm").value;
        const errEl    = document.getElementById("nueva-pass-error");
        errEl.style.display = "none";

        if (nueva.length < 8) {
          errEl.textContent = "La contraseña debe tener al menos 8 caracteres.";
          errEl.style.display = "block"; return;
        }
        if (nueva !== confirma) {
          errEl.textContent = "Las contraseñas no coinciden.";
          errEl.style.display = "block"; return;
        }

        try {
          const passTemp = document.getElementById("pass-temporal-input")?.value || _lastLoginPass;
          const credencial = EmailAuthProvider.credential(user.email, passTemp);
          await reauthenticateWithCredential(user, credencial);
          await updatePassword(user, nueva);
          await updateDoc(doc(db, "usuarios", user.uid), { debeCambiarContrasena: false });
          _lastLoginPass = nueva;
          document.getElementById("modal-cambiar-pass").classList.remove("abierto");
          mostrarToast("✅ Contraseña guardada correctamente");
        } catch(err) {
          console.error(err);
          const msg = err.code === "auth/wrong-password" || err.code === "auth/invalid-credential"
            ? "Error de autenticación. Cierra sesión y vuelve a entrar."
            : "Error al cambiar la contraseña. Intenta de nuevo.";
          errEl.textContent = msg;
          errEl.style.display = "block";
        }
      };
    }

    rolActual = datos.rol || "administrador";
    usuarioActualNombre = datos.nombre || user.email;
    seccionesPermitidas = rolActual === "encargado" ? (datos.secciones || []) : null;
    mostrarSoloSecciones(seccionesPermitidas);
    document.getElementById("topbar-admin-nombre").textContent = datos.nombre || user.email;
    document.getElementById("topbar-admin-rol").textContent = rolActual === "administrador" ? "Administrador" : "Encargado";
  } catch(e) {
    console.error("Error al aplicar rol:", e.code, e.message);
    mostrarToast("Error al cargar tu perfil: " + (e.code || e.message), "rojo");
    if (ADMIN_RAIZ.includes((user.email || "").toLowerCase())) {
      rolActual = "administrador";
      usuarioActualNombre = user.email;
      seccionesPermitidas = null;
      mostrarSoloSecciones(null);
      document.getElementById("topbar-admin-nombre").textContent = "Administrador";
      document.getElementById("topbar-admin-rol").textContent = "Administrador";
      return;
    }
    mostrarToast("No se pudo verificar tu acceso.", "rojo");
    await signOut(auth);
  }
}

function mostrarSoloSecciones(secciones) {
  document.querySelectorAll(".nav-item[data-vista]").forEach(item => {
    const vista = item.dataset.vista;
    // Compatibilidad: algunos encargados pueden tener guardado el permiso
    // antiguo "inv-herramientas" (antes de fusionar las dos vistas de
    // Herramientas en una sola bajo "herramientas-cfg"). Lo tratamos como
    // equivalente para no quitarles acceso sin querer.
    const equivalentes = vista === "herramientas-cfg" ? [vista, "inv-herramientas"] : [vista];
    const permitido = !secciones || equivalentes.some(v => secciones.includes(v));
    item.style.display = permitido ? "" : "none";
  });
  const navInc = document.getElementById("nav-incidencias");
  if (navInc) navInc.style.display = (!secciones || secciones.includes("incidencias")) ? "" : "none";
  const navUsr = document.getElementById("nav-usuarios");
  if (navUsr) navUsr.style.display = secciones ? "none" : "";

  const primera = !secciones
    ? "solicitudes"
    : secciones.includes("solicitudes") ? "solicitudes" : (secciones[0] || "dashboard");
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("activo"));
  document.querySelectorAll(`.nav-item[data-vista="${primera}"]`).forEach(n => n.classList.add("activo"));
  document.querySelectorAll(".vista").forEach(v => v.classList.remove("activa"));
  document.getElementById(`vista-${primera}`)?.classList.add("activa");
}

// ── VER INCIDENCIAS (con columna de estado y badge) ──
window.verIncidencias = function() {
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("activo"));
  document.querySelectorAll(`.nav-item[data-vista="solicitudes"]`).forEach(n => n.classList.add("activo"));
  document.querySelectorAll(".vista").forEach(v => v.classList.remove("activa"));
  document.getElementById("vista-solicitudes")?.classList.add("activa");
  setTimeout(() => {
    const filtroEstado = document.getElementById("filtro-estado");
    if (filtroEstado) {
      filtroEstado.value = "incidencia";
      filtroEstado.dispatchEvent(new Event("change"));
    }
  }, 100);
  document.getElementById("titulo-incidencias-est")?.style.setProperty("display", "block");
  const panel = document.getElementById("panel-incidencias-prof");
  if (panel) {
    panel.style.display = "block";
    const wrap = document.getElementById("tabla-incidencias-prof-wrap");
    const lista = (todosPrestamosProfTodos || []).filter(p => p.tieneIncidencias);
    if (!lista.length) {
      wrap.innerHTML = '<div class="vacio" style="padding:20px;text-align:center;color:var(--texto-dim)">📭 No hay préstamos a profesores con incidencias.</div>';
    } else {
      wrap.innerHTML = `
        <table>
          <thead>
            <tr>
              <th>Profesor</th>
              <th>Laboratorio</th>
              <th>Herramientas</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${lista.map(p => {
              const fecha = p.creadoEn?.toDate ? p.creadoEn.toDate().toLocaleString("es-DO") : "—";
              const herramientasTexto = (p.herramientas || []).map(h => `${escapeHtml(h.nombre)} ×${h.cantidad}`).join(", ") || "—";
              const badgeEstado = p.estado === "activo"
                ? '<span class="badge badge-entregada">Activo</span>'
                : `<span class="badge badge-retornada">Retornado</span>${p.tieneIncidencias ? ' <span class="badge badge-cancelada" title="Tiene incidencias">⚠️</span>' : ''}`;
              return `<tr style="cursor:pointer" onclick="verDetalleIncidenciaProf('${p.id}')">
                <td>${escapeHtml(p.profesor) || "—"}</td>
                <td style="font-size:13px">${escapeHtml(p.laboratorio) || "—"}</td>
                <td style="font-size:12px;color:var(--texto-dim);max-width:200px">${herramientasTexto}</td>
                <td style="font-size:12px;color:var(--texto-dim)">${fecha}</td>
                <td>${badgeEstado}</td>
                <td>
                  <div style="display:flex;gap:6px">
                    <button class="btn btn-outline" onclick="event.stopPropagation();verDetalleIncidenciaProf('${p.id}')">👁 Ver</button>
                    ${p.estado !== "activo" ? `<span class="btn btn-verde" style="cursor:default;justify-content:center">👍 Retornada</span>` : ""}
                  </div>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>`;
    }
  }
};

function ocultarPanelIncidenciasProf() {
  const panel = document.getElementById("panel-incidencias-prof");
  if (panel) panel.style.display = "none";
  const titulo = document.getElementById("titulo-incidencias-est");
  if (titulo) titulo.style.display = "none";
}

// ── TOGGLE SIDEBAR ──
const shell = document.querySelector(".shell");
document.getElementById("btn-toggle-sidebar").addEventListener("click", () => {
  shell.classList.toggle("sidebar-colapsado");
});

document.getElementById("nav-incidencias").addEventListener("click", verIncidencias);

// ── KPI CARDS navegables ──
function navegarVista(vista) {
  if (seccionesPermitidas && !seccionesPermitidas.includes(vista)) return;
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("activo"));
  document.querySelectorAll(`.nav-item[data-vista="${vista}"]`).forEach(n => n.classList.add("activo"));
  document.querySelectorAll(".vista").forEach(v => v.classList.remove("activa"));
  document.getElementById(`vista-${vista}`)?.classList.add("activa");
  ocultarPanelIncidenciasProf();
}

document.querySelectorAll(".kpi-card[data-vista], #dash-kpis .her-stat-pill[data-vista]").forEach(card => {
  card.addEventListener("click", () => {
    navegarVista(card.dataset.vista);
    const estado = card.dataset.estado;
    if (estado !== undefined) {
      setTimeout(() => {
        const tab = document.querySelector(`.tab-btn[data-tab-estado="${estado}"]`);
        if (tab) tab.click();
      }, 50);
    }
  });
});

// ── TABS SOLICITUDES ──
document.querySelectorAll(".tab-btn[data-tab-estado]").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(t => t.classList.remove("activo"));
    tab.classList.add("activo");
    const estado = tab.dataset.tabEstado;
    const sel = document.getElementById("filtro-estado");
    if (sel) { sel.value = estado; sel.dispatchEvent(new Event("change")); }
  });
});

function actualizarTabs() {
  const tots = todasSolicitudes.filter(s => esMismodia(s.creadoEn));
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set("tab-todos", tots.length);
  set("tab-pend",  tots.filter(s => s.estado === "pendiente").length);
  set("tab-ent",   tots.filter(s => s.estado === "entregada").length);
  set("tab-ret",   tots.filter(s => s.estado === "retornada").length);
  set("tab-can",   tots.filter(s => s.estado === "cancelada").length);
  const entregadasHoy = tots.filter(s => s.estado === "entregada");
  let totalHerr = 0, totalGast = 0;
  entregadasHoy.forEach(s => (s.herramientasEntregadas || s.herramientas || []).forEach(h => {
    if (typeof esMaterialGastable === "function" && esMaterialGastable(h.nombre)) totalGast += (h.cantidad || 0);
    else totalHerr += (h.cantidad || 0);
  }));
  set("tab-total-herramientas-hoy", totalHerr + totalGast);
}

// ── NAVEGACIÓN ──
document.querySelectorAll("[data-vista]").forEach(el => {
  el.addEventListener("click", () => {
    const vista = el.dataset.vista;
    if (seccionesPermitidas && !seccionesPermitidas.includes(vista)) return;
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("activo"));
    document.querySelectorAll(`.nav-item[data-vista="${vista}"]`).forEach(n => n.classList.add("activo"));
    document.querySelectorAll(".vista").forEach(v => v.classList.remove("activa"));
    document.getElementById(`vista-${vista}`)?.classList.add("activa");
    ocultarPanelIncidenciasProf();
    // Al entrar a Solicitudes desde el menú lateral (no desde un KPI/atajo con
    // filtro específico), siempre arranca limpio — evita que quede "pegado"
    // el filtro de incidencias u otro estado de una visita anterior.
    if (vista === "solicitudes" && el.classList.contains("nav-item")) {
      const filtroEstado = document.getElementById("filtro-estado");
      if (filtroEstado) filtroEstado.value = "";
      document.getElementById("filtro-buscar")  && (document.getElementById("filtro-buscar").value  = "");
      document.getElementById("filtro-profesor") && (document.getElementById("filtro-profesor").value = "");
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("activo"));
      document.querySelector(".tab-btn[data-tab-estado='']")?.classList.add("activo");
      actualizarFiltrosUI();
      paginaActual = 1;
      renderTabla();
    }
  });
});

// ── DASHBOARD ──
function actualizarReloj() {
  const ahora = new Date();
  const fecha = ahora.toLocaleDateString("es-DO", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
  const hora  = ahora.toLocaleTimeString("es-DO", { hour:"2-digit", minute:"2-digit" });
  const fechaEl = document.getElementById("dash-fecha-txt");
  const horaEl  = document.getElementById("dash-hora-txt");
  if (fechaEl) fechaEl.textContent = fecha.charAt(0).toUpperCase() + fecha.slice(1);
  if (horaEl)  horaEl.textContent  = hora;
}
actualizarReloj();
setInterval(actualizarReloj, 30000);

// ── GRÁFICOS DASHBOARD ──
function barraH(valor, max, color) {
  const pct = max > 0 ? Math.round((valor / max) * 100) : 0;
  return `<div style="flex:1;background:var(--borde);border-radius:4px;height:8px;overflow:hidden">
    <div style="width:${pct}%;height:100%;background:${color};border-radius:4px;transition:width .5s ease"></div>
  </div>`;
}

function renderGraficoBarras(contenedorId, datos, color) {
  const el = document.getElementById(contenedorId);
  if (!el) return;
  if (!datos.length) { el.innerHTML = '<div class="vacio" style="padding:20px"><p>Sin datos aún.</p></div>'; return; }
  const max = datos[0].valor;
  el.innerHTML = datos.slice(0, 8).map(d => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:9px;cursor:pointer" onclick="dashAbrirHerramienta('${escapeAttr(d.etiqueta)}')">
      <div style="width:120px;font-size:11px;color:var(--texto);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${d.etiqueta}">${d.etiqueta}</div>
      ${barraH(d.valor, max, color)}
      <div style="width:26px;text-align:right;font-size:11px;font-weight:800;color:${color}">${d.valor}</div>
    </div>`).join("");
}

function renderGraficoDonut(contenedorId, datos, onClickPrefix) {
  const el = document.getElementById(contenedorId);
  if (!el) return;
  const total = datos.reduce((s,d) => s + d.valor, 0);
  if (!total) { el.innerHTML = '<div class="vacio" style="padding:20px"><p>Sin datos aún.</p></div>'; return; }
  const r = 42, cx = 50, cy = 50, circ = 2 * Math.PI * r;
  let offset = 0;
  const click = e => onClickPrefix ? `onclick="${onClickPrefix}('${escapeAttr(e)}')" style="cursor:pointer"` : "";
  const segmentos = datos.filter(d => d.valor > 0).map(d => {
    const frac = d.valor / total;
    const largo = frac * circ;
    const dash = `${largo} ${circ - largo}`;
    const dashoffset = -offset;
    offset += largo;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="14"
      stroke-dasharray="${dash}" stroke-dashoffset="${dashoffset}" transform="rotate(-90 ${cx} ${cy})" ${click(d.etiqueta)}></circle>`;
  }).join("");
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:16px">
      <svg viewBox="0 0 100 100" style="width:110px;height:110px;flex-shrink:0">
        ${segmentos}
        <text x="50" y="46" text-anchor="middle" font-size="20" font-weight="800" fill="var(--texto)">${total}</text>
        <text x="50" y="62" text-anchor="middle" font-size="8" fill="var(--texto-dim)">hoy</text>
      </svg>
      <div style="flex:1;display:flex;flex-direction:column;gap:6px">
        ${datos.map(d => `
          <div style="display:flex;align-items:center;gap:7px;font-size:11px" ${click(d.etiqueta)}>
            <span style="width:9px;height:9px;border-radius:50%;background:${d.color};flex-shrink:0"></span>
            <span style="flex:1;color:var(--texto)">${d.etiqueta}</span>
            <span style="font-weight:800;color:${d.color}">${d.valor}</span>
          </div>`).join("")}
      </div>
    </div>`;
}

function renderGraficoArea(contenedorId, datos) {
  const el = document.getElementById(contenedorId);
  if (!el) return;
  if (datos.every(d => d.valor === 0)) { el.innerHTML = '<div class="vacio" style="padding:20px"><p>Sin datos aún.</p></div>'; return; }
  const max = Math.max(...datos.map(d => d.valor), 1);
  const w = 300, h = 90, pad = 6;
  const stepX = (w - pad*2) / (datos.length - 1);
  const puntos = datos.map((d,i) => {
    const x = pad + i*stepX;
    const y = pad + (1 - d.valor/max) * (h - pad*2);
    return { x, y, d };
  });
  const linea = puntos.map((p,i) => `${i===0?"M":"L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area  = `${linea} L${puntos[puntos.length-1].x.toFixed(1)},${h-pad} L${puntos[0].x.toFixed(1)},${h-pad} Z`;
  el.innerHTML = `
    <svg viewBox="0 0 ${w} ${h+16}" style="width:100%;height:${h+16}px">
      <defs>
        <linearGradient id="gradArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--verde)" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="var(--verde)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#gradArea)"></path>
      <path d="${linea}" fill="none" stroke="var(--verde)" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"></path>
      ${puntos.map(p => `<g style="cursor:pointer" onclick="dashIrDia('${p.d.fechaIso||""}')">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="10" fill="transparent"></circle>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.d.esHoy?3.6:2.4}" fill="${p.d.esHoy?"var(--verde)":"var(--card)"}" stroke="var(--verde)" stroke-width="1.6"></circle>
        ${p.d.valor>0?`<text x="${p.x.toFixed(1)}" y="${(p.y-6).toFixed(1)}" text-anchor="middle" font-size="7.5" font-weight="800" fill="var(--texto)">${p.d.valor}</text>`:""}
        <text x="${p.x.toFixed(1)}" y="${h+11}" text-anchor="middle" font-size="7" font-weight="${p.d.esHoy?800:400}" fill="${p.d.esHoy?"var(--verde)":"var(--texto-dim)"}">${p.d.etiqueta}</text></g>`).join("")}
    </svg>`;
}

function renderGraficoGauge(contenedorId, pct, subtexto) {
  const el = document.getElementById(contenedorId);
  if (!el) return;
  const r = 46, cx = 60, cy = 60;
  const circ = Math.PI * r; // semicírculo
  const frac = Math.min(Math.max(pct,0),100) / 100;
  const color = pct >= 25 ? "var(--rojo)" : (pct >= 10 ? "var(--amarillo)" : "var(--verde)");
  el.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px">
      <svg viewBox="0 0 120 68" style="width:170px">
        <path d="M14,60 A46,46 0 0 1 106,60" fill="none" stroke="var(--card2)" stroke-width="12" stroke-linecap="round"></path>
        <path d="M14,60 A46,46 0 0 1 106,60" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
          stroke-dasharray="${(frac*circ).toFixed(1)} ${circ.toFixed(1)}"></path>
        <text x="60" y="52" text-anchor="middle" font-size="22" font-weight="800" fill="var(--texto)">${pct}%</text>
      </svg>
      <div style="font-size:10.5px;color:var(--texto-dim);text-align:center">${subtexto}</div>
    </div>`;
}

// Muestra un badge en el menú lateral solo si hay algo que marcar (oculto en 0).
function actualizarBadgeLateral(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = count;
  el.style.display = count > 0 ? "" : "none";
}

// ── Acciones al hacer clic en los gráficos del Dashboard ──
window.dashIrEstado = function(etiqueta) {
  const mapa = { "Pendientes":"pendiente", "Entregadas":"entregada", "Retornadas":"retornada", "Canceladas":"cancelada" };
  navegarVista("solicitudes");
  const estado = mapa[etiqueta];
  setTimeout(() => document.querySelector(`.tab-btn[data-tab-estado="${estado||""}"]`)?.click(), 50);
};

window.dashIrCategoria = function(cat) {
  navegarVista("herramientas-cfg");
  setTimeout(() => document.querySelector(`.her-chip[data-cat="${cat === "Sin categoría" ? "" : cat}"]`)?.click(), 80);
};

window.dashAbrirHerramienta = function(nombre) {
  navegarVista("herramientas-cfg");
  setTimeout(() => {
    const h = (_herListaActual || []).find(x => x.nombre === nombre);
    if (h) abrirModalHerramienta(h.id, h.nombre, h.cantidadDisponible, h.local||false, h.categoria||"");
  }, 80);
};

window.dashIrDia = function(fechaIso) {
  if (!fechaIso) { navegarVista("historial"); return; }
  navegarVista("historial");
  setTimeout(() => {
    const inp = document.getElementById("hist-fecha");
    if (inp) { inp.value = fechaIso; histActualizarFiltrosUI(); histPagina = 1; histRenderTabla(); }
  }, 80);
};

let _dashboardEscuchando = false;
function cargarDashboard() {
  if (_dashboardEscuchando) return; // ya hay un listener activo, no crear otro
  _dashboardEscuchando = true;
  // Escuchar en tiempo real las dos colecciones
  onSnapshot(collection(db, "solicitudes"), snapSol => {
    const todas = snapSol.docs.map(d => ({ id: d.id, ...d.data() }));
    getDocs(collection(db, "prestamos_profesores")).then(snapProf => {
      _actualizarDashboard(todas, snapProf.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  });
}

async function _actualizarDashboard(todas, prestProf) {
  try {

    const fechaDe = (ts) => ts?.toDate ? ts.toDate() : new Date(ts||0);
    const esMismoDiaQue = (ts, ref) => {
      const d = fechaDe(ts);
      return d.getFullYear()===ref.getFullYear() && d.getMonth()===ref.getMonth() && d.getDate()===ref.getDate();
    };
    const ayerRef = new Date(); ayerRef.setDate(ayerRef.getDate()-1); ayerRef.setHours(0,0,0,0);

    const deHoy      = todas.filter(s => esMismodia(s.creadoEn));
    const deAyer      = todas.filter(s => esMismoDiaQue(s.creadoEn, ayerRef));
    const prestProfHoy = prestProf.filter(p => esMismodia(p.creadoEn));
    const pendHoy    = deHoy.filter(s => s.estado === "pendiente").length;
    const entregHoy  = deHoy.filter(s => s.estado === "entregada").length;
    const retHoy     = deHoy.filter(s => s.estado === "retornada").length;
    const cancHoy    = deHoy.filter(s => s.estado === "cancelada").length;
    const pendAyer   = deAyer.filter(s => s.estado === "pendiente").length;
    const entregAyer = deAyer.filter(s => s.estado === "entregada").length;
    const retAyer    = deAyer.filter(s => s.estado === "retornada").length;
    const incidencias = todas.filter(s => s.tieneIncidencias && !s.incidenciaVista).length;
    const incidenciasProf = prestProf.filter(p => p.tieneIncidencias && !p.incidenciaVista).length;
    const profActivosHoy = new Set(prestProfHoy.filter(p => p.estado === "activo").map(p => p.profesor)).size;
    const herramientasAfuera = deHoy.filter(s => s.estado === "entregada")
      .reduce((sum, s) => sum + (s.herramientas||[]).reduce((a,h) => a + (h.cantidad||1), 0), 0);

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    set("res-pendientes", pendHoy);
    set("res-prestadas",  entregHoy);
    set("res-hoy",        retHoy);
    set("res-afuera",     herramientasAfuera);
    set("res-prof-activos", profActivosHoy);
    set("badge-pendientes", pendHoy);
    set("dash-incidencias",  incidencias + incidenciasProf);
    set("dash-prof-activos", profActivosHoy);
    set("res-total", deHoy.length);
    actualizarBadgeLateral("badge-incidencias", incidencias + incidenciasProf);

    // Flechas de tendencia vs. ayer
    const trend = (id, hoy, ayer) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (hoy === ayer) { el.innerHTML = `<span style="color:var(--texto-dim)">= igual que ayer</span>`; return; }
      const sube = hoy > ayer;
      const dif = Math.abs(hoy - ayer);
      el.innerHTML = `<span style="color:${sube?"var(--verde)":"var(--rojo)"}">${sube?"▲":"▼"} ${dif} vs. ayer (${ayer})</span>`;
    };
    trend("res-pendientes-trend", pendHoy, pendAyer);
    trend("res-prestadas-trend",  entregHoy, entregAyer);
    trend("res-hoy-trend",        retHoy, retAyer);

    // Donut — solicitudes de hoy por estado
    renderGraficoDonut("grafico-estado-hoy", [
      { etiqueta: "Pendientes", valor: pendHoy, color: "#d29922" },
      { etiqueta: "Entregadas", valor: entregHoy, color: "#3fb950" },
      { etiqueta: "Retornadas", valor: retHoy, color: "#388bfd" },
      { etiqueta: "Canceladas", valor: cancHoy, color: "#f85149" }
    ], "dashIrEstado");

    const conteoHer = {};
    todas.forEach(s => (s.herramientas || []).forEach(h => {
      conteoHer[h.nombre] = (conteoHer[h.nombre] || 0) + (h.cantidad || 1);
    }));
    renderGraficoBarras("grafico-herramientas",
      Object.entries(conteoHer).map(([e,v]) => ({etiqueta:e,valor:v})).sort((a,b) => b.valor-a.valor),
      "var(--verde)");

    // Donut — categorías más usadas (histórico), usando el catálogo de herramientas
    const mapaCategoria = {};
    HERRAMIENTAS_LISTA.forEach(h => mapaCategoria[h.nombre.toLowerCase()] = h.categoria || "Sin categoría");
    (_herListaActual || []).forEach(h => mapaCategoria[h.nombre.toLowerCase()] = h.categoria || "Sin categoría");
    const conteoCat = {};
    Object.entries(conteoHer).forEach(([nombre, valor]) => {
      const cat = mapaCategoria[nombre.toLowerCase()] || "Sin categoría";
      conteoCat[cat] = (conteoCat[cat] || 0) + valor;
    });
    renderGraficoDonut("grafico-categorias",
      Object.entries(conteoCat).sort((a,b) => b[1]-a[1]).slice(0,6).map(([cat,valor]) => ({
        etiqueta: cat, valor, color: (CATEGORIAS_HERRAMIENTA[cat]||{color:"#8b949e"}).color
      })), "dashIrCategoria");

    // Gauge — % de solicitudes históricas con incidencia
    const totalHist = todas.length + prestProf.length;
    const totalIncHist = todas.filter(s=>s.tieneIncidencias).length + prestProf.filter(p=>p.tieneIncidencias).length;
    const pctInc = totalHist ? Math.round((totalIncHist/totalHist)*100) : 0;
    renderGraficoGauge("grafico-gauge-incidencias", pctInc, `${totalIncHist} de ${totalHist} solicitudes`);

    const dias7 = [];
    const hoyRef = new Date(); hoyRef.setHours(0,0,0,0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoyRef); d.setDate(d.getDate() - i);
      const cuenta = todas.filter(s => {
        const fs = s.creadoEn?.toDate ? s.creadoEn.toDate() : new Date(s.creadoEn||0);
        return fs.getFullYear() === d.getFullYear() && fs.getMonth() === d.getMonth() && fs.getDate() === d.getDate();
      }).length;
      dias7.push({ etiqueta: d.toLocaleDateString("es-DO",{weekday:"short"}).slice(0,3), valor: cuenta, esHoy: i === 0, fechaIso: d.toISOString().slice(0,10) });
    }
    renderGraficoArea("grafico-semana", dias7);

    // ── Stock bajo ──
    const stockEl = document.getElementById("dash-stock-bajo");
    if (stockEl) {
      const bajos = (_herListaActual || []).filter(h => (Number.isFinite(h.cantidadDisponible)?h.cantidadDisponible:0) <= UMBRAL_STOCK_BAJO);
      stockEl.innerHTML = bajos.length ? bajos.slice(0,6).map(h => {
        const meta = CATEGORIAS_HERRAMIENTA[h.categoria] || { icono:"🔧", color:"#8b949e" };
        const fotoUrl = h.fotoUrl || (h.codigo ? '../img/herramientas/' + h.codigo + '.jpg' : '');
        const miniatura = fotoUrl
          ? `<img src="${fotoUrl}" style="width:34px;height:34px;border-radius:8px;object-fit:cover;flex-shrink:0" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
             <span style="display:none;width:34px;height:34px;border-radius:8px;background:${meta.color}22;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${meta.icono}</span>`
          : `<span style="display:flex;width:34px;height:34px;border-radius:8px;background:${meta.color}22;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">${meta.icono}</span>`;
        return `
        <div class="dash-fila-premium" style="border-left-color:${meta.color}" onclick="dashAbrirHerramienta('${escapeAttr(h.nombre)}')">
          ${miniatura}
          <div style="flex:1;min-width:0">
            <div style="font-size:12.5px;font-weight:600;color:var(--texto);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(h.nombre)}</div>
            <div style="font-size:9.5px;color:var(--texto-dim)">${h.categoria || "Sin categoría"}</div>
          </div>
          <span style="font-size:11px;font-weight:800;color:var(--amarillo);background:rgba(210,153,34,.12);padding:2px 8px;border-radius:20px;white-space:nowrap">${h.cantidadDisponible} disp.</span>
        </div>`;
      }).join("") : '<div class="vacio" style="padding:10px"><p>Sin alertas de stock. 👍</p></div>';
    }

    // ── Actividad reciente (últimos movimientos) ──
    const actEl = document.getElementById("dash-actividad");
    if (actEl) {
      const eventos = [];
      todas.forEach(s => {
        const nombre = escapeHtml(`${s.nombre||""} ${s.apellido||""}`.trim() || "Estudiante");
        if (s.entregadoEn)  eventos.push({ ts: fechaDe(s.entregadoEn),  texto: `${nombre} recibió herramientas`, icono:"✅", color:"#3fb950" });
        if (s.retornadoEn)  eventos.push({ ts: fechaDe(s.retornadoEn),  texto: `${nombre} retornó herramientas`, icono:"↩", color:"#388bfd" });
        if (!s.entregadoEn && !s.retornadoEn && s.creadoEn) eventos.push({ ts: fechaDe(s.creadoEn), texto: `${nombre} hizo una solicitud`, icono:"📋", color:"#d29922" });
      });
      prestProf.forEach(p => {
        if (p.retornadoEn) eventos.push({ ts: fechaDe(p.retornadoEn), texto: `${escapeHtml(p.profesor)||"Profesor"} retornó herramientas`, icono:"↩", color:"#388bfd" });
        else if (p.creadoEn) eventos.push({ ts: fechaDe(p.creadoEn), texto: `${escapeHtml(p.profesor)||"Profesor"} tomó herramientas`, icono:"👨‍🏫", color:"#a371f7" });
      });
      eventos.sort((a,b) => b.ts - a.ts);
      actEl.innerHTML = eventos.length ? eventos.slice(0,6).map(e => `
        <div class="dash-fila-premium" style="border-left-color:${e.color};cursor:default">
          <span style="display:flex;width:30px;height:30px;border-radius:50%;background:${e.color}22;color:${e.color};align-items:center;justify-content:center;font-size:14px;flex-shrink:0">${e.icono}</span>
          <span style="flex:1;font-size:12px;color:var(--texto)">${e.texto}</span>
          <span style="color:var(--texto-dim);white-space:nowrap;font-size:10.5px">${e.ts.toLocaleTimeString("es-DO",{hour:"2-digit",minute:"2-digit"})}</span>
        </div>`).join("") : '<div class="vacio" style="padding:10px"><p>Sin actividad aún.</p></div>';
    }

  } catch(e) { console.error(e); }
}

// ── SOLICITUDES ──
let todasSolicitudes = [];
let paginaActual = 1;
const porPagina = 10;

async function cargarSolicitudes() {
  try {
    onSnapshot(query(collection(db, "solicitudes"), orderBy("creadoEn", "desc")), (snap) => {
      todasSolicitudes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      actualizarContadores();
      cargarSelectores();
      renderTabla();
      cargarDashboard();
    });
  } catch(e) { console.error(e); }
}

function actualizarContadores() {
  actualizarTabs();
  const pend = todasSolicitudes.filter(s=>s.estado==="pendiente").length;
  const badgeEl = document.getElementById("badge-pendientes");
  const resPendEl = document.getElementById("res-pendientes");
  if (badgeEl) badgeEl.textContent = pend;
  if (resPendEl) resPendEl.textContent = pend;
}

function cargarSelectores() {
  const sel = document.getElementById("filtro-profesor");
  sel.innerHTML = '<option value="">Todos los profesores</option>';
  getDocs(collection(db, "profesores")).then(snap => {
    snap.docs
      .map(d => d.data())
      .filter(p => !p.eliminado)
      .sort((a,b) => a.nombre.localeCompare(b.nombre))
      .forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.nombre; opt.textContent = p.nombre;
        sel.appendChild(opt);
      });
  }).catch(() => {
    const profesores = [...new Set(todasSolicitudes.map(s => s.profesor).filter(Boolean))];
    profesores.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p; opt.textContent = p;
      sel.appendChild(opt);
    });
  });
}

function esMismodia(ts) {
  if (!ts) return false;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const hoy = new Date();
  return d.getFullYear() === hoy.getFullYear() &&
         d.getMonth()    === hoy.getMonth()    &&
         d.getDate()     === hoy.getDate();
}

function fechaDe(ts) { return ts?.toDate ? ts.toDate() : new Date(ts || 0); }
let _solOrdenCol = "fecha";
let _solOrdenDir = -1;
window.ordenarPor = function(col) {
  if (_solOrdenCol === col) _solOrdenDir *= -1;
  else { _solOrdenCol = col; _solOrdenDir = 1; }
  renderTabla();
};
function solicitudesFiltradas() {
  const buscar = document.getElementById("filtro-buscar").value.toLowerCase();
  const estado = document.getElementById("filtro-estado").value;
  const profesor = document.getElementById("filtro-profesor").value;
  const filtradas = todasSolicitudes.filter(s => {
    if (estado !== "incidencia" && !esMismodia(s.creadoEn)) return false;
    const textoMatch = !buscar || `${s.nombre} ${s.apellido} ${s.matricula}`.toLowerCase().includes(buscar);
    const estadoMatch = !estado
      ? true
      : estado === "incidencia"
        ? s.tieneIncidencias === true
        : s.estado === estado;
    const profMatch = !profesor || s.profesor === profesor;
    return textoMatch && estadoMatch && profMatch;
  });
  const val = (s) => {
    switch (_solOrdenCol) {
      case "fecha": return fechaDe(s.creadoEn).getTime();
      case "estudiante": return `${s.nombre} ${s.apellido}`.toLowerCase();
      case "matricula": return s.matricula || "";
      case "profesor": return s.profesor || "";
      case "taller": return s.laboratorio || "";
      case "herramientas": return (s.herramientas || []).length;
      case "estado": return s.estado || "";
      default: return 0;
    }
  };
  filtradas.sort((a, b) => {
    const va = val(a), vb = val(b);
    if (va < vb) return -1 * _solOrdenDir;
    if (va > vb) return 1 * _solOrdenDir;
    return 0;
  });
  return filtradas;
}

function renderTabla() {
  const filtradas = solicitudesFiltradas();
  const total = filtradas.length;
  const inicio = (paginaActual - 1) * porPagina;
  const pagina = filtradas.slice(inicio, inicio + porPagina);
  const wrap = document.getElementById("tabla-solicitudes-wrap");

  if (pagina.length === 0) {
    wrap.innerHTML = '<div class="vacio"><div class="vacio-icono">📭</div><p>No hay solicitudes que coincidan.</p></div>';
    document.getElementById("pag-info").textContent = "";
    document.getElementById("pag-btns").innerHTML = "";
    return;
  }

  const grupos = {};
  pagina.forEach(s => {
    const taller = s.laboratorio || "Sin taller asignado";
    if (!grupos[taller]) grupos[taller] = [];
    grupos[taller].push(s);
  });

  let filas = "";
  let contador = inicio;
  Object.entries(grupos).forEach(([taller, solicitudes]) => {
    filas += `
      <tr>
        <td colspan="9" style="padding:10px 16px 6px;background:var(--card2);border-bottom:2px solid var(--verde)">
          <span style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:var(--verde)">🏭 ${taller}</span>
          <span style="font-size:11px;color:var(--texto-dim);margin-left:8px">${solicitudes.length} solicitud(es)</span>
        </td>
      </tr>`;
    solicitudes.forEach(s => {
      contador++;
      filas += `
          <tr style="cursor:pointer" onclick="abrirModal('${s.id}')">
            <td style="color:var(--texto-dim)">${contador}</td>
            <td style="font-size:12px;color:var(--texto-dim)">${formatFecha(s.creadoEn)}</td>
            <td>
              <div class="est-avatar">
                <div class="est-circulo" style="background:${colorEstudiante(s.nombre||"")}22;color:${colorEstudiante(s.nombre||"")}">
                  ${iniciales(s.nombre, s.apellido)}
                </div>
                <div><div class="est-nombre">${escapeHtml(s.nombre)} ${escapeHtml(s.apellido)}</div></div>
              </div>
            </td>
            <td style="font-size:12px">${s.matricula || "—"}</td>
            <td style="font-size:12px">${s.profesor || "—"}</td>
            <td style="font-size:12px">${s.laboratorio || "—"}</td>
            <td style="white-space:nowrap">
              <span style="display:inline-flex;align-items:center;gap:5px">
                <span style="width:20px;height:20px;border-radius:50%;background:var(--gradiente-verde);color:#fff;font-size:10px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0">${((s.herramientasEntregadas && s.herramientasEntregadas.length) ? s.herramientasEntregadas : (s.herramientas||[])).length}</span>
                <span style="font-size:11px;color:var(--texto-dim)">herramientas</span>
              </span>
            </td>
            <td style="white-space:nowrap"><span class="badge badge-dot badge-${s.estado}">${s.estado}</span>${s.tieneIncidencias ? ' <span class="badge badge-cancelada" title="Tiene incidencias">⚠️</span>' : ''}${s.estado === "pendiente" && (Date.now() - fechaDe(s.creadoEn).getTime()) > 15*60*1000 ? ' <span class="badge badge-cancelada" title="Pendiente hace más de 15 minutos">⏰</span>' : ''}</td>
            <td>
              <div style="display:flex;gap:6px">
                <button class="btn btn-outline" onclick="event.stopPropagation();abrirModal('${s.id}')">👁 Ver</button>
                ${s.estado === "pendiente" ? `<button class="btn btn-verde" onclick="event.stopPropagation();entregar('${s.id}')" title="Registrar la entrega de esta solicitud">✓ Entregar</button>` : ""}
                ${s.estado === "entregada" ? `<button class="btn btn-azul" onclick="event.stopPropagation();retornar('${s.id}')">↩ Retornar</button>` : ""}
                ${s.estado === "retornada" ? `<span class="badge badge-dot badge-entregada" style="cursor:default">Retornada</span>` : ""}
                ${s.estado === "cancelada" ? `<span class="badge badge-cancelada">❌ Cancelada</span>` : ""}
              </div>
            </td>
          </tr>`;
    });
  });

  const flecha = (col) => _solOrdenCol === col ? (_solOrdenDir === 1 ? ' ▲' : ' ▼') : '';
  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th style="cursor:pointer" onclick="ordenarPor('fecha')">Fecha y Hora${flecha('fecha')}</th>
          <th style="cursor:pointer" onclick="ordenarPor('estudiante')">Estudiante${flecha('estudiante')}</th>
          <th style="cursor:pointer" onclick="ordenarPor('matricula')">Matrícula${flecha('matricula')}</th>
          <th style="cursor:pointer" onclick="ordenarPor('profesor')">Profesor${flecha('profesor')}</th>
          <th style="cursor:pointer" onclick="ordenarPor('taller')">Taller / Lab${flecha('taller')}</th>
          <th style="cursor:pointer" onclick="ordenarPor('herramientas')">Herramientas${flecha('herramientas')}</th>
          <th style="cursor:pointer" onclick="ordenarPor('estado')">Estado${flecha('estado')}</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>${filas}</tbody>
    </table>
  `;

  const totalPags = Math.ceil(total / porPagina);
  const desde = inicio + 1;
  const hasta = Math.min(inicio + porPagina, total);
  document.getElementById("pag-info").textContent = total > 0
    ? (desde === 1 && hasta === total
        ? `${total} solicitud${total !== 1 ? "es" : ""} en total`
        : `Mostrando ${desde}–${hasta} de ${total} solicitud${total !== 1 ? "es" : ""}`)
    : "";
  const btns = document.getElementById("pag-btns");
  btns.innerHTML = "";
  for (let p = 1; p <= totalPags; p++) {
    const b = document.createElement("button");
    b.textContent = p;
    if (p === paginaActual) b.classList.add("activo");
    b.addEventListener("click", () => { paginaActual = p; renderTabla(); });
    btns.appendChild(b);
  }
}

function actualizarFiltrosUI() {
  const buscar  = document.getElementById("filtro-buscar").value.trim();
  const estado  = document.getElementById("filtro-estado").value;
  const profesor = document.getElementById("filtro-profesor").value;

  const elBuscar  = document.getElementById("filtro-buscar");
  const elEstado  = document.getElementById("filtro-estado");
  const elProfesor = document.getElementById("filtro-profesor");

  elBuscar.style.borderColor   = buscar   ? "var(--verde)" : "";
  elBuscar.style.background    = buscar   ? "rgba(34,197,94,.06)" : "";
  elEstado.style.borderColor   = estado   ? "var(--verde)" : "";
  elEstado.style.background    = estado   ? "rgba(34,197,94,.06)" : "";
  elProfesor.style.borderColor = profesor ? "var(--verde)" : "";
  elProfesor.style.background  = profesor ? "rgba(34,197,94,.06)" : "";

  const bar  = document.getElementById("filtros-activos-bar");
  const tags = document.getElementById("filtros-tags");
  const hayFiltro = buscar || estado || profesor;

  bar.style.display = hayFiltro ? "flex" : "none";
  tags.innerHTML = "";

  if (buscar) tags.innerHTML += `<span style="background:rgba(34,197,94,.15);color:var(--verde);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">🔍 "${buscar}"</span>`;
  if (estado) {
    const etiquetas = { pendiente:"⏳ Pendiente", entregada:"✅ Entregada", retornada:"↩ Retornada", cancelada:"❌ Cancelada", incidencia:"⚠️ Con Incidencia" };
    tags.innerHTML += `<span style="background:rgba(34,197,94,.15);color:var(--verde);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${etiquetas[estado]||estado}</span>`;
  }
  if (profesor) tags.innerHTML += `<span style="background:rgba(34,197,94,.15);color:var(--verde);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">👤 ${profesor}</span>`;
}

document.getElementById("btn-limpiar-filtros")?.addEventListener("click", () => {
  document.getElementById("filtro-buscar").value  = "";
  document.getElementById("filtro-estado").value  = "";
  document.getElementById("filtro-profesor").value = "";
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("activo"));
  document.querySelector(".tab-btn[data-tab-estado='']")?.classList.add("activo");
  ocultarPanelIncidenciasProf();
  actualizarFiltrosUI();
  paginaActual = 1;
  renderTabla();
});

["filtro-buscar","filtro-profesor"].forEach(id => {
  document.getElementById(id)?.addEventListener("input", () => { actualizarFiltrosUI(); paginaActual = 1; renderTabla(); });
  document.getElementById(id)?.addEventListener("change", () => { actualizarFiltrosUI(); paginaActual = 1; renderTabla(); });
});

document.getElementById("filtro-estado")?.addEventListener("change", () => {
  const val = document.getElementById("filtro-estado").value;
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.toggle("activo", b.dataset.tabEstado === val));
  if (val !== "incidencia") ocultarPanelIncidenciasProf();
  actualizarFiltrosUI();
  paginaActual = 1;
  renderTabla();
});

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("activo"));
    btn.classList.add("activo");
    document.getElementById("filtro-estado").value = btn.dataset.tabEstado;
    ocultarPanelIncidenciasProf();
    actualizarFiltrosUI();
    paginaActual = 1;
    renderTabla();
  });
});

// ── MODAL ──
window.abrirModal = function(id) {
  const s = todasSolicitudes.find(x => x.id === id);
  if (!s) return;
  // Al abrir el detalle, si tenía una incidencia sin ver, se marca como vista
  // (deja de contar en el badge del menú lateral, como una notificación leída).
  if (s.tieneIncidencias && !s.incidenciaVista) {
    updateDoc(doc(db, "solicitudes", id), { incidenciaVista: true }).catch(e => console.error(e));
  }
  document.getElementById("modal-titulo-texto").textContent = "Detalle de Solicitud";
  const herBase = (s.herramientasEntregadas && s.herramientasEntregadas.length) ? s.herramientasEntregadas : (s.herramientas || []);
  const totalHerBase = herBase.reduce((sum, h) => sum + (h.cantidad || 1), 0);
  const herramientas = herBase.map(h =>
    `<div class="modal-herramienta-item"><span style="display:flex;align-items:center;gap:8px">${herFotoHtmlPorNombre(h.nombre)}<span>${escapeHtml(h.nombre)}${h.adicional ? '<span style="font-size:10px;color:var(--azul);margin-left:5px">(adicional)</span>' : ""}</span></span><span style="color:var(--verde);font-weight:700">x${h.cantidad}</span></div>`
  ).join("");

  document.getElementById("modal-contenido").innerHTML = `
    <div class="modal-campo"><label>Número de solicitud</label><div class="valor">${s.numeroSolicitud || s.id.slice(0,8)}</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="modal-campo"><label>Nombre</label><div class="valor">${escapeHtml(s.nombre)} ${escapeHtml(s.apellido)}</div></div>
      <div class="modal-campo"><label>Matrícula</label><div class="valor">${s.matricula || "—"}</div></div>
      <div class="modal-campo"><label>Ciclo</label><div class="valor">${escapeHtml(s.ciclo) || "—"}</div></div>
      <div class="modal-campo"><label>Teléfono</label><div class="valor">${escapeHtml(s.telefono) || "—"}</div></div>
      <div class="modal-campo"><label>Profesor</label><div class="valor">${s.profesor || "—"}</div></div>
      <div class="modal-campo"><label>Laboratorio / Taller</label><div class="valor">${s.laboratorio || "—"}</div></div>
    </div>
    <div class="modal-campo"><label>Estado</label><span class="badge badge-${s.estado}">${s.estado}</span></div>
    <div class="modal-campo"><label>Cantidad de herramientas</label>
      <div style="display:inline-flex;align-items:center;gap:8px;background:var(--verde-glow);border:1px solid rgba(63,185,80,0.35);border-radius:10px;padding:8px 14px;margin-top:2px">
        <span style="font-size:18px">🧰</span>
        <span style="font-size:20px;font-weight:800;color:var(--verde)">${totalHerBase}</span>
        <span style="font-size:12.5px;color:var(--texto-dim)">herramienta${totalHerBase===1?"":"s"}</span>
      </div>
    </div>
    <div class="modal-campo"><label>Fecha</label><div class="valor">${formatFecha(s.creadoEn)}</div></div>
    <div class="modal-campo">
      <label>Herramientas solicitadas</label>
      <div class="modal-herramientas">${herramientas || "—"}</div>
    </div>
    ${s.tieneIncidencias ? `
    <div class="modal-campo">
      <label>⚠️ Incidencias registradas</label>
      <div class="modal-herramientas" id="modal-incidencias-est"><div class="cargando"><div class="spinner"></div>Cargando incidencias...</div></div>
    </div>` : ""}
  `;

  if (s.tieneIncidencias) {
    (async () => {
      const cont = document.getElementById("modal-incidencias-est");
      try {
        const snap = await getDocs(query(
          collection(db, "incidencias"),
          where("solicitudId", "==", s.id)
        ));
        if (!snap.empty) {
          cont.innerHTML = snap.docs.map(d => {
            const i = d.data();
            return `<div class="modal-herramienta-item"><span>${i.herramienta || "—"}</span><span style="color:var(--rojo);font-weight:700">${i.tipo || "—"}</span></div>`;
          }).join("");
        } else {
          cont.innerHTML = `<div class="valor">No se encontró el detalle específico de la incidencia.</div>`;
        }
      } catch(e) {
        cont.innerHTML = `<div class="valor">No se pudo cargar el detalle de la incidencia.</div>`;
      }
    })();
  }

  const acciones = document.getElementById("modal-acciones");
  acciones.innerHTML = "";
  // Botón cerrar siempre presente
  const bCerrar = document.createElement("button");
  bCerrar.className = "btn btn-outline"; bCerrar.textContent = "✕ Cerrar";
  bCerrar.onclick = cerrarModal;
  if (s.estado === "pendiente") {
    const b = document.createElement("button");
    b.className = "btn btn-azul"; b.textContent = "✓ Entregar";
    b.onclick = () => { cerrarModal(); entregar(id); };
    acciones.appendChild(b);
    const bc = document.createElement("button");
    bc.className = "btn btn-rojo"; bc.textContent = "⊘ Anular";
    bc.onclick = () => { cerrarModal(); anular(id); };
    acciones.appendChild(bc);
  }
  if (s.estado === "entregada") {
    const ba = document.createElement("button");
    ba.className = "btn btn-outline"; ba.textContent = "➕ Adicional";
    ba.onclick = () => { cerrarModal(); entregar(id); };
    acciones.appendChild(ba);
    const b = document.createElement("button");
    b.className = "btn btn-azul"; b.textContent = "↩ Retornar";
    b.onclick = () => { cerrarModal(); retornar(id); };
    acciones.appendChild(b);
  }
  acciones.appendChild(bCerrar);
  document.getElementById("modal-solicitud").classList.add("abierto");
};

function cerrarModal() {
  document.getElementById("modal-solicitud").classList.remove("abierto");
}

window.verDetalleIncidenciaProf = async function(prestamoId) {
  const p = (todosPrestamosProfTodos || todosPrestamosProf).find(x => x.id === prestamoId);
  if (!p) return;
  // Al abrir el detalle, si tenía una incidencia sin ver, se marca como vista
  // (mismo comportamiento que el detalle de solicitudes de estudiantes).
  if (p.tieneIncidencias && !p.incidenciaVista) {
    updateDoc(doc(db, "prestamos_profesores", prestamoId), { incidenciaVista: true }).catch(e => console.error(e));
  }
  document.getElementById("modal-titulo-texto").textContent = "Detalle de Incidencia";
  document.getElementById("modal-contenido").innerHTML = `<div class="cargando"><div class="spinner"></div>Cargando detalle...</div>`;
  document.getElementById("modal-acciones").innerHTML = "";
  document.getElementById("modal-solicitud").classList.add("abierto");

  let detalleHtml = "";
  try {
    const snap = await getDocs(query(
      collection(db, "incidencias"),
      where("prestamoId", "==", prestamoId)
    ));
    if (!snap.empty) {
      detalleHtml = snap.docs.map(d => {
        const i = d.data();
        return `<div class="modal-herramienta-item"><span>${i.herramienta || "—"}</span><span style="color:var(--rojo);font-weight:700">${i.tipoIncidencia || "—"}</span></div>`;
      }).join("");
    } else {
      detalleHtml = `<div class="valor">No se encontró el detalle específico de la incidencia.</div>`;
    }
  } catch(e) {
    detalleHtml = `<div class="valor">No se pudo cargar el detalle de la incidencia.</div>`;
  }

  const fecha = p.creadoEn?.toDate ? p.creadoEn.toDate().toLocaleString("es-DO") : "—";
  document.getElementById("modal-contenido").innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="modal-campo"><label>Profesor</label><div class="valor">${escapeHtml(p.profesor) || "—"}</div></div>
      <div class="modal-campo"><label>Laboratorio / Taller</label><div class="valor">${escapeHtml(p.laboratorio) || "—"}</div></div>
    </div>
    <div class="modal-campo"><label>Fecha del préstamo</label><div class="valor">${fecha}</div></div>
    <div class="modal-campo">
      <label>Herramientas con incidencia</label>
      <div class="modal-herramientas">${detalleHtml}</div>
    </div>
  `;
};

document.getElementById("modal-cerrar").addEventListener("click", cerrarModal);
document.getElementById("modal-solicitud").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-solicitud")) cerrarModal();
});

// ── ACCIONES ──
let solicitudActivaId = null;

// El onclick del HTML no puede leer "solicitudActivaId" directo (es una
// variable del módulo, invisible fuera de él) — por eso este wrapper sí
// expuesto en window, igual que el resto de las funciones que se llaman
// desde atributos onclick.
window.agregarAdicionalDesdeRetorno = function() {
  abrirFotosAdicionalRetorno(solicitudActivaId);
};

// ─── MODAL ENTREGA ───
let _entregaAdicionales = {};

function renderReciboEntrega() {
  const s = todasSolicitudes.find(x => x.id === solicitudActivaId);
  if (!s) return;
  const lista = document.getElementById("lista-entrega");
  const base = (s.herramientasEntregadas && s.herramientasEntregadas.length) ? s.herramientasEntregadas : (s.herramientas || []);
  const herOrig = base.filter(h => !h.adicional);
  const herAdicPrevias = base.filter(h => h.adicional);
  const renderFilas = (arr, offset) => arr.map((h, i) => `
    <div class="fila-herramienta">
      <input type="checkbox" id="chk-e-${offset+i}" data-idx="${offset+i}" checked>
      ${herFotoHtmlPorNombre(h.nombre)}
      <span class="h-nombre">${escapeHtml(h.nombre)}${h.adicional ? '<span style="font-size:10px;color:var(--azul);margin-left:5px">(adicional)</span>' : ""}</span>
      <span class="h-cant">x${h.cantidad}</span>
    </div>`).join("");
  let listaHtml = renderFilas(herOrig, 0);
  if (herAdicPrevias.length > 0) {
    listaHtml += `<div style="display:flex;align-items:center;gap:8px;margin:8px 4px 4px">
      <div style="flex:1;height:1px;background:var(--borde)"></div>
      <span style="font-size:10px;font-weight:800;color:var(--amarillo);white-space:nowrap">➕ ADICIONALES</span>
      <div style="flex:1;height:1px;background:var(--borde)"></div>
    </div>` + renderFilas(herAdicPrevias, herOrig.length);
  }
  const nuevos = Object.entries(_entregaAdicionales);
  if (nuevos.length > 0) {
    listaHtml += `<div style="display:flex;align-items:center;gap:8px;margin:8px 4px 4px">
      <div style="flex:1;height:1px;background:var(--borde)"></div>
      <span style="font-size:10px;font-weight:800;color:var(--verde);white-space:nowrap">🆕 AGREGANDO AHORA</span>
      <div style="flex:1;height:1px;background:var(--borde)"></div>
    </div>` + nuevos.map(([nombre, cant]) => `
      <div class="fila-herramienta">
        ${herFotoHtmlPorNombre(nombre, 40)}
        <span class="h-nombre">${escapeHtml(nombre)}</span>
        <button type="button" class="btn btn-outline" onclick="entregaAdicionalAjustar('${escapeAttr(nombre)}',-1)" style="padding:2px 8px">−</button>
        <span class="h-cant">x${cant}</span>
        <button type="button" class="btn btn-outline" onclick="entregaAdicionalAjustar('${escapeAttr(nombre)}',1)" style="padding:2px 8px">+</button>
        <button type="button" class="btn btn-rojo" onclick="entregaAdicionalQuitar('${escapeAttr(nombre)}')" style="padding:2px 8px" title="Quitar">✕</button>
      </div>`).join("");
  }
  lista.innerHTML = listaHtml || "<div style='padding:12px;color:var(--texto-dim)'>Sin herramientas</div>";
}

window.renderEntregaPickerGrid = function() {
  const wrap = document.getElementById("entrega-picker-grid");
  const q = (document.getElementById("entrega-picker-buscar").value || "").toLowerCase();
  const lista = (_herListaActual || []).filter(h => h.nombre.toLowerCase().includes(q));
  if (!lista.length) {
    wrap.innerHTML = '<div class="vacio" style="grid-column:1/-1"><div class="vacio-icono">🧰</div><p>Sin resultados.</p></div>';
    return;
  }
  wrap.innerHTML = lista.map(h => {
    const fotoUrl = h.fotoUrl || (h.codigo ? '../img/herramientas/' + h.codigo + '.jpg' : '');
    const icono = h.icono || '🔧';
    const foto = fotoUrl
      ? `<img src="${fotoUrl}" onerror="this.parentNode.innerHTML='<span class=\\'her-foto-fallback\\'>${icono}</span>'">`
      : `<span class="her-foto-fallback">${icono}</span>`;
    const enRecibo = _entregaAdicionales[h.nombre] || 0;
    return `
      <div class="her-card" onclick="entregaPickerAgregar('${escapeAttr(h.nombre)}')" title="Agregar al recibo">
        <div class="her-foto-wrap">${foto}${enRecibo > 0 ? `<span class="her-ribbon popular">x${enRecibo}</span>` : ""}</div>
        <div class="her-cuerpo"><div class="her-nombre">${escapeHtml(h.nombre)}</div></div>
      </div>`;
  }).join("");
};

window.entregaPickerAgregar = function(nombre) {
  const s = todasSolicitudes.find(x => x.id === solicitudActivaId);
  const base = s ? ((s.herramientasEntregadas && s.herramientasEntregadas.length) ? s.herramientasEntregadas : (s.herramientas || [])) : [];
  const yaEnSolicitud = base.some(h => h.nombre === nombre);
  if (yaEnSolicitud || _entregaAdicionales[nombre]) { mostrarToast("Ya está en la solicitud", "rojo"); return; }
  _entregaAdicionales[nombre] = 1;
  renderReciboEntrega();
  renderEntregaPickerGrid();
  const lista = document.getElementById("lista-entrega");
  lista.scrollTop = lista.scrollHeight;
};

window.entregaAdicionalAjustar = function(nombre, delta) {
  const nuevo = (_entregaAdicionales[nombre] || 0) + delta;
  if (nuevo <= 0) delete _entregaAdicionales[nombre];
  else _entregaAdicionales[nombre] = nuevo;
  renderReciboEntrega();
  renderEntregaPickerGrid();
};

window.entregaAdicionalQuitar = function(nombre) {
  delete _entregaAdicionales[nombre];
  renderReciboEntrega();
  renderEntregaPickerGrid();
};

window.entregar = async function(id) {
  solicitudActivaId = id;
  const s = todasSolicitudes.find(x => x.id === id);
  if (!s) return;

  document.getElementById("info-entrega").innerHTML =
    `<strong>${escapeHtml(s.nombre)} ${escapeHtml(s.apellido)}</strong> · ${escapeHtml(s.matricula)} · ${escapeHtml(s.laboratorio) || ""}`;

  _entregaAdicionales = {};
  document.getElementById("btn-toggle-entrega").textContent = "Desmarcar todas";
  document.getElementById("entrega-picker-buscar").value = "";
  document.getElementById("btn-guardar-sin-entregar").style.display = s.estado === "pendiente" ? "" : "none";
  renderReciboEntrega();
  renderEntregaPickerGrid();

  // La ventana se abre YA, sin esperar la consulta de incidencias de abajo
  // (esa consulta puede tardar un instante y antes dejaba la pantalla en
  // blanco mientras tanto).
  document.getElementById("modal-entrega").classList.add("abierto");

  const alertaEl = document.getElementById("alerta-incidencia");
  try {
    const snapHist = await getDocs(query(
      collection(db, "incidencias"),
      where("matricula", "==", s.matricula)
    ));
    if (!snapHist.empty) {
      const items = snapHist.docs.map(d => d.data());
      alertaEl.style.display = "block";
      alertaEl.innerHTML = `⚠️ <strong>Este estudiante tiene ${items.length} incidencia(s) previa(s):</strong><br>` +
        items.map(i => `• ${i.herramienta} — <em>${i.tipo}</em> (${i.fecha || "sin fecha"})`).join("<br>");
    } else {
      alertaEl.style.display = "none";
    }
  } catch(e) { alertaEl.style.display = "none"; }
};

window.toggleMarcarTodasEntrega = function() {
  const checks = document.querySelectorAll("#lista-entrega input[type='checkbox']");
  const todasMarcadas = [...checks].every(c => c.checked);
  checks.forEach(c => c.checked = !todasMarcadas);
  document.getElementById("btn-toggle-entrega").textContent = todasMarcadas ? "Marcar todas" : "Desmarcar todas";
};

window.agregarFilaAdicional = function() {
  abrirFotosAdicionalEntrega();
};

// ── Selector con fotos para agregar herramientas adicionales ──
// Reutiliza las mismas fotos locales que ya usa el formulario del
// estudiante y "préstamos a profesores" — no sube nada a ningún lado,
// cero relación con Firebase Storage.
let _solPickerCant = {};
let _solPickerModo = "entrega-modal"; // "entrega-modal" | "retorno-directo"
let _solPickerRetornoId = null;

window.abrirFotosAdicionalEntrega = function() {
  _solPickerModo = "entrega-modal";
  _solPickerRetornoId = null;
  _solPickerCant = {};
  document.getElementById("sol-picker-titulo").textContent = "📷 Elegir herramientas adicionales";
  document.getElementById("sol-picker-buscar").value = "";
  renderPickerFotosSolicitud();
  document.getElementById("modal-fotos-solicitud").classList.add("abierto");
};

window.abrirFotosAdicionalRetorno = function(id) {
  _solPickerModo = "retorno-directo";
  _solPickerRetornoId = id;
  _solPickerCant = {};
  document.getElementById("sol-picker-titulo").textContent = "📷 Agregar herramientas adicionales";
  document.getElementById("sol-picker-buscar").value = "";
  renderPickerFotosSolicitud();
  document.getElementById("modal-fotos-solicitud").classList.add("abierto");
};

window.cerrarPickerFotosSolicitud = function() {
  document.getElementById("modal-fotos-solicitud").classList.remove("abierto");
};

window.renderPickerFotosSolicitud = function renderPickerFotosSolicitud() {
  const wrap = document.getElementById("sol-picker-grid");
  const qCruda = document.getElementById("sol-picker-buscar").value || "";
  const q = qCruda.toLowerCase().trim();
  const lista = _herListaActual.filter(h => h.nombre.toLowerCase().includes(q));

  let html = lista.map(h => {
    const fotoUrl = h.fotoUrl || (h.codigo ? '../img/herramientas/' + h.codigo + '.jpg' : '');
    const icono = h.icono || '🔧';
    const foto = fotoUrl
      ? `<img src="${fotoUrl}" onerror="this.parentNode.innerHTML='${icono}'">`
      : icono;
    const cant = _solPickerCant[h.nombre] || 0;
    const nombreEsc = escapeAttr(h.nombre);
    const badge = cant > 0 ? `<span class="picker-badge">${cant}</span>` : "";
    return `
      <div class="picker-card${cant > 0 ? ' en-carrito' : ''}" onclick="solPickerAjustar('${nombreEsc}',1)">
        <div class="picker-foto">${foto}${badge}</div>
        <div class="picker-nombre">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(h.nombre)}</span>
          ${cant > 0 ? `<span class="picker-stepper" onclick="event.stopPropagation()">
            <button type="button" onclick="solPickerAjustar('${nombreEsc}',-1)">−</button>
            <button type="button" class="mas" onclick="solPickerAjustar('${nombreEsc}',1)">+</button>
          </span>` : ""}
        </div>
      </div>`;
  }).join("");

  // Si lo escrito no coincide con nada del catálogo, se ofrece agregarlo
  // tal cual (reemplaza el viejo botón aparte "✏️ Escribir").
  const yaExiste = q && _herListaActual.some(h => h.nombre.toLowerCase() === q);
  if (q && !yaExiste) {
    html += `<div class="picker-card-custom" onclick="solPickerAjustar('${escapeAttr(qCruda.trim())}',1)">
      ➕&nbsp; Agregar "<b>${escapeHtml(qCruda.trim())}</b>" de todas formas (no está en el catálogo)
    </div>`;
  }
  if (!lista.length && !q) {
    html = '<div class="picker-vacio">🧰 No hay herramientas en el catálogo todavía.</div>';
  }

  wrap.innerHTML = html;
  renderPickerCart();
};

function renderPickerCart() {
  const wrap = document.getElementById("sol-picker-cart-lista");
  const countEl = document.getElementById("sol-picker-cart-count");
  const seleccion = Object.entries(_solPickerCant);
  countEl.textContent = seleccion.reduce((a, [, c]) => a + c, 0);
  if (!seleccion.length) {
    wrap.innerHTML = '<div class="picker-cart-vacio">Toca una herramienta a la izquierda<br>para agregarla aquí.</div>';
    return;
  }
  wrap.innerHTML = seleccion.map(([nombre, cant]) => {
    const nombreEsc = escapeAttr(nombre);
    return `
      <div class="picker-cart-item">
        <span class="nombre" title="${escapeAttr(nombre)}">${escapeHtml(nombre)}</span>
        <button type="button" onclick="solPickerAjustar('${nombreEsc}',-1)">−</button>
        <span class="cant">${cant}</span>
        <button type="button" class="mas" onclick="solPickerAjustar('${nombreEsc}',1)">+</button>
        <button type="button" class="quitar" onclick="solPickerQuitar('${nombreEsc}')" title="Quitar">🗑</button>
      </div>`;
  }).join("");
}

window.solPickerAjustar = function(nombre, delta) {
  if (!nombre) return;
  const actual = _solPickerCant[nombre] || 0;
  const nuevo = Math.max(0, actual + delta);
  if (nuevo === 0) delete _solPickerCant[nombre];
  else _solPickerCant[nombre] = nuevo;
  renderPickerFotosSolicitud();
};

window.solPickerQuitar = function(nombre) {
  delete _solPickerCant[nombre];
  renderPickerFotosSolicitud();
};

// ── Opción "escribir a mano" (por si la herramienta no tiene foto o no
// está en el catálogo) — funciona en los dos modos del selector. ──
window.entregaAgregarManual = function() {
  const nombre = prompt("Nombre de la herramienta:");
  if (!nombre || !nombre.trim()) return;
  const cantidadTexto = prompt("Cantidad:", "1");
  const cantidad = Math.max(1, parseInt(cantidadTexto) || 1);
  const n = nombre.trim();
  _entregaAdicionales[n] = (_entregaAdicionales[n] || 0) + cantidad;
  renderReciboEntrega();
  renderEntregaPickerGrid();
};

window.agregarFilaAdicionalManual = async function() {
  const nombre = prompt("Nombre de la herramienta:");
  if (!nombre || !nombre.trim()) return;
  const cantidadTexto = prompt("Cantidad:", "1");
  const cantidad = parseInt(cantidadTexto) || 1;

  if (_solPickerModo === "entrega-modal") {
    _entregaAdicionales[nombre.trim()] = (_entregaAdicionales[nombre.trim()] || 0) + cantidad;
    renderReciboEntrega();
    renderEntregaPickerGrid();
    cerrarPickerFotosSolicitud();
    mostrarToast('Agregada — no olvides "Guardar entrega"');
    return;
  }

  const s = todasSolicitudes.find(x => x.id === _solPickerRetornoId);
  if (!s) { mostrarToast("No se encontró la solicitud", "rojo"); return; }
  const base = (s.herramientasEntregadas && s.herramientasEntregadas.length) ? s.herramientasEntregadas : (s.herramientas || []);
  const listaFinal = [...base, { nombre: nombre.trim(), cantidad, adicional: true, estadoEntrega: "entregada" }];

  try {
    await updateDoc(doc(db, "solicitudes", s.id), { herramientasEntregadas: listaFinal });
    try {
      await updateDoc(doc(db, "activaHoy", s.matricula), { herramientas: listaFinal });
    } catch (errFicha) { console.error("No se pudo sincronizar activaHoy:", errFicha); }
    s.herramientasEntregadas = listaFinal;
    renderTabla();
    cargarDashboard();
    cerrarPickerFotosSolicitud();
    mostrarToast("✓ Herramienta adicional agregada");
  } catch (e) {
    console.error("Error al agregar adicional:", e);
    mostrarToast("Error al agregar: " + e.message, "rojo");
  }
};

window.confirmarPickerFotosSolicitud = async function() {
  const seleccion = Object.entries(_solPickerCant);
  if (!seleccion.length) { mostrarToast("Elige al menos una herramienta", "rojo"); return; }

  if (_solPickerModo === "entrega-modal") {
    // Se acumula en el mismo objeto que usa el recibo de entrega; se
    // guarda de verdad recién cuando se presiona "Guardar entrega".
    seleccion.forEach(([nombre, cantidad]) => {
      _entregaAdicionales[nombre] = (_entregaAdicionales[nombre] || 0) + cantidad;
    });
    renderReciboEntrega();
    renderEntregaPickerGrid();
    cerrarPickerFotosSolicitud();
    mostrarToast(`${seleccion.length} herramienta(s) agregada(s) — no olvides "Guardar entrega"`);
    return;
  }

  // Modo "retorno-directo": la solicitud ya está entregada, así que esto
  // sí escribe directo a Firestore (igual que cuando se agrega desde el
  // lado del estudiante), sin pasar por el modal de entrega completo.
  const s = todasSolicitudes.find(x => x.id === _solPickerRetornoId);
  if (!s) { mostrarToast("No se encontró la solicitud", "rojo"); cerrarPickerFotosSolicitud(); return; }

  const base = (s.herramientasEntregadas && s.herramientasEntregadas.length) ? s.herramientasEntregadas : (s.herramientas || []);
  const listaFinal = base.map(h => ({ ...h }));
  seleccion.forEach(([nombre, cantidad]) => {
    const existente = listaFinal.find(h => h.nombre === nombre);
    if (existente) existente.cantidad = (existente.cantidad || 0) + cantidad;
    else listaFinal.push({ nombre, cantidad, adicional: true, estadoEntrega: "entregada" });
  });

  try {
    await updateDoc(doc(db, "solicitudes", s.id), { herramientasEntregadas: listaFinal });
    try {
      await updateDoc(doc(db, "activaHoy", s.matricula), { herramientas: listaFinal });
    } catch (errFicha) { console.error("No se pudo sincronizar activaHoy:", errFicha); }
    s.herramientasEntregadas = listaFinal;
    renderTabla();
    cargarDashboard();
    cerrarPickerFotosSolicitud();
    mostrarToast("✓ Herramientas adicionales agregadas");
  } catch (e) {
    console.error("Error al agregar adicional:", e);
    mostrarToast("Error al agregar: " + e.message, "rojo");
  }
};

function confirmarPersonalizado(mensaje) {
  return new Promise((resolve) => {
    document.getElementById("confirm-custom-msg").textContent = mensaje;
    const modal = document.getElementById("modal-confirm-custom");
    modal.classList.add("abierto");
    const btnSi = document.getElementById("confirm-custom-si");
    const btnNo = document.getElementById("confirm-custom-no");
    const limpiar = (resultado) => {
      modal.classList.remove("abierto");
      btnSi.onclick = null; btnNo.onclick = null;
      resolve(resultado);
    };
    btnSi.onclick = () => limpiar(true);
    btnNo.onclick = () => limpiar(false);
  });
}

window.cerrarModalEntrega = async function() {
  const hayAdicionalesSinGuardar = Object.keys(_entregaAdicionales).length > 0;
  if (hayAdicionalesSinGuardar && !(await confirmarPersonalizado("Tienes herramientas adicionales sin guardar. ¿Cerrar de todas formas y perder esos cambios?"))) {
    return;
  }
  document.getElementById("modal-entrega").classList.remove("abierto");
  solicitudActivaId = null;
};

window.guardarCambiosPendiente = async function() {
  if (!solicitudActivaId) return;
  const s = todasSolicitudes.find(x => x.id === solicitudActivaId);
  if (!s) return;

  if (Object.keys(_entregaAdicionales).length === 0) {
    await confirmarPersonalizado("No has agregado ninguna herramienta adicional para guardar.");
    return;
  }

  const checks = document.querySelectorAll("#lista-entrega input[type='checkbox']");
  const base = (s.herramientasEntregadas && s.herramientasEntregadas.length) ? s.herramientasEntregadas : (s.herramientas || []);
  const lista = [];
  checks.forEach((chk, i) => {
    if (chk.checked && base[i]) lista.push({ ...base[i] });
  });
  Object.entries(_entregaAdicionales).forEach(([nombre, cantidad]) => {
    lista.push({ nombre, cantidad, adicional: true });
  });

  try {
    await updateDoc(doc(db, "solicitudes", solicitudActivaId), { herramientasEntregadas: lista });
    try {
      await updateDoc(doc(db, "activaHoy", s.matricula), { herramientas: lista });
    } catch (errFicha) { console.error("No se pudo sincronizar activaHoy:", errFicha); }
    s.herramientasEntregadas = lista;
    _entregaAdicionales = {};
    renderReciboEntrega();
    renderEntregaPickerGrid();
    renderTabla();
    document.getElementById("modal-entrega").classList.remove("abierto");
    solicitudActivaId = null;
    mostrarToast("✓ Cambios guardados (aún pendiente de entregar)");
  } catch(e) { console.error("Error al guardar:", e); mostrarToast("Error al guardar: " + e.message, "rojo"); }
};

window.confirmarEntrega = async function() {
  if (!solicitudActivaId) return;
  const s = todasSolicitudes.find(x => x.id === solicitudActivaId);
  if (!s) return;

  const checks = document.querySelectorAll("#lista-entrega input[type='checkbox']");
  const base = (s.herramientasEntregadas && s.herramientasEntregadas.length) ? s.herramientasEntregadas : (s.herramientas || []);
  const herramientasEntregadas = [];
  checks.forEach((chk, i) => {
    if (chk.checked && base[i]) {
      herramientasEntregadas.push({ ...base[i], estadoEntrega: "entregada" });
    }
  });

  Object.entries(_entregaAdicionales).forEach(([nombre, cantidad]) => {
    herramientasEntregadas.push({ nombre, cantidad, adicional: true, estadoEntrega: "entregada" });
  });

  if (herramientasEntregadas.length === 0) {
    mostrarToast("No hay ninguna herramienta seleccionada para guardar", "rojo");
    return;
  }

  try {
    await updateDoc(doc(db, "solicitudes", solicitudActivaId), {
      estado: "entregada",
      entregadoEn: s.entregadoEn || serverTimestamp(),
      herramientasEntregadas
    });
    try {
      await updateDoc(doc(db, "activaHoy", s.matricula), {
        estado: "entregada",
        herramientas: herramientasEntregadas
      });
    } catch (errFicha) { console.error("No se pudo sincronizar activaHoy:", errFicha); }
    const sx = todasSolicitudes.find(x => x.id === solicitudActivaId);
    if (sx) { sx.estado = "entregada"; sx.herramientasEntregadas = herramientasEntregadas; }
    actualizarContadores();
    renderTabla();
    cargarDashboard();
    cerrarModalEntrega();
    mostrarToast("✓ Herramientas entregadas correctamente");
  } catch(e) { console.error("Error al entregar:", e); mostrarToast("Error al entregar: " + e.message, "rojo"); }
};

// ─── MODAL RETORNO ───
window.retornar = function(id) {
  solicitudActivaId = id;
  const s = todasSolicitudes.find(x => x.id === id);
  if (!s) return;

  document.getElementById("info-retorno").innerHTML =
    `<strong>${escapeHtml(s.nombre)} ${escapeHtml(s.apellido)}</strong> · ${escapeHtml(s.matricula)} · ${escapeHtml(s.laboratorio) || ""}`;

  const herramientas = s.herramientasEntregadas || s.herramientas || [];
  const lista = document.getElementById("lista-retorno");
  lista.innerHTML = herramientas.map((h, i) => {
    const gastable = esMaterialGastable(h.nombre);
    return `
    <div class="fila-herramienta">
      <input type="checkbox" id="chk-r-${i}" data-idx="${i}" checked${gastable ? ' disabled' : ''}>
      ${herFotoHtmlPorNombre(h.nombre)}
      <span class="h-nombre">${escapeHtml(h.nombre)}${h.adicional ? ' <span style="font-size:10px;color:var(--azul)">(adicional)</span>' : ""}${gastable ? ' <span class="badge-gastable">🧰 gastable</span>' : ""}</span>
      <span class="h-cant">x${h.cantidad}</span>
      ${gastable
        ? `<span class="select-estado" style="opacity:.65;cursor:not-allowed">🧰 Consumido</span><select id="estado-r-${i}" style="display:none"><option value="retornada" selected>retornada</option></select>`
        : `<select class="select-estado" id="estado-r-${i}">
        <option value="retornada">✅ Retornada</option>
        <option value="dañada">🔴 Dañada</option>
        <option value="no_retornada">⚠️ No retornada</option>
        <option value="perdida">❌ Perdida</option>
      </select>`}
    </div>
  `;
  }).join("") || "<div style='padding:12px;color:var(--texto-dim)'>Sin herramientas</div>";

  herramientas.forEach((h, i) => {
    if (esMaterialGastable(h.nombre)) return;
    const chk = document.getElementById(`chk-r-${i}`);
    const sel = document.getElementById(`estado-r-${i}`);
    if (chk && sel) {
      chk.addEventListener("change", () => {
        if (!chk.checked) sel.value = "no_retornada";
        else if (sel.value === "no_retornada") sel.value = "retornada";
      });
    }
  });

  document.getElementById("btn-toggle-retorno").textContent = "Desmarcar todas ✅";
  document.getElementById("retorno-picker-buscar").value = "";
  renderRetornoPickerGrid();
  document.getElementById("modal-retorno").classList.add("abierto");
};

window.renderRetornoPickerGrid = function() {
  const wrap = document.getElementById("retorno-picker-grid");
  const q = (document.getElementById("retorno-picker-buscar").value || "").toLowerCase();
  const lista = (_herListaActual || []).filter(h => h.nombre.toLowerCase().includes(q));
  if (!lista.length) { wrap.innerHTML = '<div class="vacio" style="grid-column:1/-1"><div class="vacio-icono">🧰</div><p>Sin resultados.</p></div>'; return; }
  wrap.innerHTML = lista.map(h => {
    const fotoUrl = h.fotoUrl || (h.codigo ? '../img/herramientas/' + h.codigo + '.jpg' : '');
    const icono = h.icono || '🔧';
    const foto = fotoUrl
      ? `<img src="${fotoUrl}" onerror="this.parentNode.innerHTML='<span class=\\'her-foto-fallback\\'>${icono}</span>'">`
      : `<span class="her-foto-fallback">${icono}</span>`;
    return `
      <div class="her-card" onclick="retornoPickerAgregar('${escapeAttr(h.nombre)}')" title="Agregar al recibo de retorno">
        <div class="her-foto-wrap">${foto}</div>
        <div class="her-cuerpo"><div class="her-nombre">${escapeHtml(h.nombre)}</div></div>
      </div>`;
  }).join("");
};

window.retornoPickerAgregar = function(nombre) {
  const lista = document.getElementById("lista-retorno");
  if (!lista) return;

  // No duplicar
  const yaExiste = [...lista.querySelectorAll(".h-nombre")].some(el => el.textContent.replace(/\(adicional\)/i,"").trim() === nombre);
  if (yaExiste) { mostrarToast("Ya está en el recibo", "rojo"); return; }

  // Agregar separador ADICIONALES la primera vez
  if (!lista.querySelector(".separador-adicionales")) {
    const sep = document.createElement("div");
    sep.className = "separador-adicionales";
    sep.style.cssText = "display:flex;align-items:center;gap:8px;margin:8px 4px 4px";
    sep.innerHTML = `<div style="flex:1;height:1px;background:var(--borde)"></div>
      <span style="font-size:10px;font-weight:800;color:var(--amarillo);white-space:nowrap">➕ ADICIONALES</span>
      <div style="flex:1;height:1px;background:var(--borde)"></div>`;
    lista.appendChild(sep);
  }

  const idx = lista.querySelectorAll(".fila-herramienta").length;
  const div = document.createElement("div");
  div.className = "fila-herramienta";
  div.dataset.adicional = "1";
  div.innerHTML = `
    <input type="checkbox" id="chk-r-${idx}" data-idx="${idx}" checked>
    <span class="h-nombre">${nombre} <span style="font-size:10px;color:var(--azul)">(adicional)</span></span>
    <span class="h-cant" style="color:var(--verde);font-weight:700">x1</span>
    <select class="select-estado" id="estado-r-${idx}">
      <option value="retornada">✅ Retornada</option>
      <option value="dañada">🔴 Dañada</option>
      <option value="no_retornada">⚠️ No retornada</option>
      <option value="perdida">❌ Perdida</option>
    </select>
    <button onclick="this.closest('.fila-herramienta').remove()" style="background:none;border:none;color:var(--rojo);cursor:pointer;font-size:16px;padding:0 4px">✕</button>
  `;
  lista.appendChild(div);

  // Sincronizar checkbox con select
  const chk = div.querySelector("input[type='checkbox']");
  const sel = div.querySelector("select");
  chk.addEventListener("change", () => {
    if (!chk.checked) sel.value = "no_retornada";
    else if (sel.value === "no_retornada") sel.value = "retornada";
  });

  // Scroll al final para ver la herramienta recién agregada
  lista.scrollTop = lista.scrollHeight;
  mostrarToast(`✓ ${nombre} agregada a la solicitud`);
};

window.toggleMarcarTodasRetorno = function() {
  const checks = [...document.querySelectorAll("#lista-retorno input[type='checkbox']")].filter(c => !c.disabled);
  const todasMarcadas = checks.every(c => c.checked);
  checks.forEach((chk) => {
    chk.checked = !todasMarcadas;
    const i = chk.dataset.idx;
    const sel = document.getElementById(`estado-r-${i}`);
    if (sel && !chk.checked) sel.value = "no_retornada";
    else if (sel && sel.value === "no_retornada") sel.value = "retornada";
  });
  document.getElementById("btn-toggle-retorno").textContent = todasMarcadas ? "Marcar todas ✅" : "Desmarcar todas ✅";
};

window.cerrarModalRetorno = function() {
  document.getElementById("modal-retorno").classList.remove("abierto");
  solicitudActivaId = null;
};

window.cerrarModalRetornoConAviso = async function() {
  const adicionales = document.querySelectorAll("#lista-retorno .fila-herramienta[data-adicional='1']");
  if (adicionales.length > 0) {
    if (!(await confirmarPersonalizado(`Tienes ${adicionales.length} herramienta(s) adicional(es) seleccionada(s). ¿Cerrar sin guardarlas?`))) return;
  }
  cerrarModalRetorno();
};

window.confirmarAdicionalesRetorno = async function() {
  if (!solicitudActivaId) return;
  const s = todasSolicitudes.find(x => x.id === solicitudActivaId);
  if (!s) return;
  const adicionales = [...document.querySelectorAll("#lista-retorno .fila-herramienta[data-adicional='1']")];
  if (!adicionales.length) {
    await confirmarPersonalizado("No hay ninguna herramienta adicional seleccionada para guardar.");
    return;
  }
  const base = (s.herramientasEntregadas && s.herramientasEntregadas.length) ? s.herramientasEntregadas : (s.herramientas || []);
  const nuevas = adicionales.map(f => ({ nombre: f.querySelector(".h-nombre").childNodes[0].textContent.trim(), cantidad: 1, adicional: true, estadoEntrega: "entregada" }));
  const listaFinal = [...base, ...nuevas];
  try {
    await updateDoc(doc(db, "solicitudes", solicitudActivaId), { herramientasEntregadas: listaFinal });
    try { await updateDoc(doc(db, "activaHoy", s.matricula), { herramientas: listaFinal }); } catch(e) {}
    s.herramientasEntregadas = listaFinal;
    // Quitar marcador de adicional para que queden como parte del recibo normal
    adicionales.forEach(f => { delete f.dataset.adicional; });
    mostrarToast(`✅ ${nuevas.length} herramienta(s) adicional(es) entregada(s)`);
  } catch(e) { mostrarToast("Error al guardar adicionales: " + e.message, "rojo"); }
};

window.confirmarRetorno = async function() {
  if (!solicitudActivaId) return;
  const s = todasSolicitudes.find(x => x.id === solicitudActivaId);
  if (!s) return;

  if (!(await confirmarPersonalizado("¿Confirmar el retorno de todas las herramientas de esta solicitud? Esta acción no se puede deshacer."))) {
    return;
  }

  const herramientas = s.herramientasEntregadas || s.herramientas || [];
  const resultado = [];
  const incidencias = [];

  // Leer todas las filas del DOM (incluye adicionales agregadas desde el picker)
  const todasFilas = document.querySelectorAll("#lista-retorno .fila-herramienta");
  todasFilas.forEach((fila, i) => {
    const nombreEl = fila.querySelector(".h-nombre");
    const nombre = nombreEl ? nombreEl.textContent.replace(/\(adicional\)/i,"").trim() : (herramientas[i]?.nombre || "");
    const chk = fila.querySelector("input[type='checkbox']");
    const sel = fila.querySelector("select");
    const estado = sel ? sel.value : (chk?.checked ? "retornada" : "no_retornada");
    const esAdicional = fila.dataset.adicional === "1";
    resultado.push({ nombre, cantidad: 1, adicional: esAdicional, estadoRetorno: estado });
    if (estado !== "retornada") {
      incidencias.push({ herramienta: nombre, tipo: estado });
    }
  });

  try {
    await updateDoc(doc(db, "solicitudes", solicitudActivaId), {
      estado: "retornada",
      retornadoEn: serverTimestamp(),
      herramientasRetorno: resultado,
      tieneIncidencias: incidencias.length > 0
    });
    try {
      await updateDoc(doc(db, "activaHoy", s.matricula), { estado: "retornada" });
    } catch (errFicha) { console.error("No se pudo sincronizar activaHoy:", errFicha); }

    for (const inc of incidencias) {
      await addDoc(collection(db, "incidencias"), {
        matricula: s.matricula,
        nombre: `${s.nombre} ${s.apellido}`,
        herramienta: inc.herramienta,
        tipo: inc.tipo,
        solicitudId: solicitudActivaId,
        fecha: new Date().toLocaleDateString("es-DO"),
        creadoEn: serverTimestamp()
      });
    }

    const sx = todasSolicitudes.find(x => x.id === solicitudActivaId);
    if (sx) { sx.estado = "retornada"; sx.tieneIncidencias = incidencias.length > 0; }
    actualizarContadores();
    renderTabla();
    cargarDashboard();
    cerrarModalRetorno();

    if (incidencias.length > 0) {
      mostrarToast(`↩ Retorno registrado · ${incidencias.length} incidencia(s) registrada(s)`, "rojo");
    } else {
      mostrarToast("↩ Todas las herramientas retornadas correctamente");
    }
  } catch(e) { mostrarToast("Error al registrar retorno", "rojo"); }
};

// ── HERRAMIENTAS LISTA (para buscador de adicionales) ──
// Sincronizada con HERRAMIENTAS_RESPALDO de js/inventario.js: incluye codigo
// e icono para no perderlos al editar una herramienta que aún no está en Firestore.
// NOTA: se dejó el array inline (no import) a propósito — un import local
// aquí bloquea el arranque de TODO el script hasta que esa petición de red
// responde, lo que retrasaba ocultar #pantalla-carga (mismo síntoma que el
// flicker del login que ya se había resuelto antes).
const HERRAMIENTAS_LISTA = [
  { codigo: "HER-001", nombre: "Aceitera",               icono: "🔧",  cantidadDisponible: 5,  categoria: "Insumos" },
  { codigo: "HER-002", nombre: "Alicate",                icono: "🛠️", cantidadDisponible: 5,  categoria: "Sujeción" },
  { codigo: "HER-003", nombre: "Alicate de presión",     icono: "🛠️", cantidadDisponible: 5,  categoria: "Sujeción" },
  { codigo: "HER-004", nombre: "Broca",                  icono: "🔩",  cantidadDisponible: 10, categoria: "Perforación" },
  { codigo: "HER-005", nombre: "Brocha",                 icono: "🖌️", cantidadDisponible: 10, categoria: "Insumos" },
  { codigo: "HER-006", nombre: "Cepillo de alambre",     icono: "🪥",  cantidadDisponible: 5,  categoria: "Acabado" },
  { codigo: "HER-007", nombre: "Cinta adhesiva",         icono: "🎞️", cantidadDisponible: 10, categoria: "Insumos" },
  { codigo: "HER-008", nombre: "Cinta métrica",          icono: "📏",  cantidadDisponible: 5,  categoria: "Medición" },
  { codigo: "HER-009", nombre: "Cuchilla",                icono: "🔪",  cantidadDisponible: 5,  categoria: "Corte" },
  { codigo: "HER-010", nombre: "Destornillador plano",   icono: "🪛",  cantidadDisponible: 8,  categoria: "Sujeción" },
  { codigo: "HER-011", nombre: "Destornillador estrella",icono: "🪛",  cantidadDisponible: 8,  categoria: "Sujeción" },
  { codigo: "HER-012", nombre: "Electrodo",               icono: "⚡",  cantidadDisponible: 20, categoria: "Material Gastable" },
  { codigo: "HER-013", nombre: "Escuadra falsa",          icono: "📐",  cantidadDisponible: 5,  categoria: "Medición" },
  { codigo: "HER-014", nombre: "Gira tuerca",             icono: "🔧",  cantidadDisponible: 5,  categoria: "Sujeción" },
  { codigo: "HER-015", nombre: "Granetero",               icono: "🔨",  cantidadDisponible: 5,  categoria: "Golpe" },
  { codigo: "HER-016", nombre: "Guantes",                 icono: "🧤",  cantidadDisponible: 10, categoria: "Seguridad" },
  { codigo: "HER-017", nombre: "Lente",                   icono: "🥽",  cantidadDisponible: 10, categoria: "Seguridad" },
  { codigo: "HER-018", nombre: "Lima cuadrada",           icono: "🔧",  cantidadDisponible: 5,  categoria: "Acabado" },
  { codigo: "HER-019", nombre: "Lima triangular",         icono: "🔧",  cantidadDisponible: 5,  categoria: "Acabado" },
  { codigo: "HER-020", nombre: "Lima media caña",         icono: "🔧",  cantidadDisponible: 5,  categoria: "Acabado" },
  { codigo: "HER-021", nombre: "Lima redonda",            icono: "🔧",  cantidadDisponible: 5,  categoria: "Acabado" },
  { codigo: "HER-022", nombre: "Llave ajustable",         icono: "🔧",  cantidadDisponible: 5,  categoria: "Sujeción" },
  { codigo: "HER-023", nombre: "Llave allen",             icono: "🔧",  cantidadDisponible: 5,  categoria: "Sujeción" },
  { codigo: "HER-024", nombre: "Llave de mandril",        icono: "🔧",  cantidadDisponible: 5,  categoria: "Sujeción" },
  { codigo: "HER-025", nombre: "Llave de tomo",           icono: "🔧",  cantidadDisponible: 5,  categoria: "Sujeción" },
  { codigo: "HER-026", nombre: "Llave de tuercas",        icono: "🔧",  cantidadDisponible: 5,  categoria: "Sujeción" },
  { codigo: "HER-027", nombre: "Máscara de soldar",       icono: "🥽",  cantidadDisponible: 5,  categoria: "Soldadura" },
  { codigo: "HER-028", nombre: "Marcador numérico",       icono: "🔢",  cantidadDisponible: 5,  categoria: "Insumos" },
  { codigo: "HER-029", nombre: "Martillo",                icono: "🔨",  cantidadDisponible: 8,  categoria: "Golpe" },
  { codigo: "HER-030", nombre: "Mazo de goma",            icono: "🔨",  cantidadDisponible: 5,  categoria: "Golpe" },
  { codigo: "HER-031", nombre: "Macho de 1/2",            icono: "🔧",  cantidadDisponible: 5,  categoria: "Perforación" },
  { codigo: "HER-032", nombre: "Nivel magnético",         icono: "📐",  cantidadDisponible: 5,  categoria: "Medición" },
  { codigo: "HER-033", nombre: "Nivel 90",                icono: "📐",  cantidadDisponible: 5,  categoria: "Medición" },
  { codigo: "HER-034", nombre: "Pie de rey",              icono: "📏",  cantidadDisponible: 5,  categoria: "Medición" },
  { codigo: "HER-035", nombre: "Pinzas",                  icono: "🛠️", cantidadDisponible: 5,  categoria: "Sujeción" },
  { codigo: "HER-036", nombre: "Piqueta",                 icono: "⛏️", cantidadDisponible: 5,  categoria: "Golpe" },
  { codigo: "HER-037", nombre: "Porta broca",             icono: "🔧",  cantidadDisponible: 5,  categoria: "Perforación" },
  { codigo: "HER-038", nombre: "Segueta",                 icono: "🪚",  cantidadDisponible: 5,  categoria: "Corte" },
  { codigo: "HER-039", nombre: "Tarraja de 1/2x13",       icono: "🔧",  cantidadDisponible: 5,  categoria: "Perforación" }
];

// Categorías del inventario: icono + color de acento para chips/etiquetas.
// Los colores son fijos (no ligados a --verde/--azul del tema) porque son
// datos, no elementos de tema — se ven bien tanto en claro como en oscuro.
const CATEGORIAS_HERRAMIENTA = {
  "Medición":         { icono: "📏", color: "#388bfd" },
  "Corte":            { icono: "✂️", color: "#f85149" },
  "Golpe":            { icono: "🔨", color: "#d29922" },
  "Sujeción":         { icono: "🔧", color: "#3fb950" },
  "Perforación":      { icono: "🪛", color: "#a371f7" },
  "Acabado":          { icono: "🧽", color: "#db61a2" },
  "Soldadura":        { icono: "⚡", color: "#ff9800" },
  "Seguridad":        { icono: "🦺", color: "#39c5cf" },
  "Insumos":          { icono: "🧴", color: "#8b949e" },
  "Material Gastable":{ icono: "🧰", color: "#eab308" }
};
// A partir de esta cantidad disponible (inclusive) se marca "stock bajo".
const UMBRAL_STOCK_BAJO = 2;
let herCategoriaActiva = "";

const _herFotoMap = {};

// Lightbox: clic en cualquier foto de herramienta (lista, préstamos, historial)
// la abre en grande. Delegado en document porque estos <img> se generan
// dinámicamente en varios lugares distintos del panel.
document.addEventListener('click', e => {
  const img = e.target.closest('img.foto-zoom');
  if (!img) return;
  document.getElementById('lightbox-img').src = img.src;
  document.getElementById('lightbox-img').alt = img.alt || '';
  document.getElementById('lightbox-herramienta').classList.add('abierto');
});
document.getElementById('lightbox-herramienta')?.addEventListener('click', function() {
  this.classList.remove('abierto');
});

function herFotoHtmlPorNombre(nombre, size = 32) {
  const url = _herFotoMap[nombre?.toLowerCase()];
  const s = size + 'px';
  const r = Math.round(size * 0.17) + 'px';
  if (url) {
    return '<img src="' + url + '" class="foto-zoom"'
      + ' style="width:' + s + ';height:' + s + ';border-radius:' + r + ';object-fit:cover;border:1px solid var(--borde);flex-shrink:0;cursor:zoom-in"'
      + ' onerror="this.style.display=\'none\'">';
  }
  return '<span style="width:' + s + ';height:' + s + ';border-radius:' + r + ';background:var(--card2);border:1px solid var(--borde);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:' + Math.round(size*0.55) + 'px">🔧</span>';
}

window.anular = async function(id) {
  if (!confirm("¿Seguro que deseas anular esta solicitud?")) return;
  try {
    const s = todasSolicitudes.find(x => x.id === id);
    await updateDoc(doc(db, "solicitudes", id), { estado: "cancelada" });
    if (s) {
      try {
        await updateDoc(doc(db, "activaHoy", s.matricula), { estado: "cancelada" });
      } catch (errFicha) { console.error("No se pudo sincronizar activaHoy:", errFicha); }
    }
    mostrarToast("Solicitud anulada");
  } catch(e) { mostrarToast("Error al anular", "rojo"); }
};

// ══════════════════════════════════════════════
// ── PRÉSTAMOS A PROFESORES ──
// ══════════════════════════════════════════════

let todosPrestamosProf = [];
let ppActivoId = null;
let todosPrestamosExt = [];
let extActivoId = null;

let todosPrestamosProfTodos = [];
let todosPrestamosProfVisible = [];
let _ppRetornoNotaObligatoria = false;

let _ppFiltroEstado = "";

async function cargarPrestamosProf() {
  try {
    onSnapshot(query(collection(db, "prestamos_profesores"), orderBy("creadoEn", "desc")), snap => {
      const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
      const todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      todosPrestamosProfTodos = todos;
      todosPrestamosProf = todos.filter(p => {
        if (!p.creadoEn) return false;
        const fecha = p.creadoEn.toDate ? p.creadoEn.toDate() : new Date(p.creadoEn);
        return fecha >= hoy;
      });
      // La tabla muestra los de hoy + cualquier "activo" de días anteriores que
      // nunca se retornó, para que no quede escondido solo por no ser de hoy.
      const idsHoy = new Set(todosPrestamosProf.map(p => p.id));
      const activosAntiguos = todosPrestamosProfTodos.filter(p => p.estado === "activo" && !idsHoy.has(p.id));
      todosPrestamosProfVisible = [...todosPrestamosProf, ...activosAntiguos];
      ppActualizarStats();
      ppRenderTabla();
    });
  } catch(e) {
    document.getElementById("pp-tabla-wrap").innerHTML =
      '<div class="cargando">Error al cargar. Verifica la conexión.</div>';
  }
}

function ppActualizarStats() {
  const activos = todosPrestamosProf.filter(p => p.estado === "activo");
  const conInc  = todosPrestamosProf.filter(p => p.tieneIncidencias);
  const activosTotal = todosPrestamosProfTodos.filter(p => p.estado === "activo").length;
  actualizarBadgeLateral("badge-prestamos-prof", activosTotal);
  const wrap = document.getElementById("pp-stats-strip");
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="her-stat-pill"><span class="her-stat-icono">🟢</span><div><div class="her-stat-num">${activos.length}</div><div class="her-stat-label">Activos hoy</div></div></div>
    <div class="her-stat-pill"><span class="her-stat-icono">📋</span><div><div class="her-stat-num">${todosPrestamosProf.length}</div><div class="her-stat-label">Registrados hoy</div></div></div>
    <div class="her-stat-pill"><span class="her-stat-icono">👨‍🏫</span><div><div class="her-stat-num">${new Set(activos.map(p=>p.profesor)).size}</div><div class="her-stat-label">Profesores con herramientas hoy</div></div></div>
    <div class="her-stat-pill${conInc.length?' alerta':''}"><span class="her-stat-icono">⚠️</span><div><div class="her-stat-num">${conInc.length}</div><div class="her-stat-label">Con incidencias hoy</div></div></div>`;
}

window.ppFiltrarChip = function(estado, el) {
  _ppFiltroEstado = estado;
  document.querySelectorAll("#pp-chips .her-chip").forEach(c => {
    c.classList.remove("activo");
    c.style.background = "var(--card)";
  });
  el.classList.add("activo");
  el.style.background = "var(--card2)";
  ppRenderTabla();
};

function ppFiltrados() {
  const buscar = (document.getElementById("pp-buscar")?.value || "").toLowerCase();
  return todosPrestamosProfVisible.filter(p => {
    const matchBuscar = !buscar || (p.profesor || "").toLowerCase().includes(buscar);
    const matchEstado = !_ppFiltroEstado || p.estado === _ppFiltroEstado;
    return matchBuscar && matchEstado;
  });
}

window.marcarIncidenciaVistaPP = async function(id) {
  try {
    await updateDoc(doc(db, "prestamos_profesores", id), { incidenciaVista: true });
    cargarDashboard(); // refresca el badge lateral de inmediato
  } catch (e) { console.error(e); }
};

function ppRenderTabla() {
  const lista = ppFiltrados();
  const wrap  = document.getElementById("pp-tabla-wrap");
  if (!lista.length) {
    wrap.innerHTML = '<div class="vacio"><div class="vacio-icono">📭</div><p>No hay préstamos registrados hoy ni activos pendientes de retorno.</p></div>';
    return;
  }
  wrap.innerHTML = lista.map(p => {
    const fechaObj = p.creadoEn?.toDate ? p.creadoEn.toDate() : (p.creadoEn ? new Date(p.creadoEn) : null);
    const esDeHoy = fechaObj && esMismodia(p.creadoEn);
    const fecha = fechaObj
      ? (esDeHoy ? fechaObj.toLocaleTimeString("es-DO", {hour:"2-digit",minute:"2-digit"})
                 : fechaObj.toLocaleDateString("es-DO", {day:"2-digit",month:"short"}) + ' · ' + fechaObj.toLocaleTimeString("es-DO", {hour:"2-digit",minute:"2-digit"}))
      : "—";
    const color = colorEstudiante(p.profesor || "");
    const ini   = (p.profesor || "P")[0].toUpperCase();
    const herramientasHtml = (p.herramientas || []).map(h => `<b>${escapeHtml(h.nombre)}</b> ×${h.cantidad}${h.adicional ? ' <span style="background:var(--azul);color:#fff;font-size:9px;font-weight:800;padding:1px 5px;border-radius:20px">+ADIC</span>' : ''}`).join(", ") || "—";
    const estadoTag = p.estado === "activo"
      ? `<span class="pp-estado-tag" style="background:var(--verde-glow);color:var(--verde)">🟢 Activo</span>`
      : `<span class="pp-estado-tag" style="background:var(--card2);color:var(--texto-dim)">⚪ Retornado</span>`;
    const acciones = p.estado === "activo"
      ? (esDeHoy
          ? `<button class="btn btn-outline" onclick="abrirAdicionalPP('${p.id}')" title="Agregar una herramienta adicional a este préstamo">➕ Adicional</button><button class="btn btn-azul" onclick="abrirRetornoProf('${p.id}')" title="Registrar el retorno de las herramientas">↩ Retornar</button>`
          : `<button class="btn btn-azul" onclick="abrirRetornoProf('${p.id}')" title="Revisar y registrar el retorno de un préstamo anterior">🔍 Revisar y retornar</button>`)
      : `<span style="font-size:11px;color:var(--verde);font-weight:700">✅ Completado</span>`;
    return `
      <div class="pp-card${p.tieneIncidencias ? ' con-incidencia' : ''}">
        <div class="pp-card-top">
          <div class="pp-avatar" style="background:${color}22;color:${color}">${ini}</div>
          <div>
            <div class="pp-nombre">${escapeHtml(p.profesor) || "—"}</div>
            <div class="pp-lab">${escapeHtml(p.laboratorio) || "—"}</div>
          </div>
          ${estadoTag}
          ${(p.estado === "activo" && !esDeHoy) ? '<span class="pp-estado-tag" style="background:rgba(210,153,34,.15);color:var(--amarillo)" title="Sin retornar desde un día anterior">⏳ Sin retornar</span>' : ''}
        </div>
        <div class="pp-herr-list">${herramientasHtml}</div>
        <div class="pp-fecha-row">🕒 ${fecha}${p.tieneIncidencias ? ` · <span style="color:var(--rojo)">⚠️ con incidencia</span>${!p.incidenciaVista ? ` <button onclick="marcarIncidenciaVistaPP('${p.id}')" style="background:none;border:none;color:var(--azul);font-size:10px;cursor:pointer;text-decoration:underline">marcar vista</button>` : ''}` : ''}</div>
        <div class="pp-acciones">${acciones}</div>
      </div>`;
  }).join("");
}

["pp-buscar"].forEach(id => {
  document.getElementById(id)?.addEventListener("input",  ppRenderTabla);
});

// ── MODAL NUEVO PRÉSTAMO ──
const PROFESORES_PP = [
  "Daniel Camejo","José Peña","Julio Durán","Víctor Félix"
];
const LABORATORIOS_PP = [
  "Taller mecánica básica","Lab. ciencia de los materiales","Máquinas especiales",
  "Taller de procesos industriales","Taller de soldadura",
  "Taller máquinas y herramientas I","Taller máquinas y herramientas II"
];

function ppPoblarSelects() {
  const selProf = document.getElementById("pp-select-profesor");
  const selLab  = document.getElementById("pp-select-laboratorio");

  selProf.innerHTML = '<option value="">Selecciona un profesor</option>';
  getDocs(collection(db, "profesores")).then(snap => {
    const activos = snap.docs.map(d => d.data()).filter(p => !p.eliminado).sort((a,b) => a.nombre.localeCompare(b.nombre));
    const lista = activos.length > 0 ? activos.map(p => p.nombre) : PROFESORES_PP;
    selProf.innerHTML = '<option value="">Selecciona un profesor</option>';
    lista.forEach(p => { const o = document.createElement("option"); o.value = o.textContent = p; selProf.appendChild(o); });
  }).catch(() => {
    PROFESORES_PP.forEach(p => { const o = document.createElement("option"); o.value = o.textContent = p; selProf.appendChild(o); });
  });

  selLab.innerHTML = '<option value="">Selecciona un laboratorio</option>';
  getDocs(collection(db, "laboratorios")).then(snap => {
    const lista = !snap.empty ? snap.docs.map(d => d.data().nombre) : LABORATORIOS_PP;
    selLab.innerHTML = '<option value="">Selecciona un laboratorio</option>';
    lista.forEach(l => { const o = document.createElement("option"); o.value = o.textContent = l; selLab.appendChild(o); });
  }).catch(() => {
    LABORATORIOS_PP.forEach(l => { const o = document.createElement("option"); o.value = o.textContent = l; selLab.appendChild(o); });
  });
}

let _ppNuevoCant = {};

window.abrirModalNuevoPrestamoProf = function() {
  ppPoblarSelects();
  _ppNuevoCant = {};
  document.getElementById("pp-picker-buscar-inline").value = "";
  renderPPPickerGridInline();
  renderPPReciboInline();
  document.getElementById("modal-nuevo-pp").classList.add("abierto");
};

window.renderPPPickerGridInline = function() {
  const wrap = document.getElementById("pp-picker-grid-inline");
  const q = (document.getElementById("pp-picker-buscar-inline").value || "").toLowerCase();
  const lista = (_herListaActual || []).filter(h => h.nombre.toLowerCase().includes(q));
  if (!lista.length) { wrap.innerHTML = '<div class="vacio" style="grid-column:1/-1"><div class="vacio-icono">🧰</div><p>Sin resultados.</p></div>'; return; }
  wrap.innerHTML = lista.map(h => {
    const fotoUrl = h.fotoUrl || (h.codigo ? '../img/herramientas/' + h.codigo + '.jpg' : '');
    const icono = h.icono || '🔧';
    const foto = fotoUrl
      ? `<img src="${fotoUrl}" onerror="this.parentNode.innerHTML='<span class=\\'her-foto-fallback\\'>${icono}</span>'">`
      : `<span class="her-foto-fallback">${icono}</span>`;
    const enRecibo = _ppNuevoCant[h.nombre] || 0;
    return `
      <div class="her-card" onclick="ppNuevoAgregar('${escapeAttr(h.nombre)}')" title="Agregar al recibo">
        <div class="her-foto-wrap">${foto}${enRecibo > 0 ? `<span class="her-ribbon popular">x${enRecibo}</span>` : ""}</div>
        <div class="her-cuerpo"><div class="her-nombre">${escapeHtml(h.nombre)}</div></div>
      </div>`;
  }).join("");
};

window.ppNuevoAgregar = function(nombre) {
  _ppNuevoCant[nombre] = (_ppNuevoCant[nombre] || 0) + 1;
  renderPPReciboInline(); renderPPPickerGridInline();
};
window.ppNuevoAjustar = function(nombre, delta) {
  const nuevo = (_ppNuevoCant[nombre] || 0) + delta;
  if (nuevo <= 0) delete _ppNuevoCant[nombre]; else _ppNuevoCant[nombre] = nuevo;
  renderPPReciboInline(); renderPPPickerGridInline();
};
window.ppNuevoQuitar = function(nombre) {
  delete _ppNuevoCant[nombre];
  renderPPReciboInline(); renderPPPickerGridInline();
};
function renderPPReciboInline() {
  const lista = document.getElementById("pp-lista-herramientas");
  const entradas = Object.entries(_ppNuevoCant);
  lista.innerHTML = entradas.length ? entradas.map(([nombre, cant]) => `
    <div class="fila-herramienta">
      ${herFotoHtmlPorNombre(nombre)}
      <span class="h-nombre">${escapeHtml(nombre)}</span>
      <button type="button" class="btn btn-outline" onclick="ppNuevoAjustar('${escapeAttr(nombre)}',-1)" style="padding:2px 8px">−</button>
      <span class="h-cant">x${cant}</span>
      <button type="button" class="btn btn-outline" onclick="ppNuevoAjustar('${escapeAttr(nombre)}',1)" style="padding:2px 8px">+</button>
      <button type="button" class="btn btn-rojo" onclick="ppNuevoQuitar('${escapeAttr(nombre)}')" style="padding:2px 8px">✕</button>
    </div>`).join("") : "<div style='padding:12px;color:var(--texto-dim)'>Sin herramientas agregadas todavía</div>";
}

window.cerrarModalNuevoProf = function() {
  document.getElementById("modal-nuevo-pp").classList.remove("abierto");
};

window.ppAgregarFila = function() {
  const contenedor = document.getElementById("pp-lista-herramientas");
  const idx = contenedor.children.length;
  const div = document.createElement("div");
  div.dataset.filaHerramienta = "1";
  div.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:8px;position:relative";
  div.innerHTML = `
    <div style="flex:1;position:relative">
      <input type="text" placeholder="Herramienta..." autocomplete="off"
        style="width:100%;padding:8px 10px;background:var(--card2);border:1px solid var(--borde);border-radius:7px;color:var(--texto);font-size:13px"
        oninput="ppFiltrarDropdown(this)" onfocus="ppFiltrarDropdown(this)" onblur="setTimeout(()=>this.parentNode.querySelector('.pp-drop').style.display='none',150)">
      <div class="pp-drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--card2);border:1px solid var(--borde);border-radius:7px;z-index:200;max-height:220px;min-height:110px;overflow-y:auto;margin-top:4px;box-shadow:0 4px 12px rgba(0,0,0,0.3)"></div>
    </div>
    <input type="number" min="1" value="1" placeholder="Cant."
      style="width:70px;padding:8px 10px;background:var(--card2);border:1px solid var(--borde);border-radius:7px;color:var(--texto);font-size:13px">
    <button type="button" onclick="this.parentNode.remove()" style="background:rgba(239,68,68,0.15);color:var(--rojo);border:none;border-radius:7px;padding:6px 10px;cursor:pointer;font-size:14px">✕</button>`;
  contenedor.appendChild(div);
};

window.ppFiltrarDropdown = function(input) {
  const q    = input.value.toLowerCase();
  const drop = input.parentNode.querySelector(".pp-drop");
  const hits = _herListaActual.filter(h => h.nombre.toLowerCase().includes(q)).slice(0, 8);
  if (!hits.length || !q) { drop.style.display = "none"; return; }
  drop.innerHTML = hits.map(h =>
    `<div onmousedown="event.preventDefault();ppSeleccionarHerramienta(this,'${escapeAttr(h.nombre)}')"
      style="padding:8px 12px;cursor:pointer;font-size:13px"
      onmouseover="this.style.background='var(--hover)'" onmouseout="this.style.background=''">${escapeHtml(h.nombre)}</div>`
  ).join("");
  drop.style.display = "block";
};

window.ppSeleccionarHerramienta = function(item, nombre) {
  const drop  = item.parentNode;
  const input = drop.previousElementSibling;
  input.value = nombre;
  drop.style.display = "none";
  input.blur();
};

// ── Selector visual con fotos para "Nuevo préstamo a profesor" ──
let _ppPickerCant = {};
let _ppPickerModo = "nuevo"; // "nuevo" | "adicional"
let _ppPickerPrestamoId = null;

window.abrirPickerFotosPP = function() {
  _ppPickerModo = "nuevo";
  _ppPickerPrestamoId = null;
  _ppPickerCant = {};
  document.getElementById("pp-picker-titulo").textContent = "📷 Elegir herramientas";
  document.getElementById("pp-picker-buscar").value = "";
  renderPickerFotosPP();
  document.getElementById("modal-pp-fotos").classList.add("abierto");
};

window.abrirAdicionalPP = function(prestamoId) {
  _ppPickerModo = "adicional";
  _ppPickerPrestamoId = prestamoId;
  _ppPickerCant = {};
  document.getElementById("pp-picker-titulo").textContent = "➕ Agregar herramientas adicionales";
  document.getElementById("pp-picker-buscar").value = "";
  renderPickerFotosPP();
  document.getElementById("modal-pp-fotos").classList.add("abierto");
};

window.cerrarPickerFotosPP = function() {
  document.getElementById("modal-pp-fotos").classList.remove("abierto");
};

function renderPickerFotosPP() {
  const wrap = document.getElementById("pp-picker-grid");
  const q = (document.getElementById("pp-picker-buscar").value || "").toLowerCase();
  const lista = _herListaActual.filter(h => h.nombre.toLowerCase().includes(q));
  if (!lista.length) {
    wrap.innerHTML = '<div class="vacio" style="grid-column:1/-1"><div class="vacio-icono">🔧</div><p>Sin resultados.</p></div>';
    return;
  }
  wrap.innerHTML = lista.map(h => {
    const fotoUrl = h.fotoUrl || (h.codigo ? '../img/herramientas/' + h.codigo + '.jpg' : '');
    const icono = h.icono || '🔧';
    const foto = fotoUrl
      ? `<img src="${fotoUrl}" onerror="this.parentNode.innerHTML='<span class=\\'her-foto-fallback\\'>${icono}</span>'">`
      : `<span class="her-foto-fallback">${icono}</span>`;
    const cant = _ppPickerCant[h.nombre] || 0;
    const nombreEsc = escapeAttr(h.nombre);
    return `
      <div class="her-card${cant > 0 ? ' stock-bajo' : ''}">
        <div class="her-foto-wrap">${foto}</div>
        <div class="her-cuerpo">
          <div class="her-nombre">${escapeHtml(h.nombre)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
            <button type="button" onclick="ppPickerAjustar('${nombreEsc}',-1)" class="btn btn-outline" style="padding:4px 10px;flex:1">−</button>
            <span style="min-width:18px;text-align:center;font-weight:700">${cant}</span>
            <button type="button" onclick="ppPickerAjustar('${nombreEsc}',1)" class="btn btn-outline" style="padding:4px 10px;flex:1">+</button>
          </div>
        </div>
      </div>`;
  }).join("");
}

window.ppPickerAjustar = function(nombre, delta) {
  const actual = _ppPickerCant[nombre] || 0;
  const nuevo = Math.max(0, actual + delta);
  if (nuevo === 0) delete _ppPickerCant[nombre];
  else _ppPickerCant[nombre] = nuevo;
  renderPickerFotosPP();
};

window.confirmarPickerFotosPP = async function() {
  const seleccion = Object.entries(_ppPickerCant);
  if (!seleccion.length) { mostrarToast("Elige al menos una herramienta", "rojo"); return; }

  if (_ppPickerModo === "adicional") {
    try {
      const ref = doc(db, "prestamos_profesores", _ppPickerPrestamoId);
      const snap = await getDoc(ref);
      const existentes = snap.data()?.herramientas || [];
      const mapa = {};
      existentes.forEach(h => { mapa[h.nombre] = { ...h }; });
      seleccion.forEach(([nombre, cantidad]) => {
        if (mapa[nombre]) { mapa[nombre].cantidad = (mapa[nombre].cantidad || 0) + cantidad; mapa[nombre].adicional = true; }
        else { mapa[nombre] = { nombre, cantidad, adicional: true }; }
      });
      await updateDoc(ref, { herramientas: Object.values(mapa) });
      mostrarToast("✅ Herramientas adicionales agregadas al préstamo");
    } catch (e) {
      console.error(e);
      mostrarToast("Error al agregar herramientas", "rojo");
    }
    cerrarPickerFotosPP();
    return;
  }

  const contenedor = document.getElementById("pp-lista-herramientas");
  seleccion.forEach(([nombre, cantidad]) => {
    ppAgregarFila();
    const filas = contenedor.querySelectorAll("div[data-fila-herramienta]");
    const ultima = filas[filas.length - 1];
    ultima.querySelector('input[type="text"]').value = nombre;
    ultima.querySelector('input[type="number"]').value = cantidad;
  });

  cerrarPickerFotosPP();
};

window.confirmarNuevoPrestamoProf = async function() {
  const profesor    = document.getElementById("pp-select-profesor").value.trim();
  const laboratorio = document.getElementById("pp-select-laboratorio").value.trim();
  if (!profesor)    { mostrarToast("Selecciona un profesor", "rojo"); return; }
  if (!laboratorio) { mostrarToast("Selecciona un laboratorio", "rojo"); return; }

  const herramientas = Object.entries(_ppNuevoCant).map(([nombre, cantidad]) => ({ nombre, cantidad }));
  if (!herramientas.length) { mostrarToast("Agrega al menos una herramienta", "rojo"); return; }

  const btn = document.getElementById("pp-btn-confirmar");
  btn.disabled = true; btn.textContent = "Guardando...";
  try {
    await addDoc(collection(db, "prestamos_profesores"), {
      profesor, laboratorio, herramientas,
      estado: "activo",
      tieneIncidencias: false,
      creadoEn: serverTimestamp()
    });
    mostrarToast("✅ Préstamo registrado correctamente");
    registrarAuditoria("prestamo", "entregar", `Entregó ${herramientas.length} herramienta(s) al profesor "${profesor}" (${laboratorio})`);
    cerrarModalNuevoProf();
  } catch(e) {
    mostrarToast("Error al guardar. Verifica la conexión.", "rojo");
  } finally {
    btn.disabled = false; btn.textContent = "✅ Registrar entrega";
  }
};

// ── MODAL RETORNO PROFESOR ──
window.abrirRetornoProf = function(id) {
  ppActivoId = id;
  const p = (todosPrestamosProfTodos || todosPrestamosProf).find(x => x.id === id);
  if (!p) return;
  document.getElementById("pp-retorno-nombre").textContent = p.profesor;

  const fechaObj = p.creadoEn?.toDate ? p.creadoEn.toDate() : (p.creadoEn ? new Date(p.creadoEn) : null);
  const esAtrasado = fechaObj && !esMismodia(p.creadoEn);
  _ppRetornoNotaObligatoria = !!esAtrasado;
  document.getElementById("pp-retorno-nota").value = "";
  document.getElementById("pp-retorno-nota-hint").textContent = esAtrasado
    ? "— obligatoria: es un préstamo de días atrás, explica qué pasó"
    : "(opcional)";

  const lista = document.getElementById("pp-retorno-lista");
  lista.innerHTML = (p.herramientas || []).map((h, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--borde);gap:10px">
      <span style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600">${herFotoHtmlPorNombre(h.nombre)}${escapeHtml(h.nombre)} <span style="color:var(--texto-dim);font-weight:400">×${h.cantidad}</span></span>
      <select id="pp-estado-r-${i}"
        style="padding:6px 10px;background:var(--bg);border:1px solid var(--borde);border-radius:7px;color:var(--texto);font-size:12px">
        <option value="retornada">✅ Retornada</option>
        <option value="danada">⚠️ Dañada</option>
        <option value="perdida">❌ Perdida</option>
      </select>
    </div>`).join("") || '<p style="color:var(--texto-dim);font-size:13px">Sin herramientas registradas.</p>';
  document.getElementById("pp-retorno-picker-buscar").value = "";
  renderPPRetornoPickerGrid();
  document.getElementById("modal-retorno-pp").classList.add("abierto");
};

window.renderPPRetornoPickerGrid = function() {
  const wrap = document.getElementById("pp-retorno-picker-grid");
  const q = (document.getElementById("pp-retorno-picker-buscar").value || "").toLowerCase();
  const lista = (_herListaActual || []).filter(h => h.nombre.toLowerCase().includes(q));
  if (!lista.length) { wrap.innerHTML = '<div class="vacio" style="grid-column:1/-1"><div class="vacio-icono">🧰</div><p>Sin resultados.</p></div>'; return; }
  wrap.innerHTML = lista.map(h => {
    const fotoUrl = h.fotoUrl || (h.codigo ? '../img/herramientas/' + h.codigo + '.jpg' : '');
    const icono = h.icono || '🔧';
    const foto = fotoUrl
      ? `<img src="${fotoUrl}" onerror="this.parentNode.innerHTML='<span class=\\'her-foto-fallback\\'>${icono}</span>'">`
      : `<span class="her-foto-fallback">${icono}</span>`;
    return `
      <div class="her-card" onclick="ppRetornoAgregarAdicional('${escapeAttr(h.nombre)}')" title="Agregar al retorno">
        <div class="her-foto-wrap">${foto}</div>
        <div class="her-cuerpo"><div class="her-nombre">${escapeHtml(h.nombre)}</div></div>
      </div>`;
  }).join("");
};

window.ppRetornoAgregarAdicional = async function(nombre) {
  if (!ppActivoId) return;
  try {
    const ref = doc(db, "prestamos_profesores", ppActivoId);
    const snap = await getDoc(ref);
    const existentes = snap.data()?.herramientas || [];
    existentes.push({ nombre, cantidad: 1, adicional: true });
    await updateDoc(ref, { herramientas: existentes });
    mostrarToast("✓ Herramienta agregada");
    abrirRetornoProf(ppActivoId);
  } catch(e) { mostrarToast("Error al agregar: " + e.message, "rojo"); }
};

window.cerrarModalRetornoProf = function() {
  document.getElementById("modal-retorno-pp").classList.remove("abierto");
  ppActivoId = null;
};

window.confirmarRetornoProf = async function() {
  if (!ppActivoId) return;
  const p = (todosPrestamosProfTodos || todosPrestamosProf).find(x => x.id === ppActivoId);
  if (!p) return;

  const nota = document.getElementById("pp-retorno-nota").value.trim();
  if (_ppRetornoNotaObligatoria && !nota) {
    mostrarToast("Este préstamo es de días atrás — escribe una nota explicando qué pasó", "rojo");
    return;
  }

  const herramientas = p.herramientas || [];
  const resultado    = [];
  const incidencias  = [];

  herramientas.forEach((h, i) => {
    const estado = document.getElementById(`pp-estado-r-${i}`)?.value || "retornada";
    resultado.push({ ...h, estadoRetorno: estado });
    if (estado !== "retornada") incidencias.push({ herramienta: h.nombre, tipo: estado });
  });

  try {
    await updateDoc(doc(db, "prestamos_profesores", ppActivoId), {
      estado: "retornado",
      tieneIncidencias: incidencias.length > 0,
      retornadoEn: serverTimestamp(),
      herramientasRetorno: resultado,
      notaRetorno: nota || null
    });

    for (const inc of incidencias) {
      await addDoc(collection(db, "incidencias"), {
        tipo_prestamo: "profesor",
        nombre: p.profesor,
        herramienta: inc.herramienta,
        tipoIncidencia: inc.tipo,
        prestamoId: ppActivoId,
        fecha: new Date().toLocaleDateString("es-DO"),
        creadoEn: serverTimestamp()
      });
    }

    cerrarModalRetornoProf();
    registrarAuditoria("prestamo", "retornar", `Registró retorno del préstamo de "${p.profesor}"${incidencias.length ? " con incidencia" : ""}`);
    if (incidencias.length > 0) {
      mostrarToast(`↩ Retorno registrado · ${incidencias.length} incidencia(s)`, "rojo");
    } else {
      mostrarToast("↩ Retorno registrado correctamente");
    }

    const panel = document.getElementById("panel-incidencias-prof");
    if (panel && panel.style.display === "block") {
      verIncidencias();
    }
  } catch(e) {
    mostrarToast("Error al registrar retorno", "rojo");
  }
};

document.getElementById("modal-nuevo-pp").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-nuevo-pp")) cerrarModalNuevoProf();
});
document.getElementById("modal-retorno-pp").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-retorno-pp")) cerrarModalRetornoProf();
});

// ══════════════════════════════════════════════
// ── HERRAMIENTAS PRESTADAS (OTROS DEPARTAMENTOS) ──
// ══════════════════════════════════════════════

async function cargarPrestamosExternos() {
  try {
    onSnapshot(query(collection(db, "prestamos_externos"), orderBy("creadoEn", "desc")), snap => {
      todosPrestamosExt = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      actualizarBadgeLateral("badge-prestadas", todosPrestamosExt.filter(p => p.estado === "prestado").length);
      extRenderTabla();
    });
  } catch(e) {
    document.getElementById("ext-tabla-wrap").innerHTML =
      '<div class="cargando">Error al cargar. Verifica la conexión.</div>';
  }
}

function extFiltrados() {
  const buscar = (document.getElementById("ext-buscar")?.value || "").toLowerCase();
  const estado = document.getElementById("ext-filtro-estado")?.value || "";
  return todosPrestamosExt.filter(p => {
    const matchBuscar = !buscar || (p.departamento || "").toLowerCase().includes(buscar);
    const matchEstado = !estado || p.estado === estado;
    return matchBuscar && matchEstado;
  });
}

function extRenderTabla() {
  const lista = extFiltrados();
  const wrap  = document.getElementById("ext-tabla-wrap");
  if (!lista.length) {
    wrap.innerHTML = '<div class="vacio" style="padding:40px;text-align:center;color:var(--texto-dim)">📭 No hay herramientas prestadas a otros departamentos.</div>';
    return;
  }
  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Departamento</th>
          <th>Responsable</th>
          <th>Herramientas</th>
          <th>Fecha</th>
          <th>Estado</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody>
        ${lista.map(p => {
          const fecha = p.creadoEn?.toDate ? p.creadoEn.toDate().toLocaleString("es-DO") : "—";
          const color = colorEstudiante(p.departamento || "");
          const ini   = (p.departamento || "D")[0].toUpperCase();
          const herramientasTexto = (p.herramientas || []).map(h => `${escapeHtml(h.nombre)} ×${h.cantidad}`).join(", ") || "—";
          const badgeEstado = p.estado === "prestado"
            ? '<span class="badge badge-entregada">Prestado</span>'
            : p.tieneIncidencias
              ? '<span class="badge badge-cancelada">Con incidencias</span>'
              : '<span class="badge badge-retornada">Devuelto</span>';
          const acciones = p.estado === "prestado"
            ? `<button class="btn btn-azul" onclick="abrirRetornoExt('${p.id}')" title="Registrar el retorno de las herramientas">↩ Retornar</button> <button class="btn btn-outline" onclick="generarConduce('${p.id}')" title="Generar el conduce de salida imprimible">📄 Conduce</button>`
            : `<span style="font-size:11px;color:var(--verde);font-weight:700">✅ Completada</span> <button class="btn btn-outline" onclick="generarConduce('${p.id}')" title="Generar el conduce de salida imprimible">📄 Conduce</button>`;
          return `
            <tr>
              <td>
                <div class="est-avatar">
                  <div class="est-circulo" style="background:${color};color:#fff">${ini}</div>
                  <div class="est-nombre">${p.departamento || "—"}</div>
                </div>
              </td>
              <td style="font-size:13px">${p.responsable || "—"}</td>
              <td style="font-size:12px;color:var(--texto-dim);max-width:200px">${herramientasTexto}</td>
              <td style="font-size:12px;color:var(--texto-dim)">${fecha}</td>
              <td>${badgeEstado}</td>
              <td><div style="display:flex;gap:6px;flex-wrap:wrap">${acciones}</div></td>
            </tr>`;
        }).join("")}
      </tbody>
    </table>`;
}

["ext-buscar","ext-filtro-estado"].forEach(id => {
  document.getElementById(id)?.addEventListener("input",  extRenderTabla);
  document.getElementById(id)?.addEventListener("change", extRenderTabla);
});

let _extNuevoCant = {};

window.abrirModalNuevoPrestamoExt = function() {
  document.getElementById("ext-departamento").value = "";
  document.getElementById("ext-responsable").value = "";
  _extNuevoCant = {};
  document.getElementById("ext-picker-buscar").value = "";
  renderExtPickerGrid();
  renderExtReciboInline();
  document.getElementById("modal-nuevo-ext").classList.add("abierto");
};

window.renderExtPickerGrid = function() {
  const wrap = document.getElementById("ext-picker-grid");
  const q = (document.getElementById("ext-picker-buscar").value || "").toLowerCase();
  const lista = (_herListaActual || []).filter(h => h.nombre.toLowerCase().includes(q));
  if (!lista.length) { wrap.innerHTML = '<div class="vacio" style="grid-column:1/-1"><div class="vacio-icono">🧰</div><p>Sin resultados.</p></div>'; return; }
  wrap.innerHTML = lista.map(h => {
    const fotoUrl = h.fotoUrl || (h.codigo ? '../img/herramientas/' + h.codigo + '.jpg' : '');
    const icono = h.icono || '🔧';
    const foto = fotoUrl
      ? `<img src="${fotoUrl}" onerror="this.parentNode.innerHTML='<span class=\\'her-foto-fallback\\'>${icono}</span>'">`
      : `<span class="her-foto-fallback">${icono}</span>`;
    const enRecibo = _extNuevoCant[h.nombre] || 0;
    return `
      <div class="her-card" onclick="extNuevoAgregar('${escapeAttr(h.nombre)}')" title="Agregar al recibo">
        <div class="her-foto-wrap">${foto}${enRecibo > 0 ? `<span class="her-ribbon popular">x${enRecibo}</span>` : ""}</div>
        <div class="her-cuerpo"><div class="her-nombre">${escapeHtml(h.nombre)}</div></div>
      </div>`;
  }).join("");
};

window.extNuevoAgregar = function(nombre) {
  _extNuevoCant[nombre] = (_extNuevoCant[nombre] || 0) + 1;
  renderExtReciboInline(); renderExtPickerGrid();
};
window.extNuevoAjustar = function(nombre, delta) {
  const nuevo = (_extNuevoCant[nombre] || 0) + delta;
  if (nuevo <= 0) delete _extNuevoCant[nombre]; else _extNuevoCant[nombre] = nuevo;
  renderExtReciboInline(); renderExtPickerGrid();
};
window.extNuevoQuitar = function(nombre) {
  delete _extNuevoCant[nombre];
  renderExtReciboInline(); renderExtPickerGrid();
};
function renderExtReciboInline() {
  const lista = document.getElementById("ext-lista-herramientas");
  const entradas = Object.entries(_extNuevoCant);
  lista.innerHTML = entradas.length ? entradas.map(([nombre, cant]) => `
    <div class="fila-herramienta">
      ${herFotoHtmlPorNombre(nombre)}
      <span class="h-nombre">${escapeHtml(nombre)}</span>
      <button type="button" class="btn btn-outline" onclick="extNuevoAjustar('${escapeAttr(nombre)}',-1)" style="padding:2px 8px">−</button>
      <span class="h-cant">x${cant}</span>
      <button type="button" class="btn btn-outline" onclick="extNuevoAjustar('${escapeAttr(nombre)}',1)" style="padding:2px 8px">+</button>
      <button type="button" class="btn btn-rojo" onclick="extNuevoQuitar('${escapeAttr(nombre)}')" style="padding:2px 8px">✕</button>
    </div>`).join("") : "<div style='padding:12px;color:var(--texto-dim)'>Sin herramientas agregadas todavía</div>";
}

window.cerrarModalNuevoExt = function() {
  document.getElementById("modal-nuevo-ext").classList.remove("abierto");
};

window.extAgregarFila = function() {
  const contenedor = document.getElementById("ext-lista-herramientas");
  const div = document.createElement("div");
  div.dataset.filaHerramienta = "1";
  div.style.cssText = "display:flex;gap:8px;align-items:center;margin-bottom:8px;position:relative";
  div.innerHTML = `
    <div style="flex:1;position:relative">
      <input type="text" placeholder="Herramienta..." autocomplete="off"
        style="width:100%;padding:8px 10px;background:var(--card2);border:1px solid var(--borde);border-radius:7px;color:var(--texto);font-size:13px"
        oninput="extFiltrarDropdown(this)" onfocus="extFiltrarDropdown(this)" onblur="setTimeout(()=>this.parentNode.querySelector('.ext-drop').style.display='none',150)">
      <div class="ext-drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--card2);border:1px solid var(--borde);border-radius:7px;z-index:200;max-height:220px;min-height:110px;overflow-y:auto;margin-top:4px;box-shadow:0 4px 12px rgba(0,0,0,0.3)"></div>
    </div>
    <input type="number" min="1" value="1" placeholder="Cant."
      style="width:70px;padding:8px 10px;background:var(--card2);border:1px solid var(--borde);border-radius:7px;color:var(--texto);font-size:13px">
    <button type="button" onclick="this.parentNode.remove()" style="background:rgba(239,68,68,0.15);color:var(--rojo);border:none;border-radius:7px;padding:6px 10px;cursor:pointer;font-size:14px">✕</button>`;
  contenedor.appendChild(div);
};

window.extFiltrarDropdown = function(input) {
  const q    = input.value.toLowerCase();
  const drop = input.parentNode.querySelector(".ext-drop");
  const hits = _herListaActual.filter(h => h.nombre.toLowerCase().includes(q)).slice(0, 8);
  if (!hits.length || !q) { drop.style.display = "none"; return; }
  drop.innerHTML = hits.map(h =>
    `<div onmousedown="event.preventDefault();extSeleccionarHerramienta(this,'${escapeAttr(h.nombre)}')"
      style="padding:8px 12px;cursor:pointer;font-size:13px"
      onmouseover="this.style.background='var(--hover)'" onmouseout="this.style.background=''">${escapeHtml(h.nombre)}</div>`
  ).join("");
  drop.style.display = "block";
};

window.extSeleccionarHerramienta = function(item, nombre) {
  const drop  = item.parentNode;
  const input = drop.previousElementSibling;
  input.value = nombre;
  drop.style.display = "none";
  input.blur();
};

window.confirmarNuevoPrestamoExt = async function() {
  const departamento = document.getElementById("ext-departamento").value.trim();
  const responsable  = document.getElementById("ext-responsable").value.trim();
  if (!departamento) { mostrarToast("Escribe el departamento", "rojo"); return; }
  if (!responsable)  { mostrarToast("Escribe el responsable", "rojo"); return; }

  const herramientas = Object.entries(_extNuevoCant).map(([nombre, cantidad]) => ({ nombre, cantidad }));
  if (!herramientas.length) { mostrarToast("Agrega al menos una herramienta", "rojo"); return; }

  const btn = document.getElementById("ext-btn-confirmar");
  btn.disabled = true; btn.textContent = "Guardando...";
  try {
    await addDoc(collection(db, "prestamos_externos"), {
      departamento, responsable, herramientas,
      estado: "prestado",
      tieneIncidencias: false,
      creadoEn: serverTimestamp()
    });
    mostrarToast("✅ Salida registrada correctamente");
    cerrarModalNuevoExt();
  } catch(e) {
    mostrarToast("Error al guardar. Verifica la conexión.", "rojo");
  } finally {
    btn.disabled = false; btn.textContent = "✅ Registrar salida";
  }
};

// ── MODAL RETORNO EXTERNO ──
window.abrirRetornoExt = function(id) {
  extActivoId = id;
  const p = todosPrestamosExt.find(x => x.id === id);
  if (!p) return;
  document.getElementById("ext-retorno-nombre").textContent = p.departamento;
  const lista = document.getElementById("ext-retorno-lista");
  lista.innerHTML = (p.herramientas || []).map((h, i) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--borde);gap:10px">
      <span style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600">${herFotoHtmlPorNombre(h.nombre)}${escapeHtml(h.nombre)} <span style="color:var(--texto-dim);font-weight:400">×${h.cantidad}</span></span>
      <select id="ext-estado-r-${i}"
        style="padding:6px 10px;background:var(--bg);border:1px solid var(--borde);border-radius:7px;color:var(--texto);font-size:12px">
        <option value="retornada">✅ Retornada</option>
        <option value="danada">⚠️ Dañada</option>
        <option value="perdida">❌ Perdida</option>
      </select>
    </div>`).join("") || '<p style="color:var(--texto-dim);font-size:13px">Sin herramientas registradas.</p>';
  document.getElementById("ext-retorno-picker-buscar").value = "";
  renderExtRetornoPickerGrid();
  document.getElementById("modal-retorno-ext").classList.add("abierto");
};

window.renderExtRetornoPickerGrid = function() {
  const wrap = document.getElementById("ext-retorno-picker-grid");
  const q = (document.getElementById("ext-retorno-picker-buscar").value || "").toLowerCase();
  const lista = (_herListaActual || []).filter(h => h.nombre.toLowerCase().includes(q));
  if (!lista.length) { wrap.innerHTML = '<div class="vacio" style="grid-column:1/-1"><div class="vacio-icono">🧰</div><p>Sin resultados.</p></div>'; return; }
  wrap.innerHTML = lista.map(h => {
    const fotoUrl = h.fotoUrl || (h.codigo ? '../img/herramientas/' + h.codigo + '.jpg' : '');
    const icono = h.icono || '🔧';
    const foto = fotoUrl
      ? `<img src="${fotoUrl}" onerror="this.parentNode.innerHTML='<span class=\\'her-foto-fallback\\'>${icono}</span>'">`
      : `<span class="her-foto-fallback">${icono}</span>`;
    return `
      <div class="her-card" onclick="extRetornoAgregarAdicional('${escapeAttr(h.nombre)}')" title="Agregar al retorno">
        <div class="her-foto-wrap">${foto}</div>
        <div class="her-cuerpo"><div class="her-nombre">${escapeHtml(h.nombre)}</div></div>
      </div>`;
  }).join("");
};

window.extRetornoAgregarAdicional = async function(nombre) {
  if (!extActivoId) return;
  try {
    const ref = doc(db, "prestamos_externos", extActivoId);
    const snap = await getDoc(ref);
    const existentes = snap.data()?.herramientas || [];
    existentes.push({ nombre, cantidad: 1, adicional: true });
    await updateDoc(ref, { herramientas: existentes });
    mostrarToast("✓ Herramienta agregada");
    abrirRetornoExt(extActivoId);
  } catch(e) { mostrarToast("Error al agregar: " + e.message, "rojo"); }
};

window.cerrarModalRetornoExt = function() {
  document.getElementById("modal-retorno-ext").classList.remove("abierto");
  extActivoId = null;
};

window.confirmarRetornoExt = async function() {
  if (!extActivoId) return;
  const p = todosPrestamosExt.find(x => x.id === extActivoId);
  if (!p) return;

  const herramientas = p.herramientas || [];
  const resultado    = [];
  const incidencias  = [];

  herramientas.forEach((h, i) => {
    const estado = document.getElementById(`ext-estado-r-${i}`)?.value || "retornada";
    resultado.push({ ...h, estadoRetorno: estado });
    if (estado !== "retornada") incidencias.push({ herramienta: h.nombre, tipo: estado });
  });

  try {
    await updateDoc(doc(db, "prestamos_externos", extActivoId), {
      estado: "devuelto",
      tieneIncidencias: incidencias.length > 0,
      retornadoEn: serverTimestamp(),
      herramientasRetorno: resultado
    });

    for (const inc of incidencias) {
      await addDoc(collection(db, "incidencias"), {
        tipo_prestamo: "externo",
        nombre: p.departamento,
        herramienta: inc.herramienta,
        tipoIncidencia: inc.tipo,
        prestamoId: extActivoId,
        fecha: new Date().toLocaleDateString("es-DO"),
        creadoEn: serverTimestamp()
      });
    }

    cerrarModalRetornoExt();
    if (incidencias.length > 0) {
      mostrarToast(`↩ Retorno registrado · ${incidencias.length} incidencia(s)`, "rojo");
    } else {
      mostrarToast("↩ Retorno registrado correctamente");
    }
  } catch(e) {
    mostrarToast("Error al registrar retorno", "rojo");
  }
};

// ── CONDUCE DE SALIDA ──
window.generarConduce = function(id) {
  const p = todosPrestamosExt.find(x => x.id === id);
  if (!p) return;
  const fecha = p.creadoEn?.toDate ? p.creadoEn.toDate().toLocaleString("es-DO") : "—";
  const totalHerConduce = (p.herramientas || []).reduce((sum, h) => sum + (h.cantidad || 1), 0);
  const herramientasHtml = (p.herramientas || []).map(h =>
    `<div class="modal-herramienta-item"><span>${escapeHtml(h.nombre)}</span><span style="font-weight:700">×${h.cantidad}</span></div>`
  ).join("") || "—";
  document.getElementById("conduce-contenido").innerHTML = `
    <div class="modal-campo"><label>Número de conduce</label><div class="valor">${p.id.slice(0,8).toUpperCase()}</div></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="modal-campo"><label>Departamento</label><div class="valor">${escapeHtml(p.departamento) || "—"}</div></div>
      <div class="modal-campo"><label>Responsable que retira</label><div class="valor">${escapeHtml(p.responsable) || "—"}</div></div>
    </div>
    <div class="modal-campo"><label>Fecha de salida</label><div class="valor">${fecha}</div></div>
    <div class="modal-campo">
      <label>Herramientas entregadas <span style="color:var(--verde);font-weight:800">(${totalHerConduce} en total)</span></label>
      <div class="modal-herramientas">${herramientasHtml}</div>
    </div>
    <div class="modal-campo"><label>Estado actual</label><span class="badge badge-${p.estado === "prestado" ? "entregada" : "retornada"}">${p.estado === "prestado" ? "Prestado" : "Devuelto"}</span></div>
  `;
  document.getElementById("modal-conduce").classList.add("abierto");
};

window.cerrarModalConduce = function() {
  document.getElementById("modal-conduce").classList.remove("abierto");
};

document.getElementById("modal-nuevo-ext").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-nuevo-ext")) cerrarModalNuevoExt();
});
document.getElementById("modal-retorno-ext").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-retorno-ext")) cerrarModalRetornoExt();
});
document.getElementById("modal-conduce").addEventListener("click", e => {
  if (e.target === document.getElementById("modal-conduce")) cerrarModalConduce();
});

// ══════════════════════════════════════════════
// ── HERRAMIENTAS — CONFIGURACIÓN ──
// ══════════════════════════════════════════════

let herCfgEditar = null;
let herCfgNombreLocal = null;
let _herListaActual = [];

async function cargarHerramientasCfg() {
  try {
    onSnapshot(query(collection(db, "herramientas"), orderBy("nombre", "asc")), snap => {
      const todosValidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const nombresFirestore = new Set(todosValidos.map(h => h.nombre.toLowerCase()));
      const eliminadas = new Set(todosValidos.filter(h => h.eliminada).map(h => h.nombre.toLowerCase()));
      // No mostrar en la tabla los documentos "tombstone" (eliminada:true) que
      // se crean al renombrar/eliminar una herramienta de respaldo — solo
      // sirven para que no reaparezcan desde HERRAMIENTAS_LISTA.
      const enFirestore = todosValidos.filter(h => !h.eliminada);
      const delRespaldo = HERRAMIENTAS_LISTA
        .filter(h => !nombresFirestore.has(h.nombre.toLowerCase()) && !eliminadas.has(h.nombre.toLowerCase()))
        .map((h, i) => ({ id: "local-" + i, nombre: h.nombre, cantidadDisponible: h.cantidadDisponible || 5, icono: h.icono, codigo: h.codigo, categoria: h.categoria, local: true }));

      const lista = [...enFirestore, ...delRespaldo]
        .sort((a, b) => a.nombre.localeCompare(b.nombre));

      lista.forEach(h => {
        if (h.fotoUrl) _herFotoMap[h.nombre.toLowerCase()] = h.fotoUrl;
        else if (h.codigo) _herFotoMap[h.nombre.toLowerCase()] = '../img/herramientas/' + h.codigo + '.jpg';
      });

      renderHerramientasCfg(lista);
    });
  } catch(e) {
    const w = document.getElementById("her-cfg-wrap");
    if (w) w.innerHTML = '<div class="cargando">Error al cargar herramientas.</div>';
  }
}

// Cuenta cuántas veces se ha pedido cada herramienta, sumando las cantidades
// en todas las solicitudes de estudiantes (todasSolicitudes ya viene cargada
// en tiempo real por cargarSolicitudes(), así que no hace falta otra consulta).
function contarSolicitudesPorHerramienta() {
  const conteo = {};
  (todasSolicitudes || []).forEach(s => (s.herramientas || []).forEach(h => {
    conteo[h.nombre] = (conteo[h.nombre] || 0) + (h.cantidad || 1);
  }));
  return conteo;
}

function renderHerramientasCfg(lista) {
  _herListaActual = lista;
  const wrap = document.getElementById("her-cfg-wrap");
  if (!wrap) return;

  const conteoUsos = contarSolicitudesPorHerramienta();

  // Sugerencias de práctica ya usadas, para no crear duplicados por escritura distinta.
  const practicasUsadas = [...new Set(lista.map(h => h.practica).filter(Boolean))].sort();
  const dlPractica = document.getElementById("her-practica-lista");
  if (dlPractica) dlPractica.innerHTML = practicasUsadas.map(p => '<option value="' + p.replace(/"/g,"&quot;") + '">').join("");

  // ── Chips de categoría ──
  const chipsWrap = document.getElementById("her-chips");
  if (chipsWrap) {
    const categoriasPresentes = {};
    lista.forEach(h => {
      const cat = h.categoria || "Sin categoría";
      categoriasPresentes[cat] = (categoriasPresentes[cat] || 0) + 1;
    });
    const estiloTodas = herCategoriaActiva === ""
      ? "background:var(--verde);border-color:var(--verde);color:#000"
      : "";
    let chipsHtml = `<div class="her-chip" style="${estiloTodas}" data-cat="" title="Ver todas las categorías">Todas <span style="opacity:.7">(${lista.length})</span></div>`;
    chipsHtml += Object.keys(categoriasPresentes).sort((a, b) => a.localeCompare(b)).map(cat => {
      const meta = CATEGORIAS_HERRAMIENTA[cat] || { icono: "🔩", color: "#8b949e" };
      const n = categoriasPresentes[cat];
      const activo = herCategoriaActiva === cat;
      const estilo = activo
        ? `background:${meta.color};border-color:${meta.color};color:#000`
        : `border-color:${meta.color}66;color:${meta.color}`;
      return `<div class="her-chip" style="${estilo}" data-cat="${cat}" title="Filtrar por categoría: ${cat}">${meta.icono} ${cat} <span style="opacity:.7">(${n})</span></div>`;
    }).join("");
    chipsWrap.innerHTML = chipsHtml;
    chipsWrap.querySelectorAll(".her-chip").forEach(chip => {
      chip.addEventListener("click", () => {
        herCategoriaActiva = chip.dataset.cat;
        renderHerramientasCfg(_herListaActual);
      });
    });
  }

  // ── Filtro por texto + categoría activa ──
  const buscar = (document.getElementById("her-buscar")?.value || "").toLowerCase();
  let filtrada = buscar ? lista.filter(h => h.nombre.toLowerCase().includes(buscar)) : lista.slice();
  if (herCategoriaActiva) filtrada = filtrada.filter(h => (h.categoria || "Sin categoría") === herCategoriaActiva);

  // ── Franja de estadísticas ──
  const statsWrap = document.getElementById("her-stats-strip");
  if (statsWrap) {
    const stockBajoCount = lista.filter(h => (Number.isFinite(h.cantidadDisponible) ? h.cantidadDisponible : 0) <= UMBRAL_STOCK_BAJO).length;
    const numCategorias = new Set(lista.map(h => h.categoria || "Sin categoría")).size;
    let masSolicitada = null, masSolicitadaN = 0;
    lista.forEach(h => {
      const n = conteoUsos[h.nombre] || 0;
      if (n > masSolicitadaN) { masSolicitadaN = n; masSolicitada = h.nombre; }
    });
    statsWrap.innerHTML = `
      <div class="her-stat-pill">
        <span class="her-stat-icono">🧰</span>
        <div><div class="her-stat-num">${lista.length}</div><div class="her-stat-label">Total herramientas</div></div>
      </div>
      <div class="her-stat-pill${stockBajoCount > 0 ? ' alerta' : ''}">
        <span class="her-stat-icono">⚠️</span>
        <div><div class="her-stat-num">${stockBajoCount}</div><div class="her-stat-label">Stock bajo (≤ ${UMBRAL_STOCK_BAJO})</div></div>
      </div>
      <div class="her-stat-pill">
        <span class="her-stat-icono">🏷️</span>
        <div><div class="her-stat-num">${numCategorias}</div><div class="her-stat-label">Categorías</div></div>
      </div>
      <div class="her-stat-pill">
        <span class="her-stat-icono">🔥</span>
        <div><div class="her-stat-num" style="font-size:13px">${masSolicitada || "—"}</div><div class="her-stat-label">${masSolicitada ? masSolicitadaN + ' solicitudes · más pedida' : 'Sin solicitudes aún'}</div></div>
      </div>`;
  }

  if (!filtrada.length) {
    wrap.innerHTML = '<div class="vacio"><div class="vacio-icono">🔧</div><p>No hay herramientas que coincidan.</p></div>';
    return;
  }

  // Top 3 más pedidas del inventario completo (no solo la vista filtrada),
  // para la cinta 🔥 en la tarjeta.
  const topUsadas = new Set(
    Object.entries(conteoUsos).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .filter(([, n]) => n > 0).map(([nombre]) => nombre)
  );

  wrap.innerHTML = filtrada.map(h => {
    const cantidad = Number.isFinite(h.cantidadDisponible) ? h.cantidadDisponible : 0;
    const bajo = cantidad <= UMBRAL_STOCK_BAJO;
    const cat = h.categoria || "Sin categoría";
    const meta = CATEGORIAS_HERRAMIENTA[cat] || { icono: "🔩", color: "#8b949e" };
    const fotoUrl = h.fotoUrl || (h.codigo ? '../img/herramientas/' + h.codigo + '.jpg' : '');
    const icono = h.icono || '🔧';
    const usos = conteoUsos[h.nombre] || 0;
    const esPopular = topUsadas.has(h.nombre);
    const local = h.local ? ' <span style="font-size:9px;color:var(--texto-dim)">(resp.)</span>' : '';
    const nombreEsc = escapeAttr(h.nombre);
    const catEsc = escapeAttr(cat);
    const fechaCreado = h.creadoEn?.toDate ? h.creadoEn.toDate() : (h.creadoEn ? new Date(h.creadoEn) : null);
    const esNueva = fechaCreado && (Date.now() - fechaCreado.getTime()) < 1000*60*60*72; // 72h

    const fotoHtml = fotoUrl
      ? `<img src="${fotoUrl}" class="foto-zoom" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
         <span class="her-foto-fallback" style="display:none">${icono}</span>`
      : `<span class="her-foto-fallback">${icono}</span>`;

    return `
      <div class="her-card${bajo ? ' stock-bajo' : ''}">
        <div class="her-foto-wrap">
          ${fotoHtml}
          <span class="her-cat-tag" style="background:${meta.color}dd;color:#fff">${meta.icono} ${cat}</span>
          ${bajo ? '<span class="her-ribbon">⚠ Stock bajo</span>' : (esNueva ? '<span class="her-ribbon" style="background:rgba(163,113,247,0.92)">🆕 NUEVA</span>' : (esPopular ? '<span class="her-ribbon popular">🔥 Top pedida</span>' : ''))}
        </div>
        <div class="her-cuerpo">
          <div class="her-nombre">${escapeHtml(h.nombre)}${local}</div>
          ${h.practica ? `<div style="font-size:10px;color:var(--verde);font-weight:700;margin-bottom:6px">🏷️ ${h.practica}</div>` : ''}
          <div class="her-fila-stock">
            <span class="her-stock-badge">${cantidad} disp.</span>
            <span class="her-usos">${usos > 0 ? usos + ' pedidas' : 'sin pedidos'}</span>
          </div>
          <div class="her-acciones">
            <button class="btn btn-outline" onclick="abrirModalHerramienta('${h.id}','${nombreEsc}',${cantidad},${h.local || false},'${catEsc}')" title="Editar herramienta">✏️ Editar</button>
            <button class="btn btn-rojo" onclick="eliminarHerramienta('${h.id}','${nombreEsc}',${h.local || false})" title="Eliminar herramienta">🗑</button>
          </div>
        </div>
      </div>`;
  }).join("");
}

let herFotoArchivo = null;
let herFotoUrlActual = "";
let herFotoUrlEsReal = false; // true = venía de fotoUrl en Firestore; false = ruta de respaldo armada solo para preview
let herCfgCodigoLocal = null;
let herCfgIconoLocal = null;

window.abrirModalHerramienta = function(id = null, nombre = "", cantidad = 1, esLocal = false, categoria = "") {
  herCfgEditar      = esLocal ? null : id;
  herCfgNombreLocal = esLocal ? nombre : null;
  herFotoArchivo    = null;
  const datosActuales = id ? _herListaActual.find(h => h.id === id) : null;
  // Conservamos codigo/icono originales para no perderlos al guardar, aunque
  // el usuario solo edite la cantidad. Si el documento de Firestore ya los
  // había perdido (bug anterior), los recuperamos por nombre desde la lista
  // de referencia — así el próximo "Guardar" repara el documento solo.
  const refLista = HERRAMIENTAS_LISTA.find(h => h.nombre.toLowerCase() === nombre.toLowerCase());
  herCfgCodigoLocal = datosActuales?.codigo || refLista?.codigo || null;
  herCfgIconoLocal  = datosActuales?.icono  || refLista?.icono  || null;
  herFotoUrlEsReal  = !!datosActuales?.fotoUrl;
  herFotoUrlActual  = datosActuales?.fotoUrl || (herCfgCodigoLocal ? '../img/herramientas/' + herCfgCodigoLocal + '.jpg' : '') || "";
  document.getElementById("her-modal-titulo").textContent = id ? "✏️ Editar herramienta" : "➕ Agregar herramienta";
  const inputNombre = document.getElementById("her-input-nombre");
  inputNombre.value    = nombre;
  inputNombre.readOnly = false;
  inputNombre.style.opacity = "1";
  const categoriaFinal = datosActuales?.categoria || refLista?.categoria || categoria || "";
  document.getElementById("her-input-categoria").value = categoriaFinal;
  document.getElementById("her-input-cantidad").value = cantidad;
  document.getElementById("her-input-practica").value = datosActuales?.practica || "";
  document.getElementById("her-input-foto").value = "";
  document.getElementById("her-progreso-wrap").style.display = "none";
  document.getElementById("her-foto-exito").style.display = "none";
  document.getElementById("her-drop-texto").textContent = "Arrastra una imagen aquí o haz clic para seleccionarla";
  mostrarPreviewHer(herFotoUrlActual);
  document.getElementById("modal-herramienta-cfg").classList.add("abierto");
};

function mostrarPreviewHer(url) {
  const img    = document.getElementById("her-foto-preview-img");
  const icono  = document.getElementById("her-foto-preview-icono");
  if (url) {
    img.src = url;
    img.style.display = "block";
    icono.style.display = "none";
  } else {
    img.style.display = "none";
    icono.style.display = "block";
  }
}

window.cerrarModalHerramienta = function() {
  document.getElementById("modal-herramienta-cfg").classList.remove("abierto");
  herCfgEditar = null;
};

window.herFotoError = function(img) {
  const div = document.createElement("div");
  div.style.cssText = "width:36px;height:36px;border-radius:6px;background:var(--card2);display:flex;align-items:center;justify-content:center;font-size:18px";
  div.textContent = "🔧";
  img.parentNode.replaceChild(div, img);
};

function herProcesarArchivo(archivo) {
  if (!archivo) return;
  if (!archivo.type.startsWith("image/")) { mostrarToast("Selecciona un archivo de imagen", "rojo"); return; }
  if (archivo.size > 5 * 1024 * 1024) { mostrarToast("La imagen no debe superar 5 MB", "rojo"); return; }
  herFotoArchivo = archivo;
  document.getElementById("her-foto-exito").style.display = "none";
  document.getElementById("her-drop-texto").textContent = archivo.name;
  const lector = new FileReader();
  lector.onload = e => mostrarPreviewHer(e.target.result);
  lector.readAsDataURL(archivo);
}

const herDropZone = document.getElementById("her-drop-zone");
const herInputFoto = document.getElementById("her-input-foto");
herInputFoto?.addEventListener("change", () => herProcesarArchivo(herInputFoto.files[0]));
herDropZone?.addEventListener("dragover", e => { e.preventDefault(); herDropZone.style.borderColor = "var(--verde)"; herDropZone.style.background = "var(--verde-glow)"; });
herDropZone?.addEventListener("dragleave", () => { herDropZone.style.borderColor = "var(--borde)"; herDropZone.style.background = ""; });
herDropZone?.addEventListener("drop", e => {
  e.preventDefault();
  herDropZone.style.borderColor = "var(--borde)"; herDropZone.style.background = "";
  const archivo = e.dataTransfer.files[0];
  if (archivo) herProcesarArchivo(archivo);
});

function herComprimirFoto(archivo) {
  return new Promise((resolve, reject) => {
    const wrap = document.getElementById("her-progreso-wrap");
    const barra = document.getElementById("her-progreso-barra");
    const texto = document.getElementById("her-progreso-texto");
    wrap.style.display = "block";
    barra.style.width = "10%";
    texto.textContent = "Leyendo imagen...";
    const lector = new FileReader();
    lector.onload = e => {
      const img = new Image();
      img.onload = () => {
        barra.style.width = "55%";
        texto.textContent = "Comprimiendo imagen...";
        const MAX = 800;
        let { width, height } = img;
        if (width > height && width > MAX) { height = Math.round(height * MAX / width); width = MAX; }
        else if (height > MAX) { width = Math.round(width * MAX / height); height = MAX; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.fillStyle = "#ffffff"; // fondo blanco siempre (elimina transparencia y fondo negro)
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.88);
        barra.style.width = "100%";
        texto.textContent = "✅ Carga completa";
        resolve(dataUrl);
      };
      img.onerror = () => reject(new Error("No se pudo procesar la imagen"));
      img.src = e.target.result;
    };
    lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
    lector.readAsDataURL(archivo);
  });
}

window.guardarHerramienta = async function() {
  const nombre    = document.getElementById("her-input-nombre").value.trim();
  const categoria = document.getElementById("her-input-categoria").value;
  const cantidad  = parseInt(document.getElementById("her-input-cantidad").value) || 0;
  const practica  = document.getElementById("her-input-practica").value.trim();
  if (!nombre) { mostrarToast("Escribe el nombre de la herramienta", "rojo"); return; }
  const btn = document.getElementById("her-btn-guardar");
  btn.disabled = true; btn.textContent = "Guardando...";
  const nombreFinal = nombre;
  const datos = { nombre: nombreFinal, cantidadDisponible: cantidad, categoria, practica };
  // No perder codigo/icono del respaldo al editar solo cantidad/nombre.
  if (herCfgCodigoLocal) datos.codigo = herCfgCodigoLocal;
  if (herCfgIconoLocal)  datos.icono  = herCfgIconoLocal;

  // Para que la auditoría diga QUÉ cambió (no solo "editó la herramienta"),
  // comparamos contra los valores que tenía antes de este guardado.
  const antesDeEditar = herCfgEditar ? _herListaActual.find(h => h.id === herCfgEditar) : null;
  function describirCambios(antes) {
    if (!antes) return "";
    const cambios = [];
    if (antes.nombre !== nombreFinal) cambios.push(`nombre: "${antes.nombre}" → "${nombreFinal}"`);
    if ((antes.categoria || "Sin categoría") !== (categoria || "Sin categoría")) cambios.push(`categoría: "${antes.categoria || "Sin categoría"}" → "${categoria || "Sin categoría"}"`);
    const cantidadAntes = Number.isFinite(antes.cantidadDisponible) ? antes.cantidadDisponible : 0;
    if (cantidadAntes !== cantidad) {
      const diferencia = cantidad - cantidadAntes;
      const signo = diferencia > 0 ? "+" : "";
      cambios.push(`cantidad: ${cantidadAntes} → ${cantidad} (${signo}${diferencia})`);
    }
    if ((antes.practica || "") !== (practica || "")) cambios.push(`práctica/combo: "${antes.practica || "ninguna"}" → "${practica || "ninguna"}"`);
    if (herFotoArchivo) cambios.push("foto actualizada");
    return cambios.length ? ` — ${cambios.join(" · ")}` : " (sin cambios detectados)";
  }

  try {
    if (herCfgEditar) {
      const snapDup = await getDocs(query(collection(db, "herramientas"), where("nombre", "==", nombreFinal)));
      const duplicada = snapDup.docs.find(d => d.id !== herCfgEditar);
      if (duplicada) {
        mostrarToast('Ya existe otra herramienta con el nombre "' + nombreFinal + '"', "rojo");
        btn.disabled = false; btn.textContent = "✅ Guardar";
        return;
      }
    }

    if (herFotoArchivo) {
      btn.textContent = "Procesando foto...";
      datos.fotoUrl = await herComprimirFoto(herFotoArchivo);
      document.getElementById("her-foto-exito").style.display = "block";
    } else if (herFotoUrlActual && herFotoUrlEsReal) {
      datos.fotoUrl = herFotoUrlActual;
    }

    btn.textContent = "Guardando...";
    if (herCfgEditar) {
      await updateDoc(doc(db, "herramientas", herCfgEditar), datos);
      mostrarToast("✅ Herramienta actualizada");
      registrarAuditoria("herramienta", "editar", `Editó la herramienta "${nombreFinal}"${describirCambios(antesDeEditar)}`);
    } else {
      const snap = await getDocs(query(collection(db, "herramientas"), where("nombre", "==", nombreFinal)));
      if (!snap.empty) {
        const antesExistente = { id: snap.docs[0].id, ...snap.docs[0].data() };
        await updateDoc(doc(db, "herramientas", snap.docs[0].id), datos);
        mostrarToast("✅ Ya existía esa herramienta — se actualizó en vez de duplicarla");
        registrarAuditoria("herramienta", "editar", `Editó la herramienta "${nombreFinal}"${describirCambios(antesExistente)}`);
      } else {
        await addDoc(collection(db, "herramientas"), { ...datos, creadoEn: serverTimestamp() });
        mostrarToast("✅ Herramienta agregada");
        registrarAuditoria("herramienta", "crear", `Agregó la herramienta "${nombreFinal}"${categoria ? " ("+categoria+")" : ""}`);
      }
      // Si veníamos de una herramienta "de respaldo" (aún no en Firestore) y le
      // cambiaron el nombre, marcamos el nombre original como eliminado para
      // que no vuelva a aparecer duplicado desde HERRAMIENTAS_LISTA.
      if (herCfgNombreLocal && herCfgNombreLocal !== nombreFinal) {
        await addDoc(collection(db, "herramientas"), { nombre: herCfgNombreLocal, cantidadDisponible: 0, eliminada: true, creadoEn: serverTimestamp() });
      }
    }
    cerrarModalHerramienta();
  } catch(e) { mostrarToast("Error al guardar: " + e.message, "rojo"); }
  finally { btn.disabled = false; btn.textContent = "✅ Guardar"; }
};

window.eliminarHerramienta = async function(id, nombre, esLocal = false) {
  if (!confirm('¿Eliminar "' + nombre + '"? Esta acción no se puede deshacer.')) return;
  try {
    if (esLocal) {
      await addDoc(collection(db, "herramientas"), { nombre, cantidadDisponible: 0, eliminada: true, creadoEn: serverTimestamp() });
    } else {
      await deleteDoc(doc(db, "herramientas", id));
    }
    mostrarToast("Herramienta eliminada");
    registrarAuditoria("herramienta", "eliminar", `Eliminó la herramienta "${nombre}"`);
  } catch(e) { mostrarToast("Error al eliminar", "rojo"); }
};

// ── ENTRADA DE STOCK (llegada de pedido: herramientas, insumos, materiales) ──
window.abrirModalEntradaStock = function() {
  const sel = document.getElementById("entrada-select-herramienta");
  const lista = (_herListaActual || []).slice().sort((a,b) => a.nombre.localeCompare(b.nombre));
  sel.innerHTML = lista.map(h => `<option value="${h.id}">${escapeHtml(h.nombre)} (actual: ${h.cantidadDisponible ?? 0})</option>`).join("");
  document.getElementById("entrada-cantidad").value = 1;
  document.getElementById("entrada-nota").value = "";
  document.getElementById("entrada-nombre-nueva").value = "";
  document.getElementById("entrada-categoria-nueva").value = "";
  toggleEntradaNueva(false);
  document.getElementById("modal-entrada-stock").classList.add("abierto");
};

window.toggleEntradaNueva = function(esNueva) {
  document.getElementById("entrada-modo-existente").style.display = esNueva ? "none" : "block";
  document.getElementById("entrada-modo-nueva").style.display = esNueva ? "block" : "none";
  document.getElementById("modal-entrada-stock").dataset.modoNueva = esNueva ? "1" : "0";
};

window.cerrarModalEntradaStock = function() {
  document.getElementById("modal-entrada-stock").classList.remove("abierto");
};

window.guardarEntradaStock = async function() {
  const esNueva = document.getElementById("modal-entrada-stock").dataset.modoNueva === "1";
  const cantidad = parseInt(document.getElementById("entrada-cantidad").value) || 0;
  const nota = document.getElementById("entrada-nota").value.trim();
  if (cantidad <= 0) { mostrarToast("La cantidad debe ser mayor a 0", "rojo"); return; }
  const btn = document.getElementById("entrada-btn-guardar");
  btn.disabled = true; btn.textContent = "Guardando...";

  try {
    if (esNueva) {
      const nombre = document.getElementById("entrada-nombre-nueva").value.trim();
      const categoria = document.getElementById("entrada-categoria-nueva").value;
      if (!nombre) { mostrarToast("Escribe el nombre", "rojo"); btn.disabled = false; btn.textContent = "✅ Registrar entrada"; return; }
      const yaExiste = (_herListaActual || []).find(h => h.nombre.toLowerCase() === nombre.toLowerCase());
      if (yaExiste) {
        mostrarToast('Ya existe una herramienta con ese nombre — selecciónala de la lista en vez de crear otra', "rojo");
        btn.disabled = false; btn.textContent = "✅ Registrar entrada"; return;
      }
      await addDoc(collection(db, "herramientas"), { nombre, cantidadDisponible: cantidad, categoria, creadoEn: serverTimestamp() });
      mostrarToast(`✅ "${nombre}" agregada con ${cantidad} en stock`);
      registrarAuditoria("stock", "entrada", `Entrada de stock (nueva): +${cantidad} de "${nombre}"${nota ? " — " + nota : ""}`);
    } else {
      const id = document.getElementById("entrada-select-herramienta").value;
      if (!id) { mostrarToast("Selecciona una herramienta", "rojo"); btn.disabled = false; btn.textContent = "✅ Registrar entrada"; return; }
      const h = (_herListaActual || []).find(x => x.id === id);
      if (!h) return;
      const nuevaCantidad = (Number.isFinite(h.cantidadDisponible) ? h.cantidadDisponible : 0) + cantidad;
      if (h.local) {
        await addDoc(collection(db, "herramientas"), { nombre: h.nombre, cantidadDisponible: nuevaCantidad, categoria: h.categoria || "", codigo: h.codigo, icono: h.icono, creadoEn: serverTimestamp() });
      } else {
        await updateDoc(doc(db, "herramientas", id), { cantidadDisponible: nuevaCantidad });
      }
      mostrarToast(`✅ Entrada registrada: +${cantidad} ${h.nombre}`);
      registrarAuditoria("stock", "entrada", `Entrada de stock: +${cantidad} de "${h.nombre}"${nota ? " — " + nota : ""} (quedó en ${nuevaCantidad})`);
    }
    cerrarModalEntradaStock();
  } catch(e) { mostrarToast("Error al registrar la entrada", "rojo"); }
  finally { btn.disabled = false; btn.textContent = "✅ Registrar entrada"; }
};

document.getElementById("her-buscar")?.addEventListener("input", () => renderHerramientasCfg(_herListaActual));

document.getElementById("modal-entrada-stock")?.addEventListener("click", e => {
  if (e.target === document.getElementById("modal-entrada-stock")) cerrarModalEntradaStock();
});

document.getElementById("modal-herramienta-cfg")?.addEventListener("click", e => {
  if (e.target === document.getElementById("modal-herramienta-cfg")) cerrarModalHerramienta();
});

// ── MATERIALES GASTABLES ──
// Ya no es una colección aparte: un material gastable es simplemente una
// herramienta con categoria === "Material Gastable". Esta función se usa
// en toda la app (badges de solicitudes, retornos, historial) para saber
// si una herramienta debe mostrarse con la etiqueta "🧰 gastable".
window.esMaterialGastable = function(nombreHerramienta) {
  const h = _herListaActual.find(h => h.nombre.toLowerCase() === (nombreHerramienta || "").toLowerCase());
  return h?.categoria === "Material Gastable";
};

// ── PROFESORES CFG ──
let profCfgEditar = null;
let profCfgLista  = [];

const PROFESORES_RESPALDO_ADMIN = ["Daniel Camejo","José Peña","Julio Durán","Víctor Félix"];
// Respaldo inicial de materias — igual que PROFESORES_RESPALDO_ADMIN, se usa
// solo mientras la colección "materias" está vacía; en cuanto agregues una
// desde el panel, ya vive en Firestore y esta lista deja de hacer falta
// para esa materia. Mismos nombres que LABORATORIOS_RESPALDO_ADMIN porque en
// este taller cada materia se llama igual que el taller donde se imparte.
// Sin código todavía — edítalas desde el panel en cuanto sepas el código
// real de cada una (ej. IMC105004).
const MATERIAS_RESPALDO_ADMIN = [
  { codigo: "", nombre: "Taller mecánica básica" },
  { codigo: "", nombre: "Lab. ciencia de los materiales" },
  { codigo: "", nombre: "Máquinas especiales" },
  { codigo: "", nombre: "Taller de procesos industriales" },
  { codigo: "", nombre: "Taller de soldadura" },
  { codigo: "", nombre: "Taller máquinas y herramientas I" },
  { codigo: "", nombre: "Taller máquinas y herramientas II" }
];

async function cargarProfesoresCfg() {
  try {
    onSnapshot(query(collection(db, "profesores"), orderBy("nombre", "asc")), snap => {
      const todosValidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const nombresFirestore = new Set(todosValidos.map(p => p.nombre.toLowerCase()));
      const eliminados = new Set(todosValidos.filter(p => p.eliminado).map(p => p.nombre.toLowerCase()));
      const enFirestore = todosValidos.filter(p => !p.eliminado);
      const delRespaldo = PROFESORES_RESPALDO_ADMIN
        .filter(nombre => !nombresFirestore.has(nombre.toLowerCase()) && !eliminados.has(nombre.toLowerCase()))
        .map((nombre, i) => ({ id: "local-" + i, nombre, local: true }));
      profCfgLista = [...enFirestore, ...delRespaldo].sort((a, b) => a.nombre.localeCompare(b.nombre));
      renderProfesoresCfg();
    });
  } catch(e) {
    const w = document.getElementById("prof-cfg-wrap");
    if (w) w.innerHTML = '<div class="cargando">Error al cargar profesores.</div>';
  }
}

function renderProfesoresCfg() {
  const wrap   = document.getElementById("prof-cfg-wrap");
  if (!wrap) return;
  const buscar = (document.getElementById("prof-buscar")?.value || "").toLowerCase();
  const lista  = buscar ? profCfgLista.filter(p => p.nombre.toLowerCase().includes(buscar)) : profCfgLista;

  const resumen = document.getElementById("prof-resumen");
  if (resumen) resumen.innerHTML = `👤 <b>${profCfgLista.length}</b> profesor${profCfgLista.length === 1 ? "" : "es"} registrado${profCfgLista.length === 1 ? "" : "s"}`;

  if (!lista.length) {
    wrap.innerHTML = '<div class="vacio"><div class="vacio-icono">👤</div><p>No hay profesores registrados.</p></div>';
    return;
  }
  wrap.innerHTML = lista.map(p => {
    const local = p.local ? '<span style="font-size:10px;color:var(--texto-dim);margin-left:6px">(respaldo)</span>' : '';
    const [nombre, ...apRest] = p.nombre.split(" ");
    const apellido = apRest.join(" ");
    const sinRetornar = (todosPrestamosProfTodos || []).filter(x => x.profesor === p.nombre && x.estado === "activo");
    const sinRetHoy = sinRetornar.filter(x => esMismodia(x.creadoEn));
    const sinRetViejos = sinRetornar.length - sinRetHoy.length;
    const nombreEsc = escapeAttr(p.nombre);
    const listaMaterias = (p.materias || []).length
      ? `<div class="prof-materias-lista">${p.materias.map(m => {
          const horarios = (m.horarios && m.horarios.length)
            ? m.horarios
            : ((m.dias && m.dias.length) || m.horaInicio ? [{ dias: m.dias || [], horaInicio: m.horaInicio || "", horaFin: m.horaFin || "" }] : []);
          const detalle = horarios.length
            ? horarios.map(h => `<div class="pmi-horario">${(h.dias&&h.dias.length)?h.dias.join("/"):"sin días"}${h.horaInicio?" · "+h.horaInicio+"–"+(h.horaFin||""):""}</div>`).join("")
            : '<div class="pmi-horario">sin horario definido</div>';
          return `
          <div class="prof-materia-item">
            <span class="pmi-punto"></span>
            <div>
              <span class="pmi-nombre">${m.codigo ? `<span class="pmi-codigo">${m.codigo}</span>` : ""}${m.nombre}</span>
              ${detalle}
            </div>
          </div>`;
        }).join("")}</div>`
      : "";
    return `
      <div class="prof-fila">
        <div class="prof-fila-top">
          <div class="est-avatar">
            <div class="est-circulo" style="background:${colorEstudiante(p.nombre)}22;color:${colorEstudiante(p.nombre)}">${iniciales(nombre, apellido)}</div>
            <div style="min-width:0;flex:1">
              <div class="est-nombre">${p.nombre}${local}</div>
            </div>
          </div>
          ${sinRetHoy.length > 0 ? `<span class="prof-badge-activos" style="cursor:pointer" title="Ver y cerrar préstamo" onclick="abrirRetornoProf('${sinRetHoy[0].id}')">⏳ ${sinRetHoy.length} sin retornar hoy</span>` : ""}
          ${sinRetViejos > 0 ? `<span class="prof-badge-activos" style="cursor:pointer;background:rgba(239,68,68,.15);color:var(--rojo)" title="Ver y cerrar préstamo" onclick="abrirRetornoProf('${sinRetornar.find(x=>!esMismodia(x.creadoEn)).id}')">🔍 ${sinRetViejos} atrasado(s)</span>` : ""}
          <div class="acciones-celda">
            <button class="btn btn-outline" onclick="abrirModalProfesor('${p.id}','${nombreEsc}',${p.local||false})" title="Editar profesor">✏️ Editar</button>
            ${p.local ? "" : `<button class="btn btn-rojo" onclick="eliminarProfesor('${p.id}','${nombreEsc}')" title="Eliminar profesor">🗑</button>`}
          </div>
        </div>
        ${listaMaterias}
      </div>`;
  }).join("");
}

window.abrirModalProfesor = function(id = null, nombre = "", esLocal = false) {
  profCfgEditar = esLocal ? null : id;
  window._profLocalNombre = esLocal ? nombre : null;
  document.getElementById("prof-modal-titulo").textContent = id ? "✏️ Editar profesor" : "➕ Agregar profesor";
  const input = document.getElementById("prof-input-nombre");
  input.value    = nombre;
  input.readOnly = false;
  input.style.opacity = "1";
  const wrap = document.getElementById("prof-materias-wrap");
  wrap.innerHTML = "";
  const datos = id ? profCfgLista.find(p => p.id === id) : null;
  (datos?.materias || []).forEach(m => profAgregarFilaMateria(m));
  document.getElementById("modal-profesor-cfg").classList.add("abierto");
};

const PROF_DIAS = ["Lun","Mar","Mié","Jue","Vie","Sáb"];
function _profSelectHora(valorGuardado, tipo) {
  if (tipo === "h") {
    const actual = valorGuardado ? parseInt(valorGuardado.split(":")[0]) : "";
    let opts = '<option value="">--</option>';
    for (let h = 1; h <= 12; h++) opts += `<option value="${h}"${h===actual?" selected":""}>${h}</option>`;
    return opts;
  }
  if (tipo === "m") {
    const actual = valorGuardado ? valorGuardado.split(":")[1]?.split(" ")[0] : "";
    return ["00","15","30","45"].map(m => `<option value="${m}"${m===actual?" selected":""}>${m}</option>`).join("");
  }
  const actual = valorGuardado ? valorGuardado.split(" ")[1] : "";
  return ["AM","PM"].map(ap => `<option value="${ap}"${ap===actual?" selected":""}>${ap}</option>`).join("");
}

window.profAgregarFilaMateria = function(m = {}) {
  const wrap = document.getElementById("prof-materias-wrap");
  const fila = document.createElement("div");
  fila.className = "prof-materia-fila";
  const opciones = materiasDisponiblesGlobal();
  const codigoActual = m.codigo || "";
  const nombreActual = m.nombre || "";
  // Si el código/nombre guardado no está en el catálogo (ej. se escribió
  // antes de existir Materias, o la materia se borró del catálogo después),
  // se agrega igual como opción para no perder el dato ya guardado.
  const opcionesCodigo = opciones.filter(o => o.codigo);
  if (codigoActual && !opcionesCodigo.some(o => o.codigo === codigoActual)) opcionesCodigo.unshift({ codigo: codigoActual, nombre: nombreActual });
  const opcionesNombre = [...opciones];
  if (nombreActual && !opcionesNombre.some(o => o.nombre === nombreActual)) opcionesNombre.unshift({ codigo: codigoActual, nombre: nombreActual });

  fila.innerHTML = `
    <div class="pm-header">
      <select class="pm-codigo" onchange="profSincronizarMateria(this,'codigo')">
        <option value="">Código...</option>
        ${opcionesCodigo.map(o => `<option value="${o.codigo.replace(/"/g,'&quot;')}"${o.codigo===codigoActual?" selected":""}>${o.codigo}</option>`).join("")}
      </select>
      <select class="pm-nombre" onchange="profSincronizarMateria(this,'nombre')">
        <option value="">Elige la materia...</option>
        ${opcionesNombre.map(o => `<option value="${o.nombre.replace(/"/g,'&quot;')}" data-codigo="${o.codigo.replace(/"/g,'&quot;')}"${o.nombre===nombreActual?" selected":""}>${o.nombre}</option>`).join("")}
      </select>
      <button type="button" class="btn-quitar-fila" onclick="this.closest('.prof-materia-fila').remove()" title="Quitar esta materia">✕</button>
    </div>
    <div class="pm-horarios-wrap"></div>
    <button type="button" class="pm-btn-horario" onclick="profAgregarHorario(this)">🕐 Agregar horario a esta materia</button>`;
  wrap.appendChild(fila);

  // Compatibilidad: materias guardadas antes de que existiera "horarios"
  // (formato viejo: {nombre, dias, horaInicio, horaFin} plano, un solo
  // horario). Si no trae "horarios", lo convertimos a una lista de 1.
  const horarios = (m.horarios && m.horarios.length)
    ? m.horarios
    : ((m.dias && m.dias.length) || m.horaInicio ? [{ dias: m.dias || [], horaInicio: m.horaInicio || "", horaFin: m.horaFin || "" }] : [{}]);
  const btnHorario = fila.querySelector(".pm-btn-horario");
  horarios.forEach(h => profAgregarHorario(btnHorario, h));
};

window.profAgregarHorario = function(btnRef, h = {}) {
  const fila = btnRef.closest(".prof-materia-fila");
  const wrapHorarios = fila.querySelector(".pm-horarios-wrap");
  const diasSel = h.dias || [];
  const horarioRow = document.createElement("div");
  horarioRow.className = "pm-horario-fila";
  horarioRow.innerHTML = `
    <div class="pm-dias-chips">
      ${PROF_DIAS.map(d => `<span class="her-chip pm-dia${diasSel.includes(d)?" activo":""}" data-dia="${d}" style="${diasSel.includes(d)?"background:var(--verde);border-color:var(--verde);color:#000":""}">${d}</span>`).join("")}
    </div>
    <div class="pm-hora-row">
      <span>De</span>
      <select class="pm-h1">${_profSelectHora(h.horaInicio,"h")}</select>:
      <select class="pm-m1">${_profSelectHora(h.horaInicio,"m")}</select>
      <select class="pm-ap1">${_profSelectHora(h.horaInicio,"ap")}</select>
      <span>a</span>
      <select class="pm-h2">${_profSelectHora(h.horaFin,"h")}</select>:
      <select class="pm-m2">${_profSelectHora(h.horaFin,"m")}</select>
      <select class="pm-ap2">${_profSelectHora(h.horaFin,"ap")}</select>
      <button type="button" class="btn-quitar-horario" onclick="this.closest('.pm-horario-fila').remove()" title="Quitar este horario">✕</button>
    </div>`;
  horarioRow.querySelectorAll(".pm-dia").forEach(chip => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("activo");
      const on = chip.classList.contains("activo");
      chip.style.cssText = on ? "background:var(--verde);border-color:var(--verde);color:#000" : "";
    });
  });
  wrapHorarios.appendChild(horarioRow);
};

// El picker del profesor jala ÚNICAMENTE del catálogo de Materias
// (materiaCfgLista, que ya combina Firestore + respaldo) — no escanea lo que
// cada profesor tenga escrito, para que el catálogo sea la única fuente.
function materiasDisponiblesGlobal() {
  return (materiaCfgLista || [])
    .filter(m => m.nombre)
    .map(m => ({ codigo: m.codigo || "", nombre: m.nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));
}

// Código y Materia están enlazados: como cada código es único por materia,
// elegir uno completa el otro automáticamente.
window.profSincronizarMateria = function(select, tipo) {
  const fila = select.closest(".prof-materia-fila");
  if (!select.value) return;
  if (tipo === "codigo") {
    const codigo = select.value;
    const opciones = materiasDisponiblesGlobal();
    const match = opciones.find(o => o.codigo === codigo);
    if (match) {
      const selNombre = fila.querySelector(".pm-nombre");
      if ([...selNombre.options].some(op => op.value === match.nombre)) selNombre.value = match.nombre;
    }
  } else {
    // El option del nombre ya trae su código en data-codigo.
    const opt = select.selectedOptions[0];
    const codigo = opt?.dataset.codigo || "";
    if (codigo) {
      const selCodigo = fila.querySelector(".pm-codigo");
      if ([...selCodigo.options].some(op => op.value === codigo)) selCodigo.value = codigo;
    }
  }
};

// ══════════════════════════════════════════════
// ── MATERIAS (catálogo con código, independiente de los profesores) ──
// ══════════════════════════════════════════════

let materiaCfgEditar = null;
let materiaCfgLista = [];

async function cargarMateriasCfg() {
  try {
    onSnapshot(query(collection(db, "materias"), orderBy("nombre", "asc")), snap => {
      const todosValidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const nombresFirestore = new Set(todosValidos.map(m => m.nombre.toLowerCase()));
      const eliminadas = new Set(todosValidos.filter(m => m.eliminada).map(m => m.nombre.toLowerCase()));
      const enFirestore = todosValidos.filter(m => !m.eliminada);
      const delRespaldo = MATERIAS_RESPALDO_ADMIN
        .filter(m => !nombresFirestore.has(m.nombre.toLowerCase()) && !eliminadas.has(m.nombre.toLowerCase()))
        .map((m, i) => ({ id: "local-" + i, codigo: m.codigo || "", nombre: m.nombre, local: true }));
      materiaCfgLista = [...enFirestore, ...delRespaldo].sort((a, b) => a.nombre.localeCompare(b.nombre));
      renderMateriasCfg();
    }, err => {
      console.error("Error cargando materias:", err);
      const w = document.getElementById("materia-cfg-wrap");
      if (w) w.innerHTML = '<div class="vacio" style="padding:20px"><div class="vacio-icono">⚠️</div><p>No se pudo cargar (' + (err.code || err.message) + '). Revisa las reglas de Firestore para la colección "materias".</p></div>';
    });
  } catch(e) {
    const w = document.getElementById("materia-cfg-wrap");
    if (w) w.innerHTML = '<div class="cargando">Error al cargar materias.</div>';
  }
}

function renderMateriasCfg() {
  const wrap = document.getElementById("materia-cfg-wrap");
  if (!wrap) return;
  const buscar = (document.getElementById("materia-buscar")?.value || "").toLowerCase();
  const lista = buscar
    ? materiaCfgLista.filter(m => m.nombre.toLowerCase().includes(buscar) || (m.codigo || "").toLowerCase().includes(buscar))
    : materiaCfgLista;
  if (!lista.length) {
    wrap.innerHTML = '<div class="vacio"><div class="vacio-icono">📚</div><p>No hay materias registradas todavía.</p></div>';
    return;
  }
  wrap.innerHTML = '<table><thead><tr><th>#</th><th>Código</th><th>Nombre</th><th>Acciones</th></tr></thead><tbody>'
    + lista.map((m, i) => {
        const nombreEsc = escapeAttr(m.nombre);
        const codigoEsc = escapeAttr(m.codigo || "");
        const local = m.local ? ' <span style="font-size:10px;color:var(--texto-dim)">(respaldo)</span>' : '';
        return '<tr>'
          + '<td style="color:var(--texto-dim)">' + (i + 1) + '</td>'
          + '<td>' + (m.codigo ? '<span class="pmi-codigo">' + escapeHtml(m.codigo) + '</span>' : '<span style="color:var(--texto-dim)">—</span>') + '</td>'
          + '<td><div class="est-nombre">' + escapeHtml(m.nombre) + local + '</div></td>'
          + '<td><div class="acciones-celda">'
          + '<button class="btn btn-outline" onclick="abrirModalMateria(\'' + m.id + '\',\'' + codigoEsc + '\',\'' + nombreEsc + '\',' + (m.local||false) + ')" title="Editar materia">✏️ Editar</button>'
          + '<button class="btn btn-rojo" onclick="eliminarMateria(\'' + m.id + '\',\'' + nombreEsc + '\',' + (m.local||false) + ')" title="Eliminar materia">🗑</button>'
          + '</div></td>'
          + '</tr>';
      }).join("")
    + '</tbody></table>';
}

window.abrirModalMateria = function(id = null, codigo = "", nombre = "", esLocal = false) {
  materiaCfgEditar = esLocal ? null : id;
  window._materiaLocalNombre = esLocal ? nombre : null;
  document.getElementById("materia-modal-titulo").textContent = id ? "✏️ Editar materia" : "➕ Agregar materia";
  document.getElementById("materia-input-codigo").value = codigo;
  document.getElementById("materia-input-nombre").value = nombre;
  document.getElementById("modal-materia-cfg").classList.add("abierto");
};

window.cerrarModalMateria = function() {
  document.getElementById("modal-materia-cfg").classList.remove("abierto");
  materiaCfgEditar = null;
};

window.guardarMateria = async function() {
  const codigo = document.getElementById("materia-input-codigo").value.trim().toUpperCase();
  const nombre = document.getElementById("materia-input-nombre").value.trim();
  if (!nombre) { mostrarToast("Escribe el nombre de la materia", "rojo"); return; }
  const btn = document.getElementById("materia-btn-guardar");
  btn.disabled = true; btn.textContent = "Guardando...";
  try {
    if (materiaCfgEditar) {
      await updateDoc(doc(db, "materias", materiaCfgEditar), { codigo, nombre });
      mostrarToast("✅ Materia actualizada");
      registrarAuditoria("materia", "editar", `Editó la materia "${nombre}"${codigo ? " (" + codigo + ")" : ""}`);
    } else {
      await addDoc(collection(db, "materias"), { codigo, nombre, creadoEn: serverTimestamp() });
      mostrarToast(window._materiaLocalNombre ? "✅ Materia de respaldo guardada en Firestore" : "✅ Materia agregada");
      registrarAuditoria("materia", "crear", `Agregó la materia "${nombre}"${codigo ? " (" + codigo + ")" : ""}`);
      // Si veníamos de una materia "de respaldo" y le cambiaron el nombre,
      // marcamos el nombre original como eliminado para que no reaparezca
      // duplicado desde MATERIAS_RESPALDO_ADMIN.
      if (window._materiaLocalNombre && window._materiaLocalNombre !== nombre) {
        await addDoc(collection(db, "materias"), { nombre: window._materiaLocalNombre, eliminada: true, creadoEn: serverTimestamp() });
      }
    }
    cerrarModalMateria();
  } catch(e) { mostrarToast("Error al guardar: " + e.message, "rojo"); }
  finally { btn.disabled = false; btn.textContent = "✅ Guardar"; }
};

window.eliminarMateria = async function(id, nombre, esLocal = false) {
  if (!confirm('¿Eliminar la materia "' + nombre + '" del catálogo? (Los profesores que ya la tengan asignada no se ven afectados).')) return;
  try {
    if (esLocal) {
      await addDoc(collection(db, "materias"), { nombre, eliminada: true, creadoEn: serverTimestamp() });
    } else {
      await deleteDoc(doc(db, "materias", id));
    }
    mostrarToast("Materia eliminada del catálogo");
    registrarAuditoria("materia", "eliminar", `Eliminó la materia "${nombre}"`);
  } catch(e) { mostrarToast("Error al eliminar", "rojo"); }
};

document.getElementById("materia-buscar")?.addEventListener("input", renderMateriasCfg);
document.getElementById("modal-materia-cfg")?.addEventListener("click", e => {
  if (e.target === document.getElementById("modal-materia-cfg")) cerrarModalMateria();
});

window.cerrarModalProfesor = function() {
  document.getElementById("modal-profesor-cfg").classList.remove("abierto");
  profCfgEditar = null;
};

window.guardarProfesor = async function() {
  const nombre = document.getElementById("prof-input-nombre").value.trim();
  if (!nombre) { mostrarToast("Escribe el nombre del profesor", "rojo"); return; }
  const materias = [...document.querySelectorAll("#prof-materias-wrap .prof-materia-fila")].map(fila => {
    const horarios = [...fila.querySelectorAll(".pm-horario-fila")].map(h => {
      const dias = [...h.querySelectorAll(".pm-dia.activo")].map(c => c.dataset.dia);
      const h1 = h.querySelector(".pm-h1").value, m1 = h.querySelector(".pm-m1").value, ap1 = h.querySelector(".pm-ap1").value;
      const h2 = h.querySelector(".pm-h2").value, m2 = h.querySelector(".pm-m2").value, ap2 = h.querySelector(".pm-ap2").value;
      return {
        dias,
        horaInicio: h1 ? `${h1}:${m1} ${ap1}` : "",
        horaFin: h2 ? `${h2}:${m2} ${ap2}` : ""
      };
    }).filter(h => h.dias.length || h.horaInicio);
    return {
      codigo: fila.querySelector(".pm-codigo").value.trim().toUpperCase(),
      nombre: fila.querySelector(".pm-nombre").value.trim(),
      horarios
    };
  }).filter(m => m.nombre);
  const btn = document.getElementById("prof-btn-guardar");
  btn.disabled = true; btn.textContent = "Guardando...";
  try {
    if (profCfgEditar) {
      await updateDoc(doc(db, "profesores", profCfgEditar), { nombre, materias });
      mostrarToast("✅ Profesor actualizado");
      registrarAuditoria("profesor", "editar", `Editó el profesor "${nombre}"`);
    } else if (window._profLocalNombre) {
      const snap = await getDocs(query(collection(db, "profesores"), where("nombre", "==", nombre)));
      if (!snap.empty) {
        await updateDoc(doc(db, "profesores", snap.docs[0].id), { nombre, materias });
        mostrarToast("✅ Profesor actualizado");
        registrarAuditoria("profesor", "editar", `Editó el profesor "${nombre}"`);
      } else {
        await addDoc(collection(db, "profesores"), { nombre, materias, creadoEn: serverTimestamp() });
        mostrarToast("✅ Profesor guardado");
        registrarAuditoria("profesor", "crear", `Agregó el profesor "${nombre}"`);
      }
    } else {
      await addDoc(collection(db, "profesores"), { nombre, materias, creadoEn: serverTimestamp() });
      mostrarToast("✅ Profesor agregado");
      registrarAuditoria("profesor", "crear", `Agregó el profesor "${nombre}"`);
    }
    cerrarModalProfesor();
  } catch(e) { mostrarToast("Error al guardar", "rojo"); }
  finally { btn.disabled = false; btn.textContent = "✅ Guardar"; }
};

window.eliminarProfesor = async function(id, nombre) {
  if (!confirm('¿Eliminar al profesor "' + nombre + '"?')) return;
  try {
    // "eliminado:true" en vez de borrar el documento — si no, un profesor
    // cuyo nombre coincide con el respaldo (PROFESORES_RESPALDO_ADMIN)
    // reaparecería solo en la próxima carga, porque ya no está en Firestore.
    await updateDoc(doc(db, "profesores", id), { eliminado: true });
    mostrarToast("Profesor eliminado");
    registrarAuditoria("profesor", "eliminar", `Eliminó al profesor "${nombre}"`);
  } catch(e) { mostrarToast("Error al eliminar", "rojo"); }
};

document.getElementById("prof-buscar")?.addEventListener("input", renderProfesoresCfg);

// ── LABORATORIOS / TALLERES ──
// Mismo patrón que Profesores. El formulario del estudiante ya lee esta
// colección en tiempo real (js/inventario.js → cargarLaboratorios()), así
// que lo que se agregue/edite/elimine aquí aparece allá sin tocar nada más.
const LABORATORIOS_RESPALDO_ADMIN = [
  "Taller mecánica básica",
  "Lab. ciencia de los materiales",
  "Máquinas especiales",
  "Taller de procesos industriales",
  "Taller de soldadura",
  "Taller máquinas y herramientas I",
  "Taller máquinas y herramientas II"
];
let labCfgEditar = null;
let labCfgLista  = [];

async function cargarLaboratoriosCfg() {
  try {
    onSnapshot(query(collection(db, "laboratorios"), orderBy("nombre", "asc")), snap => {
      const todosValidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const nombresFirestore = new Set(todosValidos.map(l => l.nombre.toLowerCase()));
      const eliminados = new Set(todosValidos.filter(l => l.eliminado).map(l => l.nombre.toLowerCase()));
      const enFirestore = todosValidos.filter(l => !l.eliminado);
      const delRespaldo = LABORATORIOS_RESPALDO_ADMIN
        .filter(nombre => !nombresFirestore.has(nombre.toLowerCase()) && !eliminados.has(nombre.toLowerCase()))
        .map((nombre, i) => ({ id: "local-" + i, nombre, local: true }));
      labCfgLista = [...enFirestore, ...delRespaldo].sort((a, b) => a.nombre.localeCompare(b.nombre));
      renderLaboratoriosCfg();
    });
  } catch(e) {
    const w = document.getElementById("lab-cfg-wrap");
    if (w) w.innerHTML = '<div class="cargando">Error al cargar laboratorios.</div>';
  }
}

function renderLaboratoriosCfg() {
  const wrap   = document.getElementById("lab-cfg-wrap");
  if (!wrap) return;
  const buscar = (document.getElementById("lab-buscar")?.value || "").toLowerCase();
  const lista  = buscar ? labCfgLista.filter(l => l.nombre.toLowerCase().includes(buscar)) : labCfgLista;

  const resumen = document.getElementById("lab-resumen");
  if (resumen) resumen.innerHTML = `🏢 <b>${labCfgLista.length}</b> laboratorio${labCfgLista.length === 1 ? "" : "s"}/taller${labCfgLista.length === 1 ? "" : "es"} registrado${labCfgLista.length === 1 ? "" : "s"}`;

  if (!lista.length) {
    wrap.innerHTML = '<div class="vacio"><div class="vacio-icono">🏢</div><p>No hay laboratorios registrados.</p></div>';
    return;
  }
  wrap.innerHTML = lista.map(l => {
    const local = l.local ? '<span style="font-size:10px;color:var(--texto-dim);margin-left:6px">(respaldo)</span>' : '';
    const nombreEsc = escapeAttr(l.nombre);
    return `
      <div class="prof-fila">
        <div class="prof-fila-top">
          <div class="est-avatar">
            <div class="est-circulo" style="background:${colorEstudiante(l.nombre)}22;color:${colorEstudiante(l.nombre)}">🏢</div>
            <div style="min-width:0;flex:1">
              <div class="est-nombre">${l.nombre}${local}</div>
            </div>
          </div>
          <div class="acciones-celda">
            <button class="btn btn-outline" onclick="abrirModalLaboratorio('${l.id}','${nombreEsc}',${l.local||false})" title="Editar">✏️ Editar</button>
            ${l.local ? "" : `<button class="btn btn-rojo" onclick="eliminarLaboratorio('${l.id}','${nombreEsc}')" title="Eliminar">🗑</button>`}
          </div>
        </div>
      </div>`;
  }).join("");
}

window.abrirModalLaboratorio = function(id = null, nombre = "", esLocal = false) {
  labCfgEditar = esLocal ? null : id;
  window._labLocalNombre = esLocal ? nombre : null;
  document.getElementById("lab-modal-titulo").textContent = id ? "✏️ Editar laboratorio/taller" : "➕ Agregar laboratorio/taller";
  const input = document.getElementById("lab-input-nombre");
  input.value = nombre;
  document.getElementById("modal-laboratorio-cfg").classList.add("abierto");
};

window.cerrarModalLaboratorio = function() {
  document.getElementById("modal-laboratorio-cfg").classList.remove("abierto");
  labCfgEditar = null;
};

window.guardarLaboratorio = async function() {
  const nombre = document.getElementById("lab-input-nombre").value.trim();
  if (!nombre) { mostrarToast("Escribe el nombre del laboratorio/taller", "rojo"); return; }
  const btn = document.getElementById("lab-btn-guardar");
  btn.disabled = true; btn.textContent = "Guardando...";
  try {
    if (labCfgEditar) {
      await updateDoc(doc(db, "laboratorios", labCfgEditar), { nombre });
      mostrarToast("✅ Laboratorio actualizado");
      registrarAuditoria("laboratorio", "editar", `Editó el laboratorio "${nombre}"`);
    } else if (window._labLocalNombre) {
      const snap = await getDocs(query(collection(db, "laboratorios"), where("nombre", "==", nombre)));
      if (!snap.empty) {
        await updateDoc(doc(db, "laboratorios", snap.docs[0].id), { nombre });
        mostrarToast("✅ Laboratorio actualizado");
        registrarAuditoria("laboratorio", "editar", `Editó el laboratorio "${nombre}"`);
      } else {
        await addDoc(collection(db, "laboratorios"), { nombre, creadoEn: serverTimestamp() });
        mostrarToast("✅ Laboratorio guardado");
        registrarAuditoria("laboratorio", "crear", `Agregó el laboratorio "${nombre}"`);
      }
    } else {
      await addDoc(collection(db, "laboratorios"), { nombre, creadoEn: serverTimestamp() });
      mostrarToast("✅ Laboratorio agregado");
      registrarAuditoria("laboratorio", "crear", `Agregó el laboratorio "${nombre}"`);
    }
    cerrarModalLaboratorio();
  } catch(e) { mostrarToast("Error al guardar", "rojo"); }
  finally { btn.disabled = false; btn.textContent = "✅ Guardar"; }
};

window.eliminarLaboratorio = async function(id, nombre) {
  if (!confirm('¿Eliminar "' + nombre + '"?')) return;
  try {
    // "eliminado:true" en vez de borrar el documento — mismo motivo que en
    // Profesores: si no, uno cuyo nombre está en LABORATORIOS_RESPALDO_ADMIN
    // reaparecería solo en la próxima carga.
    await updateDoc(doc(db, "laboratorios", id), { eliminado: true });
    mostrarToast("Laboratorio eliminado");
    registrarAuditoria("laboratorio", "eliminar", `Eliminó el laboratorio "${nombre}"`);
  } catch(e) { mostrarToast("Error al eliminar", "rojo"); }
};

document.getElementById("lab-buscar")?.addEventListener("input", renderLaboratoriosCfg);
document.getElementById("modal-profesor-cfg")?.addEventListener("click", e => {
  if (e.target === document.getElementById("modal-profesor-cfg")) cerrarModalProfesor();
});

// ── CICLOS ──
// IMPORTANTE: no agregar ciclos futuros aquí (ver mismo comentario en
// js/inventario.js) — el formulario de estudiantes preselecciona el primero
// de la lista ordenada, así que un ciclo futuro aquí hace que abra marcando
// ese en vez del actual.
const CICLOS_RESPALDO_ADMIN = ["2-2026", "1-2026", "2-2025", "1-2025"];
let cicloCfgEditar = null;
let cicloCfgLista  = [];

function ordenarCiclosAdmin(lista) {
  return [...lista].sort((a, b) => {
    const [na, ya] = String(a.nombre || "").split("-").map(Number);
    const [nb, yb] = String(b.nombre || "").split("-").map(Number);
    if ((yb || 0) !== (ya || 0)) return (yb || 0) - (ya || 0);
    return (nb || 0) - (na || 0);
  });
}

async function cargarCiclosCfg() {
  try {
    onSnapshot(query(collection(db, "ciclos")), snap => {
      const todosValidos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const nombresFirestore = new Set(todosValidos.map(c => String(c.nombre || "").toLowerCase()));
      const eliminados = new Set(todosValidos.filter(c => c.eliminado).map(c => String(c.nombre || "").toLowerCase()));
      const enFirestore = todosValidos.filter(c => !c.eliminado);
      const delRespaldo = CICLOS_RESPALDO_ADMIN
        .filter(nombre => !nombresFirestore.has(nombre.toLowerCase()) && !eliminados.has(nombre.toLowerCase()))
        .map((nombre, i) => ({ id: "local-" + i, nombre, local: true }));
      cicloCfgLista = ordenarCiclosAdmin([...enFirestore, ...delRespaldo]);
      renderCiclosCfg();
    });
  } catch(e) {
    const w = document.getElementById("ciclo-cfg-wrap");
    if (w) w.innerHTML = '<div class="cargando">Error al cargar ciclos.</div>';
  }
}

function renderCiclosCfg() {
  const wrap   = document.getElementById("ciclo-cfg-wrap");
  if (!wrap) return;
  const buscar = (document.getElementById("ciclo-buscar")?.value || "").toLowerCase();
  const lista  = buscar ? cicloCfgLista.filter(c => c.nombre.toLowerCase().includes(buscar)) : cicloCfgLista;

  const resumen = document.getElementById("ciclo-resumen");
  if (resumen) resumen.innerHTML = `📅 <b>${cicloCfgLista.length}</b> ciclo${cicloCfgLista.length === 1 ? "" : "s"} registrado${cicloCfgLista.length === 1 ? "" : "s"}`;

  if (!lista.length) {
    wrap.innerHTML = '<div class="vacio"><div class="vacio-icono">📅</div><p>No hay ciclos registrados.</p></div>';
    return;
  }

  // Agrupar por año (la parte AAAA de "N-AAAA"): un grupo por año, año más
  // reciente primero, y dentro de cada año los ciclos ya vienen ordenados
  // de más reciente a más antiguo (ordenarCiclosAdmin).
  const porAnio = {};
  lista.forEach(c => {
    const anio = String(c.nombre || "").split("-")[1] || "Sin año";
    (porAnio[anio] = porAnio[anio] || []).push(c);
  });
  const anios = Object.keys(porAnio).sort((a, b) => Number(b) - Number(a));

  wrap.innerHTML = anios.map(anio => {
    const ciclosDelAnio = porAnio[anio];
    return `
      <div class="ciclo-anio-grupo">
        <div class="ciclo-anio-header">📅 ${anio} <span class="ciclo-anio-cuenta">${ciclosDelAnio.length} ciclo${ciclosDelAnio.length !== 1 ? "s" : ""}</span></div>
        <div class="ciclo-anio-fila">
          ${ciclosDelAnio.map(c => {
            const local = c.local ? ' <span style="font-size:10px;color:var(--texto-dim)">(respaldo)</span>' : '';
            const nombreEsc = escapeAttr(c.nombre);
            return `
              <div class="prof-fila" style="flex:1;min-width:210px">
                <div class="prof-fila-top">
                  <div class="est-avatar">
                    <div class="est-circulo" style="background:${colorEstudiante(c.nombre)}22;color:${colorEstudiante(c.nombre)}">📅</div>
                    <div style="min-width:0;flex:1">
                      <div class="est-nombre">${c.nombre}${local}</div>
                    </div>
                  </div>
                  <div class="acciones-celda">
                    <button class="btn btn-outline" onclick="abrirModalCiclo('${c.id}','${nombreEsc}',${c.local||false})" title="Editar">✏️ Editar</button>
                    ${c.local ? "" : `<button class="btn btn-rojo" onclick="eliminarCiclo('${c.id}','${nombreEsc}')" title="Eliminar">🗑</button>`}
                  </div>
                </div>
              </div>`;
          }).join("")}
        </div>
      </div>`;
  }).join("");
}

window.abrirModalCiclo = function(id = null, nombre = "", esLocal = false) {
  cicloCfgEditar = esLocal ? null : id;
  window._cicloLocalNombre = esLocal ? nombre : null;
  document.getElementById("ciclo-modal-titulo").textContent = id ? "✏️ Editar ciclo" : "➕ Agregar ciclo";
  const input = document.getElementById("ciclo-input-nombre");
  input.value = nombre;
  document.getElementById("modal-ciclo-cfg").classList.add("abierto");
};

window.cerrarModalCiclo = function() {
  document.getElementById("modal-ciclo-cfg").classList.remove("abierto");
  cicloCfgEditar = null;
};

window.guardarCiclo = async function() {
  const nombre = document.getElementById("ciclo-input-nombre").value.trim();
  if (!/^\d{1,2}-\d{4}$/.test(nombre)) {
    mostrarToast('Formato inválido. Usa N-AAAA, ej. "1-2027"', "rojo");
    return;
  }
  const btn = document.getElementById("ciclo-btn-guardar");
  btn.disabled = true; btn.textContent = "Guardando...";
  try {
    if (cicloCfgEditar) {
      await updateDoc(doc(db, "ciclos", cicloCfgEditar), { nombre });
      mostrarToast("✅ Ciclo actualizado");
      registrarAuditoria("ciclo", "editar", `Editó el ciclo "${nombre}"`);
    } else if (window._cicloLocalNombre) {
      const snap = await getDocs(query(collection(db, "ciclos"), where("nombre", "==", nombre)));
      if (!snap.empty) {
        await updateDoc(doc(db, "ciclos", snap.docs[0].id), { nombre });
        mostrarToast("✅ Ciclo actualizado");
        registrarAuditoria("ciclo", "editar", `Editó el ciclo "${nombre}"`);
      } else {
        await addDoc(collection(db, "ciclos"), { nombre, creadoEn: serverTimestamp() });
        mostrarToast("✅ Ciclo guardado");
        registrarAuditoria("ciclo", "crear", `Agregó el ciclo "${nombre}"`);
      }
    } else {
      await addDoc(collection(db, "ciclos"), { nombre, creadoEn: serverTimestamp() });
      mostrarToast("✅ Ciclo agregado");
      registrarAuditoria("ciclo", "crear", `Agregó el ciclo "${nombre}"`);
    }
    cerrarModalCiclo();
  } catch(e) { mostrarToast("Error al guardar", "rojo"); }
  finally { btn.disabled = false; btn.textContent = "✅ Guardar"; }
};

window.eliminarCiclo = async function(id, nombre) {
  if (!confirm('¿Eliminar el ciclo "' + nombre + '"?')) return;
  try {
    await updateDoc(doc(db, "ciclos", id), { eliminado: true });
    mostrarToast("Ciclo eliminado");
    registrarAuditoria("ciclo", "eliminar", `Eliminó el ciclo "${nombre}"`);
  } catch(e) { mostrarToast("Error al eliminar", "rojo"); }
};

document.getElementById("ciclo-buscar")?.addEventListener("input", renderCiclosCfg);
document.getElementById("modal-ciclo-cfg")?.addEventListener("click", e => {
  if (e.target === document.getElementById("modal-ciclo-cfg")) cerrarModalCiclo();
});

// ── USUARIOS Y ROLES ──
let usrCfgLista = [];
let usrCfgEditarId = null;

async function cargarUsuariosCfg() {
  try {
    onSnapshot(query(collection(db, "usuarios"), orderBy("creadoEn", "desc")), snap => {
      usrCfgLista = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderUsuariosCfg();
    });
  } catch(e) {
    const w = document.getElementById("usr-cfg-wrap");
    if (w) w.innerHTML = '<div class="cargando">Error al cargar usuarios.</div>';
  }
}

function renderUsuariosCfg() {
  const wrap = document.getElementById("usr-cfg-wrap");
  if (!wrap) return;
  const buscar = (document.getElementById("usr-buscar")?.value || "").toLowerCase();
  const lista = buscar
    ? usrCfgLista.filter(u => (u.nombre||"").toLowerCase().includes(buscar) || (u.email||"").toLowerCase().includes(buscar))
    : usrCfgLista;

  const resumen = document.getElementById("usr-resumen");
  if (resumen) {
    const nAdmin = usrCfgLista.filter(u => u.rol === "administrador").length;
    const nEnc   = usrCfgLista.length - nAdmin;
    resumen.innerHTML = `🔐 <b>${usrCfgLista.length}</b> cuenta${usrCfgLista.length===1?"":"s"} &nbsp;·&nbsp; 👑 <b>${nAdmin}</b> administrador${nAdmin===1?"":"es"} &nbsp;·&nbsp; 🔒 <b>${nEnc}</b> encargado${nEnc===1?"":"s"}`;
  }

  if (!lista.length) {
    wrap.innerHTML = '<div class="vacio"><div class="vacio-icono">🔐</div><p>No hay usuarios registrados todavía.</p></div>';
    return;
  }
  const etiquetasSecciones = {
    dashboard:"Dashboard", solicitudes:"Solicitudes", "prestamos-prof":"Préstamos Profesores",
    prestadas:"Herr. Prestadas", incidencias:"Incidencias", "inv-herramientas":"Inv. Herramientas",
    laboratorios:"Talleres", historial:"Historial",
    "profesores-cfg":"Profesores", "herramientas-cfg":"Herramientas", "auditoria-cfg":"Auditoría"
  };
  wrap.innerHTML = lista.map(u => {
    const esAdmin = u.rol === "administrador";
    const rolBadge = esAdmin
      ? '<span class="badge badge-entregada">👑 Administrador</span>'
      : '<span class="badge badge-retornada">🔒 Encargado</span>';
    const inicialesU = ((u.nombre||"?").trim().split(/\s+/).map(p=>p[0]).slice(0,2).join("")||"?").toUpperCase();
    const secciones = esAdmin
      ? '<span class="usr-chip-sec" style="color:var(--texto-dim)">Acceso total al sistema</span>'
      : ((u.secciones||[]).map(s => `<span class="usr-chip-sec">${etiquetasSecciones[s]||s}</span>`).join("") || '<span class="usr-chip-sec">Sin secciones asignadas</span>');
    return `
      <div class="usr-fila ${esAdmin ? "es-admin" : "es-encargado"}">
        <div class="usr-avatar" style="background:${esAdmin ? "#eab30822" : "var(--azul)22"};color:${esAdmin ? "#eab308" : "var(--azul)"}">${inicialesU}</div>
        <div class="usr-info">
          <div class="usr-nombre-fila">${u.nombre || "—"} ${rolBadge}</div>
          <div class="usr-email">✉️ ${u.email || "—"}</div>
          <div class="usr-secciones">${secciones}</div>
        </div>
        <div class="usr-acciones">
          <button class="btn btn-outline" onclick="abrirModalUsuario('${u.id}')" title="Editar usuario">✏️ Editar</button>
          <button class="btn btn-rojo" onclick="eliminarUsuario('${u.id}','${(u.nombre||"").replace(/'/g,"\\'")}')" title="Revocar acceso y eliminar usuario">🗑</button>
        </div>
      </div>`;
  }).join("");
}

document.getElementById("usr-buscar")?.addEventListener("input", renderUsuariosCfg);

window.usrToggleSecciones = function() {
  const rol = document.getElementById("usr-input-rol").value;
  document.getElementById("usr-secciones-wrap").style.display = rol === "encargado" ? "block" : "none";
};

window.abrirModalUsuario = function(id = null) {
  usrCfgEditarId = id;
  const u = id ? usrCfgLista.find(x => x.id === id) : null;
  document.getElementById("usr-modal-titulo").textContent = id ? "✏️ Editar usuario" : "➕ Agregar usuario";
  document.getElementById("usr-input-nombre").value = u?.nombre || "";
  document.getElementById("usr-input-email").value = u?.email || "";
  document.getElementById("usr-input-email").readOnly = !!id;
  document.getElementById("usr-input-email").style.opacity = id ? "0.6" : "1";
  document.getElementById("usr-input-rol").value = u?.rol || "administrador";
  usrToggleSecciones();
  document.querySelectorAll(".usr-seccion-chk").forEach(chk => {
    chk.checked = (u?.secciones || []).includes(chk.value);
  });
  document.getElementById("modal-usuario-cfg").classList.add("abierto");
};

window.cerrarModalUsuario = function() {
  document.getElementById("modal-usuario-cfg").classList.remove("abierto");
  usrCfgEditarId = null;
};

window.guardarUsuario = async function() {
  const nombre = document.getElementById("usr-input-nombre").value.trim();
  const usuario = document.getElementById("usr-input-email").value.trim().toLowerCase().replace(/\s+/g,"");
  const email  = usuario.includes("@") ? usuario : `${usuario}@taller.com`;
  const rol    = document.getElementById("usr-input-rol").value;
  const secciones = rol === "encargado"
    ? [...document.querySelectorAll(".usr-seccion-chk:checked")].map(c => c.value)
    : [];

  if (!nombre) { mostrarToast("Escribe el nombre", "rojo"); return; }
  if (!email)  { mostrarToast("Escribe el correo", "rojo"); return; }
  if (rol === "encargado" && !secciones.length) { mostrarToast("Selecciona al menos una sección", "rojo"); return; }

  const btn = document.getElementById("usr-btn-guardar");
  btn.disabled = true; btn.textContent = "Guardando...";

  try {
    if (usrCfgEditarId) {
      await updateDoc(doc(db, "usuarios", usrCfgEditarId), { nombre, rol, secciones });
      mostrarToast("✅ Usuario actualizado");
      registrarAuditoria("usuario", "editar", `Editó al usuario "${nombre}" (${rol})`);
      cerrarModalUsuario();
    } else {
      const passTemporal = document.getElementById("usr-input-pass-temp")?.value.trim();
      if (!passTemporal || passTemporal.length < 6) {
        mostrarToast("La contraseña temporal debe tener al menos 6 caracteres", "rojo");
        btn.disabled = false; btn.textContent = "✅ Guardar";
        return;
      }
      const cred = await createUserWithEmailAndPassword(authSecundaria, email, passTemporal);
      const uid = cred.user.uid;
      await signOut(authSecundaria);
      await setDoc(doc(db, "usuarios", uid), {
        uid, nombre, email, rol, secciones,
        debeCambiarContrasena: rol === "encargado",
        creadoEn: serverTimestamp()
      });
      mostrarToast("✅ Usuario creado. Le llegará un correo para definir su contraseña.");
      registrarAuditoria("usuario", "crear", `Creó al usuario "${nombre}" (${rol})`);
      cerrarModalUsuario();
    }
  } catch(e) {
    const msg = e.code === "auth/email-already-in-use" ? "Ese correo ya está registrado"
      : e.code === "auth/invalid-email" ? "Correo inválido"
      : "Error al guardar el usuario";
    mostrarToast(msg, "rojo");
  } finally {
    btn.disabled = false; btn.textContent = "✅ Guardar";
  }
};

window.eliminarUsuario = async function(id, nombre) {
  if (!confirm(`¿Eliminar el acceso de "${nombre}"? Ya no podrá iniciar sesión en el panel.`)) return;
  try {
    await deleteDoc(doc(db, "usuarios", id));
    mostrarToast("Usuario eliminado, su acceso fue revocado");
    registrarAuditoria("usuario", "eliminar", `Eliminó el acceso del usuario "${nombre}"`);
  } catch(e) {
    mostrarToast("Error al eliminar el usuario", "rojo");
  }
};

document.getElementById("modal-usuario-cfg")?.addEventListener("click", e => {
  if (e.target === document.getElementById("modal-usuario-cfg")) cerrarModalUsuario();
});

// ── EXPORTAR HERRAMIENTAS ──
window.exportarHerramientasExcel = function() {
  const lista = _herListaActual || [];
  if (!lista.length) { mostrarToast("No hay herramientas que exportar", "rojo"); return; }
  const datos = lista.map((h, i) => ({
    "#": i + 1,
    "Nombre": h.nombre || "—",
    "Categoría": h.categoria || "Sin categoría",
    "Cantidad disponible": h.cantidadDisponible ?? 0,
    "Código": h.codigo || "—",
    "Estado": (h.cantidadDisponible ?? 0) === 0 ? "Sin stock" : (h.cantidadDisponible ?? 0) <= 2 ? "Stock bajo" : "OK"
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(datos);
  ws["!cols"] = [{ wch: 4 }, { wch: 28 }, { wch: 20 }, { wch: 20 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, "Inventario");
  XLSX.writeFile(wb, `inventario_herramientas_${new Date().toLocaleDateString("es-DO").replace(/\//g,"-")}.xlsx`);
  mostrarToast("✅ Inventario exportado a Excel");
};

window.exportarHerramientasPDF = function() {
  const lista = _herListaActual || [];
  if (!lista.length) { mostrarToast("No hay herramientas que exportar", "rojo"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const fecha = new Date().toLocaleDateString("es-DO", { day:"2-digit", month:"long", year:"numeric" });
  doc.setFillColor(27, 94, 56);
  doc.rect(0, 0, 210, 28, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16); doc.setFont(undefined, "bold");
  doc.text("Inventario de Herramientas", 14, 12);
  doc.setFontSize(9); doc.setFont(undefined, "normal");
  doc.text(`Taller Mecánica Industrial — UTESA    Generado: ${fecha}`, 14, 21);
  doc.setTextColor(0, 0, 0);
  doc.autoTable({
    startY: 34,
    head: [["#", "Nombre", "Categoría", "Cant.", "Estado"]],
    body: lista.map((h, i) => [
      i + 1,
      h.nombre || "—",
      h.categoria || "Sin categoría",
      h.cantidadDisponible ?? 0,
      (h.cantidadDisponible ?? 0) === 0 ? "Sin stock" : (h.cantidadDisponible ?? 0) <= 2 ? "Stock bajo" : "OK"
    ]),
    headStyles: { fillColor: [27, 94, 56], textColor: 255, fontStyle: "bold", fontSize: 9 },
    bodyStyles: { fontSize: 8.5 },
    alternateRowStyles: { fillColor: [234, 244, 238] },
    columnStyles: { 0: { halign: "center", cellWidth: 10 }, 3: { halign: "center", cellWidth: 18 }, 4: { halign: "center", cellWidth: 24 } },
    margin: { left: 14, right: 14 },
    didParseCell: (data) => {
      if (data.column.index === 4 && data.row.section === "body") {
        const v = data.cell.raw;
        if (v === "Sin stock")  data.cell.styles.textColor = [217, 48, 37];
        if (v === "Stock bajo") data.cell.styles.textColor = [210, 153, 34];
        if (v === "OK")         data.cell.styles.textColor = [27, 94, 56];
      }
    }
  });
  const pags = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pags; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(150);
    doc.text(`Página ${i} de ${pags}`, 196, 290, { align: "right" });
  }
  doc.save(`inventario_herramientas_${new Date().toLocaleDateString("es-DO").replace(/\//g,"-")}.pdf`);
  mostrarToast("✅ Inventario exportado a PDF");
};

// ── TEMA ──
function aplicarTema(tema) {
  if (tema === 'claro') {
    document.body.classList.add('tema-claro');
    document.getElementById('btn-tema').textContent = '🌙 Oscuro';
  } else {
    document.body.classList.remove('tema-claro');
    document.getElementById('btn-tema').textContent = '☀️ Claro';
  }
  localStorage.setItem('tema-admin', tema);
}

window.toggleTema = function() {
  const actual = localStorage.getItem('tema-admin') || 'claro';
  aplicarTema(actual === 'oscuro' ? 'claro' : 'oscuro');
};

aplicarTema(localStorage.getItem('tema-admin') || 'claro');

// ── HISTORIAL DE MOVIMIENTOS ──
let historialDatos = [];
let histPagina = 1;
const histPorPagina = 15;
let histCargado = false;

async function cargarHistorial() {
  if (histCargado) return;
  try {
    const [snapSol, snapProf, snapExt] = await Promise.all([
      getDocs(query(collection(db, "solicitudes"), orderBy("creadoEn", "desc"))),
      getDocs(query(collection(db, "prestamos_profesores"), orderBy("creadoEn", "desc"))),
      getDocs(query(collection(db, "prestamos_externos"), orderBy("creadoEn", "desc")))
    ]);

    const solicitudes = snapSol.docs.map(d => ({ id: d.id, tipo: "estudiante", ...d.data() }));
    const profesores  = snapProf.docs.map(d => ({ id: d.id, tipo: "profesor",   ...d.data() }));
    const externos    = snapExt.docs.map(d => ({ id: d.id, tipo: "externo",     ...d.data() }));

    historialDatos = [...solicitudes, ...profesores, ...externos].sort((a, b) => {
      const fa = a.creadoEn?.toDate?.() || new Date(0);
      const fb = b.creadoEn?.toDate?.() || new Date(0);
      return fb - fa;
    });

    histCargado = true;
    histRenderTabla();
  } catch(e) {
    console.error(e);
    document.getElementById("hist-tabla-wrap").innerHTML =
      '<div class="vacio"><div class="vacio-icono">⚠️</div><p>Error al cargar el historial.</p></div>';
  }
}

function histFiltrados() {
  const buscar  = document.getElementById("hist-buscar")?.value.toLowerCase() || "";
  const tipo    = document.getElementById("hist-tipo")?.value || "";
  const estado  = document.getElementById("hist-estado")?.value || "";
  const fecha   = document.getElementById("hist-fecha")?.value || "";

  return historialDatos.filter(r => {
    const nombre = `${r.nombre||""} ${r.apellido||""} ${r.matricula||""} ${r.profesor||r.nombreProfesor||""} ${r.departamento||""} ${r.responsable||""}`.toLowerCase();
    const textoOk  = !buscar || nombre.includes(buscar);
    const tipoOk   = !tipo   || r.tipo === tipo;
    const estadoOk = !estado || (estado === "incidencia" ? r.tieneIncidencias : r.estado === estado);
    let fechaOk = true;
    if (fecha && r.creadoEn) {
      const d = r.creadoEn.toDate ? r.creadoEn.toDate() : new Date(r.creadoEn);
      fechaOk = d.toISOString().slice(0,10) === fecha;
    }
    return textoOk && tipoOk && estadoOk && fechaOk;
  });
}

function _histFilasExport() {
  const tipoLabelExport = { estudiante:"Estudiante", profesor:"Profesor", externo:"Dep. Externo" };
  return histFiltrados().map(r => {
    const fecha = r.creadoEn?.toDate ? r.creadoEn.toDate() : new Date(r.creadoEn || 0);
    const nombre = r.tipo === "externo" ? (r.departamento||"—")
      : r.tipo === "profesor" ? (r.profesor||"—")
      : `${r.nombre||""} ${r.apellido||""}`.trim() || "—";
    const ref = r.tipo === "externo" ? (r.responsable||"—")
      : r.tipo === "profesor" ? (r.laboratorio||"—")
      : (r.matricula||r.numeroSolicitud||"—");
    return {
      Fecha: fecha.toLocaleDateString("es-DO"),
      Hora: fecha.toLocaleTimeString("es-DO", { hour:"2-digit", minute:"2-digit" }),
      Tipo: tipoLabelExport[r.tipo] || r.tipo || "",
      "Nombre/Profesor": nombre,
      "Matrícula/Ref.": ref,
      "N° herramientas": (r.herramientas||[]).length,
      Estado: histEstadoInfo(r).txt,
      Incidencia: r.tieneIncidencias ? "Sí" : "No"
    };
  });
}

window.exportarHistorialExcel = function() {
  const filas = _histFilasExport();
  if (!filas.length) { mostrarToast("No hay datos para exportar", "rojo"); return; }
  const ws = XLSX.utils.json_to_sheet(filas);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Historial");
  XLSX.writeFile(wb, `historial_${new Date().toISOString().slice(0,10)}.xlsx`);
};

window.exportarHistorialPDF = function() {
  const filas = _histFilasExport();
  if (!filas.length) { mostrarToast("No hay datos para exportar", "rojo"); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(14);
  doc.text("Historial de Movimientos — Taller Mecánica Industrial", 14, 14);
  doc.setFontSize(9);
  doc.text(`Generado: ${new Date().toLocaleString("es-DO")}`, 14, 20);
  doc.autoTable({
    startY: 26,
    head: [["Fecha","Hora","Tipo","Nombre/Profesor","Matrícula/Ref.","N° herr.","Estado","Incidencia"]],
    body: filas.map(f => [f.Fecha, f.Hora, f.Tipo, f["Nombre/Profesor"], f["Matrícula/Ref."], f["N° herramientas"], f.Estado, f.Incidencia]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [63,185,80] }
  });
  doc.save(`historial_${new Date().toISOString().slice(0,10)}.pdf`);
};

function histActualizarFiltrosUI() {
  const buscar = document.getElementById("hist-buscar")?.value.trim() || "";
  const tipo   = document.getElementById("hist-tipo")?.value || "";
  const estado = document.getElementById("hist-estado")?.value || "";
  const fecha  = document.getElementById("hist-fecha")?.value || "";
  const hay    = buscar || tipo || estado || fecha;

  const limpiar = document.getElementById("hist-btn-limpiar");
  const bar     = document.getElementById("hist-tags-bar");
  const tags    = document.getElementById("hist-tags");
  if (limpiar) limpiar.style.display = hay ? "block" : "none";
  if (bar)     bar.style.display     = hay ? "flex"  : "none";
  if (!tags)   return;

  tags.innerHTML = "";
  const chip = (txt) => `<span style="background:rgba(34,197,94,.15);color:var(--verde);padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700">${txt}</span>`;
  if (buscar) tags.innerHTML += chip(`🔍 "${buscar}"`);
  if (tipo)   tags.innerHTML += chip(tipo === "estudiante" ? "🎓 Estudiante" : "👨‍🏫 Profesor");
  if (estado) {
    const et = { pendiente:"⏳ Pendiente", entregada:"✅ Entregada", retornada:"↩ Retornada", cancelada:"❌ Cancelada", incidencia:"⚠️ Con Incidencia" };
    tags.innerHTML += chip(et[estado] || estado);
  }
  if (fecha)  tags.innerHTML += chip(`📅 ${fecha}`);

  ["hist-buscar","hist-tipo","hist-estado","hist-fecha"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const activo = el.value.trim() !== "";
    el.style.borderColor = activo ? "var(--verde)" : "";
    el.style.background  = activo ? "rgba(34,197,94,.06)" : "";
  });
}

function histEstadoInfo(r) {
  if (r.tipo !== "estudiante" && r.estado === "activo")   return { cls: "pendiente", txt: "⏳ Sin retornar" };
  if (r.tipo !== "estudiante" && r.estado === "retornado") return { cls: "retornada", txt: "↩ Retornado" };
  return { cls: r.estado || "", txt: r.estado || "—" };
}

function histRenderTabla() {
  const filtrados = histFiltrados();
  const total  = filtrados.length;
  const inicio = (histPagina - 1) * histPorPagina;
  const pagina = filtrados.slice(inicio, inicio + histPorPagina);
  const wrap   = document.getElementById("hist-tabla-wrap");

  if (pagina.length === 0) {
    wrap.innerHTML = '<div class="vacio"><div class="vacio-icono">📭</div><p>No hay registros que coincidan.</p></div>';
    document.getElementById("hist-pag-info").textContent = "";
    document.getElementById("hist-pag-btns").innerHTML = "";
    return;
  }

  const tipoIcono  = { estudiante:"🎓", profesor:"👨‍🏫", externo:"🏢" };
  const tipoLabel  = { estudiante:"Estudiante", profesor:"Profesor", externo:"Dep. Externo" };

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Fecha y Hora</th>
          <th>Tipo</th>
          <th>Nombre</th>
          <th>Matrícula / Ref.</th>
          <th>Herramientas</th>
          <th>Estado</th>
        </tr>
      </thead>
      <tbody>
        ${pagina.map((r, i) => {
          let nombreMostrar, refMostrar, inicialesMostrar;
          if (r.tipo === "externo") {
            nombreMostrar = r.departamento || "—";
            refMostrar = r.responsable || "—";
            inicialesMostrar = (nombreMostrar[0]||"D").toUpperCase();
          } else if (r.tipo === "profesor") {
            nombreMostrar = r.profesor || "—";
            refMostrar = r.laboratorio || "—";
            inicialesMostrar = (nombreMostrar[0]||"P").toUpperCase();
          } else {
            nombreMostrar = `${r.nombre||""} ${r.apellido||""}`.trim() || "—";
            refMostrar = r.matricula || r.numeroSolicitud || "—";
            inicialesMostrar = iniciales(r.nombre, r.apellido);
          }
          return `
          <tr style="cursor:pointer" onclick="abrirModalHist('${r.id}','${r.tipo}')">
            <td style="color:var(--texto-dim)">${inicio + i + 1}</td>
            <td style="font-size:12px;color:var(--texto-dim)">${formatFecha(r.creadoEn)}</td>
            <td><span style="font-size:13px">${tipoIcono[r.tipo]||"📋"}</span> <span style="font-size:11px;color:var(--texto-dim)">${tipoLabel[r.tipo]||r.tipo}</span></td>
            <td>
              <div class="est-avatar">
                <div class="est-circulo" style="background:${colorEstudiante(nombreMostrar)}22;color:${colorEstudiante(nombreMostrar)}">
                  ${escapeHtml(inicialesMostrar)}
                </div>
                <div class="est-nombre">${escapeHtml(nombreMostrar)}</div>
              </div>
            </td>
            <td style="font-size:12px">${escapeHtml(refMostrar)}</td>
            <td><span style="background:var(--card2);padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700">${(r.herramientas||[]).length}</span></td>
            <td>
              <span class="badge badge-${histEstadoInfo(r).cls}">${histEstadoInfo(r).txt}</span>
              ${r.tieneIncidencias ? '<span class="badge badge-cancelada" style="margin-left:4px">⚠️</span>' : ""}
            </td>
          </tr>`;}).join("")}
      </tbody>
    </table>`;

  const totalPags = Math.ceil(total / histPorPagina);
  const desde = inicio + 1;
  const hasta = Math.min(inicio + histPorPagina, total);
  document.getElementById("hist-pag-info").textContent = (desde === 1 && hasta === total)
    ? `${total} registro${total !== 1 ? "s" : ""} en total`
    : `Mostrando ${desde}–${hasta} de ${total} registro${total !== 1 ? "s" : ""}`;
  const btns = document.getElementById("hist-pag-btns");
  btns.innerHTML = "";
  for (let p = 1; p <= totalPags; p++) {
    const b = document.createElement("button");
    b.textContent = p;
    if (p === histPagina) b.classList.add("activo");
    b.addEventListener("click", () => { histPagina = p; histRenderTabla(); });
    btns.appendChild(b);
  }
}

["hist-buscar","hist-tipo","hist-estado","hist-fecha"].forEach(id => {
  document.getElementById(id)?.addEventListener("input",  () => { histActualizarFiltrosUI(); histPagina = 1; histRenderTabla(); });
  document.getElementById(id)?.addEventListener("change", () => { histActualizarFiltrosUI(); histPagina = 1; histRenderTabla(); });
});

document.getElementById("hist-btn-limpiar")?.addEventListener("click", () => {
  ["hist-buscar","hist-tipo","hist-estado","hist-fecha"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.value = ""; el.style.borderColor = ""; el.style.background = ""; }
  });
  histActualizarFiltrosUI();
  histPagina = 1;
  histRenderTabla();
});

document.querySelectorAll(".nav-item[data-vista='historial']").forEach(el => {
  el.addEventListener("click", () => setTimeout(cargarHistorial, 50));
});

window.abrirModalHist = function(id, tipo) {
  const r = historialDatos.find(x => x.id === id && x.tipo === tipo);
  if (!r) return;

  const estadoIcono = { retornada:"✅", no_retornada:"❌", danada:"🔴", perdida:"⚠️", entregada:"✅" };
  const estadoColor = { retornada:"var(--verde)", no_retornada:"var(--rojo)", danada:"var(--rojo)", perdida:"var(--naranja,#f97316)", entregada:"var(--verde)" };

  const totalHerHist = (r.herramientas||[]).reduce((sum, h) => sum + (h.cantidad || 1), 0);
  const herramientasHtml = (r.herramientas||[]).map(h => `
    <div class="modal-herramienta-item">
      <span style="display:flex;align-items:center;gap:8px">${herFotoHtmlPorNombre(h.nombre)}<span>${escapeHtml(h.nombre)}${h.adicional ? ' <span style="color:var(--verde);font-size:10px">(adicional)</span>' : ""}</span></span>
      <span style="color:var(--verde);font-weight:700">x${h.cantidad}</span>
    </div>`).join("") || "<p style='color:var(--texto-dim);font-size:13px'>Sin herramientas</p>";

  const retornoHtml = r.herramientasRetorno ? `
    <div class="modal-campo">
      <label>Estado de retorno por herramienta</label>
      <div class="modal-herramientas">
        ${r.herramientasRetorno.map(h => `
          <div class="modal-herramienta-item">
            <span>${escapeHtml(h.nombre)}</span>
            <span style="color:${estadoColor[h.estadoRetorno]||"var(--texto-dim)"};font-weight:700">
              ${estadoIcono[h.estadoRetorno]||""} ${h.estadoRetorno||"—"}
            </span>
          </div>`).join("")}
      </div>
    </div>` : "";

  document.getElementById("modal-hist-titulo").textContent =
    tipo === "estudiante" ? "🎓 Solicitud de Estudiante" :
    tipo === "profesor"   ? "👨‍🏫 Préstamo a Profesor" : "🏢 Salida a Departamento Externo";

  const datosPersona = tipo === "externo" ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="modal-campo"><label>Departamento</label><div class="valor">${escapeHtml(r.departamento)||"—"}</div></div>
      <div class="modal-campo"><label>Responsable que retira</label><div class="valor">${escapeHtml(r.responsable)||"—"}</div></div>
    </div>` : tipo === "profesor" ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="modal-campo"><label>Profesor</label><div class="valor">${escapeHtml(r.profesor)||"—"}</div></div>
      <div class="modal-campo"><label>Laboratorio / Taller</label><div class="valor">${escapeHtml(r.laboratorio)||"—"}</div></div>
    </div>` : `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="modal-campo"><label>Nombre</label><div class="valor">${escapeHtml(r.nombre)||""} ${escapeHtml(r.apellido)||""}</div></div>
      <div class="modal-campo"><label>Matrícula</label><div class="valor">${escapeHtml(r.matricula)||"—"}</div></div>
      ${r.ciclo    ? `<div class="modal-campo"><label>Ciclo</label><div class="valor">${escapeHtml(r.ciclo)}</div></div>` : ""}
      ${r.telefono ? `<div class="modal-campo"><label>Teléfono</label><div class="valor">${escapeHtml(r.telefono)}</div></div>` : ""}
      <div class="modal-campo"><label>Profesor</label><div class="valor">${escapeHtml(r.profesor)||escapeHtml(r.nombreProfesor)||"—"}</div></div>
      <div class="modal-campo"><label>Laboratorio / Taller</label><div class="valor">${escapeHtml(r.laboratorio)||escapeHtml(r.taller)||"—"}</div></div>
    </div>`;

  document.getElementById("modal-hist-contenido").innerHTML = `
    <div class="modal-campo"><label>Número / Referencia</label>
      <div class="valor">${r.numeroSolicitud || r.id.slice(0,10)}</div></div>
    ${datosPersona}
    <div class="modal-campo"><label>Estado</label>
      <span class="badge badge-${histEstadoInfo(r).cls}">${histEstadoInfo(r).txt}</span>
      ${r.tieneIncidencias ? '<span class="badge badge-cancelada" style="margin-left:6px">⚠️ Con incidencias</span>' : ""}
    </div>
    <div class="modal-campo"><label>Fecha de solicitud</label><div class="valor">${formatFecha(r.creadoEn)}</div></div>
    ${r.entregadoEn  ? `<div class="modal-campo"><label>Fecha de entrega</label><div class="valor">${formatFecha(r.entregadoEn)}</div></div>` : ""}
    ${r.retornadoEn  ? `<div class="modal-campo"><label>Fecha de retorno</label><div class="valor">${formatFecha(r.retornadoEn)}</div></div>` : ""}
    <div class="modal-campo">
      <label>Herramientas solicitadas <span style="color:var(--verde);font-weight:800">(${totalHerHist} en total)</span></label>
      <div class="modal-herramientas">${herramientasHtml}</div>
    </div>
    ${retornoHtml}
    ${(tipo === "profesor" && r.estado === "activo") ? `
    <div class="modal-acciones">
      <button class="btn btn-azul" onclick="document.getElementById('modal-hist').classList.remove('abierto');abrirRetornoProf('${r.id}')">↩ Registrar retorno</button>
    </div>` : ""}
  `;

  document.getElementById("modal-hist").classList.add("abierto");
};

document.getElementById("modal-hist")?.addEventListener("click", e => {
  if (e.target === document.getElementById("modal-hist"))
    document.getElementById("modal-hist").classList.remove("abierto");
});

// Dibuja los íconos de línea del sidebar (Feather Icons, cargado por CDN)
if (window.lucide) lucide.createIcons();
