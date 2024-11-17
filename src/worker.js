// Add these helper functions at the top of the file
function createJWT(serviceAccount) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: serviceAccount.private_key_id
  };

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-vision',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now
  };

  const base64Header = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const base64Claim = btoa(JSON.stringify(claim)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  const signatureInput = `${base64Header}.${base64Claim}`;
  const key = serviceAccount.private_key;
  
  // Create signature using Web Crypto API
  const encoder = new TextEncoder();
  const signatureBytes = encoder.encode(signatureInput);
  
  return crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(key),
    {
      name: 'RSASSA-PKCS1-v1_5',
      hash: 'SHA-256'
    },
    false,
    ['sign']
  )
  .then(privateKey => crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    signatureBytes
  ))
  .then(signature => {
    const base64Signature = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    return `${signatureInput}.${base64Signature}`;
  });
}

function pemToArrayBuffer(pem) {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const binary = atob(pemContents);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return buffer;
}

async function getAccessToken(serviceAccount) {
  const jwt = await createJWT(serviceAccount);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  
  const data = await response.json();
  return data.access_token;
}

export default {
  async fetch(request, env) {
    try {
      // Parse service account from environment variable
      const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
      
      // Get access token
      const accessToken = await getAccessToken(serviceAccount);

      // Get the file URL from the request body
      const { url: fileUrl } = await request.json();
      
      if (!fileUrl) {
        return new Response('Please provide a file URL in the request body', { status: 400 });
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
            content: btoa(String.fromCharCode(...new Uint8Array(fileBuffer)))
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
          'Authorization': `Bearer ${accessToken}`
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
