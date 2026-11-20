"""
Festivos de Colombia calculados para cualquier año (Ley 51 de 1983, "Ley Emiliani").

- Fijos: 1 ene, 1 may, 20 jul, 7 ago, 8 dic, 25 dic.
- Se trasladan al lunes siguiente: 6 ene, 19 mar, 29 jun, 15 ago, 12 oct, 1 nov, 11 nov.
- Según la Pascua: Jueves y Viernes Santo (fijos); Ascensión, Corpus Christi y Sagrado Corazón (al lunes).
"""

from datetime import date, timedelta
from functools import lru_cache


def pascua(anio):
    """Domingo de Pascua (algoritmo de Meeus/Jones/Butcher, calendario gregoriano)."""
    a, b, c = anio % 19, anio // 100, anio % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    mes = (h + l - 7 * m + 114) // 31
    dia = ((h + l - 7 * m + 114) % 31) + 1
    return date(anio, mes, dia)


def al_lunes(d):
    """Si no cae en lunes, pasa al lunes siguiente."""
    return d + timedelta(days=(7 - d.weekday()) % 7)


@lru_cache(maxsize=None)
def festivos_de(anio):
    """{fecha: nombre} de los festivos de Colombia en ese año."""
    p = pascua(anio)
    lista = {
        date(anio, 1, 1): "Año Nuevo",
        al_lunes(date(anio, 1, 6)): "Reyes Magos",
        al_lunes(date(anio, 3, 19)): "San José",
        p - timedelta(days=3): "Jueves Santo",
        p - timedelta(days=2): "Viernes Santo",
        date(anio, 5, 1): "Día del Trabajo",
        al_lunes(p + timedelta(days=39)): "Ascensión del Señor",
        al_lunes(p + timedelta(days=60)): "Corpus Christi",
        al_lunes(p + timedelta(days=68)): "Sagrado Corazón",
        al_lunes(date(anio, 6, 29)): "San Pedro y San Pablo",
        date(anio, 7, 20): "Día de la Independencia",
        date(anio, 8, 7): "Batalla de Boyacá",
        al_lunes(date(anio, 8, 15)): "Asunción de la Virgen",
        al_lunes(date(anio, 10, 12)): "Día de la Raza",
        al_lunes(date(anio, 11, 1)): "Todos los Santos",
        al_lunes(date(anio, 11, 11)): "Independencia de Cartagena",
        date(anio, 12, 8): "Inmaculada Concepción",
        date(anio, 12, 25): "Navidad",
    }
    return dict(sorted(lista.items()))


def es_festivo(d):
    return d in festivos_de(d.year)


def nombre_festivo(d):
    return festivos_de(d.year).get(d)


class Festivos:
    """Se comporta como un conjunto de fechas (`d in FESTIVOS`) para cualquier año."""

    def __contains__(self, d):
        return isinstance(d, date) and es_festivo(d)


FESTIVOS = Festivos()
