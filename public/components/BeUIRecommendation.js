/**
 * BeUIRecommendation - Action recommendation with confidence meter
 * Shows recommended action with confidence score and alternatives
 */
class BeUIRecommendation {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    
    this.action = options.action || '';
    this.confidence = options.confidence || 0;
    this.reasoning = options.reasoning || '';
    this.alternatives = options.alternatives || [];
    this.onAccept = options.onAccept || (() => {});
    this.onAlternative = options.onAlternative || (() => {});
    
    this.element = null;
    
    this.render();
  }
  
  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'beui-recommendation';
    
    // Header
    const header = document.createElement('div');
    header.className = 'beui-recommendation__header';
    
    const title = document.createElement('div');
    title.className = 'beui-recommendation__title';
    title.innerHTML = `
      <span class="beui-recommendation__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg>
      </span>
      <span>Recommendation</span>
    `;
    
    const confidence = document.createElement('div');
    confidence.className = 'beui-recommendation__confidence';
    
    const confidenceBar = document.createElement('div');
    confidenceBar.className = 'beui-recommendation__confidence-bar';
    
    const confidenceFill = document.createElement('div');
    confidenceFill.className = 'beui-recommendation__confidence-fill';
    confidenceFill.style.width = `${this.confidence}%`;
    
    confidenceBar.appendChild(confidenceFill);
    
    const confidenceText = document.createElement('span');
    confidenceText.textContent = `${this.confidence}%`;
    
    confidence.appendChild(confidenceBar);
    confidence.appendChild(confidenceText);
    
    header.appendChild(title);
    header.appendChild(confidence);
    
    // Action
    const action = document.createElement('div');
    action.className = 'beui-recommendation__action';
    action.textContent = this.action;
    
    // Reasoning
    let reasoningEl = null;
    if (this.reasoning) {
      reasoningEl = document.createElement('div');
      reasoningEl.className = 'beui-recommendation__reasoning';
      reasoningEl.textContent = this.reasoning;
    }
    
    // Alternatives
    let alternativesEl = null;
    if (this.alternatives.length > 0) {
      alternativesEl = document.createElement('div');
      alternativesEl.className = 'beui-recommendation__alternatives';
      
      const alternativesTitle = document.createElement('div');
      alternativesTitle.className = 'beui-recommendation__alternatives-title';
      alternativesTitle.textContent = 'Alternatives';
      
      alternativesEl.appendChild(alternativesTitle);
      
      this.alternatives.forEach(alt => {
        const altEl = document.createElement('div');
        altEl.className = 'beui-recommendation__alternative';
        
        const icon = document.createElement('span');
        icon.className = 'beui-recommendation__alternative-icon';
        icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>';
        
        const text = document.createElement('span');
        text.textContent = typeof alt === 'string' ? alt : alt.text;
        
        altEl.appendChild(icon);
        altEl.appendChild(text);
        
        altEl.addEventListener('click', () => {
          this.onAlternative(typeof alt === 'string' ? alt : alt.value);
        });
        
        alternativesEl.appendChild(altEl);
      });
    }
    
    // Actions
    const actions = document.createElement('div');
    actions.className = 'beui-recommendation__actions';
    
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'beui-recommendation__button beui-recommendation__button--primary';
    acceptBtn.textContent = 'Accept';
    acceptBtn.addEventListener('click', () => this.onAccept());
    
    actions.appendChild(acceptBtn);
    
    wrapper.appendChild(header);
    wrapper.appendChild(action);
    if (reasoningEl) wrapper.appendChild(reasoningEl);
    if (alternativesEl) wrapper.appendChild(alternativesEl);
    wrapper.appendChild(actions);
    
    this.container.appendChild(wrapper);
    this.element = wrapper;
  }
  
  update(options) {
    this.action = options.action || this.action;
    this.confidence = options.confidence || this.confidence;
    this.reasoning = options.reasoning || this.reasoning;
    this.alternatives = options.alternatives || this.alternatives;
    
    // Re-render
    if (this.element) {
      this.element.remove();
    }
    this.render();
  }
  
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIRecommendation = BeUIRecommendation;
