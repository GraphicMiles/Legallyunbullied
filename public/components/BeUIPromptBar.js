/**
 * BeUIPromptBar - Enhanced composer with @-mentions, /-commands, and model picker
 * Full-featured implementation with FontAwesome icons
 */
class BeUIPromptBar {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      placeholder: options.placeholder || 'Ask a legal question...',
      onSubmit: options.onSubmit || (() => {}),
      onStop: options.onStop || null,
      sources: options.sources || [],
      commands: options.commands || [],
      ...options
    };
    
    this.element = null;
    this.inputElement = null;
    this.submitButton = null;
    this.dropdown = null;
    this.isDropdownOpen = false;
    this.dropdownType = null;
    this.isSubmitting = false;
    
    // Click-outside handler reference for cleanup
    this._outsideClickHandler = (e) => this.handleOutsideClick(e);
    
    this.render();
    this.attachOutsideClickListener();
  }
  
  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'beui-prompt-bar';
    
    // Input wrapper
    const inputWrapper = document.createElement('div');
    inputWrapper.className = 'beui-prompt-bar__input-wrapper';
    
    // Textarea
    const textarea = document.createElement('textarea');
    textarea.className = 'beui-prompt-bar__input';
    textarea.placeholder = this.options.placeholder;
    textarea.rows = 1;
    textarea.addEventListener('input', (e) => this.handleInput(e));
    textarea.addEventListener('keydown', (e) => this.handleKeydown(e));
    
    // Actions
    const actions = document.createElement('div');
    actions.className = 'beui-prompt-bar__actions';
    
    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'beui-prompt-bar__button beui-prompt-bar__button--submit';
    submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
    submitBtn.disabled = true;
    submitBtn.addEventListener('click', (e) => this.handleSubmitClick(e));
    
    actions.appendChild(submitBtn);
    
    inputWrapper.appendChild(textarea);
    inputWrapper.appendChild(actions);
    
    // Dropdown
    const dropdown = document.createElement('div');
    dropdown.className = 'beui-prompt-bar__dropdown';
    
    wrapper.appendChild(inputWrapper);
    wrapper.appendChild(dropdown);
    
    this.container.appendChild(wrapper);
    this.element = wrapper;
    this.inputElement = textarea;
    this.submitButton = submitBtn;
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
    const cursorPos = e.target.selectionStart;
    
    // Don't change button state while submitting (stop button should stay visible)
    if (!this.isSubmitting) {
      this.submitButton.disabled = value.trim().length === 0;
    }
    
    // Check for @ mention
    const textBeforeCursor = value.slice(0, cursorPos);
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    
    if (mentionMatch) {
      this.showSources(mentionMatch[1]);
      return;
    }
    
    // Check for / command
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
      this.submit();
    } else if (e.key === 'Escape') {
      this.hideDropdown();
    }
  }
  
  showSources(query) {
    const filtered = this.options.sources.filter(s => 
      s.name.toLowerCase().includes(query.toLowerCase())
    );
    
    if (filtered.length === 0) {
      this.hideDropdown();
      return;
    }
    
    this.dropdown.innerHTML = '';
    this.dropdownType = 'sources';
    
    filtered.forEach(source => {
      const item = document.createElement('div');
      item.className = 'beui-prompt-bar__dropdown-item';
      
      const icon = document.createElement('i');
      icon.className = `fa-solid ${source.glyph || 'fa-file'}`;
      
      const textWrapper = document.createElement('div');
      textWrapper.className = 'beui-prompt-bar__dropdown-text';
      
      const name = document.createElement('span');
      name.className = 'beui-prompt-bar__dropdown-name';
      name.textContent = source.name;
      
      const desc = document.createElement('span');
      desc.className = 'beui-prompt-bar__dropdown-desc';
      desc.textContent = source.desc || '';
      
      textWrapper.appendChild(name);
      textWrapper.appendChild(desc);
      
      item.appendChild(icon);
      item.appendChild(textWrapper);
      
      item.addEventListener('click', () => {
        this.insertSource(source);
      });
      
      this.dropdown.appendChild(item);
    });
    
    this.dropdown.classList.add('is-visible');
    this.isDropdownOpen = true;
  }
  
  showCommands(query) {
    const filtered = this.options.commands.filter(c => 
      c.name.toLowerCase().includes(query.toLowerCase())
    );
    
    if (filtered.length === 0) {
      this.hideDropdown();
      return;
    }
    
    this.dropdown.innerHTML = '';
    this.dropdownType = 'commands';
    
    filtered.forEach(command => {
      const item = document.createElement('div');
      item.className = 'beui-prompt-bar__dropdown-item';
      
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
  }
  
  insertSource(source) {
    const value = this.inputElement.value;
    const cursorPos = this.inputElement.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const textAfterCursor = value.slice(cursorPos);
    
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      const beforeMention = textBeforeCursor.slice(0, mentionMatch.index);
      const newValue = `${beforeMention}@${source.name} ${textAfterCursor}`;
      
      this.inputElement.value = newValue;
      const newCursorPos = beforeMention.length + source.name.length + 2;
      this.inputElement.setSelectionRange(newCursorPos, newCursorPos);
    }
    
    this.hideDropdown();
    this.inputElement.focus();
  }
  
  executeCommand(command) {
    this.inputElement.value = '';
    this.hideDropdown();
    this.inputElement.focus();
    
    // Insert command as text
    this.inputElement.value = `${command.name} `;
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
    if (isSubmitting) {
      // Show stop button — enabled so user can click to abort
      this.submitButton.innerHTML = '<i class="fa-solid fa-stop"></i>';
      this.submitButton.disabled = false;
      this.submitButton.title = 'Stop generating';
    } else {
      // Restore send button
      this.submitButton.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
      this.submitButton.disabled = this.inputElement.value.trim().length === 0;
      this.submitButton.title = '';
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
