const TICK_LOOKAHEAD_SECONDS = 0.25;
const TICK_SCHEDULER_INTERVAL_MS = 50;
const TICK_DURATION_SECONDS = 0.04;
const TICK_FREQUENCY_HZ = 2200;
const TICK_GAIN = 0.35;

export type TickSource = (fromSongSeconds: number, toSongSeconds: number) => number[];

export class SongPlayer {
  private source: AudioBufferSourceNode | null = null;
  private startedAtContextTime = 0;
  private startedAtSongTime = 0;
  private rate = 1;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private tickedUntilSongTime = 0;
  private endedListener: (() => void) | null = null;

  constructor(private readonly context: AudioContext, private readonly buffer: AudioBuffer) {}

  get durationSeconds(): number {
    return this.buffer.duration;
  }

  get isPlaying(): boolean {
    return this.source !== null;
  }

  get playbackRate(): number {
    return this.rate;
  }

  currentTime(): number {
    if (!this.source) return this.startedAtSongTime;
    return Math.min(this.buffer.duration, this.startedAtSongTime + (this.context.currentTime - this.startedAtContextTime) * this.rate);
  }

  onEnded(listener: () => void): void {
    this.endedListener = listener;
  }

  async play(fromSeconds: number, tickSource?: TickSource): Promise<void> {
    this.stopSource();
    if (this.context.state === "suspended") await this.context.resume();
    const start = Math.max(0, Math.min(fromSeconds, this.buffer.duration));
    const source = this.context.createBufferSource();
    source.buffer = this.buffer;
    source.playbackRate.value = this.rate;
    source.connect(this.context.destination);
    source.onended = () => {
      if (this.source !== source) return;
      this.startedAtSongTime = this.currentTime();
      this.source = null;
      this.stopTicks();
      this.endedListener?.();
    };
    this.startedAtContextTime = this.context.currentTime;
    this.startedAtSongTime = start;
    this.source = source;
    source.start(0, start);
    if (tickSource) this.startTicks(tickSource);
  }

  pause(): void {
    const position = this.currentTime();
    this.stopSource();
    this.startedAtSongTime = position;
  }

  seek(seconds: number): void {
    this.startedAtSongTime = Math.max(0, Math.min(seconds, this.buffer.duration));
  }

  setRate(rate: number): void {
    const position = this.currentTime();
    this.rate = rate;
    if (this.source) {
      this.startedAtSongTime = position;
      this.startedAtContextTime = this.context.currentTime;
      this.source.playbackRate.value = rate;
    }
  }

  dispose(): void {
    this.stopSource();
    this.endedListener = null;
  }

  private stopSource(): void {
    this.stopTicks();
    if (!this.source) return;
    const source = this.source;
    this.source = null;
    source.onended = null;
    source.stop();
    source.disconnect();
  }

  private startTicks(tickSource: TickSource): void {
    this.tickedUntilSongTime = this.currentTime();
    const schedule = () => {
      const now = this.currentTime();
      const until = now + TICK_LOOKAHEAD_SECONDS * this.rate;
      for (const songTime of tickSource(this.tickedUntilSongTime, until)) {
        const contextTime = this.startedAtContextTime + (songTime - this.startedAtSongTime) / this.rate;
        if (contextTime >= this.context.currentTime) this.playTick(contextTime);
      }
      this.tickedUntilSongTime = until;
    };
    schedule();
    this.tickTimer = setInterval(schedule, TICK_SCHEDULER_INTERVAL_MS);
  }

  private stopTicks(): void {
    if (this.tickTimer !== null) clearInterval(this.tickTimer);
    this.tickTimer = null;
  }

  private playTick(atContextTime: number): void {
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.frequency.value = TICK_FREQUENCY_HZ;
    gain.gain.setValueAtTime(TICK_GAIN, atContextTime);
    gain.gain.exponentialRampToValueAtTime(0.001, atContextTime + TICK_DURATION_SECONDS);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(atContextTime);
    oscillator.stop(atContextTime + TICK_DURATION_SECONDS);
  }
}
