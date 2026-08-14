/**
 * BeUIThinking - Tabbed thinking/reasoning display
 * Shows Steps, Reasoning, Search, and Coding tabs
 */
class BeUIThinking {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      defaultOpen: options.defaultOpen !== false,
      defaultTab: options.defaultTab || 'steps',
      ...options
    };
    
    this.data = {
      steps: [],
      reasoning: [],
      search: [],
      coding: []
    };
    
    this.activeTab = this.options.defaultTab;
    this.isOpen = this.options.defaultOpen;
    this.element = null;
    
    this.render();
  }
  
  render() {
    const wrapper = document.createElement('div');
    wrapper.className = `beui-thinking ${this.isOpen ? 'is-open' : ''}`;
    
    // Header
    const header = document.createElement('div');
    header.className = 'beui-thinking__header';
    header.innerHTML = `
      <div class="beui-thinking__title">
        <div class="beui-thinking__icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 12l2 2 4-4"/>
            <circle cx="12" cy="12" r="10"/>
          </svg>
        </div>
        <span>Thinking</span>
      </div>
      <div class="beui-thinking__status">
        <span class="beui-thinking__status-text">Working...</span>
        <svg class="beui-thinking__chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </div>
    `;
    header.addEventListener('click', () => this.toggle());
    
    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'beui-thinking__tabs';
    
    ['steps', 'reasoning', 'search', 'coding'].forEach(tabName => {
      const tab = document.createElement('button');
      tab.className = `beui-thinking__tab ${tabName === this.activeTab ? 'is-active' : ''}`;
      tab.textContent = tabName.charAt(0).toUpperCase() + tabName.slice(1);
      tab.addEventListener('click', () => this.switchTab(tabName));
      tabs.appendChild(tab);
    });
    
    // Content
    const content = document.createElement('div');
    content.className = 'beui-thinking__content';
    
    // Panels
    ['steps', 'reasoning', 'search', 'coding'].forEach(panelName => {
      const panel = document.createElement('div');
      panel.className = `beui-thinking__panel ${panelName === this.activeTab ? 'is-active' : ''}`;
      panel.dataset.panel = panelName;
      content.appendChild(panel);
    });
    
    wrapper.appendChild(header);
    wrapper.appendChild(tabs);
    wrapper.appendChild(content);
    
    this.container.appendChild(wrapper);
    this.element = wrapper;
    this.contentElement = content;
  }
  
  toggle() {
    this.isOpen = !this.isOpen;
    this.element.classList.toggle('is-open', this.isOpen);
  }
  
  switchTab(tabName) {
    this.activeTab = tabName;
    
    // Update tabs
    this.element.querySelectorAll('.beui-thinking__tab').forEach((tab, idx) => {
      const tabNames = ['steps', 'reasoning', 'search', 'coding'];
      tab.classList.toggle('is-active', tabNames[idx] === tabName);
    });
    
    // Update panels
    this.element.querySelectorAll('.beui-thinking__panel').forEach(panel => {
      panel.classList.toggle('is-active', panel.dataset.panel === tabName);
    });
  }
  
  addStep(step) {
    this.data.steps.push(step);
    this.renderSteps();
  }
  
  renderSteps() {
    const panel = this.element.querySelector('[data-panel="steps"]');
    panel.innerHTML = '';
    
    this.data.steps.forEach((step, idx) => {
      const stepEl = document.createElement('div');
      stepEl.className = `beui-thinking__step ${step.status || ''}`;
      
      const indicator = document.createElement('div');
      indicator.className = 'beui-thinking__step-indicator';
      
      if (step.status === 'is-complete') {
        indicator.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>';
      } else {
        indicator.textContent = idx + 1;
      }
      
      const content = document.createElement('div');
      content.className = 'beui-thinking__step-content';
      
      const title = document.createElement('div');
      title.className = 'beui-thinking__step-title';
      title.textContent = step.title;
      
      content.appendChild(title);
      
      if (step.detail) {
        const detail = document.createElement('div');
        detail.className = 'beui-thinking__step-detail';
        detail.textContent = step.detail;
        content.appendChild(detail);
      }
      
      stepEl.appendChild(indicator);
      stepEl.appendChild(content);
      panel.appendChild(stepEl);
    });
  }
  
  addReasoning(text) {
    this.data.reasoning.push(text);
    this.renderReasoning();
  }
  
  renderReasoning() {
    const panel = this.element.querySelector('[data-panel="reasoning"]');
    panel.innerHTML = '';
    
    this.data.reasoning.forEach(text => {
      const reasoningEl = document.createElement('div');
      reasoningEl.className = 'beui-thinking__reasoning';
      reasoningEl.textContent = text;
      panel.appendChild(reasoningEl);
    });
  }
  
  addSearch(searchItem) {
    this.data.search.push(searchItem);
    this.renderSearch();
  }
  
  renderSearch() {
    const panel = this.element.querySelector('[data-panel="search"]');
    panel.innerHTML = '';
    
    this.data.search.forEach(item => {
      const searchEl = document.createElement('div');
      searchEl.className = 'beui-thinking__search-item';
      
      const icon = document.createElement('div');
      icon.className = 'beui-thinking__search-icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>';
      
      const text = document.createElement('div');
      text.className = 'beui-thinking__search-text';
      text.textContent = item.query || item;
      
      searchEl.appendChild(icon);
      searchEl.appendChild(text);
      panel.appendChild(searchEl);
    });
  }
  
  addCoding(codeItem) {
    this.data.coding.push(codeItem);
    this.renderCoding();
  }
  
  renderCoding() {
    const panel = this.element.querySelector('[data-panel="coding"]');
    panel.innerHTML = '';
    
    this.data.coding.forEach(item => {
      const codeEl = document.createElement('pre');
      codeEl.style.cssText = 'font-size: 12px; color: var(--color-text-muted); background: var(--color-bg); padding: 8px; border-radius: 4px; overflow-x: auto;';
      codeEl.textContent = item.code || item;
      panel.appendChild(codeEl);
    });
  }
  
  setStatus(status) {
    const statusText = this.element.querySelector('.beui-thinking__status-text');
    if (statusText) {
      statusText.textContent = status;
    }
  }
  
  complete() {
    this.setStatus('Complete');
    this.data.steps.forEach(step => {
      step.status = 'is-complete';
    });
    this.renderSteps();
  }
  
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIThinking = BeUIThinking;
