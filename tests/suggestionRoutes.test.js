const request = require('supertest');
const express = require('express');
const suggestionRoutes = require('../routes/suggestions');
const Suggestion = require('../models/SuggestedKnowledgeEntry');
const KnowledgeEntry = require('../models/KnowledgeEntry');

jest.mock('../models/SuggestedKnowledgeEntry');
jest.mock('../models/KnowledgeEntry');

describe('Suggestion Routes', () => {
  const app = express();
  app.use(express.json());
  app.use('/api/suggestions', suggestionRoutes);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('POST /api/suggestions creates suggestion', async () => {
    const mock = { _id: '507f191e810c19729de860aa', question: 'hello?', suggestedAnswer: 'hi', category: 'gen' };
    Suggestion.prototype.save = jest.fn().mockResolvedValue(mock);
    const res = await request(app)
      .post('/api/suggestions')
      .send({ question: 'hello?', suggestedAnswer: 'hi' });
    expect(res.status).toBe(201);
  });

  test('POST /api/suggestions/:id/approve creates KB entry', async () => {
    const id = '507f191e810c19729de860ab';
    const mockSuggestion = { _id: id, question: 'ok?', suggestedAnswer: 'sure' };
    Suggestion.findById.mockResolvedValue(mockSuggestion);
    KnowledgeEntry.prototype.save = jest.fn().mockResolvedValue({});
    Suggestion.findByIdAndDelete.mockResolvedValue();
    const res = await request(app)
      .post(`/api/suggestions/${id}/approve`)
      .send();
    expect(res.status).toBe(201);
    expect(Suggestion.findById).toHaveBeenCalledWith(id);
    expect(Suggestion.findByIdAndDelete).toHaveBeenCalledWith(id);
    expect(KnowledgeEntry.prototype.save).toHaveBeenCalledTimes(1);
  });
});
