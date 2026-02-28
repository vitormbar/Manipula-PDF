/**
 * PdfProcessor
 *
 * Responsabilidade única: executar operações sobre arquivos PDF.
 *
 * Atualmente implementa apenas a operação de união (merge).
 * A classe foi estruturada para receber futuras operações como:
 *   - split()    — dividir um PDF em múltiplos
 *   - compress() — reduzir o tamanho do arquivo
 *   - rotate()   — girar páginas
 *   - extract()  — extrair páginas específicas
 *
 * Depende da biblioteca pdf-lib (carregada via CDN no HTML).
 */
class PdfProcessor {
  /**
   * Une múltiplos arquivos PDF em um único documento, na ordem fornecida.
   *
   * Cada arquivo é lido como ArrayBuffer, carregado pelo pdf-lib e suas páginas
   * são copiadas — em sequência — para um novo documento em branco.
   *
   * @param {File[]} orderedPdfFiles - Arquivos na ordem desejada para o documento final
   * @param {function(number): void} onProgressUpdate - Callback chamado a cada arquivo
   *        processado, recebe a porcentagem de progresso (0–100)
   * @returns {Promise<Uint8Array>} Bytes do PDF resultante
   * @throws {Error} Se nenhum arquivo for fornecido ou se algum não for um PDF válido
   */
  async mergePdfs(orderedPdfFiles, onProgressUpdate) {
    this._validateMergeInput(orderedPdfFiles);

    const mergedDocument = await PDFLib.PDFDocument.create();
    const totalFiles = orderedPdfFiles.length;

    for (let fileIndex = 0; fileIndex < totalFiles; fileIndex++) {
      const currentFile = orderedPdfFiles[fileIndex];

      await this._copyAllPagesFromFile(currentFile, mergedDocument);

      const progressPercentage = Math.round(((fileIndex + 1) / totalFiles) * 100);
      onProgressUpdate(progressPercentage);
    }

    return mergedDocument.save();
  }

  // ─── Métodos privados ──────────────────────────────────────────────────────

  /**
   * Valida os parâmetros de entrada antes de iniciar o processamento.
   *
   * @param {File[]} files
   * @throws {Error} Se a lista estiver vazia
   */
  _validateMergeInput(files) {
    if (!files || files.length === 0) {
      throw new Error(
        'É necessário fornecer ao menos um arquivo PDF para realizar a união.'
      );
    }
  }

  /**
   * Retorna a quantidade de páginas de um arquivo PDF.
   * Útil para validar intervalos antes de chamar extractPages().
   *
   * @param {File} sourceFile
   * @returns {Promise<number>}
   */
  async getPageCount(sourceFile) {
    const fileBytes   = await this._readFileAsArrayBuffer(sourceFile);
    const pdfDocument = await this._loadPdfDocument(fileBytes, sourceFile.name);
    return pdfDocument.getPageCount();
  }

  /**
   * Extrai páginas específicas de um PDF e retorna-as como um novo documento.
   *
   * As páginas são extraídas na ordem em que os índices são fornecidos,
   * permitindo ao chamador controlar a sequência final.
   *
   * @param {File}     sourceFile               - O arquivo PDF de origem
   * @param {number[]} zeroIndexedPageIndices    - Índices 0-based das páginas a extrair
   * @param {function(number): void} onProgressUpdate - Callback de progresso (0–100)
   * @returns {Promise<Uint8Array>} Bytes do novo PDF com apenas as páginas extraídas
   * @throws {Error} Se nenhuma página for informada ou o arquivo for inválido
   */
  async extractPages(sourceFile, zeroIndexedPageIndices, onProgressUpdate) {
    if (!zeroIndexedPageIndices || zeroIndexedPageIndices.length === 0) {
      throw new Error('Nenhuma página selecionada para extração.');
    }

    const fileBytes      = await this._readFileAsArrayBuffer(sourceFile);
    const sourceDocument = await this._loadPdfDocument(fileBytes, sourceFile.name);
    const newDocument    = await PDFLib.PDFDocument.create();
    const totalCount     = zeroIndexedPageIndices.length;

    const copiedPages = await newDocument.copyPages(sourceDocument, zeroIndexedPageIndices);

    for (let i = 0; i < copiedPages.length; i++) {
      newDocument.addPage(copiedPages[i]);
      const progressPercentage = Math.round(((i + 1) / totalCount) * 100);
      onProgressUpdate(progressPercentage);
    }

    return newDocument.save();
  }

  /**
   * Reorganiza um documento PDF aplicando nova ordem de páginas e rotações.
   *
   * Cada instrução define qual página original usar (por índice 0-based) e
   * quantos graus adicionais de rotação aplicar sobre a rotação já existente
   * na página. A ordem do array define a sequência final do documento.
   *
   * @param {File} sourceFile - O arquivo PDF de origem
   * @param {Array<{originalIndex: number, rotation: number}>} pageInstructions
   *   - `originalIndex`: índice 0-based da página no documento original
   *   - `rotation`: graus adicionais a aplicar (0, 90, 180 ou 270)
   * @param {function(number): void} onProgressUpdate - Callback de progresso (0–100)
   * @returns {Promise<Uint8Array>} Bytes do novo PDF reorganizado
   * @throws {Error} Se nenhuma instrução for fornecida ou o arquivo for inválido
   */
  async organizePages(sourceFile, pageInstructions, onProgressUpdate) {
    if (!pageInstructions || pageInstructions.length === 0) {
      throw new Error('Nenhuma instrução de página foi fornecida para organizar.');
    }

    const fileBytes      = await this._readFileAsArrayBuffer(sourceFile);
    const sourceDocument = await this._loadPdfDocument(fileBytes, sourceFile.name);
    const newDocument    = await PDFLib.PDFDocument.create();
    const totalPages     = pageInstructions.length;

    const originalIndices = pageInstructions.map(instruction => instruction.originalIndex);
    const copiedPages     = await newDocument.copyPages(sourceDocument, originalIndices);

    for (let i = 0; i < copiedPages.length; i++) {
      const page = copiedPages[i];

      // Preserva a rotação original da página e acrescenta a do usuário.
      // O módulo positivo ((x % 360) + 360) % 360 garante valor em [0, 360).
      const existingAngle = page.getRotation().angle ?? 0;
      const finalAngle    = ((existingAngle + pageInstructions[i].rotation) % 360 + 360) % 360;
      page.setRotation(PDFLib.degrees(finalAngle));

      newDocument.addPage(page);

      const progressPercentage = Math.round(((i + 1) / totalPages) * 100);
      onProgressUpdate(progressPercentage);
    }

    return newDocument.save();
  }

  /**
   * Lê um arquivo, o converte em documento pdf-lib e copia todas as suas
   * páginas para o documento de destino.
   *
   * @param {File} sourceFile - Arquivo PDF de origem
   * @param {PDFLib.PDFDocument} destinationDocument - Documento que receberá as páginas
   * @returns {Promise<void>}
   * @throws {Error} Se o arquivo não puder ser lido ou não for um PDF válido
   */
  async _copyAllPagesFromFile(sourceFile, destinationDocument) {
    const fileBytes   = await this._readFileAsArrayBuffer(sourceFile);
    const sourceDocument = await this._loadPdfDocument(fileBytes, sourceFile.name);

    const pageIndices = sourceDocument.getPageIndices();
    const copiedPages = await destinationDocument.copyPages(sourceDocument, pageIndices);

    for (const page of copiedPages) {
      destinationDocument.addPage(page);
    }
  }

  /**
   * Lê um File do navegador e retorna seu conteúdo como ArrayBuffer.
   *
   * @param {File} file
   * @returns {Promise<ArrayBuffer>}
   */
  _readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload  = () => resolve(reader.result);
      reader.onerror = () => reject(
        new Error(`Falha ao ler o arquivo "${file.name}". Verifique se ele não está corrompido.`)
      );

      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Carrega um ArrayBuffer como documento pdf-lib, com tratamento de erro
   * amigável caso o arquivo não seja um PDF válido.
   *
   * @param {ArrayBuffer} fileBytes
   * @param {string} fileName - Usado apenas para mensagens de erro
   * @returns {Promise<PDFLib.PDFDocument>}
   */
  async _loadPdfDocument(fileBytes, fileName) {
    try {
      return await PDFLib.PDFDocument.load(fileBytes);
    } catch {
      throw new Error(
        `O arquivo "${fileName}" não é um PDF válido ou está protegido por senha.`
      );
    }
  }
}
