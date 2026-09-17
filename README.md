# Polite

O Polite é uma extensão de navegador para corrigir e melhorar textos enquanto você digita. Ele usa a IA da Groq, então as correções são super rápidas.

A ideia é simples: você seleciona qualquer texto que acabou de escrever (seja num input, textarea ou editor de texto), clica no botão que aparece, e a IA corrige a gramática ou ajusta o tom (pra deixar mais profissional, conciso, etc).

## Como rodar localmente

Se você quiser clonar e rodar na sua máquina:

1. Instale as dependências:
   ```bash
   npm install
   ```

2. Rode o modo de desenvolvimento:
   ```bash
   npm run dev
   ```

3. Carregue a extensão no Chrome:
   - Acesse `chrome://extensions/`
   - Ative o **Modo do desenvolvedor** lá no topo
   - Clique em **Carregar sem compactação**
   - Selecione a pasta `build/chrome-mv3-dev` que acabou de ser criada.

**Importante:** Você vai precisar de uma chave de API gratuita da [Groq](https://console.groq.com/keys). É só colocar ela no popup ou nas configurações da extensão pra ela começar a funcionar.

