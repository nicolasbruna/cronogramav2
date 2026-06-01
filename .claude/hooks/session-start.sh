#!/bin/bash
# SessionStart hook — Claude Code on the web.
# 1) Instala dependencias (para que tsc/build anden sin pasos manuales).
# 2) Carga la bitácora del proyecto + estado git en el contexto de la sesión,
#    para no perder continuidad entre sesiones.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# --- Instalar dependencias (silencioso; no romper la sesión si falla) ---
if [ -f package.json ]; then
  npm install --no-audit --no-fund >/tmp/session-start-npm.log 2>&1 || true
fi

# --- Contexto para Claude (esto se inyecta en la sesión) ---
echo "===== BITÁCORA DEL PROYECTO (PLAN_IA_CRONOGRAMA.md) ====="
if [ -f PLAN_IA_CRONOGRAMA.md ]; then
  cat PLAN_IA_CRONOGRAMA.md
else
  echo "(todavía no hay bitácora)"
fi

echo ""
echo "===== ESTADO GIT ====="
echo "Rama actual: $(git branch --show-current 2>/dev/null || echo '?')"
echo "Últimos commits:"
git log --oneline -5 2>/dev/null || echo "(sin historial git)"

exit 0
