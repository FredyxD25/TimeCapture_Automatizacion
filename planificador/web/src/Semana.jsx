import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  DIAS, aMin, colorCategoria, conHora, diaSemana, hhmm, horaAMin, minimoDia, minutosProductivos, nuevoId,
  rellenarPendientes,
} from "./util.js";
import Editor from "./Editor.jsx";

const INICIO = 8 * 60;      // eje de 08:00
const FIN = 17 * 60 + 30;   // a 17:30
const CABECERA_DIA = 56;    // nombre del día y horas
const PIE_DIA = 38;         // pie de una línea (avisos y botones)
const MARGEN_ABAJO = 28;    // relleno inferior de la página y de la semana, bordes y un pequeño respiro
const EJE = 44;             // columna de horas
const SEPARACION = 8;       // espacio entre días

// Mide el espacio real que queda en la ventana para que el calendario completo (08:00–17:30)
// quepa a lo alto sin barra vertical. A lo ancho, si no caben los días, queda la barra horizontal.
function usarMedidas(ref, nDias) {
  const [m, setM] = useState({ px: 1, ancho: 999 });
  useLayoutEffect(() => {
    const medir = () => {
      const el = ref.current;
      const arriba = el ? el.getBoundingClientRect().top + window.scrollY : 260;
      const barraHorizontal = el ? el.offsetHeight - el.clientHeight : 0;
      const alto = window.innerHeight - arriba - CABECERA_DIA - PIE_DIA - MARGEN_ABAJO - barraHorizontal;
      const px = Math.min(1.6, Math.max(0.45, alto / (FIN - INICIO)));
      const ancho = el ? Math.max(150, (el.clientWidth - EJE - SEPARACION * nDias) / Math.max(1, nDias)) : 999;
      setM((p) => (Math.abs(p.px - px) < 0.005 && Math.abs(p.ancho - ancho) < 1 ? p : { px, ancho }));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [nDias, ref.current]); // eslint-disable-line react-hooks/exhaustive-deps
  return m;
}

// Reparte en carriles las citas que se cruzan entre sí
function carriles(items) {
  const orden = [...items].sort((a, b) => aMin(a.inicio) - aMin(b.inicio));
  const finCarril = [];
  const asignado = new Map();
  for (const it of orden) {
    let k = finCarril.findIndex((f) => f <= aMin(it.inicio));
    if (k === -1) { k = finCarril.length; finCarril.push(0); }
    finCarril[k] = aMin(it.fin);
    asignado.set(it, k);
  }
  return { asignado, total: Math.max(1, finCarril.length) };
}

function ocupaciones(dia) {
  return [
    ...dia.citas.filter((c) => (c.tipo === "reunion" || c.tipo === "propia") && c.accion !== "borrar"),
    ...dia.bloques,
  ].map((x) => [aMin(x.inicio), aMin(x.fin)]);
}

function primerHueco(dia, duracion = 60) {
  const [ji, jf] = dia.jornada.map(horaAMin);
  const ocup = ocupaciones(dia).sort((a, b) => a[0] - b[0]);
  let cursor = ji;
  for (const [a, b] of ocup) {
    if (a - cursor >= 15) return [cursor, Math.min(a, cursor + duracion)];
    cursor = Math.max(cursor, b);
  }
  if (jf - cursor >= 15) return [cursor, Math.min(jf, cursor + duracion)];
  return [jf - 30, jf];
}

export default function Semana({ dias, categorias, catalogo, cambiarDia, replanificar }) {
  const [editando, setEditando] = useState(null); // {fecha, tipo: "bloque"|"cita", id}
  const semanaRef = useRef(null);
  const { px: PX, ancho } = usarMedidas(semanaRef, dias.length);
  const conTexto = ancho >= 240; // los botones del pie llevan texto solo si caben en una línea
  // Arrastre de un bloque: {id, origen, dur, offset, x0, y0, movio, destino: {fecha, inicio} | null}
  const [arrastre, setArrastre] = useState(null);
  const ultimo = useRef({});
  ultimo.current = { arrastre, dias, PX, cambiarDia };

  useEffect(() => {
    if (!arrastre) return undefined;
    const alMover = (e) => {
      const { arrastre: a, dias: ds, PX: px } = ultimo.current;
      if (!a) return;
      const movio = a.movio || Math.hypot(e.clientX - a.x0, e.clientY - a.y0) > 4;
      let destino = a.destino;
      if (movio && a.modo === "mover") {
        // Mover: a cualquier día, conservando la duración
        const col = document.elementFromPoint(e.clientX, e.clientY)?.closest(".columna");
        const dia = col && ds.find((d) => d.fecha === col.dataset.fecha);
        if (dia && !dia.festivo) {
          const [ji, jf] = dia.jornada.map(horaAMin);
          const bruto = INICIO + (e.clientY - col.getBoundingClientRect().top) / px - a.offset;
          const inicio = Math.max(ji, Math.min(jf - a.dur, Math.round(bruto / 15) * 15));
          destino = { fecha: dia.fecha, inicio, fin: inicio + a.dur };
        }
      } else if (movio) {
        // Alargar / acortar: se arrastra el borde de arriba (inicio) o el de abajo (fin), mínimo 15 min
        const col = document.querySelector(`.columna[data-fecha="${a.origen}"]`);
        const dia = ds.find((d) => d.fecha === a.origen);
        if (col && dia) {
          const [ji, jf] = dia.jornada.map(horaAMin);
          const m = Math.round((INICIO + (e.clientY - col.getBoundingClientRect().top) / px) / 15) * 15;
          destino = a.modo === "fin"
            ? { fecha: a.origen, inicio: a.ini, fin: Math.max(a.ini + 15, Math.min(jf, m)) }
            : { fecha: a.origen, inicio: Math.min(a.fin - 15, Math.max(ji, m)), fin: a.fin };
        }
      }
      setArrastre({ ...a, movio, destino });
    };
    const alSoltar = () => {
      const { arrastre: a, dias: ds, cambiarDia: cambiar } = ultimo.current;
      setArrastre(null);
      if (!a) return;
      if (!a.movio) return a.modo === "mover" ? setEditando({ fecha: a.origen, tipo: "bloque", id: a.id }) : undefined;
      if (!a.destino) return;
      const bloque = ds.find((d) => d.fecha === a.origen)?.bloques.find((b) => b.id === a.id);
      if (!bloque) return;
      const movido = {
        ...bloque,
        inicio: conHora(a.destino.fecha, hhmm(a.destino.inicio)),
        fin: conHora(a.destino.fecha, hhmm(a.destino.fin)),
      };
      const ordenar = (bs) => bs.sort((x, z) => x.inicio.localeCompare(z.inicio));
      // Se quita del día de origen y, con el espacio libre, entran las tareas que no habían cabido
      cambiar(a.origen, (d) => {
        const quedan = d.bloques.filter((b) => b.id !== a.id);
        const bloques = a.destino.fecha === a.origen ? ordenar([...quedan, movido]) : quedan;
        return { bloques, ...rellenarPendientes({ ...d, bloques }) };
      });
      if (a.destino.fecha !== a.origen) {
        cambiar(a.destino.fecha, (d) => ({ bloques: ordenar([...d.bloques, movido]) }));
      }
    };
    window.addEventListener("pointermove", alMover);
    window.addEventListener("pointerup", alSoltar);
    document.body.classList.add("arrastrando");
    return () => {
      window.removeEventListener("pointermove", alMover);
      window.removeEventListener("pointerup", alSoltar);
      document.body.classList.remove("arrastrando");
    };
  }, [arrastre?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!dias.length) return null;
  const y = (min) => (Math.max(INICIO, Math.min(FIN, min)) - INICIO) * PX;

  const horas = [];
  for (let m = INICIO; m <= FIN; m += 60) horas.push(m);

  const diaEditado = editando && dias.find((d) => d.fecha === editando.fecha);
  const objeto = diaEditado &&
    (editando.tipo === "bloque"
      ? diaEditado.bloques.find((b) => b.id === editando.id)
      : diaEditado.citas.find((c) => c.id === editando.id));

  return (
    <div
      ref={semanaRef}
      className={`semana ${PX < 0.95 ? "compacta" : ""}`}
    >
      <div className="eje" style={{ height: (FIN - INICIO) * PX + 56 }}>
        <div className="cabecera-eje" />
        {horas.map((m) => (
          <div key={m} className="hora" style={{ top: 56 + y(m) - 7 }}>{hhmm(m)}</div>
        ))}
      </div>

      {dias.map((dia) => {
        const minutos = minutosProductivos(dia);
        const minimo = minimoDia(dia.fecha);
        const ok = dia.festivo || minutos >= minimo;
        // Franja izquierda angosta: lo que se borra y las reuniones sin aceptar.
        // Carril principal: reuniones aceptadas y citas propias que se mantienen, junto a los bloques.
        const secundarias = dia.citas.filter((c) => c.accion === "borrar" || c.tipo === "reunion_pendiente");
        const principales = dia.citas.filter((c) => !secundarias.includes(c));
        const cs = carriles(secundarias);
        const cp = carriles(principales);
        const posicion = (c) => {
          if (secundarias.includes(c)) {
            const k = cs.asignado.get(c);
            return { left: `${(k / cs.total) * 15}%`, width: `${15 / cs.total - 0.5}%` };
          }
          const k = cp.asignado.get(c);
          const ancho = 84 / cp.total;
          return { left: `${16 + k * ancho}%`, width: `${ancho - 0.5}%` };
        };
        const fijas = dia.citas.filter((c) => (c.tipo === "reunion" || c.tipo === "propia") && c.accion !== "borrar");
        const [ji, jf] = dia.jornada.map(horaAMin);

        return (
          <div key={dia.fecha} className="dia">
            <div className="cabecera-dia">
              <div>
                <strong>{DIAS[diaSemana(dia.fecha)]}</strong>{" "}
                <span className="fecha">{dia.fecha.slice(5).split("-").reverse().join("/")}</span>
              </div>
              <div className={`horas ${ok ? "ok" : "falta"}`}>
                {dia.festivo ? "Festivo" : `${(minutos / 60).toFixed(1)} h ${ok ? "✓" : `· faltan ${((minimo - minutos) / 60).toFixed(1)} h`}`}
              </div>
            </div>

            <div className="columna" data-fecha={dia.fecha} style={{ height: (FIN - INICIO) * PX }}>
              {horas.map((m) => <div key={m} className="linea" style={{ top: y(m) }} />)}
              {jf < FIN && <div className="fuera" style={{ top: y(jf), height: y(FIN) - y(jf) }} />}

              {dia.citas.map((c) => {
                const cat = c.categoria_nueva ?? c.categoria;
                const color = colorCategoria(categorias, cat);
                const clase = c.accion === "borrar" ? "borrar" : c.tipo === "reunion_pendiente" ? "pendiente" : c.tipo;
                return (
                  <div
                    key={c.id}
                    className={`cita ${clase}`}
                    title={`${c.titulo}\n${c.inicio.slice(11)}–${c.fin.slice(11)}${cat ? `\n${cat}` : ""}`}
                    style={{
                      top: y(aMin(c.inicio)),
                      height: Math.max(14, y(aMin(c.fin)) - y(aMin(c.inicio)) - 2),
                      ...posicion(c),
                      ...(clase === "reunion" ? { borderLeftColor: color.fondo } : {}),
                    }}
                    onClick={() => setEditando({ fecha: dia.fecha, tipo: "cita", id: c.id })}
                  >
                    <span className="hora-cita">{c.inicio.slice(11)}</span> {c.titulo}
                  </div>
                );
              })}

              {dia.bloques.map((b) => {
                const color = colorCategoria(categorias, b.categoria);
                const [bi, bf] = [aMin(b.inicio), aMin(b.fin)];
                const cruza = !b.almuerzo && fijas.some((c) => aMin(c.inicio) < bf && bi < aMin(c.fin));
                const encima = dia.bloques.some((o) => o.id !== b.id && aMin(o.inicio) < bf && bi < aMin(o.fin));
                const fuera = bi < ji || bf > jf;
                const arrastrado = arrastre?.movio && arrastre.id === b.id;
                return (
                  <div
                    key={b.id}
                    className={`bloque ${b.almuerzo ? "almuerzo" : ""} ${cruza || fuera || encima ? "alerta-bloque" : ""} ${arrastrado ? "arrastrado" : ""}`}
                    title={`${b.titulo}\n${b.inicio.slice(11)}–${b.fin.slice(11)}\n${b.categoria || "Sin categoría"}${cruza ? "\n⚠ Se cruza con una reunión" : ""}${encima ? "\n⚠ Se cruza con otro bloque" : ""}${fuera ? "\n⚠ Fuera del horario" : ""}\nClic para editar · arrastra para moverlo`}
                    style={{
                      top: y(bi),
                      height: Math.max(14, y(bf) - y(bi) - 2),
                      background: color.fondo,
                      color: color.texto,
                    }}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setEditando({ fecha: dia.fecha, tipo: "bloque", id: b.id })}
                    onPointerDown={(e) => {
                      if (e.button !== 0) return;
                      e.preventDefault();
                      const top = e.currentTarget.getBoundingClientRect().top;
                      // Los bordes de arriba y abajo cambian la duración; el resto del bloque lo mueve
                      const asa = e.target.dataset?.asa;
                      setArrastre({
                        id: b.id, origen: dia.fecha, modo: asa || "mover", ini: bi, fin: bf, dur: bf - bi,
                        offset: (e.clientY - top) / PX, x0: e.clientX, y0: e.clientY, movio: false, destino: null,
                      });
                    }}
                  >
                    <span className="asa asa-arriba" data-asa="inicio" title="Arrastra para cambiar la hora de inicio" />
                    <span className="asa asa-abajo" data-asa="fin" title="Arrastra para cambiar la hora de fin" />
                    <span className="hora-cita">{b.inicio.slice(11)}–{b.fin.slice(11)}</span>
                    <span className="titulo-bloque">{b.titulo}</span>
                  </div>
                );
              })}

              {arrastre?.movio && arrastre.destino?.fecha === dia.fecha && (
                <div
                  className="fantasma"
                  style={{ top: y(arrastre.destino.inicio), height: Math.max(14, (arrastre.destino.fin - arrastre.destino.inicio) * PX - 2) }}
                >
                  {hhmm(arrastre.destino.inicio)}–{hhmm(arrastre.destino.fin)}
                  {arrastre.modo !== "mover" && ` · ${((arrastre.destino.fin - arrastre.destino.inicio) / 60).toFixed(2).replace(/\.?0+$/, "")} h`}
                </div>
              )}
            </div>

            {/* Pie de una sola línea: así el calendario puede ocupar todo el alto disponible */}
            <div className="pie-dia">
              {(() => {
                const avisos = (dia.avisos || []).filter((a) => a !== "Festivo");
                const pend = dia.pendientes || [];
                if (!avisos.length && !pend.length) return <span className="aviso-dia vacio-aviso" />;
                const detalle = [
                  ...avisos,
                  ...(pend.length ? ["No cupieron (acorta o quita un bloque y entran solas):", ...pend.map((t) => `• ${t.titulo}`)] : []),
                ].join("\n");
                return (
                  <span className="aviso-dia" title={detalle}>
                    ⚠ {pend.length ? `${pend.length} no cupieron` : avisos[0]}
                  </span>
                );
              })()}
              <button
                className="icono"
                title="Agregar un bloque en el primer hueco libre"
                onClick={() => {
                  const [a, b] = primerHueco(dia);
                  const id = nuevoId();
                  cambiarDia(dia.fecha, (d) => ({
                    bloques: [...d.bloques, { id, titulo: "", categoria: "", inicio: conHora(d.fecha, hhmm(a)), fin: conHora(d.fecha, hhmm(b)) }],
                  }));
                  setEditando({ fecha: dia.fecha, tipo: "bloque", id });
                }}
              >{conTexto ? "+ Bloque" : "+"}</button>
              <button className="icono" onClick={() => replanificar(dia)} title="Proponer de nuevo los bloques de este día">
                {conTexto ? "↻ Proponer" : "↻"}
              </button>
              <button className="icono" onClick={() => cambiarDia(dia.fecha, () => ({ bloques: [] }))} title="Vaciar: quitar todos los bloques propuestos del día">
                {conTexto ? "Vaciar" : "✕"}
              </button>
            </div>
          </div>
        );
      })}

      {objeto && (
        <Editor
          tipo={editando.tipo}
          objeto={objeto}
          fecha={editando.fecha}
          categorias={categorias}
          catalogo={catalogo}
          cerrar={() => {
            // Al terminar de editar, si se liberó espacio se ubican las tareas que no habían cabido
            cambiarDia(editando.fecha, (d) => rellenarPendientes(d));
            setEditando(null);
          }}
          guardar={(cambios) =>
            cambiarDia(editando.fecha, (d) =>
              editando.tipo === "bloque"
                ? { bloques: d.bloques.map((b) => (b.id === editando.id ? { ...b, ...cambios } : b)) }
                : { citas: d.citas.map((c) => (c.id === editando.id ? { ...c, ...cambios } : c)) }
            )
          }
          eliminar={() => {
            cambiarDia(editando.fecha, (d) => {
              const bloques = d.bloques.filter((b) => b.id !== editando.id);
              return { bloques, ...rellenarPendientes({ ...d, bloques }) };
            });
            setEditando(null);
          }}
          dias={dias.map((d) => ({ fecha: d.fecha, festivo: d.festivo }))}
          moverADia={editando.tipo === "bloque" ? (nueva) => {
            // Mismo horario en otro día; el editor sigue abierto sobre el bloque movido
            const origen = editando.fecha;
            if (nueva === origen) return;
            const movido = { ...objeto, inicio: conHora(nueva, objeto.inicio.slice(11)), fin: conHora(nueva, objeto.fin.slice(11)) };
            cambiarDia(origen, (d) => {
              const bloques = d.bloques.filter((b) => b.id !== objeto.id);
              return { bloques, ...rellenarPendientes({ ...d, bloques }) };
            });
            cambiarDia(nueva, (d) => ({ bloques: [...d.bloques, movido].sort((x, z) => x.inicio.localeCompare(z.inicio)) }));
            setEditando({ fecha: nueva, tipo: "bloque", id: objeto.id });
          } : undefined}
        />
      )}
    </div>
  );
}
