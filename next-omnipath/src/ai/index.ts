import { createCerebras } from '@ai-sdk/cerebras';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

export const cerebras = createCerebras({
  apiKey: process.env.CEREBRAS_API_KEY,
});

export const google = createGoogleGenerativeAI({
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
});

export const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

function getOpenRouterChatModel() {
  return openrouter.chat(
    process.env.OPENROUTER_CHAT_MODEL || 'openai/gpt-oss-120b',
    {
      provider: {
        order: ['groq'],
      },
    },
  );
}

export function getChatModel() {
  const preferredProvider = process.env.CHAT_MODEL_PROVIDER?.toLowerCase();

  if (preferredProvider === 'openrouter' && process.env.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter' as const,
      model: getOpenRouterChatModel(),
    };
  }

  if (preferredProvider === 'google' && process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return {
      provider: 'google' as const,
      model: google(process.env.GOOGLE_CHAT_MODEL || 'gemini-3-flash-preview'),
    };
  }

  if (preferredProvider === 'cerebras' && process.env.CEREBRAS_API_KEY) {
    return {
      provider: 'cerebras' as const,
      model: cerebras(process.env.CEREBRAS_CHAT_MODEL || 'gpt-oss-120b'),
    };
  }

  if (process.env.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter' as const,
      model: getOpenRouterChatModel(),
    };
  }

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return {
      provider: 'google' as const,
      model: google(process.env.GOOGLE_CHAT_MODEL || 'gemini-3-flash-preview'),
    };
  }

  if (process.env.CEREBRAS_API_KEY) {
    return {
      provider: 'cerebras' as const,
      model: cerebras(process.env.CEREBRAS_CHAT_MODEL || 'gpt-oss-120b'),
    };
  }

  throw new Error('No chat model provider configured. Set OPENROUTER_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, or CEREBRAS_API_KEY.');
}
