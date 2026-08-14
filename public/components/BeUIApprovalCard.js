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
    
    this.element = null;
    
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
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
      
      const radio = document.createElement('div');
      radio.className = 'beui-approval__option-radio';
      
      const text = document.createElement('div');
      text.className = 'beui-approval__option-text';
      text.textContent = typeof option === 'string' ? option : option.label;
      
      optionEl.appendChild(radio);
      optionEl.appendChild(text);
      
      optionEl.addEventListener('click', () => {
        this.selectedOption = idx;
        options.querySelectorAll('.beui-approval__option').forEach(el => {
          el.classList.remove('is-selected');
        });
        optionEl.classList.add('is-selected');
        
        // Enable approve button
        const approveBtn = wrapper.querySelector('.beui-approval__button--primary');
        if (approveBtn) approveBtn.disabled = false;
      });
      
      options.appendChild(optionEl);
    });
    
    // Actions
    const actions = document.createElement('div');
    actions.className = 'beui-approval__actions';
    
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'beui-approval__button beui-approval__button--secondary';
    rejectBtn.textContent = 'Reject';
    rejectBtn.addEventListener('click', () => this.onReject());
    
    const approveBtn = document.createElement('button');
    approveBtn.className = 'beui-approval__button beui-approval__button--primary';
    approveBtn.textContent = 'Approve';
    approveBtn.disabled = true;
    approveBtn.addEventListener('click', () => {
      if (this.selectedOption !== null) {
        const selected = this.optionList[this.selectedOption];
        this.onApprove(typeof selected === 'string' ? selected : selected.value);
      }
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
