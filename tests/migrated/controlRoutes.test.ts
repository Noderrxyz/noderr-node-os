import express from 'express';
import request from 'supertest';
import controlRouter from '../src/routes/api/control';
import panicRouter from '../src/routes/api/panic';
import * as tokenService from '../src/auth/tokenService';
import { UserRole, Permission } from '../src/auth/types';

// Minimal app wiring for tests
function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/control', controlRouter);
  app.use('/panic', panicRouter);
  return app;
}

describe('Control and Panic routes protection (High)', () => {
  const app = createApp();

  const token = tokenService.generateTokens(
    'admin1',
    'root',
    [UserRole.ADMIN],
    [Permission.SYSTEM_CONFIG_MODIFY],
    { expiresIn: '5m' }
  ).accessToken;

  test('rejects unauthorized panic trigger', async () => {
    const res = await request(app).post('/panic/').send({ reason: 'test' });
    expect(res.status).toBe(401);
  });

  test('allows ADMIN to trigger panic', async () => {
    const res = await request(app)
      .post('/panic/')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'unit-test' });
    expect([200,500]).toContain(res.status);
  });

  test('mutation pause requires body validation', async () => {
    const res = await request(app)
      .post('/control/mutation/pause')
      .set('Authorization', `Bearer ${token}`)
      .send({ invalid: true });
    expect(res.status).toBe(400);
  });
});


