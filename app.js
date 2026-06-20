// js/app.js
import { db, collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "./firebase.js";
import { cargarProfesores, cargarLaboratorios, cargarHerramientas } from "./inventario.js";

const form = document.getElementById("form-solicitud");
const selectProfesor = document.getElementById("profesor");
const selectLaboratorio = document.getElementById("laboratorio");
const gridHerramientas = document.getElementById("grid-herramientas");
const btnEnviar = document.getElementById("btn-enviar");

const mensajeEpp = document.getElementById("mensaje-epp");
const mensajeFinal = document.getElementById("mensaje-final");
const btnContinuar = document.getElementById("btn-continuar");
const btnNuevaSolicitud = document.getElementById("btn-nueva-solicitud");
const textoNumeroSolicitud = document.getElementById("texto-numero-solicitud");
const textoDespedida = document.getElementById("texto-despedida");

let herramientasDisponibles = [];
let cantidadesSeleccionadas = {}; // { codigo: cantidad }
let datosSolicitudPendiente = null;

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

async function generarNumeroSolicitud() {
  const anio = new Date().getFullYear();
  try {
    const snap = await getDocs(query(collection(db, "solicitudes"), orderBy("creadoEn", "desc")));
    const consecutivo = snap.size + 1;
    return `${anio}-${String(consecutivo).padStart(5, "0")}`;
  } catch (err) {
    // Si falla la lectura (ej. reglas de Firestore o sin conexión), usamos un número basado en la hora
    return `${anio}-${String(Date.now()).slice(-5)}`;
  }
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!validarFormulario()) return;

  btnEnviar.disabled = true;
  btnEnviar.textContent = "Enviando...";

  const herramientasElegidas = Object.entries(cantidadesSeleccionadas)
    .filter(([_, c]) => c > 0)
    .map(([codigo, cantidad]) => {
      const info = herramientasDisponibles.find(h => h.codigo === codigo);
      return { codigo, nombre: info ? info.nombre : codigo, cantidad };
    });

  datosSolicitudPendiente = {
    nombre: document.getElementById("nombre").value.trim(),
    apellido: document.getElementById("apellido").value.trim(),
    matricula: document.getElementById("matricula").value.trim(),
    ciclo: document.getElementById("ciclo").value,
    telefono: document.getElementById("telefono").value.trim(),
    profesor: document.getElementById("profesor").value,
    laboratorio: document.getElementById("laboratorio").value,
    herramientas: herramientasElegidas,
    estado: "pendiente",
    creadoEn: serverTimestamp()
  };

  // Paso 1: mostramos el recordatorio de EPP antes de guardar
  form.classList.add("oculto");
  mensajeEpp.classList.remove("oculto");

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

    textoNumeroSolicitud.textContent = `Solicitud #${numero}`;
    textoDespedida.textContent = `Gracias, ${datosSolicitudPendiente.nombre}. Tu solicitud de herramientas ha sido registrada exitosamente.`;

    mensajeEpp.classList.add("oculto");
    mensajeFinal.classList.remove("oculto");
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
  mensajeFinal.classList.add("oculto");
  form.classList.remove("oculto");
});

inicializar();
