export const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions'
export const NVIDIA_PRIMARY_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b'
export const NVIDIA_FALLBACK_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b'
export const NVIDIA_MODELS = [NVIDIA_PRIMARY_MODEL, NVIDIA_FALLBACK_MODEL] as const
