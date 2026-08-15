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
      sources: options.sources || [],
      commands: options.commands || [],
      models: options.models || [],
      ...options
    };
    
    this.element = null;
    this.inputElement = null;
    this.submitButton = null;
    this.dropdown = null;
    this.isDropdownOpen = false;
    this.dropdownType = null; // 'sources', 'commands', or 'models'
    
    this.render();
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
    
    // Model picker button (if models provided)
    if (this.options.models.length > 0) {
      const modelBtn = document.createElement('button');
      modelBtn.type = 'button';
      modelBtn.className = 'beui-prompt-bar__button beui-prompt-bar__button--model';
      const currentModel = this.options.models[0];
      modelBtn.innerHTML = `
        <i class="fa-solid ${currentModel.icon}"></i>
        <span>${currentModel.name}</span>
        <i class="fa-solid fa-chevron-down" style="font-size: 10px;"></i>
      `;
      modelBtn.addEventListener('click', () => this.showModels());
      actions.appendChild(modelBtn);
      this.modelButton = modelBtn;
    }
    
    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'beui-prompt-bar__button beui-prompt-bar__button--submit';
    submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
    submitBtn.disabled = true;
    submitBtn.addEventListener('click', () => this.submit());
    
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
  
  handleInput(e) {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart;
    
    // Enable/disable submit
    this.submitButton.disabled = value.trim().length === 0;
    
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
  
  showModels() {
    this.dropdown.innerHTML = '';
    this.dropdownType = 'models';
    
    this.options.models.forEach(model => {
      const item = document.createElement('div');
      item.className = 'beui-prompt-bar__dropdown-item';
      
      const icon = document.createElement('i');
      icon.className = `fa-solid ${model.icon}`;
      
      const textWrapper = document.createElement('div');
      textWrapper.className = 'beui-prompt-bar__dropdown-text';
      
      const name = document.createElement('span');
      name.className = 'beui-prompt-bar__dropdown-name';
      name.textContent = model.name;
      
      const tag = document.createElement('span');
      tag.className = 'beui-prompt-bar__dropdown-tag';
      tag.textContent = model.tag || '';
      
      textWrapper.appendChild(name);
      textWrapper.appendChild(tag);
      
      item.appendChild(icon);
      item.appendChild(textWrapper);
      
      item.addEventListener('click', () => {
        this.selectModel(model);
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
  
  selectModel(model) {
    if (this.modelButton) {
      this.modelButton.innerHTML = `
        <i class="fa-solid ${model.icon}"></i>
        <span>${model.name}</span>
        <i class="fa-solid fa-chevron-down" style="font-size: 10px;"></i>
      `;
    }
    
    this.hideDropdown();
    this.inputElement.focus();
    
    if (this.options.onModelChange) {
      this.options.onModelChange(model);
    }
  }
  
  submit() {
    const value = this.inputElement.value.trim();
    if (value.length === 0) return;
    
    this.options.onSubmit(value);
    this.clear();
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
    this.submitButton.disabled = value.trim().length === 0;
  }
  
  setDisabled(disabled) {
    this.inputElement.disabled = disabled;
    this.submitButton.disabled = disabled || this.inputElement.value.trim().length === 0;
  }
  
  setSubmitting(isSubmitting) {
    if (isSubmitting) {
      this.submitButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      this.submitButton.disabled = true;
    } else {
      this.submitButton.innerHTML = '<i class="fa-solid fa-paper-plane"></i>';
      this.submitButton.disabled = this.inputElement.value.trim().length === 0;
    }
  }
  
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIPromptBar = BeUIPromptBar;
