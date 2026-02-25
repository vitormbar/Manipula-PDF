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
