// js/inventario.js
import { db, collection, getDocs } from "./firebase.js";

const HERRAMIENTAS_RESPALDO = [
  { codigo: "HER-001", nombre: "Aceitera", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-002", nombre: "Alicate", icono: "🛠️", cantidadDisponible: 5 },
  { codigo: "HER-003", nombre: "Alicate de presión", icono: "🛠️", cantidadDisponible: 5 },
  { codigo: "HER-004", nombre: "Broca", icono: "🔩", cantidadDisponible: 10 },
  { codigo: "HER-005", nombre: "Brocha", icono: "🖌️", cantidadDisponible: 10 },
  { codigo: "HER-006", nombre: "Cepillo de alambre", icono: "🪥", cantidadDisponible: 5 },
  { codigo: "HER-007", nombre: "Cinta adhesiva", icono: "🎞️", cantidadDisponible: 10 },
  { codigo: "HER-008", nombre: "Cinta métrica", icono: "📏", cantidadDisponible: 5 },
  { codigo: "HER-009", nombre: "Cuchilla", icono: "🔪", cantidadDisponible: 5 },
  { codigo: "HER-010", nombre: "Destornillador plano", icono: "🪛", cantidadDisponible: 8 },
  { codigo: "HER-011", nombre: "Destornillador estrella", icono: "🪛", cantidadDisponible: 8 },
  { codigo: "HER-012", nombre: "Electrodo", icono: "⚡", cantidadDisponible: 20 },
  { codigo: "HER-013", nombre: "Escuadra falsa", icono: "📐", cantidadDisponible: 5 },
  { codigo: "HER-014", nombre: "Gira tuerca", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-015", nombre: "Granetero", icono: "🔨", cantidadDisponible: 5 },
  { codigo: "HER-016", nombre: "Guantes", icono: "🧤", cantidadDisponible: 10 },
  { codigo: "HER-017", nombre: "Lente", icono: "🥽", cantidadDisponible: 10 },
  { codigo: "HER-018", nombre: "Lima cuadrada", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-019", nombre: "Lima triangular", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-020", nombre: "Lima media caña", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-021", nombre: "Lima redonda", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-022", nombre: "Llave ajustable", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-023", nombre: "Llave allen", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-024", nombre: "Llave de mandril", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-025", nombre: "Llave de tomo", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-026", nombre: "Llave de tuercas", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-027", nombre: "Máscara de soldar", icono: "🥽", cantidadDisponible: 5 },
  { codigo: "HER-028", nombre: "Marcador numérico", icono: "🔢", cantidadDisponible: 5 },
  { codigo: "HER-029", nombre: "Martillo", icono: "🔨", cantidadDisponible: 8 },
  { codigo: "HER-030", nombre: "Mazo de goma", icono: "🔨", cantidadDisponible: 5 },
  { codigo: "HER-031", nombre: "Nacho de 1/2", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-032", nombre: "Nivel magnético", icono: "📐", cantidadDisponible: 5 },
  { codigo: "HER-033", nombre: "Nivel 90", icono: "📐", cantidadDisponible: 5 },
  { codigo: "HER-034", nombre: "Pie de rey", icono: "📏", cantidadDisponible: 5 },
  { codigo: "HER-035", nombre: "Pinzas", icono: "🛠️", cantidadDisponible: 5 },
  { codigo: "HER-036", nombre: "Piqueta", icono: "⛏️", cantidadDisponible: 5 },
  { codigo: "HER-037", nombre: "Porta broca", icono: "🔧", cantidadDisponible: 5 },
  { codigo: "HER-038", nombre: "Segueta", icono: "🪚", cantidadDisponible: 5 },
  { codigo: "HER-039", nombre: "Tarraja de 1/2x13", icono: "🔧", cantidadDisponible: 5 }
];

async function obtenerColeccionOTexto(nombreColeccion, listaRespaldo) {
  try {
    const snap = await getDocs(collection(db, nombreColeccion));
    const respaldo = listaRespaldo.map(h => ({ ...h, imagen: `img/herramientas/${h.codigo}.jpg` }));
    
    if (snap.empty) return respaldo;

    const datosFirestore = snap.docs.map(doc => ({ 
      id: doc.id, 
      imagen: `img/herramientas/${doc.data().codigo}.jpg`,
      ...doc.data() 
    }));

    // Fusionamos: Firestore + lo que falte del respaldo
    const listaFinal = [...datosFirestore];
    respaldo.forEach(itemR => {
      if (!listaFinal.find(itemF => itemF.codigo === itemR.codigo)) {
        listaFinal.push(itemR);
      }
    });
    return listaFinal;
  } catch (err) {
    return listaRespaldo.map(h => ({ ...h, imagen: `img/herramientas/${h.codigo}.jpg` }));
  }
}

export async function cargarHerramientas() {
  return obtenerColeccionOTexto("herramientas", HERRAMIENTAS_RESPALDO);
}
