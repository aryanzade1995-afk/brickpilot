let sharedContext: AudioContext | null = null
/** Called directly from Walk inside / Replay, preserving browser audio consent. */
export function unlockRoomNarration() {
  if (typeof window === 'undefined' || !window.AudioContext) return
  sharedContext ??= new window.AudioContext({ latencyHint: 'playback' })
  void sharedContext.resume().catch(() => {})
}
export class RoomAudioPlayer {
  private source: AudioBufferSourceNode | null = null
  private revision = 0
  constructor(privateContext?: () => AudioContext | null) { this.context = privateContext ?? (() => sharedContext) }
  private context: () => AudioContext | null
  stop() { this.revision++; if (this.source) { this.source.onended = null; try { this.source.stop() } catch { /* Already finished. */ } this.source.disconnect(); this.source = null } }
  async play(bytes: ArrayBuffer, ended: () => void) {
    this.stop(); const revision = this.revision, context = this.context()
    if (!context || context.state !== 'running') throw new Error('Tap Replay to enable room audio.')
    const buffer = await context.decodeAudioData(bytes.slice(0))
    if (revision !== this.revision) return false
    const source = context.createBufferSource(); source.buffer = buffer; source.connect(context.destination); this.source = source
    source.onended = () => { if (this.source === source) { source.disconnect(); this.source = null; ended() } }
    source.start(); return true
  }
}
