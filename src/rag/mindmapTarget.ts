import type { WholeBookAiState } from './types';
import type { MindMapStatus } from './mindmapTypes';

export function resolveMindMapBookId(
  _localLibraryId: string,
  wholeBookAi: Pick<WholeBookAiState, 'cloudBookId'>,
): string | null {
  const cloudBookId = wholeBookAi.cloudBookId?.trim();
  return cloudBookId ? cloudBookId : null;
}

export function shouldStartMindMapGeneration(
  currentStatus: MindMapStatus,
  forceGenerate: boolean,
): boolean {
  if (forceGenerate && currentStatus === 'failed') {
    return true;
  }

  return currentStatus === 'pending' || currentStatus === 'generating';
}
