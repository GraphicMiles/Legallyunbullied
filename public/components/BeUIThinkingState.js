/**
 * Beautiful UI Thinking State - Vanilla JS
 * Expandable agent trace with 4 variants: Steps, Reasoning, Search, Coding
 */

const STAGES = [800, 600, 1800, 2600, 1600];

const VARIANTS = {
  Steps: {
    active: "Thinking",
    done: "Thought for 4 seconds",
    rows: [
      { primary: "Classifying the question" },
      { primary: "Searching legal sources" },
      { primary: "Analyzing provisions", secondary: "14 sections" },
      { primary: "Drafting response" },
    ],
  },
  Reasoning: {
    active: "Thinking",
    done: "Thought for 4 seconds",
    rows: [
      { primary: "This is a tenancy dispute involving illegal eviction in Lagos State." },
      { primary: "I need to check the Lagos State Tenancy Law 2011 for notice requirements." },
    ],
  },
  Search: {
    active: "Searching legal sources",
    done: "Searched legal database",
    query: "Lagos State Tenancy Law eviction notice",
    rows: [
      { primary: "Lagos State Tenancy Law 2011", secondary: "s.13", href: "#" },
      { primary: "Lagos State Tenancy Law 2011", secondary: "s.20", href: "#" },
      { primary: "Recovery of Premises Law", secondary: "Cap R4", href: "#" },
    ],
  },
  Coding: {
    active: "Running tools",
    done: "Ran 3 tools",
    rows: [
      { primary: "Read", secondary: "legal_provisions", mono: true },
      { primary: "Search", secondary: "tenancy eviction", mono: true, add: 14, del: 0 },
      { primary: "Plan", secondary: "response structure", mono: true },
    ],
  },
};

class BeUIThinkingState {
  constructor(container, options = {}) {
    this.container = container;
    this.variant = options.variant || "Steps";
    this.static = options.static === true;
    // Static mode renders the finished (collapsed) state immediately, with no
    // animation — used when re-rendering a completed message on reload so it
    // matches the live pipeline's look exactly.
    this.stage = this.static ? STAGES.length - 1 : 0;
    this.manualExpanded = null;
    this.selectedTool = null;
    this.lineHeight = 0;
    this.element = null;
    // Real elapsed-time source. Two forms:
    //  - startedAt (epoch ms): live "Thought for X.Xs" ticking during a run
    //  - elapsedMs (fixed): final duration for a completed message
    this.startedAt = options.startedAt || null;
    this.elapsedMs = options.elapsedMs != null ? options.elapsedMs : null;
    this.elapsedTimer = null;   // the 500ms tick interval (label refresh)
    this.sequenceTimer = null;  // the stage-advance setTimeout chain
    this.destroyed = false;

    this.render();
    if (!this.static) this.startSequence();
  }

  doneLabel(v) {
    if (this.elapsedMs != null) {
      return `Thought for ${(this.elapsedMs / 1000).toFixed(1)}s`;
    }
    if (this.startedAt == null) return v.done;
    const secs = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    return `Thought for ${secs}s`;
  }

  startElapsedTick(label) {
    if (this.destroyed) return; // never tick a destroyed component
    if (this.elapsedTimer) clearInterval(this.elapsedTimer);
    const currentVariant = () => VARIANTS[this.variant] || VARIANTS.Steps;
    this.elapsedTimer = setInterval(() => {
      if (this.destroyed) {
        clearInterval(this.elapsedTimer);
        this.elapsedTimer = null;
        return;
      }
      label.textContent = this.doneLabel(currentVariant());
    }, 500);
  }
  
  render() {
    if (this.destroyed) return; // never re-render after destroy
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
    const v = VARIANTS[this.variant] || VARIANTS.Steps;
    const autoExpanded = this.stage >= 1 && this.stage < 4;
    const expanded = this.manualExpanded !== null ? this.manualExpanded : autoExpanded;
    const working = this.stage < 3;
    const visible = this.stage < 2 ? 0 : this.stage === 2 ? Math.min(2, v.rows.length) : v.rows.length;
    
    this.element = document.createElement("div");
    this.element.className = "beui-thinking-state";
    this.element.style.cssText = "display: flex; flex-direction: column; width: 100%;";
    
    // Header button
    const header = document.createElement("button");
    header.type = "button";
    header.setAttribute("aria-expanded", expanded);
    header.className = "beui-thinking-header";
    header.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px;
      margin: 0 -6px;
      background: transparent;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      transition: background-color 100ms;
      width: fit-content;
    `;
    
    header.addEventListener("mouseenter", () => {
      header.style.backgroundColor = "var(--color-surface-alt)";
    });
    header.addEventListener("mouseleave", () => {
      header.style.backgroundColor = "transparent";
    });
    
    // Icon
    const icon = document.createElement("div");
    icon.style.cssText = `
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: ${working ? "var(--color-text-muted)" : "var(--color-text-faint)"};
    `;
    icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>`;
    
    // Label
    const label = document.createElement("span");
    if (working) {
      label.style.cssText = `
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        background: linear-gradient(90deg, var(--color-text-faint) 35%, var(--color-text) 50%, var(--color-text-faint) 65%);
        background-size: 200% 100%;
        -webkit-background-clip: text;
        background-clip: text;
        -webkit-text-fill-color: transparent;
        animation: shimmer-text 1.4s linear infinite;
      `;
      label.textContent = v.active;
    } else {
      label.style.cssText = `
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        color: var(--color-text-muted);
        animation: fade-in 350ms ease-out both;
      `;
      label.textContent = this.doneLabel(v);
      if (this.startedAt != null && this.elapsedMs == null) {
        this.startElapsedTick(label);
      }
    }
    
    // Chevron
    const chevron = document.createElement("div");
    chevron.style.cssText = `
      transition: transform 300ms;
      transform: ${expanded ? "rotate(180deg)" : "rotate(0)"};
      color: var(--color-text-faint);
    `;
    chevron.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
    
    header.appendChild(icon);
    header.appendChild(label);
    header.appendChild(chevron);
    
    header.addEventListener("click", () => {
      this.manualExpanded = !(this.manualExpanded !== null ? this.manualExpanded : autoExpanded);
      this.render();
    });
    
    // Expandable trace
    const traceWrapper = document.createElement("div");
    traceWrapper.style.cssText = `
      display: grid;
      grid-template-rows: ${expanded ? "1fr" : "0fr"};
      opacity: ${expanded ? "1" : "0"};
      transition: grid-template-rows 400ms cubic-bezier(0.23, 1, 0.32, 1), opacity 400ms;
    `;
    
    const traceInner = document.createElement("div");
    traceInner.style.cssText = "overflow: hidden;";
    
    const traceContent = document.createElement("div");
    traceContent.style.cssText = "position: relative; margin-top: 4px; margin-left: 5px; padding-left: 16px;";
    
    // Vertical line
    const verticalLine = document.createElement("span");
    verticalLine.setAttribute("aria-hidden", "true");
    verticalLine.style.cssText = `
      position: absolute;
      left: 3px;
      width: 1px;
      background: var(--color-border);
      top: -8px;
      height: ${this.lineHeight ? this.lineHeight - 2 : 0}px;
      transition: height 500ms cubic-bezier(0.23, 1, 0.32, 1);
    `;
    
    // Trace rows container
    const traceRef = document.createElement("div");
    traceRef.style.cssText = "display: flex; flex-direction: column; gap: 4px; padding: 4px 0;";
    
    // Query (for Search variant)
    if (v.query) {
      const queryRow = document.createElement("div");
      queryRow.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        height: 24px;
        padding: 0 6px;
        animation: ${expanded ? "fade-up 300ms cubic-bezier(0.23, 1, 0.32, 1) both" : "none"};
      `;
      queryRow.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--color-text-faint)" stroke-width="2" stroke-linecap="round">
          <circle cx="11" cy="11" r="7"/>
          <path d="M21 21l-4.3-4.3"/>
        </svg>
        <span style="font-size: 12.5px; color: var(--color-text-muted);">${v.query}</span>
      `;
      traceRef.appendChild(queryRow);
    }
    
    // Rows
    v.rows.slice(0, visible).forEach((row, i) => {
      const rowEl = document.createElement("div");
      rowEl.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        min-height: 28px;
        width: 100%;
        padding: 2px 6px;
        border-radius: 6px;
        animation: fade-up 320ms cubic-bezier(0.23, 1, 0.32, 1) ${i * 120}ms both;
      `;
      
      // Icon/indicator
      if (this.variant === "Search") {
        const dot = document.createElement("span");
        const tones = ["var(--color-accent)", "var(--color-warning)", "var(--color-success)"];
        dot.style.cssText = `
          display: flex;
          width: 14px;
          height: 14px;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: ${tones[i % 3]};
          flex-shrink: 0;
        `;
        dot.innerHTML = `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2.5"><circle cx="12" cy="12" r="9"/></svg>`;
        rowEl.appendChild(dot);
      } else if (this.variant === "Steps") {
        if (i < visible - 1 || !working) {
          const check = document.createElement("span");
          check.style.cssText = "flex-shrink: 0; color: var(--color-text-faint);";
          check.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>`;
          rowEl.appendChild(check);
        } else {
          const spinner = document.createElement("span");
          spinner.style.cssText = `
            width: 12px;
            height: 12px;
            flex-shrink: 0;
            border-radius: 50%;
            border: 1.5px solid var(--color-border);
            border-top-color: var(--color-text-muted);
            animation: spin 700ms linear infinite;
          `;
          rowEl.appendChild(spinner);
        }
      }
      
      // Primary text
      const primary = document.createElement("span");
      primary.style.cssText = `
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 12.5px;
        ${this.variant === "Reasoning" ? "white-space: normal; line-height: 1.5; color: var(--color-text-muted);" : "font-weight: 500; color: var(--color-text);"}
      `;
      primary.textContent = row.primary;
      rowEl.appendChild(primary);
      
      // Secondary text
      if (row.secondary) {
        const secondary = document.createElement("span");
        secondary.style.cssText = `
          flex-shrink: 0;
          font-size: 11.5px;
          color: var(--color-text-faint);
          ${row.mono ? "font-family: var(--font-mono);" : ""}
        `;
        secondary.textContent = row.secondary;
        rowEl.appendChild(secondary);
      }
      
      // Add/del counts (for Coding variant)
      if (row.add !== undefined) {
        const counts = document.createElement("span");
        counts.style.cssText = `
          flex-shrink: 0;
          font-family: var(--font-mono);
          font-size: 11px;
          font-variant-numeric: tabular-nums;
        `;
        counts.innerHTML = `<span style="color: var(--color-success);">+${row.add}</span> <span style="color: var(--color-danger);">−${row.del}</span>`;
        rowEl.appendChild(counts);
      }
      
      traceRef.appendChild(rowEl);
    });
    
    // "+N more" for Search variant
    if (this.variant === "Search" && this.stage >= 3) {
      const more = document.createElement("span");
      more.style.cssText = "font-size: 12px; color: var(--color-text-faint); animation: fade-in 300ms ease-out both;";
      more.textContent = "+7 more";
      traceRef.appendChild(more);
    }
    
    traceContent.appendChild(verticalLine);
    traceContent.appendChild(traceRef);
    traceInner.appendChild(traceContent);
    traceWrapper.appendChild(traceInner);
    
    this.element.appendChild(header);
    this.element.appendChild(traceWrapper);
    
    this.container.innerHTML = "";
    this.container.appendChild(this.element);
    
    // Measure line height
    requestAnimationFrame(() => {
      if (traceRef) {
        this.lineHeight = traceRef.offsetHeight;
        verticalLine.style.height = (this.lineHeight - 2) + "px";
      }
    });
  }
  
  startSequence() {
    const advance = () => {
      if (this.destroyed) return; // stop the chain once destroyed
      if (this.stage < STAGES.length - 1) {
        this.sequenceTimer = setTimeout(() => {
          if (this.destroyed) return; // a pending tick fired after destroy
          this.stage++;
          this.render();
          advance();
        }, STAGES[this.stage]);
      }
    };
    advance();
  }
  
  destroy() {
    // Fully terminate: cancel the stage-advance setTimeout chain AND the
    // 500ms label tick, flag as destroyed so any stray callback is a no-op,
    // then remove the element. Previously the setTimeout chain survived,
    // re-rendered into the still-mounted container, and started a new tick
    // interval that never stopped — the "keeps counting forever" regression.
    this.destroyed = true;
    if (this.sequenceTimer) {
      clearTimeout(this.sequenceTimer);
      this.sequenceTimer = null;
    }
    if (this.elapsedTimer) {
      clearInterval(this.elapsedTimer);
      this.elapsedTimer = null;
    }
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUIThinkingState = BeUIThinkingState;
