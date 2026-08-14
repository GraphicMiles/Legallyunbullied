/**
 * BeUIStreamingText - Streaming text with inline citations
 * Streams text character by character with clickable citation chips
 */
class BeUIStreamingText {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      speed: options.speed || 20, // characters per second
      showCursor: options.showCursor !== false,
      ...options
    };
    
    this.fullText = '';
    this.displayedText = '';
    this.citations = [];
    this.isStreaming = false;
    this.streamInterval = null;
    this.currentIndex = 0;
    this.element = null;
    
    this.render();
  }
  
  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'beui-streaming';
    
    const content = document.createElement('div');
    content.className = 'beui-streaming__content';
    
    wrapper.appendChild(content);
    
    this.container.appendChild(wrapper);
    this.element = wrapper;
    this.contentElement = content;
  }
  
  setText(text) {
    this.fullText = text;
    this.displayedText = '';
    this.currentIndex = 0;
    this.updateDisplay();
  }
  
  addCitation(citation) {
    this.citations.push({
      ...citation,
      position: citation.position || this.fullText.length
    });
  }
  
  startStreaming(onComplete) {
    if (this.isStreaming) return;
    
    this.isStreaming = true;
    this.currentIndex = 0;
    this.displayedText = '';
    this.onComplete = onComplete;
    
    const charsPerTick = Math.max(1, Math.floor(this.options.speed / 10));
    const tickInterval = 100; // 100ms per tick
    
    this.streamInterval = setInterval(() => {
      if (this.currentIndex >= this.fullText.length) {
        this.stopStreaming();
        return;
      }
      
      const nextIndex = Math.min(
        this.currentIndex + charsPerTick,
        this.fullText.length
      );
      
      this.displayedText = this.fullText.slice(0, nextIndex);
      this.currentIndex = nextIndex;
      this.updateDisplay();
    }, tickInterval);
  }
  
  stopStreaming() {
    if (this.streamInterval) {
      clearInterval(this.streamInterval);
      this.streamInterval = null;
    }
    
    this.isStreaming = false;
    this.displayedText = this.fullText;
    this.updateDisplay();
    
    if (this.onComplete) {
      this.onComplete();
    }
  }
  
  updateDisplay() {
    this.contentElement.innerHTML = '';
    
    // Split text by citations
    const sortedCitations = [...this.citations]
      .filter(c => c.position <= this.currentIndex)
      .sort((a, b) => a.position - b.position);
    
    let lastIndex = 0;
    
    sortedCitations.forEach(citation => {
      // Add text before citation
      if (citation.position > lastIndex) {
        const textBefore = this.displayedText.slice(lastIndex, citation.position);
        this.contentElement.appendChild(document.createTextNode(textBefore));
      }
      
      // Add citation chip
      const chip = this.createCitationChip(citation);
      this.contentElement.appendChild(chip);
      
      lastIndex = citation.position;
    });
    
    // Add remaining text
    if (lastIndex < this.displayedText.length) {
      const remainingText = this.displayedText.slice(lastIndex);
      this.contentElement.appendChild(document.createTextNode(remainingText));
    }
    
    // Add cursor if still streaming
    if (this.isStreaming && this.options.showCursor) {
      const cursor = document.createElement('span');
      cursor.className = 'beui-streaming__cursor';
      this.contentElement.appendChild(cursor);
    }
  }
  
  createCitationChip(citation) {
    const chip = document.createElement('span');
    chip.className = 'beui-streaming__citation';
    chip.title = citation.label || citation.source;
    
    const icon = document.createElement('span');
    icon.className = 'beui-streaming__citation-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
    
    const label = document.createElement('span');
    label.textContent = citation.label || citation.source || 'Source';
    
    chip.appendChild(icon);
    chip.appendChild(label);
    
    if (citation.onClick) {
      chip.addEventListener('click', () => citation.onClick(citation));
    }
    
    return chip;
  }
  
  addSourcesPill(sources) {
    if (!sources || sources.length === 0) return;
    
    const pill = document.createElement('button');
    pill.className = 'beui-streaming__sources-pill';
    
    const icon = document.createElement('span');
    icon.className = 'beui-streaming__sources-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>';
    
    const text = document.createElement('span');
    text.textContent = `${sources.length} source${sources.length > 1 ? 's' : ''}`;
    
    pill.appendChild(icon);
    pill.appendChild(text);
    
    if (this.options.onSourcesClick) {
      pill.addEventListener('click', () => this.options.onSourcesClick(sources));
    }
    
    this.element.appendChild(pill);
  }
  
  destroy() {
    this.stopStreaming();
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIStreamingText = BeUIStreamingText;
