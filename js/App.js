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

    // Estado do painel de divisão.
    this._splitSourceFile = null;
    this._splitPageCount  = 0;

    // Estado do painel de organização.
    // `_organizePageStates` rastreia a ordem atual e a rotação adicional de cada
    // página: [{originalIndex: number, rotation: number}].
    this._organizeSourceFile     = null;
    this._organizePageCount      = 0;
    this._organizePageStates     = [];
    // `_organizeBaseThumbnails` armazena as miniaturas na orientação original
    // (rotação=0), renderizadas uma única vez ao carregar o arquivo.
    // Usadas para restaurar o estado visual no "Redefinir" sem nova renderização.
    this._organizeBaseThumbnails = new Map(); // Map<originalIndex, dataUrl>
    this._organizeThumbnails     = new Map(); // Map<originalIndex, dataUrl> — estado atual
    this._organizePdfJsDoc       = null;      // Documento PDF.js (reusado para re-renderizar)

    // Configura o worker do PDF.js para renderização offscreen das miniaturas.
    // O worker isola o processamento pesado em uma thread separada.
    if (typeof pdfjsLib !== 'undefined') {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

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
      // Painel: Organizar Páginas
      onOrganizeFileSelected: (file)                    => this._handleOrganizeFileSelected(file),
      onOrganizeFileRemoved:  ()                        => this._handleOrganizeFileRemoved(),
      onOrganizePageRotated:  (position, direction)     => this._handleOrganizePageRotated(position, direction),
      onOrganizePageMoved:    (fromPosition, toPosition)=> this._handleOrganizePageMoved(fromPosition, toPosition),
      onOrganizeResetRequested:         ()                    => this._handleOrganizeResetRequested(),
      onOrganizeDeleteSelectedRequested:(selectedPositions)  => this._handleOrganizeDeleteSelected(selectedPositions),
      onOrganizeRequested:              ()                   => this._handleOrganizeRequested(),
      // Painel: Dividir PDF
      onSplitFileSelected: (file) => this._handleSplitFileSelected(file),
      onSplitFileRemoved:  ()     => this._handleSplitFileRemoved(),
      onSplitRequested:    ()     => this._handleSplitRequested(),
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

  // ─── Handlers do painel: Organizar Páginas ────────────────────────────────

  /**
   * Carrega o PDF e inicializa o estado de cada página na ordem original,
   * sem rotação adicional.
   *
   * @param {File} file
   */
  async _handleOrganizeFileSelected(file) {
    if (file.type !== 'application/pdf') {
      this._uiController.showToast('Apenas arquivos PDF são aceitos.', 'error');
      return;
    }

    try {
      const pageCount = await this._pdfProcessor.getPageCount(file);

      this._organizeSourceFile     = file;
      this._organizePageCount      = pageCount;
      this._organizePageStates     = this._buildInitialPageStates(pageCount);
      this._organizeBaseThumbnails = new Map();
      this._organizeThumbnails     = new Map();
      this._organizePdfJsDoc       = null;

      this._uiController.renderOrganizeFileInfo(file, pageCount);
      this._uiController.renderOrganizePageGrid(this._organizePageStates, this._organizeThumbnails);

      // Renderiza miniaturas em segundo plano — não bloqueia a interface.
      // Os cartões atualizam progressivamente à medida que cada página é processada.
      this._renderOrganizeThumbnailsInBackground(file);
    } catch (error) {
      this._uiController.showToast(`Erro ao abrir o arquivo: ${error.message}`, 'error');
    }
  }

  /**
   * Limpa todo o estado do painel de organização.
   */
  _handleOrganizeFileRemoved() {
    this._organizeSourceFile     = null;
    this._organizePageCount      = 0;
    this._organizePageStates     = [];
    // Libera referências para permitir garbage collection do documento PDF.js
    this._organizePdfJsDoc       = null;
    this._organizeBaseThumbnails = new Map();
    this._organizeThumbnails     = new Map();
    this._uiController.clearOrganizePanel();
  }

  /**
   * Aplica uma rotação de ±90° na página da posição indicada.
   *
   * @param {number} position  - Posição atual da página no grid (0-based)
   * @param {'left'|'right'} direction - Sentido da rotação
   */
  async _handleOrganizePageRotated(position, direction) {
    const rotationDelta  = direction === 'right' ? 90 : -90;
    const currentState   = this._organizePageStates[position];
    // Normaliza para [0, 360) independentemente de valores negativos
    const newRotation    = ((currentState.rotation + rotationDelta) % 360 + 360) % 360;

    this._organizePageStates[position] = { ...currentState, rotation: newRotation };

    // Re-renderiza a miniatura da página afetada com a nova rotação.
    // As demais miniaturas permanecem em cache — sem custo extra.
    const updatedDataUrl = await this._renderPageThumbnail(
      currentState.originalIndex,
      newRotation
    );
    if (updatedDataUrl) {
      this._organizeThumbnails.set(currentState.originalIndex, updatedDataUrl);
    }

    this._uiController.renderOrganizePageGrid(this._organizePageStates, this._organizeThumbnails);
  }

  /**
   * Move a página de `fromPosition` para `toPosition`, deslocando as demais.
   *
   * @param {number} fromPosition
   * @param {number} toPosition
   */
  _handleOrganizePageMoved(fromPosition, toPosition) {
    const isOutOfBounds =
      fromPosition < 0 || fromPosition >= this._organizePageStates.length ||
      toPosition   < 0 || toPosition   >= this._organizePageStates.length;

    if (fromPosition === toPosition || isOutOfBounds) return;

    const updatedStates     = [...this._organizePageStates];
    const [displacedPage]   = updatedStates.splice(fromPosition, 1);
    updatedStates.splice(toPosition, 0, displacedPage);

    this._organizePageStates = updatedStates;
    this._uiController.renderOrganizePageGrid(this._organizePageStates, this._organizeThumbnails);
  }

  /**
   * Remove do documento todas as páginas marcadas para exclusão.
   * Impede que o usuário exclua a última página restante.
   *
   * @param {Set<number>} selectedPositions - Posições 0-based a remover
   */
  _handleOrganizeDeleteSelected(selectedPositions) {
    if (selectedPositions.size === 0) return;

    if (selectedPositions.size >= this._organizePageStates.length) {
      this._uiController.showToast(
        'Não é possível excluir todas as páginas do documento.',
        'error'
      );
      return;
    }

    this._organizePageStates = this._organizePageStates.filter(
      (_, index) => !selectedPositions.has(index)
    );

    const count     = selectedPositions.size;
    const pageWord  = count === 1 ? 'página excluída' : 'páginas excluídas';
    this._uiController.renderOrganizePageGrid(this._organizePageStates, this._organizeThumbnails);
    this._uiController.showToast(`${count} ${pageWord}.`, 'success');
  }

  /**
   * Restaura a ordem e rotação originais do documento.
   */
  _handleOrganizeResetRequested() {
    if (this._organizePageCount === 0) return;

    this._organizePageStates = this._buildInitialPageStates(this._organizePageCount);
    // Restaura as miniaturas originais sem precisar re-renderizar nenhuma página.
    // As base thumbnails (rotação=0) foram geradas uma única vez ao carregar o arquivo.
    this._organizeThumbnails = new Map(this._organizeBaseThumbnails);
    this._uiController.renderOrganizePageGrid(this._organizePageStates, this._organizeThumbnails);
    this._uiController.showToast('Páginas redefinidas para a ordem original.', 'info');
  }

  /**
   * Processa o PDF aplicando a ordem e rotações configuradas pelo usuário.
   */
  async _handleOrganizeRequested() {
    if (!this._organizeSourceFile) {
      this._uiController.showToast('Selecione um arquivo PDF primeiro.', 'error');
      return;
    }

    this._uiController.setOrganizeProcessingState(true);
    this._uiController.setOrganizeProgressState(true, 0, 'Reorganizando páginas…');

    try {
      const organizedPdfBytes = await this._pdfProcessor.organizePages(
        this._organizeSourceFile,
        this._organizePageStates,
        (percentage) => {
          this._uiController.setOrganizeProgressState(
            true,
            percentage,
            `Processando… ${percentage}%`
          );
        }
      );

      this._uiController.setOrganizeProgressState(true, 100, 'Finalizando…');

      const outputFileName = this._uiController.getOrganizeOutputFileName();
      this._downloadPdfFile(organizedPdfBytes, outputFileName);

      this._uiController.showToast('PDF salvo com sucesso!', 'success', 6000);
    } catch (error) {
      this._uiController.showToast(`Erro: ${error.message}`, 'error', 6000);
    } finally {
      this._uiController.setOrganizeProcessingState(false);
      setTimeout(() => this._uiController.setOrganizeProgressState(false), 600);
    }
  }

  // ─── Handlers do painel: Dividir PDF ──────────────────────────────────────

  /**
   * Carrega o PDF selecionado, obtém o total de páginas e revela a configuração.
   *
   * @param {File} file
   */
  async _handleSplitFileSelected(file) {
    if (file.type !== 'application/pdf') {
      this._uiController.showToast('Apenas arquivos PDF são aceitos.', 'error');
      return;
    }

    try {
      const pageCount      = await this._pdfProcessor.getPageCount(file);
      this._splitSourceFile = file;
      this._splitPageCount  = pageCount;
      this._uiController.renderSplitFileInfo(file, pageCount);
    } catch (error) {
      this._uiController.showToast(`Erro ao abrir o arquivo: ${error.message}`, 'error');
    }
  }

  /**
   * Limpa o estado do painel de divisão quando o usuário remove o arquivo.
   */
  _handleSplitFileRemoved() {
    this._splitSourceFile = null;
    this._splitPageCount  = 0;
    this._uiController.clearSplitPanel();
  }

  /**
   * Executa a divisão do PDF no modo selecionado e dispara o download de cada parte.
   *
   * As partes são baixadas em sequência, com um intervalo de 150 ms entre cada
   * download para evitar que o navegador bloqueie múltiplos downloads simultâneos.
   * O nome de cada parte segue o padrão: `{prefixo}_pag{inicio}-{fim}.pdf`.
   */
  async _handleSplitRequested() {
    if (!this._splitSourceFile) {
      this._uiController.showToast('Selecione um arquivo PDF primeiro.', 'error');
      return;
    }

    const mode   = this._uiController.getSplitMode();
    const prefix = this._uiController.getSplitOutputPrefix()
      || this._splitSourceFile.name.replace(/\.pdf$/i, '');

    this._uiController.setSplitProcessingState(true);
    this._uiController.setSplitProgressState(true, 0, 'Iniciando divisão…');

    try {
      let chunks;

      if (mode === 'pages') {
        const pagesPerPart = this._uiController.getSplitPageCount();

        if (!pagesPerPart || pagesPerPart < 1) {
          this._uiController.showToast(
            'Informe ao menos 1 página por parte.',
            'error'
          );
          return;
        }

        chunks = await this._pdfProcessor.splitByPageCount(
          this._splitSourceFile,
          pagesPerPart,
          (pct) => this._uiController.setSplitProgressState(
            true, pct, `Dividindo… ${pct}%`
          )
        );
      } else {
        const targetBytes = this._uiController.getSplitFileSizeBytes();

        if (!targetBytes || targetBytes <= 0) {
          this._uiController.showToast(
            'Informe um tamanho-limite válido.',
            'error'
          );
          return;
        }

        chunks = await this._pdfProcessor.splitByFileSize(
          this._splitSourceFile,
          targetBytes,
          (pct) => this._uiController.setSplitProgressState(
            true, pct, `Analisando páginas… ${pct}%`
          )
        );
      }

      this._uiController.setSplitProgressState(true, 100, 'Finalizando…');

      // Baixa cada parte com intervalo para evitar bloqueio do navegador.
      for (let i = 0; i < chunks.length; i++) {
        const { bytes, startPage, endPage } = chunks[i];
        const partFileName = `${prefix}_pag${startPage + 1}-${endPage + 1}.pdf`;

        await new Promise(resolve => setTimeout(resolve, i * 150));
        this._downloadPdfFile(bytes, partFileName);
      }

      const partWord = chunks.length === 1 ? 'parte' : 'partes';
      this._uiController.showToast(
        `PDF dividido em ${chunks.length} ${partWord} com sucesso!`,
        'success',
        7000
      );
    } catch (error) {
      this._uiController.showToast(`Erro: ${error.message}`, 'error', 6000);
    } finally {
      this._uiController.setSplitProcessingState(false);
      setTimeout(() => this._uiController.setSplitProgressState(false), 600);
    }
  }

  /**
   * Renderiza todas as miniaturas em segundo plano usando PDF.js.
   *
   * As páginas são processadas em sequência para evitar sobrecarga do worker.
   * Cada miniatura é armazenada em `_organizeBaseThumbnails` (rotação=0) e em
   * `_organizeThumbnails`, e o cartão correspondente é atualizado imediatamente
   * na interface — sem re-renderizar o grid inteiro.
   *
   * Falhas silenciosas: se PDF.js não estiver disponível ou o arquivo for
   * inválido, a funcionalidade de organização continua normando normalmente
   * com os cartões no estilo de placeholder (linhas decorativas).
   *
   * @param {File} file
   */
  async _renderOrganizeThumbnailsInBackground(file) {
    if (typeof pdfjsLib === 'undefined') return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      this._organizePdfJsDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

      const totalPages = this._organizePdfJsDoc.numPages;

      for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
        // Para imediatamente se o arquivo foi removido durante a renderização
        if (!this._organizePdfJsDoc) return;

        const originalIndex = pageNumber - 1;
        const dataUrl       = await this._renderPageThumbnail(originalIndex, 0);

        if (dataUrl) {
          this._organizeBaseThumbnails.set(originalIndex, dataUrl);
          this._organizeThumbnails.set(originalIndex, dataUrl);
          // Atualiza apenas o <img> do cartão, sem reconstruir o grid inteiro
          this._uiController.updateOrganizeThumbnail(originalIndex, dataUrl);
        }
      }
    } catch {
      // Miniaturas são um recurso de conforto visual; falha não deve interromper
      // a funcionalidade principal de reorganização do documento.
    }
  }

  /**
   * Renderiza uma única página como miniatura JPEG usando PDF.js.
   *
   * A rotação final é a soma da rotação inerente da página no PDF com a
   * rotação adicional aplicada pelo usuário, garantindo consistência com
   * o resultado produzido pelo pdf-lib em `organizePages()`.
   *
   * @param {number} originalIndex - Índice 0-based da página no documento original
   * @param {number} userRotation  - Rotação adicional do usuário (0, 90, 180, 270)
   * @returns {Promise<string|null>} Data URL JPEG ou null se falhar
   */
  async _renderPageThumbnail(originalIndex, userRotation) {
    if (!this._organizePdfJsDoc) return null;

    const THUMBNAIL_SCALE = 0.25;

    try {
      const page             = await this._organizePdfJsDoc.getPage(originalIndex + 1);
      const inherentRotation = page.rotate ?? 0;
      const totalRotation    = (inherentRotation + userRotation) % 360;

      const viewport = page.getViewport({ scale: THUMBNAIL_SCALE, rotation: totalRotation });
      const canvas   = document.createElement('canvas');
      canvas.width   = viewport.width;
      canvas.height  = viewport.height;

      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;

      return canvas.toDataURL('image/jpeg', 0.8);
    } catch {
      return null;
    }
  }

  /**
   * Gera o estado inicial das páginas: ordem sequencial, sem rotação extra.
   *
   * @param {number} pageCount - Total de páginas do documento
   * @returns {Array<{originalIndex: number, rotation: number}>}
   */
  _buildInitialPageStates(pageCount) {
    return Array.from({ length: pageCount }, (_, index) => ({
      originalIndex: index,
      rotation: 0,
    }));
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
