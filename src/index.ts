/**
 * Input parameters for image generation
 */

/**
 * Prediction status
 */
export type PredictionStatus = 'created' | 'processing' | 'completed' | 'failed';

/**
 * Prediction URLs
 */
export interface PredictionUrls {
  get: string;
}

export interface UploadFileResp {
  code: number;
  message: string;
  data: {
    type: string;
    download_url: string;
    filename: string;
    size: number;
  };
}

/**
 * Request options for fetch
 */
export interface RequestOptions extends RequestInit {
  timeout?: number;
  maxRetries?: number;
  webhook?: string;
  isUpload?: boolean;
}

/**
 * Prediction model representing an image generation job
 */
export class Prediction {
  id: string;
  model: string;
  status: PredictionStatus;
  input: Record<string, any>;
  outputs: string[];
  urls: PredictionUrls;
  has_nsfw_contents: boolean[];
  created_at: string;
  error?: string;
  executionTime?: number;

  private client: WaveSpeed;

  constructor(data: any, client: WaveSpeed) {
    this.id = data.id;
    this.model = data.model;
    this.status = data.status;
    this.input = data.input;
    this.outputs = data.outputs || [];
    this.urls = data.urls;
    this.has_nsfw_contents = data.has_nsfw_contents || [];
    this.created_at = data.created_at;
    this.error = data.error;
    this.executionTime = data.executionTime;
    this.client = client;
  }

  /**
   * Wait for the prediction to complete
   */
  async wait(): Promise<Prediction> {
    if (this.status === 'completed' || this.status === 'failed') {
      return this;
    }

    return new Promise((resolve, reject) => {
      const checkStatus = async () => {
        try {
          const updated = await this.reload();
          if (updated.status === 'completed' || updated.status === 'failed') {
            resolve(updated);
          } else {
            setTimeout(checkStatus, this.client.pollInterval * 1000);
          }
        } catch (error) {
          reject(error);
        }
      };

      checkStatus();
    });
  }

  /**
   * Reload the prediction status
   */
  async reload(): Promise<Prediction> {
    const response = await this.client.fetchWithTimeout(`predictions/${this.id}/result`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to reload prediction: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const updatedPrediction = new Prediction(data.data, this.client);

    // Update this instance with new data
    Object.assign(this, updatedPrediction);

    return this;
  }
}

/**
 * WaveSpeed client for generating images
 */
export class WaveSpeed {
  private apiKey: string;
  private baseUrl: string = 'https://api.wavespeed.ai/api/v3/';
  readonly pollInterval: number;
  readonly timeout: number;

  /**
   * Create a new WaveSpeed client
   * 
   * @param apiKey Your WaveSpeed API key (or set WAVESPEED_API_KEY environment variable)
   * @param options Additional client options
   */
  constructor(apiKey?: string, options: {
    baseUrl?: string,
    pollInterval?: number,
    timeout?: number
  } = {}) {
    // Browser-friendly environment variable handling
    const getEnvVar = (name: string): string | undefined => {
      // Try to get from process.env for Node.js environments
      if (typeof process !== 'undefined' && process.env && process.env[name]) {
        return process.env[name];
      }
      return undefined;
    };

    this.apiKey = apiKey || getEnvVar('WAVESPEED_API_KEY') || '';

    if (!this.apiKey) {
      throw new Error('API key is required. Provide it as a parameter or set the WAVESPEED_API_KEY environment variable.');
    }

    if (options.baseUrl) {
      this.baseUrl = options.baseUrl;
    }

    this.pollInterval = options.pollInterval || Number(getEnvVar('WAVESPEED_POLL_INTERVAL')) || 0.5;
    this.timeout = options.timeout || Number(getEnvVar('WAVESPEED_TIMEOUT')) || 120;
  }

  /**
   * Fetch with timeout support
   * 
   * @param path API path
   * @param options Fetch options
   */
  async fetchWithTimeout(path: string, options: RequestOptions = {}): Promise<Response> {
    const { timeout = this.timeout * 1000, ...fetchOptions } = options;

    // Ensure headers exist
    if (options.isUpload) {
      fetchOptions.headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        ...(fetchOptions.headers || {}),
      };

    } else {
      fetchOptions.headers = {
        'Authorization': `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
        ...(fetchOptions.headers || {}),
      };

    }

    // Default retry options
    const maxRetries = options.maxRetries || 3;
    const initialBackoff = 1000; // 1 second
    let retryCount = 0;

    // Function to determine if a response should be retried
    const shouldRetry = (response: Response): boolean => {
      // Retry on rate limit (429) for all requests
      // For GET requests, also retry on server errors (5xx)
      const method = (fetchOptions.method || 'GET').toUpperCase();
      return response.status === 429 || (method === 'GET' && response.status >= 500);
    };

    while (true) {
      // Use AbortController for timeout (supported in modern browsers)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      try {
        // Construct the full URL by joining baseUrl and path
        const url = new URL(path.startsWith('/') ? path.substring(1) : path, this.baseUrl).toString();

        const response = await fetch(url, {
          ...fetchOptions,
          signal: controller.signal
        });

        // If the response is successful or we've used all retries, return it
        if (response.ok || !shouldRetry(response) || retryCount >= maxRetries) {
          return response;
        }

        // Otherwise, increment retry count and wait before retrying
        retryCount++;
        const backoffTime = this._getBackoffTime(retryCount, initialBackoff);

        // Log retry information if console is available
        if (typeof console !== 'undefined') {
          console.warn(`Request failed with status ${response.status}. Retrying (${retryCount}/${maxRetries}) in ${Math.round(backoffTime)}ms...`);
        }

        // Wait for backoff time before retrying
        await new Promise(resolve => setTimeout(resolve, backoffTime));

      } catch (error) {
        // If the error is due to timeout or network issues and we have retries left
        if (error instanceof Error &&
          (error.name === 'AbortError' || error.name === 'TypeError') &&
          retryCount < maxRetries) {

          retryCount++;
          const backoffTime = this._getBackoffTime(retryCount, initialBackoff);

          // Log retry information if console is available
          if (typeof console !== 'undefined') {
            console.warn(`Request failed with error: ${error.message}. Retrying (${retryCount}/${maxRetries}) in ${Math.round(backoffTime)}ms...`);
          }

          // Wait for backoff time before retrying
          await new Promise(resolve => setTimeout(resolve, backoffTime));

        } else {
          // If we're out of retries or it's a non-retryable error, throw it
          throw error;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Calculate backoff time with exponential backoff and jitter
   * @param retryCount Current retry attempt number
   * @param initialBackoff Initial backoff time in ms
   * @returns Backoff time in ms
   * @private
   */
  _getBackoffTime(retryCount: number, initialBackoff: number): number {
    const backoff = initialBackoff * Math.pow(2, retryCount);
    // Add jitter (random value between 0 and backoff/2)
    return backoff + Math.random() * (backoff / 2);
  }

  /**
   * Generate an image and wait for the result
   * 
   * @param modelId Model ID to use for prediction
   * @param input Input parameters for the prediction
   * @param options Additional fetch options
   */
  async run(modelId: string, input: Record<string, any>, options?: RequestOptions): Promise<Prediction> {
    const prediction = await this.create(modelId, input, options);
    return prediction.wait();
  }

  /**
   * Create a prediction without waiting for it to complete
   * 
   * @param modelId Model ID to use for prediction
   * @param input Input parameters for the prediction
   * @param options Additional fetch options
   */
  async create(modelId: string, input: Record<string, any>, options?: RequestOptions): Promise<Prediction> {

    // Build URL with webhook if provided in options
    let url = `${modelId}`;
    if (options?.webhook) {
      url += `?webhook=${options.webhook}`;
    }

    const response = await this.fetchWithTimeout(url, {
      method: 'POST',
      body: JSON.stringify(input),
      ...options
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create prediction: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    if (data.code !== 200) {
      throw new Error(`Failed to create prediction: ${data.code} ${data}`);
    }
    return new Prediction(data.data, this);
  }

  /**
   * Upload a file (binary) to the /media/upload/binary endpoint
   * @param filePath Absolute path to the file to upload
   * @returns The API response JSON
   */
  /**
   * Upload a file (binary) to the /media/upload/binary endpoint (browser Blob version)
   * @param file Blob to upload
   * @returns The API response JSON
   */
  async upload(file: Blob, options?: RequestOptions): Promise<string> {
    const form = new FormData();
    form.append('file', file);
    // Only set Authorization header; browser will set Content-Type
    if (options == null) {
      options = { isUpload: true }
    }
    const response = await this.fetchWithTimeout('media/upload/binary', {
      method: 'POST',
      body: form,
      ...options
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload file: ${response.status} ${errorText}`);
    }
    const resp: UploadFileResp = await response.json();
    return resp.data.download_url
  }
}



// Export default and named exports for different import styles
export default WaveSpeed;

// Add browser global for UMD-style usage
if (typeof window !== 'undefined') {
  (window as any).WaveSpeed = WaveSpeed;
}
