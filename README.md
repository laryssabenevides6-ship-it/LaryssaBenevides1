# Med Study Brain

Aplicativo web completo para organização de estudos de residência médica e USMLE/Step 1, com cronograma importado do arquivo `Cronograma corrigido oficial..xlsx`, revisão espaçada, flashcards, Anki, caderno de erros, sessões de questões, simulados e dashboard automático.

## Funcionalidades

- Cronograma diário automatizado com 585 itens importados da planilha.
- Tela **Hoje** gerada automaticamente com aulas, revisões, flashcards, Anki, simulados e pendências.
- Conclusão de aula gera revisões automáticas de 15 e 30 dias.
- Flashcards com reagendamento automático por dificuldade.
- Caderno de erros inteligente com geração de flashcards e revisões futuras.
- Sessões de questões com cálculo de acerto, tempo médio e tendência.
- Simulados com comparação automática contra resultados anteriores.
- Dashboard com progresso geral, pontos fracos, alertas, rankings e gráficos.
- Cronômetro vinculado à matéria/tema com salvamento automático.
- Persistência em `localStorage`, exportação/importação JSON e restauração do backup.
- Modo claro/escuro e layout responsivo.

## Estrutura

```text
.
├── index.html
├── public/
├── src/
│   ├── modules/
│   │   ├── app.js
│   │   ├── engine.js
│   │   ├── storage.js
│   │   └── utils.js
│   └── styles/app.css
├── public/data/cronograma.json
├── package.json
├── vercel.json
├── netlify.toml
├── firebase.json
└── .gitignore
```

## Rodar localmente

Instale as dependências:

```bash
npm install
```

Rode o ambiente de desenvolvimento:

```bash
npm run dev
```

Acesse:

```text
http://localhost:5173
```

Build de produção:

```bash
npm run build
```

O build gera a pasta:

```text
dist/
```

Pré-visualização do build:

```bash
npm run preview
```

## Deploy

### Vercel

1. Envie este projeto para o GitHub.
2. Importe o repositório na Vercel.
3. Use framework preset **Vite**.
4. Build command: `npm run build`.
5. Output directory: `dist`.
6. O arquivo `vercel.json` já está pronto.

### Netlify

1. Envie para o GitHub.
2. Crie um novo site a partir do repositório.
3. Build command vazio.
4. Publish directory: `.`

### Firebase Hosting

Use a raiz do projeto como diretório público.
