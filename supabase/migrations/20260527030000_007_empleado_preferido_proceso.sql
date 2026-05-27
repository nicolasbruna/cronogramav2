-- Empleado preferido a nivel de proceso (plantilla) + override por día (plan_dia).
-- El preferido del proceso tiene prioridad sobre el de cada etapa, salvo etapas con preferido propio
-- no reemplazable. En plan_dia se puede heredar / fijar otro / quitar el preferido para ese día.

ALTER TABLE plantillas_proceso
  ADD COLUMN IF NOT EXISTS empleado_preferido_id uuid NULL REFERENCES empleados(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS puede_reemplazarse boolean NOT NULL DEFAULT true;

ALTER TABLE plan_dia
  ADD COLUMN IF NOT EXISTS empleado_preferido_modo text NULL,            -- 'heredar' | 'fijar' | 'ninguno' (null = heredar)
  ADD COLUMN IF NOT EXISTS empleado_preferido_override_id uuid NULL REFERENCES empleados(id) ON DELETE SET NULL;
