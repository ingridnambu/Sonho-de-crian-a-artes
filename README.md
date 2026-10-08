# Sonho de Criança Art's

## Iniciar a loja

É necessário ter o Node.js 22.13 ou superior instalado.

No PowerShell, dentro da pasta do projeto, execute:

```powershell
node server.js
```

Abra `http://localhost:3000` no navegador. Não abra `index.html` diretamente pelo Explorador de Arquivos: o cadastro, o login e o registro de pedidos precisam do servidor em execução.

O servidor cria automaticamente o banco SQLite em `data/loja.sqlite`. Os cadastros guardam senhas com hash e salt; sessões usam cookies `HttpOnly`, e as solicitações de pedido validam os produtos e preços no servidor.

O botão de tema no cabeçalho alterna entre os modos claro e escuro. A escolha fica salva neste navegador e também é aplicada na página da conta.

Na galeria, o campo “Buscar produtos” filtra os itens pelo nome ou pela descrição da imagem e funciona junto com os filtros de categoria. A busca não diferencia letras maiúsculas de minúsculas nem acentos.

## Contas e pedidos

- A pessoa pode criar uma conta com nome, e-mail, telefone brasileiro com DDD e senha de pelo menos 4 caracteres.
- A área “Minha conta” mostra os dados do cadastro, os itens do carrinho deste navegador, os produtos favoritos e o histórico de pedidos.
- O carrinho fica salvo no navegador; os favoritos de uma conta e os pedidos ficam no banco e acompanham a pessoa quando ela entrar em outro dispositivo.
- Quando uma pessoa conectada finaliza uma compra, o servidor grava o pedido e os itens no banco antes de encaminhá-la ao WhatsApp.
- O histórico mostra os pedidos registrados naquela conta. Produtos sem preço cadastrado ficam com o valor a combinar.
- O status inicial é “Aguardando contato pelo WhatsApp”. A loja ainda não tem verificação de e-mail, recuperação de senha ou uma tela administrativa para alterar o status.

## Testes

```powershell
node --test test/server.test.js
```

## Hospedagem e cópias de segurança

Este primeiro banco é um arquivo local SQLite. Para publicar o site, use uma hospedagem que execute Node.js e mantenha armazenamento persistente para `data/loja.sqlite`; hospedagem apenas de arquivos estáticos não executa o login. Configure HTTPS antes de aceitar cadastros reais e faça cópias de segurança periódicas do banco. Não publique nem envie o arquivo do banco para o navegador.
