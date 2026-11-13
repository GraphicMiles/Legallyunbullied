/**
 * BeUIStreamingText - Beautiful UI Streaming Text
 * Words resolve out of blur individually as they stream in
 */

const WORD_MS = 100;  // Time between each word (slowed for visibility)
const HOLD_MS = 3400;  // Hold time before looping

class BeUIStreamingText {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      text: options.text || '',
      sources: options.sources || [],
      followUps: options.followUps || [],
      oneShot: options.oneShot || false,        // no loop after completion
      onDone: options.onDone || null,           // callback when streaming finishes
      showActions: options.showActions !== false, // hide actions row when false
      ...options
    };
    
    this.citations = this.options.citations !== false;
    // html mode: the caller passes already-rendered markdown. Words are then
    // revealed inside the formatted DOM, so bold, bullets and line breaks are
    // correct from the first frame instead of only after the stream ends.
    this.htmlMode = typeof this.options.html === 'string';
    this.tokens = this.htmlMode ? [] : this.tokenize(this.options.text);
    this.count = 0;
    this.sourcesOpen = false;
    this.element = null;
    this.paragraph = null;
    this.actionsRow = null;
    this.followUpsRow = null;
    this.sourcesDropdown = null;
    
    this.render();
    this.startStreaming();
  }
  
  tokenize(text) {
    // Split text into words. Citation chips are only injected when enabled
    // (citations !== false) — the legal app passes citations:false because its
    // citations are inline bold text + a separate Sources list, and injecting
    // demo chips would fabricate placeholder domains like "example.com".
    const words = text.split(' ');
    const tokens = [];
    
    words.forEach((word, i) => {
      tokens.push({ text: word + ' ', type: 'word' });
      
      if (this.citations && (i + 1) % 15 === 0 && i < words.length - 1) {
        tokens.push({ type: 'citation' });
      }
    });
    
    return tokens;
  }
  
  render() {
    if (this.htmlMode) {
      this.renderHtml();
      return;
    }
    // Main wrapper
    this.element = document.createElement('div');
    this.element.style.cssText = `
      width: 100%;
    `;
    
    // Paragraph for streaming text
    this.paragraph = document.createElement('p');
    this.paragraph.style.cssText = `
      font-size: 13px;
      line-height: 1.5;
      color: var(--color-text, var(--color-text));
      margin: 0;
    `;
    
    this.element.appendChild(this.paragraph);
    
    // Actions row (copy, retry, vote, sources) — only if showActions is true
    if (this.options.showActions) {
    this.actionsRow = document.createElement('div');
    this.actionsRow.style.cssText = `
      display: flex;
      align-items: center;
      gap: 2px;
      margin-top: 8px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 400ms;
    `;
    
    // Action icons
    const actions = [
      { icon: 'copy', symbol: 'copy', label: 'Copy' },
      { icon: 'retry', symbol: 'rotate-cw', label: 'Retry' },
      { icon: 'up', symbol: 'thumbs-up', label: 'Helpful' },
      { icon: 'down', symbol: 'thumbs-down', label: 'Not helpful' }
    ];
    
    actions.forEach(action => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('aria-label', action.icon);
      btn.style.cssText = `
        display: flex;
        width: 24px;
        height: 24px;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        border: none;
        background: transparent;
        color: var(--color-text-faint, var(--color-text-muted));
        cursor: pointer;
        transition: background-color 100ms, color 100ms;
      `;
      btn.innerHTML = `<svg class="icon" style="width:15px;height:15px" aria-hidden="true"><use href="#i-${action.symbol}"/></svg>`;
      
      btn.addEventListener('mouseenter', () => {
        btn.style.backgroundColor = 'var(--color-surface-alt, var(--color-surface))';
        btn.style.color = 'var(--color-text-muted, var(--color-text-muted))';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.backgroundColor = 'transparent';
        btn.style.color = 'var(--color-text-faint, var(--color-text-muted))';
      });
      
      this.actionsRow.appendChild(btn);
    });
    
    // Sources button
    if (this.options.sources.length > 0) {
      const sourcesBtn = document.createElement('button');
      sourcesBtn.type = 'button';
      sourcesBtn.setAttribute('aria-expanded', 'false');
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
      
      // Stacked source avatars
      const avatarStack = document.createElement('span');
      avatarStack.style.cssText = 'display: flex; margin-left: -4px;';
      
      this.options.sources.slice(0, 3).forEach((source, i) => {
        const avatar = document.createElement('div');
        avatar.style.cssText = `
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--color-accent, var(--color-accent));
          border: 1.5px solid var(--color-bg, var(--color-on-accent));
          margin-left: ${i === 0 ? '0' : '-4px'};
        `;
        avatarStack.appendChild(avatar);
      });
      
      const sourcesLabel = document.createElement('span');
      sourcesLabel.style.cssText = `
        font-size: 12px;
        color: var(--color-text-muted, var(--color-text-muted));
      `;
      sourcesLabel.textContent = `${this.options.sources.length} sources`;
      
      sourcesBtn.appendChild(avatarStack);
      sourcesBtn.appendChild(sourcesLabel);
      
      sourcesBtn.addEventListener('mouseenter', () => {
        sourcesBtn.style.backgroundColor = 'var(--color-surface-alt, var(--color-surface))';
      });
      sourcesBtn.addEventListener('mouseleave', () => {
        sourcesBtn.style.backgroundColor = 'transparent';
      });
      sourcesBtn.addEventListener('click', () => {
        this.sourcesOpen = !this.sourcesOpen;
        sourcesBtn.setAttribute('aria-expanded', this.sourcesOpen.toString());
        this.updateSourcesDropdown();
      });
      
      this.actionsRow.appendChild(sourcesBtn);
    }
    
    this.element.appendChild(this.actionsRow);
    } else {
      this.actionsRow = null;
    }
    
    // Sources dropdown
    this.sourcesDropdown = document.createElement('div');
    this.sourcesDropdown.style.cssText = `
      display: grid;
      grid-template-rows: 0fr;
      opacity: 0;
      transition: grid-template-rows 300ms cubic-bezier(0.23, 1, 0.32, 1), opacity 300ms;
    `;
    this.element.appendChild(this.sourcesDropdown);
    
    // Follow-ups
    if (this.options.followUps.length > 0) {
      this.followUpsRow = document.createElement('div');
      this.followUpsRow.style.cssText = `
        margin-top: 10px;
        opacity: 0;
        pointer-events: none;
        transition: opacity 400ms;
      `;
      
      const followUpsLabel = document.createElement('p');
      followUpsLabel.style.cssText = `
        font-size: 12px;
        font-weight: 500;
        color: var(--color-text-muted, var(--color-text-muted));
        margin: 0 0 2px 0;
      `;
      followUpsLabel.textContent = 'Follow-ups';
      this.followUpsRow.appendChild(followUpsLabel);
      
      const followUpsList = document.createElement('div');
      followUpsList.style.cssText = 'display: flex; flex-direction: column;';
      
      this.options.followUps.forEach((text, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.style.cssText = `
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 6px;
          margin: 0 -6px;
          border: none;
          border-bottom: 1px solid var(--color-border, var(--color-elevated));
          background: transparent;
          text-align: left;
          font-size: 12.5px;
          color: var(--color-text, var(--color-text));
          cursor: pointer;
          border-radius: 7px;
          transition: background-color 100ms;
        `;
        btn.innerHTML = `
          <svg class="icon" style="width:11px;height:11px;flex-shrink:0;color:var(--color-text-faint, var(--color-text-muted))" aria-hidden="true"><use href="#i-reply"/></svg>
          <span>${text}</span>
        `;
        btn.addEventListener('mouseenter', () => {
          btn.style.backgroundColor = 'var(--color-surface-alt, var(--color-surface))';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.backgroundColor = 'transparent';
        });
        followUpsList.appendChild(btn);
      });
      
      this.followUpsRow.appendChild(followUpsList);
      this.element.appendChild(this.followUpsRow);
    }
    
    this.container.innerHTML = '';
    this.container.appendChild(this.element);
  }
  
  renderHtml() {
    // display: contents keeps the markdown's own <p>/<ul> children directly
    // under the caller's container, so the stream and the final render share
    // one layout.
    this.element = document.createElement('div');
    this.element.style.display = 'contents';
    this.paragraph = document.createElement('div');
    this.paragraph.style.display = 'contents';
    this.paragraph.innerHTML = this.options.html;

    const walker = document.createTreeWalker(this.paragraph, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    this.tokens = [];
    for (const node of textNodes) {
      const frag = document.createDocumentFragment();
      for (const part of node.textContent.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(part));
          continue;
        }
        const span = document.createElement('span');
        span.textContent = part;
        span.style.opacity = '0';          // hidden until its turn; keeps layout stable
        this.tokens.push(span);
        frag.appendChild(span);
      }
      node.parentNode.replaceChild(frag, node);
    }

    this.element.appendChild(this.paragraph);
    this.container.innerHTML = '';
    this.container.appendChild(this.element);
  }

  updateSourcesDropdown() {
    if (this.sourcesOpen) {
      const dropdownInner = document.createElement('div');
      dropdownInner.style.cssText = 'overflow: hidden;';
      
      const dropdownContent = document.createElement('div');
      dropdownContent.style.cssText = `
        display: flex;
        flex-direction: column;
        margin-top: 6px;
        padding: 4px;
        background: var(--color-surface, var(--color-recessed));
        border: 1px solid var(--color-border, var(--color-elevated));
        border-radius: 10px;
      `;
      
      this.options.sources.forEach(source => {
        const link = document.createElement('a');
        link.href = source.href || '#';
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.style.cssText = `
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 4px 6px;
          border-radius: 6px;
          font-size: 12px;
          color: var(--color-text-muted, var(--color-text-muted));
          text-decoration: none;
          transition: background-color 150ms, color 150ms;
        `;
        link.innerHTML = `
          <div style="width: 16px; height: 16px; border-radius: 4px; background: var(--color-accent, var(--color-accent));"></div>
          <span>${source.name}</span>
          <span style="margin-left: auto; font-family: var(--font-mono, monospace); font-size: 10.5px; color: var(--color-text-faint, var(--color-text-muted));">${source.domain}</span>
        `;
        link.addEventListener('mouseenter', () => {
          link.style.backgroundColor = 'var(--color-surface-alt, var(--color-surface))';
          link.style.color = 'var(--color-text, var(--color-text))';
        });
        link.addEventListener('mouseleave', () => {
          link.style.backgroundColor = 'transparent';
          link.style.color = 'var(--color-text-muted, var(--color-text-muted))';
        });
        dropdownContent.appendChild(link);
      });
      
      dropdownInner.appendChild(dropdownContent);
      this.sourcesDropdown.innerHTML = '';
      this.sourcesDropdown.appendChild(dropdownInner);
      
      // Trigger animation
      requestAnimationFrame(() => {
        this.sourcesDropdown.style.gridTemplateRows = '1fr';
        this.sourcesDropdown.style.opacity = '1';
      });
    } else {
      this.sourcesDropdown.style.gridTemplateRows = '0fr';
      this.sourcesDropdown.style.opacity = '0';
      
      setTimeout(() => {
        this.sourcesDropdown.innerHTML = '';
      }, 300);
    }
  }
  
  startStreaming() {
    const tick = () => {
      if (this.count < this.tokens.length) {
        const token = this.tokens[this.count];
        
        if (this.htmlMode) {
          // The span already sits in the formatted DOM; just play its reveal.
          token.style.cssText = `
            display: inline;
            animation: stream-in 500ms cubic-bezier(0.22, 0.61, 0.25, 1) forwards;
          `;
        } else if (token.type === 'word') {
          // Add word with individual blur animation
          const span = document.createElement('span');
          span.style.cssText = `
            display: inline;
            opacity: 0;
            filter: blur(10px);
            transform: translateY(4px);
            animation: stream-in 500ms cubic-bezier(0.22, 0.61, 0.25, 1) forwards;
          `;
          span.textContent = token.text;
          this.paragraph.appendChild(span);
        } else if (token.type === 'citation') {
          // Add citation chip — only when a real source is provided. Never
          // fabricate a placeholder domain (the old fallback rendered
          // "example.com", which leaked into the legal answer stream).
          const source = this.options.sources && this.options.sources[0];
          if (source && source.domain) {
            const chip = document.createElement('a');
            chip.href = source.href;
            chip.target = '_blank';
            chip.rel = 'noreferrer';
            chip.style.cssText = `
              display: inline-flex;
              align-items: center;
              gap: 4px;
              height: 18px;
              padding: 0 6px;
              margin: 0 2px;
              background: var(--color-surface, var(--color-recessed));
              border: 1px solid var(--color-border, var(--color-elevated));
              border-radius: 5px;
              font-family: var(--font-mono, monospace);
              font-size: 10.5px;
              color: var(--color-text-muted, var(--color-text-muted));
              text-decoration: none;
              vertical-align: middle;
              transform: translateY(-1px);
              animation: pop-in 250ms cubic-bezier(0.23, 1, 0.32, 1) both;
              transition: background-color 150ms;
            `;
            chip.innerHTML = `<span>${source.domain}</span>`;
            chip.addEventListener('mouseenter', () => {
              chip.style.backgroundColor = 'var(--color-surface-alt, var(--color-surface))';
              chip.style.color = 'var(--color-text, var(--color-text))';
            });
            chip.addEventListener('mouseleave', () => {
              chip.style.backgroundColor = 'var(--color-surface, var(--color-recessed))';
              chip.style.color = 'var(--color-text-muted, var(--color-text-muted))';
            });
            this.paragraph.appendChild(chip);
          }
        }
        
        this.count++;
        setTimeout(tick, WORD_MS);
      } else {
        // Done streaming
        if (this.actionsRow) {
          this.actionsRow.style.opacity = '1';
          this.actionsRow.style.pointerEvents = 'auto';
        }
        
        if (this.followUpsRow) {
          this.followUpsRow.style.opacity = '1';
          this.followUpsRow.style.pointerEvents = 'auto';
          
          // Animate follow-ups
          this.followUpsRow.querySelectorAll('button').forEach((btn, i) => {
            btn.style.animation = `fade-up 350ms cubic-bezier(0.23, 1, 0.32, 1) ${i * 90}ms both`;
          });
        }
        
        // Call onDone callback if provided
        if (this.options.onDone) {
          this.options.onDone();
        }
        
        // Loop unless oneShot mode
        if (this.options.oneShot) return;
        
        setTimeout(() => {
          this.count = 0;
          this.paragraph.innerHTML = '';
          if (this.actionsRow) {
            this.actionsRow.style.opacity = '0';
            this.actionsRow.style.pointerEvents = 'none';
          }
          
          if (this.followUpsRow) {
            this.followUpsRow.style.opacity = '0';
            this.followUpsRow.style.pointerEvents = 'none';
          }
          
          setTimeout(tick, WORD_MS);
        }, HOLD_MS);
      }
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
