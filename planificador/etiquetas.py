"""
Sugerencia de etiqueta (categoría de Outlook) a partir del título de una actividad.

Orden de prioridad:
  1. Catálogo de tareas: título igual a una tarea del catálogo -> su categoría.
  2. Aprendidas: el mismo título al que tú le pusiste esa etiqueta (etiquetas_aprendidas.json).
  3. Historial de Outlook: el mismo título ya etiquetado antes -> la categoría más usada.
  4. Aprendidas con un título parecido.
  5. Palabras clave (reglas_etiquetas.json, editables desde la interfaz).
  6. Historial con títulos parecidos (comparten la mayoría de palabras).

La aplicación aprende sola: cada vez que eliges o cambias una etiqueta (Time Capture, Planificador o al subir),
se guarda título -> etiqueta, y la próxima actividad igual o parecida la sugiere.
"""

import json
import re
import threading
import time as reloj
import unicodedata
from collections import Counter, defaultdict
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent
REGLAS = BASE / "reglas_etiquetas.json"
APRENDIDAS = BASE / "etiquetas_aprendidas.json"
_bloqueo_aprendidas = threading.Lock()
PARECIDO_APRENDIDAS = 0.5
PARECIDO_HISTORIAL = 0.5
DIAS_HISTORIAL = 180
VIGENCIA_HISTORIAL = 30 * 60  # segundos antes de volver a leer el historial

_historial = {"cuando": 0, "exactos": {}, "titulos": []}
PREFIJOS = re.compile(r"^\s*((rv|re|fw|rv|fwd|cancelado|canceled)\s*:\s*)+", re.IGNORECASE)


def normalizar(titulo):
    t = PREFIJOS.sub("", titulo or "")
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9&]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def palabras(texto):
    return {p for p in normalizar(texto).split() if len(p) > 2}


def leer_reglas():
    try:
        return json.loads(REGLAS.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return []


def guardar_reglas(reglas):
    REGLAS.write_text(json.dumps(reglas, ensure_ascii=False, indent=2), encoding="utf-8")


# ------------------------------------------------------------------ Aprendizaje

def leer_aprendidas():
    """{título normalizado: {"titulo", "categoria", "veces", "ultima"}}"""
    try:
        return json.loads(APRENDIDAS.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _guardar_aprendidas(datos):
    APRENDIDAS.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")


def aprender(titulo, categoria):
    """Recuerda que a este título le corresponde esta etiqueta (la última elección manda)."""
    norm = normalizar(titulo)
    categoria = (categoria or "").strip()
    if not norm or not categoria:
        return
    with _bloqueo_aprendidas:
        datos = leer_aprendidas()
        previo = datos.get(norm)
        datos[norm] = {
            "titulo": (titulo or "").strip(),
            "categoria": categoria,
            "veces": (previo["veces"] + 1) if previo and previo["categoria"] == categoria else 1,
            "ultima": datetime.now().isoformat(timespec="seconds"),
        }
        _guardar_aprendidas(datos)


def aprender_varias(pares):
    """pares: [(titulo, categoria)] — guarda todo de una vez (más rápido que aprender() uno por uno)."""
    pares = [(t, (c or "").strip()) for t, c in pares if normalizar(t) and (c or "").strip()]
    if not pares:
        return
    with _bloqueo_aprendidas:
        datos = leer_aprendidas()
        ahora = datetime.now().isoformat(timespec="seconds")
        for titulo, categoria in pares:
            norm = normalizar(titulo)
            previo = datos.get(norm)
            datos[norm] = {
                "titulo": titulo.strip(), "categoria": categoria, "ultima": ahora,
                "veces": (previo["veces"] + 1) if previo and previo["categoria"] == categoria else 1,
            }
        _guardar_aprendidas(datos)


def olvidar(norm):
    with _bloqueo_aprendidas:
        datos = leer_aprendidas()
        if datos.pop(norm, None) is not None:
            _guardar_aprendidas(datos)


def parecido(a, b):
    """0..1: palabras en común. Si un título contiene al otro (≥ 2 palabras en común) cuenta como bastante parecido."""
    if not a or not b:
        return 0.0
    comunes = len(a & b)
    jaccard = comunes / len(a | b)
    if comunes >= 2 and (a <= b or b <= a):
        return max(jaccard, 0.7)
    return jaccard


def cargar_historial(ns, forzar=False):
    """Lee títulos y categorías de los últimos meses de Outlook (solo esos dos campos, es rápido)."""
    if not forzar and reloj.time() - _historial["cuando"] < VIGENCIA_HISTORIAL:
        return
    hasta = date.today() + timedelta(days=1)
    desde = hasta - timedelta(days=DIAS_HISTORIAL)
    items = ns.GetDefaultFolder(9).Items
    items.IncludeRecurrences = True
    items.Sort("[Start]")
    ini = datetime.combine(desde, time.min).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
    fin = datetime.combine(hasta, time.min).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M")
    filtro = f'@SQL="urn:schemas:calendar:dtstart" >= \'{ini}\' AND "urn:schemas:calendar:dtstart" < \'{fin}\''
    conteo = defaultdict(Counter)
    for c in items.Restrict(filtro):
        categoria = (c.Categories or "").replace(";", ",").split(",")[0].strip()
        if categoria:
            conteo[normalizar(c.Subject)][categoria] += 1
    _historial["exactos"] = {t: cnt.most_common(1)[0][0] for t, cnt in conteo.items() if t}
    _historial["titulos"] = [(palabras(t), cat) for t, cat in _historial["exactos"].items()]
    _historial["cuando"] = reloj.time()


def sugerir(titulo, catalogo=(), reglas=None):
    """Devuelve {"categoria", "fuente"} o None."""
    norm = normalizar(titulo)
    if not norm:
        return None

    for t in catalogo:
        if t.get("categoria") and normalizar(t.get("titulo")) == norm:
            return {"categoria": t["categoria"], "fuente": "catálogo"}

    aprendidas = leer_aprendidas()
    if norm in aprendidas:
        return {"categoria": aprendidas[norm]["categoria"], "fuente": "aprendida (ya la etiquetaste)"}

    if norm in _historial["exactos"]:
        return {"categoria": _historial["exactos"][norm], "fuente": "historial"}

    propias = palabras(titulo)
    if propias and aprendidas:
        mejor, puntaje = None, 0.0
        for a in aprendidas.values():
            p = parecido(propias, palabras(a["titulo"]))
            if p > puntaje:
                mejor, puntaje = a, p
        if mejor and puntaje >= PARECIDO_APRENDIDAS:
            return {"categoria": mejor["categoria"], "fuente": f"aprendida de «{mejor['titulo']}»"}

    texto = f" {norm} "
    for regla in leer_reglas() if reglas is None else reglas:
        for clave in (k.strip() for k in regla.get("palabras", "").split(",")):
            k = normalizar(clave)
            if k and (f" {k} " in texto or (len(k) > 4 and k in norm)):
                return {"categoria": regla["categoria"], "fuente": f"palabra clave «{clave}»"}

    if propias:
        mejor, puntaje = None, 0.0
        for otras, cat in _historial["titulos"]:
            p = parecido(propias, otras)
            if p > puntaje:
                mejor, puntaje = cat, p
        if mejor and puntaje >= PARECIDO_HISTORIAL:
            return {"categoria": mejor, "fuente": "historial (título parecido)"}
    return None
