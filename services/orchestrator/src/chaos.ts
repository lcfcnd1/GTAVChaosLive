export type ChaosLevel = 0 | 1 | 2 | 3 | 4 | 5;

export type ChaosState = { points: number; level: ChaosLevel; updatedAt: number };

export class ChaosMeter {
  private state: ChaosState = { points: 0, level: 0, updatedAt: 0 };
  constructor(private readonly maxPoints = 100, private readonly decayPerSecond = 2) {}

  snapshot(now = Date.now()): ChaosState { this.decay(now); return { ...this.state }; }
  add(points: number, now = Date.now()): ChaosState { this.decay(now); this.state.points = Math.min(this.maxPoints, Math.max(0, this.state.points + Math.max(0, points))); this.state.updatedAt = now; this.state.level = this.toLevel(this.state.points); return { ...this.state }; }
  reset(now = Date.now()): ChaosState { this.state = { points: 0, level: 0, updatedAt: now }; return { ...this.state }; }

  private decay(now: number) {
    if (!this.state.updatedAt) { this.state.updatedAt = now; return; }
    const seconds = Math.max(0, now - this.state.updatedAt) / 1000;
    if (seconds > 0) { this.state.points = Math.max(0, this.state.points - seconds * this.decayPerSecond); this.state.level = this.toLevel(this.state.points); this.state.updatedAt = now; }
  }
  private toLevel(points: number): ChaosLevel { return Math.min(5, Math.floor((points / this.maxPoints) * 6)) as ChaosLevel; }
}
