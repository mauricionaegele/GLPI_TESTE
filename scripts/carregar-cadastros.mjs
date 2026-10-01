/**
 * Copia os cadastros do GLPI de produção para o GLPI de teste, pela API.
 *
 * Serve para o ambiente de teste ter a estrutura real da BroadcastTI —
 * entidades, categorias, usuários, base de conhecimento — e assim dar para
 * testar mudanças de tela e a integração do atendimento do WhatsApp.
 *
 * Produção é lida e nunca escrita. O histórico de chamados fica de fora: para
 * isso só o dump do banco resolve.
 *
 * Roda quantas vezes precisar: o que já existe no teste é reaproveitado pelo
 * nome, não duplicado.
 *
 * Uso: node --env-file=.env scripts/carregar-cadastros.mjs [--so-contar]
 */
import { producao, teste } from "./glpi-api.mjs";

const SO_CONTAR = process.argv.includes("--so-contar");

const prod = producao();
const alvo = teste();

/** Mapa de id da produção para id do teste, por tipo. */
const mapas = new Map();
const mapa = (tipo) => {
  if (!mapas.has(tipo)) mapas.set(tipo, new Map());
  return mapas.get(tipo);
};

/** Entidade raiz é a mesma nos dois lados. */
mapa("Entity").set(0, 0);

function log(...partes) {
  console.log(...partes);
}

/** Ordena uma árvore para o pai vir sempre antes do filho. */
function ordenarPorHierarquia(registros, campoPai) {
  const porId = new Map(registros.map((r) => [r.id, r]));
  const ordenados = [];
  const visitados = new Set();

  const visitar = (registro) => {
    if (!registro || visitados.has(registro.id)) return;
    visitados.add(registro.id);
    const pai = porId.get(registro[campoPai]);
    if (pai) visitar(pai);
    ordenados.push(registro);
  };

  registros.forEach(visitar);
  return ordenados;
}

/**
 * Copia um tipo de cadastro.
 *
 * `campos` monta o registro no destino a partir do da produção; devolver null
 * pula o registro. `chave` identifica o mesmo registro nos dois lados, para a
 * carga poder rodar de novo sem duplicar.
 */
async function copiar(tipo, { campos, chave = (r) => String(r.name ?? "").trim(), pai, ordem }) {
  const daProducao = await prod.listarTudo(tipo);
  const doTeste = await alvo.listarTudo(tipo);

  const existentes = new Map();
  for (const registro of doTeste) {
    const identificador = chave(registro);
    if (identificador) existentes.set(identificador, registro.id);
  }

  let criados = 0;
  let reaproveitados = 0;
  let pulados = 0;

  const lista = pai
    ? ordenarPorHierarquia(daProducao, pai)
    : ordem
      ? [...daProducao].sort(ordem)
      : daProducao;

  for (const registro of lista) {
    const identificador = chave(registro);

    if (existentes.has(identificador)) {
      mapa(tipo).set(registro.id, existentes.get(identificador));
      reaproveitados += 1;
      continue;
    }

    const entrada = campos(registro);
    if (!entrada) {
      pulados += 1;
      continue;
    }

    try {
      const novoId = await alvo.criar(tipo, entrada);
      if (novoId) {
        mapa(tipo).set(registro.id, novoId);
        existentes.set(identificador, novoId);
        criados += 1;
      } else {
        pulados += 1;
      }
    } catch (erro) {
      pulados += 1;
      log(`   ! ${tipo} "${identificador}": ${String(erro).slice(0, 120)}`);
    }
  }

  log(
    `${tipo}: ${criados} criados, ${reaproveitados} já existiam${pulados ? `, ${pulados} pulados` : ""}`,
  );
}

/** Traduz um id da produção para o id correspondente no teste. */
const traduzir = (tipo, id, padrao = 0) => mapa(tipo).get(Number(id)) ?? padrao;

async function principal() {
  await prod.iniciarSessao();
  await alvo.iniciarSessao();

  try {
    if (SO_CONTAR) {
      for (const tipo of [
        "Entity",
        "Location",
        "Group",
        "User",
        "Supplier",
        "Contact",
        "ITILCategory",
        "KnowbaseItemCategory",
        "KnowbaseItem",
        "TaskCategory",
        "RequestType",
      ]) {
        log(`${tipo}: produção ${await prod.contar(tipo)} | teste ${await alvo.contar(tipo)}`);
      }
      return;
    }

    // Entidades primeiro: quase todo cadastro aponta para uma.
    await copiar("Entity", {
      pai: "entities_id",
      chave: (r) => String(r.completename ?? r.name ?? "").trim(),
      campos: (r) => ({
        name: r.name,
        entities_id: traduzir("Entity", r.entities_id),
        comment: r.comment ?? "",
      }),
    });

    await copiar("Location", {
      pai: "locations_id",
      chave: (r) => `${r.entities_id}|${r.completename ?? r.name}`,
      campos: (r) => ({
        name: r.name,
        entities_id: traduzir("Entity", r.entities_id),
        locations_id: traduzir("Location", r.locations_id),
        is_recursive: r.is_recursive ?? 0,
      }),
    });

    await copiar("Group", {
      chave: (r) => `${r.entities_id}|${r.name}`,
      campos: (r) => ({
        name: r.name,
        entities_id: traduzir("Entity", r.entities_id),
        is_recursive: r.is_recursive ?? 0,
        comment: r.comment ?? "",
      }),
    });

    // Usuários vêm sem senha: a API não expõe o hash. Entram inativos até
    // alguém definir a senha no ambiente de teste.
    await copiar("User", {
      chave: (r) => String(r.name ?? "").trim().toLowerCase(),
      campos: (r) => ({
        name: r.name,
        realname: r.realname ?? "",
        firstname: r.firstname ?? "",
        entities_id: traduzir("Entity", r.entities_id),
        is_active: 0,
        comment: "Importado da produção — defina a senha antes de usar",
      }),
    });

    await copiar("Supplier", {
      chave: (r) => `${r.entities_id}|${r.name}`,
      campos: (r) => ({
        name: r.name,
        entities_id: traduzir("Entity", r.entities_id),
        is_recursive: r.is_recursive ?? 0,
        phone: r.phone ?? "",
        email: r.email ?? "",
        comment: r.comment ?? "",
      }),
    });

    await copiar("Contact", {
      chave: (r) => `${r.entities_id}|${r.name}|${r.firstname ?? ""}`,
      campos: (r) => ({
        name: r.name,
        firstname: r.firstname ?? "",
        entities_id: traduzir("Entity", r.entities_id),
        is_recursive: r.is_recursive ?? 0,
        phone: r.phone ?? "",
        email: r.email ?? "",
      }),
    });

    // Categorias de chamado: é por elas que a integração do WhatsApp vai
    // classificar o que abrir.
    await copiar("ITILCategory", {
      pai: "itilcategories_id",
      chave: (r) => `${r.entities_id}|${r.completename ?? r.name}`,
      campos: (r) => ({
        name: r.name,
        entities_id: traduzir("Entity", r.entities_id),
        itilcategories_id: traduzir("ITILCategory", r.itilcategories_id),
        is_recursive: r.is_recursive ?? 0,
        comment: r.comment ?? "",
      }),
    });

    await copiar("RequestType", {
      campos: (r) => ({ name: r.name, is_active: r.is_active ?? 1 }),
    });

    await copiar("TaskCategory", {
      pai: "taskcategories_id",
      chave: (r) => `${r.entities_id}|${r.completename ?? r.name}`,
      campos: (r) => ({
        name: r.name,
        entities_id: traduzir("Entity", r.entities_id),
        taskcategories_id: traduzir("TaskCategory", r.taskcategories_id),
        is_recursive: r.is_recursive ?? 0,
      }),
    });

    await copiar("KnowbaseItemCategory", {
      pai: "knowbaseitemcategories_id",
      chave: (r) => `${r.entities_id}|${r.completename ?? r.name}`,
      campos: (r) => ({
        name: r.name,
        entities_id: traduzir("Entity", r.entities_id),
        knowbaseitemcategories_id: traduzir("KnowbaseItemCategory", r.knowbaseitemcategories_id),
        is_recursive: r.is_recursive ?? 0,
      }),
    });

    await copiar("KnowbaseItem", {
      chave: (r) => String(r.name ?? "").trim(),
      campos: (r) => ({
        name: r.name,
        answer: r.answer ?? "",
        is_faq: r.is_faq ?? 0,
        knowbaseitemcategories_id: traduzir("KnowbaseItemCategory", r.knowbaseitemcategories_id),
      }),
    });
  } finally {
    await prod.encerrarSessao();
    await alvo.encerrarSessao();
  }
}

principal().catch((erro) => {
  console.error(String(erro));
  process.exitCode = 1;
});
