# 🪄 Polite — Assistente Gramatical & Estilístico com IA (Groq)

Uma extensão inteligente para navegadores baseados no Chromium (Google Chrome, Brave, Edge, Opera) desenvolvida com **Plasmo Framework**, **React**, **TypeScript** e **Groq Cloud API** para correção instantânea de gramática, estilo e tom de escrita em qualquer página da web.

---

## 🚀 Funcionalidades

- **Correção em Tempo Real:** Selecione qualquer texto em inputs, caixas de texto (`<textarea>`) ou editores ricos (`contenteditable`) para obter correções instantâneas.
- **Ultra-Rápido com Groq:** Alimentado por modelos Llama 3 / Mixtral executados no hardware de ultra-baixa latência (LPU) da Groq.
- **Recuperação Automática de Modelos:** Fallback dinâmico para modelos ativos caso o modelo selecionado seja descontinuado pela Groq.
- **Tons e Estilos Personalizados:** Escolha entre tom Formal, Conciso, Profissional, Criativo, entre outros.
- **Histórico & Gestão de Chave:** Configurações centralizadas com validação de API Key e lista de exclusão de sites.
- **Dark Mode Nativo:** Interface moderna e polida construída com Ant Design e TailwindCSS.

---

## 🛠️ Tecnologias

- **Framework:** [Plasmo Framework](https://www.plasmo.com/) (Manifest V3)
- **UI:** [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Componentes:** [Ant Design](https://ant.design/) & [Lucide React](https://lucide.dev/)
- **Estilização:** [TailwindCSS](https://tailwindcss.com/)
- **IA:** [Groq Cloud SDK / API](https://console.groq.com/)

---

## 📦 Como Clonar e Rodar o Projeto

### 1. Pré-requisitos
- [Node.js](https://nodejs.org/) (versão 18 ou superior recomendada)
- `npm`, `pnpm` ou `yarn`
- Uma chave de API gratuita da [Groq](https://console.groq.com/keys)

### 2. Clonar o Repositório
```bash
git clone https://github.com/SEU_USUARIO/Polite.git
cd Polite
```

### 3. Instalar Dependências
```bash
npm install
```

### 4. Executar em Modo de Desenvolvimento (Live Reload)
```bash
npm run dev
```
Isso criará a pasta `build/chrome-mv3-dev`.

### 5. Carregar no Chrome (Desenvolvimento)
1. Abra o Google Chrome e acesse `chrome://extensions/`.
2. Ative a chave **"Modo do desenvolvedor"** no canto superior direito.
3. Clique em **"Carregar sem compactação"** (Load unpacked).
4. Selecione a pasta do projeto: `Polite/build/chrome-mv3-dev`.
5. Clique no ícone da extensão para configurar sua chave de API Groq (`gsk_...`).

---

## 🏗️ Build e Publicação na Chrome Web Store

### 1. Gerar o Pacote de Produção
Para criar o arquivo ZIP pronto para a Chrome Web Store:
```bash
npm run package
```
ou para compilar sem compactar:
```bash
npm run build
```

O comando gerará o arquivo ZIP em:
```
build/chrome-mv3-prod.zip
```

### 2. Enviar para a Chrome Web Store
1. Acesse o [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Clique em **"Novo item"** (New item).
3. Faça o upload do arquivo `build/chrome-mv3-prod.zip`.
4. Preencha as descrições, envie os ícones (disponíveis na pasta `assets/`) e screenshots.
5. Envie para revisão!

---

## 📁 Estrutura de Arquivos

```
Polite/
├── assets/             # Ícones da extensão (16, 48, 128px)
├── src/
│   ├── background.ts   # Service worker MV3 (chamadas à Groq, atalhos)
│   ├── content.tsx     # Injeção em páginas (botão flutuante, modal de correção)
│   ├── options.tsx     # Página completa de configurações e histórico
│   ├── popup.tsx       # Popup rápido da barra de ferramentas
│   ├── style.css       # Estilos globais e Tailwind
│   ├── tabs/           # Páginas internas da extensão (ex: laboratório de testes)
│   └── utils/          # Módulos auxiliares e formatadores
├── test.html           # Página HTML para teste local de inputs
├── package.json        # Dependências e scripts
└── tsconfig.json       # Configuração TypeScript
```

---

## 📄 Licença
Distribuído sob a licença ISC.
