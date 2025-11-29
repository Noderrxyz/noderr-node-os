import * as tokenService from '../src/auth/tokenService';

describe('tokenService JWT secrets (High)', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    jest.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('throws when secrets missing in non-test env (Critical)', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    delete process.env.JWT_REFRESH_SECRET;
    expect(() => require('../src/auth/tokenService')).toThrow(/JWT configuration error/);
  });

  test('uses EFFECTIVE_JWT_SECRET for sign/verify', () => {
    process.env.NODE_ENV = 'test';
    const { generateTokens, verifyToken } = tokenService;
    const { accessToken } = generateTokens('u1', 'alice', [], [], { expiresIn: '5m' });
    const result = verifyToken(accessToken);
    expect(result.valid).toBe(true);
    expect(result.payload?.sub).toBe('u1');
  });
});


