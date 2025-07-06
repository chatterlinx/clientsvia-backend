const request = require('supertest');
const express = require('express');

jest.mock('../clients', () => ({
  redisClient: { get: jest.fn(), setEx: jest.fn(), del: jest.fn() },
  pinecone: {},
  getPineconeIndex: jest.fn()
}));
const companyRoutes = require('../routes/company');
const { getDB } = require('../db');

jest.mock('../db');

describe('Personality Responses Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api', companyRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/company/:id/personality-responses returns responses', async () => {
    const mockCollection = {
      findOne: jest.fn().mockResolvedValue({ personalityResponses: { cantUnderstand: ['hi'] } })
    };
    const mockDB = { collection: jest.fn().mockReturnValue(mockCollection) };
    getDB.mockReturnValue(mockDB);

    const res = await request(app).get('/api/company/507f191e810c19729de860aa/personality-responses');
    expect(res.status).toBe(200);
    expect(res.body.cantUnderstand).toEqual(['hi']);
  });

  test('PATCH /api/company/:id/personality-responses updates responses', async () => {
    const mockCollection = {
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1 }),
      findOne: jest.fn().mockResolvedValue({ personalityResponses: { cantUnderstand: ['bye'] } })
    };
    const mockDB = { collection: jest.fn().mockReturnValue(mockCollection) };
    getDB.mockReturnValue(mockDB);

    const res = await request(app)
      .patch('/api/company/507f191e810c19729de860aa/personality-responses')
      .send({ personalityResponses: { cantUnderstand: ['bye'] } });
    expect(res.status).toBe(200);
    expect(res.body.personalityResponses.cantUnderstand).toEqual(['bye']);
    expect(mockCollection.updateOne).toHaveBeenCalled();
  });
});
