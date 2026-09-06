import { CASErrorCode } from '@cas/shared';

// Application errors are always surfaced to the UI as plain language with a
// suggested next step — never as raw stack traces or provider status codes.
export class AppError extends Error {
  code: CASErrorCode;
  status: number;
  userMessage: string;
  suggestion?: string;
  cause?: unknown;

  constructor(opts: {
    code: CASErrorCode;
    status?: number;
    message?: string;
    userMessage?: string;
    suggestion?: string;
    cause?: unknown;
  }) {
    super(opts.message ?? opts.userMessage ?? opts.code);
    this.code = opts.code;
    this.status = opts.status ?? 500;
    this.userMessage = opts.userMessage ?? opts.message ?? 'Something went wrong.';
    this.suggestion = opts.suggestion;
    this.cause = opts.cause;
  }

  static badRequest(message: string, suggestion?: string) {
    return new AppError({ code: 'BAD_REQUEST', status: 400, userMessage: message, suggestion });
  }
  static notFound(message = 'Not found') {
    return new AppError({ code: 'NOT_FOUND', status: 404, userMessage: message });
  }
  static unauthorized(message = 'Please sign in to continue.') {
    return new AppError({ code: 'UNAUTHORIZED', status: 401, userMessage: message });
  }
  static conflict(message: string) {
    return new AppError({ code: 'CONFLICT', status: 409, userMessage: message });
  }
  static internal(message = 'An unexpected error occurred.', cause?: unknown) {
    return new AppError({ code: 'INTERNAL', status: 500, userMessage: message, cause });
  }
}

export function asAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return AppError.internal(message, err);
}
