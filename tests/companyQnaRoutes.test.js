const request = require('supertest');
const express = require('express');

const companyQnaRoutes = require('../routes/companyQna');
const KnowledgeEntry = require('../models/KnowledgeEntry');

jest.mock('../models/KnowledgeEntry');

describe('Company QnA Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/company/:companyId/qna', companyQnaRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('GET /api/company/:companyId/qna returns list', async () => {
    const companyId = '507f191e810c19729de860aa';
    KnowledgeEntry.find.mockReturnValue({
      sort: jest.fn().mockResolvedValue([{ _id: '1', question: 'Q', answer: 'A', keywords: ['k'] }])
    });

    const res = await request(app).get(`/api/company/${companyId}/qna`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].question).toBe('Q');
    expect(res.body[0].keywords).toEqual(['k']);
  });

  test('POST /api/company/:companyId/qna creates entry', async () => {
    const companyId = '507f191e810c19729de860ab';
    KnowledgeEntry.create.mockResolvedValue({});
    KnowledgeEntry.find.mockReturnValue({
      sort: jest.fn().mockResolvedValue([
        { _id: '1', question: 'Q', answer: 'A', category: 'General', keywords: ['one','two'] }
      ])
    });

    const res = await request(app)
      .post(`/api/company/${companyId}/qna`)
      .send({ question: 'Q', answer: 'A', keywords: ['one','two'] });

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].answer).toBe('A');
    expect(KnowledgeEntry.create).toHaveBeenCalledWith({ companyId, question: 'Q', answer: 'A', category: 'General', keywords: ['one','two'] });
  });
});
