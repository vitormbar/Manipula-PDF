/**
 * UIController
 *
 * Responsabilidade única: gerenciar toda a interação entre o usuário e o DOM.
 *
 * Não contém lógica de negócio — apenas traduz eventos do DOM em chamadas
 * para os handlers fornecidos pelo App, e atualiza a interface de acordo
 * com o estado atual da aplicação.
 */
class UIController {
  /**
   * @param {object} handlers - Mapa de callbacks fornecidos pelo App
   * @param {function(File[]): void}   handlers.onFilesAdded
   * @param {function(number): void}   handlers.onFileRemoved
   * @param {function(): void}         handlers.onSortRequested
   * @param {function(): void}         handlers.onClearRequested
   * @param {function(): void}         handlers.onMergeRequested
   */
  constructor(handlers) {
    this._handlers = handlers;
    this._elements = this._queryDomElements();
    this._attachEventListeners();
  }

  // ─── Atualização de estado da UI ───────────────────────────────────────────

  /**
   * Atualiza toda a interface para refletir a lista atual de arquivos.
   *
   * @param {File[]} files - Lista de arquivos no estado atual do FileManager
   */
  renderFileList(files) {
    const hasFiles = files.length > 0;

    this._elements.fileListActions.hidden = !hasFiles;
    this._elements.fileList.hidden        = !hasFiles;
    this._elements.outputSettings.hidden  = !hasFiles;
    this._elements.panelFooter.hidden     = !hasFiles;

    this._elements.fileCountLabel.textContent =
      hasFiles
        ? `${files.length} arquivo${files.length > 1 ? 's' : ''} selecionado${files.length > 1 ? 's' : ''}`
        : '';

    this._elements.fileList.innerHTML = '';

    for (const [index, file] of files.entries()) {
      const listItem = this._buildFileListItem(file, index);
      this._elements.fileList.appendChild(listItem);
    }
  }

  /**
   * Exibe ou oculta a barra de progresso e atualiza seu valor.
   *
   * @param {boolean} isVisible
   * @param {number}  percentage - 0 a 100
   * @param {string}  label      - Texto descritivo da operação em curso
   */
  setProgressState(isVisible, percentage = 0, label = '') {
    this._elements.progressContainer.hidden = !isVisible;
    this._elements.progressBarFill.style.width = `${percentage}%`;
    this._elements.progressLabel.textContent = label;
  }

  /**
   * Habilita ou desabilita os controles interativos durante o processamento.
   *
   * @param {boolean} isProcessing
   */
  setProcessingState(isProcessing) {
    const elementsToToggle = [
      this._elements.btnMerge,
      this._elements.btnSortFiles,
      this._elements.btnClearFiles,
      this._elements.btnSelectFiles,
    ];

    for (const element of elementsToToggle) {
      element.disabled = isProcessing;
    }

    this._elements.uploadZone.style.pointerEvents = isProcessing ? 'none' : '';
    this._elements.btnMerge.textContent = isProcessing
      ? '⏳ Processando…'
      : '⚡ Unir PDFs';
  }

  /**
   * Exibe uma notificação temporária (toast) para o usuário.
   *
   * @param {string} message  - Texto a exibir
   * @param {'info'|'success'|'error'} type - Define cor e ícone
   * @param {number} durationMs - Tempo até a remoção automática
   */
  showToast(message, type = 'info', durationMs = 4000) {
    const iconByType = { info: 'ℹ️', success: '✅', error: '❌' };

    const toastElement = document.createElement('div');
    toastElement.className = `toast toast-${type}`;
    toastElement.innerHTML = `
      <span class="toast-icon" aria-hidden="true">${iconByType[type]}</span>
      <span>${message}</span>
    `;

    this._elements.toastContainer.appendChild(toastElement);

    setTimeout(() => this._removeToast(toastElement), durationMs);
  }

  // ─── Configuração de eventos ───────────────────────────────────────────────

  /**
   * Vincula todos os event listeners necessários aos elementos do DOM.
   * Centralizar aqui torna simples adicionar novos listeners no futuro.
   */
  _attachEventListeners() {
    // Seleção via botão / input file
    this._elements.btnSelectFiles.addEventListener('click', () => {
      this._elements.fileInput.click();
    });

    this._elements.fileInput.addEventListener('change', (event) => {
      const selectedFiles = Array.from(event.target.files);
      this._handlers.onFilesAdded(selectedFiles);
      // Reseta o input para permitir selecionar os mesmos arquivos novamente
      event.target.value = '';
    });

    // Clique na zona de upload (exceto no botão, que tem seu próprio handler)
    this._elements.uploadZone.addEventListener('click', (event) => {
      const clickedOnSelectButton = event.target.closest('#btn-select-files');
      if (!clickedOnSelectButton) {
        this._elements.fileInput.click();
      }
    });

    // Acessibilidade: tecla Enter/Espaço ativa a zona de upload
    this._elements.uploadZone.addEventListener('keydown', (event) => {
      const isActivationKey = event.key === 'Enter' || event.key === ' ';
      if (isActivationKey) {
        event.preventDefault();
        this._elements.fileInput.click();
      }
    });

    // Drag & drop
    this._elements.uploadZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      this._elements.uploadZone.classList.add('drag-over');
    });

    this._elements.uploadZone.addEventListener('dragleave', (event) => {
      // Ignora eventos de "saída" ao mover entre elementos filhos
      const isLeavingUploadZone = !this._elements.uploadZone.contains(event.relatedTarget);
      if (isLeavingUploadZone) {
        this._elements.uploadZone.classList.remove('drag-over');
      }
    });

    this._elements.uploadZone.addEventListener('drop', (event) => {
      event.preventDefault();
      this._elements.uploadZone.classList.remove('drag-over');

      const droppedFiles = Array.from(event.dataTransfer.files)
        .filter(file => file.type === 'application/pdf');

      if (droppedFiles.length > 0) {
        this._handlers.onFilesAdded(droppedFiles);
      } else {
        this.showToast('Apenas arquivos PDF são aceitos.', 'error');
      }
    });

    // Ações da lista
    this._elements.btnSortFiles.addEventListener('click', () => {
      this._handlers.onSortRequested();
    });

    this._elements.btnClearFiles.addEventListener('click', () => {
      this._handlers.onClearRequested();
    });

    // Merge
    this._elements.btnMerge.addEventListener('click', () => {
      this._handlers.onMergeRequested();
    });

    // Campos de nome do arquivo de saída
    this._attachOutputSettingsListeners();
  }

  // ─── Campos de saída: Nome, CPF e nome personalizado ──────────────────────

  /**
   * Vincula os event listeners dos campos de configuração do arquivo de saída.
   * Cada mudança dispara a máscara (no CPF), o estado do campo personalizado
   * e a atualização do preview de nome.
   */
  _attachOutputSettingsListeners() {
    this._elements.inputCpf.addEventListener('input', () => {
      this._applyMaskToCpfInput();
      this._updateCustomNameFieldState();
      this._updateFilenamePreview();
    });

    this._elements.inputNome.addEventListener('input', () => {
      this._updateCustomNameFieldState();
      this._updateFilenamePreview();
    });

    this._elements.inputCustomName.addEventListener('input', () => {
      this._updateFilenamePreview();
    });
  }

  /**
   * Aplica a máscara de CPF (000.000.000-00) enquanto o usuário digita,
   * mantendo o cursor na posição correta.
   *
   * A máscara é aplicada apenas aos dígitos já inseridos — nunca "completa"
   * caracteres que o usuário ainda não digitou.
   */
  _applyMaskToCpfInput() {
    const digitsOnly    = this._elements.inputCpf.value.replace(/\D/g, '').slice(0, 11);
    const maskedValue   = this._buildCpfMask(digitsOnly);
    this._elements.inputCpf.value = maskedValue;
  }

  /**
   * Constrói a string formatada do CPF a partir apenas dos dígitos.
   *
   * Exemplos:
   *   "123"        → "123"
   *   "123456"     → "123.456"
   *   "123456789"  → "123.456.789"
   *   "12345678909"→ "123.456.789-09"
   *
   * @param {string} digits - Somente os dígitos do CPF (máx. 11)
   * @returns {string}
   */
  _buildCpfMask(digits) {
    if (digits.length <=  3) return digits;
    if (digits.length <=  6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <=  9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }

  /**
   * Ativa o campo de nome personalizado somente quando tanto Nome quanto CPF
   * estiverem em branco, tornando clara para o usuário qual campo tem prioridade.
   */
  _updateCustomNameFieldState() {
    const isNomeEmpty = this._elements.inputNome.value.trim() === '';
    const isCpfEmpty  = this._elements.inputCpf.value.trim() === '';
    const shouldEnableCustomName = isNomeEmpty && isCpfEmpty;

    this._elements.inputCustomName.disabled = !shouldEnableCustomName;

    if (!shouldEnableCustomName) {
      // Limpa o personalizado quando o usuário começa a preencher Nome/CPF,
      // evitando que um valor antigo interfira na geração do nome final.
      this._elements.inputCustomName.value = '';
    }
  }

  /**
   * Atualiza o preview do nome do arquivo em tempo real conforme o usuário digita.
   */
  _updateFilenamePreview() {
    this._elements.filenamePreview.textContent = this.getOutputFileName();
  }

  /**
   * Retorna o nome de arquivo que será usado ao salvar o PDF mesclado.
   *
   * Prioridade:
   *   1. Nome + CPF preenchidos → "{nome}_{cpfDigits}_ANALISE.pdf"
   *   2. Apenas Nome             → "{nome}_ANALISE.pdf"
   *   3. Apenas CPF              → "{cpfDigits}_ANALISE.pdf"
   *   4. Nome personalizado      → "{customName}.pdf"
   *   5. Fallback (tudo vazio)   → "documentos-unidos-{data}.pdf"
   *
   * @returns {string} Nome do arquivo com extensão .pdf
   */
  getOutputFileName() {
    const rawNome       = this._elements.inputNome.value.trim();
    const rawCpf        = this._elements.inputCpf.value.trim();
    const rawCustomName = this._elements.inputCustomName.value.trim();

    const sanitizedNome   = this._sanitizeForFilename(rawNome);
    const cpfDigitsOnly   = rawCpf.replace(/\D/g, '');
    const sanitizedCustom = this._sanitizeForFilename(rawCustomName);

    if (sanitizedNome && cpfDigitsOnly) {
      return `${sanitizedNome}_${cpfDigitsOnly}_ANALISE.pdf`;
    }

    if (sanitizedNome) {
      return `${sanitizedNome}_ANALISE.pdf`;
    }

    if (cpfDigitsOnly) {
      return `${cpfDigitsOnly}_ANALISE.pdf`;
    }

    if (sanitizedCustom) {
      return `${sanitizedCustom}.pdf`;
    }

    // Fallback: usa data atual para garantir nome único e rastreável
    const today = new Date();
    return `documentos-unidos-${today.toISOString().slice(0, 10)}.pdf`;
  }

  // ─── Construção de elementos ───────────────────────────────────────────────

  /**
   * Constrói o elemento <li> de um arquivo na lista.
   *
   * @param {File}   file  - O arquivo
   * @param {number} index - Posição base-0 na lista
   * @returns {HTMLLIElement}
   */
  _buildFileListItem(file, index) {
    const listItem = document.createElement('li');
    listItem.className = 'file-item';
    listItem.dataset.index = index;

    listItem.innerHTML = `
      <span class="file-order" aria-label="Posição ${index + 1}">${index + 1}</span>
      <span class="file-icon" aria-hidden="true">📄</span>
      <div class="file-info">
        <div class="file-name" title="${this._escapeHtml(file.name)}">${this._escapeHtml(file.name)}</div>
        <div class="file-size">${this._formatFileSize(file.size)}</div>
      </div>
      <button class="file-remove-btn"
              aria-label="Remover ${this._escapeHtml(file.name)}"
              title="Remover arquivo"
              data-index="${index}">
        ×
      </button>
    `;

    listItem.querySelector('.file-remove-btn').addEventListener('click', (event) => {
      const fileIndex = parseInt(event.currentTarget.dataset.index, 10);
      this._handlers.onFileRemoved(fileIndex);
    });

    return listItem;
  }

  // ─── Utilitários privados ──────────────────────────────────────────────────

  /**
   * Mapeia todos os elementos do DOM necessários uma única vez no construtor,
   * evitando queries repetidas durante o ciclo de vida da aplicação.
   *
   * @returns {object}
   */
  _queryDomElements() {
    return {
      // Upload
      uploadZone:        document.getElementById('upload-zone'),
      fileInput:         document.getElementById('file-input'),
      btnSelectFiles:    document.getElementById('btn-select-files'),
      // Lista de arquivos
      fileListActions:   document.getElementById('file-list-actions'),
      fileCountLabel:    document.getElementById('file-count-label'),
      btnSortFiles:      document.getElementById('btn-sort-files'),
      btnClearFiles:     document.getElementById('btn-clear-files'),
      fileList:          document.getElementById('file-list'),
      // Configurações do arquivo de saída
      outputSettings:    document.getElementById('output-settings'),
      inputNome:         document.getElementById('input-nome'),
      inputCpf:          document.getElementById('input-cpf'),
      inputCustomName:   document.getElementById('input-custom-name'),
      filenamePreview:   document.getElementById('filename-preview'),
      // Progresso e ação
      progressContainer: document.getElementById('progress-container'),
      progressBarFill:   document.getElementById('progress-bar-fill'),
      progressLabel:     document.getElementById('progress-label'),
      panelFooter:       document.getElementById('panel-footer'),
      btnMerge:          document.getElementById('btn-merge'),
      // Notificações
      toastContainer:    document.getElementById('toast-container'),
    };
  }

  /**
   * Remove um toast com animação de saída.
   *
   * @param {HTMLElement} toastElement
   */
  _removeToast(toastElement) {
    toastElement.classList.add('removing');
    toastElement.addEventListener('animationend', () => toastElement.remove(), { once: true });
  }

  /**
   * Formata bytes em uma string legível (ex.: "1.4 MB").
   *
   * @param {number} bytes
   * @returns {string}
   */
  _formatFileSize(bytes) {
    if (bytes < 1024)        return `${bytes} B`;
    if (bytes < 1024 ** 2)   return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 ** 3)   return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  }

  /**
   * Escapa caracteres especiais HTML para prevenir XSS ao inserir nomes de
   * arquivo diretamente no innerHTML.
   *
   * @param {string} rawText
   * @returns {string}
   */
  _escapeHtml(rawText) {
    const escapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return rawText.replace(/[&<>"']/g, char => escapeMap[char]);
  }

  /**
   * Remove ou substitui caracteres inválidos para nomes de arquivo em sistemas
   * Windows/macOS/Linux, e normaliza espaços por underscores.
   *
   * Caracteres proibidos no Windows: \ / : * ? " < > |
   *
   * @param {string} rawText
   * @returns {string}
   */
  _sanitizeForFilename(rawText) {
    return rawText
      .replace(/[\\/:*?"<>|]/g, '')   // Remove caracteres proibidos
      .replace(/\s+/g, '_')           // Substitui espaços por underscore
      .replace(/_{2,}/g, '_')         // Colapsa underscores múltiplos
      .replace(/^_|_$/g, '');         // Remove underscores nas pontas
  }
}
