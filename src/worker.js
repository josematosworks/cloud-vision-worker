// Add these helper functions at the top of the file
function createJWT(serviceAccount) {
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: serviceAccount.private_key_id,
  };

  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/cloud-vision",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  };

  const base64Header = btoa(JSON.stringify(header))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const base64Claim = btoa(JSON.stringify(claim))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  const signatureInput = `${base64Header}.${base64Claim}`;
  const key = serviceAccount.private_key;

  // Create signature using Web Crypto API
  const encoder = new TextEncoder();
  const signatureBytes = encoder.encode(signatureInput);

  return crypto.subtle
    .importKey(
      "pkcs8",
      pemToArrayBuffer(key),
      {
        name: "RSASSA-PKCS1-v1_5",
        hash: "SHA-256",
      },
      false,
      ["sign"]
    )
    .then((privateKey) =>
      crypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, signatureBytes)
    )
    .then((signature) => {
      const base64Signature = btoa(
        String.fromCharCode(...new Uint8Array(signature))
      )
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      return `${signatureInput}.${base64Signature}`;
    });
}

function pemToArrayBuffer(pem) {
  const pemContents = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
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
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  const data = await response.json();
  return data.access_token;
}

// Add this new function to handle PDF conversion
async function convertPDFToImages(pdfBuffer) {
  // Import PDF.js worker from CDN
  importScripts(
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"
  );
  const pdfjsLib = globalThis.pdfjsLib;

  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({ data: pdfBuffer });
  const pdf = await loadingTask.promise;

  const images = [];
  // Process each page
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 }); // Adjust scale as needed

    // Create canvas
    const canvas = new OffscreenCanvas(viewport.width, viewport.height);
    const context = canvas.getContext("2d");

    // Render PDF page to canvas
    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise;

    // Convert canvas to blob
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const arrayBuffer = await blob.arrayBuffer();
    images.push(arrayBuffer);
  }

  return images;
}

async function convertTextToSpeech(text, accessToken) {
  const ttsRequest = {
    input: { text },
    voice: {
      languageCode: 'en-US',
      name: 'en-US-Neural2-F',  // Using a neural voice
      ssmlGender: 'FEMALE'
    },
    audioConfig: {
      audioEncoding: 'MP3'
    }
  };

  const ttsResponse = await fetch(
    'https://texttospeech.googleapis.com/v1/text:synthesize',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`
      },
      body: JSON.stringify(ttsRequest)
    }
  );

  const data = await ttsResponse.json();
  // Convert base64 audio content to ArrayBuffer
  const audioContent = Uint8Array.from(atob(data.audioContent.replace(/_/g, '/').replace(/-/g, '+')), c => c.charCodeAt(0));
  return audioContent.buffer;
}

export default {
  async fetch(request, env) {
    // Get the request path
    const request_url = new URL(request.url);
    const path = request_url.pathname;

    try {
      const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);
      const accessToken = await getAccessToken(serviceAccount);

      // Handle TTS requests
      if (path === '/tts') {
        if (request.method !== 'POST') {
          return new Response('Method not allowed', { status: 405 });
        }

        const { text } = await request.json();
        if (!text) {
          return new Response('Please provide text in the request body', { 
            status: 400 
          });
        }

        const audioBuffer = await convertTextToSpeech(text, accessToken);
        return new Response(audioBuffer, {
          headers: {
            'Content-Type': 'audio/mpeg',
            'Content-Disposition': 'attachment; filename="speech.mp3"'
          }
        });
      }

      // Original OCR endpoint logic
      if (path === '/ocr') {
        const { url: fileUrl } = await request.json();

        if (!fileUrl) {
          return new Response("Please provide a file URL in the request body", {
            status: 400,
          });
        }

        // Fetch just the content-type header to determine file type
        const fileResponse = await fetch(fileUrl, { method: 'HEAD' });
        const contentType = fileResponse.headers.get("content-type");

        // Check if it's PDF or image
        if (contentType.includes("pdf")) {
          const fileBuffer = await (await fetch(fileUrl)).arrayBuffer();
          const images = await convertPDFToImages(fileBuffer);
          const promises = images.map(async (imageBuffer) => {
            const visionRequest = {
              requests: [
                {
                  image: {
                    content: btoa(
                      String.fromCharCode(...new Uint8Array(imageBuffer))
                    ),
                  },
                  features: [
                    {
                      type: "TEXT_DETECTION",
                    },
                  ],
                },
              ],
            };

            const visionResponse = await fetch(
              "https://vision.googleapis.com/v1/images:annotate",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify(visionRequest),
              }
            );

            const result = await visionResponse.json();
            // Extract only the text from the response
            return result.responses[0]?.fullTextAnnotation?.text || '';
          });

          const results = await Promise.all(promises);
          // Add number of images processed to the response
          return new Response(JSON.stringify({ 
            text: results.join('\n\n'),
            pageCount: images.length 
          }), {
            headers: { "Content-Type": "application/json" },
          });
        }

        if (!contentType.includes("image")) {
          return new Response(
            "Unsupported file type. Please provide an image file.",
            { status: 400 }
          );
        }

        // For images, pass the URL directly to Vision API
        const visionRequest = {
          requests: [
            {
              image: {
                source: {
                  imageUri: fileUrl
                }
              },
              features: [
                {
                  type: "TEXT_DETECTION",
                },
              ],
            },
          ],
        };

        // Call Cloud Vision API
        const visionResponse = await fetch(
          "https://vision.googleapis.com/v1/images:annotate",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify(visionRequest),
          }
        );

        const visionData = await visionResponse.json();
        // Extract only the text from the response
        const extractedText = visionData.responses[0]?.fullTextAnnotation?.text || '';

        // Add pageCount of 1 for single images
        return new Response(JSON.stringify({ 
          text: extractedText,
          pageCount: 1 
        }), {
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response('Not found', { status: 404 });
    } catch (error) {
      return new Response(`Error: ${error.message}`, { status: 500 });
    }
  }
};
