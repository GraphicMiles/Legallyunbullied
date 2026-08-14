/**
 * BeUITaskRows - Multi-step task progress tracker
 * Shows task status (running, completed, failed)
 */
class BeUITaskRows {
  constructor(container, options = {}) {
    this.container = container;
    this.options = options;
    
    this.tasks = [];
    this.element = null;
    
    this.render();
  }
  
  render() {
    const wrapper = document.createElement('div');
    wrapper.className = 'beui-tasks';
    
    this.container.appendChild(wrapper);
    this.element = wrapper;
  }
  
  addTask(task) {
    const id = task.id || `task-${this.tasks.length}`;
    const taskData = { ...task, id, status: task.status || 'is-pending' };
    this.tasks.push(taskData);
    
    this.renderTask(taskData);
    return id;
  }
  
  renderTask(task) {
    const row = document.createElement('div');
    row.className = 'beui-task-row';
    row.dataset.taskId = task.id;
    
    // Status indicator
    const status = document.createElement('div');
    status.className = `beui-task-row__status ${task.status}`;
    
    if (task.status === 'is-running') {
      const spinner = document.createElement('div');
      spinner.className = 'beui-task-row__spinner';
      status.appendChild(spinner);
    } else if (task.status === 'is-complete') {
      const icon = document.createElement('span');
      icon.className = 'beui-task-row__icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" width="14" height="14"><polyline points="20 6 9 17 4 12"/></svg>';
      status.appendChild(icon);
    } else if (task.status === 'is-failed') {
      const icon = document.createElement('span');
      icon.className = 'beui-task-row__icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
      status.appendChild(icon);
    } else {
      // Pending
      const icon = document.createElement('span');
      icon.className = 'beui-task-row__icon';
      icon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="12" cy="12" r="10"/></svg>';
      status.appendChild(icon);
    }
    
    // Content
    const content = document.createElement('div');
    content.className = 'beui-task-row__content';
    
    const name = document.createElement('div');
    name.className = 'beui-task-row__name';
    name.textContent = task.name;
    
    content.appendChild(name);
    
    if (task.detail) {
      const detail = document.createElement('div');
      detail.className = 'beui-task-row__detail';
      detail.textContent = task.detail;
      content.appendChild(detail);
    }
    
    row.appendChild(status);
    row.appendChild(content);
    
    this.element.appendChild(row);
  }
  
  updateTask(id, updates) {
    const taskIndex = this.tasks.findIndex(t => t.id === id);
    if (taskIndex === -1) return;
    
    this.tasks[taskIndex] = { ...this.tasks[taskIndex], ...updates };
    
    // Re-render
    const row = this.element.querySelector(`[data-task-id="${id}"]`);
    if (row) {
      row.remove();
      this.renderTask(this.tasks[taskIndex]);
    }
  }
  
  setTasks(tasks) {
    this.tasks = [];
    this.element.innerHTML = '';
    tasks.forEach(task => this.addTask(task));
  }
  
  clear() {
    this.tasks = [];
    this.element.innerHTML = '';
  }
  
  destroy() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

window.BeUITaskRows = BeUITaskRows;
