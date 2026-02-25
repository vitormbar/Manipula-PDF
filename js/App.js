/**
 * App
 *
 * Orquestrador central da aplicação.
 *
 * Responsabilidade: conectar FileManager, PdfProcessor e UIController,
 * coordenando o fluxo de dados entre eles sem conter lógica de negócio
 * própria (essa fica encapsulada nas classes especializadas).
 *
 * Padrão utilizado: Mediator — o App age como mediador entre os módulos,
 * evitando que eles se referenciem diretamente entre si.
 */
class App {
  constructor() {
    this._fileManager  = new FileManager();
    this._pdfProcessor = new PdfProcessor();

    // Estado do painel de extração: arquivo fonte e total de páginas.
    // Mantidos aqui pois são dados de negócio, não de apresentação.
    this._extractSourceFile = null;
    this._extractPageCount  = 0;

    // O UIController recebe os handlers como injeção de dependência,
    // seguindo o princípio de Inversão de Dependência (SOLID - D).
    this._uiController = new UIController({
      // Painel: Unir PDFs
      onFilesAdded:    (files) => this._handleFilesAdded(files),
      onFileRemoved:   (index) => this._handleFileRemoved(index),
      onSortRequested: ()      => this._handleSortRequested(),
      onClearRequested:()      => this._handleClearRequested(),
      onMergeRequested:()      => this._handleMergeRequested(),
      // Painel: Extrair Páginas
      onExtractFileSelected: (file) => this._handleExtractFileSelected(file),
      onExtractFileRemoved:  ()     => this._handleExtractFileRemoved(),
      onExtractRequested:    ()     => this._handleExtractRequested(),
    });
  }

  // ─── Handlers de eventos da UI ─────────────────────────────────────────────

  /**
   * Processa arquivos adicionados pelo usuário (via seletor ou drag & drop).
   * Aplica a ordenação natural automaticamente após cada adição.
   *
   * @param {File[]} incomingFiles
   */
  _handleFilesAdded(incomingFiles) {
    const pdfFiles = incomingFiles.filter(file => file.type === 'application/pdf');

    const rejectedCount = incomingFiles.length - pdfFiles.length;
    if (rejectedCount > 0) {
      this._uiController.showToast(
        `${rejectedCount} arquivo${rejectedCount > 1 ? 's' : ''} ignorado${rejectedCount > 1 ? 's' : ''}: apenas PDFs são aceitos.`,
        'error'
      );
    }

    if (pdfFiles.length === 0) return;

    const { added, skipped } = this._fileManager.addFiles(pdfFiles);

    if (skipped > 0) {
      this._uiController.showToast(
        `${skipped} arquivo${skipped > 1 ? 's duplicados foram ignorados' : ' duplicado foi ignorado'}.`,
        'info'
      );
    }

    if (added > 0) {
      // Ordena automaticamente após cada adição para manter a lista consistente
      this._fileManager.sortByNaturalAlphabeticalOrder();
      this._refreshFileList();

      this._uiController.showToast(
        `${added} arquivo${added > 1 ? 's adicionados' : ' adicionado'}.`,
        'success'
      );
    }
  }

  /**
   * Remove o arquivo na posição indicada e atualiza a interface.
   *
   * @param {number} index
   */
  _handleFileRemoved(index) {
    try {
      this._fileManager.removeFileAt(index);
      this._refreshFileList();
    } catch (error) {
      this._uiController.showToast(error.message, 'error');
    }
  }

  /**
   * Ordena a lista atual em ordem alfabética natural e atualiza a interface.
   */
  _handleSortRequested() {
    if (this._fileManager.isEmpty()) return;

    this._fileManager.sortByNaturalAlphabeticalOrder();
    this._refreshFileList();
    this._uiController.showToast('Arquivos ordenados em ordem alfabética.', 'success');
  }

  /**
   * Remove todos os arquivos da lista.
   */
  _handleClearRequested() {
    this._fileManager.clearAll();
    this._refreshFileList();
  }

  /**
   * Inicia o processo de união dos PDFs.
   * Exibe progresso ao usuário e dispara o download do arquivo resultante.
   */
  async _handleMergeRequested() {
    if (this._fileManager.isEmpty()) {
      this._uiController.showToast('Adicione ao menos um arquivo PDF.', 'error');
      return;
    }

    const filesToMerge = this._fileManager.getFiles();

    this._uiController.setProcessingState(true);
    this._uiController.setProgressState(true, 0, 'Iniciando processamento…');

    try {
      const mergedPdfBytes = await this._pdfProcessor.mergePdfs(
        filesToMerge,
        (percentage) => {
          this._uiController.setProgressState(
            true,
            percentage,
            `Processando… ${percentage}%`
          );
        }
      );

      this._uiController.setProgressState(true, 100, 'Finalizando…');

      this._downloadPdfFile(mergedPdfBytes, this._buildOutputFileName());

      this._uiController.showToast(
        `PDF gerado com sucesso! (${filesToMerge.length} arquivo${filesToMerge.length > 1 ? 's' : ''} unido${filesToMerge.length > 1 ? 's' : ''})`,
        'success',
        6000
      );
    } catch (error) {
      this._uiController.showToast(`Erro: ${error.message}`, 'error', 6000);
    } finally {
      this._uiController.setProcessingState(false);
      // Pequena pausa para o usuário ver a barra em 100% antes de ocultar
      setTimeout(() => this._uiController.setProgressState(false), 600);
    }
  }

  // ─── Métodos privados ──────────────────────────────────────────────────────

  /**
   * Sincroniza a UI com o estado atual do FileManager.
   */
  _refreshFileList() {
    this._uiController.renderFileList(this._fileManager.getFiles());
  }

  // ─── Handlers do painel: Extrair Páginas ──────────────────────────────────

  /**
   * Carrega o PDF selecionado para obter seu total de páginas.
   * Exibe informações do arquivo e revela a seção de configuração de extração.
   *
   * @param {File} file
   */
  async _handleExtractFileSelected(file) {
    if (file.type !== 'application/pdf') {
      this._uiController.showToast('Apenas arquivos PDF são aceitos.', 'error');
      return;
    }

    try {
      const pageCount = await this._pdfProcessor.getPageCount(file);
      this._extractSourceFile = file;
      this._extractPageCount  = pageCount;
      this._uiController.renderExtractFileInfo(file, pageCount);
    } catch (error) {
      this._uiController.showToast(`Erro ao abrir o arquivo: ${error.message}`, 'error');
    }
  }

  /**
   * Limpa o estado do painel de extração quando o usuário remove o arquivo.
   */
  _handleExtractFileRemoved() {
    this._extractSourceFile = null;
    this._extractPageCount  = 0;
    this._uiController.clearExtractPanel();
  }

  /**
   * Executa a extração de páginas e dispara o download do resultado.
   * Valida os intervalos antes de iniciar o processamento.
   */
  async _handleExtractRequested() {
    if (!this._extractSourceFile) {
      this._uiController.showToast('Selecione um arquivo PDF primeiro.', 'error');
      return;
    }

    const rangeText = this._uiController.getExtractPageRanges();
    const { pages: pageIndices, errors } =
      PageRangeParser.parse(rangeText, this._extractPageCount);

    if (errors.length > 0) {
      this._uiController.showToast(
        'Corrija os erros no campo de páginas antes de extrair.',
        'error'
      );
      return;
    }

    if (pageIndices.length === 0) {
      this._uiController.showToast('Informe ao menos uma página para extrair.', 'error');
      return;
    }

    this._uiController.setExtractProcessingState(true);
    this._uiController.setExtractProgressState(true, 0, 'Iniciando extração…');

    try {
      const extractedPdfBytes = await this._pdfProcessor.extractPages(
        this._extractSourceFile,
        pageIndices,
        (percentage) => {
          this._uiController.setExtractProgressState(
            true,
            percentage,
            `Extraindo páginas… ${percentage}%`
          );
        }
      );

      this._uiController.setExtractProgressState(true, 100, 'Finalizando…');

      const outputFileName = this._uiController.getExtractOutputFileName();
      this._downloadPdfFile(extractedPdfBytes, outputFileName);

      const pageWord = pageIndices.length === 1 ? 'página extraída' : 'páginas extraídas';
      this._uiController.showToast(
        `${pageIndices.length} ${pageWord} com sucesso!`,
        'success',
        6000
      );
    } catch (error) {
      this._uiController.showToast(`Erro: ${error.message}`, 'error', 6000);
    } finally {
      this._uiController.setExtractProcessingState(false);
      setTimeout(() => this._uiController.setExtractProgressState(false), 600);
    }
  }

  // ─── Helpers compartilhados ────────────────────────────────────────────────

  /**
   * Delega ao UIController a geração do nome do arquivo de saída,
   * respeitando os campos Nome, CPF e nome personalizado informados pelo usuário.
   *
   * A lógica de prioridade (Nome+CPF → só Nome → só CPF → personalizado → fallback)
   * fica encapsulada no UIController, que é quem detém o estado dos inputs.
   *
   * @returns {string} Ex.: "Joao_Silva_12345678909_ANALISE.pdf"
   */
  _buildOutputFileName() {
    return this._uiController.getOutputFileName();
  }

  /**
   * Dispara o download de um arquivo PDF no navegador sem abrir nova aba.
   *
   * @param {Uint8Array} pdfBytes - Conteúdo do PDF em bytes
   * @param {string}     fileName - Nome sugerido para o arquivo salvo
   */
  _downloadPdfFile(pdfBytes, fileName) {
    const blob      = new Blob([pdfBytes], { type: 'application/pdf' });
    const objectUrl = URL.createObjectURL(blob);

    const temporaryLink  = document.createElement('a');
    temporaryLink.href   = objectUrl;
    temporaryLink.download = fileName;

    document.body.appendChild(temporaryLink);
    temporaryLink.click();
    document.body.removeChild(temporaryLink);

    // Libera memória assim que o download foi iniciado
    URL.revokeObjectURL(objectUrl);
  }
}

// ─── Inicialização ─────────────────────────────────────────────────────────────
// Aguarda o DOM estar completamente carregado antes de instanciar a aplicação.
// A referência em window._app é útil apenas para desenvolvimento/debug;
// não deve ser usada em lógica de produção.
document.addEventListener('DOMContentLoaded', () => {
  window._app = new App();
});
