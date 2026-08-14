/* ==========================================================================
   BeautifulUI-Inspired Components
   Adapted from beui.dev for vanilla HTML/CSS/JS
   ========================================================================== */

/**
 * ReasoningText - Shimmering phrases with cascade animation
 * Shows cycling reasoning phrases with shimmer effect
 */
class ReasoningText {
  constructor(container, options = {}) {
    this.container = container;
    this.phrases = options.phrases || [
      "Reading the request",
      "Analyzing provisions",
      "Structuring response",
      "Preparing answer"
    ];
    this.variant = options.variant || "cascade"; // cascade, swap, scramble
    this.interval = options.interval || 1800;
    this.currentIndex = 0;
    this.timer = null;
    
    this.init();
  }
  
  init() {
    this.container.classList.add("reasoning-text");
    this.render();
    this.start();
  }
  
  render() {
    const phrase = document.createElement("span");
    phrase.className = "reasoning-text__phrase reasoning-text__phrase--entering";
    phrase.textContent = this.phrases[this.currentIndex];
    
    // Remove old phrases
    const oldPhrases = this.container.querySelectorAll(".reasoning-text__phrase--exiting");
    oldPhrases.forEach(el => {
      setTimeout(() => el.remove(), 300);
    });
    
    // Mark current as exiting
    const currentPhrase = this.container.querySelector(".reasoning-text__phrase:not(.reasoning-text__phrase--exiting)");
    if (currentPhrase) {
      currentPhrase.classList.remove("reasoning-text__phrase--entering");
      currentPhrase.classList.add("reasoning-text__phrase--exiting");
    }
    
    this.container.appendChild(phrase);
  }
  
  next() {
    this.currentIndex = (this.currentIndex + 1) % this.phrases.length;
    this.render();
  }
  
  start() {
    this.timer = setInterval(() => this.next(), this.interval);
  }
  
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  
  destroy() {
    this.stop();
    this.container.innerHTML = "";
  }
}

/**
 * AgentProgress - Live timer with activity glyph
 * Shows elapsed time in tabular format
 */
class AgentProgress {
  constructor(container, options = {}) {
    this.container = container;
    this.label = options.label || "Thinking";
    this.initialSeconds = options.initialSeconds || 0;
    this.running = options.running !== false;
    this.startTime = performance.now() - (this.initialSeconds * 1000);
    this.timer = null;
    
    this.init();
  }
  
  init() {
    this.container.classList.add("agent-progress");
    this.render();
    if (this.running) this.start();
  }
  
  render() {
    this.container.innerHTML = `
      <span class="ascii-loader"></span>
      <span class="agent-progress__label">${this.label}</span>
      <span class="agent-progress__timer">${this.formatTime(this.initialSeconds)}</span>
    `;
    this.timerEl = this.container.querySelector(".agent-progress__timer");
  }
  
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return mins > 0 
      ? `${mins}:${secs.toString().padStart(2, "0")}.${ms}`
      : `${secs}.${ms}s`;
  }
  
  update() {
    if (!this.running) return;
    const elapsed = (performance.now() - this.startTime) / 1000;
    this.timerEl.textContent = this.formatTime(elapsed);
  }
  
  start() {
    this.running = true;
    this.timer = setInterval(() => this.update(), 100);
  }
  
  stop() {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
  
  destroy() {
    this.stop();
    this.container.innerHTML = "";
  }
}

/**
 * Citations - Inline citation markers with collapsible list
 * Manages citation markers and reference list
 */
class Citations {
  constructor(container, options = {}) {
    this.container = container;
    this.citations = options.citations || [];
    this.idPrefix = options.idPrefix || "citation";
    this.defaultOpen = options.defaultOpen || false;
    this.isOpen = this.defaultOpen;
    
    this.init();
  }
  
  init() {
    this.render();
  }
  
  render() {
    const list = document.createElement("div");
    list.className = "citation-list";
    
    // Header
    const header = document.createElement("div");
    header.className = "citation-list__header";
    header.innerHTML = `
      <span class="citation-list__title">
        <span>Sources</span>
        <span style="color: var(--color-text-faint); font-weight: 400;">(${this.citations.length})</span>
      </span>
      <svg class="citation-list__chevron ${this.isOpen ? "citation-list__chevron--open" : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    `;
    header.addEventListener("click", () => this.toggle());
    
    // Items container
    const items = document.createElement("div");
    items.className = `citation-list__items ${this.isOpen ? "citation-list__items--open" : ""}`;
    
    this.citations.forEach((citation, index) => {
      const item = document.createElement("div");
      item.className = "citation-item";
      item.style.animationDelay = `${index * 0.1}s`;
      item.id = `${this.idPrefix}-${citation.id}`;
      
      item.innerHTML = `
        <span class="citation-item__index">${index + 1}</span>
        <div class="citation-item__content">
          <div class="citation-item__title">${citation.label}</div>
          <div class="citation-item__domain">${citation.excerpt ? citation.excerpt.slice(0, 60) + "..." : ""}</div>
        </div>
      `;
      
      items.appendChild(item);
    });
    
    list.appendChild(header);
    list.appendChild(items);
    this.container.appendChild(list);
    
    this.itemsContainer = items;
    this.chevron = header.querySelector(".citation-list__chevron");
  }
  
  toggle() {
    this.isOpen = !this.isOpen;
    this.itemsContainer.classList.toggle("citation-list__items--open", this.isOpen);
    this.chevron.classList.toggle("citation-list__chevron--open", this.isOpen);
  }
  
  static createMarker(index, citationId, idPrefix = "citation") {
    const marker = document.createElement("a");
    marker.className = "citation-marker";
    marker.href = `#${idPrefix}-${citationId}`;
    marker.textContent = `[${index}]`;
    marker.addEventListener("click", (e) => {
      e.preventDefault();
      const target = document.getElementById(`${idPrefix}-${citationId}`);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "center" });
        target.style.background = "var(--color-accent-soft)";
        setTimeout(() => {
          target.style.background = "";
        }, 1500);
      }
    });
    return marker;
  }
}

/**
 * StreamingResponse - Stable response surface with completion actions
 * Wraps streamed content with copy and retry actions
 */
class StreamingResponse {
  constructor(container, options = {}) {
    this.container = container;
    this.status = options.status || "streaming"; // streaming, complete
    this.copyText = options.copyText || "";
    this.onRetry = options.onRetry || (() => {});
    
    this.init();
  }
  
  init() {
    this.container.classList.add("streaming-response");
    this.container.setAttribute("aria-busy", this.status === "streaming" ? "true" : "false");
    
    if (this.status === "complete") {
      this.addCompletionActions();
    }
  }
  
  addCompletionActions() {
    const actions = document.createElement("div");
    actions.className = "completion-actions";
    
    // Copy button
    const copyBtn = document.createElement("button");
    copyBtn.className = "completion-action";
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
      </svg>
      <span>Copy</span>
    `;
    copyBtn.addEventListener("click", () => this.copy(copyBtn));
    
    actions.appendChild(copyBtn);
    this.container.appendChild(actions);
  }
  
  async copy(btn) {
    try {
      await navigator.clipboard.writeText(this.copyText);
      btn.classList.add("completion-action--copied");
      const originalHTML = btn.innerHTML;
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
        <span>Copied!</span>
      `;
      setTimeout(() => {
        btn.classList.remove("completion-action--copied");
        btn.innerHTML = originalHTML;
      }, 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  }
  
  setStatus(status) {
    this.status = status;
    this.container.setAttribute("aria-busy", status === "streaming" ? "true" : "false");
    if (status === "complete") {
      this.addCompletionActions();
    }
  }
}

// Export for use in app.js
window.BeUI = {
  ReasoningText,
  AgentProgress,
  Citations,
  StreamingResponse
};
