import React, { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import CampoFecha from "./CampoFecha.jsx";
import { DIAS, diaSemana } from "./util.js";
import Clasificacion, { errorClasificacion } from "./Clasificacion.jsx";
import VentanaSubida from "./VentanaSubida.jsx";

const fechaCorta = (f) => f.slice(5).split("-").reverse().join("/");

// El rango de fechas viene de App y es el mismo del Planificador
export default function TimeCapture({ desde, setDesde, hasta, setHasta, restablecer }) {
  const [catalogos, setCatalogos] = useState(null);
  const [datos, setDatos] = useState(null);           // {filas, dias, correo}
  const [seleccion, setSeleccion] = useState(new Set());
  const [clasif, setClasif] = useState({});           // clave -> clasificación
  const [porDefecto, setPorDefecto] = useState(null);
  const [resultados, setResultados] = useState({});   // clave -> {ok, detalle, simulado}
  const [ocupado, setOcupado] = useState("");
  const [error, setError] = useState("");
  const [editando, setEditando] = useState(null);     // clave
  const [confirmar, setConfirmar] = useState(null);   // "subir" | "etiquetas"
  const [congeladas, setCongeladas] = useState([]);  // las seleccionadas al abrir la ventana de subida

  const [categorias, setCategorias] = useState([]);
  const [guardandoEtiqueta, setGuardandoEtiqueta] = useState(""); // clave
  const [notaEtiqueta, setNotaEtiqueta] = useState({});           // clave -> {ok, texto}, bajo el selector
  const [soloCruces, setSoloCruces] = useState(false);
  const [buscar, setBuscar] = useState("");
  const [estado, setEstado] = useState("todas"); // todas | pendientes | registradas | seleccionadas
  const [tipo, setTipo] = useState("todos");     // todos | propias | reuniones
  const [etiqueta, setEtiqueta] = useState("");

  useEffect(() => {
    api.categorias().then(setCategorias).catch(() => {});
    api.tcCatalogos()
      .then((c) => { setCatalogos(c); setPorDefecto(c.defaults); })
      .catch((e) => setError(`No se pudieron cargar las listas de Time Capture: ${e.message}`));
  }, []);

  const diasMap = useMemo(() => Object.fromEntries((datos?.dias || []).map((d) => [d.fecha, d])), [datos]);

  async function verificar() {
    setOcupado("Verificando en Outlook y Time Capture…");
    setError("");
    setResultados({});
    try {
      const v = await api.tcVerificar(desde, hasta);
      setDatos(v);
      const c = {};
      const sel = new Set();
      const diaOk = Object.fromEntries(v.dias.map((d) => [d.fecha, d.cumple]));
      const festivos = new Set(v.dias.filter((d) => d.festivo).map((d) => d.fecha)); // en festivo no se preselecciona
      const yaSubidas = new Set(v.filas.filter((f) => f.registrada).map((f) => f.clave));
      for (const f of v.filas) {
        c[f.clave] = f.registro || { ...porDefecto };
        // Tampoco se preselecciona si ese horario ya está ocupado por una actividad subida
        const ocupadoPorSubida = (f.cruces_detalle || []).some((x) => yaSubidas.has(x.clave));
        if (!f.registrada && !f.generica && !f.invalida && !f.sin_aceptar && !festivos.has(f.fecha)
            && !ocupadoPorSubida && diaOk[f.fecha] !== false) {
          sel.add(f.clave);
        }
      }
      setClasif(c);
      setSeleccion(sel);
    } catch (e) {
      setError(`No se pudo verificar: ${e.message}. ¿Está abierto Outlook clásico?`);
    } finally {
      setOcupado("");
    }
  }

  const filas = datos?.filas || [];
  const registradas = new Set(filas.filter((f) => f.registrada).map((f) => f.clave));
  const quedaEnTc = (clave) => registradas.has(clave) || seleccion.has(clave);
  const etiquetaDe = (f) => f.etiquetas[0] || f.sugerida?.categoria || "(sin etiqueta)";
  const opcionesEtiqueta = [...new Set(filas.map(etiquetaDe))].sort();
  const textoBuscar = buscar.trim().normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const visiblesTc = filas.filter((f) =>
    (!soloCruces || f.cruces_detalle?.length)
    && (estado === "todas" || (estado === "pendientes" && !f.registrada) || (estado === "registradas" && f.registrada)
      || (estado === "seleccionadas" && seleccion.has(f.clave)))
    && (tipo === "todos" || (tipo === "reuniones") === f.asistente)
    && (!etiqueta || etiquetaDe(f) === etiqueta)
    && (!textoBuscar || f.titulo.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(textoBuscar)));
  const hayFiltros = soloCruces || estado !== "todas" || tipo !== "todos" || etiqueta || textoBuscar;
  const quitarFiltros = () => { setSoloCruces(false); setEstado("todas"); setTipo("todos"); setEtiqueta(""); setBuscar(""); };
  const seleccionadas = filas.filter((f) => seleccion.has(f.clave));
  const etiquetasVacias = filas.filter((f) => f.etiqueta_vacia);
  const incompletas = seleccionadas.filter((f) => errorClasificacion(clasif[f.clave]));

  // Cambia la categoría de la cita en Outlook y actualiza la fila
  async function ponerEtiqueta(fila, categoria) {
    setGuardandoEtiqueta(fila.clave);
    setNotaEtiqueta((n) => ({ ...n, [fila.clave]: null }));
    try {
      const r = await api.tcEtiqueta(fila.clave, categoria);
      // En una cita recurrente la etiqueta es de toda la serie: se actualizan todas sus repeticiones
      const afectadas = new Set(r.claves || [fila.clave]);
      setDatos((v) => ({
        ...v,
        filas: v.filas.map((f) =>
          !afectadas.has(f.clave) ? f : {
            ...f,
            etiquetas: r.etiquetas,
            etiqueta_vacia: f.registrada && r.etiquetas.length > 0 && !r.etiquetas.every((n) => (f.etiquetas_tc || "").includes(n)),
          }),
      }));
      if (r.serie) {
        setNotaEtiqueta((n) => ({
          ...n,
          [fila.clave]: { ok: true, texto: `Es una cita recurrente: la etiqueta quedó en toda la serie${afectadas.size > 1 ? ` (${afectadas.size} en este rango)` : ""}.` },
        }));
      }
    } catch (e) {
      setNotaEtiqueta((n) => ({ ...n, [fila.clave]: { ok: false, texto: `No se pudo cambiar: ${e.message}` } }));
    } finally {
      setGuardandoEtiqueta("");
    }
  }

  // Filas sin etiqueta en Outlook que tienen una sugerida
  const conSugerida = (filas) => filas.filter((f) => !f.etiquetas.length && f.sugerida);

  async function aplicarSugeridas(lista) {
    for (const f of lista) await ponerEtiqueta(f, f.sugerida.categoria);
  }

  function alternar(clave) {
    setSeleccion((s) => {
      const n = new Set(s);
      n.has(clave) ? n.delete(clave) : n.add(clave);
      return n;
    });
  }

  // Devuelve el resultado por actividad; la ventana de subida lo muestra
  async function subir(simular, lista = seleccionadas) {
    setOcupado(simular ? "Simulando…" : "Subiendo a Time Capture…");
    try {
      // Antes de subir de verdad, se guardan en Outlook las etiquetas sugeridas de las seleccionadas
      if (!simular) await aplicarSugeridas(conSugerida(lista));
      const r = await api.tcSubir(lista.map((f) => ({ clave: f.clave, clasificacion: clasif[f.clave] })), simular);
      setResultados(Object.fromEntries(r.map((x) => [x.clave, { ...x, simulado: simular }])));
      if (!simular) await refrescarEstados(r);
      return r;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setOcupado("");
    }
  }

  async function repararEtiquetas() {
    setConfirmar(null);
    setOcupado("Corrigiendo etiquetas…");
    try {
      const r = await api.tcRepararEtiquetas(etiquetasVacias.map((f) => f.clave), false);
      setResultados(Object.fromEntries(r.map((x) => [x.clave, x])));
      await refrescarEstados(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setOcupado("");
    }
  }

  // Vuelve a verificar para mostrar el estado real, conservando los resultados
  async function refrescarEstados(r) {
    const v = await api.tcVerificar(desde, hasta);
    setDatos(v);
    setSeleccion(new Set());
    setResultados((prev) => ({ ...prev, ...Object.fromEntries(r.map((x) => [x.clave, x])) }));
  }

  const resumen = useMemo(() => {
    const lista = Object.entries(resultados);
    return { ok: lista.filter(([, x]) => x.ok), mal: lista.filter(([, x]) => !x.ok) };
  }, [resultados]);
  const tituloDe = (clave) => filas.find((f) => f.clave === clave)?.titulo || clave.split("|")[2];

  if (!catalogos) return <section className="tc">{error ? <div className="alerta">{error}</div> : <p className="vacio">Cargando listas de Time Capture…</p>}</section>;

  return (
    <section className="tc">
      {error && <div className="alerta">{error}</div>}

      <section className="controles fija">
        <span className="campo">Desde <CampoFecha valor={desde} onChange={setDesde} /></span>
        <span className="campo">Hasta <CampoFecha valor={hasta} onChange={setHasta} /></span>
        <button onClick={restablecer} title="Del día 1 del mes en curso hasta ayer">Mes en curso</button>
        <button className="primario" onClick={verificar} disabled={!!ocupado}>Verificar rango</button>
        {ocupado && <span className="ayuda">{ocupado}</span>}
        {datos && <span className="ayuda">Cuenta: {datos.correo}</span>}
      </section>

      {datos && (
        <>
          <div className="dias-tc">
            {datos.dias.map((d) => (
              <div key={d.fecha} className={`dia-tc ${!d.laborable ? "nolab" : d.cumple ? "ok" : "falta"}`}>
                <strong>{DIAS[diaSemana(d.fecha)].slice(0, 3)} {fechaCorta(d.fecha)}</strong>
                <span>{d.festivo ? "Festivo" : !d.laborable ? "No laborable" : `${d.horas.toFixed(1)} h ${d.cumple ? "✓" : `· faltan ${(catalogos.horas_minimas - d.horas).toFixed(1)}`}`}</span>
              </div>
            ))}
          </div>

          <div className="panel-defecto">
            <div className="titulo-defecto">
              <strong>Clasificación</strong>
              <span className="ayuda">Elige una y aplícala a las actividades seleccionadas. También puedes editar cada fila.</span>
            </div>
            <Clasificacion valor={porDefecto} catalogos={catalogos} onChange={setPorDefecto} />
            <div className="fila derecha">
              <button
                disabled={!seleccionadas.length}
                onClick={() => setClasif((c) => ({ ...c, ...Object.fromEntries(seleccionadas.map((f) => [f.clave, { ...porDefecto }])) }))}
              >
                Aplicar a {seleccionadas.length} seleccionada(s)
              </button>
            </div>
          </div>

          {/* Filtros de la tabla: solo cambian lo que se ve; la selección de lo oculto se conserva */}
          <section className={`controles filtro-fechas ${hayFiltros ? "activo" : ""}`}>
            <label>Buscar <input value={buscar} placeholder="Título…" onChange={(e) => setBuscar(e.target.value)} /></label>
            <label>Estado
              <select value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="todas">Todas</option>
                <option value="pendientes">Pendientes</option>
                <option value="registradas">Registradas</option>
                <option value="seleccionadas">Seleccionadas</option>
              </select>
            </label>
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
            <label className="check-cruces">
              <input type="checkbox" checked={soloCruces} onChange={(e) => setSoloCruces(e.target.checked)} />
              Solo las que se cruzan ({filas.filter((f) => f.cruces_detalle?.length).length})
            </label>
            <button disabled={!hayFiltros} onClick={quitarFiltros}>Quitar filtros</button>
            <span className="ayuda">Mostrando {visiblesTc.length} de {filas.length}</span>
          </section>
          <div className="desplazable">
            <table className="tabla-tc">
            <thead>
              <tr>
                <th title="Marcar o desmarcar las que se ven">
                  <input
                    type="checkbox"
                    checked={visiblesTc.length > 0 && visiblesTc.every((f) => seleccion.has(f.clave))}
                    onChange={(e) => setSeleccion((s) => {
                      const n = new Set(s);
                      visiblesTc.forEach((f) => (e.target.checked ? n.add(f.clave) : n.delete(f.clave)));
                      return n;
                    })}
                  />
                </th>
                <th>Día</th><th>Fecha</th><th>Actividad</th><th>Se cruza con</th><th>Etiqueta</th><th>Estado</th><th>Clasificación</th>
              </tr>
            </thead>
            <tbody>
              {visiblesTc.map((f) => {
                const c = clasif[f.clave] || {};
                const r = resultados[f.clave];
                const dia = diasMap[f.fecha];
                return (
                  <tr key={f.clave} className={seleccion.has(f.clave) ? "sel" : ""}>
                    <td><input type="checkbox" checked={seleccion.has(f.clave)} onChange={() => alternar(f.clave)} /></td>
                    <td className="nowrap">{DIAS[diaSemana(f.fecha)]}</td>
                    <td className="nowrap">{fechaCorta(f.fecha)} {f.inicio}–{f.fin}</td>
                    <td>
                      {f.titulo}
                      <div className="marcas">
                        {f.asistente && <span className="marca">Reunión</span>}
                        {f.sin_aceptar && <span className="marca roja" title="No la aceptaste en Outlook: no bloquea ni suma horas. Acéptala si quieres subirla.">Sin aceptar</span>}
                        {f.generica && <span className="marca roja">Título genérico</span>}
                        {!f.suma_horas && <span className="marca">No suma horas</span>}
                        {f.invalida && <span className="marca roja">Duración inválida</span>}
                        {dia && dia.laborable && !dia.cumple && <span className="marca roja">Día con menos de {catalogos.horas_minimas} h</span>}
                        {dia?.festivo && <span className="marca roja">Festivo</span>}
                      </div>
                    </td>
                    <td className="cruces">
                      {f.cruces_detalle?.length ? (
                        f.cruces_detalle.map((x, k) => {
                          // El cruce cuenta si las dos van a quedar en Time Capture (ya registradas o seleccionadas para subir)
                          const estaQueda = quedaEnTc(f.clave);
                          const otraQueda = quedaEnTc(x.clave);
                          const activo = estaQueda && otraQueda;
                          const nota = activo
                            ? (registradas.has(x.clave) ? " · ya registrada" : "")
                            : !estaQueda ? " · esta no se sube" : " · no se sube";
                          return (
                            <div key={k} className={activo ? "cruce" : "cruce resuelto"}>
                              <span className="nowrap">{activo ? "⚠" : "✓"} {x.inicio}–{x.fin}</span> {x.titulo}
                              <span className="suave"> · {x.minutos} min{x.reunion ? " · reunión" : ""}{nota}</span>
                            </div>
                          );
                        })
                      ) : (
                        <span className="suave">—</span>
                      )}
                    </td>
                    <td>
                      <select
                        className={`selector-etiqueta ${f.etiquetas.length ? "" : f.sugerida ? "sugerida" : "vacia"}`}
                        value={f.etiquetas[0] || f.sugerida?.categoria || ""}
                        disabled={guardandoEtiqueta === f.clave}
                        title="Se guarda en la cita de Outlook"
                        onChange={(e) => ponerEtiqueta(f, e.target.value)}
                      >
                        <option value="">Sin etiqueta</option>
                        {categorias.map((k) => <option key={k.nombre} value={k.nombre}>{k.nombre}</option>)}
                      </select>
                      {f.etiquetas.length > 1 && <div className="suave">+ {f.etiquetas.slice(1).join(", ")}</div>}
                      {!f.etiquetas.length && f.sugerida && (
                        <div className="nota-sugerida" title="Aún no está guardada en Outlook">Sugerida · {f.sugerida.fuente}</div>
                      )}
                      {guardandoEtiqueta === f.clave && <div className="suave">Guardando en Outlook…</div>}
                      {notaEtiqueta[f.clave] && (
                        <div className={notaEtiqueta[f.clave].ok ? "nota-sugerida" : "error-fila"}>{notaEtiqueta[f.clave].texto}</div>
                      )}
                    </td>
                    <td className="nowrap">
                      {r ? (
                        <span className={r.ok ? "ok" : "falta"} title={r.detalle}>{r.ok ? "✓" : "✗"} {r.simulado ? "Simulada" : r.ok ? "Subida" : "No subió"}</span>
                      ) : f.registrada ? (
                        <span className="ok">Registrada{f.etiqueta_vacia ? <span className="falta"> · etiqueta vacía</span> : ""}</span>
                      ) : (
                        <span className="suave">Pendiente</span>
                      )}
                      {r && !r.ok && <div className="error-fila">{r.detalle}</div>}
                    </td>
                    <td>
                      <button className="enlace" onClick={() => setEditando(f.clave)} title="Editar clasificación">
                        {c.cliente ? c.cliente.split("|").join(", ") : "—"}
                        <span className="suave"> · {c.proceso || "sin proceso"}</span>
                      </button>
                      {errorClasificacion(c) && seleccion.has(f.clave) && <div className="error-fila">{errorClasificacion(c)}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
          </div>

          <section className="controles pie">
            <span className="ayuda">{seleccionadas.length} seleccionada(s) · {seleccionadas.filter((f) => f.registrada).length} ya registradas (se actualizarían)</span>
            <div className="espaciador" />
            <button
              disabled={!conSugerida(filas).length || !!ocupado || !!guardandoEtiqueta}
              title="Guarda en Outlook las etiquetas sugeridas"
              onClick={() => aplicarSugeridas(conSugerida(filas))}
            >
              Aplicar etiquetas sugeridas ({conSugerida(filas).length})
            </button>
            <button disabled={!etiquetasVacias.length || !!ocupado} onClick={() => setConfirmar("etiquetas")}>
              Corregir etiquetas vacías ({etiquetasVacias.length})
            </button>
            <button disabled={!seleccionadas.length || incompletas.length > 0 || !!ocupado} onClick={() => subir(true)}>Simular</button>
            <button className="primario" disabled={!seleccionadas.length || incompletas.length > 0 || !!ocupado} onClick={() => { setCongeladas(seleccionadas); setConfirmar("subir"); }}>
              Subir {seleccionadas.length} a Time Capture…
            </button>
          </section>

          {(resumen.ok.length > 0 || resumen.mal.length > 0) && (
            <div className="reporte">
              <h3>Resultado{Object.values(resultados).some((x) => x.simulado) ? " (simulación, no se envió nada)" : ""}</h3>
              <p className="ok">✓ {resumen.ok.length} correctas</p>
              {resumen.mal.length > 0 && (
                <>
                  <p className="falta">✗ {resumen.mal.length} no se pudieron subir:</p>
                  <ul>{resumen.mal.map(([clave, x]) => <li key={clave}><b>{tituloDe(clave)}</b> ({clave.slice(5, 16).replace("T", " ")}) — {x.detalle}</li>)}</ul>
                </>
              )}
            </div>
          )}
        </>
      )}

      {editando && (
        <div className="fondo-modal" onMouseDown={(e) => e.target === e.currentTarget && setEditando(null)}>
          <div className="panel ancho">
            <div className="panel-cabecera">
              <h3>{tituloDe(editando)}</h3>
              <button className="cerrar" onClick={() => setEditando(null)} aria-label="Cerrar">×</button>
            </div>
            <Clasificacion
              valor={clasif[editando]}
              catalogos={catalogos}
              compacto
              onChange={(v) => setClasif((c) => ({ ...c, [editando]: v }))}
            />
            <div className="fila derecha"><button className="primario" onClick={() => setEditando(null)}>Listo</button></div>
          </div>
        </div>
      )}

      {confirmar === "subir" && (
        <VentanaSubida
          registradas={registradas}
          filas={congeladas}
          diasMap={diasMap}
          horasMinimas={catalogos.horas_minimas}
          subir={(sim) => subir(sim, congeladas)}
          cerrar={() => setConfirmar(null)}
        />
      )}

      {confirmar === "etiquetas" && (
        <div className="fondo-modal">
          <div className="panel">
            <div className="panel-cabecera"><h3>Corregir etiquetas</h3></div>
            <p className="detalle">Se agregará la etiqueta de Outlook a <b>{etiquetasVacias.length}</b> registros, conservando su clasificación.</p>
            <div className="fila derecha">
              <button onClick={() => setConfirmar(null)}>Cancelar</button>
              <button className="primario" onClick={repararEtiquetas}>Confirmar</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
