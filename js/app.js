// js/app.js
import { db, collection, addDoc, getDocs, query, orderBy, serverTimestamp, where, updateDoc, doc, Timestamp } from "./firebase.js";
import { cargarProfesores, cargarLaboratorios, cargarHerramientas } from "./inventario.js";

// ---- Pantallas ----
const pantallasBienvenida  = document.getElementById("pantalla-bienvenida");
const pantallaTaller       = document.getElementById("pantalla-taller");
const pantallaFormulario   = document.getElementById("pantalla-formulario");
const pantallaEpp          = document.getElementById("pantalla-epp");
const pantallaFinal        = document.getElementById("pantalla-final");

function mostrarPantalla(el) {
  [pantallasBienvenida, pantallaTaller, pantallaFormulario, pantallaEpp, pantallaFinal]
    .forEach(p => p.classList.add("oculto"));
  el.classList.remove("oculto");
  window.scrollTo(0, 0);
}

document.getElementById("btn-ir-taller").addEventListener("click", () => {
  mostrarPantalla(pantallaTaller);
});

document.getElementById("btn-ir-formulario").addEventListener("click", () => {
  mostrarPantalla(pantallaFormulario);
});

// ---- Formulario ----
const form              = document.getElementById("form-solicitud");
const selectProfesor    = document.getElementById("profesor");
const selectLaboratorio = document.getElementById("laboratorio");
const gridHerramientas  = document.getElementById("grid-herramientas");
const btnEnviar         = document.getElementById("btn-enviar");
const btnContinuar      = document.getElementById("btn-continuar");
const btnNuevaSolicitud = document.getElementById("btn-nueva-solicitud");
const textoNumeroSol    = document.getElementById("texto-numero-solicitud");
const textoDespedida    = document.getElementById("texto-despedida");

// ---- Cámara ----
const btnCamara       = document.getElementById("btn-camara");
const inputCamara     = document.getElementById("input-camara");
const fotoPreviewWrap = document.getElementById("foto-preview-wrap");
const fotoPreview     = document.getElementById("foto-preview");
const btnQuitarFoto   = document.getElementById("btn-quitar-foto");

btnCamara.addEventListener("click", () => inputCamara.click());

inputCamara.addEventListener("change", () => {
  const file = inputCamara.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  fotoPreview.src = url;
  fotoPreviewWrap.classList.remove("oculto");
});

btnQuitarFoto.addEventListener("click", () => {
  fotoPreview.src = "";
  inputCamara.value = "";
  fotoPreviewWrap.classList.add("oculto");
});

// ---- Estado herramientas ----
let herramientasDisponibles = [];
let cantidadesSeleccionadas = {};
let datosSolicitudPendiente = null;

// ---- Modal duplicado ----
let solicitudExistenteId   = null;
let solicitudExistente     = null;
let cantidadesModalExtra   = {};

function mostrarError(msg) {
  const toast = document.createElement("div");
  toast.className = "toast-error";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function llenarSelect(select, items, campo) {
  items.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item[campo] || item.nombre;
    opt.textContent = item[campo] || item.nombre;
    select.appendChild(opt);
  });
}

function renderizarHerramientas(herramientas) {
  gridHerramientas.innerHTML = "";
  herramientas.forEach(h => {
    cantidadesSeleccionadas[h.codigo] = 0;
    const maxDisponible = Number.isFinite(h.cantidadDisponible) ? h.cantidadDisponible : 5;

    const card = document.createElement("div");
    card.className = "tarjeta-herramienta";
    card.innerHTML = `
      <div class="icono">
        <img src="${h.imagen}" alt="${h.nombre}"
             onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'icono-respaldo',textContent:'${h.icono || "🔧"}'}))">
      </div>
      <div class="nombre">${h.nombre}</div>
      <div class="disponible">Disp. ${maxDisponible}</div>
      <div class="contador">
        <button type="button" data-codigo="${h.codigo}" data-accion="restar">−</button>
        <span class="cantidad" id="cant-${h.codigo}">0</span>
        <button type="button" data-codigo="${h.codigo}" data-accion="sumar" ${maxDisponible === 0 ? "disabled" : ""}>+</button>
      </div>
    `;
    gridHerramientas.appendChild(card);
  });
}

gridHerramientas.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-codigo]");
  if (!btn) return;

  const codigo = btn.dataset.codigo;
  const accion = btn.dataset.accion;
  const info = herramientasDisponibles.find(h => h.codigo === codigo);
  const maxDisponible = info && Number.isFinite(info.cantidadDisponible) ? info.cantidadDisponible : 5;

  let cantidad = cantidadesSeleccionadas[codigo] || 0;

  if (accion === "sumar") {
    if (cantidad >= maxDisponible) {
      mostrarError(`Solo hay ${maxDisponible} disponible(s) de "${info ? info.nombre : codigo}".`);
      return;
    }
    cantidad += 1;
  }
  if (accion === "restar" && cantidad > 0) cantidad -= 1;

  cantidadesSeleccionadas[codigo] = cantidad;
  document.getElementById(`cant-${codigo}`).textContent = cantidad;

  const btnSumar = gridHerramientas.querySelector(`button[data-codigo="${codigo}"][data-accion="sumar"]`);
  if (btnSumar) btnSumar.disabled = cantidad >= maxDisponible;
});

async function inicializar() {
  const [profesores, laboratorios, herramientas] = await Promise.all([
    cargarProfesores(),
    cargarLaboratorios(),
    cargarHerramientas()
  ]);

  llenarSelect(selectProfesor, profesores, "nombre");
  llenarSelect(selectLaboratorio, laboratorios, "nombre");

  herramientasDisponibles = herramientas;
  renderizarHerramientas(herramientas);
}

function validarFormulario() {
  const requeridos = ["nombre", "apellido", "matricula", "ciclo", "telefono", "profesor", "laboratorio"];
  for (const id of requeridos) {
    const campo = document.getElementById(id);
    if (!campo.value.trim()) {
      campo.classList.add("error-campo");
      mostrarError("Completa todos los campos obligatorios.");
      campo.focus();
      return false;
    }
    campo.classList.remove("error-campo");
  }

  const campoMatricula = document.getElementById("matricula");
  const regexMatricula = /^\d-\d{2}-\d{4}$/;
  if (!regexMatricula.test(campoMatricula.value.trim())) {
    campoMatricula.classList.add("error-campo");
    mostrarError("La matrícula debe tener el formato 0-00-0000 (ej. 1-19-0117).");
    campoMatricula.focus();
    return false;
  }
  campoMatricula.classList.remove("error-campo");

  const campoTelefono = document.getElementById("telefono");
  const telefonoLimpio = campoTelefono.value.trim().replace(/[\s-]/g, "");
  const regexTelefono = /^(809|829|849)\d{7}$/;
  if (!regexTelefono.test(telefonoLimpio)) {
    campoTelefono.classList.add("error-campo");
    mostrarError("El teléfono debe ser un número dominicano válido (809/829/849 + 7 dígitos).");
    campoTelefono.focus();
    return false;
  }
  campoTelefono.classList.remove("error-campo");

  const herramientasElegidas = Object.entries(cantidadesSeleccionadas).filter(([_, c]) => c > 0);
  if (herramientasElegidas.length === 0) {
    mostrarError("Selecciona al menos una herramienta.");
    return false;
  }

  return true;
}

// ---- Verificar matrícula duplicada hoy ----
async function buscarSolicitudActivaHoy(matricula) {
  const hoy = new Date();
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 0, 0, 0);
  const fin    = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate(), 23, 59, 59);

  const snap = await getDocs(
    query(
      collection(db, "solicitudes"),
      where("matricula", "==", matricula),
      where("creadoEn", ">=", Timestamp.fromDate(inicio)),
      where("creadoEn", "<=", Timestamp.fromDate(fin))
    )
  );

  if (snap.empty) return null;
  // Busca pendiente o entregada (no completamente retornada)
  let found = null;
  snap.forEach(d => {
    const datos = d.data();
    if (datos.estado === "pendiente" || datos.estado === "entregada") {
      found = { id: d.id, ...datos };
    }
  });
  return found;
}

// ---- Modal de solicitud duplicada ----
function abrirModalDuplicado(solicitud, herramientasDisp) {
  solicitudExistenteId = solicitud.id;
  solicitudExistente   = solicitud;
  cantidadesModalExtra = {};

  // Herramientas ya en la solicitud
  const listaActual = (solicitud.herramientas || [])
    .map(h => `<li>${h.nombre} × ${h.cantidad}</li>`)
    .join("");

  // Grid de herramientas adicionales
  let gridHtml = "";
  herramientasDisp.forEach(h => {
    cantidadesModalExtra[h.codigo] = 0;
    const max = Number.isFinite(h.cantidadDisponible) ? h.cantidadDisponible : 5;
    gridHtml += `
      <div class="tarjeta-herramienta" style="font-size:0.85rem">
        <div class="nombre" style="font-size:0.8rem">${h.nombre}</div>
        <div class="disponible">Disp. ${max}</div>
        <div class="contador">
          <button type="button" data-mcodigo="${h.codigo}" data-maccion="restar">−</button>
          <span id="mcant-${h.codigo}">0</span>
          <button type="button" data-mcodigo="${h.codigo}" data-maccion="sumar" ${max === 0 ? "disabled" : ""}>+</button>
        </div>
      </div>
    `;
  });

  const modal = document.createElement("div");
  modal.id = "modal-duplicado";
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.82);
    display:flex;align-items:center;justify-content:center;
    z-index:9999;padding:1rem;
  `;
  modal.innerHTML = `
    <div style="background:#1a1a2e;border-radius:12px;padding:1.5rem;max-width:480px;width:100%;max-height:90vh;overflow-y:auto;color:#fff">
      <h2 style="margin:0 0 0.5rem;color:#f59e0b">⚠️ Ya tienes una solicitud activa hoy</h2>
      <p style="margin:0 0 1rem;color:#ccc;font-size:0.9rem">Solicitud #${solicitud.numeroSolicitud || solicitud.id}</p>
      <p style="margin:0 0 0.4rem;font-size:0.85rem;color:#aaa">Herramientas ya solicitadas:</p>
      <ul style="margin:0 0 1rem;padding-left:1.2rem;color:#fff;font-size:0.85rem">${listaActual}</ul>
      <p style="margin:0 0 0.6rem;font-size:0.9rem;color:#4ade80">Agregar más herramientas a esta solicitud:</p>
      <div id="modal-grid-herramientas" class="grid-herramientas" style="margin-bottom:1rem">
        ${gridHtml}
      </div>
      <div style="display:flex;gap:0.75rem;justify-content:flex-end">
        <button id="btn-modal-cancelar" style="padding:0.6rem 1.2rem;border-radius:8px;border:1px solid #555;background:transparent;color:#ccc;cursor:pointer">Cancelar</button>
        <button id="btn-modal-agregar" style="padding:0.6rem 1.2rem;border-radius:8px;border:none;background:#4ade80;color:#000;font-weight:700;cursor:pointer">+ Agregar herramientas</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // Eventos del grid del modal
  document.getElementById("modal-grid-herramientas").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-mcodigo]");
    if (!btn) return;
    const codigo = btn.dataset.mcodigo;
    const accion = btn.dataset.maccion;
    const info = herramientasDisp.find(h => h.codigo === codigo);
    const max = info && Number.isFinite(info.cantidadDisponible) ? info.cantidadDisponible : 5;
    let cant = cantidadesModalExtra[codigo] || 0;
    if (accion === "sumar") {
      if (cant >= max) { mostrarError(`Solo hay ${max} disponible(s).`); return; }
      cant += 1;
    }
    if (accion === "restar" && cant > 0) cant -= 1;
    cantidadesModalExtra[codigo] = cant;
    document.getElementById(`mcant-${codigo}`).textContent = cant;
  });

  document.getElementById("btn-modal-cancelar").addEventListener("click", () => {
    modal.remove();
  });

  document.getElementById("btn-modal-agregar").addEventListener("click", async () => {
    const nuevas = Object.entries(cantidadesModalExtra)
      .filter(([_, c]) => c > 0)
      .map(([codigo, cantidad]) => {
        const info = herramientasDisp.find(h => h.codigo === codigo);
        return { codigo, nombre: info ? info.nombre : codigo, cantidad };
      });

    if (nuevas.length === 0) {
      mostrarError("Selecciona al menos una herramienta para agregar.");
      return;
    }

    const btnAgregar = document.getElementById("btn-modal-agregar");
    btnAgregar.disabled = true;
    btnAgregar.textContent = "Guardando...";

    try {
      // Unir con las existentes (si ya hay, sumar cantidades)
      const existentes = solicitudExistente.herramientas || [];
      const mapa = {};
      existentes.forEach(h => { mapa[h.codigo] = { ...h }; });
      nuevas.forEach(h => {
        if (mapa[h.codigo]) {
          mapa[h.codigo].cantidad += h.cantidad;
        } else {
          mapa[h.codigo] = { ...h };
        }
      });

      await updateDoc(doc(db, "solicitudes", solicitudExistenteId), {
        herramientas: Object.values(mapa)
      });

      modal.remove();
      textoNumeroSol.textContent = `Solicitud #${solicitudExistente.numeroSolicitud || solicitudExistenteId}`;
      textoDespedida.textContent = `Se agregaron ${nuevas.length} herramienta(s) a tu solicitud activa.`;
      mostrarPantalla(pantallaFinal);
    } catch (err) {
      console.error(err);
      mostrarError("No se pudo actualizar la solicitud. Revisa tu conexión.");
      btnAgregar.disabled = false;
      btnAgregar.textContent = "+ Agregar herramientas";
    }
  });
}

async function generarNumeroSolicitud() {
  const anio = new Date().getFullYear();
  try {
    const snap = await getDocs(query(collection(db, "solicitudes"), orderBy("creadoEn", "desc")));
    const consecutivo = snap.size + 1;
    return `${anio}-${String(consecutivo).padStart(5, "0")}`;
  } catch {
    return `${anio}-${String(Date.now()).slice(-5)}`;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validarFormulario()) return;

  btnEnviar.disabled = true;
  btnEnviar.textContent = "Verificando...";

  const matricula = document.getElementById("matricula").value.trim();

  try {
    const solicitudActiva = await buscarSolicitudActivaHoy(matricula);

    if (solicitudActiva) {
      // Abrir modal en lugar de crear nueva
      btnEnviar.disabled = false;
      btnEnviar.textContent = "Enviar Solicitud";
      abrirModalDuplicado(solicitudActiva, herramientasDisponibles);
      return;
    }
  } catch (err) {
    console.error("Error al verificar matrícula:", err);
    // Si falla la verificación, continuar igual
  }

  const herramientasElegidas = Object.entries(cantidadesSeleccionadas)
    .filter(([_, c]) => c > 0)
    .map(([codigo, cantidad]) => {
      const info = herramientasDisponibles.find(h => h.codigo === codigo);
      return { codigo, nombre: info ? info.nombre : codigo, cantidad };
    });

  datosSolicitudPendiente = {
    nombre:       document.getElementById("nombre").value.trim(),
    apellido:     document.getElementById("apellido").value.trim(),
    matricula,
    ciclo:        document.getElementById("ciclo").value,
    telefono:     document.getElementById("telefono").value.trim(),
    profesor:     document.getElementById("profesor").value,
    laboratorio:  document.getElementById("laboratorio").value,
    herramientas: herramientasElegidas,
    estado:       "pendiente",
    creadoEn:     serverTimestamp()
  };

  mostrarPantalla(pantallaEpp);
  btnEnviar.disabled = false;
  btnEnviar.textContent = "Enviar Solicitud";
});

btnContinuar.addEventListener("click", async () => {
  btnContinuar.disabled = true;
  btnContinuar.textContent = "Guardando...";

  try {
    const numero = await generarNumeroSolicitud();
    datosSolicitudPendiente.numeroSolicitud = numero;
    await addDoc(collection(db, "solicitudes"), datosSolicitudPendiente);

    textoNumeroSol.textContent = `Solicitud #${numero}`;
    textoDespedida.textContent = `Gracias, ${datosSolicitudPendiente.nombre}. Tu solicitud de herramientas ha sido registrada exitosamente.`;

    mostrarPantalla(pantallaFinal);
  } catch (err) {
    console.error(err);
    mostrarError("No se pudo guardar la solicitud. Verifica tu conexión o la configuración de Firebase.");
  } finally {
    btnContinuar.disabled = false;
    btnContinuar.textContent = "Continuar";
  }
});

btnNuevaSolicitud.addEventListener("click", () => {
  form.reset();
  cantidadesSeleccionadas = {};
  renderizarHerramientas(herramientasDisponibles);
  fotoPreview.src = "";
  inputCamara.value = "";
  fotoPreviewWrap.classList.add("oculto");
  mostrarPantalla(pantallasBienvenida);
});

inicializar();
