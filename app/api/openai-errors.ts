import { APIError } from 'openai';

type OpenAIErrorInfo = {
  error: string;
  status: number;
};

function getErrorStatus(err: unknown) {
  if (err instanceof APIError) return err.status;
  if (typeof err === 'object' && err && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    if (typeof status === 'number') return status;
  }
  return undefined;
}

export function formatOpenAIError(err: unknown, featureName: string, fallback: string): OpenAIErrorInfo {
  const status = getErrorStatus(err);
  const message = err instanceof Error ? err.message : '';

  if (message.includes('OPENAI_API_KEY')) {
    return {
      error: 'OPENAI_API_KEY가 서버에 설정되어 있지 않습니다.',
      status: 500,
    };
  }

  if (/exceeded.*quota|quota|billing|크레딧|할당량/i.test(message)) {
    return {
      error: `${featureName}에 필요한 OpenAI API 크레딧이 부족합니다. 이미지 분석은 OpenAI 비전 모델을 사용하므로, 크레딧을 충전하거나 결제/사용 한도를 확인한 뒤 다시 시도해 주세요.`,
      status: status && status >= 400 ? status : 429,
    };
  }

  if (status === 401) {
    return {
      error: `${featureName}에 사용하는 OpenAI API 키가 유효하지 않습니다. 서버 환경변수 OPENAI_API_KEY를 확인해 주세요.`,
      status,
    };
  }

  if (status === 429) {
    return {
      error: `${featureName}에 필요한 OpenAI API 크레딧이 부족합니다. OpenAI 결제/크레딧과 프로젝트 사용 한도를 확인해 주세요.`,
      status,
    };
  }

  return {
    error: message || fallback,
    status: status && status >= 400 ? status : 500,
  };
}
