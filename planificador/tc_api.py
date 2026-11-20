"""
API de Time Capture para la interfaz web. Reutiliza la lógica de ../time_capture.py:
verificación del rango, 8 h por día, subida con confirmación y corrección de etiquetas.
"""

import json
import re
import sys
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from pathlib import Path

from flask import Blueprint, jsonify, request

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import time_capture as tc  # noqa: E402
import etiquetas  # noqa: E402

bp = Blueprint("tc", __name__, url_prefix="/api/tc")
GENERICA = re.compile(r"^\s*actividad\s*\d+", re.IGNORECASE)

_estado = {"catalogos": None, "actividades": {}, "mi_correo": ""}
_bloqueo_cat = threading.Lock()


def catalogos(recargar=False):
    with _bloqueo_cat:
        if recargar or _estado["catalogos"] is None:
            _estado["catalogos"] = tc.Catalogos()
        return _estado["catalogos"]


def borrar_en_tc(ruta):
    """DELETE a la API de Time Capture (lo mismo que hace el botón "Eliminar Cita" del complemento)."""
    req = urllib.request.Request(f"{tc.API_BASE}{ruta}", method="DELETE",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:200]}") from e


def clave_de(d):
    return f"{d['start_date']}T{d['start_time'][:5]}|{d['end_time'][:5]}|{d['title']}"


def clasificacion_de_registro(ex, cat):
    ger = ex.get("gerencia") or next(
        (g["homologado"] for g in cat.gerencias if str(g["id"]) == str(ex.get("gerencia_id"))), "")
    return {
        "pais": ex.get("country") or "",
        "cliente": ex.get("client") or "",
        "gerencia": ger,
        "negocio": ex.get("negocio") or "",
        "proceso": ex.get("proceso") or "",
    }


def init(app, outlook, bloqueo, item_por_id, poner_categoria, leer_catalogo):
    """Registra las rutas. `outlook()` devuelve (app, namespace); `bloqueo` serializa el acceso a Outlook;
    `item_por_id(ns, "EntryID|inicio")` abre una cita (o la ocurrencia de una serie)."""

    def asegurar_asistentes(citas):
        """Lee de Outlook los asistentes de las citas que aún no los tienen (solo las que se van a subir)."""
        faltan = [c for c in citas if c is not None and c.asistentes is None]
        if not faltan:
            return
        with bloqueo:
            _, ns = outlook()
            for c in faltan:
                try:
                    c.leer_asistentes(item_por_id(ns, f"{c.EntryID}|{c.Start.isoformat(timespec='minutes')}"))
                except Exception:
                    c.asistentes = []

    @bp.post("/etiqueta")
    def poner_etiqueta():
        """Cambia la categoría de la cita en Outlook; se usará al subir a Time Capture."""
        datos = request.get_json()
        cita = _estado["actividades"].get(datos["clave"])
        if cita is None:
            return jsonify({"error": "Vuelve a verificar el rango"}), 409
        categoria = datos.get("categoria") or ""
        try:
            with bloqueo:
                _, ns = outlook()
                serie = poner_categoria(ns, f"{cita.EntryID}|{cita.Start.isoformat(timespec='minutes')}", categoria)
                tc.leer_colores_categorias(ns)
        except Exception as e:
            detalle = e.args[2][2] if len(getattr(e, "args", ())) > 2 and e.args[2] else str(e)
            return jsonify({"error": f"Outlook no permitió el cambio: {detalle}"}), 500

        etiquetas.aprender(cita.Subject, categoria)  # para sugerirla la próxima vez (igual o parecida)
        # En una serie, todas sus repeticiones cargadas quedan con la misma etiqueta
        afectadas = [k for k, c in _estado["actividades"].items() if c.EntryID == cita.EntryID] if serie else [datos["clave"]]
        for k in afectadas:
            _estado["actividades"][k].Categories = categoria
        d = tc.datos_cita(cita, _estado["mi_correo"])
        return jsonify({
            "etiquetas": [x["displayName"] for x in json.loads(d["categories"])],
            "serie": serie,
            "claves": afectadas,
        })

    @bp.get("/catalogos")
    def get_catalogos():
        cat = catalogos(request.args.get("recargar") == "1")
        return jsonify({
            "paises": tc.PAISES,
            "gerencias": [g["homologado"] for g in cat.gerencias],
            "negocios": cat.negocios,
            "clientes": cat.clientes,
            "defaults": tc.DEFAULTS,
            "horas_minimas": tc.HORAS_MINIMAS_DIA,
        })

    @bp.get("/procesos")
    def get_procesos():
        return jsonify(catalogos().procesos(request.args.get("gerencia", "")))

    @bp.post("/validar")
    def validar():
        return jsonify(catalogos().errores(request.get_json()))

    @bp.get("/verificar")
    def verificar():
        desde = date.fromisoformat(request.args["desde"])
        hasta = date.fromisoformat(request.args["hasta"])
        with bloqueo:
            _, ns = outlook()
            mi_correo = tc.smtp_de(ns.CurrentUser.AddressEntry).lower()
            tc.leer_colores_categorias(ns)
            citas = tc.citas_en_rango(ns, desde, hasta, con_asistentes=False)  # se leen al subir
            etiquetas.cargar_historial(ns)
        cat = catalogos()
        catalogo_tareas = leer_catalogo()
        _estado["mi_correo"] = mi_correo
        _estado["actividades"] = {}

        datos_citas = [tc.datos_cita(c, mi_correo) for c in citas]

        # Cruces igual que en el Planificador: las reuniones sin aceptar no bloquean ni cuentan
        aceptadas_idx = [i for i, c in enumerate(citas) if not tc.sin_aceptar(c)]
        cruces = [[] for _ in citas]
        cruces_detalle = [[] for _ in citas]
        for i in aceptadas_idx:
            a = citas[i]
            for j in aceptadas_idx:
                b = citas[j]
                if i == j or not (a.Start < b.End and b.Start < a.End):
                    continue
                minutos = int((min(a.End, b.End) - max(a.Start, b.Start)).total_seconds() // 60)
                cruces[i].append(b.Subject)
                cruces_detalle[i].append({
                    "clave": clave_de(datos_citas[j]),  # para saber si esa otra también se va a subir
                    "titulo": b.Subject, "inicio": f"{b.Start:%H:%M}", "fin": f"{b.End:%H:%M}",
                    "minutos": minutos, "reunion": tc.es_asistente(b),
                })

        def consultar(par):
            cita, d = par
            try:
                return tc.buscar_existente(d, tc.es_asistente(cita), mi_correo), ""
            except Exception as e:
                return {}, str(e)

        # Las consultas a Time Capture son independientes: en paralelo tardan segundos en vez de minutos
        with ThreadPoolExecutor(max_workers=8) as pool:
            existentes = list(pool.map(consultar, zip(citas, datos_citas)))

        filas = []
        for i, cita in enumerate(citas):
            d = datos_citas[i]
            clave = clave_de(d)
            _estado["actividades"][clave] = cita
            asistente = tc.es_asistente(cita)
            ex, error = existentes[i]
            etiquetas_ = [x["displayName"] for x in json.loads(d["categories"])]
            registrada = bool(ex.get("uuid"))
            guardadas = ex.get("categories") or ""
            filas.append({
                "clave": clave,
                "fecha": d["start_date"],
                "inicio": d["start_time"][:5],
                "fin": d["end_time"][:5],
                "titulo": d["title"],
                "etiquetas": etiquetas_,
                "asistente": asistente,
                "registrada": registrada,
                "registro": clasificacion_de_registro(ex, cat) if registrada else None,
                "etiqueta_vacia": registrada and bool(etiquetas_) and not all(n in guardadas for n in etiquetas_),
                "etiquetas_tc": guardadas,
                # Horario tal como quedó en Time Capture (para asistentes, el tiempo de asistencia)
                "tiempo_tc": None if not registrada else [
                    (ex.get("entry_time") or ex.get("start_time") or d["start_time"])[:5],
                    (ex.get("exit_time") or ex.get("end_time") or d["end_time"])[:5],
                ],
                "uuid": ex.get("uuid"),
                "sugerida": None if etiquetas_ else etiquetas.sugerir(d["title"], catalogo_tareas),
                "cruces": cruces[i],
                "cruces_detalle": cruces_detalle[i],
                "sin_aceptar": tc.sin_aceptar(cita),
                "suma_horas": tc.suma_horas(cita) and not tc.sin_aceptar(cita),
                "invalida": d["_fin"] <= d["_inicio"],
                "generica": bool(GENERICA.match(d["title"])),
                "error": error,
            })

        dias = []
        aceptadas = [c for c in citas if not tc.sin_aceptar(c)]
        for dia, (h, laborable) in sorted(tc.horas_por_dia(aceptadas, desde, hasta).items()):
            dias.append({
                "fecha": dia.isoformat(),
                "horas": round(h, 2),
                "laborable": laborable,
                "festivo": dia in tc.FESTIVOS,
                "cumple": (not laborable) or h >= tc.HORAS_MINIMAS_DIA,
            })
        return jsonify({"correo": mi_correo, "filas": filas, "dias": dias})

    @bp.post("/subir")
    def subir():
        """items: [{clave, clasificacion}], simular: bool. Sube (o actualiza) y confirma cada una."""
        datos = request.get_json()
        simular = bool(datos.get("simular"))
        cat = catalogos()
        mi_correo = _estado["mi_correo"]
        if not simular:
            asegurar_asistentes([_estado["actividades"].get(i["clave"]) for i in datos["items"]])
        # Precarga los procesos de cada gerencia para validar sin consultas repetidas
        for g in {i["clasificacion"].get("gerencia") for i in datos["items"]}:
            if cat.id_gerencia(g) is not None:
                cat.procesos(g)

        def procesar(item):
            cita = _estado["actividades"].get(item["clave"])
            if cita is None:
                return {"clave": item["clave"], "ok": False, "detalle": "vuelve a verificar el rango"}
            d = tc.datos_cita(cita, mi_correo)
            c = item["clasificacion"]
            errores = cat.errores(c)
            if errores:
                return {"clave": item["clave"], "ok": False, "detalle": "; ".join(errores)}
            if d["_fin"] <= d["_inicio"]:
                return {"clave": item["clave"], "ok": False, "detalle": "duración inválida"}
            asistente = tc.es_asistente(cita)
            try:
                uuid = tc.buscar_existente(d, asistente, mi_correo).get("uuid")
            except Exception as e:
                return {"clave": item["clave"], "ok": False, "detalle": f"no se pudo consultar: {e}"}
            ok, detalle = tc.subir_y_confirmar(d, c, uuid, asistente, mi_correo, simular)
            if ok and uuid and not simular:
                detalle = "actualizada y " + detalle
            return {"clave": item["clave"], "ok": ok, "detalle": detalle}

        # La simulación solo consulta: va en paralelo. La subida real va una por una.
        if simular:
            with ThreadPoolExecutor(max_workers=8) as pool:
                resultados = list(pool.map(procesar, datos["items"]))
        else:
            resultados = [procesar(i) for i in datos["items"]]
            # Lo que se subió con etiqueta alimenta el aprendizaje de etiquetas
            subidas = {r["clave"] for r in resultados if r["ok"]}
            etiquetas.aprender_varias([
                (c.Subject, (c.Categories or "").replace(";", ",").split(",")[0])
                for k, c in _estado["actividades"].items() if k in subidas
            ])
        return jsonify(resultados)

    @bp.post("/eliminar")
    def eliminar():
        """claves: [...]. Elimina esos registros de Time Capture (Outlook no se toca), confirma que ya no
        existan y guarda un respaldo con sus datos en planificador/respaldos."""
        datos = request.get_json()
        mi_correo = _estado["mi_correo"]
        resultados, respaldo = [], []
        for clave in datos["claves"]:
            cita = _estado["actividades"].get(clave)
            if cita is None:
                resultados.append({"clave": clave, "ok": False, "detalle": "vuelve a revisar el rango"})
                continue
            d = tc.datos_cita(cita, mi_correo)
            asistente = tc.es_asistente(cita)
            try:
                ex = tc.buscar_existente(d, asistente, mi_correo)
                if not ex.get("uuid"):
                    resultados.append({"clave": clave, "ok": False, "detalle": "ya no estaba registrada"})
                    continue
                respaldo.append({**ex, "asistente": asistente, "asistenteEmail": mi_correo if asistente else None})
                ruta = "deleteAppointmentAttendee" if asistente else "deleteAppointment"
                borrar_en_tc(f"/{ruta}/{ex['uuid']}")
                sigue = tc.buscar_existente(d, asistente, mi_correo).get("uuid")
            except Exception as e:
                resultados.append({"clave": clave, "ok": False, "detalle": f"error: {e}"})
                continue
            resultados.append({"clave": clave, "ok": not sigue,
                               "detalle": "eliminada y confirmada" if not sigue else "el servidor respondió pero sigue registrada"})
        archivo = None
        if respaldo:
            carpeta = Path(__file__).resolve().parent / "respaldos"
            carpeta.mkdir(exist_ok=True)
            archivo = carpeta / f"time_capture_eliminados_{datetime.now():%Y%m%d_%H%M%S}.json"
            archivo.write_text(json.dumps(respaldo, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        return jsonify({"resultados": resultados, "respaldo": str(archivo) if archivo else None})

    @bp.post("/reparar-etiquetas")
    def reparar():
        """claves: [...]. Reenvía el registro con la etiqueta de Outlook, conservando su clasificación."""
        datos = request.get_json()
        simular = bool(datos.get("simular"))
        cat = catalogos()
        mi_correo = _estado["mi_correo"]
        resultados = []
        if not simular:
            asegurar_asistentes([_estado["actividades"].get(k) for k in datos["claves"]])
        for clave in datos["claves"]:
            cita = _estado["actividades"].get(clave)
            if cita is None:
                resultados.append({"clave": clave, "ok": False, "detalle": "vuelve a verificar el rango"})
                continue
            d = tc.datos_cita(cita, mi_correo)
            asistente = tc.es_asistente(cita)
            nombres = [x["displayName"] for x in json.loads(d["categories"])]
            try:
                ex = tc.buscar_existente(d, asistente, mi_correo)
                if not ex.get("uuid"):
                    resultados.append({"clave": clave, "ok": False, "detalle": "no está registrada"})
                    continue
                if simular:
                    resultados.append({"clave": clave, "ok": True, "detalle": f"simulación: agregaría {', '.join(nombres)}"})
                    continue
                tiempo = f"{ex['entry_time']} - {ex['exit_time']}" if ex.get("entry_time") and ex.get("exit_time") else None
                tc.subir(d, clasificacion_de_registro(ex, cat), ex["uuid"], asistente, mi_correo, tiempo)
                guardadas = tc.buscar_existente(d, asistente, mi_correo).get("categories") or ""
            except Exception as e:
                resultados.append({"clave": clave, "ok": False, "detalle": f"error: {e}"})
                continue
            ok = all(n in guardadas for n in nombres)
            resultados.append({"clave": clave, "ok": ok,
                               "detalle": f"etiqueta guardada: {guardadas}" if ok else f"el servidor guardó '{guardadas}'"})
        return jsonify(resultados)

    app.register_blueprint(bp)
