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

## Carregar os cadastros de produção (caminho usado hoje)

Copia pela API a estrutura real da empresa — entidades, categorias, usuários,
base de conhecimento — sem o histórico de chamados. É o suficiente para testar
mudanças de tela e a integração do atendimento do WhatsApp.

```bash
./scripts/abrir-tunel.sh                              # deixe rodando
node --env-file=.env scripts/carregar-cadastros.mjs   # em outra janela
```

Pode rodar de novo quando quiser: o que já existe é reaproveitado pelo nome,
não duplicado. Use `--so-contar` para só comparar os dois lados.

O túnel existe porque o site está protegido por senha no Apache, e essa senha
disputaria o mesmo cabeçalho que o token da API.

### O que a API não traz

| | |
|---|---|
| Histórico de chamados | 23 mil chamados e 4 milhões de linhas de log |
| Senhas dos usuários | o hash não é exposto; os usuários entram desativados |
| Plugins | o código precisa ser instalado no servidor; os dados não são expostos |
| Perfis e permissões | ficam os perfis padrão do GLPI |
| Anexos | os documentos teriam de ser baixados e reenviados um a um |

## Restaurar um dump do banco (quando precisar de cópia fiel)

O backup pela tela **não existe mais no GLPI 10** — foi removido na 9.4.6 por
ser instável em bases grandes. Só dá por `mysqldump`, rodado por quem tem
acesso ao servidor de produção:

```bash
mysqldump --single-transaction --quick --default-character-set=utf8mb4 \
  -u <usuario> -p <banco> | gzip > glpi-producao.sql.gz
```

Com o arquivo em `~/glpi-teste/dump/`:

```bash
./scripts/restaurar-dump.sh dump/glpi-producao.sql.gz
```

O script restaura, aponta a URL para o endereço de teste e **desliga o envio de
e-mails**, para o ambiente de teste não notificar cliente nenhum. Depois dele,
os logins passam a ser os mesmos de produção, com as mesmas senhas.
