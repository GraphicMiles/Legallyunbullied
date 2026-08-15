/**
 * BeUIStreamingText - Beautiful UI Streaming Text
 * Words resolve out of blur individually as they stream in
 */

const WORD_MS = 55;  // Time between each word
const HOLD_MS = 3400;  // Hold time before looping

class BeUIStreamingText {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      text: options.text || '',
      sources: options.sources || [],
      followUps: options.followUps || [],
      ...options
    };
    
    this.tokens = this.tokenize(this.options.text);
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
    // Split text into words and add citation markers every 15 words
    const words = text.split(' ');
    const tokens = [];
    
    words.forEach((word, i) => {
      tokens.push({ text: word + ' ', type: 'word' });
      
      // Add citation after every 15th word (for demo)
      if ((i + 1) % 15 === 0 && i < words.length - 1) {
        tokens.push({ type: 'citation' });
      }
    });
    
    return tokens;
  }
  
  render() {
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
      color: var(--color-text, #f5f5f2);
      margin: 0;
    `;
    
    this.element.appendChild(this.paragraph);
    
    // Actions row (copy, retry, vote, sources)
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
      { icon: 'copy', path: 'M8 4v12a2 2 0 002 2h8a2 2 0 002-2V7.242a2 2 0 00-.602-1.43L16.083 2.57A2 2 0 0014.685 2H10a2 2 0 00-2 2z M16 18v2a2 2 0 01-2 2H6a2 2 0 01-2-2V9a2 2 0 012-2h2' },
      { icon: 'retry', path: 'M21 12a9 9 0 11-2.64-6.36 M21 3v6h-6' },
      { icon: 'up', path: 'M7 10v12 M15 5.88L14 10h5.83a2 2 0 011.92 2.56l-2.33 8A2 2 0 0117.5 22H4a2 2 0 01-2-2v-8a2 2 0 012-2h2.76a2 2 0 001.79-1.11L12 2a3.13 3.13 0 013 3.88z' },
      { icon: 'down', path: 'M17 14V2 M9 18.12L10 14H4.17a2 2 0 01-1.92-2.56l2.33-8A2 2 0 016.5 2H20a2 2 0 012 2v8a2 2 0 01-2 2h-2.76a2 2 0 00-1.79 1.11L12 22a3.13 3.13 0 01-3-3.88z' }
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
        color: var(--color-text-faint, #6b6b66);
        cursor: pointer;
        transition: background-color 100ms, color 100ms;
      `;
      btn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${action.path}"/></svg>`;
      
      btn.addEventListener('mouseenter', () => {
        btn.style.backgroundColor = 'var(--color-surface-alt, #1c1c1c)';
        btn.style.color = 'var(--color-text-muted, #9a9a94)';
      });
      btn.addEventListener('mouseleave', () => {
        btn.style.backgroundColor = 'transparent';
        btn.style.color = 'var(--color-text-faint, #6b6b66)';
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
          background: var(--color-accent, #f2b705);
          border: 1.5px solid var(--color-bg, #0a0a0a);
          margin-left: ${i === 0 ? '0' : '-4px'};
        `;
        avatarStack.appendChild(avatar);
      });
      
      const sourcesLabel = document.createElement('span');
      sourcesLabel.style.cssText = `
        font-size: 12px;
        color: var(--color-text-muted, #9a9a94);
      `;
      sourcesLabel.textContent = `${this.options.sources.length} sources`;
      
      sourcesBtn.appendChild(avatarStack);
      sourcesBtn.appendChild(sourcesLabel);
      
      sourcesBtn.addEventListener('mouseenter', () => {
        sourcesBtn.style.backgroundColor = 'var(--color-surface-alt, #1c1c1c)';
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
        color: var(--color-text-muted, #9a9a94);
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
          border-bottom: 1px solid var(--color-border, #2a2a2a);
          background: transparent;
          text-align: left;
          font-size: 12.5px;
          color: var(--color-text, #f5f5f2);
          cursor: pointer;
          border-radius: 7px;
          transition: background-color 100ms;
        `;
        btn.innerHTML = `
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint, #6b6b66)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0;">
            <path d="M9 10l-5 5 5 5"/>
            <path d="M20 4v7a4 4 0 01-4 4H4"/>
          </svg>
          <span>${text}</span>
        `;
        btn.addEventListener('mouseenter', () => {
          btn.style.backgroundColor = 'var(--color-surface-alt, #1c1c1c)';
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
        background: var(--color-surface, #161616);
        border: 1px solid var(--color-border, #2a2a2a);
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
          color: var(--color-text-muted, #9a9a94);
          text-decoration: none;
          transition: background-color 150ms, color 150ms;
        `;
        link.innerHTML = `
          <div style="width: 16px; height: 16px; border-radius: 4px; background: var(--color-accent, #f2b705);"></div>
          <span>${source.name}</span>
          <span style="margin-left: auto; font-family: var(--font-mono, monospace); font-size: 10.5px; color: var(--color-text-faint, #6b6b66);">${source.domain}</span>
        `;
        link.addEventListener('mouseenter', () => {
          link.style.backgroundColor = 'var(--color-surface-alt, #1c1c1c)';
          link.style.color = 'var(--color-text, #f5f5f2)';
        });
        link.addEventListener('mouseleave', () => {
          link.style.backgroundColor = 'transparent';
          link.style.color = 'var(--color-text-muted, #9a9a94)';
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
        
        if (token.type === 'word') {
          // Add word with individual blur animation
          const span = document.createElement('span');
          span.style.cssText = `
            display: inline;
            animation: stream-in 420ms cubic-bezier(0.22, 0.61, 0.25, 1) both;
          `;
          span.textContent = token.text;
          this.paragraph.appendChild(span);
        } else if (token.type === 'citation') {
          // Add citation chip
          const source = this.options.sources[0] || { name: 'Source', domain: 'example.com', href: '#' };
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
            background: var(--color-surface, #161616);
            border: 1px solid var(--color-border, #2a2a2a);
            border-radius: 5px;
            font-family: var(--font-mono, monospace);
            font-size: 10.5px;
            color: var(--color-text-muted, #9a9a94);
            text-decoration: none;
            vertical-align: middle;
            transform: translateY(-1px);
            animation: pop-in 250ms cubic-bezier(0.23, 1, 0.32, 1) both;
            transition: background-color 150ms;
          `;
          chip.innerHTML = `<span>${source.domain}</span>`;
          chip.addEventListener('mouseenter', () => {
            chip.style.backgroundColor = 'var(--color-surface-alt, #1c1c1c)';
            chip.style.color = 'var(--color-text, #f5f5f2)';
          });
          chip.addEventListener('mouseleave', () => {
            chip.style.backgroundColor = 'var(--color-surface, #161616)';
            chip.style.color = 'var(--color-text-muted, #9a9a94)';
          });
          this.paragraph.appendChild(chip);
        }
        
        this.count++;
        setTimeout(tick, WORD_MS);
      } else {
        // Done streaming - show actions and follow-ups
        this.actionsRow.style.opacity = '1';
        this.actionsRow.style.pointerEvents = 'auto';
        
        if (this.followUpsRow) {
          this.followUpsRow.style.opacity = '1';
          this.followUpsRow.style.pointerEvents = 'auto';
          
          // Animate follow-ups
          this.followUpsRow.querySelectorAll('button').forEach((btn, i) => {
            btn.style.animation = `fade-up 350ms cubic-bezier(0.23, 1, 0.32, 1) ${i * 90}ms both`;
          });
        }
        
        // Hold, then loop
        setTimeout(() => {
          this.count = 0;
          this.paragraph.innerHTML = '';
          this.actionsRow.style.opacity = '0';
          this.actionsRow.style.pointerEvents = 'none';
          
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
