import React, { useEffect, useState } from "react";
import { api } from "./api.js";

const sinTildes = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Lo que la aplicación aprendió de tus elecciones: título -> etiqueta. Se puede corregir u olvidar.
export default function EtiquetasAprendidas({ categorias }) {
  const [lista, setLista] = useState([]);
  const [buscar, setBuscar] = useState("");
  const [estado, setEstado] = useState("");

  const cargar = () => api.aprendidas().then(setLista).catch((e) => setEstado(`Error: ${e.message}`));
  useEffect(() => { cargar(); }, []);

  const texto = sinTildes(buscar.trim());
  const visibles = lista.filter((a) => !texto || sinTildes(a.titulo).includes(texto) || sinTildes(a.categoria).includes(texto));

  return (
    <section className="catalogo">
      <h3 className="titulo-seccion">Etiquetas aprendidas ({lista.length})</h3>
      <p className="ayuda">
        Cada vez que eliges o cambias una etiqueta (en Time Capture, al aplicar el Planificador o al subir), la aplicación la
        recuerda. Después la sugiere para la misma actividad y para actividades con un título parecido, antes que las palabras
        clave. Si algo quedó mal, cambia la etiqueta aquí u olvídalo.
      </p>
      <div className="fila">
        <label className="en-linea">Buscar <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Título o etiqueta…" /></label>
        <div className="espaciador" />
        {estado && <span className="ayuda">{estado}</span>}
        <button onClick={cargar}>↻ Actualizar</button>
      </div>
      {lista.length === 0 ? (
        <p className="vacio">Todavía no hay etiquetas aprendidas. Se irán agregando a medida que etiquetes actividades.</p>
      ) : (
        <div className="desplazable">
          <table>
            <thead><tr><th>Actividad</th><th>Etiqueta</th><th>Veces</th><th>Última vez</th><th /></tr></thead>
            <tbody>
              {visibles.map((a) => (
                <tr key={a.clave}>
                  <td>{a.titulo}</td>
                  <td>
                    <select
                      value={a.categoria}
                      onChange={async (e) => {
                        await api.ensenar(a.titulo, e.target.value);
                        setEstado(`“${a.titulo}” → ${e.target.value} ✓`);
                        cargar();
                      }}
                    >
                      {!categorias.some((k) => k.nombre === a.categoria) && <option>{a.categoria}</option>}
                      {categorias.map((k) => <option key={k.nombre} value={k.nombre}>{k.nombre}</option>)}
                    </select>
                  </td>
                  <td>{a.veces}</td>
                  <td className="nowrap suave">{(a.ultima || "").replace("T", " ").slice(0, 16)}</td>
                  <td className="mover">
                    <button
                      className="peligro"
                      title="Olvidar: dejará de sugerirse por lo aprendido"
                      onClick={async () => { await api.olvidar(a.clave); setEstado(`Olvidado: “${a.titulo}”`); cargar(); }}
                    >Olvidar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
