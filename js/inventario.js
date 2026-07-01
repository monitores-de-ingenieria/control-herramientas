// js/inventario.js
import { db, collection, getDocs } from "./firebase.js";

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

const HERRAMIENTAS_RESPALDO = [
  { codigo: "HER-001", nombre: "Aceitera",          icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-002", nombre: "Alicate",           icono: "🛠️", cantidadDisponible: 5 },
  { codigo: "HER-003", nombre: "Alicate de presión", icono: "🛠️", cantidadDisponible: 5 },
  { codigo: "HER-004", nombre: "Broca",             icono: "🔩", cantidadDisponible: 10 },
  { codigo: "HER-005", nombre: "Brocha",            icono: "🖌️", cantidadDisponible: 10 },
  { codigo: "HER-006", nombre: "Cepillo de alambre", icono: "🪥", cantidadDisponible: 5 },
  { codigo: "HER-007", nombre: "Cinta adhesiva",    icono: "🎞️", cantidadDisponible: 10 },
  { codigo: "HER-008", nombre: "Cinta métrica",     icono: "📏", cantidadDisponible: 5 },
  { codigo: "HER-009", nombre: "Cuchilla",          icono: "🔪", cantidadDisponible: 5 },
  { codigo: "HER-010", nombre: "Destornillador plano", icono: "🪛", cantidadDisponible: 8 },
  { codigo: "HER-011", nombre: "Destornillador estrella", icono: "🪛", cantidadDisponible: 8 },
  { codigo: "HER-012", nombre: "Electrodo",         icono: "⚡", cantidadDisponible: 20 },
  { codigo: "HER-013", nombre: "Escuadra falsa",    icono: "📐", cantidadDisponible: 5 },
  { codigo: "HER-014", nombre: "Gira tuerca",       icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-015", nombre: "Granetero",         icono: "🔨", cantidadDisponible: 5 },
  { codigo: "HER-016", nombre: "Guantes",           icono: "🧤", cantidadDisponible: 10 },
  { codigo: "HER-017", nombre: "Lente",             icono: "🥽", cantidadDisponible: 10 },
  { codigo: "HER-018", nombre: "Lima cuadrada",     icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-019", nombre: "Lima triangular",   icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-020", nombre: "Lima media caña",   icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-021", nombre: "Lima redonda",      icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-022", nombre: "Llave ajustable",   icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-023", nombre: "Llave allen",       icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-024", nombre: "Llave de mandril",  icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-025", nombre: "Llave de tomo",     icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-026", nombre: "Llave de tuercas",  icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-027", nombre: "Máscara de soldar", icono: "🥽", cantidadDisponible: 5 },
  { codigo: "HER-028", nombre: "Marcador numérico", icono: "🔢", cantidadDisponible: 5 },
  { codigo: "HER-029", nombre: "Martillo",          icono: "🔨", cantidadDisponible: 8 },
  { codigo: "HER-030", nombre: "Mazo de goma",      icono: "🔨", cantidadDisponible: 5 },
  { codigo: "HER-031", nombre: "Macho de 1/2",      icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-032", nombre: "Nivel magnético",   icono: "📐", cantidadDisponible: 5 },
  { codigo: "HER-033", nombre: "Nivel 90",          icono: "📐", cantidadDisponible: 5 },
  { codigo: "HER-034", nombre: "Pie de rey",        icono: "📏", cantidadDisponible: 5 },
  { codigo: "HER-035", nombre: "Pinzas",            icono: "🛠️", cantidadDisponible: 5 },
  { codigo: "HER-036", nombre: "Piqueta",           icono: "⛏️", cantidadDisponible: 5 },
  { codigo: "HER-037", nombre: "Porta broca",       icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-038", nombre: "Segueta",           icono: "🪚", cantidadDisponible: 5 },
  { codigo: "HER-039", nombre: "Tarraja de 1/2x13", icono: "🔧", cantidadDisponible: 5 }
].map(h => ({ ...h, imagen: `img/herramientas/${h.codigo}.jpg` }));

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
    const enFirestore = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(h => {
        if (h.eliminada) return false;
        if (typeof h.nombre !== "string" || !h.nombre.trim()) {
          console.warn(`Herramienta con id "${h.id}" no tiene "nombre" válido, se omite del catálogo. Revísala en el panel admin.`, h);
          return false;
        }
        return true;
      });

    const nombresFirestore = new Set(enFirestore.map(h => h.nombre.toLowerCase()));

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
