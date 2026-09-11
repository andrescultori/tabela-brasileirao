# Brasileirão Apps Script

Script de Google Apps Script que transforma uma Google Sheets num painel automático do **Campeonato Brasileiro Série A**: popula o calendário de jogos, atualiza os resultados diariamente, e calcula classificação, projeção de pontos e probabilidades (título / Libertadores / rebaixamento) via simulação Monte Carlo.

Fonte de dados: [football-data.org](https://www.football-data.org/) (plano gratuito, API v4, competição `BSA`).

**[→ Ver ao vivo](https://docs.google.com/spreadsheets/d/1ZZVtyysMpz62xIB6whuDV7FEAt12zvLaVvxH41BKzh8/edit?gid=1262484430#gid=1262484430)**

## Funcionalidades

- **Popular tabela**: busca o calendário completo da temporada (380 jogos) e escreve na aba `Tabela`
- **Atualizar resultados**: busca jogos encerrados e preenche os placares — roda manualmente ou por gatilho diário automático
- **Classificação** (aba gerada automaticamente): pontos, saldo, aproveitamento, diferença pro líder e pra zona de rebaixamento, últimos 5 jogos, próximos 5 confrontos + força da sequência
- **Pontuação Final Prevista**: projeção determinística baseada num índice de força (aproveitamento + saldo por jogo) de cada time
- **Probabilidades via Monte Carlo**: roda o campeonato 1.000 vezes simulando os jogos restantes probabilisticamente, calculando % de título, classificação à Libertadores (G6) e rebaixamento (Z4)
- **Perfil de Time** (aba gerada automaticamente): dropdown pra escolher um time e ver posição atual + zona (Líder/Libertadores/Sul-Americana/Rebaixamento), estatísticas casa x fora, e o histórico completo de jogos com o resultado (V/E/D) do ponto de vista dele — atualiza sozinha ao trocar o time no dropdown

## Estrutura do repositório

```
.
├── src/
│   ├── Codigo.gs         → todo o código do script
│   └── appsscript.json   → manifesto do projeto Apps Script
├── .clasp.json.example   → template de configuração do clasp (copie para .clasp.json)
├── .claspignore
├── .gitignore
├── package.json
└── README.md
```

## Como usar

### Opção A — copiar e colar manualmente (mais simples, sem instalar nada)

1. Crie (ou abra) a Google Sheets onde os dados vão morar
2. **Extensões → Apps Script**
3. Apague o conteúdo padrão e cole o conteúdo de [`src/Codigo.gs`](src/Codigo.gs)
4. Salve

### Opção B — via [clasp](https://github.com/google/clasp) (recomendado se for versionar/editar por aqui)

```bash
npm install
npm run login          # autentica com sua conta Google
```

Crie o projeto Apps Script vinculado à planilha (via Extensões → Apps Script na própria planilha, ou `clasp create`), pegue o **Script ID** em Configurações do projeto (⚙️) e:

```bash
cp .clasp.json.example .clasp.json
# edite .clasp.json e cole o scriptId
npm run push            # envia o código local pro Apps Script
```

Depois de qualquer alteração no `src/Codigo.gs`, rode `npm run push` de novo pra sincronizar.

### Configuração inicial (fazer 1 vez, direto na planilha/editor)

1. Ajuste `CONFIG.SHEET_NAME` em `Codigo.gs` pro nome real da aba de jogos (padrão: `'Tabela'`)
2. Crie uma conta gratuita em [football-data.org](https://www.football-data.org/client/register) e copie o token (X-Auth-Token) recebido por e-mail
3. No editor do Apps Script → ícone de **engrenagem** (Configurações do projeto) → **Propriedades do script** → adicione a propriedade `FOOTBALL_API_TOKEN` com o valor do seu token

   *(Alternativa: rode a função `configurarToken` pelo menu **Brasileirão** dentro da planilha — só funciona se chamada pelo menu, não pelo botão ▶ do editor)*

4. Volte à planilha e recarregue a página — vai aparecer o menu **Brasileirão**
5. Rode **Popular tabela (novo campeonato)**
6. Rode **Ativar atualização automática diária** (por padrão, roda todo dia às 8h — ajustável em `CONFIG.DAILY_TRIGGER_HOUR`)

A partir daí, tudo roda sozinho: o gatilho diário atualiza os placares, recalcula classificação, projeção de pontos e o Perfil de Time (se já tiver um time selecionado) automaticamente. As probabilidades Monte Carlo rodam só sob demanda, pelo menu (**Calcular probabilidades**), pra não pesar a execução diária.

## Formato esperado da planilha

Aba `Tabela` (cabeçalho na linha 1, dados a partir da linha 2):

| Rodada | Time da Casa | Gols Casa | Gols Fora | Time Visitante |
|---|---|---|---|---|

As abas `Classificação` e `PERFIL DE TIME` são criadas e mantidas automaticamente pelo script — não precisa criar à mão.

## Menu disponível na planilha

- Popular tabela (novo campeonato)
- Atualizar resultados agora
- Recalcular classificação
- Calcular probabilidades (Monte Carlo)
- Atualizar Perfil de Time
- Ativar atualização automática diária
- Configurar token da API
