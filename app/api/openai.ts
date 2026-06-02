import OpenAI from 'openai';

export function getOpenAI() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY가 서버에 설정되어 있지 않아.');
  }
  return new OpenAI({ apiKey });
}
