import { WaveSpeed, Prediction, RequestOptions } from '../src';

// Mock fetch
const originalFetch = global.fetch;

describe('WaveSpeed Client', () => {
  // Save original environment and fetch
  const originalEnv = process.env;
  
  beforeEach(() => {
    // Reset mocks
    jest.resetAllMocks();
    
    // Mock fetch
    global.fetch = jest.fn();
    
    // Reset environment variables before each test
    process.env = { ...originalEnv };
    delete process.env.WAVESPEED_API_KEY;
    delete process.env.WAVESPEED_POLL_INTERVAL;
    delete process.env.WAVESPEED_TIMEOUT;
  });
  
  afterAll(() => {
    // Restore environment and fetch
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  describe('Constructor', () => {
    test('should initialize with provided API key', () => {
      const client = new WaveSpeed('test-api-key');
      expect(client).toHaveProperty('apiKey', 'test-api-key');
      expect(client).toHaveProperty('baseUrl', 'https://api.wavespeed.ai/api/v2/');
    });

    test('should initialize with API key from environment variable', () => {
      process.env.WAVESPEED_API_KEY = 'env-api-key';
      const client = new WaveSpeed();
      expect(client).toHaveProperty('pollInterval', 0.5);
    });

    test('should throw error if no API key is provided', () => {
      expect(() => new WaveSpeed()).toThrow('API key is required');
    });

    test('should use custom baseUrl if provided', () => {
      const client = new WaveSpeed('test-api-key', { baseUrl: 'https://custom-api.example.com' });
      expect(client).toHaveProperty('baseUrl', 'https://custom-api.example.com');
    });

    test('should use custom pollInterval if provided', () => {
      const client = new WaveSpeed('test-api-key', { pollInterval: 5 });
      expect(client).toHaveProperty('pollInterval', 5);
    });

    test('should use pollInterval from environment variable', () => {
      process.env.WAVESPEED_POLL_INTERVAL = '3';
      const client = new WaveSpeed('test-api-key');
      expect(client).toHaveProperty('pollInterval', 3);
    });

    test('should use custom timeout if provided', () => {
      const client = new WaveSpeed('test-api-key', { timeout: 120 });
      expect(client).toHaveProperty('timeout', 120);
    });

    test('should use timeout from environment variable', () => {
      process.env.WAVESPEED_TIMEOUT = '90';
      const client = new WaveSpeed('test-api-key');
      expect(client).toHaveProperty('timeout', 90);
    });
  });

  describe('fetchWithTimeout method', () => {
    test('should call fetch with correct parameters', async () => {
      // Setup mock response
      const mockResponse = new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      // Create client and call fetchWithTimeout
      const client = new WaveSpeed('test-api-key');
      const response = await client.fetchWithTimeout('/test-path');

      // Verify fetch was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.wavespeed.ai/api/v2/test-path',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          }),
          signal: expect.any(AbortSignal)
        })
      );

      // Verify response
      expect(response).toBe(mockResponse);
    });

    test('should handle timeout', async () => {
      // Mock AbortController
      const mockAbort = jest.fn();
      const mockSignal = { aborted: false } as AbortSignal;
      jest.spyOn(global, 'AbortController').mockImplementation(() => ({
        abort: mockAbort,
        signal: mockSignal
      } as unknown as AbortController));

      // Setup fetch to never resolve
      (global.fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));

      // Create client with short timeout
      const client = new WaveSpeed('test-api-key', { timeout: 0.1 });
      
      
      // Call fetchWithTimeout (don't await)
      const fetchPromise = client.fetchWithTimeout('/test-path');

      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify abort was called
      expect(mockAbort).toHaveBeenCalled();
      
      // Restore timers
      jest.useRealTimers();
    });

    test('should retry on rate limit (429) status', async () => {
      // Set longer timeout for this test
      jest.setTimeout(10000);
      
      // Mock console.warn to verify logging
      const originalConsoleWarn = console.warn;
      console.warn = jest.fn();
      
      // Create responses - first with 429, then success
      const rateLimitResponse = new Response('Rate limit exceeded', { 
        status: 429, 
        headers: { 'Retry-After': '1' } 
      });
      const successResponse = new Response(JSON.stringify({ success: true }), { 
        status: 200 
      });
      
      // Setup fetch to return rate limit first, then success
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(rateLimitResponse)
        .mockResolvedValueOnce(successResponse);
      
      // Create client with retry options and minimal backoff for faster tests
      const client = new WaveSpeed('test-api-key');
      
      // Override the internal retry delay calculation for testing
      // @ts-ignore - accessing private method for testing
      client._getBackoffTime = jest.fn().mockReturnValue(10); // Use 10ms delay instead of 0 to avoid race conditions
      
      // Call fetchWithTimeout
      const response = await client.fetchWithTimeout('/test-path');
      
      // Verify fetch was called twice
      expect(global.fetch).toHaveBeenCalledTimes(2);
      
      // Verify we got the success response
      expect(response.status).toBe(200);
      
      // Verify console.warn was called for retry
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Request failed with status 429')
      );
      
      // Restore mocks
      console.warn = originalConsoleWarn;
      jest.setTimeout(5000); // Reset timeout
    });

    test('should retry on server error (5xx) for GET requests', async () => {
      // Set longer timeout for this test
      jest.setTimeout(10000);
      
      // Mock console.warn
      const originalConsoleWarn = console.warn;
      console.warn = jest.fn();
      
      // Create responses - first with 503, then success
      const serverErrorResponse = new Response('Service unavailable', { status: 503 });
      const successResponse = new Response(JSON.stringify({ success: true }), { status: 200 });
      
      // Setup fetch to return server error first, then success
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(serverErrorResponse)
        .mockResolvedValueOnce(successResponse);
      
      // Create client
      const client = new WaveSpeed('test-api-key');
      
      // Override the internal retry delay calculation for testing
      // @ts-ignore - accessing private method for testing
      client._getBackoffTime = jest.fn().mockReturnValue(10); // Use 10ms delay instead of 0
      
      // Call fetchWithTimeout with GET method
      const response = await client.fetchWithTimeout('/test-path', { method: 'GET' });
      
      // Verify fetch was called twice
      expect(global.fetch).toHaveBeenCalledTimes(2);
      
      // Verify we got the success response
      expect(response.status).toBe(200);
      
      // Restore mocks
      console.warn = originalConsoleWarn;
      jest.setTimeout(5000); // Reset timeout
    });

    test('should not retry on server error (5xx) for POST requests', async () => {
      // Create responses - server error
      const serverErrorResponse = new Response('Service unavailable', { status: 503 });
      
      // Setup fetch to return server error
      (global.fetch as jest.Mock).mockResolvedValue(serverErrorResponse);
      
      // Create client
      const client = new WaveSpeed('test-api-key');
      
      // Call fetchWithTimeout with POST method
      const response = await client.fetchWithTimeout('/test-path', { method: 'POST' });
      
      // Verify fetch was called only once (no retry)
      expect(global.fetch).toHaveBeenCalledTimes(1);
      
      // Verify we got the error response
      expect(response.status).toBe(503);
    });

    test('should retry on network errors', async () => {
      // Set longer timeout for this test
      jest.setTimeout(10000);
      
      // Mock console.warn
      const originalConsoleWarn = console.warn;
      console.warn = jest.fn();
      
      // Create success response for second attempt
      const successResponse = new Response(JSON.stringify({ success: true }), { status: 200 });
      
      // Setup fetch to throw network error first, then succeed
      (global.fetch as jest.Mock)
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(successResponse);
      
      // Create client
      const client = new WaveSpeed('test-api-key');
      
      // Override the internal retry delay calculation for testing
      // @ts-ignore - accessing private method for testing
      client._getBackoffTime = jest.fn().mockReturnValue(10); // Use 10ms delay instead of 0
      
      // Call fetchWithTimeout
      const response = await client.fetchWithTimeout('/test-path');
      
      // Verify fetch was called twice
      expect(global.fetch).toHaveBeenCalledTimes(2);
      
      // Verify we got the success response
      expect(response.status).toBe(200);
      
      // Verify console.warn was called for retry
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Request failed with error')
      );
      
      // Restore mocks
      console.warn = originalConsoleWarn;
      jest.setTimeout(5000); // Reset timeout
    });

    test('should stop retrying after maxRetries attempts', async () => {
      // Set longer timeout for this test
      jest.setTimeout(10000);
      
      // Mock console.warn
      const originalConsoleWarn = console.warn;
      console.warn = jest.fn();
      
      // Create rate limit response
      const rateLimitResponse = new Response('Rate limit exceeded', { status: 429 });
      
      // Setup fetch to always return rate limit
      (global.fetch as jest.Mock).mockResolvedValue(rateLimitResponse);
      
      // Create client with maxRetries=2
      const client = new WaveSpeed('test-api-key');
      
      // Override the internal retry delay calculation for testing
      // @ts-ignore - accessing private method for testing
      client._getBackoffTime = jest.fn().mockReturnValue(10); // Use 10ms delay instead of 0
      
      // Call fetchWithTimeout with maxRetries=2
      const response = await client.fetchWithTimeout('/test-path', { maxRetries: 2 });
      
      // Verify fetch was called exactly 3 times (initial + 2 retries)
      expect(global.fetch).toHaveBeenCalledTimes(3);
      
      // Verify we got the rate limit response after all retries
      expect(response.status).toBe(429);
      
      // Verify console.warn was called twice for retries
      expect(console.warn).toHaveBeenCalledTimes(2);
      
      // Restore mocks
      console.warn = originalConsoleWarn;
      jest.setTimeout(5000); // Reset timeout
    });
  });

  describe('create method', () => {
    test('should create a prediction', async () => {
      // Mock response data
      const mockResponseData = {data:
        {id: 'pred-123',
        model: 'wavespeed-ai/flux-dev',
        status: 'processing',
        input: { prompt: 'test prompt' },
        outputs: [],
        urls: { get: 'https://api.wavespeed.ai/api/v2/predictions/pred-123' },
        has_nsfw_contents: [],
        created_at: '2023-01-01T00:00:00Z'}
      };

      // Setup mock response
      const mockResponse = new Response(JSON.stringify(mockResponseData), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);

      // Create client and call create
      const client = new WaveSpeed('test-api-key');
      const input = { prompt: 'test prompt' };
      const prediction = await client.create('wavespeed-ai/flux-dev', input);

      // Verify fetch was called with correct parameters
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api.wavespeed.ai/api/v2/wavespeed-ai/flux-dev',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input)
        })
      );

      // Verify prediction object
      expect(prediction).toBeInstanceOf(Prediction);
      expect(prediction.id).toBe('pred-123');
      expect(prediction.status).toBe('processing');
      expect(prediction.model).toBe('wavespeed-ai/flux-dev');
    });

    test('should handle API errors', async () => {
      // Setup mock to return error response
      const errorResponse = new Response('API Error', { status: 400 });
      (global.fetch as jest.Mock).mockResolvedValue(errorResponse);

      // Create client and call create
      const client = new WaveSpeed('test-api-key');
      const input = { prompt: 'test prompt' };
      
      // Expect the create method to throw
      await expect(client.create('wavespeed-ai/flux-dev', input))
        .rejects.toThrow('Failed to create prediction: 400 API Error');
    });
  });

  describe('run method', () => {
    test('should create a prediction and wait for completion', async () => {
      // Mock response data for create
      const mockCreateResponse = {data:{
        id: 'pred-123',
        model: 'wavespeed-ai/flux-dev',
        status: 'processing',
        input: { prompt: 'test prompt' },
        outputs: [],
        urls: { get: 'https://api.wavespeed.ai/api/v2/predictions/pred-123' },
        has_nsfw_contents: [],
        created_at: '2023-01-01T00:00:00Z'}
      };

      // Mock response data for get (completed prediction)
      const mockGetResponse = {data:
        {id: 'pred-123',
        model: 'wavespeed-ai/flux-dev',
        status: 'completed',
        input: { prompt: 'test prompt' },
        outputs: ['https://example.com/image1.png'],
        urls: { get: 'https://api.wavespeed.ai/api/v2/predictions/pred-123' },
        has_nsfw_contents: [false],
        created_at: '2023-01-01T00:00:00Z',
        executionTime: 5000}
      };

      // Setup mocks
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce(new Response(JSON.stringify(mockCreateResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }))
        .mockResolvedValueOnce(new Response(JSON.stringify(mockGetResponse), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        }));

      // Create client and call run
      const client = new WaveSpeed('test-api-key');
      const input = { prompt: 'test prompt' };
      const prediction = await client.run('wavespeed-ai/flux-dev', input);

      // Verify fetch was called correctly
      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(global.fetch).toHaveBeenNthCalledWith(
        1,
        'https://api.wavespeed.ai/api/v2/wavespeed-ai/flux-dev',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(input)
        })
      );
      
      expect(global.fetch).toHaveBeenNthCalledWith(
        2,
        'https://api.wavespeed.ai/api/v2/predictions/pred-123/result',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-api-key'
          })
        })
      );

      // Verify prediction object
      expect(prediction).toBeInstanceOf(Prediction);
      expect(prediction.id).toBe('pred-123');
      expect(prediction.status).toBe('completed');
      expect(prediction.outputs).toEqual(['https://example.com/image1.png']);
      expect(prediction.executionTime).toBe(5000);
    });
  });
});

describe('Prediction', () => {
  // Mock WaveSpeed client
  const mockFetchWithTimeout = jest.fn();
  const mockClient = {
    fetchWithTimeout: mockFetchWithTimeout,
    pollInterval: 1
  } as unknown as WaveSpeed;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('wait method', () => {
    test('should return immediately if status is not processing', async () => {
      // Create a completed prediction
      const predictionData = {
        id: 'pred-123',
        model: 'wavespeed-ai/flux-dev',
        status: 'completed',
        input: { prompt: 'test prompt' },
        outputs: ['https://example.com/image1.png'],
        urls: { get: 'https://api.wavespeed.ai/api/v2/predictions/pred-123' },
        has_nsfw_contents: [false],
        created_at: '2023-01-01T00:00:00Z',
        executionTime: 5000
      };

      const prediction = new Prediction(predictionData, mockClient);
      
      // Wait should resolve immediately
      const result = await prediction.wait();
      
      // Verify no API calls were made
      expect(mockFetchWithTimeout).not.toHaveBeenCalled();
      
      // Verify prediction was returned
      expect(result).toBe(prediction);
    });

    test('should poll until prediction is complete', async () => {
      // Create a processing prediction
      const predictionData = {data:
        {id: 'pred-123',
        model: 'wavespeed-ai/flux-dev',
        status: 'processing',
        input: { prompt: 'test prompt' },
        outputs: [],
        urls: { get: 'https://api.wavespeed.ai/api/v2/predictions/pred-123' },
        has_nsfw_contents: [],
        created_at: '2023-01-01T00:00:00Z'}
      };

      // Mock response data for first poll (still processing)
      const mockFirstPollResponse = {
        ...predictionData
      };

      // Mock response data for second poll (completed)
      const mockSecondPollResponse = {data:
        {id: 'pred-123',
        model: 'wavespeed-ai/flux-dev',
        status: 'completed',
        input: { prompt: 'test prompt' },
        outputs: ['https://example.com/image1.png'],
        urls: { get: 'https://api.wavespeed.ai/api/v2/predictions/pred-123' },
        has_nsfw_contents: [false],
        created_at: '2023-01-01T00:00:00Z',
        executionTime: 5000}
      };

      // Setup mocks
      mockFetchWithTimeout
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockFirstPollResponse)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(mockSecondPollResponse)
        });

      // Create prediction and wait
      const prediction = new Prediction(predictionData.data, mockClient);
      
      // Mock setTimeout to execute immediately
      // jest.useFakeTimers();
      
      // Start waiting (don't await yet)
      const waitPromise = prediction.wait();
      
      // Fast-forward timers
      // jest.advanceTimersByTime(1000);
      // jest.advanceTimersByTime(1000);
      
      // Now await the promise
      const result = await waitPromise;
      
      // Verify API calls
      expect(mockFetchWithTimeout).toHaveBeenCalledTimes(2);
      expect(mockFetchWithTimeout).toHaveBeenCalledWith('predictions/pred-123/result');
      
      // Verify prediction was updated
      expect(result.status).toBe('completed');
      expect(result.outputs).toEqual(['https://example.com/image1.png']);
      expect(result.executionTime).toBe(5000);
      
      // Restore timers
      jest.useRealTimers();
    });
  });

  describe('reload method', () => {
    test('should update prediction with latest data', async () => {
      // Create a prediction
      const predictionData = {data:
        {id: 'pred-123',
        model: 'wavespeed-ai/flux-dev',
        status: 'processing',
        input: { prompt: 'test prompt' },
        outputs: [],
        urls: { get: 'https://api.wavespeed.ai/api/v2/predictions/pred-123/result' },
        has_nsfw_contents: [],
        created_at: '2023-01-01T00:00:00Z'
      }};

      // Mock response data for reload
      const mockReloadResponse = {data:
        {id: 'pred-123',
        model: 'wavespeed-ai/flux-dev',
        status: 'completed',
        input: { prompt: 'test prompt' },
        outputs: ['https://example.com/image1.png'],
        urls: { get: 'https://api.wavespeed.ai/api/v2/predictions/pred-123/result' },
        has_nsfw_contents: [false],
        created_at: '2023-01-01T00:00:00Z',
        executionTime: 5000
      }};

      // Setup mock
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockReloadResponse)
      });

      // Create prediction and reload
      const prediction = new Prediction(predictionData.data, mockClient);
      const result = await prediction.reload();
      
      // Verify API call
      expect(mockFetchWithTimeout).toHaveBeenCalledWith('predictions/pred-123/result');
      
      // Verify prediction was updated
      expect(result).toBe(prediction);
      expect(prediction.status).toBe('completed');
      expect(prediction.outputs).toEqual(['https://example.com/image1.png']);
      expect(prediction.executionTime).toBe(5000);
    });

    test('should handle API errors', async () => {
      // Create a prediction
      const predictionData = {data:
        {id: 'pred-123',
        model: 'wavespeed-ai/flux-dev',
        status: 'processing',
        input: { prompt: 'test prompt' },
        outputs: [],
        urls: { get: 'https://api.wavespeed.ai/api/v2/predictions/pred-123/result' },
        has_nsfw_contents: [],
        created_at: '2023-01-01T00:00:00Z'
      }};

      // Setup mock to return error
      mockFetchWithTimeout.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Prediction not found')
      });

      // Create prediction and try to reload
      const prediction = new Prediction(predictionData, mockClient);
      
      // Expect reload to throw
      await expect(prediction.reload())
        .rejects.toThrow('Failed to reload prediction: 404 Prediction not found');
    });
  });
});
