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
    this.expandedTool = null;
    
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
    const toolData = { 
      ...tool, 
      id,
      startTime: tool.status === 'is-running' ? Date.now() : null,
      duration: 0
    };
    this.tools.push(toolData);
    
    this.renderTool(toolData);
    
    // Start timer for running tools
    if (toolData.status === 'is-running') {
      this.startTimer(toolData);
    }
    
    return id;
  }
  
  startTimer(tool) {
    tool.timerInterval = setInterval(() => {
      if (tool.status !== 'is-running') {
        clearInterval(tool.timerInterval);
        return;
      }
      tool.duration = Date.now() - tool.startTime;
      const chip = this.element.querySelector(`[data-tool-id="${tool.id}"]`);
      if (chip) {
        const durationEl = chip.querySelector('.beui-tool-chip__duration');
        if (durationEl) {
          durationEl.textContent = this.formatDuration(tool.duration);
        }
      }
    }, 100);
  }
  
  formatDuration(ms) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
  
  renderTool(tool) {
    const chip = document.createElement('div');
    chip.className = `beui-tool-chip ${tool.status || ''}`;
    chip.dataset.toolId = tool.id;
    chip.style.animation = 'slideInRight 0.3s ease-out';
    
    // Icon/spinner
    const iconWrapper = document.createElement('span');
    iconWrapper.className = 'beui-tool-chip__icon-wrapper';
    
    if (tool.status === 'is-running') {
      const spinner = document.createElement('span');
      spinner.className = 'beui-tool-chip__spinner';
      iconWrapper.appendChild(spinner);
    } else if (tool.status === 'is-complete') {
      const icon = document.createElement('span');
      icon.className = 'beui-tool-chip__icon beui-tool-chip__icon--complete';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>';
      iconWrapper.appendChild(icon);
    } else if (tool.status === 'is-failed') {
      const icon = document.createElement('span');
      icon.className = 'beui-tool-chip__icon beui-tool-chip__icon--failed';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      iconWrapper.appendChild(icon);
    } else {
      const icon = document.createElement('span');
      icon.className = 'beui-tool-chip__icon';
      icon.innerHTML = this.getToolIcon(tool.name);
      iconWrapper.appendChild(icon);
    }
    
    // Label
    const label = document.createElement('span');
    label.className = 'beui-tool-chip__label';
    label.textContent = tool.name;
    
    // Duration
    const duration = document.createElement('span');
    duration.className = 'beui-tool-chip__duration';
    duration.textContent = tool.duration ? this.formatDuration(tool.duration) : '';
    
    // Expand indicator
    const expandIcon = document.createElement('span');
    expandIcon.className = 'beui-tool-chip__expand';
    expandIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><polyline points="6 9 12 15 18 9"/></svg>';
    
    chip.appendChild(iconWrapper);
    chip.appendChild(label);
    chip.appendChild(duration);
    chip.appendChild(expandIcon);
    
    // Click to expand
    chip.addEventListener('click', () => {
      this.toggleExpand(tool.id);
      if (tool.onClick) tool.onClick(tool);
    });
    
    this.element.appendChild(chip);
    
    // Details panel (hidden by default)
    if (tool.details) {
      const details = document.createElement('div');
      details.className = 'beui-tool-chip__details';
      details.dataset.toolId = tool.id;
      details.innerHTML = `<pre>${tool.details}</pre>`;
      this.element.appendChild(details);
    }
  }
  
  toggleExpand(toolId) {
    const details = this.element.querySelector(`.beui-tool-chip__details[data-tool-id="${toolId}"]`);
    const chip = this.element.querySelector(`[data-tool-id="${toolId}"]`);
    
    if (!details || !chip) return;
    
    const isExpanded = details.classList.contains('is-open');
    
    // Close all others
    this.element.querySelectorAll('.beui-tool-chip__details.is-open').forEach(d => {
      d.classList.remove('is-open');
    });
    this.element.querySelectorAll('.beui-tool-chip.is-expanded').forEach(c => {
      c.classList.remove('is-expanded');
    });
    
    if (!isExpanded) {
      details.classList.add('is-open');
      chip.classList.add('is-expanded');
      this.expandedTool = toolId;
    } else {
      this.expandedTool = null;
    }
  }
  
  updateTool(id, updates) {
    const toolIndex = this.tools.findIndex(t => t.id === id);
    if (toolIndex === -1) return;
    
    const oldStatus = this.tools[toolIndex].status;
    this.tools[toolIndex] = { ...this.tools[toolIndex], ...updates };
    
    // Stop timer if no longer running
    if (oldStatus === 'is-running' && updates.status !== 'is-running') {
      if (this.tools[toolIndex].timerInterval) {
        clearInterval(this.tools[toolIndex].timerInterval);
      }
      this.tools[toolIndex].duration = Date.now() - this.tools[toolIndex].startTime;
    }
    
    // Re-render
    const chip = this.element.querySelector(`[data-tool-id="${id}"]`);
    if (chip) {
      chip.remove();
      const details = this.element.querySelector(`.beui-tool-chip__details[data-tool-id="${id}"]`);
      if (details) details.remove();
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
    this.tools.forEach(tool => {
      if (tool.timerInterval) clearInterval(tool.timerInterval);
    });
    this.tools = [];
    this.element.innerHTML = '';
  }
  
  destroy() {
    this.clear();
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIToolChips = BeUIToolChips;
