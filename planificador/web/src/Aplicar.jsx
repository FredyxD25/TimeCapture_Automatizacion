import React, { useState } from "react";
import { api } from "./api.js";
import { DIAS, diaSemana, minimoDia, minutosProductivos } from "./util.js";

export default function Aplicar({ dias, cerrar, alTerminar }) {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  const resumen = dias.map((d) => ({
    fecha: d.fecha,
    borrar: d.citas.filter((c) => c.accion === "borrar"),
    categorizar: d.citas.filter((c) => c.categoria_nueva !== undefined && c.categoria_nueva !== c.categoria && c.accion !== "borrar"),
    crear: d.bloques,
    minutos: minutosProductivos(d),
    festivo: d.festivo,
  }));
  const invalidos = dias.flatMap((d) => d.bloques.filter((b) => !b.titulo.trim() || b.fin <= b.inicio).map((b) => ({ fecha: d.fecha, b })));
  const totales = resumen.reduce((t, r) => ({
    borrar: t.borrar + r.borrar.length, crear: t.crear + r.crear.length, categorizar: t.categorizar + r.categorizar.length,
  }), { borrar: 0, crear: 0, categorizar: 0 });

  async function enviar() {
    setEnviando(true);
    try {
      const payload = dias.map((d) => ({
        fecha: d.fecha,
        citas: d.citas.filter((c) => c.accion === "borrar" || (c.categoria_nueva !== undefined && c.categoria_nueva !== c.categoria)),
        bloques: d.bloques.map(({ titulo, categoria, inicio, fin }) => ({ titulo: titulo.trim(), categoria, inicio, fin })),
      }));
      setResultado(await api.aplicar(payload));
    } catch (e) {
      setResultado({ errores: [e.message], creados: 0, borrados: 0, categorizados: 0 });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fondo-modal">
      <div className="panel ancho">
        <div className="panel-cabecera">
          <h3>{resultado ? "Resultado" : "Aplicar a Outlook"}</h3>
          <button className="cerrar" onClick={cerrar} aria-label="Cerrar">×</button>
        </div>

        {!resultado && (
          <>
            <table className="resumen">
              <thead><tr><th>Día</th><th>Se borran</th><th>Se crean</th><th>Se categorizan</th><th>Horas</th></tr></thead>
              <tbody>
                {resumen.map((r) => {
                  const ok = r.festivo || r.minutos >= minimoDia(r.fecha);
                  return (
                    <tr key={r.fecha}>
                      <td>{DIAS[diaSemana(r.fecha)]} {r.fecha.slice(5).split("-").reverse().join("/")}</td>
                      <td title={r.borrar.map((c) => c.titulo).join("\n")}>{r.borrar.length}</td>
                      <td>{r.crear.length}</td>
                      <td>{r.categorizar.length}</td>
                      <td className={ok ? "ok" : "falta"}>{(r.minutos / 60).toFixed(1)} h {ok ? "✓" : "✗"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="detalle">
              Total: se borrarán <b>{totales.borrar}</b> citas (van a “Elementos eliminados” de Outlook y quedan en un respaldo),
              se crearán <b>{totales.crear}</b> y se categorizarán <b>{totales.categorizar}</b> reuniones.
            </p>
            {invalidos.length > 0 && (
              <p className="error">Hay {invalidos.length} bloque(s) sin nombre o con horas inválidas. Corrígelos antes de aplicar.</p>
            )}
            <div className="fila derecha">
              <button onClick={cerrar}>Cancelar</button>
              <button className="peligro" disabled={enviando || invalidos.length > 0} onClick={enviar}>
                {enviando ? "Escribiendo en Outlook…" : "Confirmar y escribir en Outlook"}
              </button>
            </div>
          </>
        )}

        {resultado && (
          <>
            <ul className="resultado">
              <li>✓ Creadas: <b>{resultado.creados}</b></li>
              <li>✓ Borradas: <b>{resultado.borrados}</b></li>
              <li>✓ Categorizadas: <b>{resultado.categorizados}</b></li>
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
