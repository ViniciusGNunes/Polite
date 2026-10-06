# Polite

O Polite é uma extensão de navegador para corrigir e melhorar textos enquanto você digita. Ele usa a IA da Groq, então as correções são super rápidas.

A ideia é simples: você seleciona qualquer texto que acabou de escrever (seja num input, textarea ou editor de texto), clica no botão que aparece (ou pressiona Alt+C), e a IA corrige a gramática ou traduz o texto para o idioma que você escolher.

## Instalação

Tem duas formas de instalar o Polite: baixando o pacote já pronto, ou buildando a partir do código-fonte.

### Opção 1: Baixar o pacote pronto (Releases do GitHub)

1. Acesse a página de [Releases](https://github.com/ViniciusGNunes/Polite/releases) do repositório
2. Baixe o pacote correspondente ao seu navegador:
   - **Chrome / Edge / Brave / Opera:** pacote de produção padrão (`polite-prod`)
   - **Firefox:** pacote de produção do Firefox (`firefox-mv3-prod`)
3. Extraia o `.zip` baixado em uma pasta
4. Carregue a extensão no navegador:
   - **Chrome/Edge/Brave/Opera:**
     - Acesse `chrome://extensions/` (ou `edge://extensions/`, etc.)
     - Ative o **Modo do desenvolvedor**
     - Clique em **Carregar sem compactação** e selecione a pasta extraída
   - **Firefox:**
     - Acesse `about:debugging`
     - Clique em **This Firefox**
     - Clique em **Load Temporary Add-on** e selecione o arquivo `manifest.json` dentro da pasta extraída

### Opção 2: Buildar a partir do código-fonte

1. Instale as dependências:

   ```bash
   npm install
   ```

2. Gere o build para o seu navegador:

   - **Chrome/Edge/Brave/Opera** (modo desenvolvimento):

     ```bash
     npm run dev
     ```

     Isso cria a pasta `build/polite-dev`.

   - **Firefox** (build de produção):

     ```bash
     npm run build:firefox
     ```

     Isso cria a pasta `build/firefox-mv3-prod`.

3. Carregue a extensão no navegador:
   - **Chrome/Edge/Brave/Opera:**
     - Acesse `chrome://extensions/`
     - Ative o **Modo do desenvolvedor** lá no topo
     - Clique em **Carregar sem compactação**
     - Selecione a pasta `build/polite-dev` que acabou de ser criada
   - **Firefox:**
     - Acesse `about:debugging`
     - Clique em **This Firefox**
     - Clique em **Load Temporary Add-on** e selecione `build/firefox-mv3-prod/manifest.json`

**Importante:** Você vai precisar de uma chave de API gratuita da [Groq](https://console.groq.com/keys). É só colocar ela no popup ou nas configurações da extensão pra ela começar a funcionar.
