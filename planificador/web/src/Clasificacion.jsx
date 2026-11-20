import React, { useEffect, useState } from "react";
import { api } from "./api.js";

// Selector de País / Gerencia / Proceso / Negocio / Cliente(s) con las listas de Time Capture
export default function Clasificacion({ valor, catalogos, onChange, compacto = false }) {
  const [procesos, setProcesos] = useState([]);
  const [buscar, setBuscar] = useState("");

  useEffect(() => {
    if (!valor.gerencia) return setProcesos([]);
    api.tcProcesos(valor.gerencia).then(setProcesos).catch(() => setProcesos([]));
  }, [valor.gerencia]);

  const clientes = valor.cliente ? valor.cliente.split("|") : [];
  const set = (cambio) => onChange({ ...valor, ...cambio });
  const agregarCliente = (nombre) => {
    if (catalogos.clientes.includes(nombre) && !clientes.includes(nombre)) {
      set({ cliente: [...clientes, nombre].join("|") });
      setBuscar("");
    }
  };

  return (
    <div className={`clasificacion ${compacto ? "compacto" : ""}`}>
      <label>País
        <select value={valor.pais} onChange={(e) => set({ pais: e.target.value })}>
          {catalogos.paises.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <label>Gerencia
        <select value={valor.gerencia} onChange={(e) => set({ gerencia: e.target.value, proceso: "" })}>
          <option value="">Elige gerencia</option>
          {catalogos.gerencias.map((g) => <option key={g}>{g}</option>)}
        </select>
      </label>
      <label>Proceso
        <select value={valor.proceso} onChange={(e) => set({ proceso: e.target.value })}>
          <option value="">Elige proceso</option>
          {procesos.map((p) => <option key={p}>{p}</option>)}
        </select>
      </label>
      <label>Negocio
        <select value={valor.negocio} onChange={(e) => set({ negocio: e.target.value })}>
          <option value="">Elige negocio</option>
          {catalogos.negocios.map((n) => <option key={n}>{n}</option>)}
        </select>
      </label>
      <label className="clientes">Cliente(s)
        <div className="chips">
          {clientes.map((c) => (
            <span key={c} className="chip">
              {c}
              <button onClick={() => set({ cliente: clientes.filter((x) => x !== c).join("|") })} aria-label={`Quitar ${c}`}>×</button>
            </span>
          ))}
          <input
            list="lista-clientes-tc"
            value={buscar}
            placeholder={clientes.length ? "Agregar otro…" : "Buscar cliente…"}
            onChange={(e) => {
              setBuscar(e.target.value);
              agregarCliente(e.target.value);
            }}
          />
          <datalist id="lista-clientes-tc">
            {buscar.length >= 2 &&
              catalogos.clientes
                .filter((c) => c.toLowerCase().includes(buscar.toLowerCase()))
                .slice(0, 40)
                .map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
      </label>
    </div>
  );
}

export function errorClasificacion(c) {
  if (!c.pais || !c.gerencia || !c.proceso || !c.negocio || !c.cliente) return "Clasificación incompleta";
  return "";
}
