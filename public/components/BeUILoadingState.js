/**
 * BeUILoadingState - Beautiful UI Loading State
 * Pixel-grid loader with shimmer and elapsed time
 * Matches the design from beautifului.dev
 */

// Chevron pattern delays for Drive and Dots variants
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

class BeUILoadingState {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      label: options.label || 'Churning',
      variant: options.variant || 'Drive', // 'Drive', 'Dots', or 'Orbit'
      ...options
    };
    
    this.startTime = Date.now();
    this.timerInterval = null;
    this.element = null;
    this.timerElement = null;
    
    this.render();
    this.startTimer();
  }
  
  render() {
    const pattern = PATTERNS[this.options.variant] || PATTERNS.Drive;
    const { delays, dur, round } = pattern;
    
    // Main wrapper
    this.element = document.createElement('div');
    this.element.style.cssText = `
      display: flex;
      align-items: center;
      gap: 10px;
      width: fit-content;
    `;
    
    // Pixel grid (3x3)
    const grid = document.createElement('span');
    grid.setAttribute('aria-hidden', 'true');
    grid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(3, 4px);
      gap: 1.5px;
    `;
    
    // Create 9 pixels with staggered animations
    delays.forEach((delay, i) => {
      const pixel = document.createElement('span');
      
      const baseStyles = `
        width: 4px;
        height: 4px;
        background: var(--color-accent, #f2b705);
        opacity: ${delay === null ? '0.07' : '0.15'};
      `;
      
      const roundStyle = round ? 'border-radius: 50%;' : 'border-radius: 1px;';
      
      const animationStyle = delay === null 
        ? 'animation: none;'
        : `animation: pixel-on ${dur}ms ease-in-out ${delay}ms infinite;`;
      
      pixel.style.cssText = baseStyles + roundStyle + animationStyle;
      grid.appendChild(pixel);
    });
    
    // Shimmering label
    const label = document.createElement('span');
    label.style.cssText = `
      font-size: 13px;
      font-weight: 500;
      background: linear-gradient(
        90deg,
        var(--color-text-faint, #6b6b66) 35%,
        var(--color-text, #f5f5f2) 50%,
        var(--color-text-faint, #6b6b66) 65%
      );
      background-size: 200% 100%;
      -webkit-background-clip: text;
      background-clip: text;
      -webkit-text-fill-color: transparent;
      animation: shimmer-text 1.4s linear infinite;
    `;
    label.textContent = this.options.label;
    
    // Timer
    const timer = document.createElement('span');
    timer.style.cssText = `
      font-family: var(--font-mono, 'SFMono-Regular', Consolas, monospace);
      font-size: 12px;
      color: var(--color-text-faint, #6b6b66);
      font-variant-numeric: tabular-nums;
    `;
    timer.textContent = '0.0s';
    
    // Assemble
    this.element.appendChild(grid);
    this.element.appendChild(label);
    this.element.appendChild(timer);
    
    this.timerElement = timer;
    
    // Add to container
    this.container.innerHTML = '';
    this.container.appendChild(this.element);
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
  
  destroy() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUILoadingState = BeUILoadingState;
