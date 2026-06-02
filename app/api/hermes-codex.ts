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
    '답변은 아주 쉽고 짧게 한다.',
    '가능하면 1~3문장으로 말한다.',
    '어려운 단어를 피하고, 단계가 필요하면 번호를 붙인다.',
    '의료, 금융, 법률처럼 중요한 결정은 가족이나 전문가에게 확인하라고 말한다.',
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
