/**
 * BeUIPromptBar - Enhanced composer with @-mentions and /-commands
 * Supports @-mentioning sources, /-commands, and model picker
 */
class BeUIPromptBar {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      placeholder: options.placeholder || 'Ask a legal question...',
      onSubmit: options.onSubmit || (() => {}),
      mentions: options.mentions || [],
      commands: options.commands || [
        { name: 'help', description: 'Show help' },
        { name: 'clear', description: 'Clear conversation' }
      ],
      ...options
    };
    
    this.element = null;
    this.inputElement = null;
    this.submitButton = null;
    this.mentionsDropdown = null;
    this.isMentionsOpen = false;
    
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
    
    // Submit button
    const submitBtn = document.createElement('button');
    submitBtn.className = 'beui-prompt-bar__button beui-prompt-bar__button--submit';
    submitBtn.innerHTML = '<svg class="beui-prompt-bar__button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    submitBtn.disabled = true;
    submitBtn.addEventListener('click', () => this.submit());
    
    actions.appendChild(submitBtn);
    
    inputWrapper.appendChild(textarea);
    inputWrapper.appendChild(actions);
    
    // Mentions dropdown
    const mentions = document.createElement('div');
    mentions.className = 'beui-prompt-bar__mentions';
    
    wrapper.appendChild(inputWrapper);
    wrapper.appendChild(mentions);
    
    this.container.appendChild(wrapper);
    this.element = wrapper;
    this.inputElement = textarea;
    this.submitButton = submitBtn;
    this.mentionsDropdown = mentions;
    
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
      this.showMentions(mentionMatch[1]);
    } else {
      this.hideMentions();
    }
    
    // Check for / command
    const commandMatch = textBeforeCursor.match(/^\/(\w*)$/);
    if (commandMatch) {
      this.showCommands(commandMatch[1]);
    }
  }
  
  handleKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.submit();
    } else if (e.key === 'Escape') {
      this.hideMentions();
    }
  }
  
  showMentions(query) {
    const filtered = this.options.mentions.filter(m => 
      m.toLowerCase().includes(query.toLowerCase())
    );
    
    if (filtered.length === 0) {
      this.hideMentions();
      return;
    }
    
    this.mentionsDropdown.innerHTML = '';
    
    filtered.forEach(mention => {
      const item = document.createElement('div');
      item.className = 'beui-prompt-bar__mention-item';
      
      const icon = document.createElement('span');
      icon.className = 'beui-prompt-bar__mention-icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
      
      const text = document.createElement('span');
      text.className = 'beui-prompt-bar__mention-text';
      text.textContent = mention;
      
      item.appendChild(icon);
      item.appendChild(text);
      
      item.addEventListener('click', () => {
        this.insertMention(mention);
      });
      
      this.mentionsDropdown.appendChild(item);
    });
    
    this.mentionsDropdown.classList.add('is-visible');
    this.isMentionsOpen = true;
  }
  
  showCommands(query) {
    const filtered = this.options.commands.filter(c => 
      c.name.toLowerCase().includes(query.toLowerCase())
    );
    
    if (filtered.length === 0) {
      this.hideMentions();
      return;
    }
    
    this.mentionsDropdown.innerHTML = '';
    
    filtered.forEach(command => {
      const item = document.createElement('div');
      item.className = 'beui-prompt-bar__mention-item';
      
      const text = document.createElement('span');
      text.className = 'beui-prompt-bar__mention-text';
      text.textContent = `/${command.name} - ${command.description}`;
      
      item.appendChild(text);
      
      item.addEventListener('click', () => {
        this.executeCommand(command);
      });
      
      this.mentionsDropdown.appendChild(item);
    });
    
    this.mentionsDropdown.classList.add('is-visible');
    this.isMentionsOpen = true;
  }
  
  hideMentions() {
    this.mentionsDropdown.classList.remove('is-visible');
    this.isMentionsOpen = false;
  }
  
  insertMention(mention) {
    const value = this.inputElement.value;
    const cursorPos = this.inputElement.selectionStart;
    const textBeforeCursor = value.slice(0, cursorPos);
    const textAfterCursor = value.slice(cursorPos);
    
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/);
    if (mentionMatch) {
      const beforeMention = textBeforeCursor.slice(0, mentionMatch.index);
      const newValue = `${beforeMention}@${mention} ${textAfterCursor}`;
      
      this.inputElement.value = newValue;
      const newCursorPos = beforeMention.length + mention.length + 2;
      this.inputElement.setSelectionRange(newCursorPos, newCursorPos);
    }
    
    this.hideMentions();
    this.inputElement.focus();
  }
  
  executeCommand(command) {
    this.inputElement.value = '';
    this.hideMentions();
    
    if (this.options.onCommand) {
      this.options.onCommand(command);
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
    this.hideMentions();
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
      this.submitButton.innerHTML = '<div class="beui-tool-chip__spinner" style="width:18px;height:18px;border-width:2px;"></div>';
      this.submitButton.disabled = true;
    } else {
      this.submitButton.innerHTML = '<svg class="beui-prompt-bar__button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
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
