/*
  # Overrides de horario por día en plan_dia

  Permite forzar, para un día concreto y por renglón de la cola, otro horario
  sin tocar la plantilla. Espejan las tres restricciones de plantillas_proceso.
  Cada columna es opcional: NULL = usa el valor de la plantilla.
*/

ALTER TABLE plan_dia
  ADD COLUMN IF NOT EXISTS hora_inicio_min time,
  ADD COLUMN IF NOT EXISTS hora_inicio_max time,
  ADD COLUMN IF NOT EXISTS hora_fin_max time;
