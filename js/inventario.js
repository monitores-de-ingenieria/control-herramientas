// js/inventario.js
import { db, collection, getDocs, addDoc } from "./firebase.js";

const PROFESORES_RESPALDO = [
  "Daniel Camejo",
  "José Peña",
  "Julio Durán",
  "Víctor Félix"
];

const LABORATORIOS_RESPALDO = [
  "Taller mecánica básica",
  "Lab. ciencia de los materiales",
  "Máquinas especiales",
  "Taller de procesos industriales",
  "Taller de soldadura",
  "Taller máquinas y herramientas I",
  "Taller máquinas y herramientas II"
];

// Respaldo inicial de ciclos. A partir de aquí la lista se alimenta sola:
// cada ciclo nuevo que alguien agregue desde el formulario queda guardado
// en Firestore (colección "ciclos") y aparece para todos después.
const CICLOS_RESPALDO = ["2-2027", "1-2027", "2-2026", "1-2026", "2-2025", "1-2025"];

// Ordena "N-AAAA" del ciclo más reciente al más antiguo.
function ordenarCiclos(lista) {
  return [...lista].sort((a, b) => {
    const [na, ya] = String(a.nombre || "").split("-").map(Number);
    const [nb, yb] = String(b.nombre || "").split("-").map(Number);
    if ((yb || 0) !== (ya || 0)) return (yb || 0) - (ya || 0);
    return (nb || 0) - (na || 0);
  });
}

// Lista base compartida con el panel admin — ver js/herramientas-respaldo.js.
// Aquí se le agrega "imagen" con la ruta relativa a ESTE archivo (a nivel
// del formulario de estudiante), distinta a como la usa el panel admin.
import { HERRAMIENTAS_RESPALDO as HERRAMIENTAS_RESPALDO_BASE } from "./herramientas-respaldo.js";
const HERRAMIENTAS_RESPALDO = HERRAMIENTAS_RESPALDO_BASE.map(h => ({ ...h, imagen: `img/herramientas/${h.codigo}.jpg` }));

async function obtenerColeccionOTexto(nombreColeccion, listaRespaldo, campo = "nombre") {
  try {
    const snap = await getDocs(collection(db, nombreColeccion));
    if (!snap.empty) {
      return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    }
  } catch (err) {
    console.warn(`No se pudo leer "${nombreColeccion}", usando respaldo.`, err);
  }
  return listaRespaldo.map((valor, i) =>
    typeof valor === "string" ? { id: `local-${i}`, [campo]: valor } : valor
  );
}

export async function cargarProfesores() {
  try {
    const snap = await getDocs(collection(db, "profesores"));
    if (!snap.empty) {
      return snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => !p.eliminado)
        .sort((a, b) => a.nombre.localeCompare(b.nombre));
    }
  } catch (err) {
    console.warn('No se pudo leer "profesores", usando respaldo.', err);
  }
  return PROFESORES_RESPALDO.map((valor, i) => ({ id: `local-${i}`, nombre: valor }));
}

export async function cargarLaboratorios() {
  return obtenerColeccionOTexto("laboratorios", LABORATORIOS_RESPALDO, "nombre");
}

export async function cargarCiclos() {
  const lista = await obtenerColeccionOTexto("ciclos", CICLOS_RESPALDO, "nombre");
  return ordenarCiclos(lista);
}

// Guarda un ciclo escrito a mano por el estudiante para que quede
// disponible para todos la próxima vez (ej. cuando empiece 2027).
export async function agregarCicloNuevo(nombreCiclo) {
  const limpio = (nombreCiclo || "").trim();
  if (!limpio) return null;
  try {
    const ref = await addDoc(collection(db, "ciclos"), { nombre: limpio });
    return { id: ref.id, nombre: limpio };
  } catch (err) {
    console.warn('No se pudo guardar el ciclo nuevo en Firestore, se usará solo en este dispositivo.', err);
    return { id: `local-${Date.now()}`, nombre: limpio };
  }
}

// El panel admin guarda fotoUrl como ruta relativa A SU PROPIA carpeta
// (ej. "../img/herramientas/HER-007.jpg"), pero el formulario de estudiante
// vive en otro nivel del sitio y esa misma ruta ahí no resuelve (404).
// Si fotoUrl ya es una URL absoluta o root-relative, se deja intacta.
function normalizarFotoUrl(url) {
  if (typeof url !== "string" || !url.trim()) return "";
  if (/^https?:\/\//i.test(url) || url.startsWith("/")) return url;
  return url.replace(/^(\.\.\/)+/, "");
}

export async function cargarHerramientas() {
  try {
    const snap = await getDocs(collection(db, "herramientas"));

    // Herramientas en Firestore (excluir eliminadas y documentos sin "nombre" válido).
    // Un documento incompleto ya no tumba el catálogo completo: se omite y se
    // avisa en consola, en vez de disparar el catch y perder TODAS las
    // herramientas de Firestore por culpa de un solo registro mal cargado.
    const todosValidos = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(h => {
        if (typeof h.nombre !== "string" || !h.nombre.trim()) {
          console.warn(`Herramienta con id "${h.id}" no tiene "nombre" válido, se omite del catálogo. Revísala en el panel admin.`, h);
          return false;
        }
        return true;
      });

    // nombresFirestore se arma con TODOS los documentos válidos, incluidos los
    // marcados eliminada:true — así un nombre "eliminado" (ej. al renombrar una
    // herramienta de respaldo) no vuelve a colarse desde HERRAMIENTAS_RESPALDO.
    const nombresFirestore = new Set(todosValidos.map(h => h.nombre.toLowerCase()));
    const enFirestore = todosValidos.filter(h => !h.eliminada);

    // Herramientas del respaldo que NO están en Firestore
    const delRespaldo = HERRAMIENTAS_RESPALDO.filter(
      h => !nombresFirestore.has(h.nombre.toLowerCase())
    );

    // Combinar — las de Firestore usan su cantidad actualizada
    // y construimos la imagen priorizando la foto subida desde el panel
    // admin (fotoUrl), y solo si no hay foto personalizada caemos a la
    // ruta estática por código (img/herramientas/CODIGO.jpg).
    const firestoreConImagen = enFirestore.map(h => ({
      ...h,
      imagen: normalizarFotoUrl(h.fotoUrl) || (h.codigo ? `img/herramientas/${h.codigo}.jpg` : (h.imagen || '')),
      icono:  h.icono  || '🔧'
    }));

    return [...firestoreConImagen, ...delRespaldo]
      .sort((a, b) => a.nombre.localeCompare(b.nombre));

  } catch (err) {
    console.warn("Error al cargar herramientas de Firestore, usando respaldo.", err);
    return HERRAMIENTAS_RESPALDO;
  }
}
