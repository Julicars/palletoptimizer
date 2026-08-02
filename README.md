<div align="center">

# palletoptimizer

### Sistema inteligente de otimização de carga e apoio à operação logística

[![HTML5](https://img.shields.io/badge/HTML5-frontend-E34F26?logo=html5&logoColor=white)](https://developer.mozilla.org/docs/Web/HTML)
[![CSS3](https://img.shields.io/badge/CSS3-interface-1572B6?logo=css3&logoColor=white)](https://developer.mozilla.org/docs/Web/CSS)
[![JavaScript](https://img.shields.io/badge/JavaScript-lógica-F7DF1E?logo=javascript&logoColor=111)](https://developer.mozilla.org/docs/Web/JavaScript)
[![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-online-222?logo=github)](https://mrhoneys.github.io/palletoptimizer/)

[**Acessar o sistema**](https://mrhoneys.github.io/palletoptimizer/) · [Funcionalidades](#funcionalidades) · [Executar localmente](#executando-localmente)

</div>

## Sobre o projeto

O **palletoptimizer** é uma aplicação web voltada ao planejamento de cargas. O sistema reúne recursos para estimar o aproveitamento de veículos, simular cargas com pallets de dimensões diferentes e apoiar tarefas administrativas relacionadas ao transporte.

A versão atual apresenta cinco módulos principais:

- otimização de carga por dimensões;
- simulação de carga mista;
- cálculo de ICMS interestadual;
- consulta pública de CNPJ;
- controle de comprovantes de entrega ou embarque.

O objetivo é reduzir cálculos manuais, visualizar melhor a ocupação do veículo e concentrar informações operacionais em uma única interface.

> **Importante:** os resultados de cubagem são estimativas geométricas. Antes de executar uma operação real, valide peso total, capacidade do veículo, limites por eixo, amarração, estabilidade, restrições legais e características da mercadoria.

## Funcionalidades

### Otimização de carga

O módulo principal recebe o tipo de veículo e as dimensões do pallet em metros. A partir desses dados, apresenta os veículos compatíveis e a quantidade estimada de pallets.

Principais informações exibidas:

- quantidade total de pallets;
- distribuição em fileiras e colunas;
- quantidade de vagões ou compartimentos considerados;
- número de camadas;
- orientação sugerida para o pallet;
- representação visual das posições ocupadas.

<img width="1909" height="928" alt="02-resultados-otimizacao" src="https://github.com/user-attachments/assets/c0a4d5f3-bac6-45cd-8dfb-71c92f1225c0" />


### Carga mista

O simulador de carga mista permite trabalhar com mais de um modelo de pallet no mesmo veículo. Para cada item, podem ser informados comprimento, largura, altura e quantidade.

O posicionamento pode ser definido de três formas:

- automático, priorizando o melhor aproveitamento identificado pelo sistema;
- comprimento do pallet no sentido do comprimento do veículo;
- largura do pallet no sentido do comprimento do veículo.

O módulo também apresenta:

- vista superior do baú;
- identificação visual de cada grupo de pallets;
- quantidade solicitada e quantidade posicionada;
- espaço ocupado e espaço livre;
- total de pallets carregados;
- opção para excluir itens e recalcular a composição;
- finalização ou limpeza da carga.

<img width="1903" height="879" alt="03-carga-mista" src="https://github.com/user-attachments/assets/6b8406f7-e562-44c1-b5c8-446472a28bde" />

<img width="1908" height="757" alt="04-resumo-carga-mista" src="https://github.com/user-attachments/assets/2cc3cc5a-e8f1-4789-9376-8baa63323638" />


### Calculadora de ICMS

A calculadora permite selecionar o estado de origem, o estado de destino e informar o valor da NF-e. O sistema consulta a matriz de alíquotas exibida na própria tela e apresenta:

- alíquota aplicada;
- percentual em formato decimal;
- valor estimado do ICMS retirado;
- valor final sem o ICMS;
- resultado com ou sem arredondamento.

<img width="1904" height="918" alt="05-calculadora-icms" src="https://github.com/user-attachments/assets/672e2f82-ac60-4ce7-b3b5-6f85b77e0e64" />

> As alíquotas e regras tributárias podem sofrer alterações. Use o cálculo como apoio e valide a operação com a legislação vigente e com o setor fiscal ou contábil responsável.

### Consulta de CNPJ

O módulo de consulta permite informar um CNPJ válido e visualizar os dados cadastrais retornados pela API pública **CNPJ.ws**. A interface aceita o número com ou sem formatação e informa um limite público de consultas por minuto.

<img width="1914" height="909" alt="06-consulta-cnpj" src="https://github.com/user-attachments/assets/f3f5b93d-32a6-489b-8aaa-1cef5443f571" />

> A disponibilidade, o limite de requisições e o conteúdo retornado dependem do serviço externo utilizado.

### Gestão de comprovantes

O módulo de comprovantes organiza registros de embarque por:

- data;
- número da NF-e;
- cliente;
- transportadora;
- comprovante;
- status;
- ações disponíveis.

Também inclui:

- seleção de uma pasta-base;
- cadastro e gerenciamento de transportadoras;
- busca por NF-e, cliente ou transportadora;
- filtros para registros pendentes e recebidos;
- indicadores de quantidade total, pendências e comprovantes recebidos;
- organização automática dos arquivos em subpastas vinculadas ao cliente e à NF-e, conforme indicado pela interface.

<img width="1920" height="916" alt="07-comprovantes" src="https://github.com/user-attachments/assets/3c02e2da-e331-4b32-9c3a-d240c0962470" />

## Página principal

A página inicial concentra a configuração rápida do cálculo e o acesso aos demais módulos.

<img width="1920" height="922" alt="01-pagina-principal" src="https://github.com/user-attachments/assets/3c9cc3a7-4053-416d-855d-5b1d7bf4d1a5" />

## Tipos de veículos documentados

A documentação anterior do projeto relaciona os seguintes tipos de transporte:

- carretas;
- rodo-trem;
- trucks;
- veículos 3/4;
- vans de carga;
- containers.

A disponibilidade exata de modelos e dimensões depende das opções cadastradas na versão em execução.

## Fluxo básico de uso

1. Acesse a página **Principal**.
2. Selecione o tipo de veículo.
3. Informe comprimento, largura e altura do pallet.
4. Clique em **Calcular**.
5. Compare os veículos compatíveis e a capacidade estimada.
6. Para cargas com dimensões diferentes, abra **Carga Mista**, escolha o veículo e adicione cada grupo de pallets.
7. Use os demais módulos conforme a necessidade fiscal ou operacional.

## Tecnologias

O projeto foi documentado como uma aplicação frontend construída com:

- HTML5;
- CSS3;
- JavaScript.

Não há indicação, na documentação fornecida, de dependência obrigatória de backend próprio. Algumas funções dependem de recursos do navegador e de serviços externos, como a consulta pública de CNPJ.

## Executando localmente

Por ser uma aplicação web frontend, o projeto pode ser servido por um servidor HTTP local.

### Opção 1 — Visual Studio Code

1. Clone ou baixe o repositório.
2. Abra a pasta no Visual Studio Code.
3. Instale a extensão **Live Server**.
4. Abra o arquivo `index.html` com o Live Server.

### Opção 2 — Python

Na raiz do projeto, execute:

```bash
python -m http.server 8000
```

Depois, acesse:

```text
http://localhost:8000
```

### Clone do repositório

Substitua a URL abaixo pela URL real do repositório, caso ela seja diferente:

```bash
git clone https://github.com/SEU_USUARIO/palletoptimizer.git
cd palletoptimizer
```

## Publicação

A aplicação pode ser hospedada como site estático. A versão documentada está disponível em:

**https://mrhoneys.github.io/palletoptimizer/**

Para publicar uma cópia pelo GitHub Pages, configure o repositório para servir a pasta que contém o `index.html`.

## Limitações conhecidas

Com base na documentação anterior, os seguintes pontos ainda devem ser tratados como limitações ou itens de evolução:

- cálculo de peso total da carga;
- limite de peso por eixo;
- análise avançada de distribuição e estabilidade;
- ampliação dos modelos de veículos;
- evolução da visualização da ocupação da carga.

O simulador não substitui inspeção física, plano de amarração, documentação fiscal nem validação técnica da transportadora.

## Roadmap

- [ ] Incorporar peso por pallet e peso total.
- [ ] Validar capacidade máxima do veículo.
- [ ] Considerar limites e distribuição por eixo.
- [ ] Expandir o catálogo de veículos e configurações.
- [ ] Aprimorar a visualização da carga.
- [ ] Adicionar exportação ou impressão do plano de carregamento.
- [ ] Documentar a origem e a data de atualização das alíquotas de ICMS.
- [ ] Adicionar testes automatizados para os cálculos de cubagem.

## Público-alvo

O sistema pode apoiar:

- motoristas e caminhoneiros autônomos;
- ajudantes de carga;
- conferentes de expedição;
- transportadoras;
- operadores logísticos;
- equipes administrativas, fiscais e de faturamento.

## Boas práticas de operação

- Confira se todas as dimensões foram informadas na mesma unidade.
- Valide folgas necessárias para movimentação e amarração.
- Não use apenas a quantidade geométrica para definir a carga real.
- Considere peso, centro de gravidade, empilhamento permitido e fragilidade.
- Confirme dados fiscais antes de emitir ou corrigir documentos.
- Faça cópias de segurança da pasta usada para armazenar comprovantes.

## Contribuição

Contribuições podem ser feitas por meio de issues e pull requests. Ao relatar um problema, inclua:

- módulo afetado;
- passos para reproduzir;
- resultado esperado;
- resultado obtido;
- navegador e sistema operacional;
- capturas de tela, quando aplicável.

## Licença

A documentação anterior informa que o projeto é de uso livre para estudo e melhoria da logística, mas não apresenta uma licença de software padronizada.

Para definir claramente permissões de uso, modificação e redistribuição, adicione um arquivo `LICENSE` ao repositório. Até isso ocorrer, consulte o responsável pelo projeto antes de qualquer uso comercial ou redistribuição.

## Contato

**E-mail exibido na aplicação:** `juliobaldoo10@gmail.com`

---

<div align="center">

Desenvolvido para apoiar operações de cubagem, carregamento e controle logístico.

</div>
