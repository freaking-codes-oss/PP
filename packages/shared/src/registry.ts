import { Modality, ProviderRegistryEntry } from './providers';

// ---------------------------------------------------------------------------
// Built-in provider registry (Layer 1).
//
// These entries are the "known providers" list shown in the admin page. The
// active routing table lives in the DB (seeded from this file) so operators
// can reorder/disable/enable providers without code changes.
//
// Every entry is OpenAI-compatible (`apiShape: 'openai'`) so one shared HTTP
// client handles all of them — that is the adapter reuse the spec asks for.
// NIM exposes /v1 chat & images; OpenRouter exposes /v1 chat & images;
// Gemini exposes an OpenAI-compatible endpoint at /v1beta/openai.
// ---------------------------------------------------------------------------

export const MODEL_ALIASES = {
  'fast-text': 'fast-text',
  'cheap-text': 'cheap-text',
  'vision-text': 'vision-text',
  image: 'image',
  video: 'video',
  tts: 'tts',
};

export const BUILTIN_PROVIDER_REGISTRY: ProviderRegistryEntry[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Meta-API across many text/image models. free: prefixes cost $0.',
    baseUrl: 'https://openrouter.ai/api/v1',
    authMethod: 'bearer',
    apiShape: 'openai',
    supportedModalities: [Modality.TEXT, Modality.IMAGE],
    rateLimit: { requestsPerMin: 50 },
    freeTier: true,
    models: {
      'fast-text': 'meta-llama/llama-3.1-8b-instruct:free',
      'cheap-text': 'meta-llama/llama-3.1-8b-instruct:free',
      'vision-text': 'meta-llama/llama-3.2-11b-vision-instruct:free',
      image: 'openai/dall-e-3', // paid fallback only; see router config
    },
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    description: 'Google Gemini OpenAI-compatible endpoint (v1beta/openai).',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    authMethod: 'x-goog-api-key',
    apiShape: 'openai',
    supportedModalities: [Modality.TEXT, Modality.IMAGE],
    rateLimit: { requestsPerMin: 15, dailyRequests: 1500 },
    freeTier: true,
    models: {
      'fast-text': 'gemini-1.5-flash',
      'cheap-text': 'gemini-1.5-flash-8b',
      'vision-text': 'gemini-1.5-flash',
      image: 'imagen-3.0-generate-002', // documented; most free tiers use imagegen
    },
  },
  {
    id: 'nvidia-nim',
    name: 'NVIDIA NIM',
    description: 'NVIDIA NIM microservices (OpenAI-compatible).',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    authMethod: 'bearer',
    apiShape: 'openai',
    supportedModalities: [Modality.TEXT, Modality.IMAGE],
    rateLimit: { requestsPerMin: 40 },
    freeTier: true,
    models: {
      'fast-text': 'meta/llama-3.3-70b-instruct',
      'vision-text': 'meta/llama-3.3-70b-instruct',
      image: 'amazon/nova-canvas-v1', // image gen on NIM
    },
  },
  {
    id: 'groq',
    name: 'Groq',
    description: 'Fast text inference (OpenAI-compatible).',
    baseUrl: 'https://api.groq.com/openai/v1',
    authMethod: 'bearer',
    apiShape: 'openai',
    supportedModalities: [Modality.TEXT],
    rateLimit: { requestsPerMin: 30 },
    freeTier: true,
    models: {
      'fast-text': 'llama-3.3-70b-versatile',
      'cheap-text': 'llama-3.1-8b-instant',
    },
  },
  {
    id: 'mistral',
    name: 'Mistral',
    description: 'Mistral text models (OpenAI-compatible).',
    baseUrl: 'https://api.mistral.ai/v1',
    authMethod: 'bearer',
    apiShape: 'openai',
    supportedModalities: [Modality.TEXT],
    rateLimit: { requestsPerMin: 30 },
    freeTier: false,
    models: {
      'fast-text': 'mistral-small-latest',
      'vision-text': 'pixtral-12b-2409',
    },
  },
  {
    id: 'mock',
    name: 'Mock (local demo)',
    description: 'Local deterministic mock used for demos/tests — never needs a key.',
    baseUrl: 'mock://local',
    authMethod: 'none',
    apiShape: 'custom',
    supportedModalities: [Modality.TEXT, Modality.IMAGE, Modality.VIDEO, Modality.SPEECH],
    rateLimit: { requestsPerMin: 1000 },
    freeTier: true,
    models: {
      'fast-text': 'mock-text',
      'cheap-text': 'mock-text',
      'vision-text': 'mock-text',
      image: 'mock-image',
      video: 'mock-video',
      tts: 'mock-tts',
    },
  },
  // Placeholder for a true video provider. API shape varies wildly today, so
  // rather than hardcode one vendor, video capability arrives through a driver
  // id. The router's capability matching only routes to video-capable entries.
  {
    id: 'video-provider',
    name: 'AI Video (driver placeholder)',
    description:
      'Drop-in driver for a video-generation API (e.g. Veo/runway-style). Not enabled by default.',
    baseUrl: 'https://example.invalid/v1',
    authMethod: 'bearer',
    apiShape: 'openai',
    supportedModalities: [Modality.VIDEO],
    freeTier: false,
    models: { video: 'placeholder-video-model' },
  },
];

export const registryById = (id: string): ProviderRegistryEntry | undefined =>
  BUILTIN_PROVIDER_REGISTRY.find((p) => p.id === id);

export const providerSupports = (providerId: string, modality: Modality): boolean => {
  const p = registryById(providerId);
  return p ? p.supportedModalities.includes(modality) : false;
};
