import type { GuideLanguage } from './guide.ts'

type RecognitionResult = { isFinal: boolean; [index: number]: { transcript: string } }
type Recognition = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  onresult: ((event: { results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null; onend: (() => void) | null;
  start(): void; abort(): void;
}
export type GuideSpeechEnvironment = {
  SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition;
  speechSynthesis?: Pick<SpeechSynthesis, 'speak' | 'cancel' | 'getVoices'>;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
}
export const voiceLocale = (language: GuideLanguage) => ({ en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' })[language]
export const canRecognize = (env: GuideSpeechEnvironment) => Boolean(env.SpeechRecognition || env.webkitSpeechRecognition)

/** One short, explicit microphone session. No MediaRecorder, audio uploads,
 * continuous listening, persisted transcripts or frame-loop work. */
export class GuideSpeechSession {
  private recognition: Recognition | null = null
  private utterance: SpeechSynthesisUtterance | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private env: GuideSpeechEnvironment
  private events: {
    listening: (value: boolean) => void; speaking: (value: boolean) => void; error: (message: string) => void;
  }
  constructor(env: GuideSpeechEnvironment, events: GuideSpeechSession['events']) { this.env = env; this.events = events }
  activate() { this.disposed = false }
  stopListening() {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const recognition = this.recognition; this.recognition = null
    if (recognition) { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; try { recognition.abort() } catch { /* Already ended. */ } }
    if (!this.disposed) this.events.listening(false)
  }
  stopSpeaking() {
    if (this.utterance) {
      this.utterance.onend = null; this.utterance.onerror = null; this.utterance = null
      this.env.speechSynthesis?.cancel()
    }
    if (!this.disposed) this.events.speaking(false)
  }
  stop() { this.stopListening(); this.stopSpeaking() }
  dispose() { this.disposed = true; this.stop() }
  listen(language: GuideLanguage, onText: (text: string) => void) {
    if (this.disposed) return
    this.stop()
    const Constructor = this.env.SpeechRecognition || this.env.webkitSpeechRecognition
    if (!Constructor) { this.events.error('Voice input is unavailable here. Type your question instead.'); return }
    const recognition = new Constructor(); this.recognition = recognition
    recognition.lang = voiceLocale(language); recognition.continuous = false; recognition.interimResults = false; recognition.maxAlternatives = 1
    recognition.onresult = event => {
      if (this.recognition !== recognition) return
      const text = Array.from(event.results).filter(r => r.isFinal).map(r => r[0]?.transcript ?? '').join(' ').trim().slice(0, 600)
      if (text) { this.stopListening(); onText(text) }
    }
    recognition.onerror = event => {
      if (this.recognition !== recognition) return
      this.stopListening()
      this.events.error(['not-allowed', 'service-not-allowed'].includes(event.error) ? 'Microphone permission was denied. You can still type a question.' : 'Speech was not recognized. Try again or type your question.')
    }
    recognition.onend = () => { if (this.recognition === recognition) { this.stopListening(); this.events.error('No speech heard. Try again or type your question.') } }
    try {
      recognition.start(); this.events.listening(true)
      this.timer = setTimeout(() => { if (this.recognition === recognition) { this.stopListening(); this.events.error('Listening ended. Try again or type your question.') } }, 15000)
    } catch { this.stopListening(); this.events.error('Voice input could not start. Type your question instead.') }
  }
  speak(text: string, language: GuideLanguage) {
    if (this.disposed) return
    this.stop()
    const synth = this.env.speechSynthesis, Utterance = this.env.SpeechSynthesisUtterance
    if (!synth || !Utterance) { this.events.error('Spoken audio is unavailable here. The answer is shown as text.'); return }
    const voices = synth.getVoices(), locale = voiceLocale(language)
    const voice = voices.find(v => v.lang.toLowerCase() === locale.toLowerCase()) ?? voices.find(v => v.lang.toLowerCase().startsWith(language))
    if (voices.length && !voice && language !== 'en') { this.events.error('No spoken voice is installed for this language. The answer is shown as text.'); return }
    const utterance = new Utterance(text.slice(0, 3500)); this.utterance = utterance
    utterance.lang = locale; if (voice) utterance.voice = voice
    utterance.rate = 1
    utterance.onend = () => { if (this.utterance === utterance) { this.utterance = null; this.events.speaking(false) } }
    utterance.onerror = () => { if (this.utterance === utterance) { this.utterance = null; this.events.speaking(false); this.events.error('Spoken audio is unavailable here. The answer is shown as text.') } }
    try { synth.speak(utterance); this.events.speaking(true) } catch { this.stopSpeaking(); this.events.error('Spoken audio is unavailable here. The answer is shown as text.') }
  }
}
