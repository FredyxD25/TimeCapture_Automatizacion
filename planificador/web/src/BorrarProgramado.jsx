import React, { useState } from "react";
import { api } from "./api.js";
import { DIAS, diaSemana } from "./util.js";

const fechaCorta = (f) => f.slice(5).split("-").reverse().join("/");
const esReunion = (c) => c.tipo === "reunion" || c.tipo === "reunion_pendiente";

// Borra de Outlook todo lo programado en el rango cargado, excepto las reuniones
export default function BorrarProgramado({ dias, cerrar, alTerminar }) {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const porDia = dias
    .map((d) => ({ fecha: d.fecha, borrar: d.citas.filter((c) => !esReunion(c)), reuniones: d.citas.filter(esReunion).length }))
    .filter((d) => d.borrar.length || d.reuniones);
  const total = porDia.reduce((t, d) => t + d.borrar.length, 0);
  const reuniones = porDia.reduce((t, d) => t + d.reuniones, 0);

  async function borrar() {
    setEnviando(true);
    try {
      const payload = porDia
        .filter((d) => d.borrar.length)
        .map((d) => ({ fecha: d.fecha, bloques: [], citas: d.borrar.map((c) => ({ ...c, accion: "borrar" })) }));
      setResultado(await api.aplicar(payload));
    } catch (e) {
      setResultado({ borrados: 0, errores: [e.message] });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fondo-modal">
      <div className="panel ancho">
        <div className="panel-cabecera">
          <h3>{resultado ? "Resultado" : "Borrar lo programado (excepto reuniones)"}</h3>
          {!enviando && <button className="cerrar" onClick={cerrar} aria-label="Cerrar">×</button>}
        </div>

        {!resultado && (
          <>
            {total === 0 ? (
              <p className="detalle">No hay citas propias para borrar en el rango cargado (solo reuniones).</p>
            ) : (
              <div className="desplazable">
                <table className="resumen">
                  <thead><tr><th>Día</th><th>Se borran</th><th>Reuniones (se conservan)</th><th>Qué se borra</th></tr></thead>
                  <tbody>
                    {porDia.map((d) => (
                      <tr key={d.fecha}>
                        <td className="nowrap">{DIAS[diaSemana(d.fecha)]} {fechaCorta(d.fecha)}</td>
                        <td>{d.borrar.length}</td>
                        <td>{d.reuniones}</td>
                        <td className="suave">{d.borrar.map((c) => `${c.inicio.slice(11)} ${c.titulo}`).join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="detalle">
              Se borrarán de Outlook <b>{total}</b> citas propias (actividades, genéricas y almuerzos) y se conservarán{" "}
              <b>{reuniones}</b> reuniones. Lo borrado va a “Elementos eliminados” de Outlook y queda un respaldo en la carpeta
              <i> respaldos</i>. No afecta lo que ya subiste a Time Capture.
            </p>
            <div className="fila derecha">
              <button onClick={cerrar} disabled={enviando}>Cancelar</button>
              <button className="peligro" onClick={borrar} disabled={enviando || total === 0}>
                {enviando ? "Borrando en Outlook…" : `Borrar ${total} citas de Outlook`}
              </button>
            </div>
          </>
        )}

        {resultado && (
          <>
            <ul className="resultado">
              <li>✓ Borradas: <b>{resultado.borrados}</b></li>
              <li className={resultado.errores?.length ? "falta" : ""}>✗ Errores: <b>{resultado.errores?.length || 0}</b></li>
            </ul>
            {resultado.errores?.length > 0 && <pre className="errores">{resultado.errores.join("\n")}</pre>}
            {resultado.respaldo && <p className="detalle">Respaldo de lo borrado: {resultado.respaldo}</p>}
            <div className="fila derecha">
              <button className="primario" onClick={() => { cerrar(); alTerminar(); }}>Volver a cargar el calendario</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
