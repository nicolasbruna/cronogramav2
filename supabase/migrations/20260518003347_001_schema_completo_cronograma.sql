/*
  # Schema completo - Cronograma de Producción

  1. Tablas creadas
    - `empleados` - tabla base de empleados
      - `id` (uuid, PK)
      - `codigo` (serial, autoincremental)
      - `nombre_completo` (text)
      - `documento`, `telefono`, `email` (opcionales)
      - `activo` (boolean, default true)
    - `cronograma_lineas` - líneas de trabajo por empleado/día
      - `id` (uuid, PK)
      - `empleado_id` (FK a empleados)
      - `nombre` (text)
      - `dia_semana` (0-6)
      - `orden`, `color`, `activa`
    - `cronograma_tareas` - tareas del cronograma
      - `id` (uuid, PK)
      - `linea_id` (FK a cronograma_lineas)
      - `dia_semana`, `hora_inicio`, `hora_fin`
      - `descripcion`, `color`, `bloqueada`
      - `tamano_texto`, `orientacion_texto`
      - `orden`, `capa`, `grupo_id`
      - `eliminada` (soft-delete)
    - `cronograma_versiones` - versiones guardadas
    - `cronograma_rango_horario` - rango visible por día
    - `cronograma_historial` - historial de cambios (undo/redo)
    - `cronograma_historial_puntero` - puntero posición actual

  2. Seguridad
    - RLS habilitado en todas las tablas
    - Políticas para usuarios autenticados

  3. RPCs
    - `cronograma_registrar_historial` - registra acción
    - `cronograma_deshacer` - undo
    - `cronograma_rehacer` - redo
    - `cronograma_estado_historial` - estado undo/redo
*/

-- ============================================
-- TABLA: empleados
-- ============================================
CREATE TABLE IF NOT EXISTS empleados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo serial,
  nombre_completo text NOT NULL,
  documento text,
  telefono text,
  email text,
  fecha_ingreso date,
  activo boolean NOT NULL DEFAULT true,
  fecha_creacion timestamptz NOT NULL DEFAULT now(),
  fecha_actualizacion timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE empleados ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden ver empleados"
  ON empleados FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear empleados"
  ON empleados FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden editar empleados"
  ON empleados FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar empleados"
  ON empleados FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- TABLA: cronograma_lineas
-- ============================================
CREATE TABLE IF NOT EXISTS cronograma_lineas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empleado_id uuid NOT NULL REFERENCES empleados(id) ON DELETE CASCADE,
  nombre text NOT NULL DEFAULT '',
  dia_semana integer NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
  orden integer NOT NULL DEFAULT 0,
  color text,
  activa boolean NOT NULL DEFAULT true,
  fecha_creacion timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cronograma_lineas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden ver lineas cronograma"
  ON cronograma_lineas FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear lineas cronograma"
  ON cronograma_lineas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden editar lineas cronograma"
  ON cronograma_lineas FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar lineas cronograma"
  ON cronograma_lineas FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_cronograma_lineas_empleado ON cronograma_lineas(empleado_id);
CREATE INDEX IF NOT EXISTS idx_cronograma_lineas_empleado_dia ON cronograma_lineas(empleado_id, dia_semana);

-- ============================================
-- TABLA: cronograma_tareas
-- ============================================
CREATE TABLE IF NOT EXISTS cronograma_tareas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  linea_id uuid NOT NULL REFERENCES cronograma_lineas(id) ON DELETE CASCADE,
  dia_semana integer NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
  hora_inicio time NOT NULL,
  hora_fin time NOT NULL,
  descripcion text NOT NULL DEFAULT '',
  color text,
  bloqueada boolean NOT NULL DEFAULT false,
  tamano_texto text NOT NULL DEFAULT 'normal',
  orientacion_texto text NOT NULL DEFAULT 'horizontal',
  orden integer NOT NULL DEFAULT 0,
  capa integer NOT NULL DEFAULT 0,
  grupo_id uuid DEFAULT NULL,
  eliminada boolean NOT NULL DEFAULT false,
  fecha_creacion timestamptz NOT NULL DEFAULT now(),
  fecha_actualizacion timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hora_fin_mayor_que_inicio CHECK (hora_fin > hora_inicio)
);

ALTER TABLE cronograma_tareas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden ver tareas cronograma"
  ON cronograma_tareas FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear tareas cronograma"
  ON cronograma_tareas FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden editar tareas cronograma"
  ON cronograma_tareas FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar tareas cronograma"
  ON cronograma_tareas FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_cronograma_tareas_linea ON cronograma_tareas(linea_id);
CREATE INDEX IF NOT EXISTS idx_cronograma_tareas_dia ON cronograma_tareas(dia_semana);
CREATE INDEX IF NOT EXISTS idx_cronograma_tareas_linea_dia ON cronograma_tareas(linea_id, dia_semana);
CREATE INDEX IF NOT EXISTS idx_cronograma_tareas_grupo_id ON cronograma_tareas(grupo_id) WHERE grupo_id IS NOT NULL;

-- ============================================
-- TABLA: cronograma_versiones
-- ============================================
CREATE TABLE IF NOT EXISTS cronograma_versiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  dia_semana integer NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
  snapshot_tareas jsonb NOT NULL DEFAULT '[]'::jsonb,
  snapshot_lineas jsonb NOT NULL DEFAULT '[]'::jsonb,
  creado_por text NOT NULL DEFAULT '',
  fecha_creacion timestamptz NOT NULL DEFAULT now(),
  notas text NOT NULL DEFAULT '',
  eliminado_en timestamptz DEFAULT NULL,
  es_backup_auto boolean NOT NULL DEFAULT false
);

ALTER TABLE cronograma_versiones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden ver versiones cronograma"
  ON cronograma_versiones FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear versiones cronograma"
  ON cronograma_versiones FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden editar versiones cronograma"
  ON cronograma_versiones FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar versiones cronograma"
  ON cronograma_versiones FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_cronograma_versiones_dia ON cronograma_versiones(dia_semana);
CREATE INDEX IF NOT EXISTS idx_cronograma_versiones_activas ON cronograma_versiones(fecha_creacion DESC) WHERE eliminado_en IS NULL;
CREATE INDEX IF NOT EXISTS idx_cronograma_versiones_eliminadas ON cronograma_versiones(eliminado_en DESC) WHERE eliminado_en IS NOT NULL;

-- ============================================
-- TABLA: cronograma_rango_horario
-- ============================================
CREATE TABLE IF NOT EXISTS cronograma_rango_horario (
  dia_semana integer PRIMARY KEY CHECK (dia_semana >= 0 AND dia_semana <= 6),
  hora_inicio text NOT NULL DEFAULT '04:00',
  hora_fin text NOT NULL DEFAULT '15:00',
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE cronograma_rango_horario ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden ver rangos horarios"
  ON cronograma_rango_horario FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden insertar rangos horarios"
  ON cronograma_rango_horario FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden actualizar rangos horarios"
  ON cronograma_rango_horario FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- TABLA: cronograma_historial (undo/redo)
-- ============================================
CREATE TABLE IF NOT EXISTS cronograma_historial (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dia_semana integer NOT NULL,
  posicion integer NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_lineas jsonb,
  descripcion_accion text NOT NULL DEFAULT '',
  fecha_creacion timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cronograma_historial_dia_semana_posicion_key UNIQUE (dia_semana, posicion) DEFERRABLE INITIALLY DEFERRED
);

ALTER TABLE cronograma_historial ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden ver historial cronograma"
  ON cronograma_historial FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear historial cronograma"
  ON cronograma_historial FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden editar historial cronograma"
  ON cronograma_historial FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden eliminar historial cronograma"
  ON cronograma_historial FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ============================================
-- TABLA: cronograma_historial_puntero
-- ============================================
CREATE TABLE IF NOT EXISTS cronograma_historial_puntero (
  dia_semana integer PRIMARY KEY,
  posicion_actual integer NOT NULL DEFAULT -1,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE cronograma_historial_puntero ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios autenticados pueden ver puntero historial"
  ON cronograma_historial_puntero FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden crear puntero historial"
  ON cronograma_historial_puntero FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Usuarios autenticados pueden editar puntero historial"
  ON cronograma_historial_puntero FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- ============================================
-- RPCs: Historial (undo/redo)
-- ============================================

-- Registrar acción en historial
CREATE OR REPLACE FUNCTION cronograma_registrar_historial(
  p_dia_semana integer,
  p_snapshot jsonb,
  p_descripcion text,
  p_snapshot_lineas jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posicion_actual integer;
  v_nueva_posicion integer;
  v_max_historial integer := 50;
BEGIN
  SET CONSTRAINTS cronograma_historial_dia_semana_posicion_key DEFERRED;

  INSERT INTO cronograma_historial_puntero (dia_semana, posicion_actual, updated_at)
  VALUES (p_dia_semana, -1, now())
  ON CONFLICT (dia_semana) DO NOTHING;

  SELECT posicion_actual INTO v_posicion_actual
  FROM cronograma_historial_puntero
  WHERE dia_semana = p_dia_semana
  FOR UPDATE;

  v_nueva_posicion := v_posicion_actual + 1;

  DELETE FROM cronograma_historial
  WHERE dia_semana = p_dia_semana AND posicion > v_posicion_actual;

  IF v_nueva_posicion >= v_max_historial THEN
    DELETE FROM cronograma_historial
    WHERE dia_semana = p_dia_semana AND posicion = 0;

    UPDATE cronograma_historial
    SET posicion = posicion - 1
    WHERE dia_semana = p_dia_semana;

    v_nueva_posicion := v_max_historial - 1;
  END IF;

  INSERT INTO cronograma_historial (dia_semana, posicion, snapshot, snapshot_lineas, descripcion_accion)
  VALUES (p_dia_semana, v_nueva_posicion, p_snapshot, p_snapshot_lineas, p_descripcion);

  UPDATE cronograma_historial_puntero
  SET posicion_actual = v_nueva_posicion, updated_at = now()
  WHERE dia_semana = p_dia_semana;
END;
$$;

-- Deshacer
CREATE OR REPLACE FUNCTION cronograma_deshacer(p_dia_semana integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posicion_actual integer;
  v_snapshot jsonb;
  v_snapshot_lineas jsonb;
BEGIN
  SELECT posicion_actual INTO v_posicion_actual
  FROM cronograma_historial_puntero
  WHERE dia_semana = p_dia_semana;

  IF v_posicion_actual IS NULL OR v_posicion_actual <= 0 THEN
    RETURN NULL;
  END IF;

  SELECT snapshot, snapshot_lineas INTO v_snapshot, v_snapshot_lineas
  FROM cronograma_historial
  WHERE dia_semana = p_dia_semana AND posicion = v_posicion_actual - 1;

  IF v_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE cronograma_historial_puntero
  SET posicion_actual = v_posicion_actual - 1, updated_at = now()
  WHERE dia_semana = p_dia_semana;

  RETURN jsonb_build_object('tareas', v_snapshot, 'lineas', v_snapshot_lineas);
END;
$$;

-- Rehacer
CREATE OR REPLACE FUNCTION cronograma_rehacer(p_dia_semana integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posicion_actual integer;
  v_snapshot jsonb;
  v_snapshot_lineas jsonb;
BEGIN
  SELECT posicion_actual INTO v_posicion_actual
  FROM cronograma_historial_puntero
  WHERE dia_semana = p_dia_semana;

  IF v_posicion_actual IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT snapshot, snapshot_lineas INTO v_snapshot, v_snapshot_lineas
  FROM cronograma_historial
  WHERE dia_semana = p_dia_semana AND posicion = v_posicion_actual + 1;

  IF v_snapshot IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE cronograma_historial_puntero
  SET posicion_actual = v_posicion_actual + 1, updated_at = now()
  WHERE dia_semana = p_dia_semana;

  RETURN jsonb_build_object('tareas', v_snapshot, 'lineas', v_snapshot_lineas);
END;
$$;

-- Estado historial
CREATE OR REPLACE FUNCTION cronograma_estado_historial(p_dia_semana integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_posicion_actual integer;
  v_hay_siguiente boolean;
BEGIN
  SELECT posicion_actual INTO v_posicion_actual
  FROM cronograma_historial_puntero
  WHERE dia_semana = p_dia_semana;

  IF v_posicion_actual IS NULL THEN
    RETURN jsonb_build_object('puede_deshacer', false, 'puede_rehacer', false);
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM cronograma_historial
    WHERE dia_semana = p_dia_semana AND posicion = v_posicion_actual + 1
  ) INTO v_hay_siguiente;

  RETURN jsonb_build_object(
    'puede_deshacer', v_posicion_actual > 0,
    'puede_rehacer', v_hay_siguiente
  );
END;
$$;