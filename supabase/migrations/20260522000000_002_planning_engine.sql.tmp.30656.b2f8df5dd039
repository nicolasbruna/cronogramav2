/*
  # Motor de planificación automática

  Tablas nuevas:
  - `maquinas` - recursos físicos (amasadora, sobadora, horno, etc.)
  - `habilidades` - habilidades de empleados
  - `empleado_habilidades` - qué sabe hacer cada empleado
  - `plantillas_proceso` - plantillas de producción (ej: "Amasado dulce 16 masas")
  - `plantilla_etapas` - etapas de cada plantilla con todos los metadatos
  - `plan_dia` - qué plantillas se producen cada día de la semana
*/

-- ============================================
-- TABLA: maquinas
-- ============================================
CREATE TABLE IF NOT EXISTS maquinas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  cantidad integer NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  descripcion text,
  activa boolean NOT NULL DEFAULT true,
  fecha_creacion timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE maquinas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden gestionar maquinas"
  ON maquinas FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- TABLA: habilidades
-- ============================================
CREATE TABLE IF NOT EXISTS habilidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  descripcion text,
  fecha_creacion timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE habilidades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden gestionar habilidades"
  ON habilidades FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- TABLA: empleado_habilidades
-- ============================================
CREATE TABLE IF NOT EXISTS empleado_habilidades (
  empleado_id uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  habilidad_id uuid NOT NULL REFERENCES habilidades(id) ON DELETE CASCADE,
  PRIMARY KEY (empleado_id, habilidad_id)
);

ALTER TABLE empleado_habilidades ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden gestionar empleado_habilidades"
  ON empleado_habilidades FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- TABLA: plantillas_proceso
-- ============================================
CREATE TABLE IF NOT EXISTS plantillas_proceso (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  descripcion text,
  categoria text,
  activa boolean NOT NULL DEFAULT true,
  fecha_creacion timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plantillas_proceso ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden gestionar plantillas_proceso"
  ON plantillas_proceso FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- TABLA: plantilla_etapas
-- ============================================
CREATE TABLE IF NOT EXISTS plantilla_etapas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plantilla_id uuid NOT NULL REFERENCES plantillas_proceso(id) ON DELETE CASCADE,
  orden integer NOT NULL DEFAULT 0,
  nombre text NOT NULL,
  -- Tiempo total que dura el proceso (ej: amasado = 20 min aunque el empleado solo necesite 8)
  duracion_proceso integer NOT NULL DEFAULT 10 CHECK (duracion_proceso > 0),
  -- Minutos que el empleado debe estar presente al INICIO
  tiempo_empleado_inicio integer NOT NULL DEFAULT 0 CHECK (tiempo_empleado_inicio >= 0),
  -- Minutos que el empleado debe estar presente al FINAL
  tiempo_empleado_fin integer NOT NULL DEFAULT 0 CHECK (tiempo_empleado_fin >= 0),
  -- Si es true, el empleado queda bloqueado TODA la duracion
  bloquea_empleado_total boolean NOT NULL DEFAULT false,
  -- Recurso físico que ocupa (puede ser null si no necesita máquina)
  maquina_id uuid REFERENCES maquinas(id) ON DELETE SET NULL,
  -- Habilidad requerida del empleado (puede ser null si cualquiera puede hacerlo)
  habilidad_id uuid REFERENCES habilidades(id) ON DELETE SET NULL,
  -- Órdenes de etapas que deben completarse antes (ej: [1, 2] significa etapas 1 y 2 primero)
  dependencias integer[] NOT NULL DEFAULT '{}',
  -- Máximo tiempo que puede esperar después de que terminen sus dependencias (null = sin límite)
  margen_espera_max integer,
  -- Prioridad de scheduling (1-10, mayor = se acomoda primero)
  prioridad integer NOT NULL DEFAULT 5 CHECK (prioridad >= 1 AND prioridad <= 10),
  -- Tipo: critica (no puede moverse), flexible (se puede usar para llenar huecos), descanso (esperando)
  tipo text NOT NULL DEFAULT 'critica' CHECK (tipo IN ('critica', 'flexible', 'descanso')),
  color text,
  descripcion_extra text
);

ALTER TABLE plantilla_etapas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden gestionar plantilla_etapas"
  ON plantilla_etapas FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_plantilla_etapas_plantilla ON plantilla_etapas(plantilla_id);
CREATE INDEX IF NOT EXISTS idx_plantilla_etapas_orden ON plantilla_etapas(plantilla_id, orden);

-- ============================================
-- TABLA: plan_dia
-- Qué plantillas se producen en cada día de la semana
-- ============================================
CREATE TABLE IF NOT EXISTS plan_dia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dia_semana integer NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
  plantilla_id uuid NOT NULL REFERENCES plantillas_proceso(id) ON DELETE CASCADE,
  cantidad_lotes integer NOT NULL DEFAULT 1 CHECK (cantidad_lotes > 0),
  prioridad integer NOT NULL DEFAULT 5,
  hora_inicio_deseada time,
  activo boolean NOT NULL DEFAULT true,
  fecha_creacion timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE plan_dia ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden gestionar plan_dia"
  ON plan_dia FOR ALL TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_plan_dia_dia ON plan_dia(dia_semana);
CREATE INDEX IF NOT EXISTS idx_plan_dia_dia_activo ON plan_dia(dia_semana) WHERE activo = true;
