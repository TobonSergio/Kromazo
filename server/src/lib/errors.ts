/** Error de negocio con código HTTP y mensaje seguro para mostrar al usuario. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'BAD_REQUEST') => new AppError(400, code, message);
export const unauthorized = (message = 'Debes iniciar sesión.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'No tienes permiso para esta acción.') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'No encontrado.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);
