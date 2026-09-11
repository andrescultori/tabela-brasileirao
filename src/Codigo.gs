/**
 * ============================================================
 * BRASILEIRÃO SÉRIE A — Apps Script
 * Fonte de dados: football-data.org (plano gratuito, API v4)
 * ============================================================
 *
 * COMO CONFIGURAR (fazer 1 vez):
 * 1. Crie uma conta gratuita em https://www.football-data.org/client/register
 *    Você receberá um token (X-Auth-Token) por e-mail.
 * 2. No editor do Apps Script, selecione a função "configurarToken" no
 *    menu suspenso ao lado do botão "Executar" e clique em Executar.
 *    (Vai pedir autorização na primeira vez — normal.)
 *    Isso guarda o token com segurança nas Propriedades do Script
 *    (não fica exposto no código).
 * 3. Volte para a planilha e recarregue a página. Vai aparecer um menu
 *    novo "Brasileirão" com as opções:
 *       - Popular tabela (novo campeonato)
 *       - Atualizar resultados agora
 *       - Recalcular classificação
 *       - Calcular probabilidades (Monte Carlo)
 *       - Atualizar Perfil de Time
 *       - Ativar atualização automática diária
 *
 * ABAS GERADAS AUTOMATICAMENTE PELO SCRIPT (não precisa criar à mão):
 *  - "Classificação": tabela ordenada com pontos, saldo, pontuação final
 *    prevista, últimos 5 jogos e próximos 5 confrontos de cada time.
 *  - "PERFIL DE TIME": dropdown pra escolher um time e ver posição atual,
 *    estatísticas casa/fora e histórico completo de jogos dele.
 *
 * ESTRUTURA ESPERADA DA PLANILHA (linha 1 = cabeçalho, dados a partir da linha 2):
 * A: Rodada | B: Time da Casa | C: Gols Casa | D: Gols Fora | E: Time Visitante
 * ============================================================
 */

// ---------- CONFIGURAÇÃO ----------
const CONFIG = {
  SHEET_NAME: 'Tabela',        // <-- ajuste para o nome real da sua aba
  COMPETITION_CODE: 'BSA',     // Brasileirão Série A na football-data.org
  API_BASE: 'https://api.football-data.org/v4',
  COL: { RODADA: 1, CASA: 2, GOLS_CASA: 3, GOLS_FORA: 4, VISITANTE: 5 },
  FIRST_DATA_ROW: 2,
  DAILY_TRIGGER_HOUR: 8, // hora (0-23) em que a atualização automática roda
  CLASSIFICACAO_SHEET_NAME: 'Classificação', // aba onde a tabela de classificação será escrita
  PERFIL_SHEET_NAME: 'PERFIL DE TIME',       // aba com o histórico e estatísticas de um time específico

  // --- Faixas de posição para o rótulo de situação na aba Perfil de Time ---
  ZONAS: {
    LIDER: 1,                 // só a 1ª posição
    LIBERTADORES: [2, 5],
    SULAMERICANA: [6, 11],
    REBAIXAMENTO: [17, 20]
    // posições fora dessas faixas (12-16) ficam sem rótulo de zona ("Meio de Tabela")
  },

  // --- Parâmetros da projeção "Pontuação Final Prevista" ---
  PROJECAO: {
    PESO_APROVEITAMENTO: 0.5,  // peso do aproveitamento (%) no índice de força
    PESO_SALDO: 0.5,           // peso do saldo de gols por jogo no índice de força
    SALDO_REFERENCIA: 2,       // saldo por jogo que equivale a força máxima (±1.0) na normalização
    BONUS_MANDANTE: 0.10,      // bônus somado à força do time da casa
    LIMIAR_EMPATE: 0.30        // diferença de força (após bônus de mando) dentro da qual o jogo é considerado empate
  },

  // --- Parâmetros da simulação Monte Carlo (probabilidades de título/Libertadores/rebaixamento) ---
  MONTE_CARLO: {
    SIMULACOES: 1000,
    VAGAS_LIBERTADORES: 6,   // 4 fase de grupos + 2 pré-Libertadores
    VAGAS_REBAIXAMENTO: 4,
    PROB_EMPATE_BASE: 0.27,  // taxa histórica aproximada de empates no Brasileirão
    PROB_EMPATE_MIN: 0.12,   // piso: mesmo com diferença grande de força, sempre existe alguma chance de empate
    INCLINACAO_LOGISTICA: 4  // controla o quão rápido a vantagem de força vira favoritismo (maior = mais "decisivo")
  }
};

// ---------- SETUP DO TOKEN (rodar manualmente 1 vez) ----------
function configurarToken() {
  const ui = SpreadsheetApp.getUi();
  const resposta = ui.prompt(
    'Configurar token da API',
    'Cole aqui o seu X-Auth-Token da football-data.org:',
    ui.ButtonSet.OK_CANCEL
  );
  if (resposta.getSelectedButton() !== ui.Button.OK) return;
  const token = resposta.getResponseText().trim();
  if (!token) {
    ui.alert('Nenhum token informado. Nada foi salvo.');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('FOOTBALL_API_TOKEN', token);
  ui.alert('Token salvo com sucesso!');
}

// ---------- MENU ----------
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Brasileirão')
    .addItem('Popular tabela (novo campeonato)', 'popularTabela')
    .addItem('Atualizar resultados agora', 'atualizarResultados')
    .addItem('Recalcular classificação', 'calcularClassificacao')
    .addItem('Calcular probabilidades (Monte Carlo)', 'calcularProbabilidades')
    .addItem('Atualizar Perfil de Time', 'atualizarPerfilTime')
    .addSeparator()
    .addItem('Ativar atualização automática diária', 'ativarTriggerDiario')
    .addItem('Configurar token da API', 'configurarToken')
    .addToUi();
}

/**
 * Trigger simples (dispara sozinho, sem precisar instalar nada): sempre que
 * a célula do dropdown de time na aba Perfil for alterada, atualiza a aba
 * na hora — sem precisar passar pelo menu.
 */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.PERFIL_SHEET_NAME) return;
  if (e.range.getA1Notation() !== 'B1') return; // célula do dropdown

  atualizarPerfilTime();
}

// ---------- FUNÇÃO 1: POPULAR A TABELA ----------
/**
 * Busca todos os jogos da temporada atual do Brasileirão e reescreve a
 * planilha do zero: Rodada | Time da Casa | (vazio) | (vazio) | Time Visitante
 * Use no início do campeonato, depois que a tabela básica (confrontos) é
 * divulgada pela CBF/API.
 */
function popularTabela() {
  const matches = buscarPartidas(); // todas as partidas da temporada
  if (!matches.length) {
    SpreadsheetApp.getUi().alert('Nenhuma partida encontrada na API. Verifique o token e tente novamente.');
    return;
  }

  // Ordena por rodada e depois por data, para ficar na ordem "natural"
  matches.sort((a, b) => {
    if (a.matchday !== b.matchday) return a.matchday - b.matchday;
    return new Date(a.utcDate) - new Date(b.utcDate);
  });

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow >= CONFIG.FIRST_DATA_ROW) {
    sheet.getRange(CONFIG.FIRST_DATA_ROW, 1, lastRow - CONFIG.FIRST_DATA_ROW + 1, 5).clearContent();
  }

  const linhas = matches.map(m => [
    m.matchday,
    nomeTime_(m.homeTeam),
    '', // gols casa em branco
    '', // gols fora em branco
    nomeTime_(m.awayTeam)
  ]);

  sheet.getRange(CONFIG.FIRST_DATA_ROW, 1, linhas.length, 5).setValues(linhas);

  SpreadsheetApp.getUi().alert('Tabela populada com ' + linhas.length + ' jogos.');

  // Já aproveita e preenche os resultados de jogos que já aconteceram
  atualizarResultados();
}

// ---------- FUNÇÃO 2: ATUALIZAR RESULTADOS DIARIAMENTE ----------
/**
 * Busca jogos já encerrados (status FINISHED) e preenche o placar na
 * linha correspondente (mesma rodada + mesmo confronto). Não sobrescreve
 * uma linha que já tem placar preenchido igual ao da API (evita reescritas
 * desnecessárias); mas corrige se o placar salvo estiver diferente
 * (ex: jogo tinha sido dado como WO e depois foi corrigido).
 */
function atualizarResultados() {
  const finalizados = buscarPartidas({ status: 'FINISHED' });
  if (!finalizados.length) return;

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.FIRST_DATA_ROW) return;

  const range = sheet.getRange(CONFIG.FIRST_DATA_ROW, 1, lastRow - CONFIG.FIRST_DATA_ROW + 1, 5);
  const valores = range.getValues();

  let atualizados = 0;

  finalizados.forEach(m => {
    const casa = nomeTime_(m.homeTeam);
    const fora = nomeTime_(m.awayTeam);
    const golsCasa = m.score && m.score.fullTime ? m.score.fullTime.home : null;
    const golsFora = m.score && m.score.fullTime ? m.score.fullTime.away : null;
    if (golsCasa === null || golsFora === null) return; // sem placar definitivo ainda

    for (let i = 0; i < valores.length; i++) {
      const linha = valores[i];
      const mesmaRodada = Number(linha[CONFIG.COL.RODADA - 1]) === Number(m.matchday);
      const mesmoConfronto =
        normalizar_(linha[CONFIG.COL.CASA - 1]) === normalizar_(casa) &&
        normalizar_(linha[CONFIG.COL.VISITANTE - 1]) === normalizar_(fora);

      if (mesmaRodada && mesmoConfronto) {
        const golsCasaAtual = linha[CONFIG.COL.GOLS_CASA - 1];
        const golsForaAtual = linha[CONFIG.COL.GOLS_FORA - 1];
        if (golsCasaAtual !== golsCasa || golsForaAtual !== golsFora) {
          valores[i][CONFIG.COL.GOLS_CASA - 1] = golsCasa;
          valores[i][CONFIG.COL.GOLS_FORA - 1] = golsFora;
          atualizados++;
        }
        break;
      }
    }
  });

  if (atualizados > 0) {
    range.setValues(valores);
  }

  // Classificação sempre recalculada, mesmo que nada tenha mudado hoje
  // (garante que a tabela fique consistente mesmo após edições manuais de placar)
  calcularClassificacao();

  // Mantém o Perfil de Time em dia também, se a aba já existir e já tiver
  // um time selecionado no dropdown (não força a criação da aba aqui)
  atualizarPerfilTime();

  // Se rodado manualmente pelo menu, avisa o usuário; se rodado pelo trigger, não incomoda ninguém
  try {
    SpreadsheetApp.getUi().alert(atualizados + ' resultado(s) atualizado(s).');
  } catch (e) {
    // getUi() falha quando a função roda por trigger automático — ignore
    Logger.log(atualizados + ' resultado(s) atualizado(s).');
  }
}

// ---------- FUNÇÃO 3: CLASSIFICAÇÃO ----------
/**
 * Lê todos os jogos já com placar preenchido na aba de tabela e escreve
 * a classificação (pontos, jogos, V/E/D, gols, saldo) na aba definida em
 * CONFIG.CLASSIFICACAO_SHEET_NAME, já ordenada pelos critérios padrão:
 * pontos > saldo de gols > gols pró > vitórias.
 * Cria a aba automaticamente se ela ainda não existir.
 */
function calcularClassificacao() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < CONFIG.FIRST_DATA_ROW) return;

  const dados = sheet
    .getRange(CONFIG.FIRST_DATA_ROW, 1, lastRow - CONFIG.FIRST_DATA_ROW + 1, 5)
    .getValues();

  // Acumula estatísticas por time e ordena pelos critérios padrão
  const times = computarTimes_(dados);
  const classificacao = ordenarClassificacao_(times);

  // Pontuação Final Prevista: pontos atuais + simulação dos jogos restantes
  // com base no índice de força de cada time (aproveitamento + saldo por jogo).
  const pontosPrevistos = calcularProjecaoFinal_(classificacao, dados);

  // Pega (ou cria) a aba de classificação
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let destino = ss.getSheetByName(CONFIG.CLASSIFICACAO_SHEET_NAME);
  if (!destino) {
    destino = ss.insertSheet(CONFIG.CLASSIFICACAO_SHEET_NAME);
  }
  destino.clearContents();

  const cabecalho = [
    'Pos', 'Time', 'Pontos', 'Jogos', 'V', 'E', 'D', 'Gols Pró', 'Gols Contra', 'Saldo',
    'Dif. Líder', 'Dif. Reb.',
    'Aprov.', 'Previsão Pontos',
    'Jogo -5', 'Jogo -4', 'Jogo -3', 'Jogo -2', 'Jogo -1',
    'Próx. 1', 'Próx. 2', 'Próx. 3', 'Próx. 4', 'Próx. 5', 'Força Próx. 5'
  ];

  const totalTimes = classificacao.length;
  const posicaoPorTime = {};
  classificacao.forEach((t, i) => { posicaoPorTime[t.time] = i + 1; });

  const pontosLider = classificacao.length ? classificacao[0].pontos : 0;
  // Posição 17 = primeiro time dentro da zona de rebaixamento (Z4) num campeonato de 20 times
  const pontosZonaRebaixamento = classificacao.length >= 17 ? classificacao[16].pontos : null;

  const linhas = classificacao.map((t, i) => {
    const proximosDetalhados = obterProximosJogosDetalhados_(t.time, dados);
    const proximosTextos = proximosDetalhados.map(j => j.texto);
    while (proximosTextos.length < 5) proximosTextos.push('');

    // Força da sequência: soma, pra cada um dos próximos adversários, de
    // (totalTimes - posição do adversário + 1) — quanto mais alto, mais
    // dura é a sequência (adversários bem colocados na tabela pesam mais)
    const forcaSequencia = proximosDetalhados.reduce((soma, j) => {
      const posAdversario = posicaoPorTime[j.adversario];
      return posAdversario ? soma + (totalTimes - posAdversario + 1) : soma;
    }, 0);

    return [
      i + 1,
      t.time,
      t.pontos,
      t.jogos,
      t.v,
      t.e,
      t.d,
      t.golsPro,
      t.golsContra,
      t.golsPro - t.golsContra,
      pontosLider - t.pontos,
      pontosZonaRebaixamento === null ? '' : (t.pontos - pontosZonaRebaixamento),
      t.jogos > 0 ? (t.pontos / (t.jogos * 3)) : 0,
      pontosPrevistos[t.time],
      ...obterUltimos5_(t.time, dados),
      ...proximosTextos,
      proximosDetalhados.length > 0 ? forcaSequencia : ''
    ];
  });

  destino.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]).setFontWeight('bold');
  if (linhas.length > 0) {
    destino.getRange(2, 1, linhas.length, cabecalho.length).setValues(linhas);

    // Formata a coluna Aproveitamento como porcentagem (respeita vírgula/ponto
    // conforme a localização da planilha, em vez de escrever texto fixo)
    const colAproveitamento = cabecalho.indexOf('Aprov.') + 1;
    destino.getRange(2, colAproveitamento, linhas.length, 1).setNumberFormat('0.0%');
  }
}

// ---------- HELPERS DE CLASSIFICAÇÃO ----------
/**
 * Recebe um array de linhas de jogos (formato da aba Tabela) e retorna um
 * dicionário { nomeTime: {pontos, jogos, v, e, d, golsPro, golsContra} },
 * considerando apenas os jogos que já têm placar preenchido.
 */
function computarTimes_(linhasJogos) {
  const times = {};

  function garantirTime_(nome) {
    if (!times[nome]) {
      times[nome] = { time: nome, pontos: 0, jogos: 0, v: 0, e: 0, d: 0, golsPro: 0, golsContra: 0 };
    }
    return times[nome];
  }

  linhasJogos.forEach(linha => {
    const casa = linha[CONFIG.COL.CASA - 1];
    const visitante = linha[CONFIG.COL.VISITANTE - 1];
    const golsCasa = linha[CONFIG.COL.GOLS_CASA - 1];
    const golsFora = linha[CONFIG.COL.GOLS_FORA - 1];

    if (golsCasa === '' || golsFora === '' || golsCasa === null || golsFora === null) return;
    if (!casa || !visitante) return;

    const gc = Number(golsCasa);
    const gf = Number(golsFora);

    const statsCasa = garantirTime_(casa);
    const statsFora = garantirTime_(visitante);

    statsCasa.jogos++;
    statsFora.jogos++;
    statsCasa.golsPro += gc;
    statsCasa.golsContra += gf;
    statsFora.golsPro += gf;
    statsFora.golsContra += gc;

    if (gc > gf) {
      statsCasa.pontos += 3;
      statsCasa.v++;
      statsFora.d++;
    } else if (gc < gf) {
      statsFora.pontos += 3;
      statsFora.v++;
      statsCasa.d++;
    } else {
      statsCasa.pontos += 1;
      statsFora.pontos += 1;
      statsCasa.e++;
      statsFora.e++;
    }
  });

  return times;
}

/** Ordena o dicionário de times pelos critérios padrão: pontos > saldo > gols pró > vitórias. */
function ordenarClassificacao_(times) {
  return Object.values(times).sort((a, b) => {
    const saldoA = a.golsPro - a.golsContra;
    const saldoB = b.golsPro - b.golsContra;
    if (b.pontos !== a.pontos) return b.pontos - a.pontos;
    if (saldoB !== saldoA) return saldoB - saldoA;
    if (b.golsPro !== a.golsPro) return b.golsPro - a.golsPro;
    return b.v - a.v;
  });
}

/** Retorna array com 5 posições ['V'/'E'/'D'/''], do jogo mais antigo (índice 0) pro mais recente (índice 4). Preenche com '' à esquerda se o time ainda não tiver 5 jogos disputados. */
function obterUltimos5_(time, dados) {
  const jogos = dados
    .filter(l => l[CONFIG.COL.CASA - 1] === time || l[CONFIG.COL.VISITANTE - 1] === time)
    .filter(l => {
      const gc = l[CONFIG.COL.GOLS_CASA - 1];
      const gf = l[CONFIG.COL.GOLS_FORA - 1];
      return gc !== '' && gf !== '' && gc !== null && gf !== null;
    })
    .sort((a, b) => Number(a[CONFIG.COL.RODADA - 1]) - Number(b[CONFIG.COL.RODADA - 1]));

  const ultimos = jogos.slice(-5).map(l => {
    const ehCasa = l[CONFIG.COL.CASA - 1] === time;
    const gc = Number(l[CONFIG.COL.GOLS_CASA - 1]);
    const gf = Number(l[CONFIG.COL.GOLS_FORA - 1]);
    const golsTime = ehCasa ? gc : gf;
    const golsAdversario = ehCasa ? gf : gc;
    if (golsTime > golsAdversario) return 'V';
    if (golsTime < golsAdversario) return 'D';
    return 'E';
  });

  while (ultimos.length < 5) {
    ultimos.unshift(''); // preenche as posições mais antigas em branco se ainda não houver 5 jogos
  }

  return ultimos;
}

/**
 * Retorna array (até 5 itens) com os próximos confrontos ainda sem placar,
 * cada um como { texto: "Palmeiras (C)", adversario: "Palmeiras" } — o
 * texto vai pras colunas "Próximo 1..5" e o nome cru serve pra calcular a
 * força da sequência a partir da posição do adversário na tabela.
 */
function obterProximosJogosDetalhados_(time, dados) {
  return dados
    .filter(l => l[CONFIG.COL.CASA - 1] === time || l[CONFIG.COL.VISITANTE - 1] === time)
    .filter(l => {
      const gc = l[CONFIG.COL.GOLS_CASA - 1];
      const gf = l[CONFIG.COL.GOLS_FORA - 1];
      return gc === '' || gf === '' || gc === null || gf === null;
    })
    .sort((a, b) => Number(a[CONFIG.COL.RODADA - 1]) - Number(b[CONFIG.COL.RODADA - 1]))
    .slice(0, 5)
    .map(l => {
      const ehCasa = l[CONFIG.COL.CASA - 1] === time;
      const adversario = ehCasa ? l[CONFIG.COL.VISITANTE - 1] : l[CONFIG.COL.CASA - 1];
      return { texto: adversario + (ehCasa ? ' (C)' : ' (F)'), adversario: adversario };
    });
}

// ---------- PROJEÇÃO: PONTUAÇÃO FINAL PREVISTA ----------
/**
 * Calcula, para cada time, os pontos atuais + a soma dos pontos simulados
 * em cada jogo restante (ainda sem placar na aba Tabela).
 *
 * Método:
 * 1. Índice de força de cada time = média ponderada entre aproveitamento (%)
 *    e saldo de gols por jogo (normalizado). Reflete o estado ATUAL da
 *    tabela (não é recalculado à medida que jogos futuros são simulados).
 * 2. Para cada jogo restante, soma-se um bônus de mando de campo à força
 *    do time da casa e compara-se a diferença de força com um limiar:
 *    diferença pequena = empate, diferença grande = vitória do mais forte.
 *
 * @param {Array} classificacao - array de objetos {time, pontos, jogos, golsPro, golsContra, ...}
 * @param {Array} dados - linhas cruas da aba Tabela (Rodada, Casa, GolsCasa, GolsFora, Visitante)
 * @return {Object} mapa { nomeDoTime: pontosPrevistos }
 */
function calcularProjecaoFinal_(classificacao, dados) {
  const P = CONFIG.PROJECAO;

  // 1. Índice de força por time
  const forca = calcularForcaTimes_(classificacao);
  const pontosPrevistos = {};
  classificacao.forEach(t => {
    pontosPrevistos[t.time] = t.pontos; // ponto de partida: pontos já conquistados
  });

  // 2. Simula cada jogo ainda sem placar
  dados.forEach(linha => {
    const casa = linha[CONFIG.COL.CASA - 1];
    const visitante = linha[CONFIG.COL.VISITANTE - 1];
    const golsCasa = linha[CONFIG.COL.GOLS_CASA - 1];
    const golsFora = linha[CONFIG.COL.GOLS_FORA - 1];
    const jaTemPlacar = !(golsCasa === '' || golsFora === '' || golsCasa === null || golsFora === null);

    if (jaTemPlacar || !casa || !visitante) return;
    if (forca[casa] === undefined || forca[visitante] === undefined) return; // segurança

    const forcaCasaAjustada = forca[casa] + P.BONUS_MANDANTE;
    const diferenca = forcaCasaAjustada - forca[visitante];

    if (diferenca > P.LIMIAR_EMPATE) {
      pontosPrevistos[casa] += 3;
    } else if (diferenca < -P.LIMIAR_EMPATE) {
      pontosPrevistos[visitante] += 3;
    } else {
      pontosPrevistos[casa] += 1;
      pontosPrevistos[visitante] += 1;
    }
  });

  return pontosPrevistos;
}

function clamp_(valor, min, max) {
  return Math.max(min, Math.min(max, valor));
}

/**
 * Índice de força de cada time = média ponderada entre aproveitamento (%)
 * e saldo de gols por jogo (normalizado). Usado tanto pela Pontuação Final
 * Prevista (determinística) quanto pela simulação Monte Carlo (probabilística).
 */
function calcularForcaTimes_(classificacao) {
  const P = CONFIG.PROJECAO;
  const forca = {};
  classificacao.forEach(t => {
    const aproveitamento = t.jogos > 0 ? t.pontos / (t.jogos * 3) : 0;
    const saldoPorJogo = t.jogos > 0 ? (t.golsPro - t.golsContra) / t.jogos : 0;
    const saldoNormalizado = clamp_(saldoPorJogo / P.SALDO_REFERENCIA, -1, 1);
    forca[t.time] = P.PESO_APROVEITAMENTO * aproveitamento + P.PESO_SALDO * saldoNormalizado;
  });
  return forca;
}

// ---------- TRIGGER DIÁRIO ----------
function ativarTriggerDiario() {
  // remove triggers antigos da mesma função para não duplicar
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'atualizarResultados') {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger('atualizarResultados')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.DAILY_TRIGGER_HOUR)
    .create();

  SpreadsheetApp.getUi().alert(
    'Atualização automática ativada! Vai rodar todo dia por volta das ' +
    CONFIG.DAILY_TRIGGER_HOUR + 'h.'
  );
}

// ---------- HELPERS ----------
function getSheet_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    throw new Error('Aba "' + CONFIG.SHEET_NAME + '" não encontrada. Ajuste CONFIG.SHEET_NAME no script.');
  }
  return sheet;
}

function nomeTime_(team) {
  // shortName costuma vir mais limpo (ex: "Flamengo") do que name (ex: "CR Flamengo")
  return (team.shortName || team.name || '').trim();
}

function normalizar_(texto) {
  return String(texto || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // remove acentos para comparar com segurança
}

function buscarPartidas(filtros) {
  const token = PropertiesService.getScriptProperties().getProperty('FOOTBALL_API_TOKEN');
  if (!token) {
    throw new Error('Token da API não configurado. Rode a função "configurarToken" primeiro.');
  }

  let url = CONFIG.API_BASE + '/competitions/' + CONFIG.COMPETITION_CODE + '/matches';
  if (filtros && filtros.status) {
    url += '?status=' + encodeURIComponent(filtros.status);
  }

  const response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'X-Auth-Token': token },
    muteHttpExceptions: true
  });

  const codigo = response.getResponseCode();
  if (codigo !== 200) {
    throw new Error('Erro ao consultar a API (HTTP ' + codigo + '): ' + response.getContentText());
  }

  const data = JSON.parse(response.getContentText());
  return data.matches || [];
}

// ============================================================
// PROBABILIDADES (SIMULAÇÃO MONTE CARLO)
// ============================================================
/**
 * Roda o campeonato N vezes (CONFIG.MONTE_CARLO.SIMULACOES) simulando os
 * jogos que ainda faltam de forma PROBABILÍSTICA (não determinística como
 * a Pontuação Final Prevista): a mesma diferença de força que antes decidia
 * "vitória certa" agora só torna o resultado mais PROVÁVEL, com uma parcela
 * de sorte em cada jogo. Ao final de cada simulação, aplica-se o mesmo
 * critério de desempate (pontos > saldo) pra saber quem terminou campeão,
 * quem entrou no G6 (Libertadores) e quem caiu no Z4 (rebaixamento).
 * As probabilidades são a frequência com que cada time atingiu cada marca
 * nas N simulações.
 *
 * É executada só sob demanda (menu "Calcular probabilidades"), não faz
 * parte do fluxo automático diário, pra não pesar a execução do gatilho.
 *
 * Pré-requisito: rode "Recalcular classificação" pelo menos uma vez antes,
 * pra aba Classificação já existir com a coluna "Time" preenchida.
 */
function calcularProbabilidades() {
  const sheetJogos = getSheet_();
  const lastRow = sheetJogos.getLastRow();
  if (lastRow < CONFIG.FIRST_DATA_ROW) return;

  const dados = sheetJogos
    .getRange(CONFIG.FIRST_DATA_ROW, 1, lastRow - CONFIG.FIRST_DATA_ROW + 1, 5)
    .getValues();

  const times = computarTimes_(dados);
  const classificacaoAtual = ordenarClassificacao_(times);
  if (!classificacaoAtual.length) return;

  const forca = calcularForcaTimes_(classificacaoAtual);
  const nomesTimes = classificacaoAtual.map(t => t.time);

  const jogosRestantes = dados
    .filter(l => {
      const gc = l[CONFIG.COL.GOLS_CASA - 1];
      const gf = l[CONFIG.COL.GOLS_FORA - 1];
      const casa = l[CONFIG.COL.CASA - 1];
      const visitante = l[CONFIG.COL.VISITANTE - 1];
      return casa && visitante && (gc === '' || gf === '' || gc === null || gf === null);
    })
    .map(l => ({ casa: l[CONFIG.COL.CASA - 1], visitante: l[CONFIG.COL.VISITANTE - 1] }));

  const MC = CONFIG.MONTE_CARLO;

  const titulos = {}, libertadores = {}, rebaixamentos = {};
  nomesTimes.forEach(n => { titulos[n] = 0; libertadores[n] = 0; rebaixamentos[n] = 0; });

  for (let s = 0; s < MC.SIMULACOES; s++) {
    const pontosSim = {}, saldoSim = {};
    classificacaoAtual.forEach(t => {
      pontosSim[t.time] = t.pontos;
      saldoSim[t.time] = t.golsPro - t.golsContra;
    });

    jogosRestantes.forEach(j => {
      const forcaCasaAjustada = forca[j.casa] + CONFIG.PROJECAO.BONUS_MANDANTE;
      const forcaFora = forca[j.visitante];
      const resultado = sortearResultado_(forcaCasaAjustada, forcaFora);

      if (resultado === 'C') {
        pontosSim[j.casa] += 3;
        saldoSim[j.casa] += 1;
        saldoSim[j.visitante] -= 1;
      } else if (resultado === 'F') {
        pontosSim[j.visitante] += 3;
        saldoSim[j.visitante] += 1;
        saldoSim[j.casa] -= 1;
      } else {
        pontosSim[j.casa] += 1;
        pontosSim[j.visitante] += 1;
      }
    });

    // Classificação final desta simulação: pontos > saldo (aproximação do
    // critério oficial; golsPró como 3º critério fica de fora aqui pra
    // manter a simulação leve, já que saldo já resolve a imensa maioria dos casos)
    const ranking = nomesTimes.slice().sort((a, b) => {
      if (pontosSim[b] !== pontosSim[a]) return pontosSim[b] - pontosSim[a];
      return saldoSim[b] - saldoSim[a];
    });

    titulos[ranking[0]]++;
    for (let i = 0; i < MC.VAGAS_LIBERTADORES && i < ranking.length; i++) {
      libertadores[ranking[i]]++;
    }
    for (let i = Math.max(0, ranking.length - MC.VAGAS_REBAIXAMENTO); i < ranking.length; i++) {
      rebaixamentos[ranking[i]]++;
    }
  }

  gravarProbabilidades_(nomesTimes, titulos, libertadores, rebaixamentos, MC.SIMULACOES);

  SpreadsheetApp.getUi().alert(
    'Probabilidades calculadas com ' + MC.SIMULACOES + ' simulações e gravadas na aba "' +
    CONFIG.CLASSIFICACAO_SHEET_NAME + '".'
  );
}

/**
 * Sorteia o resultado de um jogo (C=casa vence, E=empate, F=visitante vence)
 * a partir da diferença de força entre os times. Quanto maior a diferença,
 * menor a chance de empate e maior o favoritismo pro time mais forte —
 * mas nunca 100%, sempre sobra espaço pra "zebra".
 */
function sortearResultado_(forcaCasa, forcaFora) {
  const MC = CONFIG.MONTE_CARLO;
  const diferenca = forcaCasa - forcaFora;

  const pEmpate = clamp_(
    MC.PROB_EMPATE_BASE - 0.15 * Math.abs(diferenca),
    MC.PROB_EMPATE_MIN,
    MC.PROB_EMPATE_BASE
  );

  // Probabilidade do time da casa vencer, DADO que o jogo não termina empatado
  const pCasaSeDecisivo = 1 / (1 + Math.exp(-MC.INCLINACAO_LOGISTICA * diferenca));

  const pCasa = pCasaSeDecisivo * (1 - pEmpate);
  // pFora = (1 - pCasaSeDecisivo) * (1 - pEmpate) -- não precisa calcular, é o restante

  const sorteio = Math.random();
  if (sorteio < pCasa) return 'C';
  if (sorteio < pCasa + pEmpate) return 'E';
  return 'F';
}

/**
 * Escreve (ou atualiza, se já existirem) as 3 colunas de probabilidade na
 * aba Classificação, casando pelo nome do time na coluna "Time". Cria as
 * colunas no fim da tabela se ainda não existirem.
 */
function gravarProbabilidades_(nomesTimes, titulos, libertadores, rebaixamentos, totalSimulacoes) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const destino = ss.getSheetByName(CONFIG.CLASSIFICACAO_SHEET_NAME);
  if (!destino || destino.getLastRow() < 2) {
    throw new Error('Rode "Recalcular classificação" antes de calcular as probabilidades.');
  }

  const numColunasAtual = destino.getLastColumn();
  const cabecalhoAtual = destino.getRange(1, 1, 1, numColunasAtual).getValues()[0];

  function indiceColuna_(nomeColuna) {
    let idx = cabecalhoAtual.indexOf(nomeColuna);
    if (idx === -1) {
      cabecalhoAtual.push(nomeColuna);
      idx = cabecalhoAtual.length - 1;
    }
    return idx + 1; // 1-based
  }

  const colReb = indiceColuna_('Probabilidade de Rebaixamento');
  const colLib = indiceColuna_('Probabilidade de Classificação (Libertadores)');
  const colTitulo = indiceColuna_('Probabilidade de Título');

  // Regrava o cabeçalho (pode ter crescido com as novas colunas)
  destino.getRange(1, 1, 1, cabecalhoAtual.length).setValues([cabecalhoAtual]).setFontWeight('bold');

  const numLinhas = destino.getLastRow() - 1;
  const colTimeIdx = cabecalhoAtual.indexOf('Time') + 1;
  const nomesNaPlanilha = destino.getRange(2, colTimeIdx, numLinhas, 1).getValues().map(l => l[0]);

  function fracao_(contagem) {
    return (contagem || 0) / totalSimulacoes;
  }

  const valoresReb = nomesNaPlanilha.map(nome => [fracao_(rebaixamentos[nome])]);
  const valoresLib = nomesNaPlanilha.map(nome => [fracao_(libertadores[nome])]);
  const valoresTitulo = nomesNaPlanilha.map(nome => [fracao_(titulos[nome])]);

  destino.getRange(2, colReb, numLinhas, 1).setValues(valoresReb).setNumberFormat('0.0%');
  destino.getRange(2, colLib, numLinhas, 1).setValues(valoresLib).setNumberFormat('0.0%');
  destino.getRange(2, colTitulo, numLinhas, 1).setValues(valoresTitulo).setNumberFormat('0.0%');
}

// ============================================================
// PERFIL DE TIME
// ============================================================
/**
 * Cria (se não existir) e atualiza a aba "PERFIL DE TIME": dropdown em B1
 * com todos os times; em A4 a situação atual na tabela (líder / Libertadores
 * / Sul-Americana / rebaixamento); em A6:D10 as estatísticas de mandante x
 * visitante; e a partir de F2 o histórico completo de jogos daquele time,
 * com o resultado (V/E/D) do ponto de vista dele.
 *
 * Chamada automaticamente:
 * - sempre que o dropdown em B1 é alterado (via onEdit)
 * - todo dia, junto com atualizarResultados() — mas só se a aba já existir
 *   e já tiver um time selecionado (não cria a aba nem escolhe um time sozinha)
 */
function atualizarPerfilTime() {
  const sheetJogos = getSheet_();
  const lastRow = sheetJogos.getLastRow();
  if (lastRow < CONFIG.FIRST_DATA_ROW) return;

  const dados = sheetJogos
    .getRange(CONFIG.FIRST_DATA_ROW, 1, lastRow - CONFIG.FIRST_DATA_ROW + 1, 5)
    .getValues();

  const times = computarTimes_(dados);
  const classificacao = ordenarClassificacao_(times);
  if (!classificacao.length) return;

  const nomesTimes = classificacao.map(t => t.time);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let destino = ss.getSheetByName(CONFIG.PERFIL_SHEET_NAME);
  const abaJaExistia = !!destino;

  if (!destino) {
    destino = ss.insertSheet(CONFIG.PERFIL_SHEET_NAME);
  }

  // Configura (ou reconfigura) o dropdown em B1 sem apagar a seleção atual
  destino.getRange('A1').setValue('Time:').setFontWeight('bold');
  const regraDropdown = SpreadsheetApp.newDataValidation()
    .requireValueInList(nomesTimes, true)
    .setAllowInvalid(false)
    .build();
  destino.getRange('B1').setDataValidation(regraDropdown);

  const timeEscolhido = destino.getRange('B1').getValue();

  // Se a aba acabou de ser criada agora (dropdown ainda vazio) ou se rodou
  // pelo fluxo diário automático sem nenhum time selecionado, não tem o que
  // desenhar ainda — só deixa o dropdown pronto pro usuário escolher.
  if (!timeEscolhido || nomesTimes.indexOf(timeEscolhido) === -1) {
    if (!abaJaExistia) {
      destino.getRange('B1').setValue(nomesTimes[0]); // pré-seleciona o líder atual, só na criação da aba
    } else {
      return;
    }
  }

  const nomeTime = destino.getRange('B1').getValue();
  const totalTimes = nomesTimes.length;
  const posicao = nomesTimes.indexOf(nomeTime) + 1;

  // Limpa tudo A PARTIR da linha 2 pra baixo (preservando o dropdown em B1),
  // cobrindo tanto o bloco de resumo (colunas A-D) quanto a tabela de jogos
  // (a partir da coluna F)
  const ultimaLinha = Math.max(destino.getLastRow(), 4);
  const ultimaColuna = Math.max(destino.getLastColumn(), 11);
  destino.getRange(2, 1, ultimaLinha - 1, ultimaColuna).clearContent();

  // --- Situação na tabela ---
  destino.getRange('A4').setValue('Posição: ' + posicao + 'º - ' + zonaPorPosicao_(posicao)).setFontWeight('bold');

  // --- Estatísticas casa x fora ---
  const stats = calcularEstatisticasCasaFora_(nomeTime, dados);

  const linhasStats = [
    ['Vitórias (Casa)', stats.vitoriasCasa, 'Vitórias (Fora)', stats.vitoriasFora],
    ['Derrotas (Casa)', stats.derrotasCasa, 'Derrotas (Fora)', stats.derrotasFora],
    ['Aproveitamento (Casa)', stats.aproveitamentoCasa, 'Aproveitamento (Fora)', stats.aproveitamentoFora],
    ['Gols Pró', stats.golsPro, 'Gols Contra', stats.golsContra],
    ['Saldo de Gols', stats.saldo, '', '']
  ];
  const linhaInicioStats = 6;
  destino.getRange(linhaInicioStats, 1, linhasStats.length, 4).setValues(linhasStats);
  destino.getRange(linhaInicioStats, 1, linhasStats.length, 1).setFontWeight('bold');
  destino.getRange(linhaInicioStats, 3, linhasStats.length, 1).setFontWeight('bold');
  destino.getRange(linhaInicioStats + 2, 2, 1, 1).setNumberFormat('0.0%'); // Aproveitamento (Casa)
  destino.getRange(linhaInicioStats + 2, 4, 1, 1).setNumberFormat('0.0%'); // Aproveitamento (Fora)

  // --- Histórico de jogos (começa em F2) ---
  const cabecalhoHistorico = ['Rodada', 'Time Casa', 'Gols Casa', 'Gols Fora', 'Time Fora', 'Resultado'];
  const linhaCabecalhoHistorico = 2;
  const colunaCabecalhoHistorico = 6; // F
  destino.getRange(linhaCabecalhoHistorico, colunaCabecalhoHistorico, 1, cabecalhoHistorico.length)
    .setValues([cabecalhoHistorico])
    .setFontWeight('bold');

  const jogosDoTime = dados
    .filter(l => l[CONFIG.COL.CASA - 1] === nomeTime || l[CONFIG.COL.VISITANTE - 1] === nomeTime)
    .sort((a, b) => Number(a[CONFIG.COL.RODADA - 1]) - Number(b[CONFIG.COL.RODADA - 1]));

  const linhasHistorico = jogosDoTime.map(l => {
    const rodada = l[CONFIG.COL.RODADA - 1];
    const casa = l[CONFIG.COL.CASA - 1];
    const golsCasa = l[CONFIG.COL.GOLS_CASA - 1];
    const golsFora = l[CONFIG.COL.GOLS_FORA - 1];
    const visitante = l[CONFIG.COL.VISITANTE - 1];

    let resultado = '';
    if (golsCasa !== '' && golsFora !== '' && golsCasa !== null && golsFora !== null) {
      const ehCasa = casa === nomeTime;
      const golsTime = ehCasa ? Number(golsCasa) : Number(golsFora);
      const golsAdversario = ehCasa ? Number(golsFora) : Number(golsCasa);
      if (golsTime > golsAdversario) resultado = 'V';
      else if (golsTime < golsAdversario) resultado = 'D';
      else resultado = 'E';
    }

    return [rodada, casa, golsCasa, golsFora, visitante, resultado];
  });

  if (linhasHistorico.length > 0) {
    destino.getRange(linhaCabecalhoHistorico + 1, colunaCabecalhoHistorico, linhasHistorico.length, cabecalhoHistorico.length)
      .setValues(linhasHistorico);
  }
}

/** Retorna o rótulo de zona (Líder / Libertadores / Sul-Americana / Rebaixamento / Meio de Tabela) pra uma posição. */
function zonaPorPosicao_(posicao) {
  const Z = CONFIG.ZONAS;
  if (posicao === Z.LIDER) return 'Líder';
  if (posicao >= Z.LIBERTADORES[0] && posicao <= Z.LIBERTADORES[1]) return 'Libertadores';
  if (posicao >= Z.SULAMERICANA[0] && posicao <= Z.SULAMERICANA[1]) return 'Sul-Americana';
  if (posicao >= Z.REBAIXAMENTO[0] && posicao <= Z.REBAIXAMENTO[1]) return 'Rebaixamento';
  return 'Meio de Tabela';
}

/** Calcula vitórias, derrotas, aproveitamento e gols separados por mandante x visitante. */
function calcularEstatisticasCasaFora_(nomeTime, dados) {
  const stats = {
    vitoriasCasa: 0, derrotasCasa: 0, empatesCasa: 0, jogosCasa: 0, pontosCasa: 0,
    vitoriasFora: 0, derrotasFora: 0, empatesFora: 0, jogosFora: 0, pontosFora: 0,
    golsPro: 0, golsContra: 0
  };

  dados.forEach(l => {
    const casa = l[CONFIG.COL.CASA - 1];
    const visitante = l[CONFIG.COL.VISITANTE - 1];
    const golsCasa = l[CONFIG.COL.GOLS_CASA - 1];
    const golsFora = l[CONFIG.COL.GOLS_FORA - 1];

    if (golsCasa === '' || golsFora === '' || golsCasa === null || golsFora === null) return;
    if (casa !== nomeTime && visitante !== nomeTime) return;

    const gc = Number(golsCasa);
    const gf = Number(golsFora);

    if (casa === nomeTime) {
      stats.jogosCasa++;
      stats.golsPro += gc;
      stats.golsContra += gf;
      if (gc > gf) { stats.vitoriasCasa++; stats.pontosCasa += 3; }
      else if (gc < gf) { stats.derrotasCasa++; }
      else { stats.empatesCasa++; stats.pontosCasa += 1; }
    } else {
      stats.jogosFora++;
      stats.golsPro += gf;
      stats.golsContra += gc;
      if (gf > gc) { stats.vitoriasFora++; stats.pontosFora += 3; }
      else if (gf < gc) { stats.derrotasFora++; }
      else { stats.empatesFora++; stats.pontosFora += 1; }
    }
  });

  stats.aproveitamentoCasa = stats.jogosCasa > 0 ? stats.pontosCasa / (stats.jogosCasa * 3) : 0;
  stats.aproveitamentoFora = stats.jogosFora > 0 ? stats.pontosFora / (stats.jogosFora * 3) : 0;
  stats.saldo = stats.golsPro - stats.golsContra;

  return stats;
}
