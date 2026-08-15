/**
 * Beautiful UI Streaming Text - Vanilla JS
 * Words resolve out of blur, inline citations appear in context
 */

const WORD_MS = 55;
const HOLD_MS = 3400;

class BeUIStreamingText {
  constructor(container, options = {}) {
    this.container = container;
    this.text = options.text || "";
    this.sources = options.sources || [];
    this.followUps = options.followUps || [];
    this.count = 0;
    this.sourcesOpen = false;
    this.element = null;
    
    this.tokens = this.tokenize(this.text);
    this.render();
    this.startStreaming();
  }
  
  tokenize(text) {
    // Simple tokenization - split by spaces and add citation markers
    const words = text.split(" ");
    const tokens = [];
    
    words.forEach((word, i) => {
      tokens.push({ text: word });
      // Add citation after every 15th word (for demo)
      if ((i + 1) % 15 === 0 && i < words.length - 1) {
        tokens.push({ cite: true });
      }
    });
    
    return tokens;
  }
  
  render() {
    const done = this.count >= this.tokens.length;
    
    this.element = document.createElement("div");
    this.element.className = "beui-streaming-text";
    this.element.style.cssText = "min-height: 248px; width: 100%; max-width: 380px;";
    
    // Text paragraph
    const p = document.createElement("p");
    p.style.cssText = "font-size: 13px; line-height: 1.5; color: var(--color-text); margin: 0;";
    
    this.tokens.slice(0, this.count).forEach((token, i) => {
      if (token.cite) {
        // Inline citation chip
        const source = this.sources[0] || { name: "Source", domain: "example.com", href: "#" };
        const chip = document.createElement("a");
        chip.href = source.href;
        chip.target = "_blank";
        chip.rel = "noreferrer";
        chip.style.cssText = `
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 18px;
          padding: 0 6px;
          margin: 0 2px;
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 5px;
          font-family: var(--font-mono);
          font-size: 10.5px;
          color: var(--color-text-muted);
          text-decoration: none;
          vertical-align: middle;
          transform: translateY(-1px);
          animation: pop-in 250ms cubic-bezier(0.23, 1, 0.32, 1) both;
          transition: background-color 150ms;
        `;
        chip.innerHTML = `<span>${source.domain}</span>`;
        chip.addEventListener("mouseenter", () => {
          chip.style.backgroundColor = "var(--color-surface-alt)";
          chip.style.color = "var(--color-text)";
        });
        chip.addEventListener("mouseleave", () => {
          chip.style.backgroundColor = "var(--color-surface)";
          chip.style.color = "var(--color-text-muted)";
        });
        p.appendChild(chip);
      } else {
        // Word
        const span = document.createElement("span");
        span.style.cssText = "display: inline; animation: stream-in 420ms cubic-bezier(0.22, 0.61, 0.25, 1) both;";
        span.textContent = token.text + " ";
        p.appendChild(span);
      }
    });
    
    // Cursor (if not done)
    if (!done) {
      const cursor = document.createElement("span");
      cursor.style.cssText = `
        display: inline-block;
        width: 2px;
        height: 12px;
        margin-left: 2px;
        background: var(--color-text);
        border-radius: 1px;
        transform: translateY(2px);
        animation: fade-in 150ms ease-out both;
      `;
      p.appendChild(cursor);
    }
    
    this.element.appendChild(p);
    
    // Action icons row (only when done)
    const actions = document.createElement("div");
    actions.style.cssText = `
      display: flex;
      align-items: center;
      gap: 2px;
      margin-top: 8px;
      opacity: ${done ? "1" : "0"};
      pointer-events: ${done ? "auto" : "none"};
      transition: opacity 400ms;
    `;
    
    const actionIcons = [
      { label: "Copy", path: "M9 9h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" },
      { label: "Retry", path: "M21 12a9 9 0 1 1-2.64-6.36 M21 3v6h-6" },
      { label: "Up", path: "M7 10v12 M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88z" },
      { label: "Down", path: "M17 14V2 M9 18.12L10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L12 22a3.13 3.13 0 0 1-3-3.88z" },
    ];
    
    actionIcons.forEach(icon => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("aria-label", icon.label);
      btn.style.cssText = `
        display: flex;
        width: 24px;
        height: 24px;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: var(--color-text-faint);
        cursor: pointer;
        transition: background-color 100ms, color 100ms;
      `;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${icon.path}"/></svg>`;
      btn.addEventListener("mouseenter", () => {
        btn.style.backgroundColor = "var(--color-surface-alt)";
        btn.style.color = "var(--color-text-muted)";
      });
      btn.addEventListener("mouseleave", () => {
        btn.style.backgroundColor = "transparent";
        btn.style.color = "var(--color-text-faint)";
      });
      actions.appendChild(btn);
    });
    
    // Sources button
    if (this.sources.length > 0) {
      const sourcesBtn = document.createElement("button");
      sourcesBtn.type = "button";
      sourcesBtn.setAttribute("aria-expanded", this.sourcesOpen);
      sourcesBtn.style.cssText = `
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: 6px;
        padding: 2px 4px;
        border-radius: 6px;
        border: none;
        background: transparent;
        cursor: pointer;
        transition: background-color 150ms;
      `;
      
      // Source avatars (stacked)
      const avatarStack = document.createElement("span");
      avatarStack.style.cssText = "display: flex; margin-left: -4px;";
      
      this.sources.slice(0, 3).forEach(source => {
        const img = document.createElement("div");
        img.style.cssText = `
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-accent);
          border: 1.5px solid var(--color-bg);
          margin-left: -4px;
        `;
        avatarStack.appendChild(img);
      });
      
      const sourcesLabel = document.createElement("span");
      sourcesLabel.style.cssText = "font-size: 12px; color: var(--color-text-muted);";
      sourcesLabel.textContent = `${this.sources.length} sources`;
      
      sourcesBtn.appendChild(avatarStack);
      sourcesBtn.appendChild(sourcesLabel);
      
      sourcesBtn.addEventListener("mouseenter", () => {
        sourcesBtn.style.backgroundColor = "var(--color-surface-alt)";
      });
      sourcesBtn.addEventListener("mouseleave", () => {
        sourcesBtn.style.backgroundColor = "transparent";
      });
      sourcesBtn.addEventListener("click", () => {
        this.sourcesOpen = !this.sourcesOpen;
        this.render();
      });
      
      actions.appendChild(sourcesBtn);
    }
    
    this.element.appendChild(actions);
    
    // Sources dropdown (when open)
    if (this.sourcesOpen && this.sources.length > 0) {
      const sourcesDropdown = document.createElement("div");
      sourcesDropdown.style.cssText = `
        display: grid;
        grid-template-rows: 1fr;
        opacity: 1;
        transition: grid-template-rows 300ms cubic-bezier(0.23, 1, 0.32, 1), opacity 300ms;
      `;
      
      const dropdownInner = document.createElement("div");
      dropdownInner.style.cssText = "overflow: hidden;";
      
      const dropdownContent = document.createElement("div");
      dropdownContent.style.cssText = `
        display: flex;
        flex-direction: column;
        margin-top: 6px;
        padding: 4px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        border-radius: 10px;
      `;
      
      this.sources.forEach(source => {
        const link = document.createElement("a");
        link.href = source.href || "#";
        link.target = "_blank";
        link.rel = "noreferrer";
        link.style.cssText = `
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 6px;
          border-radius: 6px;
          font-size: 12px;
          color: var(--color-text-muted);
          text-decoration: none;
          transition: background-color 150ms, color 150ms;
        `;
        link.innerHTML = `
          <div style="width: 16px; height: 16px; border-radius: 4px; background: var(--color-accent);"></div>
          <span>${source.name}</span>
          <span style="margin-left: auto; font-family: var(--font-mono); font-size: 10.5px; color: var(--color-text-faint);">${source.domain}</span>
        `;
        link.addEventListener("mouseenter", () => {
          link.style.backgroundColor = "var(--color-surface-alt)";
          link.style.color = "var(--color-text)";
        });
        link.addEventListener("mouseleave", () => {
          link.style.backgroundColor = "transparent";
          link.style.color = "var(--color-text-muted)";
        });
        dropdownContent.appendChild(link);
      });
      
      dropdownInner.appendChild(dropdownContent);
      sourcesDropdown.appendChild(dropdownInner);
      this.element.appendChild(sourcesDropdown);
    }
    
    // Follow-ups (only when done)
    if (done && this.followUps.length > 0) {
      const followUpsWrapper = document.createElement("div");
      followUpsWrapper.style.cssText = `
        margin-top: 10px;
        opacity: ${done ? "1" : "0"};
        pointer-events: ${done ? "auto" : "none"};
        transition: opacity 400ms;
      `;
      
      const followUpsLabel = document.createElement("p");
      followUpsLabel.style.cssText = "font-size: 12px; font-weight: 500; color: var(--color-text-muted); margin: 0 0 2px 0;";
      followUpsLabel.textContent = "Follow-ups";
      followUpsWrapper.appendChild(followUpsLabel);
      
      const followUpsList = document.createElement("div");
      followUpsList.style.cssText = "display: flex; flex-direction: column;";
      
      this.followUps.forEach((text, i) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.style.cssText = `
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px;
          margin: 0 -6px;
          border: none;
          border-bottom: 1px solid var(--color-border);
          background: transparent;
          text-align: left;
          font-size: 12.5px;
          color: var(--color-text);
          cursor: pointer;
          border-radius: 7px;
          transition: background-color 100ms;
          animation: ${done ? `fade-up 350ms cubic-bezier(0.23, 1, 0.32, 1) ${i * 90}ms both` : "none"};
        `;
        btn.innerHTML = `
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
            <path d="M9 10l-5 5 5 5"/>
            <path d="M20 4v7a4 4 0 0 1-4 4H4"/>
          </svg>
          <span>${text}</span>
        `;
        btn.addEventListener("mouseenter", () => {
          btn.style.backgroundColor = "var(--color-surface-alt)";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.backgroundColor = "transparent";
        });
        followUpsList.appendChild(btn);
      });
      
      followUpsWrapper.appendChild(followUpsList);
      this.element.appendChild(followUpsWrapper);
    }
    
    this.container.innerHTML = "";
    this.container.appendChild(this.element);
  }
  
  startStreaming() {
    const tick = () => {
      const done = this.count >= this.tokens.length;
      const delay = done ? HOLD_MS : WORD_MS;
      
      setTimeout(() => {
        if (this.count < this.tokens.length) {
          this.count++;
          this.render();
          tick();
        } else {
          // Reset after hold
          setTimeout(() => {
            this.count = 0;
            this.render();
            tick();
          }, HOLD_MS);
        }
      }, delay);
    };
    
    tick();
  }
  
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIStreamingText = BeUIStreamingText;
