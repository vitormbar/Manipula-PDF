/**
 * PageRangeParser
 *
 * Responsabilidade única: converter uma string de intervalos de páginas
 * em formato humano (ex.: "1-10, 30-35, 38, 45-50") em um array de
 * índices 0-based prontos para uso com pdf-lib.
 *
 * Separado em arquivo próprio para que tanto PdfProcessor quanto
 * UIController possam utilizá-lo sem acoplamento entre si.
 */
class PageRangeParser {
  /**
   * Converte uma string de intervalos num array de índices de página (0-based),
   * validando cada segmento contra o total de páginas do documento.
   *
   * Formatos aceitos por segmento:
   *   "5"      → apenas a página 5
   *   "1-10"   → páginas 1 a 10 (inclusivo em ambas as pontas)
   *   "1-10, 30-35, 38, 45-50" → combinação de ambos
   *
   * @param {string} rangeString - A string digitada pelo usuário
   * @param {number} totalPages  - Quantidade total de páginas do PDF
   * @returns {{ pages: number[], errors: string[] }}
   *   pages:  array de índices 0-based, ordenado, sem duplicatas
   *   errors: mensagens de erro coletadas (array vazio = tudo válido)
   */
  static parse(rangeString, totalPages) {
    if (!rangeString || !rangeString.trim()) {
      return { pages: [], errors: [] };
    }

    const segments = rangeString
      .split(',')
      .map(segment => segment.trim())
      .filter(Boolean);

    const pageSet = new Set();
    const errors  = [];

    for (const segment of segments) {
      const isRangeSegment = segment.includes('-');

      if (isRangeSegment) {
        const result = PageRangeParser._parseRangeSegment(segment, totalPages);
        if (result.error) {
          errors.push(result.error);
        } else {
          for (let page = result.start; page <= result.end; page++) {
            pageSet.add(page);
          }
        }
      } else {
        const result = PageRangeParser._parseSinglePage(segment, totalPages);
        if (result.error) {
          errors.push(result.error);
        } else {
          pageSet.add(result.page);
        }
      }
    }

    // Converte para 0-based e ordena numericamente
    const sortedZeroIndexedPages = Array.from(pageSet)
      .sort((a, b) => a - b)
      .map(page => page - 1);

    return { pages: sortedZeroIndexedPages, errors };
  }

  // ─── Métodos privados ──────────────────────────────────────────────────────

  /**
   * Analisa um segmento no formato "início-fim" (ex.: "3-7", "10-20").
   *
   * @param {string} segment
   * @param {number} totalPages
   * @returns {{ start: number, end: number } | { error: string }}
   */
  static _parseRangeSegment(segment, totalPages) {
    const parts = segment.split('-');

    if (parts.length !== 2) {
      return {
        error: `Formato inválido: "${segment}". Use "início-fim" (ex.: 3-7)`,
      };
    }

    const start = parseInt(parts[0], 10);
    const end   = parseInt(parts[1], 10);

    if (isNaN(start) || isNaN(end)) {
      return { error: `Números inválidos em "${segment}"` };
    }

    if (start < 1 || end < 1) {
      return { error: `Páginas devem ser maiores que zero (em "${segment}")` };
    }

    if (start > end) {
      return { error: `Início maior que fim em "${segment}" — inverta o intervalo` };
    }

    if (end > totalPages) {
      return {
        error: `Página ${end} excede o total do documento (${totalPages} páginas)`,
      };
    }

    return { start, end };
  }

  /**
   * Analisa um segmento de página única (ex.: "5", "38").
   *
   * @param {string} segment
   * @param {number} totalPages
   * @returns {{ page: number } | { error: string }}
   */
  static _parseSinglePage(segment, totalPages) {
    const page = parseInt(segment, 10);

    if (isNaN(page)) {
      return { error: `"${segment}" não é um número válido` };
    }

    if (page < 1) {
      return { error: `Páginas devem ser maiores que zero (encontrado: ${page})` };
    }

    if (page > totalPages) {
      return {
        error: `Página ${page} excede o total do documento (${totalPages} páginas)`,
      };
    }

    return { page };
  }
}
