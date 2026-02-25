/**
 * FileManager
 *
 * Responsabilidade única: gerenciar a coleção de arquivos selecionados
 * pelo usuário, incluindo adição, remoção e ordenação.
 *
 * O algoritmo de ordenação implementa o comportamento do Windows Explorer
 * (equivalente à função nativa StrCmpLogicalW): segmentos numéricos dentro
 * do nome do arquivo são comparados como inteiros, não como strings, de modo
 * que "10" vem após "9" — e nunca antes de "2".
 */
class FileManager {
  constructor() {
    /** @type {File[]} Lista interna de arquivos na ordem atual de exibição */
    this._files = [];
  }

  // ─── Consultas ─────────────────────────────────────────────────────────────

  /**
   * Retorna uma cópia da lista de arquivos (imutável para o consumidor).
   * @returns {File[]}
   */
  getFiles() {
    return [...this._files];
  }

  /**
   * @returns {number} Quantidade de arquivos na lista
   */
  getCount() {
    return this._files.length;
  }

  /**
   * @returns {boolean} Verdadeiro se não há arquivos na lista
   */
  isEmpty() {
    return this._files.length === 0;
  }

  // ─── Mutações ──────────────────────────────────────────────────────────────

  /**
   * Adiciona arquivos à lista, ignorando duplicatas com base no nome e tamanho.
   *
   * A deduplicação por nome+tamanho evita que o usuário adicione o mesmo
   * arquivo duas vezes por engano (comportamento padrão do Windows Explorer).
   *
   * @param {File[]} incomingFiles - Arquivos a serem adicionados
   * @returns {{ added: number, skipped: number }} Relatório da operação
   */
  addFiles(incomingFiles) {
    const existingKeys = new Set(
      this._files.map(file => this._buildDeduplicationKey(file))
    );

    let addedCount = 0;
    let skippedCount = 0;

    for (const file of incomingFiles) {
      const deduplicationKey = this._buildDeduplicationKey(file);

      if (existingKeys.has(deduplicationKey)) {
        skippedCount++;
        continue;
      }

      this._files.push(file);
      existingKeys.add(deduplicationKey);
      addedCount++;
    }

    return { added: addedCount, skipped: skippedCount };
  }

  /**
   * Remove um arquivo pelo índice na lista atual.
   *
   * @param {number} index - Posição na lista (base 0)
   * @throws {RangeError} Se o índice estiver fora dos limites
   */
  removeFileAt(index) {
    const isValidIndex = index >= 0 && index < this._files.length;
    if (!isValidIndex) {
      throw new RangeError(
        `Índice inválido: ${index}. A lista tem ${this._files.length} arquivo(s).`
      );
    }
    this._files.splice(index, 1);
  }

  /**
   * Esvazia a lista por completo.
   */
  clearAll() {
    this._files = [];
  }

  /**
   * Ordena os arquivos em ordem alfabética natural (estilo Windows Explorer),
   * modificando a lista internamente.
   *
   * Exemplos de resultados corretos:
   *   ["10.pdf", "2.pdf", "1.pdf"]   → ["1.pdf", "2.pdf", "10.pdf"]
   *   ["3-2.pdf", "3-10.pdf", "3-1.pdf"] → ["3-1.pdf", "3-2.pdf", "3-10.pdf"]
   *   ["b.pdf", "A.pdf", "c.pdf"]    → ["A.pdf", "b.pdf", "c.pdf"]
   */
  sortByNaturalAlphabeticalOrder() {
    this._files.sort((fileA, fileB) =>
      this._compareNaturally(fileA.name, fileB.name)
    );
  }

  // ─── Métodos privados ──────────────────────────────────────────────────────

  /**
   * Gera uma chave única para deduplicação combinando nome e tamanho.
   * Dois arquivos com mesmo nome mas tamanhos diferentes são tratados
   * como arquivos distintos.
   *
   * @param {File} file
   * @returns {string}
   */
  _buildDeduplicationKey(file) {
    return `${file.name}::${file.size}`;
  }

  /**
   * Compara dois nomes de arquivo usando ordenação natural (natural sort),
   * equivalente ao StrCmpLogicalW do Windows.
   *
   * Algoritmo:
   * 1. Divide cada nome em segmentos alternados de dígitos e não-dígitos.
   *    Ex.: "cap3-vol10.pdf" → ["cap", "3", "-vol", "10", ".pdf"]
   * 2. Compara os segmentos par a par:
   *    - Segmentos numéricos são comparados como inteiros.
   *    - Demais segmentos são comparados como texto, ignorando maiúsculas.
   * 3. O primeiro segmento diferente determina a ordem.
   *
   * @param {string} nameA
   * @param {string} nameB
   * @returns {number} Negativo, zero ou positivo (padrão Array.sort)
   */
  _compareNaturally(nameA, nameB) {
    const segmentsA = this._splitIntoNaturalSegments(nameA.toLowerCase());
    const segmentsB = this._splitIntoNaturalSegments(nameB.toLowerCase());

    const shorterLength = Math.min(segmentsA.length, segmentsB.length);

    for (let i = 0; i < shorterLength; i++) {
      const segmentA = segmentsA[i];
      const segmentB = segmentsB[i];

      const comparison = this._compareSegments(segmentA, segmentB);
      if (comparison !== 0) {
        return comparison;
      }
    }

    // Se todos os segmentos comparados forem iguais, o nome mais curto vem primeiro.
    return segmentsA.length - segmentsB.length;
  }

  /**
   * Divide uma string em segmentos alternados de dígitos e não-dígitos.
   * Ex.: "cap3-vol10" → ["cap", "3", "-vol", "10"]
   *
   * @param {string} name
   * @returns {string[]}
   */
  _splitIntoNaturalSegments(name) {
    return name.match(/\d+|\D+/g) ?? [];
  }

  /**
   * Compara dois segmentos individuais.
   * Se ambos forem puramente numéricos, compara como inteiros.
   * Caso contrário, compara lexicograficamente.
   *
   * @param {string} segmentA
   * @param {string} segmentB
   * @returns {number}
   */
  _compareSegments(segmentA, segmentB) {
    const numericA = parseInt(segmentA, 10);
    const numericB = parseInt(segmentB, 10);

    const bothAreIntegers = !isNaN(numericA) && !isNaN(numericB);

    if (bothAreIntegers) {
      return numericA - numericB;
    }

    if (segmentA < segmentB) return -1;
    if (segmentA > segmentB) return  1;
    return 0;
  }
}
