/**
 * Beautiful UI Context Cards - Vanilla JS
 * Retrieved knowledge chunks with their sources
 */

class BeUIContextCards {
  constructor(container, options = {}) {
    this.container = container;
    this.chunks = options.chunks || [];
    this.chipsShown = false;
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
      gap: 8px;
      padding: 0 2px;
      animation: fade-in 400ms ease-out both;
    `;
    
    const headerLabel = document.createElement("span");
    headerLabel.style.cssText = "font-size: 13px; font-weight: 600; color: var(--color-text);";
    headerLabel.textContent = "All chunks";
    
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
    
    header.appendChild(headerLabel);
    header.appendChild(headerCount);
    this.element.appendChild(header);
    
    // Cards
    this.chunks.forEach((chunk, i) => {
      const card = document.createElement("div");
      card.style.cssText = `
        overflow: hidden;
        border-radius: 10px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        animation: fade-up 400ms cubic-bezier(0.23, 1, 0.32, 1) ${i * 100}ms both;
      `;
      
      // Card header bar
      const cardHeader = document.createElement("div");
      cardHeader.style.cssText = `
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border-bottom: 1px solid var(--color-border);
      `;
      
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
        font-size: 12px;
        color: var(--color-text-faint);
        font-variant-numeric: tabular-nums;
      `;
      cardChars.textContent = chunk.chars;
      
      cardHeader.appendChild(cardIcon);
      cardHeader.appendChild(cardChars);
      card.appendChild(cardHeader);
      
      // Card body
      const cardBody = document.createElement("p");
      cardBody.style.cssText = `
        padding: 8px 12px 4px;
        font-size: 12.5px;
        line-height: 1.5;
        color: var(--color-text-muted);
        margin: 0;
      `;
      cardBody.textContent = chunk.body;
      card.appendChild(cardBody);
      
      // Card footer with source chip
      const cardFooter = document.createElement("div");
      cardFooter.style.cssText = "padding: 0 12px 12px;";
      
      const sourceChip = document.createElement("span");
      sourceChip.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 24px;
        padding: 0 8px;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-muted);
        opacity: ${this.chipsShown ? "1" : "0"};
        transform: ${this.chipsShown ? "scale(1)" : "scale(0.95)"};
        transition: opacity 300ms cubic-bezier(0.23, 1, 0.32, 1), 
                    transform 300ms cubic-bezier(0.23, 1, 0.32, 1),
                    background-color 300ms;
        transition-delay: ${i * 80}ms;
      `;
      
      // Badge
      const badge = document.createElement("span");
      badge.style.cssText = `
        display: flex;
        width: 14px;
        height: 14px;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        background: ${chunk.tone || "var(--color-accent)"};
        font-size: 7px;
        font-weight: 700;
        color: white;
      `;
      badge.textContent = chunk.badge;
      
      const sourceName = document.createElement("span");
      sourceName.textContent = chunk.source;
      
      const externalIcon = document.createElement("span");
      externalIcon.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M7 7h10v10"/></svg>`;
      
      sourceChip.appendChild(badge);
      sourceChip.appendChild(sourceName);
      sourceChip.appendChild(externalIcon);
      
      sourceChip.addEventListener("mouseenter", () => {
        sourceChip.style.backgroundColor = "var(--color-surface-alt)";
      });
      sourceChip.addEventListener("mouseleave", () => {
        sourceChip.style.backgroundColor = "var(--color-bg)";
      });
      
      cardFooter.appendChild(sourceChip);
      card.appendChild(cardFooter);
      
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
