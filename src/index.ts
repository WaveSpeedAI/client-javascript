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

/**
 * Request options for fetch
 */
export interface RequestOptions extends RequestInit {
  timeout?: number;
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
  private baseUrl: string = 'https://api.wavespeed.ai/api/v2/';
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

    this.pollInterval = options.pollInterval || Number(getEnvVar('WAVESPEED_POLL_INTERVAL')) || 1;
    this.timeout = options.timeout || Number(getEnvVar('WAVESPEED_TIMEOUT')) || 60;
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
    fetchOptions.headers = {
      ...fetchOptions.headers,
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
    
    // Use AbortController for timeout (supported in modern browsers)
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    
    try {
      // Use browser's built-in URL API
      const url = new URL(path, this.baseUrl).toString();
      
      // Use the global fetch API available in browsers
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal
      });
      
      return response;
    } finally {
      clearTimeout(id);
    }
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
    const response = await this.fetchWithTimeout(`${modelId}`, {
      method: 'POST',
      body: JSON.stringify(input),
      ...options
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create prediction: ${response.status} ${errorText}`);
    }
    
    const data = await response.json();
    return new Prediction(data.data, this);
  }
}

// Export default and named exports for different import styles
export default WaveSpeed;

// Add browser global for UMD-style usage
if (typeof window !== 'undefined') {
  (window as any).WaveSpeed = WaveSpeed;
}
