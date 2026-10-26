"use strict";

const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );

const MOTIVOS = [
  ["falta", "Falta"],
  ["danificado", "Item danificado"],
  ["sem_validade", "Sem validade"],
  ["validade_prox", "Validade próxima"],
  ["codigo_incorreto", "Código incorreto"],
  ["sobra", "Sobra"],
];

let imagens = []; // File/Blob do print
let itens = []; // itens divergentes
let fornecedor = ""; // código do fornecedor lido do print
let empresaSugerida = "";
let ultimo = null; // dados da última geração (para salvar)

// ------------------------------------------------------------ memória / topo
async function carregarMemoria() {
  try {
    const m = await (await fetch("/api/memoria")).json();
    $("planilha").textContent = "Planilha: " + m.caminho_planilha;
    $("listaEmpresas").innerHTML = m.empresas
      .map((e) => `<option value="${esc(e)}">`)
      .join("");
    $("listaVendedores").innerHTML = m.vendedores
      .map((e) => `<option value="${esc(e)}">`)
      .join("");
  } catch {
    /* sem memória ainda */
  }
}

// ------------------------------------------------------------ 1. print
// ------------------------------------------------------------
// Seleção de múltiplas imagens
// ------------------------------------------------------------

function adicionarImagens(arquivos) {
    const novas = Array.from(arquivos || []).filter(
        file => file && file.type.startsWith("image/")
    );

    if (!novas.length) return;

    imagens.push(...novas);

    renderPreviews();

    $("btnLer").disabled = imagens.length === 0;

    $("msgOcr").textContent =
        `${imagens.length} imagem(ns) selecionada(s).`;
}

function renderPreviews() {
    $("previews").innerHTML = imagens.map((file, i) => `
        <div class="preview-item">
            <img
                src="${URL.createObjectURL(file)}"
                alt="Prévia da imagem ${i + 1}"
            >

            <div class="preview-info">
                <span>Imagem ${i + 1}</span>

                <button
                    type="button"
                    class="rm-imagem"
                    data-remover-imagem="${i}"
                    aria-label="Remover imagem ${i + 1}"
                >×</button>
            </div>

            <small>${esc(file.name || "Imagem colada")}</small>
        </div>
    `).join("");
}

// Remover uma imagem selecionada
$("previews").addEventListener("click", e => {
    const botao = e.target.closest("[data-remover-imagem]");

    if (!botao) return;

    imagens.splice(Number(botao.dataset.removerImagem), 1);

    renderPreviews();

    $("btnLer").disabled = imagens.length === 0;

    $("msgOcr").textContent = imagens.length
        ? `${imagens.length} imagem(ns) selecionada(s).`
        : "Nenhuma imagem selecionada.";
});

// Selecionar arquivos pelo clique
$("drop").addEventListener("click", e => {
    if (e.target.closest(".rm-imagem")) return;

    $("arquivo").click();
});

$("arquivo").addEventListener("change", e => {
    adicionarImagens(e.target.files);

    // Permite selecionar novamente o mesmo arquivo
    e.target.value = "";
});

// Arrastar e soltar imagens
$("drop").addEventListener("dragover", e => {
    e.preventDefault();
    $("drop").classList.add("over");
});

$("drop").addEventListener("dragleave", () => {
    $("drop").classList.remove("over");
});

$("drop").addEventListener("drop", e => {
    e.preventDefault();

    $("drop").classList.remove("over");

    adicionarImagens(e.dataTransfer.files);
});

// Colar imagens usando Ctrl + V
document.addEventListener("paste", e => {
    const arquivos = [];

    for (const item of e.clipboardData?.items || []) {
        if (item.type.startsWith("image/")) {
            arquivos.push(item.getAsFile());
        }
    }

    adicionarImagens(arquivos);
});

// ------------------------------------------------------------
// Ler todas as imagens
// ------------------------------------------------------------

$("btnLer").addEventListener("click", async () => {
    if (!imagens.length) return;

    $("btnLer").disabled = true;

    let todosItens = [];
    let nf = "";
    let forn = "";
    let empresa = "";

    const erros = [];

    try {
        for (let i = 0; i < imagens.length; i++) {
            $("msgOcr").textContent =
                `Lendo imagem ${i + 1} de ${imagens.length}...`;

            const fd = new FormData();
            const imagem = imagens[i];

            fd.append(
                "imagem",
                imagem,
                imagem.name || `print-${i + 1}.png`
            );

            try {
                const resposta = await fetch("/api/ocr", {
                    method: "POST",
                    body: fd
                });

                const dados = await resposta.json();

                if (!resposta.ok) {
                    throw new Error(
                        dados.erro || "Erro ao ler a imagem."
                    );
                }

                // Aproveita os dados identificados
                if (!nf) nf = dados.nf || "";
                if (!forn) forn = dados.fornecedor || "";

                if (!empresa) {
                    empresa = dados.empresa_sugerida || "";
                }

                // Acumula os itens de cada imagem
                todosItens.push(...(dados.itens || []));

            } catch (erro) {
                erros.push(
                    `Imagem ${i + 1}: ${erro.message}`
                );
            }
        }

        $("nf").value = nf;
        $("forn").value = forn;

        empresaSugerida = empresa;

        // Remove itens rigorosamente duplicados
        const vistos = new Set();

        const itensUnicos = todosItens.filter(item => {
            const chave = JSON.stringify([
                item.codigo,
                item.nome,
                item.lancada,
                item.conferida
            ]);

            if (vistos.has(chave)) return false;

            vistos.add(chave);
            return true;
        });

        itens = itensUnicos.map(novoItem);

        let mensagem = itens.length
            ? `${itens.length} item(ns) divergente(s) encontrado(s) em ${imagens.length} imagem(ns).`
            : "Não encontrei itens. Confira as imagens ou adicione os itens manualmente.";

        if (erros.length) {
            mensagem += " " + erros.join(" | ");
        }

        $("msgOcr").textContent = mensagem;

        $("secItens").hidden = false;
        $("secTextos").hidden = true;

        renderItens();

    } catch (erro) {
        $("msgOcr").textContent =
            erro.message || "Erro ao processar as imagens.";

    } finally {
        $("btnLer").disabled = imagens.length === 0;
    }
});

// ------------------------------------------------------------ 2. itens
function novoItem(i) {
  const dif = Math.abs((i.conferida ?? 0) - (i.lancada ?? 0));
  return {
    codigo: i.codigo || "",
    nome: i.nome || "",
    lancada: i.lancada ?? 0,
    conferida: i.conferida ?? 0,
    qtd: dif || 1,
    motivo: "",
    validade: "",
    // se o item estava na NF (lançada > 0) o código dele é o faturado (errado);
    // se só apareceu na conferência, é o correto.
    cod_errado: (i.lancada ?? 0) > 0 ? i.codigo || "" : "",
    cod_correto: (i.lancada ?? 0) > 0 ? "" : i.codigo || "",
  };
}

function renderItens() {
  $("itens").innerHTML = itens
    .map((it, n) => {
      const dif = it.conferida - it.lancada;
      const sug = dif > 0 ? "sobrou" : dif < 0 ? "faltou" : "";
      const aviso =
        it.codigo.length !== 13
          ? `<span class="aviso">Código com ${it.codigo.length} dígitos – confira</span>`
          : "";
      return `
    <div class="item ${it.motivo ? "pronto" : ""} ${it.motivo === "codigo_incorreto" ? "cod-inc" : ""}" data-n="${n}">
      <button class="rm" data-rm="${n}">remover</button>
      <div class="linha1">
        <label>Código <input data-f="codigo" value="${esc(it.codigo)}"></label>
        <label>Produto <input data-f="nome" value="${esc(it.nome)}"></label>
      </div>
      <div class="nums">
        <span>Lançada: <b>${it.lancada}</b></span>
        <span>Conferida: <b>${it.conferida}</b></span>
        ${sug ? `<span>(${sug} ${Math.abs(dif)})</span>` : ""}
        <label>Qtd. da divergência <input data-f="qtd" type="number" min="1" value="${it.qtd}"></label>
        ${aviso}
      </div>
      <div class="motivos">
        ${MOTIVOS.map(
          ([v, t]) => `
          <label><input type="radio" name="m${n}" value="${v}" ${it.motivo === v ? "checked" : ""}> ${t}</label>`,
        ).join("")}
      </div>
      


<div class="corrige">
  ${
    it.motivo === "validade_prox"
      ? `
    <label class="campo-validade">
      Validade do produto
      <input
        type="text"
        data-f="validade"
        value="${esc(it.validade || "")}"
        required
      >
    </label>
  `
      : ""
  }

  ${
    it.motivo === "codigo_incorreto"
      ? `
    <label>
      Cód. faturado (errado)
      <input data-f="cod_errado" value="${esc(it.cod_errado)}">
    </label>
    <label>
      Cód. correto
      <input data-f="cod_correto" value="${esc(it.cod_correto)}">
    </label>
  `
      : ""
  }
</div>


    </div>`;
    })
    .join("");
  atualizarOk();
}

$("itens").addEventListener("input", (e) => {
  const f = e.target.dataset.f;
  if (!f) return;
  const n = +e.target.closest(".item").dataset.n;
  itens[n][f] =
    f === "qtd" ? Math.max(1, parseInt(e.target.value) || 1) : e.target.value;
  atualizarOk();
});

$("itens").addEventListener("change", (e) => {
  if (e.target.type !== "radio") return;
  const box = e.target.closest(".item");
  const n = +box.dataset.n;
  itens[n].motivo = e.target.value;
  box.classList.add("pronto");
  box.classList.toggle("cod-inc", e.target.value === "codigo_incorreto");
  atualizarOk();
  renderItens();
});

$("itens").addEventListener("click", (e) => {
  if (e.target.dataset.rm === undefined) return;
  itens.splice(+e.target.dataset.rm, 1);
  renderItens();
});

$("btnAdd").addEventListener("click", () => {
  itens.push(novoItem({ lancada: 0, conferida: 1 }));
  renderItens();
});

function atualizarOk() {
  const ok = itens.length > 0 && itens.every((i) => i.motivo);
  $("btnOk").disabled = !ok;
  const faltam = itens.filter((i) => !i.motivo).length;
  $("msgItens").textContent = !itens.length
    ? "Nenhum item."
    : faltam
      ? `Faltam ${faltam} item(ns) sem motivo.`
      : "Tudo marcado.";
}

// ------------------------------------------------------------ 3. empresa + textos
$("btnOk").addEventListener("click", () => {
  if (!$("nf").value.trim()) {
    $("msgItens").textContent = "Informe o número da NF.";
    $("nf").focus();
    return;
  }
  const semCod = itens.find(
    (i) =>
      i.motivo === "codigo_incorreto" &&
      (!i.cod_errado.trim() || !i.cod_correto.trim()),
  );
  if (semCod) {
    $("msgItens").textContent = `Preencha os dois códigos de "${semCod.nome}".`;
    return;
  }

  const itemValidadeIncorreta = itens.find(
    (i) => i.motivo === "validade_prox" && !i.validade,
  );

  if (itemValidadeIncorreta) {
    $("msgItens").textContent =
      `Selecione a validade do produto "${itemValidadeIncorreta.nome}".`;
    return;
  }

  $("empresa").value = empresaSugerida;
  $("data").value = new Date().toLocaleDateString("sv-SE"); // aaaa-mm-dd no fuso local
  $("dlg").showModal();
  $("empresa").focus();
});

$("dlg").addEventListener("close", () => {
  if ($("dlg").returnValue !== "ok") return;
  gerarTextos();
});

function saudacao() {
  const h = new Date().getHours(); // hora do computador
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

const nomeMin = (s) => s.trim().toLowerCase();

function linhaMotivo(it) {
  const q = it.qtd,
    um = q === 1;
  switch (it.motivo) {
    case "sobra":
      return um ? "veio 1un a mais" : `vieram ${q} a mais`;
    case "falta":
      return um ? "faltou 1un" : `faltaram ${q}un`;
    case "danificado":
      return um ? "veio 1un danificado" : `vieram ${q}un danificados`;
    case "sem_validade":
      return um ? "veio 1un sem validade" : `vieram ${q}un sem validade`;
    case "validade_prox":
      return `${q}un c/validade ${it.validade || "NÃO INFORMADA"}`;

    default:
      return "";
  }
}

function gerarTextos() {
  const empresa = $("empresa").value.trim();
  const nf = $("nf").value.trim();
  const emp = empresa.toLowerCase();
  const s = saudacao();

  const normais = itens.filter((i) => i.motivo !== "codigo_incorreto");
  const cartas = itens.filter((i) => i.motivo === "codigo_incorreto");

  $("boxDiv").hidden = !normais.length;
  if (normais.length) {
    $("txtDiv").value =
      `${s}, tudo bem? teve divergencia na nf ${nf} da ${emp}\n\n` +
      normais
        .map((i) => `${nomeMin(i.nome)} cod ${i.codigo}\n${linhaMotivo(i)}`)
        .join("\n\n");
  }

  $("boxCarta").hidden = !cartas.length;
  if (cartas.length) {
    $("txtCarta").value =
      `${s}, tudo bem?\n\npreciso que emita uma carta de correçao para a nf ${nf} da ${emp} para os seguintes itens:\n\n` +
      cartas
        .map(
          (i) =>
            `${nomeMin(i.nome)} veio faturado com o cod ${i.cod_errado.trim()} preciso que corrija para o cod ${i.cod_correto.trim()}`,
        )
        .join("\n\n");
  }

  ultimo = {
    empresa,
    nf,
    vendedor: $("vendedor").value.trim(),
    data: $("data").value,
    fornecedor: $("forn").value.trim(),
    itens: itens.map((i) => ({ ...i })),
  };
  $("msgSalvar").textContent = "";
  $("msgSalvar").className = "";
  $("btnSalvar").disabled = false;
  $("secTextos").hidden = false;
  $("secTextos").scrollIntoView({ behavior: "smooth" });
}

document.addEventListener("click", async (e) => {
  if (!e.target.classList.contains("copy")) return;
  const ta = $(e.target.dataset.alvo);
  try {
    await navigator.clipboard.writeText(ta.value);
  } catch {
    ta.select();
    document.execCommand("copy");
  }
  const t = e.target.textContent;
  e.target.textContent = "Copiado ✓";
  setTimeout(() => (e.target.textContent = t), 1500);
});

// ------------------------------------------------------------ planilha
async function salvar(forcar = false) {
  const msg = $("msgSalvar");
  msg.className = "";
  msg.textContent = "Salvando…";
  // se o usuário editou os textos, nada disso vai para a planilha; só os dados.
  try {
    const r = await fetch("/api/salvar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...ultimo, forcar }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.erro || "Erro ao salvar.");
    if (d.duplicada) {
      if (
        confirm(
          `Já existe uma linha com essa NF neste mês:\n${d.existente}\n\nLançar mesmo assim?`,
        )
      )
        return salvar(true);
      msg.textContent = "Cancelado.";
      return;
    }
    msg.className = "ok";
    msg.textContent = `Salvo na aba ${d.aba}, linha ${d.linha}.`;
    $("btnSalvar").disabled = true;
    carregarMemoria();
  } catch (err) {
    msg.className = "erro";
    msg.textContent = err.message;
  }
}

$("btnSalvar").addEventListener("click", () => salvar(false));

$("btnNovo").addEventListener("click", () => {
    imagens = [];
    itens = [];
    ultimo = null;

    $("previews").innerHTML = "";
    $("arquivo").value = "";

    $("btnLer").disabled = true;
    $("msgOcr").textContent = "";

    $("nf").value = "";
    $("forn").value = "";

    empresaSugerida = "";

    $("secItens").hidden = true;
    $("secTextos").hidden = true;

    window.scrollTo({
        top: 0,
        behavior: "smooth"
    });
});

carregarMemoria();


/* ===== CONSULTA E ACOMPANHAMENTO DE DIVERGÊNCIAS ===== */

let divergenciaSelecionada = null;

function escaparHTML(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

async function carregarDivergencias() {
  const mensagem = $("consultaMensagem");
  const tabela = $("tabelaDivergencias");

  mensagem.textContent = "Carregando divergências...";
  tabela.innerHTML = '<tr><td colspan="6">Carregando...</td></tr>';

  const parametros = new URLSearchParams();

  const filtros = {
    data_inicio: $("filtroDataInicio").value,
    data_fim: $("filtroDataFim").value,
    empresa: $("filtroEmpresa").value.trim(),
    vendedor: $("filtroVendedor").value.trim(),
    status: $("filtroStatus").value,
  };

  for (const [chave, valor] of Object.entries(filtros)) {
    if (valor) parametros.set(chave, valor);
  }

  try {
    const resposta = await fetch(
      `/api/divergencias?${parametros.toString()}`
    );
    const registros = await resposta.json();

    if (!resposta.ok) {
      throw new Error(registros.erro || "Não foi possível consultar.");
    }

    if (!Array.isArray(registros) || registros.length === 0) {
      tabela.innerHTML =
        '<tr><td colspan="6">Nenhuma divergência encontrada.</td></tr>';
      mensagem.textContent = "Nenhum registro encontrado.";
      return;
    }

    tabela.innerHTML = registros.map((registro) => {
      const data = escaparHTML(
        String(registro.data_registro || "").slice(0, 10)
      );
      const empresa = escaparHTML(registro.empresa);
      const vendedor = escaparHTML(registro.vendedor);
      const nf = escaparHTML(registro.nf);
      const status = registro.status === "OK" ? "OK" : "PENDENTE";
      const classe = status === "OK" ? "ok" : "pendente";

      return `
        <tr>
          <td>${data}</td>
          <td>${empresa}</td>
          <td>${vendedor}</td>
          <td>${nf}</td>
          <td><span class="${classe}">${status}</span></td>
          <td>
            <button type="button" data-ver="${Number(registro.id)}">
              Ver detalhes
            </button>
          </td>
        </tr>
      `;
    }).join("");

    // Os IDs vêm do banco e são convertidos para números.
    tabela.querySelectorAll("[data-ver]").forEach((botao) => {
      botao.addEventListener("click", () => {
        const id = Number(botao.dataset.ver);
        const registro = registros.find((r) => Number(r.id) === id);
        if (registro) abrirDetalheDivergencia(registro);
      });
    });

    mensagem.textContent = `${registros.length} divergência(s) encontrada(s).`;
  } catch (erro) {
    tabela.innerHTML =
      '<tr><td colspan="6">Erro ao carregar os registros.</td></tr>';
    mensagem.textContent = erro.message;
  }
}

function abrirDetalheDivergencia(registro) {
  divergenciaSelecionada = registro;

  const painel = $("detalheDivergencia");
  const conteudo = $("detalheConteudo");
  const dados = registro.dados || {};
  const listaItens = Array.isArray(dados.itens) ? dados.itens : [];

  const linhasItens = listaItens.map((item) => `
    <tr>
      <td>${escaparHTML(item.nome || item.descricao || "")}</td>
      <td>${escaparHTML(item.codigo || item.cod_correto || "")}</td>
      <td>${escaparHTML(item.qtd ?? "")}</td>
      <td>${escaparHTML(item.conferida ?? "")}</td>
      <td>${escaparHTML(item.lancada ?? "")}</td>
      <td>${escaparHTML(item.motivo || "")}</td>
    </tr>
  `).join("");

  conteudo.innerHTML = `
    <p><strong>Empresa:</strong> ${escaparHTML(registro.empresa)}</p>
    <p><strong>Vendedor:</strong> ${escaparHTML(registro.vendedor)}</p>
    <p><strong>Nota fiscal:</strong> ${escaparHTML(registro.nf)}</p>
    <p><strong>Fornecedor:</strong> ${escaparHTML(registro.fornecedor)}</p>
    <p><strong>Status:</strong> ${escaparHTML(registro.status)}</p>
    <p><strong>Solução registrada:</strong> ${escaparHTML(registro.solucao || "Nenhuma")}</p>

    <h4>Itens da conferência</h4>
    <div style="overflow-x:auto">
      <table style="width:100%; border-collapse:collapse">
        <thead>
          <tr>
            <th>Item</th>
            <th>Código</th>
            <th>Quantidade</th>
            <th>Conferida</th>
            <th>Lançada</th>
            <th>Motivo</th>
          </tr>
        </thead>
        <tbody>
          ${linhasItens || '<tr><td colspan="6">Nenhum item disponível.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  $("solucaoDivergencia").value = registro.solucao || "";
  $("detalheMensagem").textContent = "";
  $("btnReabrirDivergencia").disabled = registro.status !== "OK";
  $("btnResolverDivergencia").disabled = registro.status === "OK";

  painel.hidden = false;
  painel.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function atualizarStatusDivergencia(novoStatus) {
  if (!divergenciaSelecionada) return;

  const solucao = $("solucaoDivergencia").value.trim();
  const mensagem = $("detalheMensagem");

  if (novoStatus === "OK" && !solucao) {
    mensagem.textContent =
      "Descreva como a divergência foi resolvida antes de continuar.";
    return;
  }

  if (novoStatus === "PENDENTE" &&
      !confirm("Deseja reabrir esta divergência?")) {
    return;
  }

  mensagem.textContent = "Salvando alterações...";

  try {
    const resposta = await fetch(
      `/api/divergencias/${Number(divergenciaSelecionada.id)}/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: novoStatus,
          solucao: novoStatus === "OK" ? solucao : "",
        }),
      }
    );

    const resultado = await resposta.json();

    if (!resposta.ok) {
      throw new Error(resultado.erro || "Não foi possível atualizar.");
    }

    mensagem.textContent = "Alterações salvas no banco de dados.";

    await carregarDivergencias();

    const consultaAtualizada = await fetch(
      `/api/divergencias?status=${novoStatus}`
    );
    const registrosAtualizados = await consultaAtualizada.json();

    const atualizado = Array.isArray(registrosAtualizados)
      ? registrosAtualizados.find(
          (r) => Number(r.id) === Number(divergenciaSelecionada.id)
        )
      : null;

    if (atualizado) {
      abrirDetalheDivergencia(atualizado);
      $("detalheMensagem").textContent = "Alterações salvas com sucesso.";
    } else {
      $("detalheDivergencia").hidden = true;
      divergenciaSelecionada = null;
    }
  } catch (erro) {
    mensagem.textContent = `Erro: ${erro.message}`;
  }
}

$("btnFiltrarDivergencias").addEventListener(
  "click",
  carregarDivergencias
);

$("btnAtualizarDivergencias").addEventListener(
  "click",
  carregarDivergencias
);

$("btnLimparFiltros").addEventListener("click", () => {
  $("filtroDataInicio").value = "";
  $("filtroDataFim").value = "";
  $("filtroEmpresa").value = "";
  $("filtroVendedor").value = "";
  $("filtroStatus").value = "";
  carregarDivergencias();
});

$("btnResolverDivergencia").addEventListener("click", () => {
  atualizarStatusDivergencia("OK");
});

$("btnReabrirDivergencia").addEventListener("click", () => {
  atualizarStatusDivergencia("PENDENTE");
});

$("btnFecharDetalhe").addEventListener("click", () => {
  $("detalheDivergencia").hidden = true;
  divergenciaSelecionada = null;
});



const modalConsulta = $("modalConsulta");
const btnAbrirConsulta = $("btnAbrirConsulta");
const btnFecharConsulta = $("btnFecharConsulta");

btnAbrirConsulta.addEventListener("click", async () => {
  if (!modalConsulta.open) {
    modalConsulta.showModal();
    await carregarDivergencias();
  }
});

btnFecharConsulta.addEventListener("click", () => {
  modalConsulta.close();
});

// Fecha ao clicar fora da janela
modalConsulta.addEventListener("click", (event) => {
  if (event.target === modalConsulta) {
    modalConsulta.close();
  }
});

// Fecha com a tecla Esc
modalConsulta.addEventListener("close", () => {
  btnAbrirConsulta.focus();
});





