# GLPI de teste

Cópia do GLPI da BroadcastTI para experimentar mudanças sem risco: plugins,
campos, automações e ajustes de configuração que depois podem ser levados
para produção.

Roda na mesma VPS do Sistema de Chamados (164.68.118.202), em containers
próprios, sem relação com o banco do helpdesk.

## Regra que não muda

O GLPI de produção (`helpdesk.broadcastti.com.br`) é **somente leitura**.
Nada aqui escreve lá. O caminho é sempre: mexer neste ambiente, validar, e só
então aplicar em produção — manualmente e com decisão explícita.

## O que sobe

| Serviço | Imagem | Observação |
|---|---|---|
| `app` | `ghcr.io/glpi-project/glpi:10.0.18` | mesma versão de produção |
| `db` | `mariadb:10.11` | sem porta publicada |

A aplicação escuta em `127.0.0.1:3300`. Quem publica na internet é o Apache
do servidor, com HTTPS.

## Primeira subida

```bash
cd ~/glpi-teste
cp .env.exemplo .env     # e preencha as senhas
docker compose --env-file .env up -d
```

## Restaurar os dados de produção

1. No GLPI de produção, em **Administração → Manutenção**, gere o backup SQL
   e baixe o arquivo.
2. Envie para a VPS, em `~/glpi-teste/dump/` (o MobaXterm faz isso pelo painel
   de arquivos).
3. Rode:

```bash
./scripts/restaurar-dump.sh dump/glpi-producao.sql
```

O script restaura o dump, aponta a URL para o endereço de teste e **desliga o
envio de e-mails**, para o ambiente de teste não notificar cliente nenhum.

## Depois de restaurar

- Os logins são os mesmos de produção, com as mesmas senhas.
- Confira em **Configurar → Notificações** que o envio continua desligado
  antes de mexer em chamados.
- Os agentes de inventário das máquinas dos clientes continuam apontando para
  produção; este ambiente não recebe inventário novo.
