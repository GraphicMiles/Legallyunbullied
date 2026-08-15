/**
 * Beautiful UI Recommendation Card - Vanilla JS
 * Agent suggestion with a confidence meter and actions
 */

class BeUIRecommendationCard {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options.options || [];
    this.selected = 0;
    this.open = false;
    this.accepted = false;
    this.element = null;
    
    this.render();
  }
  
  render() {
    const active = this.options[this.selected];
    const others = this.options.map((o, i) => ({ o, i })).filter(({ i }) => i !== this.selected);
    
    this.element = document.createElement("div");
    this.element.className = "beui-recommendation-card";
    this.element.style.cssText = `
      width: 100%;
      overflow: hidden;
      border-radius: 10px;
      background: var(--color-surface);
      border: 1px solid var(--color-border);
    `;
    
    // Main content
    const mainContent = document.createElement("div");
    mainContent.style.cssText = "padding: 12px 16px;";
    
    const question = document.createElement("span");
    question.style.cssText = "font-size: 13px; font-weight: 600; color: var(--color-text);";
    question.textContent = "What should I do next?";
    mainContent.appendChild(question);
    
    const body = document.createElement("p");
    body.style.cssText = `
      margin: 6px 0 0;
      min-height: 48px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--color-text-muted);
      animation: fade-in 180ms ease-out both;
    `;
    body.innerHTML = active.body;
    mainContent.appendChild(body);
    
    this.element.appendChild(mainContent);
    
    // Alternatives drawer
    const drawerWrapper = document.createElement("div");
    drawerWrapper.style.cssText = `
      display: grid;
      grid-template-rows: ${this.open ? "1fr" : "0fr"};
      opacity: ${this.open ? "1" : "0"};
      transition: grid-template-rows 300ms cubic-bezier(0.16, 1, 0.3, 1),
                  opacity 300ms;
    `;
    
    const drawerInner = document.createElement("div");
    drawerInner.style.cssText = "overflow: hidden;";
    
    const drawerContent = document.createElement("div");
    drawerContent.style.cssText = `
      border-top: 1px solid var(--color-border);
      background: var(--color-bg);
      padding: 8px;
    `;
    
    const drawerLabel = document.createElement("p");
    drawerLabel.style.cssText = `
      padding: 0 6px 4px;
      font-size: 11px;
      font-weight: 500;
      color: var(--color-text-faint);
      margin: 0;
    `;
    drawerLabel.textContent = "Other options";
    drawerContent.appendChild(drawerLabel);
    
    others.forEach(({ o, i }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.style.cssText = `
        display: flex;
        width: 100%;
        align-items: center;
        gap: 10px;
        padding: 6px;
        border: none;
        background: transparent;
        text-align: left;
        border-radius: 6px;
        cursor: pointer;
        transition: background-color 100ms;
      `;
      
      // Meter
      const meter = this.createMeter(o.signal, o.tone);
      btn.appendChild(meter);
      
      // Short text
      const short = document.createElement("span");
      short.style.cssText = `
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12.5px;
        color: var(--color-text);
      `;
      short.textContent = o.short;
      btn.appendChild(short);
      
      // Label
      const label = document.createElement("span");
      label.style.cssText = `
        flex-shrink: 0;
        font-size: 11px;
        color: var(--color-text-faint);
      `;
      label.textContent = o.label;
      btn.appendChild(label);
      
      btn.addEventListener("mouseenter", () => {
        btn.style.backgroundColor = "var(--color-surface-alt)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.backgroundColor = "transparent";
      });
      btn.addEventListener("click", () => {
        this.selected = i < this.selected ? i : i + 1;
        this.accepted = false;
        this.open = false;
        this.render();
      });
      
      drawerContent.appendChild(btn);
    });
    
    drawerInner.appendChild(drawerContent);
    drawerWrapper.appendChild(drawerInner);
    this.element.appendChild(drawerWrapper);
    
    // Footer
    const footer = document.createElement("div");
    footer.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 16px;
      border-top: 1px solid var(--color-border);
      background: var(--color-bg);
    `;
    
    // Confidence meter + label
    const confidenceWrapper = document.createElement("span");
    confidenceWrapper.style.cssText = "display: flex; align-items: center; gap: 8px;";
    
    const meter = this.createMeter(active.signal, active.tone);
    confidenceWrapper.appendChild(meter);
    
    const confidenceLabel = document.createElement("span");
    confidenceLabel.style.cssText = "font-size: 12.5px; font-weight: 500; color: var(--color-text-muted);";
    confidenceLabel.textContent = active.label;
    confidenceWrapper.appendChild(confidenceLabel);
    
    footer.appendChild(confidenceWrapper);
    
    // Buttons
    const buttonsWrapper = document.createElement("span");
    buttonsWrapper.style.cssText = "display: flex; align-items: center; gap: 8px; margin-right: -2px;";
    
    // Alternatives button
    const altBtn = document.createElement("button");
    altBtn.type = "button";
    altBtn.setAttribute("aria-expanded", this.open);
    altBtn.style.cssText = `
      height: 28px;
      padding: 0 10px;
      border-radius: 6px;
      border: 1px solid var(--color-border);
      background: ${this.open ? "var(--color-surface-alt)" : "var(--color-surface)"};
      color: var(--color-text);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      transition: background-color 100ms, transform 100ms;
    `;
    altBtn.textContent = "Alternatives";
    altBtn.addEventListener("mouseenter", () => {
      if (!this.open) altBtn.style.backgroundColor = "var(--color-surface-alt)";
    });
    altBtn.addEventListener("mouseleave", () => {
      if (!this.open) altBtn.style.backgroundColor = "var(--color-surface)";
    });
    altBtn.addEventListener("mousedown", () => {
      altBtn.style.transform = "scale(0.96)";
    });
    altBtn.addEventListener("mouseup", () => {
      altBtn.style.transform = "scale(1)";
    });
    altBtn.addEventListener("click", () => {
      this.open = !this.open;
      this.render();
    });
    buttonsWrapper.appendChild(altBtn);
    
    // Accept button
    const acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.style.cssText = `
      height: 28px;
      padding: 0 12px;
      border-radius: 6px;
      border: 1px solid var(--color-border);
      background: ${this.accepted ? "var(--color-success)" : active.ctaStyle};
      color: ${this.accepted ? "white" : "var(--color-accent-text)"};
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), 0 0 0 1px rgba(16,24,40,0.12), 0 1px 2px rgba(16,24,40,0.1);
      transition: background-color 150ms, transform 150ms;
    `;
    acceptBtn.textContent = this.accepted ? "Accepted" : active.cta;
    acceptBtn.addEventListener("mousedown", () => {
      acceptBtn.style.transform = "scale(0.96)";
    });
    acceptBtn.addEventListener("mouseup", () => {
      acceptBtn.style.transform = "scale(1)";
    });
    acceptBtn.addEventListener("click", () => {
      this.accepted = true;
      this.render();
    });
    buttonsWrapper.appendChild(acceptBtn);
    
    footer.appendChild(buttonsWrapper);
    this.element.appendChild(footer);
    
    this.container.innerHTML = "";
    this.container.appendChild(this.element);
  }
  
  createMeter(signal, tone) {
    const meter = document.createElement("span");
    meter.style.cssText = "display: flex; align-items: flex-end; gap: 2px;";
    
    [0, 1, 2].forEach(bar => {
      const barEl = document.createElement("span");
      barEl.style.cssText = `
        width: 4px;
        height: 10px;
        border-radius: 999px;
        background: ${bar < signal ? tone : "var(--color-border)"};
        transition: background-color 300ms;
      `;
      meter.appendChild(barEl);
    });
    
    return meter;
  }
  
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIRecommendationCard = BeUIRecommendationCard;
