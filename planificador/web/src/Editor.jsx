import React from "react";
import { conHora } from "./util.js";

const NOMBRES_DIA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

const TIPOS = {
  reunion: "Reunión aceptada",
  reunion_pendiente: "Reunión sin aceptar (no se modifica)",
  propia: "Cita propia existente",
  generica: "Cita genérica",
  almuerzo: "Almuerzo existente",
};

export default function Editor({ tipo, objeto, fecha, categorias, catalogo, cerrar, guardar, eliminar, dias = [], moverADia }) {
  const titulos = catalogo.map((t) => t.titulo);

  if (tipo === "cita") {
    const c = objeto;
    const editableCategoria = c.tipo === "reunion" || c.tipo === "propia";
    const reemplazable = c.tipo !== "reunion" && c.tipo !== "reunion_pendiente";
    return (
      <Panel titulo={c.titulo} cerrar={cerrar}>
        <p className="detalle">{TIPOS[c.tipo]} · {c.inicio.slice(11)}–{c.fin.slice(11)}{c.organizador ? ` · ${c.organizador}` : ""}</p>
        {editableCategoria && (
          <label>Categoría
            <select value={c.categoria_nueva ?? c.categoria ?? ""} onChange={(e) => guardar({ categoria_nueva: e.target.value })}>
              <option value="">(sin categoría)</option>
              {categorias.map((k) => <option key={k.nombre} value={k.nombre}>{k.nombre}</option>)}
            </select>
          </label>
        )}
        {c.sugerida && c.categoria_nueva === c.sugerida.categoria && !c.categoria && (
          <p className="nota-sugerida">Sugerida por {c.sugerida.fuente}. Se guarda en Outlook al aplicar.</p>
        )}
        {reemplazable && (
          <label className="check">
            <input
              type="checkbox"
              checked={c.accion === "borrar"}
              onChange={(e) => guardar({ accion: e.target.checked ? "borrar" : "mantener" })}
            />
            Borrarla de Outlook al aplicar (y dejar el espacio para los bloques)
          </label>
        )}
        {c.tipo === "reunion_pendiente" && <p className="detalle">Acéptala en Outlook si quieres que el plan la respete.</p>}
        {c.reemplazo_cierre && (
          <p className="nota-sugerida">
            Es semana de cierre: este informe se reemplaza por su versión “CIERRE - …”. Si la conservas, quita el bloque de cierre
            propuesto para no duplicarlo.
          </p>
        )}
      </Panel>
    );
  }

  const b = objeto;
  return (
    <Panel titulo={b.almuerzo ? "Almuerzo" : "Bloque"} cerrar={cerrar}>
      <label>Actividad
        <input
          list="titulos-catalogo"
          value={b.titulo}
          autoFocus
          placeholder="Escribe o elige del catálogo"
          onChange={(e) => {
            const t = catalogo.find((x) => x.titulo === e.target.value);
            guardar({ titulo: e.target.value, ...(t ? { categoria: t.categoria } : {}) });
          }}
        />
        <datalist id="titulos-catalogo">{titulos.map((t) => <option key={t} value={t} />)}</datalist>
      </label>
      <label>Categoría
        <select value={b.categoria} onChange={(e) => guardar({ categoria: e.target.value })}>
          <option value="">(sin categoría)</option>
          {categorias.map((k) => <option key={k.nombre} value={k.nombre}>{k.nombre}</option>)}
        </select>
      </label>
      <div className="fila">
        {moverADia && dias.length > 1 && (
          <label>Día
            <select value={fecha} onChange={(e) => moverADia(e.target.value)}>
              {dias.map((d) => (
                <option key={d.fecha} value={d.fecha} disabled={d.festivo}>
                  {NOMBRES_DIA[new Date(`${d.fecha}T12:00`).getDay()]} {d.fecha.slice(5).split("-").reverse().join("/")}{d.festivo ? " (festivo)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>Inicio
          <input type="time" step="900" value={b.inicio.slice(11)} onChange={(e) => guardar({ inicio: conHora(fecha, e.target.value) })} />
        </label>
        <label>Fin
          <input type="time" step="900" value={b.fin.slice(11)} onChange={(e) => guardar({ fin: conHora(fecha, e.target.value) })} />
        </label>
      </div>
      {b.fin <= b.inicio && <p className="error">La hora de fin debe ser posterior a la de inicio.</p>}
      <div className="fila derecha">
        <button className="peligro" onClick={eliminar}>Quitar bloque</button>
        <button className="primario" onClick={cerrar}>Listo</button>
      </div>
    </Panel>
  );
}

function Panel({ titulo, cerrar, children }) {
  return (
    <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div className="panel">
        <div className="panel-cabecera">
          <h3>{titulo || "Bloque"}</h3>
          <button className="cerrar" onClick={cerrar} aria-label="Cerrar">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
