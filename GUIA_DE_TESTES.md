# 🧪 Guia Completo de Testes e Funcionalidades - Polite (Corretor IA Groq)

Este documento contém o checklist prático e detalhado de todas as funcionalidades da extensão **Polite**, pronto para guiar testes manuais, homologação e validação de ponta a ponta.

---

## 📋 Sumário
1. [Configuração Inicial e Instalação](#1-configuração-inicial-e-instalação)
2. [🔑 Tutorial: Como Obter e Adicionar a Chave Groq](#2--tutorial-como-obter-e-adicionar-a-chave-groq)
3. [Popup da Barra de Ferramentas (`popup.tsx`)](#3-popup-da-barra-de-ferramentas)
4. [Página de Opções e Configurações (`options.tsx`)](#4-página-de-opções-e-configurações)
5. [Modal de Correção e Tradução na Página (`content.tsx`)](#5-modal-de-correção-e-tradução-na-página)
6. [Testes com Atalho de Teclado (Alt + C)](#6-testes-com-atalho-de-teclado-alt--c)
7. [Substituição em Campos e Editores de Texto](#7-substituição-em-campos-e-editores-de-texto)
8. [Laboratório de Testes Embutido (`tabs/test.tsx`)](#8-laboratório-de-testes-embutido)
9. [Casos de Borda e Tratamento de Erros](#9-casos-de-borda-e-tratamento-de-erros)

---

## 1. Configuração Inicial e Instalação

- [ ] **Ambiente de Desenvolvimento:**
  - Execute `npm run dev` na raiz do projeto.
  - Verifique se a pasta `build/chrome-mv3-dev/` foi gerada.
- [ ] **Carregamento no Google Chrome:**
  - Acesse `chrome://extensions`.
  - Ative o **Modo do desenvolvedor** (canto superior direito).
  - Clique em **Carregar sem compactação** e selecione a pasta `build/chrome-mv3-dev/`.
  - Verifique se o nome aparece como **Polite** e com a logo oficial da extensão.
- [ ] **Permissão de arquivos locais (opcional):**
  - Se for abrir páginas de teste locais (`file:///.../test.html`), vá em **Detalhes** da extensão Polite e ative **"Permitir acesso a URLs de arquivo"**.

---

## 2. 🔑 Tutorial: Como Obter e Adicionar a Chave Groq

A API da Groq fornece inferência com velocidade extrema através de LPUs (*Language Processing Units*). **O acesso é 100% gratuito e não exige nenhum cartão de crédito.**

> [!TIP]
> A chave da Groq sempre começa com o prefixo `gsk_` (exemplo: `gsk_aBcD1234eFgHiJ5678...`).

### 📝 Passo a Passo para Criar sua Chave Gratuita

1. **Acesse o Groq Console:**
   - Abra o link oficial de chaves: [**console.groq.com/keys**](https://console.groq.com/keys).

2. **Faça Login ou Crie sua Conta:**
   - Faça login com 1 clique usando sua conta do **Google**, **GitHub** ou cadastre-se com e-mail e senha.
   - *Nota:* Nenhuma informação financeira ou de cartão de crédito é solicitada.

3. **Crie a API Key:**
   - No menu lateral esquerdo, confirme que está na seção **"API Keys"**.
   - Clique no botão laranja/azul **"Create API Key"**.
   - No campo **"Name"**, digite qualquer identificador (por exemplo: `Polite` ou `Extensão`).
   - Clique em **"Submit"**.

4. **Copie a Chave Gerada:**
   - Um modal abrirá exibindo o código da sua chave iniciando com `gsk_...`.
   - Clique no botão **"Copy"** (ícone de prancheta/cópia).
   - ⚠️ **Importante:** Por segurança, a Groq só exibe o código completo uma única vez. Cole-o na extensão logo em seguida. Se perder, basta clicar em "Create API Key" novamente.

---

### 📥 Como Adicionar a Chave na Extensão Polite

Você pode adicionar sua chave por dois locais fáceis:

#### Método A: Pelo Popup da Extensão (Mais Rápido ⚡)
1. Clique no ícone do **Polite** na barra de ferramentas do Chrome (ícone de extensões/quebra-cabeça).
2. No campo **"Insira sua API Key da Groq"**, cole a chave copiada (`Ctrl + V`).
3. Clique no botão azul **"Salvar Chave"**.
4. ✅ O status atualizará para **Conectado** com uma tag verde e exibirá o modelo ativo!

#### Método B: Pela Página de Configurações (Opções)
1. Clique com o botão direito no ícone da extensão ➔ **Opções** (ou clique na engrenagem ⚙️ no topo do popup).
2. No primeiro card intitulado **"Autenticação & Chave da API Groq"**, cole sua chave no campo `gsk_...`.
3. Clique em **"Testar Conexão"** para verificar se os servidores da Groq respondem com sucesso.
4. Clique em **"Salvar Configurações"**.

---

### ⚡ Como Testar se Tudo está Funcionando
1. Abra qualquer site ou a aba de testes da extensão (`tabs/test.html`).
2. Selecione qualquer frase (exemplo: *"nois foi no cinema ontem"*).
3. Pressione o atalho de teclado **`Alt + C`** (ou clique no botão azul flutuante).
4. O modal abrirá com o texto corrigido pela IA em alta velocidade!

---

## 3. Popup da Barra de Ferramentas

O popup é aberto ao clicar no ícone da extensão ou no menu do quebra-cabeça.

- [ ] **Abertura do Modal/Popup:**
  - Clique no ícone da extensão Polite na barra do Chrome.
  - **Esperado:** O popup com largura de 320px abre suavemente com tema Dark.
- [ ] **Inserção da API Key:**
  - Se não houver chave salva, deve aparecer o campo com alerta informando a necessidade da chave Groq.
  - Digite a chave `gsk_...` e clique em **Salvar Chave**.
  - **Esperado:** Notificação de sucesso; o status muda para conectado com tag verde e o modelo ativo é exibido.
- [ ] **Edição e Remoção da Chave:**
  - Clique no botão de editar (lápis) para atualizar a chave.
  - Clique no botão de lixeira com confirmação para remover a chave.
  - **Esperado:** A chave é apagada do storage e o estado volta para desconectado.
- [ ] **Atalhos Rápidos:**
  - Clique no botão de engrenagem no topo do popup.
  - **Esperado:** Abre a aba de **Configurações** da extensão.
  - Clique em **"Playground de Testes"**.
  - **Esperado:** Abre uma nova aba com o laboratório interativo (`tabs/test.html`).

---

## 4. Página de Opções e Configurações

Acesse clicando com o botão direito no ícone da extensão ➔ **Opções** (ou pelo popup).

### A. Gerenciamento de Modelos da Groq
- [ ] **Seleção de Modelo Recomendado:**
  - Escolha entre os modelos oficiais sugeridos:
    - `openai/gpt-oss-20b` *(Padrão / Ultra Rápido)*
    - `openai/gpt-oss-120b` *(Mais Inteligente)*
    - `qwen/qwen3.6-27b` *(Multilíngue & Raciocínio)*
  - Clique em **Salvar Configurações**.
  - **Esperado:** Mensagem de confirmação e persistência do modelo no `@plasmohq/storage`.
- [ ] **Busca Dinâmica de Modelos na API:**
  - Clique no botão **"Buscar Modelos Disponíveis na Groq"**.
  - **Esperado:** A extensão faz um request a `https://api.groq.com/openai/v1/models` e preenche uma lista com todos os modelos de chat ativos na sua conta Groq.
- [ ] **Modelo Customizado:**
  - Insira o nome de um modelo manualmente no campo de modelo customizado e salve.

### B. Teste de Conexão com a API
- [ ] **Botão "Testar Chave & Conexão":**
  - Clique para testar a comunicação imediata.
  - **Esperado:** Uma chamada de teste é enviada à Groq. Em caso de sucesso, exibe banner verde informando o modelo operacional utilizado. Em caso de chave inválida, exibe mensagem de erro clara.

### C. Lista de Exclusão (Blacklist de Domínios)
- [ ] **Adicionar Domínio Ignorado:**
  - Digite um domínio (ex: `banco.com.br` ou `localhost`) e clique em **Adicionar**.
  - **Esperado:** O domínio é adicionado à lista e salvo no storage.
- [ ] **Verificação de Bloqueio:**
  - Abra uma página do domínio cadastrado e selecione um texto.
  - **Esperado:** O botão flutuante e o modal **NÃO** aparecem (extensão desativada nessa página).
- [ ] **Remover Domínio:**
  - Clique no ícone de exclusão da tag do domínio. O site volta a ter suporte normal.

### D. Histórico de Correções e Traduções
- [ ] **Visualização do Histórico:**
  - Verifique se as últimas requisições aparecem na tabela com:
    - Data/Hora
    - Modo (ex: `Corrigir` ou `Traduzir (Inglês)`)
    - Modelo de IA utilizado
    - Texto original vs. Texto final gerado
- [ ] **Limpeza de Histórico:**
  - Clique em **Limpar Histórico** e confirme no popconfirm.
  - **Esperado:** Todo o histórico recente é esvaziado.

---

## 5. Modal de Correção e Tradução na Página

Teste em qualquer página web comum (ex: Wikipedia, Google Docs, Notion, ou `tabs/test.html`).

### A. Ativação Visual
- [ ] **Seleção de Texto com Mouse:**
  - Selecione 2 ou mais caracteres com o mouse.
  - **Esperado:** O botão azul **"Corrigir com IA [Alt+C]"** surge próximo à seleção.
  - Solte a seleção clicando fora. O botão desaparece suavemente.

### B. Modo ⚡ Corrigir
- [ ] **Correção Gramatical:**
  - Selecione uma frase com erros: `"Ontem nois fumo no cinema e tavam muito chato."`
  - Clique em **Corrigir com IA** (ou aperte **Alt + C**).
  - **Esperado:** O modal abre com spinner de carregamento e exibe a frase corrigida: `"Ontem nós fomos ao cinema e estava muito chato."`
  - A resposta é direta, sem preâmbulos, saudações ou justificativas gramaticais.

### C. Modo 🌐 Traduzir com Seletor de Idiomas
- [ ] **Tradução Padrão (Inglês):**
  - Com o modal aberto, clique no botão **Traduzir**.
  - **Esperado:** O texto é traduzido diretamente para o **Inglês** (idioma padrão).
- [ ] **Troca de Idioma de Tradução:**
  - No dropdown **`Para:`**, selecione outro idioma (ex: **Espanhol**, **Francês**, **Alemão**, **Italiano**, **Japonês**, **Chinês**).
  - **Esperado:** O texto é retraduzido em tempo real para o idioma selecionado.
- [ ] **Persistência do Idioma Escolhido:**
  - Feche o modal e abra novamente em outra frase.
  - Clique em **Traduzir**.
  - **Esperado:** O dropdown lembra do último idioma selecionado pelo usuário.

### D. Visualizador de Diferenças (Tabs Resultado vs. Diff)
- [ ] **Tab Resultado:**
  - Exibe o texto limpo e pronto para uso.
- [ ] **Tab Diff:**
  - Clique na aba **Diff**.
  - **Esperado:** Destaca em **verde** as palavras adicionadas e em **vermelho tachado** as palavras removidas ou corrigidas, com contador de adições e remoções.

### E. Arrastar e Mover o Modal (Drag & Drop)
- [ ] **Arrastar pelo Cabeçalho:**
  - Clique na barra superior do modal (onde diz *Polite*) e arraste o mouse pela tela.
  - **Esperado:** O cursor muda para `grabbing` e o modal segue o movimento do mouse suavemente, respeitando os limites da janela do navegador.

---

## 6. Testes com Atalho de Teclado (Alt + C)

- [ ] **Alt + C com Texto Selecionado:**
  - Destaque qualquer texto com o mouse e aperte **Alt + C**.
  - **Esperado:** O modal abre imediatamente disparando a correção pela IA.
- [ ] **Alt + C dentro de Campo de Texto sem Seleção (Fallback Inteligente):**
  - Digite uma frase em um `<input>` ou `<textarea>` sem selecioná-la (cursor apenas piscando no final).
  - Aperte **Alt + C**.
  - **Esperado:** A extensão detecta o conteúdo completo do campo ativo, abre o modal e corrige todo o texto digitado.
- [ ] **Navegação Rápida no Modal via Teclado:**
  - Com o modal aberto:
    - Aperte **Enter** (sem Shift): executa a ação de **Substituir** o texto original pelo corrigido.
    - Aperte **Esc**: fecha o modal instantaneamente.

---

## 7. Substituição em Campos e Editores de Texto

Teste clicar no botão **"Substituir"** (ou apertar **Enter**):

- [ ] **Campo de Texto Simples (`<input>`):**
  - Selecione a frase ou posicione o cursor, abra o modal e clique em **Substituir**.
  - **Esperado:** O valor do input é atualizado com o texto corrigido, eventos de `input` e `change` são disparados e o foco permanece no campo.
- [ ] **Área de Texto Longa (`<textarea>`):**
  - Selecione apenas uma linha no meio de um parágrafo longo e corrija.
  - Clique em **Substituir**.
  - **Esperado:** Apenas o trecho selecionado é substituído; o restante do texto do textarea permanece intocado.
- [ ] **Editor Rico (`contentEditable` / Notion / Google Docs / TipTap / Gmail):**
  - Selecione um trecho em uma `div contenteditable="true"`.
  - Corrija e clique em **Substituir**.
  - **Esperado:** 
    - O texto selecionado dentro da div rica é substituído diretamente no DOM.
    - O foco é mantido no editor rico.
    - **NÃO** exibe mensagem de *"Apenas copiado"*.
- [ ] **Texto Estático (Somente Leitura):**
  - Selecione um parágrafo estático de um artigo da Wikipedia ou notícia.
  - Corrija ou traduza e clique em **Substituir**.
  - **Esperado:** Como o elemento não é editável, o texto corrigido é copiado automaticamente para a área de transferência com notificação/alerta ao usuário para colar com `Ctrl+V`.
- [ ] **Botão Copiar Dedicado:**
  - Clique no botão com ícone de prancheta (**Copiar**).
  - **Esperado:** O texto é copiado para o clipboard e o ícone muda para um check verde temporário de 2 segundos.

---

## 8. Laboratório de Testes Embutido

Abra a página pelo popup ou via URL da extensão: `tabs/test.html`.

- [ ] **Teste 1 - Campo Simples:** Testar seleção, correção, tradução e substituição.
- [ ] **Teste 2 - Textarea:** Testar substituição parcial e atalho Alt+C sem seleção prévia.
- [ ] **Teste 3 - Editor Rico:** Testar seleção dentro da div `contentEditable`, troca de idioma e substituição direta no nó DOM.
- [ ] **Teste 4 - Botão de Reset:**
  - Clique no botão **"Reiniciar Textos de Exemplo"**.
  - **Esperado:** Todos os campos voltam para o estado original com erros para novos testes.

---

## 9. Casos de Borda e Tratamento de Erros

- [ ] **Tentativa sem API Key configurada:**
  - Remova a chave no popup e tente corrigir um texto.
  - **Esperado:** O modal exibe mensagem amigável em vermelho: *"API Key da Groq não configurada. Abra a extensão no navegador e salve sua chave gratuita."*
- [ ] **Chave inválida:**
  - Configure uma chave inexistente (ex: `gsk_invalida123`).
  - **Esperado:** O modal captura a resposta HTTP 401 da Groq e exibe a mensagem de erro da API sem quebrar a extensão.
- [ ] **Texto com menos de 2 caracteres:**
  - Selecione apenas 1 letra.
  - **Esperado:** O botão não surge (evita ativações acidentais).
- [ ] **Texto com formatações especiais e emojis:**
  - Teste corrigir/traduzir textos contendo quebras de linha, números, links e emojis:
    - Exemplo: `“Ola amigo! 🚀 nois vai viaja amanha as 10h?”`
  - **Esperado:** A IA preserva os emojis e a pontuação original.

---

### 📊 Resumo dos Resultados dos Testes

| Módulo / Funcionalidade | Status | Observações |
|---|---|---|
| Obtenção & Configuração da Chave Groq | 🟢 Aprovado | 100% gratuita via Groq Console, sem cartão |
| Popup (Salvar/Editar/Remover chave) | 🟢 Aprovado | Persistência via Plasmo Storage |
| Atalho Alt + C (Na página e Global) | 🟢 Aprovado | Listener direto em fase de captura |
| Modo ⚡ Corrigir | 🟢 Aprovado | Substituição direta sem preâmbulos |
| Modo 🌐 Traduzir (Padrão Inglês) | 🟢 Aprovado | Tradução com alta fidelidade |
| Seletor de Idiomas Dinâmico | 🟢 Aprovado | 9 idiomas com re-tradução instantânea |
| Substituição em Inputs/Textareas | 🟢 Aprovado | Dispara eventos `input` e `change` |
| Substituição em ContentEditable (Rico)| 🟢 Aprovado | Restauração de Range e fallback DOM |
| Histórico e Blacklist de Domínios | 🟢 Aprovado | Gerenciável via Página de Opções |
