/**
 * PdfProcessor
 *
 * Responsabilidade única: executar operações sobre arquivos PDF.
 *
 * Operações implementadas:
 *   - mergePdfs()        — unir múltiplos PDFs em um único arquivo
 *   - extractPages()     — extrair páginas específicas para um novo arquivo
 *   - organizePages()    — reordenar e rotacionar páginas
 *   - splitByPageCount() — dividir em partes com N páginas cada
 *   - splitByFileSize()  — dividir em partes com no máximo X bytes cada
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

  // ─── Métodos públicos: Dividir PDF ────────────────────────────────────────

  /**
   * Divide um PDF em partes com o mesmo número de páginas cada.
   *
   * A última parte pode ter menos páginas que o total solicitado caso o número
   * total não seja múltiplo exato de `pagesPerPart`.
   *
   * @param {File}   sourceFile              - Arquivo PDF de origem
   * @param {number} pagesPerPart            - Quantidade de páginas por parte (≥ 1)
   * @param {function(number): void} onProgressUpdate - Callback de progresso (0–100)
   * @returns {Promise<Array<{bytes: Uint8Array, startPage: number, endPage: number}>>}
   *   Array de chunks, cada um com os bytes do PDF e o intervalo de páginas (0-based)
   * @throws {Error} Se pagesPerPart for inválido ou o arquivo não for um PDF válido
   */
  async splitByPageCount(sourceFile, pagesPerPart, onProgressUpdate) {
    if (!pagesPerPart || pagesPerPart < 1) {
      throw new Error('A quantidade de páginas por parte deve ser ao menos 1.');
    }

    const fileBytes      = await this._readFileAsArrayBuffer(sourceFile);
    const sourceDocument = await this._loadPdfDocument(fileBytes, sourceFile.name);
    const totalPages     = sourceDocument.getPageCount();
    const chunks         = [];

    for (let startPage = 0; startPage < totalPages; startPage += pagesPerPart) {
      const endPage  = Math.min(startPage + pagesPerPart - 1, totalPages - 1);
      const chunkBytes = await this._buildChunk(sourceDocument, startPage, endPage);

      chunks.push({ bytes: chunkBytes, startPage, endPage });

      onProgressUpdate(Math.round(((endPage + 1) / totalPages) * 100));
    }

    return chunks;
  }

  /**
   * Divide um PDF em partes onde cada parte nunca ultrapassa `targetSizeBytes`.
   *
   * Usa busca binária por chunk para encontrar o maior número de páginas que
   * cabe dentro do limite sem excedê-lo. Se uma única página já superar o limite,
   * ela é incluída sozinha (uma página é indivisível).
   *
   * @param {File}   sourceFile               - Arquivo PDF de origem
   * @param {number} targetSizeBytes          - Tamanho máximo em bytes por parte
   * @param {function(number): void} onProgressUpdate - Callback de progresso (0–100)
   * @returns {Promise<Array<{bytes: Uint8Array, startPage: number, endPage: number}>>}
   * @throws {Error} Se targetSizeBytes for inválido ou o arquivo não for um PDF válido
   */
  async splitByFileSize(sourceFile, targetSizeBytes, onProgressUpdate) {
    if (!targetSizeBytes || targetSizeBytes <= 0) {
      throw new Error('O tamanho-alvo por parte deve ser maior que zero.');
    }

    const fileBytes      = await this._readFileAsArrayBuffer(sourceFile);
    const sourceDocument = await this._loadPdfDocument(fileBytes, sourceFile.name);
    const totalPages     = sourceDocument.getPageCount();
    const chunks         = [];
    let   startPage      = 0;

    while (startPage < totalPages) {
      const remainingPages = totalPages - startPage;
      let   low            = 1;
      let   high           = remainingPages;
      let   bestPageCount  = 0;
      let   bestBytes      = null;

      // Busca binária: encontra o maior número de páginas que cabe no limite.
      // Cada iteração constrói um PDF candidato e verifica seu tamanho.
      while (low <= high) {
        const mid            = Math.floor((low + high) / 2);
        const candidateBytes = await this._buildChunk(
          sourceDocument,
          startPage,
          startPage + mid - 1
        );

        if (candidateBytes.byteLength <= targetSizeBytes) {
          // Este candidato coube: registra e tenta incluir mais páginas
          bestPageCount = mid;
          bestBytes     = candidateBytes;
          low           = mid + 1;
        } else {
          // Ultrapassou o limite: reduz o número de páginas
          high = mid - 1;
        }
      }

      // Caso especial: mesmo 1 página ultrapassa o limite.
      // Inclui forçadamente — uma página é indivisível.
      if (bestPageCount === 0) {
        bestBytes     = await this._buildChunk(sourceDocument, startPage, startPage);
        bestPageCount = 1;
      }

      const endPage = startPage + bestPageCount - 1;
      chunks.push({ bytes: bestBytes, startPage, endPage });

      startPage += bestPageCount;
      onProgressUpdate(Math.round((startPage / totalPages) * 100));
    }

    return chunks;
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
   * Constrói um PDF contendo apenas as páginas no intervalo [startPageIndex, endPageIndex].
   *
   * Usado internamente por `splitByPageCount` e `splitByFileSize` para montar
   * cada chunk sem duplicar a lógica de criação de documento.
   *
   * @param {PDFLib.PDFDocument} sourceDocument  - Documento já carregado
   * @param {number}             startPageIndex  - Primeiro índice 0-based (inclusivo)
   * @param {number}             endPageIndex    - Último índice 0-based (inclusivo)
   * @returns {Promise<Uint8Array>} Bytes do chunk em formato PDF
   */
  async _buildChunk(sourceDocument, startPageIndex, endPageIndex) {
    const chunkDocument = await PDFLib.PDFDocument.create();

    const pageIndices = Array.from(
      { length: endPageIndex - startPageIndex + 1 },
      (_, offset) => startPageIndex + offset
    );

    const copiedPages = await chunkDocument.copyPages(sourceDocument, pageIndices);
    copiedPages.forEach(page => chunkDocument.addPage(page));

    return chunkDocument.save({ useObjectStreams: true });
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
