import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import CampoFecha, { FestivosContexto } from "./CampoFecha.jsx";
import { nuevoId, rangoPorDefecto } from "./util.js";
import Semana from "./Semana.jsx";
import Catalogo from "./Catalogo.jsx";
import Aplicar from "./Aplicar.jsx";
import TimeCapture from "./TimeCapture.jsx";
import ReglasEtiquetas from "./ReglasEtiquetas.jsx";
import EtiquetasAprendidas from "./EtiquetasAprendidas.jsx";
import Revision from "./Revision.jsx";
import BorrarProgramado from "./BorrarProgramado.jsx";

function conIds(dias) {
  return dias.map((d) => ({ ...d, bloques: d.bloques.map((b) => ({ ...b, id: nuevoId() })) }));
}

export default function App() {
  // Rango compartido por todas las pestañas; al abrir la app arranca en el rango por defecto
  const [desde, setDesde] = useState(() => rangoPorDefecto().desde);
  const [hasta, setHasta] = useState(() => rangoPorDefecto().hasta);
  const restablecer = () => {
    const r = rangoPorDefecto();
    setDesde(r.desde);
    setHasta(r.hasta);
  };
  const [pestana, setPestana] = useState("plan");
  const [dias, setDias] = useState([]);
  const [categorias, setCategorias] = useState([]);
  const [catalogo, setCatalogo] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState("");
  const [aplicando, setAplicando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [actualizado, setActualizado] = useState("");

  const [festivos, setFestivos] = useState({}); // {fecha: nombre}, para los selectores de fecha

  // Encabezado y barra de fechas siempre visibles: la barra se pega justo debajo del encabezado
  const barraRef = useRef(null);
  useEffect(() => {
    const el = barraRef.current;
    if (!el) return undefined;
    const fijar = () => document.documentElement.style.setProperty("--alto-barra", `${el.offsetHeight}px`);
    fijar();
    const obs = new ResizeObserver(fijar);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    api.categorias().then(setCategorias).catch((e) => setError(`No se pudieron leer las categorías: ${e.message}`));
    api.catalogo().then(setCatalogo).catch(() => {});
    const anio = new Date().getFullYear();
    api.festivos(anio - 2, anio + 2)
      .then((lista) => setFestivos(Object.fromEntries(lista.map((f) => [f.fecha, f.nombre]))))
      .catch(() => {});
  }, []);

  const [modificado, setModificado] = useState(false); // la propuesta tiene cambios sin aplicar
  const cargado = useRef("");   // "desde|hasta" que se está mostrando
  const peticion = useRef(0);   // solo vale la respuesta de la última carga

  const rangoValido = desde && hasta && desde >= "2000-01-01" && hasta >= desde;

  async function cargar() {
    if (!rangoValido) {
      setError("Revisa el rango: “Hasta” debe ser igual o posterior a “Desde”.");
      return;
    }
    const id = ++peticion.current;
    const clave = `${desde}|${hasta}`;
    setCargando(true);
    setError("");
    setDias([]); // limpia la vista para que se note que se está recargando
    try {
      const datos = conIds(await api.semana(desde, hasta));
      if (id !== peticion.current) return; // el rango cambió mientras cargaba
      setDias(datos);
      cargado.current = clave;
      setModificado(false);
      setActualizado(new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
      document.querySelector(".semana")?.scrollTo({ left: 0 });
    } catch (e) {
      if (id === peticion.current) setError(`No se pudo leer Outlook: ${e.message}. ¿Está abierto Outlook clásico?`);
    } finally {
      if (id === peticion.current) setCargando(false);
    }
  }

  // Como un filtro de Power BI: al cambiar el rango (o al abrir la app) se carga solo.
  // Espera medio segundo por si sigues escribiendo y no recarga si hay cambios sin aplicar.
  const rangoCambio = `${desde}|${hasta}` !== cargado.current;
  useEffect(() => {
    if (pestana !== "plan" || !rangoCambio || modificado) return undefined;
    if (!rangoValido) {
      setError("Revisa el rango: “Hasta” debe ser igual o posterior a “Desde”.");
      return undefined;
    }
    const t = setTimeout(cargar, 500);
    return () => clearTimeout(t);
  }, [desde, hasta, pestana, modificado]); // eslint-disable-line react-hooks/exhaustive-deps

  function cambiarDia(fecha, cambio) {
    setDias((ds) => ds.map((d) => (d.fecha === fecha ? { ...d, ...cambio(d) } : d)));
    setModificado(true);
  }

  function volverAlRangoCargado() {
    const [d, h] = cargado.current.split("|");
    setDesde(d);
    setHasta(h);
  }

  async function replanificar(dia) {
    try {
      const r = await api.replanificar(dia);
      cambiarDia(dia.fecha, () => ({
        bloques: r.bloques.map((b) => ({ ...b, id: nuevoId() })), avisos: r.avisos, pendientes: r.pendientes,
      }));
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <FestivosContexto.Provider value={festivos}>
    <div className="app">
      <header className="barra" ref={barraRef}>
        <h1 className="titulo-app"><img src="/logo.png" alt="" className="logo-app" />Planificador Outlook<span className="autor-app" title="https://github.com/FredyxD25/TimeCapture_Automatizacion">v1.0.3 · por FredyxD25</span></h1>
        <nav className="pestanas">
          <button className={pestana === "plan" ? "activa" : ""} onClick={() => setPestana("plan")}>Planificador</button>
          <button className={pestana === "catalogo" ? "activa" : ""} onClick={() => setPestana("catalogo")}>Catálogo de tareas</button>
          <button className={pestana === "tc" ? "activa" : ""} onClick={() => setPestana("tc")}>Time Capture</button>
          <button className={pestana === "revision" ? "activa" : ""} onClick={() => setPestana("revision")}>Revisión</button>
        </nav>
      </header>

      {error && <div className="alerta">{error}</div>}

      {pestana === "plan" && (
        <>
          <section className="controles fija">
            <span className="campo">Desde <CampoFecha valor={desde} onChange={setDesde} /></span>
            <span className="campo">Hasta <CampoFecha valor={hasta} onChange={setHasta} /></span>
            <button onClick={restablecer} title="Del día 1 del mes en curso hasta ayer">Mes en curso</button>
            <button onClick={cargar} disabled={cargando} title="Vuelve a leer Outlook y a proponer (descarta cambios sin aplicar)">
              {cargando ? "Leyendo Outlook…" : "↻ Recargar"}
            </button>
            <span className="ayuda">
              {cargando ? "Leyendo Outlook y armando la propuesta…" : actualizado ? `Actualizado a las ${actualizado}` : "L–J 08:00–17:30 · V 08:00–17:00 · almuerzo 1 h entre 12:00 y 14:00"}
            </span>
            <div className="espaciador" />
            <button
              className="peligro"
              disabled={!dias.length || cargando}
              title="Borra de Outlook todas tus citas del rango cargado, excepto las reuniones"
              onClick={() => setBorrando(true)}
            >Borrar lo programado…</button>
            <button className="peligro" disabled={!dias.length} onClick={() => setAplicando(true)}>Aplicar a Outlook…</button>
          </section>

          {modificado && rangoCambio && rangoValido && !cargando && (
            <div className="aviso-cambios">
              <span>Cambiaste el rango, pero la propuesta actual tiene cambios que no has aplicado a Outlook.</span>
              <button className="peligro" onClick={cargar}>Descartar cambios y cargar el nuevo rango</button>
              <button onClick={volverAlRangoCargado}>Volver al rango anterior</button>
            </div>
          )}

          <Leyenda />

          {cargando && <p className="vacio">Leyendo tu calendario de {desde} a {hasta}…</p>}

          {dias.length === 0 && !cargando && (
            <p className="vacio">Elige un rango y se cargará solo. Nada se escribe en Outlook hasta que confirmes en “Aplicar a Outlook”.</p>
          )}

          <Semana
            dias={dias}
            categorias={categorias}
            catalogo={catalogo}
            cambiarDia={cambiarDia}
            replanificar={replanificar}
          />
        </>
      )}

      {pestana === "catalogo" && (
        <div className="columna-secciones">
          <Catalogo
            catalogo={catalogo}
            categorias={categorias}
            guardar={async (datos) => {
              await api.guardarCatalogo(datos);
              setCatalogo(datos);
            }}
          />
          <EtiquetasAprendidas categorias={categorias} />
          <ReglasEtiquetas categorias={categorias} />
        </div>
      )}

      {/* Se mantiene montada para no perder la verificación al cambiar de pestaña */}
      <div style={{ display: pestana === "tc" ? "block" : "none" }}>
        <TimeCapture desde={desde} setDesde={setDesde} hasta={hasta} setHasta={setHasta} restablecer={restablecer} />
      </div>
      <div style={{ display: pestana === "revision" ? "block" : "none" }}>
        <Revision desde={desde} setDesde={setDesde} hasta={hasta} setHasta={setHasta} restablecer={restablecer} />
      </div>

      {borrando && <BorrarProgramado dias={dias} cerrar={() => setBorrando(false)} alTerminar={() => cargar()} />}

      {aplicando && (
        <Aplicar
          dias={dias}
          cerrar={() => setAplicando(false)}
          alTerminar={() => cargar()}
        />
      )}
    </div>
    </FestivosContexto.Provider>
  );
}

function Leyenda() {
  return (
    <div className="leyenda">
      <span><i className="m m-reunion" /> Reunión aceptada (fija)</span>
      <span><i className="m m-pendiente" /> Reunión sin aceptar (no bloquea)</span>
      <span><i className="m m-propia" /> Cita propia existente</span>
      <span><i className="m m-borrar" /> Se reemplazará</span>
      <span><i className="m m-bloque" /> Bloque propuesto (editable)</span>
    </div>
  );
}
