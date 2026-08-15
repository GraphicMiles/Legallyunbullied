/**
 * BeUIApprovalCard - Human-in-the-loop approval requests
 * Shows questions with selectable options
 */
class BeUIApprovalCard {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    
    this.question = options.question || '';
    this.optionList = options.options || [];
    this.selectedOption = null;
    this.onApprove = options.onApprove || (() => {});
    this.onReject = options.onReject || (() => {});
    this.onSelect = options.onSelect || (() => {});
    
    this.element = null;
    this.isApproved = false;
    
    this.render();
  }
  
  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'beui-approval';
    
    // Header
    const header = document.createElement('div');
    header.className = 'beui-approval__header';
    header.innerHTML = `
      <div class="beui-approval__icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      </div>
      <div class="beui-approval__title">Approval Required</div>
    `;
    
    // Question
    const question = document.createElement('div');
    question.className = 'beui-approval__question';
    question.textContent = this.question;
    
    // Options
    const options = document.createElement('div');
    options.className = 'beui-approval__options';
    
    this.optionList.forEach((option, idx) => {
      const optionEl = document.createElement('div');
      optionEl.className = 'beui-approval__option';
      optionEl.style.animationDelay = `${idx * 50}ms`;
      
      const radio = document.createElement('div');
      radio.className = 'beui-approval__option-radio';
      
      const text = document.createElement('div');
      text.className = 'beui-approval__option-text';
      text.textContent = typeof option === 'string' ? option : option.label;
      
      optionEl.appendChild(radio);
      optionEl.appendChild(text);
      
      optionEl.addEventListener('click', () => {
        if (this.isApproved) return;
        this.selectedOption = idx;
        options.querySelectorAll('.beui-approval__option').forEach(el => {
          el.classList.remove('is-selected');
        });
        optionEl.classList.add('is-selected');
        
        // Enable approve button
        const approveBtn = wrapper.querySelector('.beui-approval__button--primary');
        if (approveBtn) approveBtn.disabled = false;
        
        if (this.onSelect) {
          this.onSelect(typeof option === 'string' ? option : option.value);
        }
      });
      
      options.appendChild(optionEl);
    });
    
    // Actions
    const actions = document.createElement('div');
    actions.className = 'beui-approval__actions';
    
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'beui-approval__button beui-approval__button--secondary';
    rejectBtn.textContent = 'Reject';
    rejectBtn.addEventListener('click', () => {
      if (this.isApproved) return;
      this.onReject();
      wrapper.classList.add('is-rejected');
    });
    
    const approveBtn = document.createElement('button');
    approveBtn.className = 'beui-approval__button beui-approval__button--primary';
    approveBtn.textContent = 'Approve';
    approveBtn.disabled = true;
    approveBtn.addEventListener('click', () => {
      if (this.isApproved || this.selectedOption === null) return;
      const selected = this.optionList[this.selectedOption];
      this.isApproved = true;
      wrapper.classList.add('is-approved');
      approveBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>';
      approveBtn.disabled = true;
      rejectBtn.disabled = true;
      this.onApprove(typeof selected === 'string' ? selected : selected.value);
    });
    
    actions.appendChild(rejectBtn);
    actions.appendChild(approveBtn);
    
    wrapper.appendChild(header);
    wrapper.appendChild(question);
    wrapper.appendChild(options);
    wrapper.appendChild(actions);
    
    this.container.appendChild(wrapper);
    this.element = wrapper;
  }
  
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIApprovalCard = BeUIApprovalCard;
