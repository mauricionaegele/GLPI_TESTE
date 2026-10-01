#!/usr/bin/env bash
#
# Abre um tunel ate o GLPI de teste na VPS, para falar com a API sem passar
# pela senha do site (os dois usariam o mesmo cabecalho de autorizacao).
#
# Deixe rodando numa janela e, em outra, rode a carga de cadastros.
set -euo pipefail

SERVIDOR="${GLPI_TESTE_SSH:-deploy@164.68.118.202}"

echo "Tunel aberto em http://127.0.0.1:3300 — Ctrl+C encerra."
ssh -N -L 3300:127.0.0.1:3300 "$SERVIDOR"
