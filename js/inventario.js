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
  { codigo: "HER-039", nombre: "Tarraja de 1/2x13",  icono: "🔧", cantidadDisponible: 5 }
];

async function obtenerColeccionOTexto(nombreColeccion, listaRespaldo, campo = "nombre") {
  // 1. Preparamos el respaldo con la ruta de imagen garantizada
  let respaldo = listaRespaldo.map((h, i) => ({
    id: h.id || `local-${i}`,
    imagen: h.imagen || `img/herramientas/${h.codigo}.jpg`,
    ...h
  }));

  try {
    const snap = await getDocs(collection(db, nombreColeccion));
    
    if (!snap.empty) {
      // 2. Traemos de Firestore y aseguramos la ruta de imagen
      const datosFirestore = snap.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          imagen: data.imagen || `img/herramientas/${data.codigo}.jpg`,
          ...data
        };
      });

      // 3. Fusionamos: Firestore + Respaldo (solo lo que no está en Firestore)
      const listaFinal = [...datosFirestore];
      respaldo.forEach(itemRespaldo => {
        const existe = datosFirestore.find(itemDB => itemDB.codigo === itemRespaldo.codigo);
        if (!existe) {
          listaFinal.push(itemRespaldo);
        }
      });
      
      return listaFinal;
    }
  } catch (err) {
    console.warn(`No se pudo leer ${nombreColeccion}, usando respaldo.`, err);
  }
  
  return respaldo;
}

export async function cargarProfesores() {
  return obtenerColeccionOTexto("profesores", PROFESORES_RESPALDO.map(n => ({nombre: n})), "nombre");
}

export async function cargarLaboratorios() {
  return obtenerColeccionOTexto("laboratorios", LABORATORIOS_RESPALDO.map(n => ({nombre: n})), "nombre");
}

export async function cargarHerramientas() {
  return obtenerColeccionOTexto("herramientas", HERRAMIENTAS_RESPALDO, "nombre");
}
