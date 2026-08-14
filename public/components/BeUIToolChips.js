/**
 * BeUIToolChips - Compact tool call indicators
 * Shows tool calls as collapsible chips with status
 */
class BeUIToolChips {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    
    this.tools = [];
    this.element = null;
    
    this.render();
  }
  
  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'beui-tools';
    
    this.container.appendChild(wrapper);
    this.element = wrapper;
  }
  
  addTool(tool) {
    const id = tool.id || `tool-${this.tools.length}`;
    const toolData = { ...tool, id };
    this.tools.push(toolData);
    
    this.renderTool(toolData);
    return id;
  }
  
  renderTool(tool) {
    const chip = document.createElement('div');
    chip.className = `beui-tool-chip ${tool.status || ''}`;
    chip.dataset.toolId = tool.id;
    
    // Icon/spinner
    const iconWrapper = document.createElement('span');
    
    if (tool.status === 'is-running') {
      const spinner = document.createElement('span');
      spinner.className = 'beui-tool-chip__spinner';
      iconWrapper.appendChild(spinner);
    } else {
      const icon = document.createElement('span');
      icon.className = 'beui-tool-chip__icon';
      icon.innerHTML = this.getToolIcon(tool.name);
      iconWrapper.appendChild(icon);
    }
    
    // Label
    const label = document.createElement('span');
    label.textContent = tool.name;
    
    chip.appendChild(iconWrapper);
    chip.appendChild(label);
    
    if (tool.onClick) {
      chip.addEventListener('click', () => tool.onClick(tool));
    }
    
    this.element.appendChild(chip);
  }
  
  updateTool(id, updates) {
    const toolIndex = this.tools.findIndex(t => t.id === id);
    if (toolIndex === -1) return;
    
    this.tools[toolIndex] = { ...this.tools[toolIndex], ...updates };
    
    // Re-render
    const chip = this.element.querySelector(`[data-tool-id="${id}"]`);
    if (chip) {
      chip.remove();
      this.renderTool(this.tools[toolIndex]);
    }
  }
  
  getToolIcon(toolName) {
    const name = (toolName || '').toLowerCase();
    
    if (name.includes('search') || name.includes('find')) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
    }
    
    if (name.includes('read') || name.includes('fetch')) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>';
    }
    
    if (name.includes('write') || name.includes('draft')) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>';
    }
    
    if (name.includes('check') || name.includes('verify')) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';
    }
    
    // Default
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>';
  }
  
  clear() {
    this.tools = [];
    this.element.innerHTML = '';
  }
  
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIToolChips = BeUIToolChips;
