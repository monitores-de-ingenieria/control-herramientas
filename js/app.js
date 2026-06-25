// js/app.js
import { db, collection, addDoc, getDocs, query, orderBy, serverTimestamp, where, updateDoc, doc } from "./firebase.js";
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
const selectTipo        = document.getElementById("tipo-solicitud");
const gridHerramientas  = document.getElementById("grid-herramientas");
const btnEnviar         = document.getElementById("btn-enviar");
const btnContinuar      = document.getElementById("btn-continuar");
const btnNuevaSolicitud = document.getElementById("btn-nueva-solicitud");
const textoNumeroSol    = document.getElementById("texto-numero-solicitud");
const textoDespedida    = document.getElementById("texto-despedida");

// ---- Elementos de "Agregar herramientas adicionales" ----
const formularioCompleto = document.getElementById("formulario-completo");
const seccionAdicional   = document.getElementById("seccion-adicional");
const inputMatriculaAdicional = document.getElementById("matricula-adicional");
const btnBuscarAdicional      = document.getElementById("btn-buscar-adicional");

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

// ---- Mostrar/ocultar secciones según tipo ----
function toggleSecciones() {
  const esAdicional = selectTipo.value === "adicional";
  formularioCompleto.style.display = esAdicional ? "none" : "block";
  seccionAdicional.style.display = esAdicional ? "block" : "none";
  document.querySelectorAll("#formulario-completo input, #formulario-completo select")
    .forEach(el => el.required = !esAdicional);
}

selectTipo.addEventListener("change", toggleSecciones);
setTimeout(toggleSecciones, 50);

// ---- Buscar solicitud activa para agregar herramientas ----
btnBuscarAdicional.addEventListener("click", async () => {
  const matricula = inputMatriculaAdicional.value.trim();
  if (!matricula) {
    mostrarError("Ingresa tu matrícula.");
    return;
  }
  if (!/^\d-\d{2}-\d{4}$/.test(matricula)) {
    mostrarError("La matrícula debe tener el formato 0-00-0000 (ej. 1-19-0117).");
    return;
  }

  btnBuscarAdicional.disabled = true;
  btnBuscarAdicional.textContent = "Buscando...";

  try {
    const solicitud = await buscarSolicitudActivaHoy(matricula);
    if (!solicitud) {
      mostrarError("No tienes una solicitud activa hoy. Selecciona 'Solicitando herramientas' para crear una nueva.");
      btnBuscarAdicional.disabled = false;
      btnBuscarAdicional.textContent = "Buscar solicitud activa";
      return;
    }
    if (solicitud.estado === "retornada" || solicitud.estado === "cancelada") {
      mostrarError(`Esta solicitud ya está ${solicitud.estado}. No se pueden agregar más herramientas.`);
      btnBuscarAdicional.disabled = false;
      btnBuscarAdicional.textContent = "Buscar solicitud activa";
      return;
    }
    abrirModalDuplicado(solicitud, herramientasDisponibles);
  } catch (err) {
    console.error("Error al buscar solicitud:", err);
    mostrarError("Error al buscar la solicitud. Intenta de nuevo.");
  }

  btnBuscarAdicional.disabled = false;
  btnBuscarAdicional.textContent = "Buscar solicitud activa";
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
  if (selectTipo.value === "adicional") {
    const matricula = inputMatriculaAdicional.value.trim();
    if (!matricula) {
      mostrarError("Ingresa tu matrícula en el campo correspondiente.");
      inputMatriculaAdicional.focus();
      return false;
    }
    if (!/^\d-\d{2}-\d{4}$/.test(matricula)) {
      mostrarError("La matrícula debe tener el formato 0-00-0000 (ej. 1-19-0117).");
      inputMatriculaAdicional.focus();
      return false;
    }
    return true;
  }

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
  const inicio = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);

  try {
    const snap = await getDocs(
      query(
        collection(db, "solicitudes"),
        where("matricula", "==", matricula)
      )
    );

    if (snap.empty) return null;

    let found = null;
    snap.forEach(d => {
      const data = d.data();
      const creado = data.creadoEn?.toDate?.() || new Date(data.creadoEn);
      if (creado >= inicio && creado < fin) {
        if (data.estado === "pendiente" || data.estado === "entregada") {
          found = { id: d.id, ...data };
        }
      }
    });
    return found;
  } catch (err) {
    console.error("Error en buscarSolicitudActivaHoy:", err);
    return null;
  }
}

// ---- Modal de solicitud duplicada ----
function abrirModalDuplicado(solicitud, herramientasDisp) {
  solicitudExistenteId = solicitud.id;
  solicitudExistente = solicitud;
  cantidadesModalExtra = {};

  // Mostrar herramientas existentes con indicador si son adicionales
  const listaActual = (solicitud.herramientas || [])
    .map(h => `<li style="color:#e6edf3">${h.nombre} × ${h.cantidad}${h.adicional ? ' <span style="color:#f59e0b;font-size:0.75rem">(adicional)</span>' : ''}</li>`)
    .join("");

  let gridHtml = "";
  herramientasDisp.forEach(h => {
    cantidadesModalExtra[h.codigo] = 0;
    const max = Number.isFinite(h.cantidadDisponible) ? h.cantidadDisponible : 5;
    gridHtml += `
      <div style="background:#1c2128;border:1px solid #30363d;border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:0.85rem;font-weight:600;color:#e6edf3">${h.nombre}</div>
        <div style="font-size:0.75rem;color:#7d8590">Disp. ${max}</div>
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:6px">
          <button type="button" data-mcodigo="${h.codigo}" data-maccion="restar" style="background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:4px;width:28px;height:28px;cursor:pointer;font-size:16px">−</button>
          <span id="mcant-${h.codigo}" style="color:#e6edf3;font-weight:700;min-width:24px;text-align:center">0</span>
          <button type="button" data-mcodigo="${h.codigo}" data-maccion="sumar" ${max === 0 ? "disabled" : ""} style="background:#0d1117;border:1px solid #30363d;color:#e6edf3;border-radius:4px;width:28px;height:28px;cursor:pointer;font-size:16px">+</button>
        </div>
      </div>
    `;
  });

  const modal = document.createElement("div");
  modal.id = "modal-duplicado";
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.85);
    display:flex;align-items:center;justify-content:center;
    z-index:9999;padding:1rem;
  `;
  modal.innerHTML = `
    <div style="background:#0d1117;border:1px solid #30363d;border-radius:12px;padding:1.5rem;max-width:520px;width:100%;max-height:90vh;overflow-y:auto">
      <h2 style="margin:0 0 0.5rem;color:#f59e0b;font-size:1.2rem">⚠️ Ya tienes una solicitud activa hoy</h2>
      <p style="margin:0 0 1rem;color:#7d8590;font-size:0.9rem">Solicitud #${solicitud.numeroSolicitud || solicitud.id} · Estado: <span style="color:#3fb950;font-weight:700">${solicitud.estado}</span></p>
      <p style="margin:0 0 0.4rem;font-size:0.85rem;color:#7d8590">Herramientas ya solicitadas:</p>
      <ul style="margin:0 0 1rem;padding-left:1.2rem;color:#e6edf3;font-size:0.85rem">${listaActual}</ul>
      <p style="margin:0 0 0.6rem;font-size:0.9rem;color:#3fb950">Agregar más herramientas a esta solicitud:</p>
      <div id="modal-grid-herramientas" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:1rem">
        ${gridHtml}
      </div>
      <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:12px">
        <button id="btn-modal-cancelar" style="padding:0.6rem 1.2rem;border-radius:8px;border:1px solid #30363d;background:transparent;color:#7d8590;cursor:pointer">Cancelar</button>
        <button id="btn-modal-agregar" style="padding:0.6rem 1.2rem;border-radius:8px;border:none;background:#3fb950;color:#000;font-weight:700;cursor:pointer">+ Agregar herramientas</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // ---- Eventos del grid del modal ----
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

  // ---- Botón Cancelar ----
  document.getElementById("btn-modal-cancelar").addEventListener("click", () => {
    modal.remove();
  });

  // ---- Botón AGREGAR HERRAMIENTAS (CON MARCADOR "adicional: true") ----
  document.getElementById("btn-modal-agregar").addEventListener("click", async () => {
    const nuevas = Object.entries(cantidadesModalExtra)
      .filter(([_, c]) => c > 0)
      .map(([codigo, cantidad]) => {
        const info = herramientasDisp.find(h => h.codigo === codigo);
        return { 
          codigo, 
          nombre: info ? info.nombre : codigo, 
          cantidad,
          adicional: true  // 👈 MARCADOR: indica que fue agregada después
        };
      });

    if (nuevas.length === 0) {
      mostrarError("Selecciona al menos una herramienta para agregar.");
      return;
    }

    const btnAgregar = document.getElementById("btn-modal-agregar");
    btnAgregar.disabled = true;
    btnAgregar.textContent = "Guardando...";

    try {
      const existentes = solicitudExistente.herramientas || [];
      const mapa = {};
      
      // Mantener las existentes (incluyendo su propiedad 'adicional' si la tienen)
      existentes.forEach(h => { 
        mapa[h.codigo] = { ...h }; 
      });
      
      // Agregar o sumar nuevas (con adicional: true)
      nuevas.forEach(h => {
        if (mapa[h.codigo]) {
          mapa[h.codigo].cantidad += h.cantidad;
          // Si ya existía pero no tenía el marcador, se lo ponemos
          mapa[h.codigo].adicional = true;
        } else {
          mapa[h.codigo] = { ...h };
        }
      });

      await updateDoc(doc(db, "solicitudes", solicitudExistenteId), {
        herramientas: Object.values(mapa)
      });

      modal.remove();
      textoNumeroSol.textContent = `Solicitud #${solicitudExistente.numeroSolicitud || solicitudExistenteId}`;
      textoDespedida.textContent = `Se agregaron ${nuevas.length} herramienta(s) adicional(es) a tu solicitud activa.`;
      mostrarPantalla(pantallaFinal);
      
    } catch (err) {
      console.error("Error al agregar herramientas:", err);
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

  if (selectTipo.value === "adicional") {
    btnEnviar.disabled = false;
    btnEnviar.textContent = "Enviar Solicitud";
    mostrarError("Usa el botón 'Buscar solicitud activa' para agregar herramientas.");
    return;
  }

  const matricula = document.getElementById("matricula").value.trim();

  try {
    const solicitudActiva = await buscarSolicitudActivaHoy(matricula);
    if (solicitudActiva) {
      btnEnviar.disabled = false;
      btnEnviar.textContent = "Enviar Solicitud";
      if (confirm("Ya tienes una solicitud activa hoy. ¿Quieres agregar herramientas a esa solicitud?\n\nPresiona 'Aceptar' para agregar, o 'Cancelar' para crear una nueva solicitud.")) {
        abrirModalDuplicado(solicitudActiva, herramientasDisponibles);
        return;
      }
    }
  } catch (err) {
    console.error("Error al verificar matrícula:", err);
  }

  const herramientasElegidas = Object.entries(cantidadesSeleccionadas)
    .filter(([_, c]) => c > 0)
    .map(([codigo, cantidad]) => {
      const info = herramientasDisponibles.find(h => h.codigo === codigo);
      return { 
        codigo, 
        nombre: info ? info.nombre : codigo, 
        cantidad,
        adicional: false  // Las de la solicitud original no son adicionales
      };
    });

  datosSolicitudPendiente = {
    nombre:       document.getElementById("nombre").value.trim(),
    apellido:     document.getElementById("apellido").value.trim(),
    matricula:    document.getElementById("matricula").value.trim(),
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
  selectTipo.value = "solicitando";
  toggleSecciones();
  mostrarPantalla(pantallasBienvenida);
});

inicializar();