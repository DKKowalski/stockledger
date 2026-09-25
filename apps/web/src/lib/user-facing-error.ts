import { ApiError } from '../api';

export type UserFacingError = {
  label: string;
  title: string;
  description: string;
  requestId?: string;
};

export function workspaceError(error: unknown): UserFacingError {
  if (error instanceof ApiError && error.status === 403) {
    return {
      label: 'Access unavailable',
      title: 'This workspace is not available to your account.',
      description: 'Ask the business owner to check that your account is active and has access.',
      requestId: error.requestId,
    };
  }

  if (error instanceof ApiError && error.status === 429) {
    return {
      label: 'Please wait',
      title: 'Too many requests reached StockLedger at once.',
      description: 'Wait a minute, then try opening your workspace again.',
      requestId: error.requestId,
    };
  }

  if (error instanceof ApiError && error.status >= 500) {
    return {
      label: 'Temporary problem',
      title: 'Your workspace did not load.',
      description: 'We could not reach your inventory right now. Nothing was changed. Try again in a moment.',
      requestId: error.requestId,
    };
  }

  if (error instanceof TypeError) {
    return {
      label: 'Connection problem',
      title: 'StockLedger is out of reach.',
      description: 'Check your internet connection, then try opening your workspace again.',
    };
  }

  return {
    label: 'Could not load',
    title: 'Your workspace did not load.',
    description: 'Nothing was changed. Try again, or sign out if you need to use another account.',
    requestId: error instanceof ApiError ? error.requestId : undefined,
  };
}

export function safeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status >= 500) return fallback;
  if (error instanceof TypeError) return 'Check your connection and try again.';
  return error instanceof Error ? error.message : fallback;
}
