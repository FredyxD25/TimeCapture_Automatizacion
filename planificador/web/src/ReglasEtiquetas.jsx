import React, { useEffect, useState } from "react";
import { api } from "./api.js";

// Palabras clave del título -> etiqueta sugerida. Se revisan en orden: gana la primera que coincide.
export default function ReglasEtiquetas({ categorias }) {
  const [reglas, setReglas] = useState([]);
  const [estado, setEstado] = useState("");

  useEffect(() => {
    api.reglasEtiquetas().then(setReglas).catch((e) => setEstado(`Error: ${e.message}`));
  }, []);

  const cambiar = (i, cambio) => setReglas((rs) => rs.map((r, k) => (k === i ? { ...r, ...cambio } : r)));
  const mover = (i, delta) =>
    setReglas((rs) => {
      const c = [...rs];
      [c[i], c[i + delta]] = [c[i + delta], c[i]];
      return c;
    });

  return (
    <section className="catalogo">
      <h3 className="titulo-seccion">Etiquetas automáticas por palabras clave</h3>
      <p className="ayuda">
        Para sugerir la etiqueta de una actividad se usa, en este orden: la tarea del catálogo con el mismo título,
        tu historial de Outlook (el mismo título ya etiquetado), estas palabras clave (gana la primera fila que
        coincida) y por último títulos parecidos de tu historial. No importan mayúsculas ni tildes.
      </p>
      <div className="desplazable">
        <table>
        <thead><tr><th>Si el título contiene (separadas por coma)</th><th>Etiqueta</th><th /></tr></thead>
        <tbody>
          {reglas.map((r, i) => (
            <tr key={i}>
              <td><input value={r.palabras} onChange={(e) => cambiar(i, { palabras: e.target.value })} /></td>
              <td>
                <select value={r.categoria} onChange={(e) => cambiar(i, { categoria: e.target.value })}>
                  {categorias.map((k) => <option key={k.nombre} value={k.nombre}>{k.nombre}</option>)}
                </select>
              </td>
              <td className="mover">
                <button disabled={i === 0} title="Subir" onClick={() => mover(i, -1)}>↑</button>
                <button disabled={i === reglas.length - 1} title="Bajar" onClick={() => mover(i, 1)}>↓</button>
                <button className="peligro" title="Quitar" onClick={() => setReglas((rs) => rs.filter((_, k) => k !== i))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
      <div className="fila">
        <button onClick={() => setReglas((rs) => [...rs, { palabras: "", categoria: categorias[0]?.nombre || "" }])}>+ Agregar regla</button>
        <div className="espaciador" />
        {estado && <span className="ayuda">{estado}</span>}
        <button
          className="primario"
          onClick={async () => {
            try {
              await api.guardarReglasEtiquetas(reglas.filter((r) => r.palabras.trim() && r.categoria));
              setEstado("Reglas guardadas ✓");
            } catch (e) {
              setEstado(`Error: ${e.message}`);
            }
          }}
        >Guardar reglas</button>
      </div>
    </section>
  );
}
