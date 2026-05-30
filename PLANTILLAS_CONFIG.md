# Configuración de plantillas — cronogramav2

> Generado desde Supabase (proyecto `cronogramav2`). 8 plantillas, 28 etapas.
> Horarios expresados en HH:MM. Duraciones en minutos.

## Leyenda
- **Empleado**: `✔` = requiere un empleado durante toda la etapa · `✘` = no requiere empleado (paso pasivo: descanso, leudado, máquina sola) · `0–N` = ventana parcial.
- **Preferido**: empleado titular de la etapa. `(fijo)` = no admite reemplazo.
- **Máquinas**: nombre y, entre paréntesis, uso si es parcial (`0.3` = 30 %) y ventana si no cubre toda la duración (`0–10`).
- **Dep.**: etapas que deben terminar antes (encadenadas). **Prereq.**: deben estar listas antes, sin encadenar.
- **Margen**: minutos máximos que puede esperar después de su dependencia (`—` = sin límite).
- **Horario**: restricción horaria propia de la etapa.
- **Solape**: `paralela` = puede correr en paralelo · `exclusiva` = atención exclusiva · `—` = normal.

## Referencias

**Máquinas (capacidad 1 c/u):**
| Máquina | Grupo |
|---|---|
| Amasadora | — |
| Balanza | — |
| Horno | — |
| Sobadora | — |
| Mesa chica | Mesas |
| Torno 2 | Mesas |
| Torno 1 | Mesas |
| Heladera grande | Cámaras y Frío |
| Heladera vertical | Cámaras y Frío |
| Freezer | Cámaras y Frío |

**Empleados:** Sebastián Teruggi · Cristofer Faccio · Romina Maciel · *(sin habilidades cargadas)*

---

## Amasar dulce
`activa` · sin restricciones de proceso · solape: no · exclusiva: no

| # | Etapa | Dur | Empl. | Preferido | Máquinas | Dep. | Prereq. | Margen | Horario | Tipo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Preparar ingredientes | 10 | ✔ | — | Balanza | — | — | — | — | crítica |
| 2 | Amasar | 20 | ✘ | — | Amasadora | 1 | — | — | **≥ 07:00** | crítica |
| 3 | Preparar margarina | 10 | ✔ | — | — | — | — | — | — | crítica |
| 4 | Primera vuelta | 20 | ✔ | Cristofer | Mesa chica, Sobadora | 2 | 3 | 0 | — | crítica |
| 5 | Descanso masa dulce | 15 | ✘ | — | Mesa chica | 4 | — | 10 | — | crítica |
| 6 | Segunda vuelta | 20 | ✔ | Cristofer | Mesa chica, Sobadora | 5 | — | 0 | — | crítica |
| 7 | Embolsar | 4 | ✔ | — | Mesa chica | 6 | — | 5 | — | crítica |
| 8 | Guardar en heladera | 3 | ✔ | — | Heladera vertical | 7 | — | 5 | — | crítica |

---

## Coccion y decoracion
`activa` · color `#84cc16` · **tope de inicio del proceso: 04:35** · solape: no · exclusiva: no

| # | Etapa | Dur | Empl. | Preferido | Máquinas | Dep. | Prereq. | Margen | Horario | Tipo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Calentar horno | 20 | ✔ | Sebastián | Horno | — | — | — | — | crítica |
| 2 | Coccion y decoracion | 210 | ✔ | Sebastián | Torno 1, Torno 2 (0.3), Mesa chica (0.7) | 1 | — | 5 | — | crítica |

---

## Cortar dulce x4 masas
`activa` · sin restricciones de proceso · solape: no · exclusiva: no

| # | Etapa | Dur | Empl. | Preferido | Máquinas | Dep. | Prereq. | Margen | Horario | Tipo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Pasar masas | 14 | ✔ | Cristofer | Sobadora | — | — | — | — | crítica |
| 2 | Cortar dulce | 12 | ✔ | Cristofer | Torno 2 (0–10) | 1 | — | 0 | — | crítica |

---

## Crema
`activa` · color `#14b8a6` · sin restricciones de proceso · solape: no · exclusiva: no

| # | Etapa | Dur | Empl. | Preferido | Máquinas | Dep. | Prereq. | Margen | Horario | Tipo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Preparacion ingredientes | 10 | ✔ | Romina | Balanza | — | — | — | — | crítica |
| 2 | Leche a calentar | 15 | ✘ | — | — | — | 1 | — | — | crítica |
| 3 | Cocinar y guardar | 10 | ✔ | Romina | — | 2 | — | 0 | — | crítica |

---

## Lavar latas
`activa` · color `#ec4899` · sin restricciones de proceso · solape: no · exclusiva: no

| # | Etapa | Dur | Empl. | Preferido | Máquinas | Dep. | Prereq. | Margen | Horario | Tipo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Lavar latas | 140 | ✔ | Romina | — | — | — | — | — | crítica |

---

## Salado
`activa` · sin restricciones de proceso · solape: no · exclusiva: no

| # | Etapa | Dur | Empl. | Preferido | Máquinas | Dep. | Prereq. | Margen | Horario | Tipo |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Preparar ingredientes | 8 | ✔ | — | Balanza, Mesa chica (0.2) | — | — | — | — | crítica |
| 2 | Amasar | 20 | ✘ | — | Amasadora | — | 1 | — | **≥ 07:00** | crítica |
| 3 | Sacar bizc y cara | 3 | ✔ | — | Amasadora, Balanza, Mesa chica (0.2) | 2 | — | 5 | — | crítica |
| 4 | Sacar Salado | 6 | ✔ | — | Amasadora, Torno 1 (0.3) | 2 | — | 5 | — | crítica |
| 5 | Descanso 1 | 40 | ✘ | — | Torno 1 | 4 | — | 15 | — | crítica |
| 6 | Preparar empaste Salado | 7 | ✔ | — | Sobadora | — | — | — | — | crítica |
| 7 | Estirar salado | 10 | ✔ | Sebastián | Torno 1, Torno 2 | 5 | — | 0 | — | crítica |
| 8 | Untar margarina Salado | 10 | ✔ | Sebastián | Sobadora, Torno 1, Torno 2 | 7 | 6 | 0 | — | crítica |
| 9 | Estirar salado empastado | 10 | ✔ | — | Torno 1, Torno 2 | 8 | — | 0 | — | crítica |
| 10 | Descanso 2 | 40 | ✘ | — | Torno 2, Torno 1 | 9 | 1–9 (todas las previas) | 15 | — | crítica |
| 11 | Cortar chorizos | 18 | ✔ | Sebastián | Torno 1, Torno 2 | 10 | — | 0 | — | crítica |
| 12 | Cortar bollitos | 35 | ✔ | Sebastián | Torno 1 (0–20), Torno 2 | 11 | — | 0 | — | crítica |

---

## Plantillas sin etapas (vacías)
- **aa Este es el que tiene la bd cronogramav2 en supabase** — `activa`, 0 etapas.
- **Arrollar dulce** — `activa`, 0 etapas.
