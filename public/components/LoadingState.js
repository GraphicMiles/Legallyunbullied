/**
 * Beautiful UI Loading State - Pixel Grid Loader
 * Converted from React to vanilla JavaScript
 * 
 * Variants:
 *   Drive  — square cells, chevron wavefront driving right
 *   Dots   — same wavefront, circular cells
 *   Orbit  — a comet lapping the grid perimeter
 */

// Chevron pattern delays (Drive and Dots variants)
const chevron = Array.from({ length: 9 }, (_, i) => {
  const r = Math.floor(i / 3);
  const c = i % 3;
  return (c + Math.abs(r - 1)) * 90;
});

// Orbit pattern delays
const ORBIT_ORDER = [0, 1, 2, 5, 8, 7, 6, 3];
const orbit = Array.from({ length: 9 }, (_, i) => {
  const k = ORBIT_ORDER.indexOf(i);
  return k === -1 ? null : k * 110;
});

// Pattern configurations
const PATTERNS = {
  Drive: { delays: chevron, dur: 650, round: false },
  Dots: { delays: chevron, dur: 650, round: true },
  Orbit: { delays: orbit, dur: 950, round: false },
};

export class LoadingState {
  constructor(options = {}) {
    this.label = options.label || "Churning";
    this.variant = options.variant || "Drive";
    this.container = options.container || null;
    
    this.startTime = Date.now();
    this.timerInterval = null;
    this.element = null;
    this.timerElement = null;
    
    this.render();
    this.startTimer();
  }
  
  render() {
    const pattern = PATTERNS[this.variant] || PATTERNS.Drive;
    const { delays, dur, round } = pattern;
    
    // Create main container
    this.element = document.createElement("div");
    this.element.className = "beui-loading-state";
    
    // Create pixel grid
    const grid = document.createElement("span");
    grid.className = "beui-pixel-grid";
    grid.setAttribute("aria-hidden", "true");
    
    // Create pixels
    delays.forEach((delay, i) => {
      const pixel = document.createElement("span");
      pixel.className = "beui-pixel" + (round ? " round" : "");
      
      if (delay === null) {
        pixel.style.opacity = "0.07";
      } else {
        pixel.classList.add("active");
        pixel.style.animationDelay = `${delay}ms`;
        pixel.style.animationDuration = `${dur}ms`;
      }
      
      grid.appendChild(pixel);
    });
    
    // Create label with shimmer
    const label = document.createElement("span");
    label.className = "beui-loading-label";
    label.textContent = this.label;
    
    // Create timer
    this.timerElement = document.createElement("span");
    this.timerElement.className = "beui-loading-timer";
    this.timerElement.textContent = "0.0s";
    
    // Assemble
    this.element.appendChild(grid);
    this.element.appendChild(label);
    this.element.appendChild(this.timerElement);
    
    // Append to container if provided
    if (this.container) {
      this.container.appendChild(this.element);
    }
  }
  
  startTimer() {
    this.timerInterval = setInterval(() => {
      const elapsed = (Date.now() - this.startTime) / 1000;
      
      if (elapsed < 60) {
        this.timerElement.textContent = `${elapsed.toFixed(1)}s`;
      } else {
        const minutes = Math.floor(elapsed / 60);
        const seconds = (elapsed % 60).toFixed(1);
        this.timerElement.textContent = `${minutes}m ${seconds}s`;
      }
    }, 100);
  }
  
  setLabel(newLabel) {
    this.label = newLabel;
    const labelElement = this.element.querySelector(".beui-loading-label");
    if (labelElement) {
      labelElement.textContent = newLabel;
    }
  }
  
  setVariant(newVariant) {
    this.variant = newVariant;
    // Re-render with new variant
    if (this.container) {
      this.destroy();
      this.render();
      this.container.appendChild(this.element);
    }
  }
  
  getElement() {
    return this.element;
  }
  
  destroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    
    this.element = null;
    this.timerElement = null;
  }
}

// Export to window for use in app.js
window.LoadingState = LoadingState;
