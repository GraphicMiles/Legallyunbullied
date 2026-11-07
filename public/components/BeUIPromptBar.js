/**
 * BeUIPromptBar - Composer with /-commands and a send/stop button.
 * @-mentions and a model picker were never wired and have been removed.
 */
class BeUIPromptBar {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      placeholder: options.placeholder || 'Ask a legal question...',
      onSubmit: options.onSubmit || (() => {}),
      onStop: options.onStop || null,
      onMenu: options.onMenu || null,
      onMic: options.onMic || null,
      commands: options.commands || [],
      ...options
    };

    this.element = null;
    this.inputElement = null;
    this.submitButton = null;
    this.menuButton = null;
    this.micButton = null;
    this.dropdown = null;
    this.isDropdownOpen = false;
    this.dropdownType = null;
    this._commandMatches = [];
    this.isSubmitting = false;

    // Click-outside handler reference for cleanup
    this._outsideClickHandler = (e) => this.handleOutsideClick(e);

    this.render();
    this.attachOutsideClickListener();
  }

  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'beui-prompt-bar';

    // Textarea occupies the card's first row.
    const textarea = document.createElement('textarea');
    textarea.className = 'beui-prompt-bar__input';
    textarea.placeholder = this.options.placeholder;
    textarea.rows = 1;
    textarea.setAttribute('aria-label', 'Your legal question');
    textarea.addEventListener('input', (e) => this.handleInput(e));
    textarea.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Controls row: menu on the left, dictation and send on the right.
    const controls = document.createElement('div');
    controls.className = 'beui-prompt-bar__controls';

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'beui-prompt-bar__tool beui-prompt-bar__tool--menu';
    menuBtn.setAttribute('aria-label', 'Commands and attachments');
    menuBtn.setAttribute('aria-haspopup', 'menu');
    menuBtn.setAttribute('aria-expanded', 'false');
    menuBtn.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i>';
    menuBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.options.onMenu) this.options.onMenu(menuBtn);
    });

    const spacer = document.createElement('div');
    spacer.className = 'beui-prompt-bar__spacer';

    const micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.className = 'beui-prompt-bar__tool beui-prompt-bar__tool--mic';
    micBtn.hidden = true; // The app reveals it once Web Speech is known to work.
    micBtn.setAttribute('aria-label', 'Dictate your situation');
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.innerHTML = '<i class="fa-solid fa-microphone" aria-hidden="true"></i>';
    micBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.options.onMic) this.options.onMic(micBtn);
    });

    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'beui-prompt-bar__button beui-prompt-bar__button--submit';
    submitBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>';
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-label', 'Send question');
    submitBtn.addEventListener('click', (e) => this.handleSubmitClick(e));

    controls.appendChild(menuBtn);
    controls.appendChild(spacer);
    controls.appendChild(micBtn);
    controls.appendChild(submitBtn);

    // Dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'beui-prompt-bar__dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdown.setAttribute('aria-label', 'Commands');

    wrapper.appendChild(textarea);
    wrapper.appendChild(controls);
    wrapper.appendChild(dropdown);

    this.container.appendChild(wrapper);
    this.element = wrapper;
    this.inputElement = textarea;
    this.submitButton = submitBtn;
    this.menuButton = menuBtn;
    this.micButton = micBtn;
    this.dropdown = dropdown;

    // Auto-resize
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    });
  }

  /**
   * Attach a global click listener to close dropdowns when clicking outside.
   */
  attachOutsideClickListener() {
    document.addEventListener('click', this._outsideClickHandler, true);
  }

  /**
   * If a click happens outside the prompt bar element, close any open dropdown.
   */
  handleOutsideClick(e) {
    if (this.element && !this.element.contains(e.target)) {
      this.hideDropdown();
    }
  }

  handleInput(e) {
    const value = e.target.value;

    // Don't change button state while submitting (stop button should stay visible)
    if (!this.isSubmitting) {
      this.submitButton.disabled = value.trim().length === 0;
    }

    // Slash commands trigger only when the whole input is a partial command
    const textBeforeCursor = value.slice(0, e.target.selectionStart);
    const commandMatch = textBeforeCursor.match(/^\/(\w*)$/);
    if (commandMatch) {
      this.showCommands(commandMatch[1]);
      return;
    }

    this.hideDropdown();
  }

  handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // When the command dropdown is open, Enter picks the first match
      // instead of submitting a bare "/tenancy" as the question.
      if (this.isDropdownOpen && this._commandMatches && this._commandMatches.length) {
        this.executeCommand(this._commandMatches[0]);
        return;
      }
      this.submit();
    } else if (e.key === 'Escape') {
      this.hideDropdown();
    }
  }


  showCommands(query) {
    const filtered = this.options.commands.filter(c =>
      c.name.toLowerCase().includes(query.toLowerCase())
    );

    this._commandMatches = filtered;
    if (filtered.length === 0) {
      this.hideDropdown();
      return;
    }

    this.dropdown.innerHTML = '';
    this.dropdownType = 'commands';

    filtered.forEach(command => {
      const item = document.createElement('div');
      item.className = 'beui-prompt-bar__dropdown-item';
      item.setAttribute('role', 'option');
      item.setAttribute('tabindex', '0');
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.executeCommand(command);
        }
      });

      const textWrapper = document.createElement('div');
      textWrapper.className = 'beui-prompt-bar__dropdown-text';

      const name = document.createElement('span');
      name.className = 'beui-prompt-bar__dropdown-name';
      name.textContent = command.name;

      const desc = document.createElement('span');
      desc.className = 'beui-prompt-bar__dropdown-desc';
      desc.textContent = command.desc || '';

      textWrapper.appendChild(name);
      textWrapper.appendChild(desc);

      item.appendChild(textWrapper);

      item.addEventListener('click', () => {
        this.executeCommand(command);
      });

      this.dropdown.appendChild(item);
    });

    this.dropdown.classList.add('is-visible');
    this.isDropdownOpen = true;
  }

  hideDropdown() {
    this.dropdown.classList.remove('is-visible');
    this.isDropdownOpen = false;
    this.dropdownType = null;
    this._commandMatches = [];
  }


  executeCommand(command) {
    this.hideDropdown();
    this.inputElement.value = `${command.name} `;
    this.inputElement.style.height = 'auto';
    this.inputElement.style.height = Math.min(this.inputElement.scrollHeight, 200) + 'px';
    this.submitButton.disabled = false;
    this.inputElement.focus();
    const end = this.inputElement.value.length;
    try { this.inputElement.setSelectionRange(end, end); } catch (_) { /* pre-focus fallback */ }
  }

  /**
   * Submit button click handler.
   * During submission, clicking the button stops the generation.
   * Otherwise, it submits the current text.
   */
  handleSubmitClick(e) {
    e.preventDefault();
    e.stopPropagation();

    if (this.isSubmitting) {
      // During submission the button acts as a stop button
      if (this.options.onStop) {
        this.options.onStop();
      }
      return;
    }

    this.submit();
  }

  submit() {
    if (this.isSubmitting) return; // can't submit while already submitting

    const value = this.inputElement.value.trim();
    if (value.length === 0) return;

    try {
      this.options.onSubmit(value);
    } finally {
      // Always clear the input, even if onSubmit throws
      this.clear();
    }
  }

  clear() {
    this.inputElement.value = '';
    this.inputElement.style.height = 'auto';
    this.submitButton.disabled = true;
    this.hideDropdown();
  }

  getValue() {
    return this.inputElement.value;
  }

  setValue(value) {
    this.inputElement.value = value;
    if (!this.isSubmitting) {
      this.submitButton.disabled = value.trim().length === 0;
    }
  }

  setDisabled(disabled) {
    this.inputElement.disabled = disabled;
    if (!this.isSubmitting) {
      this.submitButton.disabled = disabled || this.inputElement.value.trim().length === 0;
    }
  }

  setSubmitting(isSubmitting) {
    this.isSubmitting = isSubmitting;
    this.submitButton.classList.toggle('is-stop', isSubmitting);
    if (isSubmitting) {
      // Show stop button — enabled so user can click to abort
      this.submitButton.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/></svg>';
      this.submitButton.disabled = false;
      this.submitButton.title = 'Stop generating';
      this.submitButton.setAttribute('aria-label', 'Stop generating');
    } else {
      // Restore send button
      this.submitButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>';
      this.submitButton.disabled = this.inputElement.value.trim().length === 0;
      this.submitButton.title = '';
      this.submitButton.setAttribute('aria-label', 'Send question');
    }
  }

  destroy() {
    document.removeEventListener('click', this._outsideClickHandler, true);
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIPromptBar = BeUIPromptBar;
