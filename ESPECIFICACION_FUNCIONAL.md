# Sistema de Cronograma de Producción — Especificación funcional

> Documento de producto/funcional para construir la aplicación desde cero. Describe **qué tecnologías usar**, **cómo debe verse y comportarse la interfaz completa**, **la línea de tiempo con todas sus funcionalidades**, y **cómo debe planificarse el cronograma automáticamente**. Está organizado en **fases** de construcción para que, a partir de él, se pueda derivar un plan de desarrollo detallado.
>
> No incluye nombres de funciones ni detalles de implementación: describe comportamientos, reglas y pantallas.

---

## 0. Visión general del producto

Es una herramienta web para **planificar la producción diaria de una panadería/pastelería**. Un encargado define las **recetas de producción** (cómo se hace cada producto, paso a paso, con qué máquinas y personas) y el **plan del día** (qué se produce y cuánto). El sistema **arma automáticamente** un cronograma tipo línea de tiempo (Gantt) que ubica cada tarea respetando las dependencias entre pasos, la disponibilidad de máquinas y personas, y las restricciones de horario. Luego el encargado puede **ajustar manualmente** ese cronograma arrastrando bloques, con detección de conflictos, deshacer/rehacer y versionado.

**Usuarios:** 1 encargado/planificador (no es multiusuario complejo; solo requiere login). **Escala típica:** 3–5 empleados, ~10 máquinas, planificación por día de la semana (Domingo a Sábado).

**Principio rector de la planificación:** cada proceso de producción (una receta + un lote) se trata como una **pieza rígida de Tetris**. Su estructura interna de tiempos (esperas de fermentación, encadenamientos) se calcula una vez y se preserva; el sistema solo decide **dónde encaja el proceso completo** sin pisar recursos ya ocupados.

---

## 1. Tecnologías a utilizar

| Área | Tecnología | Motivo |
|------|-----------|--------|
| Lenguaje | **TypeScript** (modo estricto) | tipado fuerte del dominio (etapas, recursos, tiempos) |
| Framework UI | **React 18** | SPA con estado reactivo, sin necesidad de SSR |
| Build / dev server | **Vite** | arranque rápido, HMR |
| Estilos | **Tailwind CSS** | UI densa y compacta tipo herramienta profesional |
| Iconografía | librería de íconos SVG (estilo Lucide) | íconos consistentes en toda la toolbar |
| Backend / Base de datos / Auth | **Supabase** (PostgreSQL gestionado + Auth + RLS) | sin backend propio; el cliente habla directo con la DB |
| Hosting | **Vercel** (sitio estático SPA) | despliegue simple desde el repo |

**Decisiones clave de arquitectura:**

1. **No hay servidor de aplicación propio.** El cliente React se conecta directamente a Supabase para leer/escribir datos. La autenticación es email + contraseña vía Supabase Auth, y las tablas se protegen con Row Level Security (solo usuarios autenticados acceden).
2. **El motor de planificación corre en el navegador.** Toda la lógica que arma el cronograma automático es código del cliente (sin llamadas a un servicio externo). Esto permite previsualizar resultados al instante antes de persistir.
3. **El tiempo se modela en minutos desde la medianoche** internamente, y se muestra como "HH:MM". La semana usa la convención **Domingo = 0 … Sábado = 6** de forma consistente en todo el sistema.
4. **El historial (deshacer/rehacer) se resuelve con funciones almacenadas en la base de datos**, que guardan instantáneas (snapshots) del cronograma de cada día en una pila.

---

## 2. Modelo conceptual de datos (qué entidades existen)

Antes de las fases, conviene entender las entidades. No es el esquema SQL literal sino el modelo conceptual.

- **Empleado:** persona que ejecuta tareas. Tiene datos de contacto, estado activo/inactivo, un conjunto de **habilidades**, y un **horario por día** (hora de entrada y salida).
- **Habilidad:** etiqueta de capacidad (ej. "horneado"). Una etapa puede exigir cierta habilidad; un empleado puede tener varias.
- **Máquina / recurso:** equipo físico con una **capacidad** (cuántos usos simultáneos admite; ej. un horno de 3 bandejas = capacidad 3). Puede pertenecer a un **grupo de recursos** de máquinas intercambiables, con un orden de preferencia dentro del grupo (para sustitución automática).
- **Plantilla de proceso (receta):** define cómo se produce un producto. Tiene metadatos (nombre, categoría, color) y restricciones horarias globales opcionales (no empezar antes de X, empezar antes de Y, terminar antes de Z). Contiene una lista ordenada de etapas.
- **Etapa de plantilla:** un paso de la receta (amasar, fermentar, hornear…). Es la entidad más rica; ver detalle en la Fase 3.
- **Plan del día:** indica que cierto día se producen N lotes de cierta receta, con una prioridad y opciones de encadenado de lotes.
- **Línea de cronograma:** una "pista" horizontal del Gantt, asociada a un empleado y a un día. Un empleado puede tener varias líneas (ej. una normal y una "paralela").
- **Tarea de cronograma:** un bloque dibujado en una línea, con hora de inicio/fin, descripción, color, tamaño visual y datos de trazabilidad (de qué receta/etapa/lote proviene, sus dependencias, las máquinas que usa).
- **Versión de cronograma:** instantánea guardada de un día completo (para backups y restauración).
- **Configuración del sistema:** parámetros globales (ej. la penalización por solapamiento).

---

## 3. Fases de construcción

Cada fase entrega un incremento usable. El orden está pensado para que las dependencias técnicas se resuelvan antes de necesitarlas.

---

### FASE 1 — Cimientos: proyecto, autenticación y datos base

**Objetivo:** tener la app corriendo, con login y con la base de datos y entidades base creadas.

**Alcance:**
- Proyecto React + TypeScript + Vite + Tailwind, conectado a Supabase mediante variables de entorno.
- **Login** con email y contraseña (pantalla simple). Si no hay sesión, se muestra el login; si hay sesión, la app. Botón de cerrar sesión siempre accesible en la toolbar.
- Creación del esquema de base de datos con todas las entidades del modelo conceptual (Fase 2 a 5 las usan). Todas las tablas con seguridad por fila: solo usuarios autenticados acceden.
- **Módulo de personal:** alta/edición/baja de empleados (nombre, documento, teléfono, email, activo), búsqueda por nombre/documento, y la posibilidad de marcar habilidades y cargar el **horario por día** (entrada/salida) de cada empleado.

**Interfaz:** un modal "Módulo de personal" con listado de empleados, buscador, alta inline y, al seleccionar un empleado, edición de sus datos, habilidades y horarios semanales.

**Regla importante:** el horario de un empleado por día es **un único bloque continuo** (una entrada y una salida). El sistema no modela turnos partidos ni franjas múltiples (es una limitación deliberada y conocida).

---

### FASE 2 — La línea de tiempo (visualización)

**Objetivo:** mostrar el cronograma de un día como un Gantt navegable, aunque todavía sin edición ni planificación automática.

**Estructura visual de la línea de tiempo:**
- **Eje horizontal = tiempo del día**, acotado a un **rango horario configurable** por día (por defecto 04:00 a 15:00). Marcas de tiempo (ticks) cuya granularidad se adapta al zoom.
- **Eje vertical = empleados y sus líneas.** Cada empleado es una sección con una o varias líneas (pistas). Las secciones se pueden **colapsar/expandir**.
- Cada **tarea** es un bloque rectangular posicionado según su hora de inicio/fin, coloreado, con su descripción. El texto puede ir en horizontal o vertical y en distintos tamaños.
- **Altura interna de una tarea:** cada línea se divide conceptualmente en 5 niveles. Una tarea tiene un **tamaño** (1 a 5 niveles de alto) y una **fila** (posición vertical 0–4 dentro de la línea). Esto permite apilar varias tareas finas en una misma pista (útil para tareas en paralelo).

**Controles de visualización (toolbar superior):**
- **Selector de día** (anterior / siguiente, con el nombre del día). El día seleccionado se recuerda entre sesiones.
- **Zoom horizontal** (acercar/alejar el tiempo), con botón de "ajustar a la pantalla" y "1:1".
- **Escala de altura** de las filas (más alto / más bajo), con "1:1".
- **Rango horario** del día (dos campos de hora inicio/fin) que define la ventana visible y se guarda automáticamente.
- **Modo de agrupación de vista:** "Secciones" (agrupado por empleado) o "Todos" (todas las líneas juntas).
- **Modo de color:** por proceso (cada receta su color) o por empleado.

**Modos de vista adicionales:**
- **Vista por empleado:** una pantalla dedicada que muestra la línea de tiempo de un solo empleado en un día.
- **Listado de tareas:** un modal con tabla de todas las tareas del día (inicio, fin, duración, empleado, descripción), filtrable por empleado, con barras de duración relativa.

---

### FASE 3 — Configuración de recetas y recursos

**Objetivo:** permitir definir el catálogo que alimentará la planificación: máquinas, grupos, habilidades y plantillas de proceso con sus etapas.

Pantalla de **Configuración** con tres pestañas:

**3.1 Pestaña Máquinas y recursos**
- CRUD de **grupos de recursos** (máquinas intercambiables).
- CRUD de **máquinas**: nombre, **cantidad/capacidad** (usos simultáneos), descripción, grupo al que pertenece y **prioridad dentro del grupo** (orden de preferencia para sustitución). Las máquinas se listan agrupadas por grupo (y una sección "Sin grupo").

**3.2 Pestaña Plantillas de proceso (recetas)**
- Panel izquierdo: lista de plantillas, con alta (nombre, categoría, color) y restricciones horarias globales opcionales: **"no empezar antes de"**, **"empezar antes de"** (tope de comienzo) y **"terminar antes de"**. También defaults de **permite solape** y **atención exclusiva** que heredan las etapas.
- Panel derecho: al seleccionar una plantilla, se editan sus **etapas** (ordenables). Cada etapa define:
  - **Nombre** y **duración total** (minutos que dura el paso completo).
  - **Presencia del empleado:** qué franjas (relativas al inicio de la etapa) requieren a una persona. Puede ser todo el tiempo, solo al inicio, solo al final, o franjas específicas. Si una etapa no requiere persona (ej. una fermentación), nadie queda ocupado.
  - **Empleados de la etapa:** un principal y, opcionalmente, ayudantes. Para cada uno se puede fijar **empleado preferido**, **habilidad requerida** y si **puede reemplazarse** por otro.
  - **Máquinas que usa:** una o varias, cada una con la **fracción de capacidad** que consume (0–100%) y la franja de tiempo (relativa al inicio) en que la usa.
  - **Dependencias** (otras etapas que deben terminar antes, **encadenadas** sin hueco si el margen de espera es 0) y **prerequisitos** (etapas que deben terminar antes pero **sueltas**, pueden ocurrir mucho antes — "trabajo previo").
  - **Margen de espera máximo** tras las dependencias (0 = pegado).
  - **Restricciones horarias propias** (no empezar/terminar antes/después).
  - **Prioridad** (1–10) y **tipo**: crítica / flexible / descanso (sesga el orden de planificación).
  - **Permite solape** (puede correr en paralelo sin bloquear a la persona) y **atención exclusiva** (requiere a la persona al 100%).
  - **Color** y descripción extra.

**3.3 Pestaña Solapamiento**
- Configura la **penalización por solapamiento**: un porcentaje (ej. +30%) que alarga la duración de una tarea cuando se solapa con otra paralela del mismo empleado, y el **modo** (a cuál de las dos tareas se le aplica: a la solapada, a la paralela, o a ambas).

---

### FASE 4 — Plan del día y planificación automática (el corazón)

**Objetivo:** generar automáticamente el cronograma de un día a partir del plan, y permitir previsualizarlo y aplicarlo.

**4.1 Armado del plan del día**
Un modal "Planificar producción" con dos pasos (pestañas "Plan" y "Vista previa"). En el paso Plan, para el día actual se listan las recetas a producir; por cada una se configura:
- **Cantidad de lotes** (cuántas veces se produce).
- **Prioridad** (1–10): define quién reserva recursos primero.
- **Encadenado de lotes:** "no" (independientes), "secuencial" (el lote siguiente arranca cuando el anterior termina del todo) o "pipeline" (arranca cuando el anterior libera su primera etapa).
- Overrides horarios opcionales que pisan los de la receta.

**4.2 Cómo debe planificarse el cronograma (reglas del motor)**

El motor recibe el plan del día, los empleados (con habilidades, líneas y horario del día), las máquinas y el rango horario, y produce dos listas: **tareas ubicadas** y **conflictos** (lo que no entró). Reglas, en orden:

1. **Expandir en bloques.** Cada receta × cada lote = un **bloque** (un proceso indivisible). Dentro del bloque, cada etapa es una pieza con sus dependencias y restricciones. Las restricciones horarias se resuelven con prioridad **plan → receta → etapa**.

2. **Ordenar los bloques.** Primero por **prioridad** (mayor primero). A igual prioridad, **el que tiene la ventana horaria más ajustada va primero** (para que reserve los recursos escasos antes que los procesos flexibles). Luego por orden de carga y número de lote.

3. **Para cada bloque, en ese orden:**
   - **Separar el "trabajo previo"** (prerequisitos sueltos): se planifica lo antes posible en el día, de forma independiente.
   - **Calcular la forma interna del proceso en aislamiento:** se ubican sus etapas con recursos "vacíos" para obtener los tiempos relativos entre ellas (los huecos de fermentación, los encadenamientos). Esa forma queda **congelada**.
   - **Encajar el proceso completo** en el primer horario donde **ninguna** de sus etapas pise una máquina o una persona ya ocupada por otro proceso, respetando las ventanas horarias. Si el horario tentativo no sirve, se avanza al próximo instante en que se libera el recurso que faltaba.
   - **Reservar** las máquinas y personas usadas, y emitir las tareas resultantes.

4. **Dependencias encadenadas vs. cadenas rígidas.** Si una secuencia de etapas tiene margen de espera 0 entre sí, se trata como una **cadena rígida** que se ubica como una sola unidad (no se puede meter nada en el medio).

5. **Tipos y prioridad** sesgan el orden interno: primero lo **crítico**, luego descanso, luego flexible; a igual tipo, mayor prioridad primero.

6. **Capacidad parcial de máquinas.** Una máquina admite varios usos simultáneos hasta su capacidad. El motor calcula el pico de uso en cada rango y solo ubica si hay lugar. Si una máquina se llena y pertenece a un **grupo**, se prueba automáticamente con las otras máquinas del grupo, en orden de preferencia.

7. **Disponibilidad de personas.** Un empleado solo puede tomar una tarea si **trabaja ese día** y dentro de **su horario**. La selección de quién la hace sigue el orden: **empleado preferido → quien tenga la habilidad requerida → cualquiera**. Si la etapa marca "no reemplazable", solo el preferido.

8. **Paralelo y atención exclusiva.**
   - Una tarea **normal** ocupa a la persona (bloquea su tiempo).
   - Una tarea **paralela** (permite solape) no bloquea a la persona para otras tareas normales, pero no puede coincidir con una tarea exclusiva suya.
   - Una tarea **exclusiva** exige a la persona al 100%: no puede coincidir ni con una paralela del mismo empleado.

9. **Encadenado de lotes:** según la opción elegida, el lote siguiente arranca al terminar el anterior (secuencial) o al liberar su primera etapa (pipeline).

10. **Conflictos explicados.** Si un proceso no entra, **no se ubica a medias**: todas sus etapas se reportan como conflicto con un **mensaje claro** del motivo (no hay empleado disponible en la ventana / la máquina está ocupada y no se libera a tiempo / no entra en su ventana horaria) y, cuando es posible, **qué otro proceso concreto** está ocupando el recurso que faltó.

**4.3 Vista previa y aplicación**
- El paso "Vista previa" muestra el cronograma generado (mini línea de tiempo) y una lista de conflictos con sus mensajes.
- Para cada conflicto, el usuario puede registrar una **resolución manual provisoria** (asignar a alguien / a una máquina / nota), que se aplicará como tarea marcada "provisoria".
- Al **aplicar**, las tareas se persisten en el cronograma del día (creando las líneas de empleado que falten, incluida una línea "paralela" para tareas que se solapan). Si ya había tareas provisorias de un plan anterior, se advierte antes de regenerar.

---

### FASE 5 — Edición manual de la línea de tiempo (todas sus funcionalidades)

**Objetivo:** que el encargado ajuste a mano el cronograma con una experiencia fluida tipo editor.

**5.1 Crear y editar tareas**
- **Crear:** click y arrastre sobre una zona vacía de una línea dibuja una nueva tarea en ese rango; se abre un formulario para completar descripción, color, empleado/línea, tamaño y orientación de texto, y banderas (permite solape, etc.).
- **Editar:** doble click sobre una tarea abre el formulario.
- **Agregar ayudante:** desde una tarea se puede crear una tarea "ayuda" asociada (otro empleado o nombre manual) en el mismo rango.

**5.2 Mover y redimensionar (arrastrar)**
- **Mover en el tiempo:** arrastrar una tarea horizontalmente cambia su horario. Las máquinas que tiene asignadas se desplazan junto con ella.
- **Mover entre líneas/empleados:** arrastrar verticalmente hacia otra pista la reasigna (solo si el cursor sale del track original).
- **Redimensionar:** tiradores en los bordes izquierdo/derecho cambian inicio/fin; tiradores arriba/abajo cambian el **tamaño** (alto en niveles); arrastrar el cuerpo verticalmente cambia la **fila** (posición vertical dentro de la línea).
- **Imán (snap):** activable/desactivable. Cuando está activo, los bordes de la tarea se "pegan" a los bordes (inicio/fin y arriba/abajo) de tareas vecinas, para alinearlas con precisión.
- **Selección múltiple:** Ctrl+Click agrega a la selección; al mover una tarea seleccionada se mueven todas. Si una tarea pertenece a un **grupo**, seleccionar una selecciona todo el grupo.

**5.3 Dos modos de arrastre: "Libre" e "Inteligente"**
- **Libre:** se arrastra sin validaciones; las tareas pueden superponerse.
- **Inteligente:** al soltar, el sistema **detecta conflictos** y, si los hay, muestra un diálogo. Los conflictos detectados son: superposición con otra tarea del mismo empleado, **máquina sin capacidad** en el nuevo horario, quedar **fuera del horario del empleado**, y **romper dependencias** entre etapas del mismo proceso (un prerequisito que ya no termina antes, o una etapa dependiente que quedaría antes). El diálogo ofrece: **"Desplazar conflictos"** (mueve la tarea y empuja a las tareas no bloqueadas que estorban) o **"Forzar igual"** (mueve ignorando el conflicto). Si el desplazamiento deja algo fuera del horario del empleado, se pide confirmación adicional ("ubicar igual, solo esta vez").

**5.4 Acciones sobre tareas/líneas**
- **Bloquear/desbloquear** una tarea (las bloqueadas no se mueven ni las empuja el desplazamiento de conflictos). Acción rápida con tecla.
- **Eliminar** tarea(s) seleccionada(s) (con confirmación).
- **Agrupar / desagrupar** tareas (las agrupadas se seleccionan y mueven juntas).
- **Cambiar tamaño y fila** de varias a la vez.
- **Gestión de líneas:** agregar línea a un empleado, renombrar, reordenar (subir/bajar), eliminar (baja lógica con sus tareas). Agregar un empleado al cronograma del día (crea su primera línea).

**5.5 Atajos de teclado**
- Suprimir/Backspace = eliminar selección · `L` = bloquear/desbloquear · `Esc` = deseleccionar · Ctrl±/Ctrl− = zoom · Ctrl+Z / Ctrl+Y = deshacer/rehacer.
- Una franja de ayuda fija en el pie recuerda los gestos principales.

**5.6 Penalización por solapamiento (automática)**
- Cada vez que se mueve/edita/crea/redimensiona, el sistema recalcula si hay tareas paralelas del mismo empleado que se solapan y, según la configuración global, **alarga** la duración de la(s) tarea(s) afectada(s). Es **reversible**: si dejan de solaparse, vuelven a su duración original. Guarda la duración base para poder revertir.

---

### FASE 6 — Historial, versiones y utilidades

**Objetivo:** seguridad operativa y productividad.

- **Deshacer / Rehacer** por día: cada acción registra una instantánea; se puede retroceder/avanzar (hasta ~50 pasos por día). Botones en la toolbar y atajos.
- **Guardar versión:** snapshot manual del día con nombre y notas.
- **Abrir versiones:** listado de versiones guardadas (filtrable por día) para **cargar** (reemplaza el día actual, con confirmación) o eliminar.
- **Papelera:** las versiones eliminadas y los backups automáticos van a una papelera, desde donde se pueden **restaurar** o **eliminar permanentemente**.
- **Vaciar cronograma del día:** borra todo el día, guardando un backup automático en la papelera.
- **Importar/copiar día:** copiar todas las tareas de otro día al día actual (creando las líneas que falten).

---

## 4. Comportamientos transversales y reglas de negocio

- **Persistencia optimista:** las ediciones se reflejan en pantalla de inmediato y se guardan en segundo plano; si falla el guardado, se recargan los datos reales.
- **Borrado lógico:** líneas y tareas no se borran físicamente (se marcan inactivas/eliminadas), para permitir deshacer y versionado.
- **Trazabilidad:** cada tarea generada por el planificador recuerda de qué receta, etapa y lote proviene, y sus dependencias/prerequisitos, para que la edición manual pueda validar que no se rompan.
- **Tiempo y semana:** todo el cálculo en minutos desde medianoche; semana Domingo=0…Sábado=6 en toda la app.
- **Color:** el texto de cada bloque se pinta en negro o blanco según la luminancia de su color de fondo, para legibilidad.

---

## 5. Limitaciones conocidas (a tener en cuenta al planificar el desarrollo)

1. **Horario de empleado = un solo bloque por día.** No se pueden representar turnos partidos ni "franja extra traída". Si en el futuro se necesita, hay que rediseñar la disponibilidad como **lista de franjas** — es un cambio profundo en el motor, no un parche.
2. **El motor es voraz (greedy), no exhaustivo.** Usa heurísticas (prioridad, ventana más ajustada primero, orden por tipo) y no prueba todas las combinaciones posibles: puede no hallar la solución óptima global aunque exista. A cambio es rápido y predecible.
3. **Corre en el navegador:** planes muy grandes consumen recursos del cliente.

---

## 6. Resumen del flujo de uso (recorrido completo)

1. **Iniciar sesión.**
2. **Cargar empleados** con sus habilidades y horarios (Módulo de personal).
3. **Configurar máquinas/grupos** y **recetas con sus etapas** (Configuración).
4. **Armar el plan del día** (qué recetas, cuántos lotes, prioridades, encadenado).
5. **Generar el cronograma automático**, revisar la vista previa y los conflictos, resolver lo necesario y **aplicar**.
6. **Ajustar a mano** en la línea de tiempo (mover, redimensionar, agrupar, bloquear) con el modo Inteligente detectando conflictos.
7. **Guardar versión** o dejar el historial como respaldo; copiar a otros días si aplica.

---

## 7. Orden recomendado de desarrollo (derivable a plan)

1. Fase 1 — cimientos (proyecto, auth, esquema, módulo de personal).
2. Fase 2 — visualización de la línea de tiempo (solo lectura).
3. Fase 3 — configuración de recetas y recursos.
4. Fase 4 — plan del día + motor de planificación + vista previa/aplicar (núcleo de valor).
5. Fase 5 — edición manual completa de la línea de tiempo (modos Libre/Inteligente, solape).
6. Fase 6 — historial, versiones, papelera y utilidades.

Cada fase es entregable y demostrable por separado; las Fases 4 y 5 son las de mayor esfuerzo y riesgo y conviene reservarles el grueso del tiempo.
