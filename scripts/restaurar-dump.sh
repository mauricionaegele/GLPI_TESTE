#!/usr/bin/env bash
#
# Restaura no GLPI de teste um dump do GLPI de producao.
#
# Depois de restaurar, ajusta o ambiente para ele nao se passar por producao:
# aponta a URL para o endereco de teste e desliga o envio de e-mails, para
# nenhum cliente receber notificacao vinda daqui.
#
# Uso: ./scripts/restaurar-dump.sh dump/glpi-producao.sql
set -euo pipefail

cd "$(dirname "$0")/.."

ARQUIVO="${1:-}"
URL_TESTE="${GLPI_URL_TESTE:-https://glpi-teste.164-68-118-202.sslip.io}"

if [ -z "$ARQUIVO" ] || [ ! -f "$ARQUIVO" ]; then
  echo "Informe o arquivo do dump. Ex.: ./scripts/restaurar-dump.sh dump/glpi-producao.sql" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

DB_NAME="${GLPI_DB_NAME:-glpi}"
DB_USER="${GLPI_DB_USER:-glpi}"

executar_sql() {
  docker compose exec -T db mariadb -u root -p"$GLPI_DB_ROOT_PASSWORD" "$@"
}

echo "==> Conferindo se o banco esta no ar"
docker compose up -d db
until executar_sql -e "SELECT 1" >/dev/null 2>&1; do sleep 2; done

echo "==> Zerando o banco $DB_NAME"
executar_sql -e "DROP DATABASE IF EXISTS \`$DB_NAME\`; CREATE DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL ON \`$DB_NAME\`.* TO '$DB_USER'@'%';"

echo "==> Restaurando $ARQUIVO (pode demorar alguns minutos)"
case "$ARQUIVO" in
  *.gz) gunzip -c "$ARQUIVO" | executar_sql "$DB_NAME" ;;
  *)    executar_sql "$DB_NAME" < "$ARQUIVO" ;;
esac

echo "==> Apontando a URL para $URL_TESTE"
executar_sql "$DB_NAME" -e "UPDATE glpi_configs SET value='$URL_TESTE' WHERE name IN ('url_base');"
executar_sql "$DB_NAME" -e "UPDATE glpi_configs SET value='$URL_TESTE/apirest.php' WHERE name IN ('url_base_api');"

echo "==> Desligando o envio de e-mails (ambiente de teste nao notifica cliente)"
executar_sql "$DB_NAME" -e "UPDATE glpi_configs SET value='0' WHERE name IN ('notifications_mailing','notifications_ajax');"
executar_sql "$DB_NAME" -e "UPDATE glpi_notifications SET is_active=0;"

echo "==> Marcando o ambiente como teste no rodape do GLPI"
executar_sql "$DB_NAME" -e "UPDATE glpi_configs SET value='AMBIENTE DE TESTE - as alteracoes aqui nao afetam o GLPI de producao' WHERE name='text_login';" || true

echo "==> Subindo a aplicacao"
docker compose up -d app

echo
echo "Pronto. Confira em $URL_TESTE"
echo "Os logins sao os mesmos de producao."
