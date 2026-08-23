export class RmsSessionMissingError extends Error {
  constructor() {
    super('尚未登录');
    this.name = 'RmsSessionMissingError';
  }
}
