export type PlaybackState =
  | "idle"
  | "preparing"
  | "playing"
  | "paused"
  | "buffering"
  | "stopped"
  | "failed";
export type PlaybackPort = { play(): Promise<void>; pause(): void };

/** Session authority shared by all speech surfaces. Generation never owns audio. */
export class SpeechTransport {
  static owner: SpeechTransport | null = null;
  epoch = 0;
  state: PlaybackState = "idle";
  intent = false;
  constructor(
    public port: () => PlaybackPort | null,
    private displaced: () => void = () => {},
  ) {}
  claim() {
    const previous = SpeechTransport.owner;
    SpeechTransport.owner = this;
    if (previous && previous !== this) {
      previous.stop();
      previous.displaced();
    }
  }
  prepare() {
    this.claim();
    this.port()?.pause();
    this.intent = true;
    this.state = "preparing";
    return ++this.epoch;
  }
  async play(epoch = this.epoch) {
    if (epoch !== this.epoch || !this.intent) return;
    this.claim();
    try {
      await this.port()?.play();
      if (epoch === this.epoch && this.intent) this.state = "playing";
    } catch (error) {
      if (epoch === this.epoch && this.intent) {
        this.state = "failed";
        this.intent = false;
        throw error;
      }
    }
  }
  pause() {
    this.intent = false;
    this.port()?.pause();
    this.state = "paused";
  }
  resume() {
    this.intent = true;
    return this.play();
  }
  stop() {
    ++this.epoch;
    this.intent = false;
    this.port()?.pause();
    this.state = "stopped";
    if (SpeechTransport.owner === this) SpeechTransport.owner = null;
  }
}
