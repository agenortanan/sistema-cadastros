# Sistema de Cadastros

Sistema web com:

- **Login** e **criação de conta** (senhas com hash scrypt, sessão por cookie HttpOnly)
- **Cadastros**: Clientes, Fornecedores, Produtos e Materiais (listar, buscar, criar, editar, excluir)
- **Configurações**: dados da empresa, moeda, tema (claro/escuro/automático) e troca de senha

Cada conta enxerga apenas os próprios dados.

## Como rodar

Requer **Node.js 22.13 ou superior**. Não há nada para instalar (zero dependências).

```bash
cd sistema-cadastros
npm start          # ou: node --no-warnings server.js
```

Abra http://localhost:3000, clique em **Criar conta** e comece a usar.

Variáveis opcionais:

| Variável  | Padrão        | Para quê                                              |
|-----------|---------------|-------------------------------------------------------|
| `PORT`    | `3000`        | Porta do servidor                                     |
| `HOST`    | `127.0.0.1`   | Use `0.0.0.0` para acessar de outros computadores     |
| `DB_FILE` | `./dados.db`  | Caminho do arquivo do banco SQLite                    |

Os dados ficam no arquivo `dados.db`; para fazer backup, copie esse arquivo.

## Publicar de graça no Render (somente demonstração)

O plano gratuito do Render **apaga o disco** a cada reinício ou nova publicação, e o serviço
"dorme" após 15 minutos sem acesso. Como o banco é um arquivo SQLite, **todos os dados
(contas, clientes, produtos…) somem** nessas ocasiões. Use apenas para mostrar o sistema.

1. Envie esta pasta para um repositório no GitHub (o `.gitignore` já deixa o banco de fora).
2. No Render: **New → Blueprint**, escolha o repositório. O arquivo `render.yaml` já traz
   tudo configurado (plano free, comando de início, aviso de demonstração).
3. Aguarde a publicação e abra o endereço `https://…onrender.com` que o Render mostrar.

Para uso real, troque o SQLite por um banco que fique fora do servidor ou use hospedagem com
disco persistente. A variável `AVISO_DEMO` controla o aviso mostrado na tela (apague-a para
remover o aviso).

## Estrutura

```
server.js        servidor, API e banco de dados
public/
  index.html     página única
  app.js         telas (login, cadastros, configurações)
  style.css      visual (claro/escuro, responsivo)
```

## Adicionar um novo cadastro

Em `server.js`, adicione uma entrada em `ENTITIES` (com os campos). A tabela, a API
e as telas (lista, busca, formulário) são geradas automaticamente. O menu também.

## Antes de colocar na internet

- Use HTTPS (por exemplo, atrás de um proxy como Nginx ou Caddy).
- O limite de tentativas de login fica em memória e zera ao reiniciar.
- Ainda não há recuperação de senha por e-mail.
