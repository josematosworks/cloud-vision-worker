export default {
  async fetch(request, env) {
    try {
      // Get the file URL from the request query parameters
      const url = new URL(request.url);
      const fileUrl = url.searchParams.get('url');
      
      if (!fileUrl) {
        return new Response('Please provide a file URL as a query parameter', { status: 400 });
      }

      // Fetch the file
      const fileResponse = await fetch(fileUrl);
      const contentType = fileResponse.headers.get('content-type');
      const fileBuffer = await fileResponse.arrayBuffer();

      // Check if it's PDF or image
      if (contentType.includes('pdf')) {
        // Handle PDF files
        // Note: Cloud Vision API doesn't directly support PDFs
        // You might need to convert PDF to images first or use Document AI API instead
        return new Response('PDF processing not implemented yet', { status: 501 });
      }

      if (!contentType.includes('image')) {
        return new Response('Unsupported file type. Please provide an image file.', { status: 400 });
      }

      // Prepare the request to Cloud Vision API
      const visionRequest = {
        requests: [{
          image: {
            content: Buffer.from(fileBuffer).toString('base64')
          },
          features: [{
            type: 'TEXT_DETECTION'
          }]
        }]
      };

      // Call Cloud Vision API
      const visionResponse = await fetch('https://vision.googleapis.com/v1/images:annotate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GOOGLE_CLOUD_API_KEY}`
        },
        body: JSON.stringify(visionRequest)
      });

      const visionData = await visionResponse.json();
      
      // Return the complete Vision API response
      return new Response(JSON.stringify(visionData, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });

    } catch (error) {
      return new Response(`Error processing file: ${error.message}`, { status: 500 });
    }
  },
};
