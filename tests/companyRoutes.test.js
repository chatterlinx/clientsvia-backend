const request = require('supertest');
const express = require('express');
jest.mock('../clients', () => ({ redisClient: {}, pinecone: {}, getPineconeIndex: jest.fn() }));
const companyRoutes = require('../routes/company');
const { getDB } = require('../db');

jest.mock('../db');

describe('GET /api/companies', () => {
  it('responds with a list of companies', async () => {
    const mockDB = {
      collection: jest.fn().mockReturnValue({
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([{ companyName: 'Mock Co' }])
          })
        })
      })
    };
    getDB.mockReturnValue(mockDB);

    const app = express();
    app.use(express.json());
    app.use('/api', companyRoutes);

    const res = await request(app).get('/api/companies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].companyName).toBe('Mock Co');
  });
});
