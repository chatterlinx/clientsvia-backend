jest.mock('../../services/llmRegistry', () => ({
  callLLM0: jest.fn()
}));

const { callLLM0 } = require('../../services/llmRegistry');

function mockLLMOnce(content, usage = { total_tokens: 25 }) {
  callLLM0.mockResolvedValueOnce({
    choices: [{ message: { content } }],
    usage
  });
  return callLLM0;
}

function mockLLMWith(impl) {
  callLLM0.mockImplementation(impl);
  return callLLM0;
}

function resetLLM() {
  callLLM0.mockReset();
}

module.exports = {
  callLLM0,
  mockLLMOnce,
  mockLLMWith,
  resetLLM
};
