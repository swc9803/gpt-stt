export type ElevenLabsModelId =
  | 'eleven_flash_v2_5'
  | 'eleven_turbo_v2_5'
  | 'eleven_multilingual_v2'
  | 'eleven_v3';

export type ElevenLabsModelOption = {
  id: ElevenLabsModelId;
  label: string;
  detail: string;
};

export const DEFAULT_ELEVENLABS_MODEL_ID: ElevenLabsModelId = 'eleven_flash_v2_5';

export const ELEVENLABS_MODEL_OPTIONS: ElevenLabsModelOption[] = [
  {
    id: 'eleven_flash_v2_5',
    label: 'Flash v2.5',
    detail: '무료 플랜 포함, 빠른 대화용',
  },
  {
    id: 'eleven_turbo_v2_5',
    label: 'Turbo v2.5',
    detail: '무료 플랜 포함, 속도와 품질 균형',
  },
  {
    id: 'eleven_multilingual_v2',
    label: 'Multilingual v2',
    detail: '무료 플랜 포함, 자연스러운 한국어',
  },
  {
    id: 'eleven_v3',
    label: 'Eleven v3',
    detail: '무료 플랜 포함, 표현력 높은 음성',
  },
];

export function isElevenLabsModelId(value: string): value is ElevenLabsModelId {
  return ELEVENLABS_MODEL_OPTIONS.some((model) => model.id === value);
}
