# WaveSpeed JavaScript/TypeScript Client

A JavaScript/TypeScript client for the WaveSpeed AI image generation API. This client is compatible with both JavaScript and TypeScript projects.

## Installation

```bash
npm install wavespeed
```

## Usage

### JavaScript

```javascript
const { WaveSpeed } = require('wavespeed');

// Initialize the client with your API key
const client = new WaveSpeed('YOUR_API_KEY');

// Generate an image and wait for the result
async function generateImage() {
  const prediction = await client.run(
    'wavespeed-ai/flux-dev',
    {
      prompt: 'A futuristic cityscape with flying cars and neon lights',
      size: '1024*1024',
      num_inference_steps: 28,
      guidance_scale: 5.0,
      num_images: 1,
      seed: -1,
      enable_safety_checker: true
    }
  );

  // Print the generated image URLs
  prediction.outputs.forEach((imgUrl, i) => {
    console.log(`Image ${i+1}: ${imgUrl}`);
  });
}

generateImage().catch(console.error);
```

### TypeScript

```typescript
import WaveSpeed from 'wavespeed';

// Initialize the client with your API key
const client = new WaveSpeed('YOUR_API_KEY');

// Generate an image and wait for the result
async function generateImage(): Promise<void> {
  const input: Record<string, any> = {
    prompt: 'A futuristic cityscape with flying cars and neon lights',
    size: '1024*1024',
    num_inference_steps: 28,
    guidance_scale: 5.0,
    num_images: 1,
    seed: -1,
    enable_safety_checker: true
  };

  const prediction = await client.run('wavespeed-ai/flux-dev', input);

  // Print the generated image URLs
  prediction.outputs.forEach((imgUrl, i) => {
    console.log(`Image ${i+1}: ${imgUrl}`);
  });
}

generateImage().catch(console.error);
```

### Manual Status Polling Example

If you need more control over the polling process, you can use the `create` method and manually poll for status updates:

```typescript
import WaveSpeed from 'wavespeed';

// Initialize the client with your API key
const client = new WaveSpeed('YOUR_API_KEY');

async function generateWithManualPolling(): Promise<void> {
  // Create a prediction without waiting
  const prediction = await client.create('wavespeed-ai/flux-dev', {
    prompt: 'A beautiful mountain landscape at sunset',
    size: '1024*1024',
    num_inference_steps: 28,
    guidance_scale: 5.0,
    num_images: 1
  });

  console.log(`Prediction created with ID: ${prediction.id}`);
  console.log(`Initial status: ${prediction.status}`);

  // Manually poll for status updates
  let currentPrediction = prediction;
  
  while (currentPrediction.status !== 'completed' && currentPrediction.status !== 'failed') {
    console.log('Prediction still processing, checking again in 2 seconds...');
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Reload the prediction to get the latest status
    currentPrediction = await currentPrediction.reload();
    console.log(`Updated status: ${currentPrediction.status}`);
  }
  
  if (currentPrediction.status === 'completed') {
    console.log('Prediction completed successfully!');
    currentPrediction.outputs.forEach((imgUrl, i) => {
      console.log(`Image ${i+1}: ${imgUrl}`);
    });
  } else {
    console.error(`Prediction failed: ${currentPrediction.error}`);
  }
}

generateWithManualPolling().catch(console.error);
```

## API Reference

### WaveSpeed Client

```typescript
new WaveSpeed(apiKey?: string, options?: {
  baseUrl?: string,
  pollInterval?: number,
  timeout?: number
})
```

#### Parameters:
- `apiKey` (string): Your WaveSpeed API key
- `options` (object, optional):
  - `baseUrl` (string): API base URL (default: 'https://api.wavespeed.ai/api/v2/')
  - `pollInterval` (number): Interval in seconds for polling prediction status (default: 1)
  - `timeout` (number): Timeout in seconds for API requests (default: 60)

### Methods

#### run

```typescript
run(modelId: string, input: Record<string, any>, options?: RequestOptions): Promise<Prediction>
```

Generate an image and wait for the result.

#### create

```typescript
create(modelId: string, input: Record<string, any>, options?: RequestOptions): Promise<Prediction>
```

Create a prediction without waiting for it to complete.

### Prediction Model

The Prediction object contains information about an image generation job:

```typescript
prediction.id           // Unique ID of the prediction
prediction.model        // Model ID used for the prediction
prediction.status       // Status of the prediction (processing, completed, failed)
prediction.input        // Input parameters used for the prediction
prediction.outputs      // List of output image URLs
prediction.urls.get     // URL to get the prediction status
prediction.has_nsfw_contents // List of booleans indicating if each image has NSFW content
prediction.created_at   // Creation timestamp
prediction.error        // Error message (if any)
prediction.executionTime // Time taken to execute the prediction in milliseconds
```

#### Methods

```typescript
prediction.wait(): Promise<Prediction>  // Wait for the prediction to complete
prediction.reload(): Promise<Prediction>  // Reload the prediction status
```

## Environment Variables

- `WAVESPEED_API_KEY`: Your WaveSpeed API key
- `WAVESPEED_POLL_INTERVAL`: Interval in seconds for polling prediction status (default: 1)
- `WAVESPEED_TIMEOUT`: Timeout in seconds for API requests (default: 60)

## License

MIT
