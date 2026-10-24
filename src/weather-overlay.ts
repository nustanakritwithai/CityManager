/** Decorative screen-space rain. It never reads or changes City state. */
export class WeatherOverlay {
  private readonly canvas = document.createElement('canvas');
  private readonly context: CanvasRenderingContext2D | null;
  private drops: { x: number; y: number; length: number; speed: number }[] = [];
  private intensity = 0;
  private frame = 0;
  private last = 0;
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)');

  constructor(after: Element) {
    this.canvas.className = 'weather-overlay';
    this.canvas.setAttribute('aria-hidden', 'true');
    after.insertAdjacentElement('afterend', this.canvas);
    this.context = this.canvas.getContext('2d');
    addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => this.start());
    this.resize();
  }

  get raining() { return this.intensity > 0; }

  /** 0 hides the rain; 1 is a heavy shower. */
  set(intensity: number) {
    const next = Math.max(0, Math.min(1, intensity));
    if (Math.abs(next - this.intensity) < .02 && (next > 0) === (this.intensity > 0)) return;
    this.intensity = next;
    this.canvas.dataset.active = String(next > 0);
    this.seed();
    this.start();
    if (this.reduced.matches) this.draw();
  }

  private start() {
    if (this.intensity > 0 && !this.frame && !document.hidden) { this.last = performance.now(); this.frame = requestAnimationFrame(t => this.tick(t)); }
  }

  private resize() {
    const ratio = Math.min(devicePixelRatio, 1.5);
    this.canvas.width = Math.round(innerWidth * ratio); this.canvas.height = Math.round(innerHeight * ratio);
    this.context?.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.seed();
  }

  private seed() {
    const count = Math.round(innerWidth * innerHeight / 5200 * this.intensity);
    while (this.drops.length < count) this.drops.push({ x: Math.random() * innerWidth, y: Math.random() * innerHeight, length: 9 + Math.random() * 14, speed: 520 + Math.random() * 380 });
    this.drops.length = count;
  }

  private draw() {
    const context = this.context; if (!context) return;
    context.clearRect(0, 0, innerWidth, innerHeight);
    context.strokeStyle = 'rgba(214,226,240,.34)'; context.lineWidth = 1; context.beginPath();
    for (const drop of this.drops) { context.moveTo(drop.x, drop.y); context.lineTo(drop.x - drop.length * .22, drop.y + drop.length); }
    context.stroke();
  }

  private tick(now: number) {
    this.frame = 0;
    if (!this.intensity || document.hidden) { this.context?.clearRect(0, 0, innerWidth, innerHeight); return; }
    const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
    if (!this.reduced.matches) for (const drop of this.drops) {
      drop.y += drop.speed * dt; drop.x -= drop.speed * .22 * dt;
      if (drop.y > innerHeight) { drop.y = -drop.length; drop.x = Math.random() * (innerWidth + 60); }
    }
    this.draw();
    if (!this.reduced.matches) this.frame = requestAnimationFrame(t => this.tick(t));
  }
}
