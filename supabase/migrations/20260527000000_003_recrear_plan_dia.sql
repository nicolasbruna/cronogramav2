/*
  # Recrear tabla plan_dia (cola de producción por día)

  La tabla plan_dia se había eliminado al quitar el scheduler. Se recrea para el
  nuevo generador de día completo. A diferencia del esquema original (migración 002),
  NO incluye hora_inicio_deseada: las restricciones horarias viven solo en la
  configuración de la plantilla.

  plan_dia = qué plantillas se producen en cada día de la semana y cuántos lotes.
*/

CREATE TABLE IF NOT EXISTS plan_dia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dia_semana integer NOT NULL CHECK (dia_semana >= 0 AND dia_semana <= 6),
  plantilla_id uuid NOT NULL REFERENCES plantillas_proceso(id) ON DELETE CASCADE,
  cantidad_lotes integer NOT NULL DEFAULT 1 CHECK (cantidad_lotes > 0),
  prioridad integer NOT NULL DEFAULT 5,
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
