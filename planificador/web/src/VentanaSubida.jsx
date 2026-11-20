import React, { useState } from "react";
import { DIAS, diaSemana, horaAMin } from "./util.js";

const fechaCorta = (f) => f.slice(5).split("-").reverse().join("/");

// Ventana de confirmación y resultado de la subida a Time Capture (como "Aplicar a Outlook")
export default function VentanaSubida({ filas, diasMap, horasMinimas, subir, cerrar, registradas = new Set() }) {
  const [fase, setFase] = useState("confirmar"); // confirmar | enviando | resultado
  const [simulado, setSimulado] = useState(false);
  const [resultado, setResultado] = useState([]);

  // Un cruce cuenta si la otra actividad también va a quedar en Time Capture (se sube o ya está registrada)
  const seSuben = new Set(filas.map((f) => f.clave));
  const quedan = new Set([...seSuben, ...registradas]);
  const porDia = {};
  for (const f of filas) {
    const d = (porDia[f.fecha] ||= { fecha: f.fecha, nuevas: 0, actualizar: 0, min: 0, sugeridas: 0, avisos: new Set() });
    f.registrada ? d.actualizar++ : d.nuevas++;
    if (f.suma_horas) d.min += Math.max(0, horaAMin(f.fin) - horaAMin(f.inicio));
    if (!f.etiquetas.length && f.sugerida) d.sugeridas++;
    if (!f.etiquetas.length && !f.sugerida) d.avisos.add("sin etiqueta");
    if (f.generica) d.avisos.add("título genérico");
    if (f.sin_aceptar) d.avisos.add("reunión sin aceptar");
    for (const x of f.cruces_detalle || []) {
      // (entre dos que se suben se avisa una sola vez; con una ya registrada, siempre)
      if (quedan.has(x.clave) && (!seSuben.has(x.clave) || f.clave < x.clave)) {
        d.avisos.add(`cruce ${x.inicio}–${x.fin}${seSuben.has(x.clave) ? "" : " con una ya registrada"}`);
      }
    }
    const dia = diasMap[f.fecha];
    if (dia && dia.laborable && !dia.cumple) d.avisos.add(`día con menos de ${horasMinimas} h`);
    if (dia?.festivo) d.avisos.add("festivo");
  }
  const dias = Object.values(porDia).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const total = dias.reduce((t, d) => ({
    nuevas: t.nuevas + d.nuevas, actualizar: t.actualizar + d.actualizar, min: t.min + d.min, sugeridas: t.sugeridas + d.sugeridas,
  }), { nuevas: 0, actualizar: 0, min: 0, sugeridas: 0 });

  async function enviar(sim) {
    setFase("enviando");
    setSimulado(sim);
    try {
      setResultado(await subir(sim));
    } catch (e) {
      setResultado(filas.map((f) => ({ clave: f.clave, ok: false, detalle: e.message })));
    }
    setFase("resultado");
  }

  const tituloDe = (clave) => filas.find((f) => f.clave === clave)?.titulo || clave.split("|")[2];
  const ok = resultado.filter((x) => x.ok);
  const mal = resultado.filter((x) => !x.ok);

  return (
    <div className="fondo-modal">
      <div className="panel ancho">
        <div className="panel-cabecera">
          <h3>{fase === "resultado" ? (simulado ? "Resultado de la simulación" : "Resultado de la subida") : "Subir a Time Capture"}</h3>
          {fase !== "enviando" && <button className="cerrar" onClick={cerrar} aria-label="Cerrar">×</button>}
        </div>

        {fase !== "resultado" && (
          <>
            <div className="desplazable">
              <table className="resumen">
                <thead><tr><th>Día</th><th>Nuevas</th><th>Se actualizan</th><th>Horas</th><th>Etiquetas sugeridas</th><th>Avisos</th></tr></thead>
                <tbody>
                  {dias.map((d) => (
                    <tr key={d.fecha}>
                      <td className="nowrap">{DIAS[diaSemana(d.fecha)]} {fechaCorta(d.fecha)}</td>
                      <td>{d.nuevas}</td>
                      <td>{d.actualizar}</td>
                      <td>{(d.min / 60).toFixed(1)} h</td>
                      <td>{d.sugeridas || "—"}</td>
                      <td className={d.avisos.size ? "falta" : "ok"}>{d.avisos.size ? [...d.avisos].join(", ") : "✓"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="detalle">
              Total: se subirán <b>{total.nuevas}</b> actividades nuevas y se actualizarán <b>{total.actualizar}</b> ya registradas
              ({(total.min / 60).toFixed(1)} h productivas).
              {total.sugeridas > 0 && <> Antes se guardarán en Outlook <b>{total.sugeridas}</b> etiquetas sugeridas.</>}
              {" "}Cada actividad se vuelve a consultar en Time Capture para confirmar que quedó guardada.
            </p>
            <div className="fila derecha">
              <button onClick={cerrar} disabled={fase === "enviando"}>Cancelar</button>
              <button onClick={() => enviar(true)} disabled={fase === "enviando"}>Simular</button>
              <button className="peligro" onClick={() => enviar(false)} disabled={fase === "enviando"}>
                {fase === "enviando" ? (simulado ? "Simulando…" : "Subiendo a Time Capture…") : "Confirmar y subir a Time Capture"}
              </button>
            </div>
          </>
        )}

        {fase === "resultado" && (
          <>
            {simulado && <p className="detalle">Simulación: no se envió nada a Time Capture.</p>}
            <ul className="resultado">
              <li>✓ {simulado ? "Se subirían" : "Subidas y confirmadas"}: <b>{ok.length}</b></li>
              <li className={mal.length ? "falta" : ""}>✗ No se pudieron subir: <b>{mal.length}</b></li>
            </ul>
            {mal.length > 0 && (
              <div className="errores">
                {mal.map((x) => (
                  <div key={x.clave}><b>{tituloDe(x.clave)}</b> ({fechaCorta(x.clave.slice(0, 10))} {x.clave.slice(11, 16)}) — {x.detalle}</div>
                ))}
              </div>
            )}
            <div className="fila derecha">
              {simulado && <button className="peligro" onClick={() => enviar(false)}>Subir de verdad</button>}
              <button className="primario" onClick={cerrar}>Cerrar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
