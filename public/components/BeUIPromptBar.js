/**
 * BeUIPromptBar - Composer with a send/stop button and an attachments menu.
 * The /-command and @-mention systems were never completed and have been
 * removed; the placeholder, mic and send behaviour are unchanged.
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
      ...options
    };

    this.element = null;
    this.inputElement = null;
    this.submitButton = null;
    this.menuButton = null;
    this.micButton = null;
    this.isSubmitting = false;

    this.render();
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
    textarea.addEventListener('input', () => this.handleInput());
    textarea.addEventListener('keydown', (e) => this.handleKeydown(e));

    // Controls row: menu on the left, dictation and send on the right.
    const controls = document.createElement('div');
    controls.className = 'beui-prompt-bar__controls';

    // No menu button. Its only item was a disabled "attach evidence" promise,
    // so it opened a dead menu. Evidence attachments get a real control when
    // the picker ships.
    const spacer = document.createElement('div');
    spacer.className = 'beui-prompt-bar__spacer';

    const micBtn = document.createElement('button');
    micBtn.type = 'button';
    micBtn.className = 'beui-prompt-bar__tool beui-prompt-bar__tool--mic';
    micBtn.hidden = true; // The app reveals it once Web Speech is known to work.
    micBtn.setAttribute('aria-label', 'Dictate your situation');
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-mic"/></svg>';
    micBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.options.onMic) this.options.onMic(micBtn);
    });

    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'beui-prompt-bar__button beui-prompt-bar__button--submit';
    submitBtn.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-arrow-up"/></svg>';
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-label', 'Send question');
    submitBtn.addEventListener('click', (e) => this.handleSubmitClick(e));

    controls.appendChild(spacer);
    controls.appendChild(micBtn);
    controls.appendChild(submitBtn);

    wrapper.appendChild(textarea);
    wrapper.appendChild(controls);

    this.container.appendChild(wrapper);
    this.element = wrapper;
    this.inputElement = textarea;
    this.submitButton = submitBtn;
    this.micButton = micBtn;

    // Auto-resize
    textarea.addEventListener('input', () => {
      textarea.style.height = 'auto';
      textarea.style.height = Math.min(textarea.scrollHeight, 200) + 'px';
    });
  }

  handleInput() {
    // Don't change button state while submitting (stop button should stay visible)
    if (this.isSubmitting) return;
    this.submitButton.disabled = this.inputElement.value.trim().length === 0;
  }

  handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.submit();
    }
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
      if (this.options.onStop) {
        this.options.onStop();
      }
      return;
    }

    this.submit();
  }

  submit() {
    if (this.isSubmitting) {
      // Text typed while an answer is still arriving is kept, not dropped.
      // Say why nothing was sent, and where to go instead.
      if (this.inputElement.value.trim().length > 0) this.flashBusyHint();
      return;
    }

    const value = this.inputElement.value.trim();
    if (value.length === 0) return;

    try {
      this.options.onSubmit(value);
    } finally {
      // Always clear the input, even if onSubmit throws
      this.clear();
    }
  }

  flashBusyHint() {
    const input = this.inputElement;
    if (!this._savedPlaceholder) this._savedPlaceholder = input.placeholder;
    input.placeholder = 'Answer still coming. Your text is kept. Press stop to ask something new.';
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      input.placeholder = this._savedPlaceholder;
      this._savedPlaceholder = null;
    }, 3500);
  }

  clear() {
    this.inputElement.value = '';
    this.inputElement.style.height = 'auto';
    this.submitButton.disabled = true;
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
      this.submitButton.innerHTML = '<svg class="icon icon--fill" aria-hidden="true"><use href="#i-square"/></svg>';
      this.submitButton.disabled = false;
      this.submitButton.title = 'Stop generating';
      this.submitButton.setAttribute('aria-label', 'Stop generating');
    } else {
      // Restore send button
      this.submitButton.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-arrow-up"/></svg>';
      this.submitButton.disabled = this.inputElement.value.trim().length === 0;
      this.submitButton.title = '';
      this.submitButton.setAttribute('aria-label', 'Send question');
    }
  }

  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIPromptBar = BeUIPromptBar;
