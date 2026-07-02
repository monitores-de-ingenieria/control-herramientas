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

// Clave estable para identificar una herramienta, con o sin campo "codigo".
// Las herramientas subidas desde el panel solo tienen id de Firestore.
function claveHerramienta(h) {
  return h.codigo || h.id;
}

function crearTarjetaHerramienta(h) {
  const key = claveHerramienta(h);
  cantidadesSeleccionadas[key] = 0;
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
      <button type="button" data-codigo="${key}" data-accion="restar">−</button>
      <span class="cantidad" id="cant-${key}">0</span>
      <button type="button" data-codigo="${key}" data-accion="sumar" ${maxDisponible === 0 ? "disabled" : ""}>+</button>
    </div>
  `;
  return card;
}

function renderizarHerramientas(herramientas) {
  gridHerramientas.innerHTML = "";

  // Agrupar por "practica" (campo opcional asignado desde el panel admin).
  // Las que no tienen práctica asignada van sueltas, sin encabezado.
  const grupos = new Map();
  const sinGrupo = [];
  herramientas.forEach(h => {
    if (h.practica) {
      if (!grupos.has(h.practica)) grupos.set(h.practica, []);
      grupos.get(h.practica).push(h);
    } else {
      sinGrupo.push(h);
    }
  });

  [...grupos.keys()].sort((a, b) => a.localeCompare(b)).forEach(practica => {
    const header = document.createElement("div");
    header.className = "grupo-practica-header";
    header.innerHTML = `
      <span class="grupo-practica-titulo">🏷️ ${practica}</span>
      <button type="button" class="btn-combo" data-practica="${practica}">+ Agregar combo completo</button>
    `;
    gridHerramientas.appendChild(header);

    const cont = document.createElement("div");
    cont.className = "grid-herramientas";
    grupos.get(practica).forEach(h => cont.appendChild(crearTarjetaHerramienta(h)));
    gridHerramientas.appendChild(cont);
  });

  if (sinGrupo.length) {
    if (grupos.size) {
      const header = document.createElement("div");
      header.className = "grupo-practica-header";
      header.innerHTML = `<span class="grupo-practica-titulo">🔧 Otras herramientas</span>`;
      gridHerramientas.appendChild(header);
    }
    const cont = document.createElement("div");
    cont.className = "grid-herramientas";
    sinGrupo.forEach(h => cont.appendChild(crearTarjetaHerramienta(h)));
    gridHerramientas.appendChild(cont);
  }
}

// Marca 1 unidad de cada herramienta del grupo indicado (si hay disponibilidad).
function agregarComboCompleto(practica) {
  const tools = herramientasDisponibles.filter(h => h.practica === practica);
  const sinDisponibilidad = [];

  tools.forEach(h => {
    const key = claveHerramienta(h);
    const max = Number.isFinite(h.cantidadDisponible) ? h.cantidadDisponible : 5;
    if (max === 0) { sinDisponibilidad.push(h.nombre); return; }
    if ((cantidadesSeleccionadas[key] || 0) >= 1) return; // ya estaba marcada

    cantidadesSeleccionadas[key] = 1;
    const span = document.getElementById(`cant-${key}`);
    if (span) span.textContent = "1";
    const card = gridHerramientas.querySelector(`button[data-codigo="${key}"]`)?.closest(".tarjeta-herramienta");
    if (card) card.classList.add("seleccionada");
    const btnSumar = gridHerramientas.querySelector(`button[data-codigo="${key}"][data-accion="sumar"]`);
    if (btnSumar) btnSumar.disabled = 1 >= max;
  });

  if (sinDisponibilidad.length) {
    mostrarError(`Sin disponibilidad ahora mismo: ${sinDisponibilidad.join(", ")}.`);
  }
}

gridHerramientas.addEventListener("click", (e) => {
  const comboBtn = e.target.closest("button.btn-combo");
  if (comboBtn) {
    agregarComboCompleto(comboBtn.dataset.practica);
    return;
  }

  const btn = e.target.closest("button[data-codigo]");
  if (!btn) return;

  const codigo = btn.dataset.codigo;
  const accion = btn.dataset.accion;
  const info = herramientasDisponibles.find(h => claveHerramienta(h) === codigo);
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

  // Marcar/desmarcar tarjeta visualmente
  const card = gridHerramientas.querySelector(`button[data-codigo="${codigo}"]`)?.closest(".tarjeta-herramienta");
  if (card) card.classList.toggle("seleccionada", cantidad > 0);

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

  // Herramientas ya solicitadas
  const listaActual = (solicitud.herramientas || [])
    .map(h => `
      <li style="padding:3px 0;display:flex;align-items:center;gap:6px">
        <span style="color:var(--verde);font-weight:700">${h.cantidad}×</span>
        ${h.nombre}
        ${h.adicional ? '<span style="background:var(--amarillo);color:#333;font-size:10px;font-weight:700;padding:1px 5px;border-radius:4px">adicional</span>' : ''}
      </li>`)
    .join("");

  // Grid de herramientas con las mismas clases del formulario
  let gridHtml = "";
  herramientasDisp.forEach(h => {
    const key = claveHerramienta(h);
    cantidadesModalExtra[key] = 0;
    const max = Number.isFinite(h.cantidadDisponible) ? h.cantidadDisponible : 5;
    gridHtml += `
      <div class="tarjeta-herramienta">
        <div class="icono">
          <img src="${h.imagen}" alt="${h.nombre}"
               onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'icono-respaldo',textContent:'${h.icono || "🔧"}'}))">
        </div>
        <div class="nombre">${h.nombre}</div>
        <div class="disponible">Disp. ${max}</div>
        <div class="contador">
          <button type="button" data-mcodigo="${key}" data-maccion="restar">−</button>
          <span class="cantidad" id="mcant-${key}">0</span>
          <button type="button" data-mcodigo="${key}" data-maccion="sumar" ${max === 0 ? "disabled" : ""}>+</button>
        </div>
      </div>
    `;
  });

  const modal = document.createElement("div");
  modal.id = "modal-duplicado";
  modal.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.6);
    display:flex;align-items:center;justify-content:center;
    z-index:9999;padding:16px;
  `;
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 4px 24px rgba(0,0,0,0.18)">

      <!-- Encabezado tipo taller-header -->
      <div style="background:var(--verde-oscuro);border-radius:12px 12px 0 0;padding:18px 20px 14px;text-align:center">
        <div style="font-size:22px;margin-bottom:6px">➕ 🔧</div>
        <h2 style="margin:0;color:#fff;font-size:17px;font-weight:800;line-height:1.3">Agregar herramientas adicionales</h2>
        <p style="margin:6px 0 0;color:#a5d6a7;font-size:13px">
          Solicitud #${solicitud.numeroSolicitud || solicitud.id} &nbsp;·&nbsp;
          Estado: <strong style="color:var(--amarillo)">${solicitud.estado}</strong>
        </p>
      </div>

      <div style="padding:18px 20px">

        <!-- Herramientas ya solicitadas -->
        <div style="background:var(--verde-claro);border:1.5px solid var(--verde-borde);border-radius:8px;padding:12px 16px;margin-bottom:16px">
          <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:var(--verde)">📋 Herramientas ya solicitadas:</p>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:var(--texto);line-height:1.8">
            ${listaActual || '<li style="color:var(--gris)">Ninguna aún</li>'}
          </ul>
        </div>

        <!-- Separador con etiqueta -->
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <div style="flex:1;height:1px;background:#ddd"></div>
          <span style="font-size:12px;font-weight:700;color:var(--verde);white-space:nowrap">SELECCIONA LAS ADICIONALES</span>
          <div style="flex:1;height:1px;background:#ddd"></div>
        </div>

        <!-- Grid igual al del formulario -->
        <div id="modal-grid-herramientas" class="grid-herramientas" style="margin-bottom:16px">
          ${gridHtml}
        </div>

        <!-- Botones -->
        <div style="display:flex;gap:10px;margin-top:4px">
          <button id="btn-modal-cancelar" style="flex:1;padding:13px;border-radius:8px;border:1.5px solid #c8c8c8;background:#fff;color:var(--gris);font-size:14px;font-weight:600;cursor:pointer">Cancelar</button>
          <button id="btn-modal-agregar" class="btn-enviar" style="flex:2;margin:0">+ Agregar herramientas</button>
        </div>

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
    const info = herramientasDisp.find(h => claveHerramienta(h) === codigo);
    const max = info && Number.isFinite(info.cantidadDisponible) ? info.cantidadDisponible : 5;
    let cant = cantidadesModalExtra[codigo] || 0;
    if (accion === "sumar") {
      if (cant >= max) { mostrarError(`Solo hay ${max} disponible(s).`); return; }
      cant += 1;
    }
    if (accion === "restar" && cant > 0) cant -= 1;
    cantidadesModalExtra[codigo] = cant;
    document.getElementById(`mcant-${codigo}`).textContent = cant;
    const cardModal = e.target.closest(".tarjeta-herramienta");
    if (cardModal) cardModal.classList.toggle("seleccionada", cant > 0);
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
        const info = herramientasDisp.find(h => claveHerramienta(h) === codigo);
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

btnEnviar.addEventListener("click", async (e) => {
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
      const info = herramientasDisponibles.find(h => claveHerramienta(h) === codigo);
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
