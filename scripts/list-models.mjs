#!/usr/bin/env node
import OpenAI from 'openai';

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('OPENAI_API_KEY가 설정되어 있지 않아.');
  console.error('먼저 .env.local을 만들고 export로 불러오거나, 아래처럼 실행해:');
  console.error('OPENAI_API_KEY=sk-... npm run models');
  process.exit(1);
}

const openai = new OpenAI({ apiKey });
const models = await openai.models.list();
const keyword = (process.argv[2] || '').toLowerCase();
const ids = models.data
  .map((model) => model.id)
  .filter((id) => !keyword || id.toLowerCase().includes(keyword))
  .sort();

if (!ids.length) {
  console.log(keyword ? `"${keyword}"가 들어간 모델을 못 찾았어.` : '모델 목록이 비어 있어.');
  process.exit(0);
}

for (const id of ids) console.log(id);
