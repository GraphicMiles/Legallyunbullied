/**
 * Beautiful UI Context Cards - Vanilla JS
 * Retrieved knowledge chunks with their sources
 */

class BeUIContextCards {
  constructor(container, options = {}) {
    this.container = container;
    this.chunks = options.chunks || [];
    this.chipsShown = false;
    this.expandedCards = new Set();
    this.element = null;
    
    this.render();
    
    // Show chips after delay
    setTimeout(() => {
      this.chipsShown = true;
      this.render();
    }, 700);
  }
  
  render() {
    this.element = document.createElement("div");
    this.element.className = "beui-context-cards";
    this.element.style.cssText = "display: flex; flex-direction: column; gap: 8px; width: 100%;";
    
    // Header
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 2px 4px;
      animation: fade-in 400ms ease-out both;
    `;
    
    const headerLeft = document.createElement("div");
    headerLeft.style.cssText = "display: flex; align-items: center; gap: 8px;";
    
    const headerLabel = document.createElement("span");
    headerLabel.style.cssText = "font-size: 13px; font-weight: 600; color: var(--color-text);";
    headerLabel.textContent = "Sources";
    
    const headerCount = document.createElement("span");
    headerCount.style.cssText = `
      display: inline-flex;
      align-items: center;
      height: 20px;
      padding: 0 6px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
      border-radius: 6px;
      font-size: 11.5px;
      font-weight: 500;
      color: var(--color-text-muted);
      font-variant-numeric: tabular-nums;
    `;
    headerCount.textContent = this.chunks.length.toString();
    
    headerLeft.appendChild(headerLabel);
    headerLeft.appendChild(headerCount);
    
    const expandAllBtn = document.createElement("button");
    expandAllBtn.style.cssText = `
      background: none;
      border: none;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 500;
      color: var(--color-accent);
      cursor: pointer;
      border-radius: 4px;
      transition: background-color 200ms;
    `;
    expandAllBtn.textContent = this.expandedCards.size === this.chunks.length ? "Collapse all" : "Expand all";
    expandAllBtn.addEventListener("click", () => {
      if (this.expandedCards.size === this.chunks.length) {
        this.expandedCards.clear();
      } else {
        this.chunks.forEach((_, i) => this.expandedCards.add(i));
      }
      this.render();
    });
    expandAllBtn.addEventListener("mouseenter", () => {
      expandAllBtn.style.backgroundColor = "var(--color-surface)";
    });
    expandAllBtn.addEventListener("mouseleave", () => {
      expandAllBtn.style.backgroundColor = "transparent";
    });
    
    header.appendChild(headerLeft);
    header.appendChild(expandAllBtn);
    this.element.appendChild(header);
    
    // Cards
    this.chunks.forEach((chunk, i) => {
      const isExpanded = this.expandedCards.has(i);
      const card = document.createElement("div");
      card.style.cssText = `
        overflow: hidden;
        border-radius: 10px;
        background: var(--color-surface);
        border: 1px solid ${isExpanded ? "var(--color-accent-border)" : "var(--color-border)"};
        animation: fade-up 400ms cubic-bezier(0.23, 1, 0.32, 1) ${i * 100}ms both;
        transition: border-color 200ms;
      `;
      
      // Card header bar - clickable to expand/collapse
      const cardHeader = document.createElement("div");
      cardHeader.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border-bottom: 1px solid var(--color-border);
        cursor: pointer;
        user-select: none;
        transition: background-color 200ms;
      `;
      
      const expandIcon = document.createElement("span");
      expandIcon.style.cssText = `
        display: flex;
        align-items: center;
        justify-content: center;
        width: 20px;
        height: 20px;
        transition: transform 200ms;
        transform: rotate(${isExpanded ? "180deg" : "0deg"});
        color: var(--color-text-faint);
        flex-shrink: 0;
      `;
      expandIcon.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>`;
      
      const cardIcon = document.createElement("span");
      cardIcon.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        font-weight: 500;
        color: var(--color-text);
        flex: 1;
        min-width: 0;
      `;
      cardIcon.innerHTML = `
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <path d="M4 6h16M4 12h16M4 18h10"/>
        </svg>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${chunk.title}</span>
      `;
      
      const cardChars = document.createElement("span");
      cardChars.style.cssText = `
        flex-shrink: 0;
        font-size: 11px;
        color: var(--color-text-faint);
        font-variant-numeric: tabular-nums;
        padding: 2px 6px;
        background: var(--color-bg);
        border-radius: 4px;
      `;
      cardChars.textContent = chunk.chars;
      
      cardHeader.appendChild(expandIcon);
      cardHeader.appendChild(cardIcon);
      cardHeader.appendChild(cardChars);
      
      cardHeader.addEventListener("click", () => {
        if (isExpanded) {
          this.expandedCards.delete(i);
        } else {
          this.expandedCards.add(i);
        }
        this.render();
      });
      
      cardHeader.addEventListener("mouseenter", () => {
        cardHeader.style.backgroundColor = "var(--color-surface-alt)";
      });
      cardHeader.addEventListener("mouseleave", () => {
        cardHeader.style.backgroundColor = "transparent";
      });
      
      card.appendChild(cardHeader);
      
      // Card body - only shown when expanded
      if (isExpanded) {
        const cardBody = document.createElement("div");
        cardBody.style.cssText = `
          padding: 12px;
          animation: fade-in 300ms ease-out;
        `;
        
        const bodyText = document.createElement("p");
        bodyText.style.cssText = `
          font-size: 13px;
          line-height: 1.6;
          color: var(--color-text-muted);
          margin: 0 0 12px 0;
        `;
        bodyText.textContent = chunk.body;
        cardBody.appendChild(bodyText);
        
        // Source chip
        const sourceChip = document.createElement("span");
        sourceChip.style.cssText = `
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 26px;
          padding: 0 10px;
          background: var(--color-bg);
          border: 1px solid var(--color-border);
          border-radius: 999px;
          font-size: 12px;
          font-weight: 500;
          color: var(--color-text-muted);
          cursor: pointer;
          transition: all 200ms;
        `;
        
        // Badge
        const badge = document.createElement("span");
        badge.style.cssText = `
          display: flex;
          width: 16px;
          height: 16px;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          background: var(--color-accent);
          font-size: 8px;
          font-weight: 700;
          color: var(--color-accent-text);
        `;
        badge.textContent = chunk.badge || "SRC";
        
        const sourceName = document.createElement("span");
        sourceName.textContent = chunk.source;
        
        const externalIcon = document.createElement("span");
        externalIcon.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M7 7h10v10"/></svg>`;
        
        sourceChip.appendChild(badge);
        sourceChip.appendChild(sourceName);
        sourceChip.appendChild(externalIcon);
        
        sourceChip.addEventListener("click", () => {
          // Open source in new tab if href provided
          if (chunk.href) {
            window.open(chunk.href, "_blank", "noopener,noreferrer");
          }
        });
        
        sourceChip.addEventListener("mouseenter", () => {
          sourceChip.style.backgroundColor = "var(--color-surface-alt)";
          sourceChip.style.borderColor = "var(--color-accent-border)";
          sourceChip.style.color = "var(--color-text)";
        });
        sourceChip.addEventListener("mouseleave", () => {
          sourceChip.style.backgroundColor = "var(--color-bg)";
          sourceChip.style.borderColor = "var(--color-border)";
          sourceChip.style.color = "var(--color-text-muted)";
        });
        
        cardBody.appendChild(sourceChip);
        card.appendChild(cardBody);
      }
      
      this.element.appendChild(card);
    });
    
    this.container.innerHTML = "";
    this.container.appendChild(this.element);
  }
  
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIContextCards = BeUIContextCards;
