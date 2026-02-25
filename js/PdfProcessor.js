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
