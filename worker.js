/**
 * Cloudflare Worker for Health Tracker Sync
 * Stores user data in R2 bucket with PIN authentication
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Pin',
      'Access-Control-Max-Age': '86400',
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint
      if (path === '/health') {
        return new Response(JSON.stringify({
          status: 'ok',
          timestamp: Date.now()
        }), {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      // Data endpoints: /data/:userId
      const dataMatch = path.match(/^\/data\/([a-zA-Z0-9_-]+)$/);
      if (!dataMatch) {
        return new Response(JSON.stringify({
          error: 'Invalid endpoint'
        }), {
          status: 404,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }

      const userId = dataMatch[1];
      const key = `data/${userId}.json`;

      // GET /data/:userId - Read user data (no auth required)
      if (request.method === 'GET') {
        try {
          const object = await env.DATA_BUCKET.get(key);

          if (!object) {
            return new Response(JSON.stringify({
              error: 'User data not found'
            }), {
              status: 404,
              headers: {
                ...corsHeaders,
                'Content-Type': 'application/json'
              }
            });
          }

          const data = await object.text();
          return new Response(data, {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'Cache-Control': 'no-store, no-cache, must-revalidate'
            }
          });
        } catch (error) {
          console.error('R2 GET error:', error);
          return new Response(JSON.stringify({
            error: 'Failed to read data',
            details: error.message
          }), {
            status: 500,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
      }

      // PUT /data/:userId - Write user data (requires PIN auth)
      if (request.method === 'PUT') {
        // Verify PIN
        const pin = request.headers.get('X-Pin');
        const authPin = env.AUTH_PIN;

        if (!pin || !authPin || pin !== authPin) {
          return new Response(JSON.stringify({
            error: 'Invalid or missing PIN'
          }), {
            status: 401,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }

        // Validate request body
        let requestData;
        try {
          requestData = await request.json();
        } catch (error) {
          return new Response(JSON.stringify({
            error: 'Invalid JSON in request body'
          }), {
            status: 400,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }

        // Write to R2
        try {
          const dataString = JSON.stringify(requestData, null, 2);
          await env.DATA_BUCKET.put(key, dataString, {
            httpMetadata: {
              contentType: 'application/json'
            },
            customMetadata: {
              userId: userId,
              lastModified: String(Date.now())
            }
          });

          return new Response(JSON.stringify({
            success: true,
            userId: userId,
            timestamp: Date.now()
          }), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        } catch (error) {
          console.error('R2 PUT error:', error);
          return new Response(JSON.stringify({
            error: 'Failed to write data',
            details: error.message
          }), {
            status: 500,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json'
            }
          });
        }
      }

      // Method not allowed
      return new Response(JSON.stringify({
        error: 'Method not allowed'
      }), {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'Allow': 'GET, PUT, OPTIONS'
        }
      });

    } catch (error) {
      console.error('Worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        details: error.message
      }), {
        status: 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
  }
};
