import { fileURLToPath } from 'node:url'
export const ROOM_MODEL_ROOT = fileURLToPath(new URL('../output/room-guide-models/', import.meta.url))
export const ROOM_AUDIO_ROOT = fileURLToPath(new URL('../output/room-narration/', import.meta.url))
export const MARATHI_VOICE = Object.freeze({
  model: 'shreyask/bol-tts-marathi-onnx', revision: '985c7c42652bc9353598cc7ea8e086512bb04643',
  source: 'https://huggingface.co/shreyask/bol-tts-marathi-onnx', license: 'Apache-2.0',
  voice: 'mf_asha', sampleRate: 24000,
  files: [
    { name: 'model.onnx', url: 'https://huggingface.co/shreyask/bol-tts-marathi-onnx/resolve/985c7c42652bc9353598cc7ea8e086512bb04643/onnx/model.onnx', sha256: '9281f8616059bda80c18135a499071ed9fa9e67ea2f3cd5cf8027178c2f88a84' },
    { name: 'config.json', url: 'https://huggingface.co/shreyask/bol-tts-marathi-onnx/resolve/985c7c42652bc9353598cc7ea8e086512bb04643/config.json' },
    { name: 'voice.bin', url: 'https://huggingface.co/spaces/shreyask/bol-tts-marathi/resolve/cc0aa0819b9b6db2ec916b2cf05832fe4f5a2e7b/public/voices/mf_asha.bin', sha256: '57784e5f6853a66605c897d9d4489e509e5c686f5cd95027f6d4ef9119115bea' },
  ],
})
export const ROOM_ANALYSIS_MODEL = Object.freeze({ model: 'Xenova/all-MiniLM-L6-v2', revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  source: 'https://huggingface.co/Xenova/all-MiniLM-L6-v2', license: 'Apache-2.0',
  files: ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'].map(name => ({ name: `room-embedding/${name}`,
    url: `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/751bff37182d3f1213fa05d7196b954e230abad9/${name}`,
    ...(name.endsWith('.onnx') ? { sha256: 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1' } : {}) })) })
