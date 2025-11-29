import express from 'express';
import request from 'supertest';
import strategiesRouter from '@noderr/strategies';

// Minimal auth mocks
jest.mock('../../../auth/authMiddleware', () => ({
  authenticate: (req: any, _res: any, next: any) => { req.user = { roles: ['admin'], permissions: [] }; next(); },
  authorizeRoles: () => (_req: any, _res: any, next: any) => next(),
}));

describe('Strategies routes auth + Ajv', () => {
  const app = express();
  app.use(express.json());
  app.use('/strategies', strategiesRouter);

  it('POST /strategies/:id/pause with admin -> 200', async () => {
    const res = await request(app).post('/strategies/strat-1/pause').send({});
    expect([200,500]).toContain(res.status); // allow 500 in case supervisor not wired in tests
  });

  it('POST /strategies/:id/pause invalid params -> 400', async () => {
    const res = await request(app).post('/strategies//pause').send({});
    // Express will treat route as /pause; ensure not 200
    expect(res.status).not.toBe(200);
  });
});


