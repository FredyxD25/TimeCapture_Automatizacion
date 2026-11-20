import React, { useEffect, useState } from "react";
import { DIAS_CORTOS, nuevoId } from "./util.js";

const FRECUENCIAS = [
  ["semanal", "Semanal"],
  ["quincenal", "Quincenal"],
  ["mensual", "Mensual"],
  ["eventual", "Eventual (solo manual)"],
];

const numeros = (texto) =>
  texto.split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);

export default function Catalogo({ catalogo, categorias, guardar }) {
  const [filas, setFilas] = useState(catalogo);
  const [estado, setEstado] = useState("");
  const [filtro, setFiltro] = useState("todas");
  useEffect(() => setFilas(catalogo), [catalogo]);

  const cambiar = (id, cambio) => setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, ...cambio } : f)));
  const visibles = filas.filter((f) => filtro === "todas" || (f.frecuencia || "semanal") === filtro);

  return (
    <section className="catalogo">
      <p className="ayuda">
        Tareas con las que se llenan los huecos libres. Cada día van primero las quincenales y mensuales que le
        tocan (las urgentes antes), luego las semanales del día; si sobra tiempo se repiten las semanales.
        Las eventuales no se proponen solas, pero aparecen como sugerencia al editar un bloque.
      </p>
      <div className="filtros">
        {[["todas", "Todas"], ...FRECUENCIAS].map(([v, t]) => (
          <button key={v} className={filtro === v ? "activa" : ""} onClick={() => setFiltro(v)}>
            {t.replace(" (solo manual)", "")} ({v === "todas" ? filas.length : filas.filter((f) => (f.frecuencia || "semanal") === v).length})
          </button>
        ))}
      </div>
      <div className="desplazable">
        <table>
        <thead>
          <tr><th>Actividad</th><th>Categoría</th><th>Min</th><th>Frecuencia</th><th>Cuándo</th><th>Urgente</th><th /></tr>
        </thead>
        <tbody>
          {visibles.map((f) => {
            const i = filas.indexOf(f);
            const frec = f.frecuencia || "semanal";
            return (
              <tr key={f.id}>
                <td>
                  <input value={f.titulo} onChange={(e) => cambiar(f.id, { titulo: e.target.value })} />
                  <input className="nota" placeholder="Nota (opcional)" value={f.nota || ""} onChange={(e) => cambiar(f.id, { nota: e.target.value })} />
                </td>
                <td>
                  <select value={f.categoria} onChange={(e) => cambiar(f.id, { categoria: e.target.value })}>
                    <option value="">(sin categoría)</option>
                    {categorias.map((k) => <option key={k.nombre} value={k.nombre}>{k.nombre}</option>)}
                  </select>
                </td>
                <td>
                  <input type="number" min="15" step="15" value={f.duracion}
                    onChange={(e) => cambiar(f.id, { duracion: Number(e.target.value) })} />
                </td>
                <td>
                  <select value={frec} onChange={(e) => cambiar(f.id, porDefecto(e.target.value))}>
                    {FRECUENCIAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                  </select>
                </td>
                <td><Cuando fila={f} cambiar={(c) => cambiar(f.id, c)} /></td>
                <td className="centro">
                  <input type="checkbox" checked={!!f.urgente} onChange={(e) => cambiar(f.id, { urgente: e.target.checked })} />
                </td>
                <td className="mover">
                  <button disabled={i === 0} title="Subir" onClick={() => setFilas((fs) => mover(fs, i, -1))}>↑</button>
                  <button disabled={i === filas.length - 1} title="Bajar" onClick={() => setFilas((fs) => mover(fs, i, 1))}>↓</button>
                  <button className="peligro" title="Quitar" onClick={() => setFilas((fs) => fs.filter((x) => x.id !== f.id))}>×</button>
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
      <div className="fila">
        <button onClick={() => setFilas((fs) => [...fs, { id: nuevoId(), titulo: "", categoria: "", duracion: 120, frecuencia: "semanal", dias: [] }])}>
          + Agregar tarea
        </button>
        <div className="espaciador" />
        {estado && <span className="ayuda">{estado}</span>}
        <button
          className="primario"
          onClick={async () => {
            try {
              await guardar(filas.filter((f) => f.titulo.trim()));
              setEstado("Catálogo guardado ✓");
            } catch (e) {
              setEstado(`Error: ${e.message}`);
            }
          }}
        >Guardar catálogo</button>
      </div>
    </section>
  );
}

function porDefecto(frecuencia) {
  const base = { frecuencia, dias: undefined, dias_mes: undefined, dia_mes: undefined, habiles: undefined };
  if (frecuencia === "semanal") return { ...base, dias: [] };
  if (frecuencia === "quincenal") return { ...base, dias_mes: [1, 16] };
  if (frecuencia === "mensual") return { ...base, habiles: [1, 5] };
  return base;
}

function Cuando({ fila: f, cambiar }) {
  const frec = f.frecuencia || "semanal";
  if (frec === "semanal") {
    return (
      <div className="dias">
        {DIAS_CORTOS.map((d, k) => (
          <label key={d} className={f.dias?.includes(k) ? "marcado" : ""}>
            <input
              type="checkbox"
              checked={f.dias?.includes(k) || false}
              onChange={(e) =>
                cambiar({ dias: e.target.checked ? [...(f.dias || []), k].sort() : (f.dias || []).filter((x) => x !== k) })
              }
            />
            {d}
          </label>
        ))}
      </div>
    );
  }
  if (frec === "quincenal") {
    return (
      <label className="en-linea">Días del mes
        <input className="corto" value={(f.dias_mes || []).join(", ")} onChange={(e) => cambiar({ dias_mes: numeros(e.target.value) })} />
      </label>
    );
  }
  if (frec === "mensual") {
    const porHabiles = !f.dia_mes;
    return (
      <div className="en-linea">
        <select
          value={porHabiles ? "habiles" : "dia"}
          onChange={(e) => cambiar(e.target.value === "habiles" ? { habiles: [1, 5], dia_mes: undefined } : { dia_mes: 1, habiles: undefined })}
        >
          <option value="habiles">Día hábil</option>
          <option value="dia">Día del mes</option>
        </select>
        {porHabiles ? (
          <>
            <input type="number" min="1" max="23" className="corto" value={f.habiles?.[0] ?? 1}
              onChange={(e) => cambiar({ habiles: [Number(e.target.value), Math.max(Number(e.target.value), f.habiles?.[1] ?? 1)] })} />
            al
            <input type="number" min="1" max="23" className="corto" value={f.habiles?.[1] ?? 1}
              onChange={(e) => cambiar({ habiles: [Math.min(f.habiles?.[0] ?? 1, Number(e.target.value)), Number(e.target.value)] })} />
          </>
        ) : (
          <input type="number" min="1" max="28" className="corto" value={f.dia_mes}
            onChange={(e) => cambiar({ dia_mes: Number(e.target.value) })} />
        )}
      </div>
    );
  }
  return <span className="ayuda">Solo manual</span>;
}

function mover(lista, i, delta) {
  const copia = [...lista];
  [copia[i], copia[i + delta]] = [copia[i + delta], copia[i]];
  return copia;
}
