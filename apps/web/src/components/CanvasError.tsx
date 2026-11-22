import { ErrorState } from './ui';
import { ApiError } from '../api';

// Canvas commands accept IDs/enums only (apart from the environment slug).
// Do not dump arbitrary error details or resource records.
export function CanvasError({ error }: { error: unknown }) {
  if (!error) return null;
  return <ErrorState>{error instanceof ApiError
    ? `HTTP ${error.status} / ${error.code}: ${error.message}`
    : '操作に失敗しました。接続を確認して再試行してください。'}</ErrorState>;
}
