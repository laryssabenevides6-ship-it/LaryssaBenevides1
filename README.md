# Med Study Brain

Central diaria de execucao para Residencia BR e USMLE Step 1, com cronograma importado da planilha oficial, checklist por tarefa, registro de questoes, caderno de erros e dashboard.

## Funcionalidades

- Cadastro, login, logout, recuperacao e alteracao de senha.
- Dados separados por usuario no navegador: cronograma, checklist, questoes, simulados, erros, lousa semanal, preferencias e estatisticas.
- Home na ordem operacional: Hoje - Plano do dia, botoes rapidos, Lousa Semanal, Planejamento da Semana, Alertas e resumo simples.
- Checklist diario independente para MEDCOF, B&B/Step 1, questoes, Anki, revisao de erros e interleaving.
- Status automatico: Nao iniciado, Parcial, Concluido, Atrasado e Reprogramado.
- Anki simplificado como tarefa diaria: Feito ou Pendente.
- Registro de questoes feitas com fonte, modo, selecao, formato, prova-alvo, materia, sistema, tema, numero de questoes, acertos, percentual, tempo total e tempo medio.
- Caderno de erros como banco de revisao, com status Aberto, Revisado, Resolvido e Recorrente.
- Alertas inteligentes para aulas atrasadas, Anki pendente, tarefas incompletas, erros antigos, poucas questoes na semana e simulados proximos.
- Backup JSON, importacao, restauracao e modo claro/escuro.

## Observacao de autenticacao

A versao atual e uma aplicacao Vite estatica. A autenticacao e persistencia ficam no `localStorage`, com chaves separadas por usuario no mesmo navegador. Para uso publico real com multiplos dispositivos e isolamento de servidor, o projeto esta pronto para receber Firebase Auth + Firestore ou outro backend.

## Rodar localmente

```bash
npm install
npm run dev
```

Build de producao:

```bash
npm run build
npm run preview
```

O build gera a pasta `dist/`.

## Deploy

### Vercel

1. Envie o projeto para o GitHub.
2. Importe o repositorio na Vercel.
3. Framework preset: `Vite`.
4. Build command: `npm run build`.
5. Output directory: `dist`.

O arquivo `vercel.json` ja esta configurado.
