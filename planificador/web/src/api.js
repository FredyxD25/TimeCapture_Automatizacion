async function pedir(url, opciones = {}) {
  const r = await fetch(url, {
    cache: "no-store", // siempre datos frescos de Outlook
    headers: { "Content-Type": "application/json" },
    ...opciones,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  if (!r.ok) {
    // Si el servidor explica el error en JSON se muestra ese mensaje, no la página técnica
    const texto = await r.text();
    let mensaje = texto;
    try {
      mensaje = JSON.parse(texto).error || texto;
    } catch {
      if (texto.startsWith("<")) mensaje = "error interno del servidor";
    }
    throw new Error(mensaje);
  }
  return r.json();
}

export const api = {
  semana: (desde, hasta) => pedir(`/api/semana?desde=${desde}&hasta=${hasta}`),
  categorias: () => pedir("/api/categorias"),
  catalogo: () => pedir("/api/catalogo"),
  festivos: (desde, hasta) => pedir(`/api/festivos?desde=${desde}&hasta=${hasta}`),
  guardarCatalogo: (datos) => pedir("/api/catalogo", { method: "PUT", body: datos }),
  aprendidas: () => pedir("/api/etiquetas-aprendidas"),
  ensenar: (titulo, categoria) => pedir("/api/etiquetas-aprendidas", { method: "POST", body: { titulo, categoria } }),
  olvidar: (clave) => pedir("/api/etiquetas-aprendidas/olvidar", { method: "POST", body: { clave } }),
  reglasEtiquetas: () => pedir("/api/reglas-etiquetas"),
  guardarReglasEtiquetas: (reglas) => pedir("/api/reglas-etiquetas", { method: "PUT", body: reglas }),
  replanificar: (dia) => pedir("/api/replanificar", { method: "POST", body: dia }),
  aplicar: (dias) => pedir("/api/aplicar", { method: "POST", body: dias }),

  // Time Capture
  tcCatalogos: () => pedir("/api/tc/catalogos"),
  tcProcesos: (gerencia) => pedir(`/api/tc/procesos?gerencia=${encodeURIComponent(gerencia)}`),
  tcVerificar: (desde, hasta) => pedir(`/api/tc/verificar?desde=${desde}&hasta=${hasta}`),
  tcSubir: (items, simular) => pedir("/api/tc/subir", { method: "POST", body: { items, simular } }),
  tcEliminar: (claves) => pedir("/api/tc/eliminar", { method: "POST", body: { claves } }),
  tcEtiqueta: (clave, categoria) => pedir("/api/tc/etiqueta", { method: "POST", body: { clave, categoria } }),
  tcRepararEtiquetas: (claves, simular) => pedir("/api/tc/reparar-etiquetas", { method: "POST", body: { claves, simular } }),
};
