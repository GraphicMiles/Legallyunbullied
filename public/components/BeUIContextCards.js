/**
 * BeUIContextCards - Source-attributed knowledge chunks
 * Shows retrieved context with file/type badges
 */
class BeUIContextCards {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      maxVisible: options.maxVisible || 3,
      ...options
    };
    
    this.cards = [];
    this.element = null;
    
    this.render();
  }
  
  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'beui-context';
    
    this.container.appendChild(wrapper);
    this.element = wrapper;
  }
  
  addCard(card) {
    this.cards.push(card);
    this.renderCard(card, this.cards.length - 1);
  }
  
  renderCard(card, index) {
    const cardEl = document.createElement('div');
    cardEl.className = 'beui-context-card';
    
    // Header
    const header = document.createElement('div');
    header.className = 'beui-context-card__header';
    
    // Badge
    const badge = document.createElement('span');
    badge.className = 'beui-context-card__badge';
    
    const badgeIcon = document.createElement('span');
    badgeIcon.className = 'beui-context-card__badge-icon';
    badgeIcon.innerHTML = this.getBadgeIcon(card.type);
    
    const badgeText = document.createTextNode(card.type || 'SOURCE');
    
    badge.appendChild(badgeIcon);
    badge.appendChild(badgeText);
    
    // Title
    const title = document.createElement('div');
    title.className = 'beui-context-card__title';
    title.textContent = card.title || card.source;
    
    // Chevron
    const chevron = document.createElement('span');
    chevron.className = 'beui-context-card__chevron';
    chevron.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="6 9 12 15 18 9"/></svg>';
    
    header.appendChild(badge);
    header.appendChild(title);
    header.appendChild(chevron);
    
    // Body
    const body = document.createElement('div');
    body.className = 'beui-context-card__body';
    
    const excerpt = document.createElement('div');
    excerpt.className = 'beui-context-card__excerpt';
    excerpt.textContent = card.excerpt || card.text;
    
    body.appendChild(excerpt);
    
    // Toggle
    header.addEventListener('click', () => {
      cardEl.classList.toggle('is-open');
    });
    
    cardEl.appendChild(header);
    cardEl.appendChild(body);
    
    this.element.appendChild(cardEl);
  }
  
  getBadgeIcon(type) {
    const typeUpper = (type || '').toUpperCase();
    
    if (typeUpper.includes('PDF')) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    }
    
    if (typeUpper.includes('CSV') || typeUpper.includes('EXCEL')) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>';
    }
    
    if (typeUpper.includes('STATUTE') || typeUpper.includes('LAW')) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
    }
    
    if (typeUpper.includes('CASE')) {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>';
    }
    
    // Default
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
  }
  
  setCards(cards) {
    this.cards = [];
    this.element.innerHTML = '';
    cards.forEach(card => this.addCard(card));
  }
  
  clear() {
    this.cards = [];
    this.element.innerHTML = '';
  }
  
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIContextCards = BeUIContextCards;
