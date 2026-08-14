/**
 * BeUILoadingState - Drive variant loading indicator
 * Shows pixel-grid loader with shimmer and elapsed timer
 */
class BeUILoadingState {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      label: options.label || 'Churning',
      showTimer: options.showTimer !== false,
      variant: options.variant || 'drive', // 'drive' or 'pixels'
      ...options
    };
    
    this.startTime = null;
    this.timerInterval = null;
    this.element = null;
    
    this.render();
  }
  
  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'beui-loading';
    
    // Drive variant (circular)
    if (this.options.variant === 'drive') {
      const drive = document.createElement('div');
      drive.className = 'beui-loading__drive';
      
      const ring = document.createElement('div');
      ring.className = 'beui-loading__drive-ring';
      
      const center = document.createElement('div');
      center.className = 'beui-loading__drive-center';
      
      drive.appendChild(ring);
      drive.appendChild(center);
      wrapper.appendChild(drive);
    }
    
    // Pixel grid variant
    if (this.options.variant === 'pixels') {
      const pixels = document.createElement('div');
      pixels.className = 'beui-loading__pixels';
      
      for (let i = 0; i < 16; i++) {
        const pixel = document.createElement('div');
        pixel.className = 'beui-loading__pixel';
        pixels.appendChild(pixel);
      }
      
      wrapper.appendChild(pixels);
    }
    
    // Label
    if (this.options.label) {
      const label = document.createElement('div');
      label.className = 'beui-loading__label';
      label.textContent = this.options.label;
      wrapper.appendChild(label);
    }
    
    // Timer
    if (this.options.showTimer) {
      const timer = document.createElement('div');
      timer.className = 'beui-loading__timer';
      
      const timerValue = document.createElement('span');
      timerValue.className = 'beui-loading__timer-value';
      timerValue.textContent = '0.0s';
      
      timer.appendChild(timerValue);
      wrapper.appendChild(timer);
      
      this.timerElement = timerValue;
    }
    
    this.container.appendChild(wrapper);
    this.element = wrapper;
  }
  
  start() {
    this.startTime = Date.now();
    
    if (this.options.showTimer && this.timerElement) {
      this.timerInterval = setInterval(() => {
        const elapsed = (Date.now() - this.startTime) / 1000;
        this.timerElement.textContent = `${elapsed.toFixed(1)}s`;
      }, 100);
    }
  }
  
  stop() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }
  
  updateTimer(seconds) {
    if (this.timerElement) {
      this.timerElement.textContent = `${seconds.toFixed(1)}s`;
    }
  }
  
  destroy() {
    this.stop();
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUILoadingState = BeUILoadingState;
