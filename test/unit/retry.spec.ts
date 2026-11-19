import { withRetry } from '../../src/common/resilience/retry';

describe('withRetry', () => {
  const noSleep = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => noSleep.mockClear());

  it('reintenta un fallo transitorio y devuelve el resultado', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce('ok');

    await expect(
      withRetry(fn, { retries: 2, baseDelayMs: 100, sleep: noSleep }),
    ).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('se rinde después de agotar los reintentos', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('down'));

    await expect(
      withRetry(fn, { retries: 2, baseDelayMs: 100, sleep: noSleep }),
    ).rejects.toThrow('down');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('no reintenta errores no transitorios', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('400 bad request'));

    await expect(
      withRetry(fn, {
        retries: 2,
        baseDelayMs: 100,
        sleep: noSleep,
        shouldRetry: () => false,
      }),
    ).rejects.toThrow('400');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('aplica backoff exponencial entre intentos', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    const fn = jest.fn().mockRejectedValue(new Error('down'));

    await expect(
      withRetry(fn, { retries: 3, baseDelayMs: 100, sleep: noSleep }),
    ).rejects.toThrow();

    expect(noSleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200, 400]);
    jest.restoreAllMocks();
  });
});
