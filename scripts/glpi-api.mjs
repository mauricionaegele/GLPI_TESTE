/**
 * Dois clientes da API do GLPI, com papéis bem separados:
 *
 *   producao() — SOMENTE LEITURA. Qualquer método diferente de GET é recusado
 *                antes de sair daqui. O GLPI de produção não pode ser alterado.
 *   teste()    — leitura e escrita, apontando só para o ambiente de teste.
 *
 * O ambiente de teste fica atrás de senha no Apache, e essa senha usaria o
 * mesmo cabeçalho que o token do GLPI. Por isso o acesso é feito por um túnel
 * SSH direto no container (ver abrir-tunel.sh), sem passar pelo Apache.
 */

function exigir(nome) {
  const valor = process.env[nome];
  if (!valor) throw new Error(`Falta ${nome} no arquivo .env`);
  return valor;
}

class ClienteGlpi {
  #sessao = null;

  constructor({ url, appToken, userToken, somenteLeitura }) {
    this.base = `${url.replace(/\/+$/, "")}/apirest.php`;
    this.appToken = appToken;
    this.userToken = userToken;
    this.somenteLeitura = somenteLeitura;
  }

  async #requisitar(caminho, { metodo = "GET", parametros, corpo } = {}) {
    if (this.somenteLeitura && metodo !== "GET") {
      throw new Error(`Bloqueado: tentativa de ${metodo} no GLPI de produção`);
    }

    const url = new URL(`${this.base}${caminho}`);
    for (const [chave, valor] of Object.entries(parametros ?? {})) {
      url.searchParams.set(chave, String(valor));
    }

    const cabecalhos = { "App-Token": this.appToken, "Content-Type": "application/json" };
    if (this.#sessao) cabecalhos["Session-Token"] = this.#sessao;
    else cabecalhos.Authorization = `user_token ${this.userToken}`;

    const resposta = await fetch(url, {
      method: metodo,
      headers: cabecalhos,
      body: corpo ? JSON.stringify(corpo) : undefined,
    });

    const texto = await resposta.text();
    if (!resposta.ok) {
      throw new Error(`${metodo} ${caminho} → ${resposta.status}: ${texto.slice(0, 220)}`);
    }

    return {
      dados: texto ? JSON.parse(texto) : null,
      contentRange: resposta.headers.get("content-range"),
    };
  }

  async iniciarSessao() {
    const { dados } = await this.#requisitar("/initSession");
    this.#sessao = dados.session_token;
    return this.#sessao;
  }

  async encerrarSessao() {
    if (!this.#sessao) return;
    try {
      await this.#requisitar("/killSession");
    } finally {
      this.#sessao = null;
    }
  }

  async contar(tipo) {
    try {
      const { dados, contentRange } = await this.#requisitar(`/${tipo}`, {
        parametros: { range: "0-0", expand_dropdowns: "false", get_hateoas: "false" },
      });
      if (contentRange) {
        const total = Number(contentRange.split("/")[1]);
        if (!Number.isNaN(total)) return total;
      }
      return Array.isArray(dados) ? dados.length : 0;
    } catch (erro) {
      if (String(erro).includes("ERROR_RANGE_EXCEED_TOTAL")) return 0;
      throw erro;
    }
  }

  /** Lê todos os registros de um tipo, paginando. Ids de relacionamento vêm crus. */
  async listarTudo(tipo, tamanhoPagina = 200) {
    const total = await this.contar(tipo);
    if (total === 0) return [];

    const registros = [];
    for (let inicio = 0; inicio < total; inicio += tamanhoPagina) {
      const fim = Math.min(inicio + tamanhoPagina - 1, total - 1);
      const { dados } = await this.#requisitar(`/${tipo}`, {
        parametros: { range: `${inicio}-${fim}`, expand_dropdowns: "false", get_hateoas: "false" },
      });
      const pagina = Array.isArray(dados) ? dados : [];
      if (pagina.length === 0) break;
      registros.push(...pagina);
    }
    return registros;
  }

  async criar(tipo, campos) {
    const { dados } = await this.#requisitar(`/${tipo}`, {
      metodo: "POST",
      corpo: { input: campos },
    });
    const resultado = Array.isArray(dados) ? dados[0] : dados;
    return resultado?.id ?? null;
  }
}

export function producao() {
  return new ClienteGlpi({
    url: exigir("GLPI_PROD_URL"),
    appToken: exigir("GLPI_PROD_APP_TOKEN"),
    userToken: exigir("GLPI_PROD_USER_TOKEN"),
    somenteLeitura: true,
  });
}

export function teste() {
  return new ClienteGlpi({
    url: process.env.GLPI_TESTE_URL ?? "http://127.0.0.1:3300",
    appToken: exigir("GLPI_TESTE_APP_TOKEN"),
    userToken: exigir("GLPI_TESTE_USER_TOKEN"),
    somenteLeitura: false,
  });
}
