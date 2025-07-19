class TraceLogger {
  constructor() {
    this.steps = [];
    this.selected = null;
  }
  addCheck({ source, details }) {
    this.steps.push({ source, details });
  }
  setSelected(selected) {
    this.selected = selected;
  }
  toLog() {
    return [
      ...this.steps.map(s => `${s.source}: ${s.details}`),
      this.selected ? `Selected: ${this.selected}` : ''
    ].filter(Boolean).join('\n');
  }
}
module.exports = TraceLogger;
