/**
 * Error cuyo mensaje está escrito para la persona y se puede mostrar tal cual. Cualquier otro error
 * (de la red, de una librería o de un dato inesperado) se responde con un mensaje genérico y el
 * detalle técnico queda sólo en los logs, sin datos personales.
 */
export class PublicError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicError";
  }
}
