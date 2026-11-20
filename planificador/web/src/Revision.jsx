import React, { useMemo, useState } from "react";
import { api } from "./api.js";
import CampoFecha from "./CampoFecha.jsx";
import { DIAS, diaSemana, horaAMin } from "./util.js";

const fechaCorta = (f) => f.slice(5).split("-").reverse().join("/");
const horas = (min) => `${(min / 60).toFixed(1)} h`;
const duracion = ([a, b]) => Math.max(0, horaAMin(b) - horaAMin(a));

// Qué está cargado en Time Capture para el rango y cómo quedó cargado (solo lectura)
export default function Revision({ desde, setDesde, hasta, setHasta, restablecer }) {
  const [datos, setDatos] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const [filtro, setFiltro] = useState("registradas");
  const [buscar, setBuscar] = useState("");
  const [seleccion, setSeleccion] = useState(new Set()); // registros marcados para eliminar
  const [eliminando, setEliminando] = useState(false);

  // Rango que se consultó. El rango de arriba filtra al instante dentro de él (sin volver a consultar).
  const [revisado, setRevisado] = useState(null); // {desde, hasta}
  const [tipo, setTipo] = useState("todos");      // todos | propias | reuniones
  const [etiqueta, setEtiqueta] = useState("");
  const [cliente, setCliente] = useState("");

  async function revisar() {
    setOcupado(true);
    setError("");
    setSeleccion(new Set());
    try {
      setDatos(await api.tcVerificar(desde, hasta));
      setRevisado({ desde, hasta });
    } catch (e) {
      setError(`No se pudo revisar: ${e.message}. ¿Está abierto Outlook clásico?`);
    } finally {
      setOcupado(false);
    }
  }

  // Los filtros afectan todo lo que se muestra: indicadores, por día, gráficos y detalle
  const fueraDeLoRevisado = revisado && (desde < revisado.desde || hasta > revisado.hasta);
  const enRango = (fecha) => fecha >= desde && fecha <= hasta;
  const etiquetaDe = (f) => (f.registrada ? f.etiquetas_tc : f.etiquetas[0]) || "(sin etiqueta)";
  const clientesDe = (f) => (f.registrada ? f.registro.cliente.split("|").filter(Boolean) : []);
  const pasa = (f) => enRango(f.fecha)
    && (tipo === "todos" || (tipo === "reuniones") === f.asistente)
    && (!etiqueta || etiquetaDe(f) === etiqueta)
    && (!cliente || clientesDe(f).includes(cliente));
  const r = useMemo(
    () => (datos ? resumir({ ...datos, filas: datos.filas.filter(pasa), dias: datos.dias.filter((d) => enRango(d.fecha)) }) : null),
    [datos, desde, hasta, tipo, etiqueta, cliente], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const enElRango = datos ? datos.filas.filter((f) => enRango(f.fecha)) : [];
  const opcionesEtiqueta = [...new Set(enElRango.map(etiquetaDe))].sort();
  const opcionesCliente = [...new Set(enElRango.flatMap(clientesDe))].sort();
  const hayFiltros = tipo !== "todos" || etiqueta || cliente || buscar.trim();
  const quitarFiltros = () => { setTipo("todos"); setEtiqueta(""); setCliente(""); setBuscar(""); };
  const texto = sinTildes(buscar.trim());
  const visibles = !r ? [] : r.filas
    .filter((f) => filtro === "todas" ? true : filtro === "registradas" ? f.registrada : filtro === "pendientes" ? !f.registrada : f.observaciones.length > 0)
    .filter((f) => !texto || sinTildes(f.titulo).includes(texto));
  const eliminables = visibles.filter((f) => f.registrada);
  const aEliminar = r ? r.filas.filter((f) => f.registrada && seleccion.has(f.clave)) : [];

  function alternar(clave) {
    setSeleccion((s) => {
      const n = new Set(s);
      n.has(clave) ? n.delete(clave) : n.add(clave);
      return n;
    });
  }

  return (
    <section className="tc">
      {error && <div className="alerta">{error}</div>}
      <section className="controles fija">
        <span className="campo">Desde <CampoFecha valor={desde} onChange={setDesde} /></span>
        <span className="campo">Hasta <CampoFecha valor={hasta} onChange={setHasta} /></span>
        <button onClick={restablecer} title="Del día 1 del mes en curso hasta ayer">Mes en curso</button>
        <button className={`primario ${fueraDeLoRevisado || (!revisado && !ocupado) ? "llamar" : ""}`} onClick={revisar} disabled={ocupado}>
          {ocupado ? "Revisando…" : "Revisar lo cargado"}
        </button>
        <span className={`ayuda ${fueraDeLoRevisado ? "falta" : ""}`}>
          {fueraDeLoRevisado
            ? `El rango incluye fechas que no se han revisado (se revisó del ${fechaCorta(revisado.desde)} al ${fechaCorta(revisado.hasta)}): pulsa “Revisar lo cargado”.`
            : revisado
              ? "Cambiar las fechas dentro de lo revisado filtra al instante. Solo se elimina algo si lo marcas y lo confirmas."
              : "Consulta lo cargado. Solo se elimina algo si lo marcas y lo confirmas."}
        </span>
      </section>

      {!r && !ocupado && <p className="vacio">Elige un rango y pulsa “Revisar lo cargado”.</p>}
      {ocupado && <p className="vacio">Consultando Outlook y Time Capture…</p>}

      {r && !ocupado && (
        <>
          <div className="kpis">
            <Kpi titulo="Registradas" valor={`${r.registradas.length} de ${r.filas.length}`} detalle={`${r.cobertura}% de las actividades del rango`} />
            <Kpi titulo="Horas registradas" valor={horas(r.minRegistrados)} detalle={`productivas · ${horas(r.minNoProductivos)} no productivas`} />
            <Kpi titulo="Pendientes" valor={r.filas.length - r.registradas.length} detalle="en Outlook sin registro" alerta={r.filas.length > r.registradas.length} />
            <Kpi titulo="Con observaciones" valor={r.conObservaciones} detalle="etiqueta u horario distinto" alerta={r.conObservaciones > 0} />
          </div>

          <div className="paneles">
            <div className="panel-tarjeta">
              <h3>Por día</h3>
              <table>
                <thead><tr><th>Día</th><th>En Outlook</th><th>Registrado</th><th>Estado</th></tr></thead>
                <tbody>
                  {r.dias.map((d) => (
                    <tr key={d.fecha}>
                      <td>{DIAS[diaSemana(d.fecha)].slice(0, 3)} {fechaCorta(d.fecha)}</td>
                      <td>{horas(d.minOutlook)}</td>
                      <td>{horas(d.minRegistrado)}</td>
                      <td className={d.estado.ok ? "ok" : d.estado.neutro ? "suave" : "falta"}>{d.estado.texto}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Barras titulo="Horas por cliente" items={r.porCliente} />
            <Barras titulo="Horas por proceso" items={r.porProceso} />
            <Barras titulo="Horas por etiqueta" items={r.porEtiqueta} />
          </div>

          <div className="filtros">
            {[
              ["registradas", `Registradas (${r.registradas.length})`],
              ["pendientes", `Pendientes (${r.filas.length - r.registradas.length})`],
              ["observaciones", `Con observaciones (${r.conObservaciones})`],
              ["todas", `Todas (${r.filas.length})`],
            ].map(([v, t]) => (
              <button key={v} className={filtro === v ? "activa" : ""} onClick={() => setFiltro(v)}>{t}</button>
            ))}
          </div>

          <section className={`controles filtro-fechas ${hayFiltros ? "activo" : ""}`}>
            <label>Buscar <input value={buscar} placeholder="Ej.: CIERRE" onChange={(e) => setBuscar(e.target.value)} /></label>
            <label>Tipo
              <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                <option value="todos">Todas</option>
                <option value="propias">Propias</option>
                <option value="reuniones">Reuniones</option>
              </select>
            </label>
            <label>Etiqueta
              <select value={etiqueta} onChange={(e) => setEtiqueta(e.target.value)}>
                <option value="">Todas</option>
                {opcionesEtiqueta.map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
            <label>Cliente
              <select value={cliente} onChange={(e) => setCliente(e.target.value)}>
                <option value="">Todos</option>
                {opcionesCliente.map((o) => <option key={o}>{o}</option>)}
              </select>
            </label>
            <button disabled={!hayFiltros} onClick={quitarFiltros}>Quitar filtros</button>
            <span className="ayuda">{aEliminar.length} registro(s) marcados para eliminar</span>
            <div className="espaciador" />
            <button
              className="peligro"
              disabled={!aEliminar.length}
              title="Quita de Time Capture los registros marcados. Outlook no se toca."
              onClick={() => setEliminando(true)}
            >Eliminar de Time Capture…</button>
          </section>

          <div className="desplazable">
            <table className="tabla-tc">
            <thead>
              <tr>
                <th title="Marcar todos los registrados que se ven">
                  <input
                    type="checkbox"
                    disabled={!eliminables.length}
                    checked={eliminables.length > 0 && eliminables.every((f) => seleccion.has(f.clave))}
                    onChange={(e) => setSeleccion((s) => {
                      const n = new Set(s);
                      eliminables.forEach((f) => (e.target.checked ? n.add(f.clave) : n.delete(f.clave)));
                      return n;
                    })}
                  />
                </th>
                <th>Día</th><th>Fecha</th><th>Actividad</th><th>Cliente</th><th>Proceso / Gerencia</th><th>Negocio · País</th>
                <th>Etiqueta en TC</th><th>Observaciones</th>
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.clave} className={seleccion.has(f.clave) ? "sel" : ""}>
                  <td>
                    {f.registrada && <input type="checkbox" checked={seleccion.has(f.clave)} onChange={() => alternar(f.clave)} />}
                  </td>
                  <td className="nowrap">{DIAS[diaSemana(f.fecha)]}</td>
                  <td className="nowrap">
                    {fechaCorta(f.fecha)} {f.registrada ? `${f.tiempo_tc[0]}–${f.tiempo_tc[1]}` : `${f.inicio}–${f.fin}`}
                  </td>
                  <td>
                    {f.titulo}
                    <div className="marcas">
                      <span className="marca">{f.asistente ? "Reunión (asistente)" : "Propia"}</span>
                      {!f.suma_horas && <span className="marca">No productiva</span>}
                    </div>
                  </td>
                  {f.registrada ? (
                    <>
                      <td>{f.registro.cliente.split("|").join(", ")}</td>
                      <td>{f.registro.proceso}<div className="suave">{f.registro.gerencia}</div></td>
                      <td>{f.registro.negocio}<div className="suave">{f.registro.pais}</div></td>
                      <td>{f.etiquetas_tc || <span className="falta">(vacía)</span>}</td>
                    </>
                  ) : (
                    <td colSpan={4} className="suave">No está cargada en Time Capture</td>
                  )}
                  <td>
                    {f.observaciones.length ? f.observaciones.map((o) => <div key={o} className="falta">⚠ {o}</div>) : f.registrada ? <span className="ok">✓ Correcta</span> : ""}
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </div>
          <p className="ayuda">
            Se revisan las actividades que existen en tu calendario de Outlook en el rango. Un registro creado en Time Capture
            desde otra cita, o una cita a la que luego le cambiaste el título o la hora, no aparece aquí.
          </p>
        </>
      )}

      {eliminando && (
        <VentanaEliminar filas={aEliminar} cerrar={() => setEliminando(false)} alTerminar={revisar} />
      )}
    </section>
  );
}

const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Confirmación y resultado de la eliminación en Time Capture
function VentanaEliminar({ filas, cerrar, alTerminar }) {
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState(null);

  async function eliminar() {
    setEnviando(true);
    try {
      setResultado(await api.tcEliminar(filas.map((f) => f.clave)));
    } catch (e) {
      setResultado({ resultados: filas.map((f) => ({ clave: f.clave, ok: false, detalle: e.message })) });
    } finally {
      setEnviando(false);
    }
  }

  const tituloDe = (clave) => filas.find((f) => f.clave === clave)?.titulo || clave;
  const ok = resultado?.resultados.filter((x) => x.ok) || [];
  const mal = resultado?.resultados.filter((x) => !x.ok) || [];

  return (
    <div className="fondo-modal">
      <div className="panel ancho">
        <div className="panel-cabecera">
          <h3>{resultado ? "Resultado" : "Eliminar de Time Capture"}</h3>
          {!enviando && <button className="cerrar" onClick={resultado ? () => { cerrar(); alTerminar(); } : cerrar} aria-label="Cerrar">×</button>}
        </div>

        {!resultado && (
          <>
            <div className="desplazable">
              <table className="resumen">
                <thead><tr><th>Día</th><th>Horario</th><th>Actividad</th><th>Cliente</th><th>Etiqueta</th></tr></thead>
                <tbody>
                  {filas.map((f) => (
                    <tr key={f.clave}>
                      <td className="nowrap">{DIAS[diaSemana(f.fecha)].slice(0, 3)} {fechaCorta(f.fecha)}</td>
                      <td className="nowrap">{f.tiempo_tc[0]}–{f.tiempo_tc[1]}</td>
                      <td>{f.titulo}</td>
                      <td>{f.registro.cliente.split("|").join(", ")}</td>
                      <td>{f.etiquetas_tc || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="detalle">
              Se eliminarán <b>{filas.length}</b> registro(s) de Time Capture. Las citas en Outlook <b>no se tocan</b>, así que
              puedes corregirlas y volver a subirlas. Antes de eliminar se guarda un respaldo con los datos de cada registro.
            </p>
            <div className="fila derecha">
              <button onClick={cerrar} disabled={enviando}>Cancelar</button>
              <button className="peligro" onClick={eliminar} disabled={enviando}>
                {enviando ? "Eliminando…" : `Eliminar ${filas.length} de Time Capture`}
              </button>
            </div>
          </>
        )}

        {resultado && (
          <>
            <ul className="resultado">
              <li>✓ Eliminadas y confirmadas: <b>{ok.length}</b></li>
              <li className={mal.length ? "falta" : ""}>✗ No se pudieron eliminar: <b>{mal.length}</b></li>
            </ul>
            {mal.length > 0 && (
              <div className="errores">
                {mal.map((x) => <div key={x.clave}><b>{tituloDe(x.clave)}</b> ({fechaCorta(x.clave.slice(0, 10))}) — {x.detalle}</div>)}
              </div>
            )}
            {resultado.respaldo && <p className="detalle">Respaldo de lo eliminado: {resultado.respaldo}</p>}
            <div className="fila derecha">
              <button className="primario" onClick={() => { cerrar(); alTerminar(); }}>Volver a revisar</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ titulo, valor, detalle, alerta }) {
  return (
    <div className={`kpi ${alerta ? "alerta-kpi" : ""}`}>
      <span className="kpi-titulo">{titulo}</span>
      <strong className="kpi-valor">{valor}</strong>
      <span className="kpi-detalle">{detalle}</span>
    </div>
  );
}

// Barras horizontales de una sola serie: el valor va escrito, el color solo marca la magnitud
function Barras({ titulo, items }) {
  const max = Math.max(1, ...items.map((i) => i.min));
  return (
    <div className="panel-tarjeta">
      <h3>{titulo}</h3>
      {!items.length && <p className="suave">Sin registros en el rango.</p>}
      <div className="barras">
        {items.map((i) => (
          <div key={i.nombre} className="barra-fila" title={`${i.nombre}: ${horas(i.min)} · ${i.n} actividad(es)`}>
            <span className="barra-nombre">{i.nombre}</span>
            <span className="barra-pista"><span className="barra-relleno" style={{ width: `${(i.min / max) * 100}%` }} /></span>
            <span className="barra-valor">{horas(i.min)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function agrupar(registradas, clavesDe) {
  const mapa = new Map();
  for (const f of registradas) {
    const claves = clavesDe(f);
    for (const k of claves) {
      const actual = mapa.get(k) || { nombre: k, min: 0, n: 0 };
      actual.min += f.min / claves.length; // varias claves (p. ej. dos clientes) se reparten el tiempo
      actual.n += 1;
      mapa.set(k, actual);
    }
  }
  return [...mapa.values()].sort((a, b) => b.min - a.min);
}

function resumir(datos) {
  const clavesRegistradas = new Set(datos.filas.filter((f) => f.registrada).map((f) => f.clave));
  const filas = datos.filas.map((f) => {
    const observaciones = [];
    if (f.registrada) {
      // Cruce con otra actividad que también quedó registrada (las horas se cuentan dos veces)
      for (const x of f.cruces_detalle || []) {
        if (clavesRegistradas.has(x.clave)) observaciones.push(`Se cruza con “${x.titulo}” (${x.inicio}–${x.fin}, ${x.minutos} min), también registrada`);
      }
      if (f.etiquetas.length && !f.etiquetas_tc) observaciones.push("Etiqueta vacía en Time Capture");
      else if (f.etiquetas.length && !f.etiquetas.every((n) => f.etiquetas_tc.includes(n)))
        observaciones.push(`Etiqueta distinta a Outlook (${f.etiquetas.join(", ")})`);
      if (!f.etiquetas.length && !f.etiquetas_tc) observaciones.push("Sin etiqueta");
      if (f.tiempo_tc && (f.tiempo_tc[0] !== f.inicio || f.tiempo_tc[1] !== f.fin))
        observaciones.push(`Horario distinto a Outlook (${f.inicio}–${f.fin})`);
    }
    const min = f.registrada ? duracion(f.tiempo_tc) : 0;
    return { ...f, observaciones, min };
  });
  const registradas = filas.filter((f) => f.registrada);
  const productivas = registradas.filter((f) => f.suma_horas);

  const dias = datos.dias.map((d) => {
    const minRegistrado = productivas.filter((f) => f.fecha === d.fecha).reduce((s, f) => s + f.min, 0);
    const minimo = 8 * 60;
    let estado;
    if (!d.laborable) estado = { texto: d.festivo ? "Festivo" : "No laborable", neutro: true };
    else if (minRegistrado >= minimo) estado = { texto: "✓ Completo", ok: true };
    else if (minRegistrado === 0) estado = { texto: "✗ Nada cargado" };
    else estado = { texto: `✗ Faltan ${horas(minimo - minRegistrado)}` };
    return { fecha: d.fecha, minOutlook: d.horas * 60, minRegistrado, estado };
  });

  return {
    filas,
    registradas,
    dias,
    cobertura: filas.length ? Math.round((registradas.length / filas.length) * 100) : 0,
    minRegistrados: productivas.reduce((s, f) => s + f.min, 0),
    minNoProductivos: registradas.filter((f) => !f.suma_horas).reduce((s, f) => s + f.min, 0),
    conObservaciones: filas.filter((f) => f.observaciones.length).length,
    porCliente: agrupar(productivas, (f) => f.registro.cliente.split("|").filter(Boolean)),
    porProceso: agrupar(productivas, (f) => [f.registro.proceso || "(sin proceso)"]),
    porEtiqueta: agrupar(registradas, (f) => [f.etiquetas_tc || "(sin etiqueta)"]),
  };
}
