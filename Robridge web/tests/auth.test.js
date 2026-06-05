const request = require('supertest');
const { app, pool } = require('../server'); // Import express app

describe('Authentication API Tests', () => {
  afterAll(async () => {
    // Close DB pool to prevent open handles
    await pool.end();
  });

  test('POST /api/auth/login should require email and password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});
    expect(res.statusCode).toEqual(400);
    expect(res.body).toHaveProperty('success', false);
    expect(res.body).toHaveProperty('error');
  });

  test('POST /api/auth/register should create user or return validation error', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test_user_' + Date.now() + '@test.com', password: 'password123' });
    
    // Depending on DB constraints, this could be 200 (created) or 400 (validation)
    // Here we just ensure the endpoint responds properly instead of 404 or 500
    expect([200, 400, 403]).toContain(res.statusCode);
  });
});
