// This file contains setup code for Jest tests

// Mock timers for testing
// jest.useFakeTimers();

// Reset all mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Restore real timers after all tests
afterAll(() => {
  jest.useRealTimers();
});
