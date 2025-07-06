const request = require('supertest');
const express = require('express');
jest.mock('../clients', () => ({ redisClient: {}, pinecone: {}, getPineconeIndex: jest.fn() }));
const companyRoutes = require('../routes/company');
const Company = require('../models/Company');

jest.mock('../models/Company');

describe('GET /api/companies', () => {
  it('responds with a list of companies', async () => {
    const mockCompanies = [{ companyName: 'Mock Co' }];
    Company.find.mockReturnValue({
      sort: jest.fn().mockResolvedValue(mockCompanies)
    });

    const app = express();
    app.use(express.json());
    app.use('/api', companyRoutes);

    const res = await request(app).get('/api/companies');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].companyName).toBe('Mock Co');
  });
});
