# Meu Financeiro — app de controle financeiro (PWA)

App para registrar gastos (débito/crédito), acompanhar metas financeiras
(viagens, reservas, etc.) e lembretes de pagamento, com backup/sincronização
no seu próprio Google Drive. Funciona como um app instalado no iPhone, sem
precisar de App Store.

Os dados ficam salvos localmente no navegador (IndexedDB) e, se você
conectar o Google Drive, um arquivo `financeapp-backup.json` é mantido no
seu Drive para sincronizar entre aparelhos.

Este guia tem 3 partes: (1) colocar o app no ar com HTTPS, (2) configurar o
login do Google Drive, (3) instalar no iPhone.

## Parte 1 — Hospedar o app (GitHub Pages, grátis)

O app precisa estar em um endereço HTTPS de verdade para o login do Google
e o modo offline funcionarem (abrir o arquivo direto do computador não é
suficiente).

1. Crie uma conta gratuita em https://github.com se ainda não tiver.
2. Crie um novo repositório (pode ser público), por exemplo `meu-financeiro`.
3. Faça upload de todos os arquivos desta pasta (`financeapp/`) para a raiz
   do repositório — incluindo as subpastas `css/`, `js/` e `icons/`.
4. No repositório, vá em **Settings → Pages**.
5. Em "Source", selecione a branch `main` e a pasta `/root`, depois salve.
6. Depois de 1-2 minutos, o GitHub mostra o endereço do site, algo como:
   `https://SEU-USUARIO.github.io/meu-financeiro/`

Guarde essa URL — você vai precisar dela no próximo passo.

(Alternativas equivalentes: Netlify ou Vercel, se preferir. O processo de
configurar o Google muda só o endereço usado.)

## Parte 2 — Criar as credenciais do Google (para o Drive funcionar)

1. Acesse https://console.cloud.google.com e crie um novo projeto (nome
   sugerido: "Meu Financeiro").
2. No menu, vá em **APIs e Serviços → Biblioteca**, procure por
   **Google Drive API** e clique em **Ativar**.
3. Vá em **APIs e Serviços → Tela de consentimento OAuth**:
   - Tipo de usuário: **Externo**.
   - Preencha nome do app, seu e-mail de suporte e e-mail de contato.
   - Em "Escopos", não precisa adicionar nada manualmente.
   - Em "Usuários de teste", adicione o seu próprio e-mail do Google
     (o mesmo que você vai usar no app). Isso evita precisar passar pelo
     processo de verificação do Google, já que o app é só para uso pessoal.
4. Vá em **APIs e Serviços → Credenciais → Criar credenciais → ID do
   cliente OAuth**.
   - Tipo de aplicativo: **Aplicativo da Web**.
   - Em "Origens JavaScript autorizadas", adicione a URL do seu site do
     Passo 1, por exemplo: `https://SEU-USUARIO.github.io`
   - Não precisa preencher "URIs de redirecionamento".
   - Clique em Criar. Copie o **Client ID** gerado (algo como
     `123456789-abc.apps.googleusercontent.com`).
5. Abra o arquivo `js/config.js` no seu repositório e substitua:
   ```js
   GOOGLE_CLIENT_ID: 'SEU_CLIENT_ID_AQUI',
   ```
   pelo Client ID copiado. Salve e suba a alteração para o GitHub (isso
   atualiza o site automaticamente).

Pronto — na aba **Ajustes** do app, o botão "Conectar Google Drive" agora
vai funcionar. O escopo usado (`drive.file`) só dá acesso a um arquivo que
o próprio app cria no seu Drive, nunca ao resto dos seus arquivos.

> Observação: como o app fica em modo "Teste" no Google Cloud (sem
> verificação), o acesso funciona normalmente para você (usuário de teste)
> indefinidamente. Se um dia quiser tirar do modo teste e publicar para
> outras pessoas usarem, o Google pode pedir uma verificação — não é
> necessário para uso pessoal.

## Parte 3 — Instalar no iPhone

1. Abra a URL do site (do Passo 1) no **Safari** do iPhone (precisa ser o
   Safari, não Chrome).
2. Toque no ícone de **Compartilhar** (quadrado com seta para cima).
3. Toque em **Adicionar à Tela de Início**.
4. Confirme o nome e toque em **Adicionar**.

O app aparece com ícone próprio, abre em tela cheia, e funciona mesmo sem
internet (exceto a sincronização com o Drive, que exige conexão).

## Estrutura do projeto

```
financeapp/
├── index.html          → estrutura e telas do app
├── manifest.json        → configuração de instalação (PWA)
├── sw.js                 → cache offline
├── css/styles.css        → visual do app
├── js/config.js          → Client ID do Google (edite aqui)
├── js/db.js              → armazenamento local (IndexedDB)
├── js/drive.js            → sincronização com Google Drive
├── js/app.js              → lógica das telas e regras do app
└── icons/                 → ícones do app
```

## Backup manual (sem Google)

Mesmo sem configurar o Google, a aba **Ajustes** tem os botões **Exportar
dados** (baixa um `.json` com tudo) e **Importar backup** (restaura a
partir de um arquivo salvo). Útil como backup extra ou para migrar de
aparelho manualmente.

## Limitações desta primeira versão

- Conexão automática com bancos (Open Finance) não está incluída — exigiria
  um provedor pago (ex: Pluggy, Belvo) e um backend próprio. O registro de
  gastos aqui é manual, mas rápido (poucos toques).
- A sincronização com o Drive é "no momento em que você sincroniza", não em
  tempo real entre aparelhos abertos simultaneamente.
- Notificações push de lembretes não estão incluídas nesta versão (o app
  mostra os lembretes próximos/atrasados quando você abre).
