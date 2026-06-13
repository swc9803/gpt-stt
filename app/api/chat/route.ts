import { NextResponse } from 'next/server';
import type { ResponseInput } from 'openai/resources/responses/responses';
import { createHermesCodexAnswer } from '../hermes-codex';
import { formatOpenAIError } from '../openai-errors';
import { getOpenAI } from '../openai';

export const runtime = 'nodejs';

type ChatContextItem = { question?: string; answer?: string };
type ChatImage = { name?: string; dataUrl?: string };
type ChatRequest = { message?: string; history?: ChatContextItem[]; stream?: boolean; images?: ChatImage[] };

type ChatProvider = 'openai' | 'hermes-codex';
type ChatStreamEvent =
  | { type: 'delta'; delta: string }
  | { type: 'done'; answer: string }
  | { type: 'error'; error: string };
type StockMatch = { name: string; yahooSymbol: string; displayCode?: string };
type YahooChartMeta = {
  symbol?: string;
  currency?: string;
  regularMarketPrice?: number;
  chartPreviousClose?: number;
  previousClose?: number;
  regularMarketTime?: number;
  exchangeName?: string;
};
type YahooChartResponse = {
  chart?: {
    result?: Array<{
      meta?: YahooChartMeta;
    }>;
    error?: {
      description?: string;
    } | null;
  };
};

const REFERENCE_TOPIC_PATTERN = /(가격|얼마|시세|최저가|구매|판매|상품|쇼핑|배송|브랜드|용량|텀블러|스탠리|스타벅스|다이소|쿠팡|네이버)/u;
const URL_PATTERN = /https?:\/\/|\]\(https?:\/\//;
const STOCK_QUESTION_PATTERN = /(주가|현재가|시세|종가|상승|하락|등락|코스피|코스닥|나스닥|주식|stock|price)/iu;
const KOREAN_STOCKS: StockMatch[] = [
  { name: '삼성전자우', yahooSymbol: '005935.KS', displayCode: '005935' },
  { name: '삼성전자', yahooSymbol: '005930.KS', displayCode: '005930' },
  { name: 'sk하이닉스', yahooSymbol: '000660.KS', displayCode: '000660' },
  { name: '에스케이하이닉스', yahooSymbol: '000660.KS', displayCode: '000660' },
  { name: '현대차', yahooSymbol: '005380.KS', displayCode: '005380' },
  { name: '기아', yahooSymbol: '000270.KS', displayCode: '000270' },
  { name: 'lg에너지솔루션', yahooSymbol: '373220.KS', displayCode: '373220' },
  { name: '엘지에너지솔루션', yahooSymbol: '373220.KS', displayCode: '373220' },
  { name: 'naver', yahooSymbol: '035420.KS', displayCode: '035420' },
  { name: '네이버', yahooSymbol: '035420.KS', displayCode: '035420' },
  { name: '카카오', yahooSymbol: '035720.KS', displayCode: '035720' },
  { name: '셀트리온', yahooSymbol: '068270.KS', displayCode: '068270' },
  { name: 'posco홀딩스', yahooSymbol: '005490.KS', displayCode: '005490' },
  { name: '포스코홀딩스', yahooSymbol: '005490.KS', displayCode: '005490' },
  { name: 'kb금융', yahooSymbol: '105560.KS', displayCode: '105560' },
  { name: '신한지주', yahooSymbol: '055550.KS', displayCode: '055550' },
  { name: '현대모비스', yahooSymbol: '012330.KS', displayCode: '012330' },
  { name: '삼성바이오로직스', yahooSymbol: '207940.KS', displayCode: '207940' },
  { name: 'lg화학', yahooSymbol: '051910.KS', displayCode: '051910' },
];

function getChatProvider(): ChatProvider {
  const provider = (process.env.CHAT_PROVIDER || process.env.AI_CHAT_PROVIDER || 'openai').toLowerCase();
  if (provider === 'hermes-codex' || provider === 'codex') return 'hermes-codex';
  return 'openai';
}

function buildMessageWithHistory(message: string, history: ChatContextItem[]) {
  const recent = history
    .slice(-4)
    .map((item, index) => {
      const question = String(item.question || '').trim();
      const answer = String(item.answer || '').trim();
      if (!question && !answer) return '';
      return [`[${index + 1}] 사용자: ${question}`, `답변: ${answer}`].join('\n');
    })
    .filter(Boolean)
    .join('\n\n');

  if (!recent) return message;
  return [
    '아래는 현재 질문과 같은 주제의 최근 대화입니다.',
    '짧은 후속 질문이면 최근 대화를 이어서 이해하고, 새 지시가 있으면 현재 질문을 우선합니다.',
    '',
    recent,
    '',
    `현재 질문: ${message}`,
  ].join('\n');
}

function getAnswerInstructions() {
  return [
    '너는 gpt-stt라는 이름의 한국어 음성비서다.',
    '항상 정중한 존댓말로 답한다.',
    '답변은 성인에게 말하듯 자연스럽고 분명하게 한다.',
    '간단한 질문은 짧게 답하되, 가격/상품/장소처럼 정보가 필요한 질문은 너무 짧게 끝내지 않는다.',
    '가격이나 상품 질문은 보통 가격대, 가격이 달라지는 기준, 구매/확인 링크를 함께 준다.',
    '브랜드나 용량이 부족해도 먼저 일반적인 가격대와 확인 방법을 알려준 뒤, 더 정확한 조건 1가지를 물어본다.',
    '사용자가 자세히 알려 달라고 하면 이전 답을 반복하지 말고 필요한 재료, 순서, 주의점을 더 구체적으로 알려준다.',
    '최근 대화가 있으면 같은 주제의 후속 질문을 이해하는 데 사용하되, 새 주제는 이전 대화에 억지로 연결하지 않는다.',
    '불필요하게 유치하거나 과하게 쉬운 표현은 피하고, 전문 용어가 필요하면 짧게 풀어 설명한다.',
    '질문이 애매해서 확실한 답을 하면 틀릴 수 있을 때는 추측하지 말고, 애매한 부분만 짧게 다시 질문한다.',
    '명확한 부분은 반복해서 묻지 말고, 부족한 정보 1가지만 물어본다.',
    '의료, 금융, 법률처럼 중요한 결정은 가족이나 전문가에게 확인하라고 말한다.',
    '최신 정보, 가격, 상품, 쇼핑몰, 음식점, 여행지, 볼거리, 영업시간, 위치, 후기, 예약 가능성처럼 바뀔 수 있는 내용은 웹 검색을 사용해서 확인한다.',
    '상품을 찾을 때는 가능하면 여러 판매처나 쇼핑몰을 비교하고, 가격/배송/구매 링크를 함께 준다.',
    '음식점이나 볼거리를 찾을 때는 위치, 특징, 방문 팁, 공식 페이지나 지도/예약 링크를 함께 준다.',
    '링크는 화면에 볼 수 있도록 URL이나 Markdown 링크로 남기되, 답변 문장 자체는 링크를 읽어야 이해되는 식으로 만들지 않는다.',
  ].join('\n');
}

function stripHistoryLabels(text: string) {
  return text
    .replace(/\[[0-9]+\] 사용자:/g, ' ')
    .replace(/현재 질문:/g, ' ')
    .replace(/답변:/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getSearchQuery(originalMessage: string, history: ChatContextItem[]) {
  const recentQuestion = String(history.at(-1)?.question || '').trim();
  const combined = [recentQuestion, originalMessage]
    .filter(Boolean)
    .join(' ')
    .replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return combined || stripHistoryLabels(originalMessage) || originalMessage;
}

function getReferenceLinks(originalMessage: string, history: ChatContextItem[], answer: string) {
  const combined = `${history.map((item) => item.question || '').join(' ')} ${originalMessage}`;
  if (!REFERENCE_TOPIC_PATTERN.test(combined)) return '';
  if (URL_PATTERN.test(answer)) return '';

  const query = getSearchQuery(originalMessage, history);
  if (!query) return '';
  const encodedQuery = encodeURIComponent(query);

  return [
    '',
    '',
    '참고 링크:',
    `- [네이버 쇼핑 검색](https://search.shopping.naver.com/search/all?query=${encodedQuery})`,
    `- [구글 검색](https://www.google.com/search?q=${encodedQuery})`,
  ].join('\n');
}

function getOpenAIChatModel() {
  return process.env.OPENAI_CHAT_MODEL || 'gpt-4.1-mini';
}

function normalizeStockQuery(value: string) {
  return value.toLowerCase().replace(/\s+/g, '').trim();
}

function findStockMatch(message: string): StockMatch | undefined {
  if (!STOCK_QUESTION_PATTERN.test(message)) return undefined;

  const normalized = normalizeStockQuery(message);
  const namedMatch = KOREAN_STOCKS.find((stock) => normalized.includes(normalizeStockQuery(stock.name)));
  if (namedMatch) return namedMatch;

  const codeMatch = message.match(/\b\d{6}\b/);
  if (codeMatch) {
    return {
      name: `${codeMatch[0]} 종목`,
      yahooSymbol: `${codeMatch[0]}.KS`,
      displayCode: codeMatch[0],
    };
  }

  return undefined;
}

function formatPrice(value: number, currency?: string) {
  if (currency === 'KRW') return `${Math.round(value).toLocaleString('ko-KR')}원`;
  if (currency === 'USD') return `$${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return `${value.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`;
}

function formatChange(value: number, currency?: string) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${formatPrice(value, currency)}`;
}

function formatMarketTime(unixSeconds?: number) {
  if (!unixSeconds) return '기준 시간 확인 불가';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(unixSeconds * 1000));
}

async function fetchYahooChart(symbol: string): Promise<YahooChartMeta | undefined> {
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m`, {
    headers: {
      accept: 'application/json',
      'user-agent': 'gpt-stt/1.0',
    },
    cache: 'no-store',
  });
  if (!response.ok) return undefined;

  const data = (await response.json()) as YahooChartResponse;
  return data.chart?.result?.[0]?.meta;
}

async function createStockAnswer(message: string) {
  const stock = findStockMatch(message);
  if (!stock) return '';

  const meta = await fetchYahooChart(stock.yahooSymbol);
  const price = meta?.regularMarketPrice;
  const previousClose = meta?.chartPreviousClose ?? meta?.previousClose;
  if (typeof price !== 'number') return '';

  const currency = meta?.currency;
  const change = typeof previousClose === 'number' ? price - previousClose : undefined;
  const changeRate = typeof previousClose === 'number' && previousClose !== 0
    ? (change! / previousClose) * 100
    : undefined;
  const direction = typeof change === 'number'
    ? change > 0
      ? '상승'
      : change < 0
        ? '하락'
        : '보합'
    : '등락 확인 불가';
  const codeText = stock.displayCode ? `(${stock.displayCode})` : `(${stock.yahooSymbol})`;
  const changeText = typeof change === 'number' && typeof changeRate === 'number'
    ? `${formatChange(change, currency)} / ${changeRate >= 0 ? '+' : ''}${changeRate.toFixed(2)}% ${direction}`
    : '전일 대비 정보 확인 불가';

  return [
    `${stock.name} ${codeText} 현재가는 ${formatPrice(price, currency)}입니다.`,
    `전일 대비 ${changeText}입니다.`,
    `기준 시각은 ${formatMarketTime(meta?.regularMarketTime)}이며, 데이터 출처는 Yahoo Finance입니다.`,
    '',
    '실시간 시세는 지연되거나 거래소 기준과 차이가 있을 수 있어요. 투자 판단은 증권사/거래소 시세로 한 번 더 확인해 주세요.',
  ].join('\n');
}

async function createOpenAIAnswer(message: string, images: string[] = []) {
  const openai = getOpenAI();
  const response = await openai.responses.create({
    model: getOpenAIChatModel(),
    instructions: getAnswerInstructions(),
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    input: buildOpenAIInput(message, images),
    max_output_tokens: 450,
  });

  return response.output_text.trim();
}

function isSupportedImageDataUrl(dataUrl: string) {
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(dataUrl)
    && dataUrl.length <= 14 * 1024 * 1024;
}

function normalizeImages(images: ChatImage[]) {
  return images
    .map((image) => String(image.dataUrl || '').trim())
    .filter(isSupportedImageDataUrl)
    .slice(0, 5);
}

function buildOpenAIInput(message: string, images: string[] = []): string | ResponseInput {
  if (images.length === 0) return message;

  return [{
    type: 'message',
    role: 'user',
    content: [
      { type: 'input_text', text: message },
      ...images.map((imageUrl) => ({
        type: 'input_image' as const,
        image_url: imageUrl,
        detail: 'auto' as const,
      })),
    ],
  }];
}

async function createOpenAIAnswerStream(message: string, images: string[], onDelta: (delta: string) => void) {
  const openai = getOpenAI();
  const stream = await openai.responses.create({
    model: getOpenAIChatModel(),
    instructions: getAnswerInstructions(),
    tools: [{ type: 'web_search' }],
    tool_choice: 'auto',
    input: buildOpenAIInput(message, images),
    max_output_tokens: 650,
    stream: true,
  });
  let answer = '';

  for await (const event of stream) {
    if (event.type === 'response.output_text.delta') {
      const delta = event.delta || '';
      answer += delta;
      onDelta(delta);
    }

    if (event.type === 'error') {
      throw new Error(event.message || '답변 생성 중 오류가 발생했습니다.');
    }
  }

  return answer.trim();
}

function encodeChatStreamEvent(event: ChatStreamEvent) {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function createChatStream(message: string, originalMessage: string, history: ChatContextItem[], images: string[]) {
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let answer = '';

      try {
        const stockAnswer = images.length === 0 ? await createStockAnswer(originalMessage) : '';
        if (stockAnswer) {
          controller.enqueue(encodeChatStreamEvent({ type: 'delta', delta: stockAnswer }));
          controller.enqueue(encodeChatStreamEvent({ type: 'done', answer: stockAnswer }));
          return;
        }

        if (getChatProvider() === 'hermes-codex' && images.length === 0) {
          answer = await createHermesCodexAnswer(message);
          controller.enqueue(encodeChatStreamEvent({ type: 'delta', delta: answer }));
        } else {
          answer = await createOpenAIAnswerStream(message, images, (delta) => {
            controller.enqueue(encodeChatStreamEvent({ type: 'delta', delta }));
          });
        }

        const referenceLinks = getReferenceLinks(originalMessage, history, answer);
        if (referenceLinks) {
          answer += referenceLinks;
          controller.enqueue(encodeChatStreamEvent({ type: 'delta', delta: referenceLinks }));
        }

        controller.enqueue(encodeChatStreamEvent({ type: 'done', answer }));
      } catch (err) {
        const { error } = formatOpenAIError(err, images.length > 0 ? '이미지 답변 생성' : '답변 생성', '답변 생성 서버 오류가 발생했습니다.');
        controller.enqueue(encodeChatStreamEvent({ type: 'error', error }));
      } finally {
        controller.close();
      }
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatRequest;
    const message = String(body.message || '').trim();
    const history = Array.isArray(body.history) ? body.history : [];
    const images = normalizeImages(Array.isArray(body.images) ? body.images : []);
    if (!message) {
      return NextResponse.json({ error: '질문이 비어 있습니다.' }, { status: 400 });
    }

    if (body.stream) {
      const messageWithHistory = buildMessageWithHistory(message, history);
      return new Response(createChatStream(messageWithHistory, message, history, images), {
        headers: {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    const messageWithHistory = buildMessageWithHistory(message, history);
    const stockAnswer = images.length === 0 ? await createStockAnswer(message) : '';
    let answer = stockAnswer || (getChatProvider() === 'hermes-codex' && images.length === 0
      ? await createHermesCodexAnswer(messageWithHistory)
      : await createOpenAIAnswer(messageWithHistory, images));
    answer += getReferenceLinks(message, history, answer);

    return NextResponse.json({ answer });
  } catch (err) {
    const { error, status } = formatOpenAIError(err, '답변 생성', '답변 생성 서버 오류가 발생했습니다.');
    return NextResponse.json({ error }, { status });
  }
}
