export type ElevenLabsVoiceId =
  | 'EXAVITQu4vr4xnSDxMaL'
  | 'iP95p4xoKVk53GoZ742B';

export type ElevenLabsVoiceOption = {
  id: ElevenLabsVoiceId;
  label: string;
};

export const DEFAULT_ELEVENLABS_VOICE_ID: ElevenLabsVoiceId = 'EXAVITQu4vr4xnSDxMaL';

export const ELEVENLABS_VOICE_OPTIONS: ElevenLabsVoiceOption[] = [
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    label: 'Sarah',
  },
  {
    id: 'iP95p4xoKVk53GoZ742B',
    label: 'Chris',
  },
];

export function isElevenLabsVoiceId(value: string): value is ElevenLabsVoiceId {
  return ELEVENLABS_VOICE_OPTIONS.some((voice) => voice.id === value);
}
