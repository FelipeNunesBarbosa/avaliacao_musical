# Visão do projeto

Site de uso exclusivo dos secretários da música da CCB para preparar fichas de avaliação de candidatos a músico a partir do relatório de membros em PDF.
Substitui a consulta e o preenchimento manual dos dados, mantendo o modelo da ficha utilizada pela secretaria.

# Stack e execução

- HTML, CSS e JavaScript puros, sem frameworks e sem instalar dependências.
- PDF.js e pdf-lib são bibliotecas locais: o processamento do relatório e a geração das fichas ocorrem no navegador, sem envio dos dados a um servidor.
- Execute `iniciar.ps1` para abrir o site pelo servidor local. A leitura do modelo da ficha depende desse servidor.
- O site deve continuar responsivo para computador e celular.

# Estrutura de arquivos

- `index.html` — interface, filtros, tabela, conferência dos dados e ações.
- `style.css` — visual responsivo e regras de impressão.
- `script.js` — importação, tratamento dos dados, filtros, seleção e emissão das fichas.
- `inspiracoes/` — referências e `ficha-base.jpg`, modelo visual da ficha.
- `vendor/` — bibliotecas locais e licenças. Os arquivos DOCX presentes na pasta são legados e não são carregados pelo site.
- `iniciar.ps1` — servidor local em PowerShell, sem instalação.

# Fluxo e regras funcionais

- Importar o relatório de membros em PDF e mostrar todos os membros em uma tabela. O relatório habitual pode ter mais páginas e registros que os exemplos.
- Permitir pesquisa e filtros por localidade, instrumento e nível. Cada filtro aceita várias opções por caixas de seleção; opções do mesmo filtro se somam, e filtros diferentes se combinam.
- Permitir selecionar membros individualmente ou todos os resultados visíveis. O botão **Desmarcar todos** limpa a seleção inteira, inclusive membros ocultos pelos filtros atuais.
- Conferir e editar nome, instrumento, localidade, município e encarregado antes da emissão.
- Sugerir o encarregado pela mesma localidade: primeiro quem tem o cargo **Encarregado Local**; se não houver, **Encarregado Regional**; se nenhum existir, deixar em branco. Preservar alterações manuais.
- O relatório não fornece município. Oferecer sugestões dos 25 municípios da Região Metropolitana de Londrina nos campos individual e coletivo, mas aceitar qualquer município digitado. Exigir município para cada selecionado antes de gerar a ficha.
- Apresentar dados importados e editados com iniciais maiúsculas e demais letras minúsculas, mantendo preposições usuais em minúsculas e siglas/numerais como **RJM** e **II**. Aplicar o mesmo formato na tabela, na conferência, no PDF e na impressão.
- Gerar até duas fichas diferentes por folha A4, usando o modelo original. Se houver quantidade ímpar de selecionados, a segunda metade da última folha deve ficar em branco.
- Manter um pequeno espaço entre as bordas esquerdas dos campos da ficha e os dados preenchidos, tanto no PDF quanto na impressão.
- Oferecer apenas **Baixar PDF** e **Imprimir** como formas de emissão. Não oferecer DOCX: a versão anterior era uma imagem sem campos editáveis.

# Privacidade e manutenção

- Os relatórios e dados dos membros devem permanecer no dispositivo do usuário.
- Preserve o formato da ficha e o comportamento dos filtros e da seleção ao alterar a interface ou a geração do PDF.
