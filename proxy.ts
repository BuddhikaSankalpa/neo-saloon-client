import { NextRequest, NextResponse } from 'next/server';

const allowedOrigins = [
  'http://localhost:3001',
];

const corsHeaders = {
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Credentials': 'true',
};

export function proxy(request: NextRequest) {
  const origin = request.headers.get('origin') ?? '';
  const isAllowed = allowedOrigins.includes(origin);

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, {
      status: 204,
      headers: {
        ...(isAllowed && { 'Access-Control-Allow-Origin': origin }),
        ...corsHeaders,
      },
    });
  }

  // Handle normal requests
  const response = NextResponse.next();
  if (isAllowed) {
    response.headers.set('Access-Control-Allow-Origin', origin);
  }
  Object.entries(corsHeaders).forEach(([key, value]) =>
    response.headers.set(key, value)
  );
  return response;
}
