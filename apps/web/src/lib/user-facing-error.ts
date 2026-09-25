import { ApiError } from '../api';

export type UserFacingError = {
  title: string;
  description: string;
};

export function workspaceError(error: unknown): UserFacingError {
  if (error instanceof ApiError && error.status === 403) {
    return {
      title: "You can't open this workspace.",
      description: 'Ask the owner to check your access.',
    };
  }

  if (error instanceof ApiError && error.status === 429) {
    return {
      title: 'Try again in a minute.',
      description: 'StockLedger is busy right now.',
    };
  }

  if (error instanceof ApiError && error.status >= 500) {
    return {
      title: "We couldn't open your workspace.",
      description: 'Try again in a moment.',
    };
  }

  if (error instanceof TypeError) {
    return {
      title: "You're offline.",
      description: 'Check your connection and try again.',
    };
  }

  return {
    title: "We couldn't open your workspace.",
    description: 'Try again in a moment.',
  };
}

export function safeErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status >= 500) return fallback;
  if (error instanceof TypeError) return 'Check your connection and try again.';
  return error instanceof Error ? error.message : fallback;
}
