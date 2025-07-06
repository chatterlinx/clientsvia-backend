const request = require('supertest');
const express = require('express');
const tradeCategoryRoutes = require('../routes/tradeCategories');
const { getDB } = require('../db');

jest.mock('../db');

describe('Trade Category Q&A Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/trade-categories', tradeCategoryRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/trade-categories/:categoryId/qas returns list', async () => {
    const mockDB = {
      collection: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue({
          commonQAs: [{ _id: 'qa1', question: 'Q', answer: 'A' }]
        })
      })
    };
    getDB.mockReturnValue(mockDB);

    const categoryId = '507f191e810c19729de860ea';
    const res = await request(app).get(`/api/trade-categories/${categoryId}/qas`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].question).toBe('Q');
  });

  test('GET /api/trade-categories/:categoryId/qas 404 when not found', async () => {
    const mockDB = {
      collection: jest.fn().mockReturnValue({
        findOne: jest.fn().mockResolvedValue(null)
      })
    };
    getDB.mockReturnValue(mockDB);

    const categoryId = '507f191e810c19729de860eb';
    const res = await request(app).get(`/api/trade-categories/${categoryId}/qas`);

    expect(res.status).toBe(404);
  });
});
