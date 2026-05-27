/*
  # Dependencias/prerequisitos por id de etapa (no por orden)

  Hasta ahora plantilla_etapas.dependencias/prerequisitos eran integer[] con los
  "orden" de las etapas. Al reordenar etapas (reasignar orden) esas referencias
  quedaban apuntando a otra etapa → corrupción. Se migran a uuid[] con los ids
  estables de las etapas, resolviendo orden→id dentro de cada plantilla.
*/

ALTER TABLE plantilla_etapas
  ADD COLUMN dependencias_id uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN prerequisitos_id uuid[] NOT NULL DEFAULT '{}';

UPDATE plantilla_etapas e SET dependencias_id = COALESCE(
  (SELECT array_agg(e2.id) FROM plantilla_etapas e2
   WHERE e2.plantilla_id = e.plantilla_id AND e2.orden = ANY(e.dependencias)), '{}');

UPDATE plantilla_etapas e SET prerequisitos_id = COALESCE(
  (SELECT array_agg(e2.id) FROM plantilla_etapas e2
   WHERE e2.plantilla_id = e.plantilla_id AND e2.orden = ANY(e.prerequisitos)), '{}');

ALTER TABLE plantilla_etapas DROP COLUMN dependencias, DROP COLUMN prerequisitos;
ALTER TABLE plantilla_etapas RENAME COLUMN dependencias_id TO dependencias;
ALTER TABLE plantilla_etapas RENAME COLUMN prerequisitos_id TO prerequisitos;
