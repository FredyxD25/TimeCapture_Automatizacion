// Colores de categorías de Outlook (OlCategoryColor 1..25)
const PALETA = {
  1: "#E7A1A2", 2: "#F9BA89", 3: "#F7DD8F", 4: "#FCFA90", 5: "#78D168", 6: "#9FDCC9",
  7: "#C6D2B0", 8: "#9DB7E8", 9: "#B5A1E2", 10: "#DAAEC2", 11: "#DAD9DC", 12: "#6B7994",
  13: "#BFBFBF", 14: "#6F6F6F", 15: "#4F4F4F", 16: "#C11A25", 17: "#E2620D", 18: "#C79930",
  19: "#B9B300", 20: "#368F2B", 21: "#329B7A", 22: "#778B45", 23: "#2858A5", 24: "#5C3FA3",
  25: "#93446B",
};
const OSCUROS = new Set([12, 14, 15, 16, 17, 20, 21, 22, 23, 24, 25]);

export function colorCategoria(categorias, nombre) {
  const c = categorias.find((x) => x.nombre === nombre);
  if (!c || !PALETA[c.color]) return { fondo: "#E8EBF0", texto: "#1F2937" };
  return { fondo: PALETA[c.color], texto: OSCUROS.has(c.color) ? "#FFFFFF" : "#1F2937" };
}

export const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
export const DIAS_CORTOS = ["L", "M", "X", "J", "V"];

// "2026-11-04T08:30" <-> minutos desde medianoche
export const aMin = (iso) => {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  return h * 60 + m;
};
export const horaAMin = (hora) => {
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
};
export const hhmm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
export const conHora = (fecha, hora) => `${fecha}T${hora}`;

export function diaSemana(fecha) {
  const d = new Date(`${fecha}T12:00`);
  return (d.getDay() + 6) % 7; // 0 = lunes
}

export function lunesDe(fecha = new Date()) {
  const d = new Date(fecha);
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
// Del día 1 del mes en curso hasta ayer. Si hoy es día 1, el mes anterior completo.
export function rangoPorDefecto(hoy = new Date()) {
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1, 12);
  const primero = new Date(ayer.getFullYear(), ayer.getMonth(), 1, 12);
  return { desde: isoFecha(primero), hasta: isoFecha(ayer) };
}

export const isoFecha = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// Minutos productivos del día: unión de reuniones aceptadas, propias que se mantienen
// y bloques (sin almuerzo), recortada a la jornada.
export function minutosProductivos(dia) {
  const [ji, jf] = dia.jornada.map(horaAMin);
  const tramos = [];
  for (const c of dia.citas) {
    if ((c.tipo === "reunion" || c.tipo === "propia") && c.accion !== "borrar") tramos.push([aMin(c.inicio), aMin(c.fin)]);
  }
  for (const b of dia.bloques) if (!b.almuerzo) tramos.push([aMin(b.inicio), aMin(b.fin)]);
  let total = 0, hasta = null;
  for (let [a, b] of tramos.map(([a, b]) => [Math.max(a, ji), Math.min(b, jf)]).sort((x, y) => x[0] - y[0])) {
    if (b <= a) continue;
    if (hasta === null || a >= hasta) { total += b - a; hasta = b; }
    else if (b > hasta) { total += b - hasta; hasta = b; }
  }
  return total;
}

export const minimoDia = (fecha) => (diaSemana(fecha) === 4 ? 480 : 510); // vie 8 h, L-J 8.5 h

// Huecos libres de la jornada (minutos) que no ocupan reuniones/citas que se mantienen ni bloques
export function huecosLibres(dia) {
  const [ji, jf] = dia.jornada.map(horaAMin);
  const ocupados = [
    ...dia.citas.filter((c) => (c.tipo === "reunion" || c.tipo === "propia") && c.accion !== "borrar"),
    ...dia.bloques,
  ]
    .map((x) => [aMin(x.inicio), aMin(x.fin)])
    .sort((a, b) => a[0] - b[0]);
  const huecos = [];
  let cursor = ji;
  for (const [a, b] of ocupados) {
    if (a > cursor) huecos.push([cursor, Math.min(a, jf)]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < jf) huecos.push([cursor, jf]);
  return huecos.filter(([a, b]) => b > a);
}

const BLOQUE_MIN = 30;
const PASO = 15;

// Ubica las tareas que no cupieron en los huecos que se hayan liberado (urgentes primero)
export function rellenarPendientes(dia) {
  const pendientes = [...(dia.pendientes || [])].sort((a, b) => (b.urgente ? 1 : 0) - (a.urgente ? 1 : 0));
  if (!pendientes.length || dia.festivo) return {};
  const nuevos = [];
  for (const [hi, hf] of huecosLibres(dia)) {
    let cursor = Math.ceil(hi / PASO) * PASO;
    while (pendientes.length && hf - cursor >= BLOQUE_MIN) {
      const t = pendientes.shift();
      let fin = Math.min(cursor + (t.duracion || 60), hf);
      if (hf - fin < BLOQUE_MIN) fin = hf; // no dejar un pedacito suelto
      nuevos.push({
        id: nuevoId(), titulo: t.titulo, categoria: t.categoria || "",
        inicio: conHora(dia.fecha, hhmm(cursor)), fin: conHora(dia.fecha, hhmm(fin)),
        ...(t.urgente ? { urgente: true } : {}),
      });
      cursor = fin;
    }
  }
  if (!nuevos.length) return {};
  return {
    bloques: [...dia.bloques, ...nuevos].sort((a, b) => a.inicio.localeCompare(b.inicio)),
    pendientes,
  };
}

let contador = 0;
export const nuevoId = () => `b${Date.now()}_${contador++}`;
