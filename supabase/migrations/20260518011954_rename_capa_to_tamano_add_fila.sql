/*
  # Renombrar capa a tamano y agregar campo fila

  1. Cambios en `cronograma_tareas`
    - Renombrar columna `capa` a `tamano`
    - Convertir valores: capa 0 -> tamano 5, capa 1 -> tamano 4, capa 2 -> tamano 3, etc.
    - Agregar columna `fila` (integer, default 0) para posicion vertical dentro de la linea
    - Tamano va de 1 (mas chico) a 5 (altura completa)
    - Fila va de 0 a 4, indica en que posicion vertical se ubica la tarea

  2. Notas
    - El tamano define cuantas "filas" ocupa la tarea (1/5 de la altura por nivel)
    - La fila define donde se posiciona verticalmente
    - Una tarea con tamano 5 ocupa toda la altura (fila siempre 0)
    - Una tarea con tamano 1 ocupa 1/5 de la altura y puede estar en fila 0-4
*/

ALTER TABLE cronograma_tareas RENAME COLUMN capa TO tamano;

UPDATE cronograma_tareas SET tamano = GREATEST(1, LEAST(5, 5 - tamano));

ALTER TABLE cronograma_tareas ALTER COLUMN tamano SET DEFAULT 5;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cronograma_tareas' AND column_name = 'fila'
  ) THEN
    ALTER TABLE cronograma_tareas ADD COLUMN fila integer NOT NULL DEFAULT 0;
  END IF;
END $$;
