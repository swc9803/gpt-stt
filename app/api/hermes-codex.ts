import { execFile } from 'node:child_process';

const DEFAULT_CODEX_MODEL = 'gpt-5.5';
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_OUTPUT_BUFFER = 1024 * 1024;

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function cleanHermesOutput(stdout: string) {
  return stdout
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim();
      if (/^Session ID:/i.test(trimmed)) return false;
      if (/tirith security scanner/i.test(trimmed)) return false;
      return true;
    })
    .join('\n')
    .trim();
}

function buildGptSttPrompt(message: string) {
  return [
    '너는 gpt-stt라는 이름의 한국어 음성비서다.',
    '항상 정중한 존댓말로 답한다.',
    '평소 답변은 아주 쉽고 짧게 한다.',
    '간단한 질문은 가능하면 1~3문장으로 말한다.',
    '사용자가 자세히 알려 달라고 하면 이전 답을 반복하지 말고 필요한 재료, 순서, 주의점을 더 구체적으로 알려준다.',
    '최근 대화가 포함되어 있으면 같은 주제의 후속 질문을 이해하는 데 사용하되, 새 주제는 이전 대화에 억지로 연결하지 않는다.',
    '어려운 단어를 피하고, 단계가 필요하면 번호를 붙인다.',
    '질문이 애매해서 확실한 답을 하면 틀릴 수 있을 때는 추측하지 말고, 애매한 부분만 짧게 다시 질문한다.',
    '명확한 부분은 반복해서 묻지 말고, 부족한 정보 1가지만 물어본다.',
    '의료, 금융, 법률처럼 중요한 결정은 가족이나 전문가에게 확인하라고 말한다.',
    '최신 정보, 가격, 상품, 쇼핑몰, 음식점, 여행지, 볼거리, 영업시간, 위치, 후기처럼 바뀔 수 있는 내용은 가능한 도구로 웹을 확인한다.',
    '상품 질문은 여러 쇼핑몰이나 판매처를 비교하고, 음식점이나 볼거리 질문은 공식/지도/예약 링크를 포함한다.',
    '링크는 화면에 보이도록 남기되, 사용자가 음성으로 듣기에도 자연스럽게 링크를 읽지 않아도 이해되는 답으로 쓴다.',
    '아래 질문에 대한 최종 답변만 출력한다.',
    '',
    `질문: ${message}`,
  ].join('\n');
}

export async function createHermesCodexAnswer(message: string) {
  const hermesBin = process.env.HERMES_BIN || 'hermes';
  const provider = process.env.HERMES_CODEX_PROVIDER || 'openai-codex';
  const model = process.env.HERMES_CODEX_MODEL || DEFAULT_CODEX_MODEL;
  const toolsets = process.env.HERMES_CODEX_TOOLSETS || 'safe';
  const timeout = envNumber('HERMES_CODEX_TIMEOUT_MS', DEFAULT_TIMEOUT_MS);
  const maxTurns = String(envNumber('HERMES_CODEX_MAX_TURNS', 1));

  const args = [
    'chat',
    '-Q',
    '--ignore-rules',
    '--source',
    'gpt-stt-pwa',
    '--provider',
    provider,
    '-m',
    model,
    '-t',
    toolsets,
    '--max-turns',
    maxTurns,
    '-q',
    buildGptSttPrompt(message),
  ];

  return new Promise<string>((resolve, reject) => {
    execFile(
      hermesBin,
      args,
      {
        timeout,
        maxBuffer: MAX_OUTPUT_BUFFER,
        env: {
          ...process.env,
          HERMES_ACCEPT_HOOKS: process.env.HERMES_ACCEPT_HOOKS || '1',
        },
      },
      (error, stdout, stderr) => {
        if (error) {
          const details = String(stderr || stdout || error.message || '').trim();
          reject(new Error(details || 'Hermes Codex 호출에 실패했습니다.'));
          return;
        }

        const answer = cleanHermesOutput(stdout);
        if (!answer) {
          reject(new Error('Hermes Codex가 빈 답변을 반환했습니다.'));
          return;
        }

        resolve(answer);
      },
    );
  });
}
