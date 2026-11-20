import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { isoFecha } from "./util.js";

// Festivos de Colombia {"2026-11-16": "Independencia de Cartagena", ...}, cargados una vez en App
export const FestivosContexto = createContext({});

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const CABECERA = ["L", "M", "X", "J", "V", "S", "D"];

const aFecha = (iso) => new Date(`${iso}T12:00`);
const primeroDelMes = (iso) => {
  const d = iso ? aFecha(iso) : new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1, 12);
};
const corta = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");

// Selector de fecha con calendario: festivos en rojo con su nombre; fines de semana y festivos no se pueden elegir
export default function CampoFecha({ valor, onChange }) {
  const festivos = useContext(FestivosContexto);
  const [abierto, setAbierto] = useState(false);
  const [mes, setMes] = useState(() => primeroDelMes(valor));
  const caja = useRef(null);

  useEffect(() => {
    if (!abierto) return undefined;
    setMes(primeroDelMes(valor));
    const fuera = (e) => caja.current && !caja.current.contains(e.target) && setAbierto(false);
    const tecla = (e) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [abierto]); // eslint-disable-line react-hooks/exhaustive-deps

  // 6 semanas desde el lunes anterior (o igual) al día 1
  const inicio = new Date(mes);
  inicio.setDate(1 - ((mes.getDay() + 6) % 7));
  const celdas = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(inicio);
    d.setDate(inicio.getDate() + i);
    return d;
  });
  const hoy = isoFecha(new Date());
  const cambiarMes = (delta) => setMes((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1, 12));
  const festivoValor = valor && festivos[valor];

  return (
    <span className="campo-fecha" ref={caja}>
      <button
        type="button"
        className={`boton-fecha ${festivoValor ? "es-festivo" : ""}`}
        title={festivoValor ? `Festivo: ${festivoValor}` : "Elegir fecha"}
        onClick={() => setAbierto((a) => !a)}
      >
        {corta(valor)} <span className="flecha">▾</span>
      </button>

      {abierto && (
        <div className="calendario" role="dialog" aria-label="Elegir fecha">
          <div className="cal-cabecera">
            <button type="button" onClick={() => cambiarMes(-1)} aria-label="Mes anterior">‹</button>
            <strong>{MESES[mes.getMonth()]} {mes.getFullYear()}</strong>
            <button type="button" onClick={() => cambiarMes(1)} aria-label="Mes siguiente">›</button>
          </div>
          <div className="cal-grilla">
            {CABECERA.map((c) => <span key={c} className="cal-dia-semana">{c}</span>)}
            {celdas.map((d) => {
              const iso = isoFecha(d);
              const finde = d.getDay() === 0 || d.getDay() === 6;
              const festivo = festivos[iso];
              const otroMes = d.getMonth() !== mes.getMonth();
              const clases = [
                "cal-dia",
                otroMes && "otro-mes",
                finde && "finde",
                festivo && "festivo",
                iso === hoy && "hoy",
                iso === valor && "elegido",
              ].filter(Boolean).join(" ");
              return (
                <button
                  type="button"
                  key={iso}
                  className={clases}
                  disabled={finde || !!festivo}
                  title={festivo ? `Festivo: ${festivo}` : finde ? "Fin de semana" : ""}
                  onClick={() => { onChange(iso); setAbierto(false); }}
                >
                  {d.getDate()}
                </button>
              );
            })}
          </div>
          <div className="cal-pie">
            <span><i className="cal-muestra festivo" /> Festivo</span>
            <span><i className="cal-muestra finde" /> Fin de semana</span>
            <button type="button" onClick={() => setMes(primeroDelMes(hoy))}>Hoy</button>
          </div>
        </div>
      )}
    </span>
  );
}
